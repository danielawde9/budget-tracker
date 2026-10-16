-- Expenses/savings is a plan intention, versioned alongside each group share.
-- Existing ledger lines and balances are never rewritten.
create function budget.default_group_purpose(p_en text, p_ar text)
returns text language sql immutable set search_path = '' as $$
  select case when lower(trim(coalesce(p_en, ''))) in
    ('saving','savings','investment','investments','insurance','mazoot','mazout')
    or trim(coalesce(p_ar, '')) in ('الادخار','ادخار','التوفير','الاستثمار','الاستثمارات','التأمين','المازوت','مازوت')
    then 'savings' else 'expense' end
$$;
alter table budget.plan_version_groups add column purpose text not null default 'expense'
  check (purpose in ('expense','savings'));
update budget.plan_version_groups vg set purpose = budget.default_group_purpose(g.name_en,g.name_ar)
from budget.plan_groups g where g.id=vg.group_id;


-- Retain classification tombstones on the monthly version when its active
-- groups/items are replaced. Without these, archiving can resurrect an older
-- purpose or membership and silently change that month's actual expenses.
alter table budget.plan_versions
  add column group_purposes jsonb not null default '{}'::jsonb,
  add column item_groups jsonb not null default '{}'::jsonb;
update budget.plan_versions v set
  group_purposes=coalesce((select jsonb_object_agg(group_id::text,purpose) from budget.plan_version_groups where version_id=v.id),'{}'::jsonb),
  item_groups=coalesce((select jsonb_object_agg(item_id::text,group_id::text) from budget.plan_version_items where version_id=v.id),'{}'::jsonb);

-- Fallback for groups archived before this migration, whose old version rows
-- no longer exist. Normal reads use the monthly snapshots above.

alter table budget.plan_groups add column last_purpose text not null default 'expense'
  check (last_purpose in ('expense','savings'));
update budget.plan_groups g set last_purpose=coalesce((
  select vg.purpose from budget.plan_version_groups vg join budget.plan_versions v on v.id=vg.version_id
  where vg.group_id=g.id order by v.effective_month desc limit 1),budget.default_group_purpose(g.name_en,g.name_ar));

create function budget.remember_group_purpose()
returns trigger language plpgsql set search_path = '' as $$
begin
  update budget.plan_groups set last_purpose=new.purpose where id=new.group_id;
  update budget.plan_versions set group_purposes=group_purposes || jsonb_build_object(new.group_id::text,new.purpose) where id=new.version_id;
  return new;
end;
$$;
create trigger plan_groups_remember_purpose after insert or update of purpose on budget.plan_version_groups
for each row execute function budget.remember_group_purpose();

create function budget.remember_item_group()
returns trigger language plpgsql set search_path = '' as $$
begin
  update budget.plan_versions set item_groups=item_groups || jsonb_build_object(new.item_id::text,new.group_id::text) where id=new.version_id;
  return new;
end;
$$;
create trigger plan_items_remember_group after insert or update of group_id on budget.plan_version_items
for each row execute function budget.remember_item_group();

-- An item can move groups in a later plan. Earlier activity uses that earlier
-- version's membership, with the last recorded membership retained on archive.
create function budget.item_group_on(p_item uuid,p_on date)
returns uuid language sql stable set search_path = '' as $$
  select coalesce((select (v.item_groups->>i.id::text)::uuid from budget.plan_versions v
    where v.space_id=i.space_id and v.item_groups ? i.id::text and v.effective_month<=budget.month_start(p_on)
    order by v.effective_month desc limit 1),i.group_id)
  from budget.items i where i.id=p_item
$$;
create function budget.group_purpose_on(p_group uuid,p_on date)
returns text language sql stable set search_path = '' as $$
  select coalesce((select v.group_purposes->>g.id::text from budget.plan_versions v
    where v.space_id=g.space_id and v.group_purposes ? g.id::text and v.effective_month<=budget.month_start(p_on)
    order by v.effective_month desc limit 1),g.last_purpose)
  from budget.plan_groups g where g.id=p_group
$$;

create or replace function budget.seed_default_plan(p_space uuid, p_month date, p_income bigint, p_user uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_version uuid;
  v_group uuid;
  v_group_def jsonb;
  v_item_def jsonb;
  v_group_position integer := 0;
  v_item_position integer;
begin
  insert into budget.plan_versions (space_id, effective_month, expected_income_minor, updated_by)
  values (p_space, budget.month_start(p_month), p_income, p_user)
  returning id into v_version;

  for v_group_def in select value from jsonb_array_elements($json$[
    {"en":"Essentials","ar":"الأساسيات","bps":6000,"flexEn":"Other essentials","flexAr":"أساسيات أخرى","items":[
      {"kind":"spending","en":"Rent","ar":"الإيجار"},
      {"kind":"spending","en":"Bills","ar":"الفواتير"},
      {"kind":"spending","en":"Groceries","ar":"البقالة"},
      {"kind":"spending","en":"Transport","ar":"النقل"},
      {"kind":"reserve","en":"Insurance reserve","ar":"احتياطي التأمين"}]},
    {"en":"Guilt free","ar":"الإنفاق الحر","bps":500,"flexEn":"Other guilt-free","flexAr":"إنفاق حر آخر","items":[
      {"kind":"spending","en":"Eating out","ar":"الأكل خارج المنزل"},
      {"kind":"spending","en":"Fun","ar":"الترفيه"}]},
    {"en":"Short-term goals","ar":"الأهداف قصيرة المدى","bps":1500,"flexEn":"Goals money","flexAr":"مال الأهداف","items":[]},
    {"en":"Savings","ar":"الادخار","bps":1000,"flexEn":"General savings","flexAr":"ادخار عام","items":[]},
    {"en":"Investments","ar":"الاستثمار","bps":1000,"flexEn":"To invest","flexAr":"للاستثمار","items":[]}
  ]$json$::jsonb)
  loop
    insert into budget.plan_groups (space_id, name_en, name_ar)
    values (p_space, v_group_def ->> 'en', v_group_def ->> 'ar')
    returning id into v_group;
    insert into budget.items (space_id, group_id, kind, name_en, name_ar)
    values (p_space, v_group, 'flex', v_group_def ->> 'flexEn', v_group_def ->> 'flexAr');
    insert into budget.plan_version_groups (version_id, space_id, group_id, percent_bps, position, purpose)
    values (v_version, p_space, v_group, (v_group_def ->> 'bps')::integer, v_group_position, budget.default_group_purpose(v_group_def ->> 'en', v_group_def ->> 'ar'));
    v_item_position := 0;
    for v_item_def in select value from jsonb_array_elements(v_group_def -> 'items') loop
      with created as (
        insert into budget.items (space_id, group_id, kind, name_en, name_ar)
        values (p_space, v_group, (v_item_def ->> 'kind')::budget.item_kind, v_item_def ->> 'en', v_item_def ->> 'ar')
        returning id
      )
      insert into budget.plan_version_items (version_id, space_id, item_id, group_id, monthly_minor, position)
      select v_version, p_space, created.id, v_group, 0, v_item_position from created;
      v_item_position := v_item_position + 1;
    end loop;
    v_group_position := v_group_position + 1;
  end loop;
  return v_version;
end;
$$;

create or replace function public.save_plan(p_space uuid, p_request uuid, p_month date, p_expected_revision integer, p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('month', p_month, 'revision', p_expected_revision, 'plan', p_plan);
  v_replay jsonb := budget.begin_command(p_space, p_request, 'save_plan', v_payload);
  v_user uuid := (select auth.uid());
  v_month date;
  v_effective budget.plan_versions%rowtype;
  v_version uuid;
  v_revision integer;
  v_income bigint;
  v_group jsonb;
  v_item jsonb;
  v_group_id uuid;
  v_item_id uuid;
  v_bps integer;
  v_total_bps integer := 0;
  v_group_position integer := 0;
  v_item_position integer;
  v_seen_groups uuid[] := '{}';
  v_seen_items uuid[] := '{}';
  v_id uuid;
  v_purposes jsonb;
  v_purpose text;
begin
  if v_replay is not null then
    return v_replay;
  end if;
  if p_month is null or jsonb_typeof(p_plan) is distinct from 'object'
     or jsonb_typeof(p_plan -> 'groups') is distinct from 'array'
     or jsonb_array_length(p_plan -> 'groups') not between 1 and 12 then
    perform budget.raise_budget('BUDGET_INVALID_PLAN', jsonb_build_object('reason', 'shape'));
  end if;
  v_month := budget.month_start(p_month);
  v_income := (p_plan ->> 'expectedIncomeMinor')::bigint;
  perform budget.require_amount(v_income, true);

  select * into v_effective from budget.plan_versions
  where space_id = p_space and effective_month <= v_month
  order by effective_month desc limit 1;
  if p_expected_revision is distinct from v_effective.revision then
    perform budget.raise_budget('BUDGET_STALE_PLAN', jsonb_build_object('revision', v_effective.revision));
  end if;

  select coalesce(jsonb_object_agg(group_id::text,purpose),'{}'::jsonb) into v_purposes
  from budget.plan_version_groups where version_id=v_effective.id;

  update budget.plan_groups g set last_purpose=vg.purpose
  from budget.plan_version_groups vg where vg.group_id=g.id and vg.version_id=v_effective.id;

  for v_id in select value::uuid from jsonb_array_elements_text(coalesce(p_plan -> 'archiveItemIds', '[]'::jsonb)) loop
    perform budget.archive_item(p_space, v_id, v_month);
  end loop;
  for v_id in select value::uuid from jsonb_array_elements_text(coalesce(p_plan -> 'archiveGroupIds', '[]'::jsonb)) loop
    perform budget.archive_group(p_space, v_id, v_month);
  end loop;

  -- Revisions increase across the whole space, so a client holding an
  -- earlier month's revision can never match a newly created version.
  v_revision := (select coalesce(max(revision), 0) + 1 from budget.plan_versions where space_id = p_space);
  if v_effective.id is not null and v_effective.effective_month = v_month then
    v_version := v_effective.id;
    delete from budget.plan_version_groups where version_id = v_version;
    update budget.plan_versions
       set expected_income_minor = v_income, revision = v_revision, updated_by = v_user, updated_at = now()
     where id = v_version;
  else
    insert into budget.plan_versions (space_id, effective_month, expected_income_minor, revision, updated_by)
    values (p_space, v_month, v_income, v_revision, v_user)
    returning id into v_version;
  end if;

  for v_group in select value from jsonb_array_elements(p_plan -> 'groups') loop
    if jsonb_typeof(v_group) is distinct from 'object' or jsonb_typeof(v_group -> 'items') is distinct from 'array'
       or jsonb_array_length(v_group -> 'items') > 40 then
      perform budget.raise_budget('BUDGET_INVALID_PLAN', jsonb_build_object('reason', 'group shape'));
    end if;
    v_purpose := coalesce(v_group ->> 'purpose', v_purposes ->> (v_group ->> 'groupId'), budget.default_group_purpose(v_group ->> 'nameEn', v_group ->> 'nameAr'));
    if v_purpose not in ('expense','savings') then
      perform budget.raise_budget('BUDGET_INVALID_PLAN', jsonb_build_object('reason','purpose'));
    end if;
    v_bps := (v_group ->> 'percentBps')::integer;
    if v_bps is null or v_bps not between 0 and 10000 then
      perform budget.raise_budget('BUDGET_INVALID_PERCENT', jsonb_build_object('group', v_group ->> 'groupId'));
    end if;
    v_total_bps := v_total_bps + v_bps;
    v_group_id := budget.upsert_plan_group(p_space, v_group);
    if v_group_id = any (v_seen_groups) then
      perform budget.raise_budget('BUDGET_INVALID_PLAN', jsonb_build_object('reason', 'duplicate group'));
    end if;
    v_seen_groups := v_seen_groups || v_group_id;
    insert into budget.plan_version_groups (version_id, space_id, group_id, percent_bps, position, purpose)
    values (v_version, p_space, v_group_id, v_bps, v_group_position, v_purpose);

    v_item_position := 0;
    for v_item in select value from jsonb_array_elements(v_group -> 'items') loop
      v_item_id := budget.upsert_plan_item(p_space, v_group_id, v_item);
      if v_item_id = any (v_seen_items) then
        perform budget.raise_budget('BUDGET_INVALID_PLAN', jsonb_build_object('reason', 'duplicate item'));
      end if;
      v_seen_items := v_seen_items || v_item_id;
      perform budget.require_amount((v_item ->> 'monthlyMinor')::bigint, true);
      insert into budget.plan_version_items (version_id, space_id, item_id, group_id, monthly_minor, position)
      values (v_version, p_space, v_item_id, v_group_id, (v_item ->> 'monthlyMinor')::bigint, v_item_position);
      v_item_position := v_item_position + 1;
    end loop;
    v_group_position := v_group_position + 1;
  end loop;

  if v_total_bps > 10000 then
    perform budget.raise_budget('BUDGET_PLAN_OVER_100', jsonb_build_object('bps', v_total_bps));
  end if;
  if exists (select 1 from budget.plan_groups where space_id = p_space and archived_at is null and not (id = any (v_seen_groups))) then
    perform budget.raise_budget('BUDGET_INVALID_PLAN', jsonb_build_object('reason', 'missing group'));
  end if;
  if exists (select 1 from budget.items
             where space_id = p_space and archived_at is null and kind not in ('ready', 'flex')
               and not (id = any (v_seen_items))) then
    perform budget.raise_budget('BUDGET_INVALID_PLAN', jsonb_build_object('reason', 'missing item'));
  end if;
  return budget.finish_command(p_space, p_request, 'save_plan', v_payload,
    jsonb_build_object('versionId', v_version, 'revision', v_revision, 'effectiveMonth', v_month));
end;
$$;

create or replace function public.plan_month(p_space uuid, p_month date)
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
    select * from budget.plan_lines_for_view(p_space, v_month)
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
             'purpose', vg.purpose,
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
    join budget.plan_version_groups vg on vg.group_id = g.group_id and vg.version_id = coalesce(budget.plan_version_for(p_space,v_month), (select id from budget.plan_versions where space_id=p_space order by effective_month limit 1))
    left join item_json ij on ij.group_id = g.group_id
    group by g.group_position, g.group_id, g.percent_bps, g.group_amount, pg.name_en, pg.name_ar, vg.purpose
  )
  select coalesce(jsonb_agg(body order by group_position), '[]'::jsonb) into v_result from group_json;

  return budget.plan_totals(p_space, v_month) || jsonb_build_object(
    'today', v_today,
    'isCurrent', v_month = budget.month_start(v_today),
    'isPast', v_month < budget.month_start(v_today),
    'groups', v_result);
end;
$$;

create or replace function public.activity_page(p_space uuid, p_limit integer default 30, p_before jsonb default null, p_filter jsonb default '{}'::jsonb)
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
  v_group uuid := nullif(p_filter ->> 'groupId','')::uuid;
  v_purpose text := nullif(p_filter ->> 'purpose','');
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
  if (v_purpose is not null and v_purpose not in ('expense','savings')) or v_limit not between 1 and 100
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
      and ((v_group is null and v_purpose is null) or exists (
        select 1 from budget.item_lines il
        join budget.items i on i.id=il.item_id
        join budget.plan_groups g on g.id=budget.item_group_on(i.id,e.occurred_on)
        where il.entry_id=e.id and i.kind <> 'ready'
          and (v_group is null or g.id=v_group)
          and (v_purpose is null or budget.group_purpose_on(g.id,e.occurred_on)=v_purpose)))
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
        'itemId', i.id, 'kind', i.kind,
        'groupId', ig.id, 'groupNameEn', ig.name_en, 'groupNameAr', ig.name_ar,
        'purpose', budget.group_purpose_on(ig.id,e.occurred_on), 'nameEn', i.name_en, 'nameAr', i.name_ar, 'currency', il.currency,
        'amount', il.amount_minor::text, 'flow', il.flow) order by il.id)
      from budget.item_lines il join budget.items i on i.id = il.item_id
      left join budget.plan_groups ig on ig.id=budget.item_group_on(i.id,e.occurred_on)
      where il.entry_id = e.id), '[]'::jsonb))
  from budget.entries e cross join lateral budget.entry_bill_link(e.id) l
  where e.id = p_entry
$$;

-- Add only previously unrecorded opening money; this is never income/funding.
create function public.record_wallet_opening(p_space uuid, p_request uuid, p_wallet uuid, p_amount bigint, p_on date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_payload jsonb := jsonb_build_object('wallet',p_wallet,'amount',p_amount,'on',p_on);
  v_replay jsonb := budget.begin_command(p_space,p_request,'record_wallet_opening',v_payload);
  v_wallet budget.wallets%rowtype;
  v_entry uuid;
  v_amount bigint;
begin
  if v_replay is not null then return v_replay; end if;
  v_wallet := budget.active_wallet(p_space,p_wallet);
  perform budget.require_amount(p_amount);
  v_amount := case when v_wallet.kind='loan' and v_wallet.loan_direction='i_owe' then -p_amount else p_amount end;
  v_entry := budget.new_entry(p_space,p_request,
    case when v_wallet.kind='loan' then 'loan_opening' else 'opening_balance' end::budget.entry_kind,p_on,null);
  perform budget.add_wallet_line(v_entry,p_space,p_wallet,v_amount,'opening');
  if v_wallet.kind='cash' then
    perform budget.add_item_line(v_entry,p_space,budget.ready_item(p_space),v_wallet.currency,v_amount,'opening');
  end if;
  return budget.finish_command(p_space,p_request,'record_wallet_opening',v_payload,jsonb_build_object('entryId',v_entry));
end;
$$;
revoke all on function public.record_wallet_opening(uuid,uuid,uuid,bigint,date) from public,anon,service_role;
grant execute on function public.record_wallet_opening(uuid,uuid,uuid,bigint,date) to authenticated;
revoke all on all functions in schema budget from public,anon,authenticated,service_role;
notify pgrst, 'reload schema';
