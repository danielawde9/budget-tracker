-- Purpose is independent of a group's display name and item implementation kind.
-- This changes presentation/classification only: journal entries remain untouched.
alter table budget.plan_groups add column purpose text not null default 'spending'
  check (purpose in ('spending', 'saving', 'investment'));

-- Backfill the original default pools, including groups renamed by their owner.
-- Custom groups remain spending until their owner chooses a purpose in the editor.
update budget.plan_groups g set purpose = case
  when i.name_en = 'To invest' or i.name_ar = 'للاستثمار' then 'investment'
  else 'saving' end
from budget.items i
where i.group_id = g.id and i.kind = 'flex'
  and (i.name_en in ('General savings', 'Goals money', 'To invest')
    or i.name_ar in ('ادخار عام', 'مال الأهداف', 'للاستثمار'));

create or replace function budget.upsert_plan_group(p_space uuid, p_group jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_group ->> 'groupId', '')::uuid;
  v_name_en text := budget.clean_text(p_group ->> 'nameEn', 60);
  v_name_ar text := budget.clean_text(p_group ->> 'nameAr', 60);
  v_flex_en text := budget.clean_text(p_group ->> 'flexNameEn', 60);
  v_flex_ar text := budget.clean_text(p_group ->> 'flexNameAr', 60);
begin
  if p_group ? 'purpose' and coalesce(p_group ->> 'purpose', '') not in ('spending', 'saving', 'investment') then
    perform budget.raise_budget('BUDGET_INVALID_PLAN', jsonb_build_object('reason', 'purpose'));
  end if;
  if v_name_en is null and v_name_ar is null then
    perform budget.raise_budget('BUDGET_INVALID_NAME', jsonb_build_object('group', p_group ->> 'groupId'));
  end if;
  if v_id is null then
    insert into budget.plan_groups (space_id, name_en, name_ar, purpose) values (p_space, v_name_en, v_name_ar, coalesce(p_group ->> 'purpose', 'spending'))
    returning id into v_id;
    insert into budget.items (space_id, group_id, kind, name_en, name_ar)
    values (p_space, v_id, 'flex',
      coalesce(v_flex_en, left('Other ' || coalesce(v_name_en, v_name_ar), 60)),
      coalesce(v_flex_ar, left('أخرى في ' || coalesce(v_name_ar, v_name_en), 60)));
    return v_id;
  end if;
  if not exists (select 1 from budget.plan_groups where id = v_id and space_id = p_space and archived_at is null) then
    perform budget.raise_budget('BUDGET_INVALID_PLAN', jsonb_build_object('group', v_id, 'reason', 'existing'));
  end if;
  update budget.plan_groups set name_en = v_name_en, name_ar = v_name_ar, purpose = coalesce(p_group ->> 'purpose', purpose) where id = v_id;
  if v_flex_en is not null or v_flex_ar is not null then
    update budget.items
       set name_en = coalesce(v_flex_en, name_en), name_ar = coalesce(v_flex_ar, name_ar)
     where group_id = v_id and kind = 'flex' and archived_at is null;
  end if;
  return v_id;
end;
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
    {"purpose":"saving","en":"Short-term goals","ar":"الأهداف قصيرة المدى","bps":1500,"flexEn":"Goals money","flexAr":"مال الأهداف","items":[]},
    {"purpose":"saving","en":"Savings","ar":"الادخار","bps":1000,"flexEn":"General savings","flexAr":"ادخار عام","items":[]},
    {"purpose":"investment","en":"Investments","ar":"الاستثمار","bps":1000,"flexEn":"To invest","flexAr":"للاستثمار","items":[]}
  ]$json$::jsonb)
  loop
    insert into budget.plan_groups (space_id, name_en, name_ar, purpose)
    values (p_space, v_group_def ->> 'en', v_group_def ->> 'ar', coalesce(v_group_def ->> 'purpose', 'spending'))
    returning id into v_group;
    insert into budget.items (space_id, group_id, kind, name_en, name_ar)
    values (p_space, v_group, 'flex', v_group_def ->> 'flexEn', v_group_def ->> 'flexAr');
    insert into budget.plan_version_groups (version_id, space_id, group_id, percent_bps, position)
    values (v_version, p_space, v_group, (v_group_def ->> 'bps')::integer, v_group_position);
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
             'purpose', pg.purpose,
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
    group by g.group_position, g.group_id, g.percent_bps, g.group_amount, pg.name_en, pg.name_ar, pg.purpose
  )
  select coalesce(jsonb_agg(body order by group_position), '[]'::jsonb) into v_result from group_json;

  return budget.plan_totals(p_space, v_month) || jsonb_build_object(
    'stillToFund', (select coalesce(sum((i ->> 'stillToFund')::bigint), 0)::text from jsonb_array_elements(v_result) g cross join lateral jsonb_array_elements((g -> 'items') || case when g -> 'flex' = 'null'::jsonb then '[]'::jsonb else jsonb_build_array(g -> 'flex') end) i),
    'today', v_today,
    'isCurrent', v_month = budget.month_start(v_today),
    'isPast', v_month < budget.month_start(v_today),
    'groups', v_result);
end;
$$;
