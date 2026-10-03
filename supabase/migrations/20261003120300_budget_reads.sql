-- Budget v2 reads: every figure on every screen is a sum of journal lines.
-- No read stores or caches a balance, so two screens cannot disagree.
-- Amounts are returned as decimal strings of minor units.

-- ---------------------------------------------------------------------------
-- Building blocks
-- ---------------------------------------------------------------------------

-- One statement row per item and currency for a calendar month:
--   available = brought_forward + opening + funded + moved_in − moved_out
--             + covered_in − covered_out − spent − other_out + exchanged
create function budget.item_month_rows(p_space uuid, p_month date)
returns table (
  item_id uuid,
  currency budget.currency,
  brought_forward bigint,
  opening bigint,
  funded bigint,
  moved_in bigint,
  moved_out bigint,
  covered_in bigint,
  covered_out bigint,
  spent bigint,
  other_out bigint,
  exchanged bigint,
  available bigint)
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select budget.month_start(p_month) as s, (budget.month_start(p_month) + interval '1 month')::date as e
  ),
  lines as (
    select l.item_id, l.currency, l.amount_minor, l.flow, en.occurred_on,
           en.occurred_on >= b.s and en.occurred_on < b.e as in_month,
           en.occurred_on < b.s as before_month,
           en.occurred_on < b.e as by_month_end
    from budget.item_lines l
    join budget.entries en on en.id = l.entry_id
    cross join bounds b
    where l.space_id = p_space
  )
  select item_id, currency,
    coalesce(sum(amount_minor) filter (where before_month), 0)::bigint,
    coalesce(sum(amount_minor) filter (where in_month and flow = 'opening'), 0)::bigint,
    coalesce(sum(amount_minor) filter (where in_month and flow in ('fund', 'release')), 0)::bigint,
    coalesce(sum(amount_minor) filter (where in_month and flow = 'move' and amount_minor > 0), 0)::bigint,
    coalesce(-sum(amount_minor) filter (where in_month and flow = 'move' and amount_minor < 0), 0)::bigint,
    coalesce(sum(amount_minor) filter (where in_month and flow = 'cover' and amount_minor > 0), 0)::bigint,
    coalesce(-sum(amount_minor) filter (where in_month and flow = 'cover' and amount_minor < 0), 0)::bigint,
    coalesce(-sum(amount_minor) filter (where in_month and flow in ('spend', 'refund', 'interest', 'fee')), 0)::bigint,
    coalesce(-sum(amount_minor) filter (where in_month and flow in ('invest', 'principal', 'lend')), 0)::bigint,
    coalesce(sum(amount_minor) filter (where in_month and flow = 'exchange'), 0)::bigint,
    coalesce(sum(amount_minor) filter (where by_month_end), 0)::bigint
  from lines
  group by item_id, currency
$$;

create function budget.balances_json(p_item uuid, p_on date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'USD', budget.item_balance_on(p_item, 'USD', p_on)::text,
    'LBP', budget.item_balance_on(p_item, 'LBP', p_on)::text)
$$;

-- The plan-month headline figures (plan currency).
create function budget.plan_totals(p_space uuid, p_month date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_month date := budget.month_start(p_month);
  v_currency budget.currency;
  v_version budget.plan_versions%rowtype;
  v_ready uuid := budget.ready_item(p_space);
  v_groups_total bigint;
  v_over bigint;
  v_still bigint;
  v_received bigint;
  v_other_income bigint;
  v_funded bigint;
begin
  select plan_currency into v_currency from budget.spaces where id = p_space;
  select * into v_version from budget.plan_versions where id = budget.plan_version_for(p_space, v_month);

  select coalesce(sum(distinct_groups.group_amount), 0) into v_groups_total
  from (select distinct l.group_id, l.group_amount from budget.plan_lines(p_space, v_month) l) distinct_groups;

  select coalesce(sum(greatest(items_total - group_amount, 0)), 0) into v_over
  from (
    select l.group_id, l.group_amount, sum(l.planned_minor) filter (where l.item_kind <> 'flex') as items_total
    from budget.plan_lines(p_space, v_month) l
    group by l.group_id, l.group_amount
  ) per_group;

  select coalesce(sum(greatest(l.planned_minor - budget.funded_net(l.item_id, v_currency, v_month), 0)), 0) into v_still
  from budget.plan_lines(p_space, v_month) l
  join budget.items i on i.id = l.item_id
  where i.archived_at is null;

  v_received := budget.month_flow_total(v_ready, v_currency, v_month, array['income']::budget.flow[]);
  v_other_income := budget.month_flow_total(v_ready, v_currency, v_month, array['other_income']::budget.flow[]);
  select coalesce(sum(l.amount_minor), 0) into v_funded
  from budget.item_lines l
  join budget.entries e on e.id = l.entry_id
  join budget.items i on i.id = l.item_id
  where l.space_id = p_space and i.kind <> 'ready' and l.currency = v_currency and l.flow in ('fund', 'release')
    and e.occurred_on >= v_month and e.occurred_on < (v_month + interval '1 month')::date;

  return jsonb_build_object(
    'month', v_month,
    'planCurrency', v_currency,
    'versionId', v_version.id,
    'revision', v_version.revision,
    'effectiveMonth', v_version.effective_month,
    'expectedIncome', coalesce(v_version.expected_income_minor, 0)::text,
    'groupsTotal', v_groups_total::text,
    'notPlanned', (coalesce(v_version.expected_income_minor, 0) - v_groups_total)::text,
    'overPlanned', v_over::text,
    'received', v_received::text,
    'otherIncome', v_other_income::text,
    'funded', v_funded::text,
    'stillToFund', v_still::text,
    'ready', budget.item_balance(v_ready, v_currency)::text);
end;
$$;

-- Bill occurrences in [p_from, p_to] plus unpaid ones up to 92 days overdue,
-- with coverage for unpaid occurrences due by the end of the current month.
create function budget.bill_occurrences(p_space uuid, p_from date, p_to date)
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
           budget.bill_paid_entry(b.id, d.due_on) as entry_id,
           exists (select 1 from budget.bill_skips s where s.bill_id = b.id and s.due_on = d.due_on) as skipped
    from budget.bills b
    cross join lateral budget.bill_due_dates(b.cadence, b.first_due_on, b.end_on, greatest(b.first_due_on, p_from - 92), p_to) as d(due_on)
    where b.space_id = p_space and b.archived_at is null
  ),
  visible as (
    select o.*,
           case
             when o.entry_id is not null then 'paid'
             when o.skipped then 'skipped'
             when o.due_on < (select d from today) then 'overdue'
             else 'due'
           end as status
    from occurrences o
    where o.due_on >= p_from or (o.entry_id is null and not o.skipped)
  ),
  open_due as (
    select v.*,
           sum(v.expected) over (partition by v.item_id, v.currency order by v.due_on, v.created_at, v.bill_id rows unbounded preceding) as running,
           greatest(budget.item_balance(v.item_id, v.currency), 0) as balance
    from visible v
    where v.status in ('due', 'overdue') and v.due_on <= (select month_end from today)
  )
  select v.bill_id, v.name, v.item_id, v.currency, v.expected, v.due_on, v.status,
         coalesce((
           select -sum(wl.amount_minor) from budget.wallet_lines wl join budget.wallets w on w.id = wl.wallet_id
           where wl.entry_id = v.entry_id and w.kind = 'cash'), 0)::bigint as paid_amount,
         v.entry_id,
         case
           when od.bill_id is null then null
           when od.running <= od.balance then 'covered'
           when od.running - od.expected < od.balance then 'short'
           else 'not_covered'
         end as coverage,
         case
           when od.bill_id is null or od.running <= od.balance then 0
           else least(od.expected, od.running - od.balance)
         end::bigint as short_by,
         v.loan_wallet_id, v.cadence
  from visible v
  left join open_due od on od.bill_id = v.bill_id and od.due_on = v.due_on
  order by v.due_on, v.created_at, v.bill_id
$$;

create function budget.entry_json(p_entry uuid)
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
    'billId', e.bill_id,
    'billDueOn', e.bill_due_on,
    'billName', (select b.name from budget.bills b where b.id = e.bill_id),
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
  from budget.entries e
  where e.id = p_entry
$$;

-- ---------------------------------------------------------------------------
-- Public reads
-- ---------------------------------------------------------------------------

create function public.my_spaces()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'role', m.role,
    'timezone', s.timezone,
    'planCurrency', s.plan_currency,
    'today', budget.space_today(s.id),
    'currentMonth', budget.month_start(budget.space_today(s.id))) order by s.created_at), '[]'::jsonb)
  from budget.space_members m
  join budget.spaces s on s.id = m.space_id
  where m.user_id = (select auth.uid())
$$;

create function public.space_overview(p_space uuid)
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
    where status = 'overdue' or coverage in ('short', 'not_covered')
  loop
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'kind', case when v_occurrence.status = 'overdue' then 'bill_overdue' else 'bill_short' end,
      'currency', v_occurrence.currency, 'amount', v_occurrence.short_by::text,
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

create function public.plan_month(p_space uuid, p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month date;
  v_today date;
  v_currency budget.currency;
  v_until date;
  v_result jsonb;
begin
  perform budget.require_member(p_space);
  if p_month is null then
    perform budget.raise_budget('BUDGET_INVALID_DATE');
  end if;
  v_month := budget.month_start(p_month);
  v_today := budget.space_today(p_space);
  v_until := least((v_month + interval '1 month' - interval '1 day')::date, greatest(v_today, v_month));
  select plan_currency into v_currency from budget.spaces where id = p_space;

  with lines as (
    select * from budget.plan_lines(p_space, v_month)
  ),
  rows as (
    select * from budget.item_month_rows(p_space, v_month) r where r.currency = v_currency
  ),
  groups as (
    select distinct l.group_id, l.group_position, l.percent_bps, l.group_amount from lines l
  ),
  candidate_items as (
    select l.group_id, l.item_id, l.item_kind, l.item_order, l.planned_minor, true as in_plan from lines l
    union all
    select i.group_id, i.id, i.kind, 2000000, 0, false
    from budget.items i
    join groups g on g.group_id = i.group_id
    where i.space_id = p_space and i.archived_at is null and i.kind not in ('ready', 'flex')
      and not exists (select 1 from lines l where l.item_id = i.id)
  ),
  item_json as (
    select c.group_id, c.item_kind, c.item_order, i.name_en,
           c.planned_minor,
           coalesce(r.funded, 0) as funded,
           coalesce(r.spent, 0) as spent,
           coalesce(r.other_out, 0) as other_out,
           coalesce(r.available, 0) as available,
           jsonb_build_object(
             'itemId', i.id, 'kind', i.kind, 'nameEn', i.name_en, 'nameAr', i.name_ar,
             'inPlan', c.in_plan,
             'planned', c.planned_minor::text,
             'stillToFund', greatest(c.planned_minor - coalesce(r.funded, 0), 0)::text,
             'broughtForward', coalesce(r.brought_forward, 0)::text,
             'opening', coalesce(r.opening, 0)::text,
             'funded', coalesce(r.funded, 0)::text,
             'movedIn', coalesce(r.moved_in, 0)::text,
             'movedOut', coalesce(r.moved_out, 0)::text,
             'coveredIn', coalesce(r.covered_in, 0)::text,
             'coveredOut', coalesce(r.covered_out, 0)::text,
             'spent', coalesce(r.spent, 0)::text,
             'otherOut', coalesce(r.other_out, 0)::text,
             'exchanged', coalesce(r.exchanged, 0)::text,
             'available', coalesce(r.available, 0)::text,
             'balances', budget.balances_json(i.id, v_until),
             'targetMinor', i.target_minor::text,
             'targetDate', i.target_date,
             'walletId', i.wallet_id) as body
    from candidate_items c
    join budget.items i on i.id = c.item_id
    left join rows r on r.item_id = c.item_id
  ),
  group_json as (
    select g.group_position,
           jsonb_build_object(
             'groupId', g.group_id, 'nameEn', pg.name_en, 'nameAr', pg.name_ar,
             'percentBps', g.percent_bps,
             'planned', g.group_amount::text,
             'itemsPlanned', coalesce(sum(ij.planned_minor) filter (where ij.item_kind <> 'flex'), 0)::text,
             'over', greatest(coalesce(sum(ij.planned_minor) filter (where ij.item_kind <> 'flex'), 0) - g.group_amount, 0)::text,
             'funded', coalesce(sum(ij.funded), 0)::text,
             'spent', coalesce(sum(ij.spent), 0)::text,
             'otherOut', coalesce(sum(ij.other_out), 0)::text,
             'available', coalesce(sum(ij.available), 0)::text,
             'items', coalesce(jsonb_agg(ij.body order by ij.item_order, ij.name_en) filter (where ij.item_kind <> 'flex'), '[]'::jsonb),
             'flex', (jsonb_agg(ij.body) filter (where ij.item_kind = 'flex')) -> 0) as body
    from groups g
    join budget.plan_groups pg on pg.id = g.group_id
    left join item_json ij on ij.group_id = g.group_id
    group by g.group_position, g.group_id, g.percent_bps, g.group_amount, pg.name_en, pg.name_ar
  )
  select coalesce(jsonb_agg(body order by group_position), '[]'::jsonb) into v_result from group_json;

  return budget.plan_totals(p_space, v_month) || jsonb_build_object(
    'today', v_today,
    'isCurrent', v_month = budget.month_start(v_today),
    'isPast', v_month < budget.month_start(v_today),
    'groups', v_result);
end;
$$;

create function public.item_statement(p_space uuid, p_item uuid, p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item budget.items%rowtype;
  v_month date;
  v_until date;
  v_rows jsonb;
  v_entries jsonb;
begin
  perform budget.require_member(p_space);
  select * into v_item from budget.items where id = p_item and space_id = p_space;
  if not found or p_month is null then
    perform budget.raise_budget('BUDGET_ITEM_NOT_FOUND', jsonb_build_object('itemId', p_item));
  end if;
  v_month := budget.month_start(p_month);
  v_until := least((v_month + interval '1 month' - interval '1 day')::date, greatest(budget.space_today(p_space), v_month));
  select coalesce(jsonb_agg(jsonb_build_object(
      'currency', r.currency, 'broughtForward', r.brought_forward::text, 'opening', r.opening::text,
      'funded', r.funded::text, 'movedIn', r.moved_in::text, 'movedOut', r.moved_out::text,
      'coveredIn', r.covered_in::text, 'coveredOut', r.covered_out::text, 'spent', r.spent::text,
      'otherOut', r.other_out::text, 'exchanged', r.exchanged::text, 'available', r.available::text) order by r.currency), '[]'::jsonb)
    into v_rows
  from budget.item_month_rows(p_space, v_month) r
  where r.item_id = p_item;
  select coalesce(jsonb_agg(budget.entry_json(x.id) order by x.occurred_on desc, x.created_at desc), '[]'::jsonb)
    into v_entries
  from (
    select distinct e.id, e.occurred_on, e.created_at
    from budget.entries e
    join budget.item_lines l on l.entry_id = e.id
    where l.item_id = p_item
      and e.occurred_on >= v_month and e.occurred_on < (v_month + interval '1 month')::date
    order by e.occurred_on desc, e.created_at desc
    limit 200
  ) x;
  return jsonb_build_object(
    'item', jsonb_build_object('itemId', v_item.id, 'kind', v_item.kind, 'nameEn', v_item.name_en, 'nameAr', v_item.name_ar,
      'groupId', v_item.group_id, 'targetMinor', v_item.target_minor::text, 'targetDate', v_item.target_date,
      'archived', v_item.archived_at is not null),
    'month', v_month,
    'balances', budget.balances_json(p_item, v_until),
    'statement', v_rows,
    'entries', v_entries);
end;
$$;

create function public.activity_page(p_space uuid, p_limit integer default 30, p_before jsonb default null, p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := coalesce(p_limit, 30);
  v_wallet uuid := nullif(p_filter ->> 'walletId', '')::uuid;
  v_item uuid := nullif(p_filter ->> 'itemId', '')::uuid;
  v_kind text := nullif(p_filter ->> 'kind', '');
  v_month date := budget.month_start(nullif(p_filter ->> 'month', '')::date);
  v_before_on date := nullif(p_before ->> 'occurredOn', '')::date;
  v_before_at timestamptz := nullif(p_before ->> 'createdAt', '')::timestamptz;
  v_before_id uuid := nullif(p_before ->> 'id', '')::uuid;
  v_ids uuid[];
  v_last budget.entries%rowtype;
  v_entries jsonb;
begin
  perform budget.require_member(p_space);
  if v_limit not between 1 and 100
     or (v_kind is not null and v_kind not in (select unnest(enum_range(null::budget.entry_kind))::text))
     or ((v_before_on is null) <> (v_before_at is null) or (v_before_on is null) <> (v_before_id is null)) then
    perform budget.raise_budget('BUDGET_INVALID_FILTER');
  end if;
  select array_agg(id order by occurred_on desc, created_at desc, id desc) into v_ids
  from (
    select e.id, e.occurred_on, e.created_at
    from budget.entries e
    where e.space_id = p_space
      and (v_kind is null or e.kind::text = v_kind)
      and (v_month is null or (e.occurred_on >= v_month and e.occurred_on < (v_month + interval '1 month')::date))
      and (v_wallet is null or exists (select 1 from budget.wallet_lines wl where wl.entry_id = e.id and wl.wallet_id = v_wallet))
      and (v_item is null or exists (select 1 from budget.item_lines il where il.entry_id = e.id and il.item_id = v_item))
      and (v_before_on is null or (e.occurred_on, e.created_at, e.id) < (v_before_on, v_before_at, v_before_id))
    order by e.occurred_on desc, e.created_at desc, e.id desc
    limit v_limit + 1
  ) page;
  v_ids := coalesce(v_ids, '{}');
  select coalesce(jsonb_agg(budget.entry_json(id) order by ord), '[]'::jsonb) into v_entries
  from unnest(v_ids[1:v_limit]) with ordinality as t(id, ord);
  if cardinality(v_ids) > v_limit then
    select * into v_last from budget.entries where id = v_ids[v_limit];
    return jsonb_build_object('entries', v_entries,
      'next', jsonb_build_object('occurredOn', v_last.occurred_on, 'createdAt', v_last.created_at, 'id', v_last.id));
  end if;
  return jsonb_build_object('entries', v_entries, 'next', null);
end;
$$;

create function public.accounts_overview(p_space uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform budget.require_member(p_space);
  return (
    select jsonb_build_object('wallets', coalesce(jsonb_agg(jsonb_build_object(
        'id', w.id, 'name', w.name, 'kind', w.kind, 'currency', w.currency,
        'balance', budget.wallet_balance(w.id)::text,
        'archived', w.archived_at is not null,
        'loanDirection', w.loan_direction,
        'counterparty', w.counterparty,
        'contributed', case when w.kind = 'investment' then (
          select coalesce(sum(wl.amount_minor), 0)::text from budget.wallet_lines wl
          where wl.wallet_id = w.id and wl.flow in ('opening', 'invest', 'withdraw')) end,
        'gain', case when w.kind = 'investment' then (
          select coalesce(sum(wl.amount_minor), 0)::text from budget.wallet_lines wl
          where wl.wallet_id = w.id and wl.flow in ('value', 'fee', 'other_income')) end)
        order by w.kind, w.position, w.created_at), '[]'::jsonb))
    from budget.wallets w
    where w.space_id = p_space);
end;
$$;

create function public.bills_upcoming(p_space uuid, p_from date, p_to date)
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
      'status', o.status, 'paidAmount', o.paid_amount::text, 'entryId', o.entry_id,
      'coverage', o.coverage, 'shortBy', o.short_by::text,
      'loanWalletId', o.loan_wallet_id, 'cadence', o.cadence) order by o.due_on, o.name)
    from budget.bill_occurrences(p_space, p_from, p_to) o
    join budget.items i on i.id = o.item_id), '[]'::jsonb);
end;
$$;

create function public.bills_list(p_space uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform budget.require_member(p_space);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'billId', b.id, 'name', b.name, 'itemId', b.item_id, 'amount', b.amount_minor::text, 'currency', b.currency,
      'cadence', b.cadence, 'firstDueOn', b.first_due_on, 'endOn', b.end_on, 'loanWalletId', b.loan_wallet_id)
      order by b.name), '[]'::jsonb)
    from budget.bills b
    where b.space_id = p_space and b.archived_at is null);
end;
$$;

revoke all on all functions in schema budget from public, anon, authenticated, service_role;

revoke all on function public.my_spaces() from public, anon, service_role;
revoke all on function public.space_overview(uuid) from public, anon, service_role;
revoke all on function public.plan_month(uuid, date) from public, anon, service_role;
revoke all on function public.item_statement(uuid, uuid, date) from public, anon, service_role;
revoke all on function public.activity_page(uuid, integer, jsonb, jsonb) from public, anon, service_role;
revoke all on function public.accounts_overview(uuid) from public, anon, service_role;
revoke all on function public.bills_upcoming(uuid, date, date) from public, anon, service_role;
revoke all on function public.bills_list(uuid) from public, anon, service_role;

grant execute on function public.my_spaces() to authenticated;
grant execute on function public.space_overview(uuid) to authenticated;
grant execute on function public.plan_month(uuid, date) to authenticated;
grant execute on function public.item_statement(uuid, uuid, date) to authenticated;
grant execute on function public.activity_page(uuid, integer, jsonb, jsonb) to authenticated;
grant execute on function public.accounts_overview(uuid) to authenticated;
grant execute on function public.bills_upcoming(uuid, date, date) to authenticated;
grant execute on function public.bills_list(uuid) to authenticated;
