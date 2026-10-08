-- Partial payment totals and append-only payment association corrections.
create table budget.bill_payment_links (
  id bigint generated always as identity primary key,
  entry_id uuid not null,
  space_id uuid not null,
  link_version integer not null check (link_version > 0),
  bill_id uuid,
  due_on date,
  request_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (entry_id, link_version),
  unique (space_id, request_id),
  check ((bill_id is null) = (due_on is null)),
  foreign key (entry_id, space_id) references budget.entries(id, space_id),
  foreign key (bill_id, space_id) references budget.bills(id, space_id)
);
alter table budget.bill_payment_links enable row level security;
revoke all on budget.bill_payment_links from public, anon, authenticated, service_role;
create trigger bill_payment_links_append_only before update or delete or truncate on budget.bill_payment_links
for each statement execute function budget.reject_mutation();

-- Snapshot loan identity independently of mutable bill configuration. Existing
-- fee-only entries can only be seeded from the birth bill as it exists at migration.
create table budget.bill_payment_loan_identities (
  entry_id uuid primary key,
  space_id uuid not null,
  loan_wallet_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (entry_id,space_id) references budget.entries(id,space_id),
  foreign key (loan_wallet_id,space_id) references budget.wallets(id,space_id)
);
alter table budget.bill_payment_loan_identities enable row level security;
revoke all on budget.bill_payment_loan_identities from public,anon,authenticated,service_role;
create trigger bill_payment_loan_identities_append_only
  before update or delete or truncate on budget.bill_payment_loan_identities
  for each statement execute function budget.reject_mutation();
insert into budget.bill_payment_loan_identities(entry_id,space_id,loan_wallet_id)
select e.id,e.space_id,coalesce((select wl.wallet_id from budget.wallet_lines wl
  join budget.wallets w on w.id=wl.wallet_id where wl.entry_id=e.id and w.kind='loan' limit 1),b.loan_wallet_id)
from budget.entries e join budget.bills b on b.id=e.bill_id
where e.kind='loan_repay' and b.loan_wallet_id is not null;

create function budget.capture_bill_payment_loan_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind='loan_repay' and new.bill_id is not null then
    insert into budget.bill_payment_loan_identities(entry_id,space_id,loan_wallet_id)
      select new.id,new.space_id,b.loan_wallet_id from budget.bills b
      where b.id=new.bill_id and b.loan_wallet_id is not null;
  end if;
  return new;
end;
$$;
create trigger entries_capture_bill_payment_loan_identity after insert on budget.entries
for each row execute function budget.capture_bill_payment_loan_identity();
revoke all on function budget.capture_bill_payment_loan_identity() from public,anon,authenticated,service_role;

create function budget.entry_bill_link(p_entry uuid)
returns table (bill_id uuid, due_on date, link_version integer)
language sql stable set search_path = '' as $$
  select case when l.id is null then e.bill_id else l.bill_id end,
         case when l.id is null then e.bill_due_on else l.due_on end,
         coalesce(l.link_version, 0)
  from budget.entries e left join lateral (
    select x.* from budget.bill_payment_links x where x.entry_id = e.id order by x.link_version desc limit 1
  ) l on true where e.id = p_entry
$$;

create function budget.bill_payment_totals(p_bill uuid, p_due date)
returns table (paid_amount bigint, payment_count integer, entry_id uuid)
language sql stable set search_path = '' as $$
  select coalesce(sum(x.amount),0)::bigint, count(*)::integer, (array_agg(x.id order by x.created_at desc, x.id desc))[1]
  from (
    select e.id, e.created_at, -sum(wl.amount_minor)::bigint as amount
    from budget.entries e cross join lateral budget.entry_bill_link(e.id) l
    join budget.wallet_lines wl on wl.entry_id = e.id join budget.wallets w on w.id = wl.wallet_id and w.kind = 'cash'
    where l.bill_id = p_bill and l.due_on = p_due and e.kind <> 'reversal'
      and not exists (select 1 from budget.entries r where r.reverses_entry_id = e.id)
    group by e.id having -sum(wl.amount_minor) > 0
  ) x
$$;

create or replace function budget.bill_paid_entry(p_bill uuid, p_due date)
returns uuid language sql stable set search_path = '' as $$
  select t.entry_id from budget.bill_payment_totals(p_bill,p_due) t
$$;

create or replace function budget.require_bill_payable(
  p_space uuid, p_bill uuid, p_due date, p_item uuid, p_currency budget.currency, p_loan uuid default null)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_bill budget.bills%rowtype;
begin
  if p_bill is null then
    return;
  end if;
  select * into v_bill from budget.bills where id = p_bill and space_id = p_space and archived_at is null;
  if not found then
    perform budget.raise_budget('BUDGET_BILL_NOT_FOUND', jsonb_build_object('billId', p_bill));
  end if;
  if v_bill.item_id <> p_item or v_bill.currency <> p_currency or v_bill.loan_wallet_id is distinct from p_loan then
    perform budget.raise_budget('BUDGET_BILL_MISMATCH', jsonb_build_object('billId', p_bill));
  end if;
  if p_due is null or not exists (select 1 from budget.bill_due_dates(v_bill.cadence, v_bill.first_due_on, v_bill.end_on, p_due, p_due)) then
    perform budget.raise_budget('BUDGET_BILL_NOT_DUE', jsonb_build_object('billId', p_bill, 'dueOn', p_due));
  end if;
  if budget.bill_is_skipped(p_bill, p_due) then
    perform budget.raise_budget('BUDGET_BILL_SKIPPED', jsonb_build_object('billId', p_bill, 'dueOn', p_due));
  end if;
  if (select t.paid_amount from budget.bill_payment_totals(p_bill, p_due) t) >= v_bill.amount_minor then
    perform budget.raise_budget('BUDGET_BILL_ALREADY_PAID', jsonb_build_object('billId', p_bill, 'dueOn', p_due));
  end if;
end;
$$;

create or replace function public.skip_bill(p_space uuid, p_request uuid, p_bill uuid, p_due date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('bill', p_bill, 'due', p_due);
  v_replay jsonb := budget.begin_command(p_space, p_request, 'skip_bill', v_payload);
  v_bill budget.bills%rowtype;
begin
  if v_replay is not null then
    return v_replay;
  end if;
  select * into v_bill from budget.bills where id = p_bill and space_id = p_space and archived_at is null;
  if not found then
    perform budget.raise_budget('BUDGET_BILL_NOT_FOUND', jsonb_build_object('billId', p_bill));
  end if;
  if p_due is null or not exists (select 1 from budget.bill_due_dates(v_bill.cadence, v_bill.first_due_on, v_bill.end_on, p_due, p_due)) then
    perform budget.raise_budget('BUDGET_BILL_NOT_DUE', jsonb_build_object('billId', p_bill, 'dueOn', p_due));
  end if;
  if (select t.paid_amount from budget.bill_payment_totals(p_bill, p_due) t) >= v_bill.amount_minor then
    perform budget.raise_budget('BUDGET_BILL_ALREADY_PAID', jsonb_build_object('billId', p_bill, 'dueOn', p_due));
  end if;
  if not budget.bill_is_skipped(p_bill, p_due) then
    insert into budget.bill_skips (bill_id, space_id, due_on, skipped, created_by)
    values (p_bill, p_space, p_due, true, (select auth.uid()));
  end if;
  return budget.finish_command(p_space, p_request, 'skip_bill', v_payload, jsonb_build_object('billId', p_bill));
end;
$$;

create or replace function budget.bill_occurrences(p_space uuid, p_from date, p_to date)
returns table (
  bill_id uuid,
  name text,
  item_id uuid,
  currency budget.currency,
  expected bigint,
  due_on date,
  status text,
  paid_amount bigint,
  entry_id uuid,
  coverage text,
  short_by bigint,
  loan_wallet_id uuid,
  cadence text)
language sql
stable
set search_path = ''
as $$
  with today as (
    select budget.space_today(p_space) as d,
           (budget.month_start(budget.space_today(p_space)) + interval '1 month' - interval '1 day')::date as month_end
  ),
  occurrences as (
    select b.id as bill_id, b.name, b.item_id, b.currency, b.amount_minor as expected, d.due_on,
           b.loan_wallet_id, b.cadence, b.created_at,
           t.entry_id, t.paid_amount,
           budget.bill_is_skipped(b.id, d.due_on) as skipped
    from budget.bills b
    cross join lateral budget.bill_due_dates(b.cadence, b.first_due_on, b.end_on, greatest(b.first_due_on, p_from - 366), p_to) as d(due_on)
    cross join lateral budget.bill_payment_totals(b.id, d.due_on) t
    where b.space_id = p_space and b.archived_at is null
      and b.first_due_on <= p_to  -- a bill that starts later has nothing due yet
  ),
  visible as (
    select o.*,
           case
             when o.skipped then 'skipped'
             when o.paid_amount >= o.expected then 'paid'
             when o.paid_amount > 0 then 'part_paid'
             when o.due_on < (select d from today) then 'overdue'
             else 'due'
           end as status
    from occurrences o
    where o.due_on >= p_from or (o.paid_amount < o.expected and not o.skipped)
  ),
  open_due as (
    select v.*,
           sum(greatest(v.expected-v.paid_amount,0)) over (partition by v.item_id, v.currency order by v.due_on, v.created_at, v.bill_id rows unbounded preceding) as running,
           greatest(budget.item_balance(v.item_id, v.currency), 0) as balance
    from visible v
    where v.status in ('due', 'overdue', 'part_paid') and v.due_on <= (select month_end from today)
  )
  select v.bill_id, v.name, v.item_id, v.currency, v.expected, v.due_on, v.status,
         v.paid_amount,
         v.entry_id,
         case
           when od.bill_id is null then null
           when od.running <= od.balance then 'covered'
           when od.running - greatest(od.expected-od.paid_amount,0) < od.balance then 'short'
           else 'not_covered'
         end as coverage,
         case
           when od.bill_id is null or od.running <= od.balance then 0
           else least(greatest(od.expected-od.paid_amount,0), od.running - od.balance)
         end::bigint as short_by,
         v.loan_wallet_id, v.cadence
  from visible v
  left join open_due od on od.bill_id = v.bill_id and od.due_on = v.due_on
  order by v.due_on, v.created_at, v.bill_id
$$;

create or replace function public.bills_upcoming(p_space uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform budget.require_member(p_space);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    perform budget.raise_budget('BUDGET_INVALID_RANGE', jsonb_build_object('from', p_from, 'to', p_to));
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'billId', o.bill_id, 'name', o.name, 'itemId', o.item_id,
      'itemNameEn', i.name_en, 'itemNameAr', i.name_ar,
      'currency', o.currency, 'expected', o.expected::text, 'dueOn', o.due_on,
      'remaining', greatest(o.expected-o.paid_amount,0)::text,
      'overpaid', greatest(o.paid_amount-o.expected,0)::text,
      'paymentCount', (select t.payment_count from budget.bill_payment_totals(o.bill_id,o.due_on) t),
      'status', o.status, 'paidAmount', o.paid_amount::text, 'entryId', o.entry_id,
      'coverage', o.coverage, 'shortBy', o.short_by::text,
      'loanWalletId', o.loan_wallet_id, 'cadence', o.cadence) order by o.due_on, o.name)
    from budget.bill_occurrences(p_space, p_from, p_to) o
    join budget.items i on i.id = o.item_id), '[]'::jsonb);
end;
$$;

create or replace function budget.entry_json(p_entry uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'entryId', e.id,
    'kind', e.kind,
    'occurredOn', e.occurred_on,
    'createdAt', e.created_at,
    'memo', e.memo,
    'reversesEntryId', e.reverses_entry_id,
    'reversalReason', e.reversal_reason,
    'reversedByEntryId', (select r.id from budget.entries r where r.reverses_entry_id = e.id),
    'billId', l.bill_id,
    'billDueOn', l.due_on,
    'billName', (select b.name from budget.bills b where b.id = l.bill_id),
    'billPaymentLoanWalletId', coalesce((select wl.wallet_id from budget.wallet_lines wl join budget.wallets w on w.id=wl.wallet_id where wl.entry_id=e.id and w.kind='loan' limit 1),
      (select x.loan_wallet_id from budget.bill_payment_loan_identities x where x.entry_id=e.id)),
    'billLinkVersion', l.link_version,
    'billLinkHistory', coalesce((select jsonb_agg(jsonb_build_object(
      'billId', x.bill_id, 'billName', (select b.name from budget.bills b where b.id=x.bill_id),
      'dueOn', x.due_on, 'createdAt', x.created_at) order by x.link_version)
      from budget.bill_payment_links x where x.entry_id=e.id), '[]'::jsonb),
    'wallets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'walletId', w.id, 'name', w.name, 'kind', w.kind, 'currency', wl.currency,
        'amount', wl.amount_minor::text, 'flow', wl.flow) order by wl.id)
      from budget.wallet_lines wl join budget.wallets w on w.id = wl.wallet_id
      where wl.entry_id = e.id), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'itemId', i.id, 'kind', i.kind, 'nameEn', i.name_en, 'nameAr', i.name_ar, 'currency', il.currency,
        'amount', il.amount_minor::text, 'flow', il.flow) order by il.id)
      from budget.item_lines il join budget.items i on i.id = il.item_id
      where il.entry_id = e.id), '[]'::jsonb))
  from budget.entries e cross join lateral budget.entry_bill_link(e.id) l
  where e.id = p_entry
$$;

create function public.move_bill_payment(
  p_space uuid, p_request uuid, p_entry uuid, p_expected_version integer,
  p_bill uuid default null, p_due date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_payload jsonb := jsonb_build_object('entry',p_entry,'version',p_expected_version,'bill',p_bill,'due',p_due);
  v_replay jsonb := budget.begin_command(p_space,p_request,'move_bill_payment',v_payload);
  v_entry budget.entries%rowtype;
  v_link record;
  v_bill budget.bills%rowtype;
  v_currency budget.currency;
  v_amount bigint;
  v_loan uuid;
begin
  if v_replay is not null then return v_replay; end if;
  select * into v_entry from budget.entries where id=p_entry and space_id=p_space;
  if not found then perform budget.raise_budget('BUDGET_ENTRY_NOT_FOUND'); end if;
  if v_entry.kind not in ('expense','loan_repay') or exists (select 1 from budget.entries r where r.reverses_entry_id=p_entry) then
    perform budget.raise_budget('BUDGET_CANNOT_REVERSE');
  end if;
  select * into v_link from budget.entry_bill_link(p_entry);
  if p_expected_version is distinct from v_link.link_version then
    perform budget.raise_budget('BUDGET_BILL_LINK_CHANGED',jsonb_build_object('entryId',p_entry,'linkVersion',v_link.link_version));
  end if;
  if (p_bill is null) <> (p_due is null) then perform budget.raise_budget('BUDGET_BILL_NOT_DUE'); end if;
  if p_bill is not null then
    select * into v_bill from budget.bills where id=p_bill and space_id=p_space and archived_at is null;
    if not found then perform budget.raise_budget('BUDGET_BILL_NOT_FOUND'); end if;
    select wl.currency, -sum(wl.amount_minor) into v_currency,v_amount
      from budget.wallet_lines wl join budget.wallets w on w.id=wl.wallet_id
      where wl.entry_id=p_entry and w.kind='cash' group by wl.currency;
    select wl.wallet_id into v_loan from budget.wallet_lines wl join budget.wallets w on w.id=wl.wallet_id
      where wl.entry_id=p_entry and w.kind='loan';
    -- Interest/fee-only repayments use the immutable identity captured at birth.
    if v_entry.kind='loan_repay' and v_loan is null then
      select x.loan_wallet_id into v_loan from budget.bill_payment_loan_identities x where x.entry_id=p_entry;
    end if;
    if v_amount is null or v_amount <= 0 or v_currency <> v_bill.currency
      or v_loan is distinct from v_bill.loan_wallet_id
      or (v_entry.kind='loan_repay' and v_bill.loan_wallet_id is null)
      or not exists (select 1 from budget.item_lines il where il.entry_id=p_entry and il.item_id=v_bill.item_id and il.currency=v_bill.currency and il.amount_minor<0 and il.flow in ('spend','principal','interest','fee'))
      or exists (select 1 from budget.item_lines il join budget.items i on i.id=il.item_id where il.entry_id=p_entry and il.amount_minor<0 and il.flow in ('spend','principal','interest','fee') and i.kind<>'ready' and il.item_id<>v_bill.item_id)
    then perform budget.raise_budget('BUDGET_BILL_MISMATCH'); end if;
    if not exists (select 1 from budget.bill_due_dates(v_bill.cadence,v_bill.first_due_on,v_bill.end_on,p_due,p_due)) then
      perform budget.raise_budget('BUDGET_BILL_NOT_DUE');
    end if;
    if budget.bill_is_skipped(p_bill,p_due) then perform budget.raise_budget('BUDGET_BILL_SKIPPED'); end if;
    -- Exclude this payment if it is already at the requested destination.
    if (select t.paid_amount from budget.bill_payment_totals(p_bill,p_due) t)
       - (case when v_link.bill_id=p_bill and v_link.due_on=p_due then v_amount else 0 end) >= v_bill.amount_minor then
      perform budget.raise_budget('BUDGET_BILL_ALREADY_PAID');
    end if;
  end if;
  insert into budget.bill_payment_links(entry_id,space_id,link_version,bill_id,due_on,request_id,created_by)
    values(p_entry,p_space,v_link.link_version+1,p_bill,p_due,p_request,(select auth.uid()));
  return budget.finish_command(p_space,p_request,'move_bill_payment',v_payload,
    jsonb_build_object('entryId',p_entry,'billId',p_bill,'dueOn',p_due,'linkVersion',v_link.link_version+1));
end;
$$;
revoke all on function public.move_bill_payment(uuid,uuid,uuid,integer,uuid,date) from public,anon,service_role;
grant execute on function public.move_bill_payment(uuid,uuid,uuid,integer,uuid,date) to authenticated;
revoke all on function budget.entry_bill_link(uuid), budget.bill_payment_totals(uuid,date) from public,anon,authenticated,service_role;


create or replace function public.space_overview(p_space uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_month date;
  v_plan_currency budget.currency;
  v_ready uuid;
  v_currencies jsonb := '[]'::jsonb;
  v_alerts jsonb := '[]'::jsonb;
  v_currency budget.currency;
  v_cash bigint;
  v_ready_balance bigint;
  v_plan jsonb;
  v_rate jsonb;
  v_occurrence record;
  v_group record;
begin
  perform budget.require_member(p_space);
  v_today := budget.space_today(p_space);
  v_month := budget.month_start(v_today);
  v_ready := budget.ready_item(p_space);
  select plan_currency into v_plan_currency from budget.spaces where id = p_space;

  for v_currency in
    select c from unnest(enum_range(null::budget.currency)) as c
    where c = v_plan_currency or exists (select 1 from budget.wallets w where w.space_id = p_space and w.currency = c)
    order by c
  loop
    select coalesce(sum(wl.amount_minor), 0) into v_cash
    from budget.wallet_lines wl join budget.wallets w on w.id = wl.wallet_id
    where w.space_id = p_space and w.kind = 'cash' and wl.currency = v_currency;
    v_ready_balance := budget.item_balance(v_ready, v_currency);
    v_currencies := v_currencies || jsonb_build_array(jsonb_build_object(
      'currency', v_currency,
      'cashHeld', v_cash::text,
      'ready', v_ready_balance::text,
      'setAside', (v_cash - v_ready_balance)::text,
      'setAsideByGroup', coalesce((
        select jsonb_agg(jsonb_build_object('groupId', g.id, 'nameEn', g.name_en, 'nameAr', g.name_ar, 'amount', total::text) order by g.created_at)
        from (
          select i.group_id, sum(l.amount_minor) as total
          from budget.item_lines l join budget.items i on i.id = l.item_id
          where l.space_id = p_space and l.currency = v_currency and i.kind <> 'ready'
          group by i.group_id
          having sum(l.amount_minor) <> 0
        ) per_group
        join budget.plan_groups g on g.id = per_group.group_id), '[]'::jsonb),
      'wallets', coalesce((
        select jsonb_agg(jsonb_build_object('walletId', w.id, 'name', w.name, 'balance', budget.wallet_balance(w.id)::text) order by w.position, w.created_at)
        from budget.wallets w
        where w.space_id = p_space and w.kind = 'cash' and w.currency = v_currency and w.archived_at is null), '[]'::jsonb),
      'netWorth', (
        select jsonb_build_object(
          'cash', coalesce(sum(b.balance) filter (where b.kind = 'cash'), 0)::text,
          'investments', coalesce(sum(b.balance) filter (where b.kind = 'investment'), 0)::text,
          'owedToMe', coalesce(sum(b.balance) filter (where b.loan_direction = 'owed_to_me'), 0)::text,
          'iOwe', coalesce(-sum(b.balance) filter (where b.loan_direction = 'i_owe'), 0)::text,
          'total', coalesce(sum(b.balance), 0)::text)
        from (
          select w.kind, w.loan_direction, budget.wallet_balance(w.id) as balance
          from budget.wallets w where w.space_id = p_space and w.currency = v_currency
        ) b)));
    if v_ready_balance < 0 then
      v_alerts := v_alerts || jsonb_build_array(jsonb_build_object('kind', 'over_assigned', 'currency', v_currency, 'amount', (-v_ready_balance)::text));
    elsif v_ready_balance > 0 and v_currency <> v_plan_currency then
      v_alerts := v_alerts || jsonb_build_array(jsonb_build_object('kind', 'ready_unassigned', 'currency', v_currency, 'amount', v_ready_balance::text));
    end if;
  end loop;

  v_plan := budget.plan_totals(p_space, v_month);
  if (v_plan ->> 'ready')::bigint > 0 and (v_plan ->> 'stillToFund')::bigint > 0 then
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object('kind', 'ready_to_fund', 'currency', v_plan_currency,
      'amount', least((v_plan ->> 'ready')::bigint, (v_plan ->> 'stillToFund')::bigint)::text));
  elsif (v_plan ->> 'ready')::bigint > 0 then
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object('kind', 'ready_unassigned', 'currency', v_plan_currency, 'amount', v_plan ->> 'ready'));
  end if;

  for v_occurrence in
    select * from budget.bill_occurrences(p_space, v_today, (v_month + interval '1 month' - interval '1 day')::date)
    where status = 'overdue' or (status = 'part_paid' and due_on < v_today) or coverage in ('short', 'not_covered')
  loop
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'kind', case when v_occurrence.due_on < v_today then 'bill_overdue' else 'bill_short' end,
      'currency', v_occurrence.currency, 'amount', (case when v_occurrence.due_on < v_today then greatest(v_occurrence.expected-v_occurrence.paid_amount,0) else v_occurrence.short_by end)::text,
      'billId', v_occurrence.bill_id, 'name', v_occurrence.name, 'dueOn', v_occurrence.due_on, 'itemId', v_occurrence.item_id));
  end loop;

  for v_group in
    select per_group.group_id, g.name_en, g.name_ar, per_group.items_total - per_group.group_amount as over
    from (
      select l.group_id, l.group_amount, sum(l.planned_minor) filter (where l.item_kind <> 'flex') as items_total
      from budget.plan_lines(p_space, v_month) l group by l.group_id, l.group_amount
    ) per_group
    join budget.plan_groups g on g.id = per_group.group_id
    where per_group.items_total > per_group.group_amount
  loop
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object('kind', 'group_over', 'currency', v_plan_currency,
      'amount', v_group.over::text, 'groupId', v_group.group_id, 'nameEn', v_group.name_en, 'nameAr', v_group.name_ar));
  end loop;

  select jsonb_build_object('currency', r.currency, 'unitsPerUsd', trim(trailing '.' from trim(trailing '0' from r.units_per_usd::text)), 'effectiveOn', r.effective_on)
    into v_rate
  from budget.reference_rates r
  where r.space_id = p_space and r.currency = 'LBP' and r.effective_on <= v_today
  order by r.effective_on desc limit 1;

  return jsonb_build_object(
    'today', v_today,
    'month', v_month,
    'planCurrency', v_plan_currency,
    'currencies', v_currencies,
    'plan', v_plan,
    'alerts', v_alerts,
    'referenceRate', v_rate);
end;
$$;
