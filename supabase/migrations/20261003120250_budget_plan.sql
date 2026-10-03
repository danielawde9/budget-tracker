-- Budget v2 plan: intentions only. A plan never moves money; it sizes what
-- "Fund my plan" proposes.
--
-- Rules (spec §4.1, §4.2, §5.8):
--   * Group amount = expected income × group %, split exactly (split_by_bps).
--   * Items have fixed monthly amounts. The group's flexible item receives
--     group amount − Σ items (never below zero); a group whose items exceed
--     it is "over" and its flexible item gets nothing.
--   * A plan version applies from its month forward; earlier months keep
--     theirs.
--   * Funding fills what each item still needs this month (planned − funded,
--     net of releases), top to bottom: group order, item order, then the
--     group's flexible item.

create function budget.plan_version_for(p_space uuid, p_month date)
returns uuid
language sql
stable
set search_path = ''
as $$
  select id from budget.plan_versions
  where space_id = p_space and effective_month <= budget.month_start(p_month)
  order by effective_month desc
  limit 1
$$;

-- Every planned line for a month, in funding order. The flexible item of a
-- group is listed last (item_order 1000000) with its derived amount.
create function budget.plan_lines(p_space uuid, p_month date)
returns table (
  group_id uuid,
  group_position integer,
  percent_bps integer,
  group_amount bigint,
  item_id uuid,
  item_kind budget.item_kind,
  item_order integer,
  planned_minor bigint)
language sql
stable
set search_path = ''
as $$
  with version as (
    select v.id, v.expected_income_minor
    from budget.plan_versions v
    where v.id = budget.plan_version_for(p_space, p_month)
  ),
  groups as (
    select vg.group_id, vg.position, vg.percent_bps, row_number() over (order by vg.position) as rn
    from budget.plan_version_groups vg
    join version on vg.version_id = version.id
  ),
  amounts as (
    select budget.split_by_bps(
      version.expected_income_minor,
      coalesce((select array_agg(g.percent_bps order by g.position) from groups g), '{}')) as parts
    from version
  ),
  planned_groups as (
    select g.group_id, g.position, g.percent_bps, (select a.parts[g.rn] from amounts a) as amount
    from groups g
  ),
  planned_items as (
    select vi.group_id, vi.item_id, i.kind, vi.position as item_order, vi.monthly_minor
    from budget.plan_version_items vi
    join version on vi.version_id = version.id
    join budget.items i on i.id = vi.item_id
  ),
  flex as (
    select pg.group_id, f.id as item_id, f.kind, 1000000 as item_order,
           greatest(pg.amount - coalesce((select sum(pi.monthly_minor) from planned_items pi where pi.group_id = pg.group_id), 0), 0)::bigint as monthly_minor
    from planned_groups pg
    cross join lateral (
      select fi.id, fi.kind from budget.items fi
      where fi.group_id = pg.group_id and fi.kind = 'flex'
      order by fi.archived_at nulls first, fi.created_at
      limit 1
    ) f
  )
  select pg.group_id, pg.position, pg.percent_bps, pg.amount, x.item_id, x.kind, x.item_order, x.monthly_minor
  from planned_groups pg
  join (select * from planned_items union all select * from flex) x on x.group_id = pg.group_id
  order by pg.position, x.item_order
$$;

-- Σ of an item's lines with the given flows, dated in the calendar month.
create function budget.month_flow_total(p_item uuid, p_currency budget.currency, p_month date, p_flows budget.flow[])
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(l.amount_minor), 0)::bigint
  from budget.item_lines l
  join budget.entries e on e.id = l.entry_id
  where l.item_id = p_item
    and l.currency = p_currency
    and l.flow = any (p_flows)
    and e.occurred_on >= budget.month_start(p_month)
    and e.occurred_on < (budget.month_start(p_month) + interval '1 month')::date
$$;

create function budget.funded_net(p_item uuid, p_currency budget.currency, p_month date)
returns bigint
language sql
stable
set search_path = ''
as $$
  select budget.month_flow_total(p_item, p_currency, p_month, array['fund', 'release']::budget.flow[])
$$;

-- What "Fund my plan" proposes from the money available (default: what is in
-- Ready to assign). Only the plan's own currency is planned; other
-- currencies are assigned by hand.
create function public.funding_preview(p_space uuid, p_month date, p_currency text default null, p_amount bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan_currency budget.currency;
  v_currency budget.currency;
  v_available bigint;
  v_left bigint;
  v_need bigint;
  v_give bigint;
  v_unfunded bigint := 0;
  v_lines jsonb := '[]'::jsonb;
  v_line record;
begin
  perform budget.require_member(p_space);
  if p_month is null or (p_currency is not null and p_currency not in ('USD', 'LBP')) then
    perform budget.raise_budget('BUDGET_INVALID_PLAN');
  end if;
  select plan_currency into v_plan_currency from budget.spaces where id = p_space;
  v_currency := coalesce(p_currency, v_plan_currency::text)::budget.currency;
  if p_amount is not null then
    perform budget.require_amount(p_amount, true);
  end if;
  v_available := coalesce(p_amount, greatest(budget.item_balance(budget.ready_item(p_space), v_currency), 0));
  v_left := v_available;
  if v_currency = v_plan_currency then
    for v_line in
      select l.item_id, l.planned_minor
      from budget.plan_lines(p_space, p_month) l
      join budget.items i on i.id = l.item_id
      where i.archived_at is null
      order by l.group_position, l.item_order
    loop
      v_need := greatest(v_line.planned_minor - budget.funded_net(v_line.item_id, v_currency, p_month), 0);
      continue when v_need = 0;
      v_give := least(v_need, v_left);
      if v_give > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object('itemId', v_line.item_id, 'amountMinor', v_give::text));
        v_left := v_left - v_give;
      end if;
      v_unfunded := v_unfunded + (v_need - v_give);
    end loop;
  end if;
  return jsonb_build_object(
    'month', budget.month_start(p_month),
    'currency', v_currency,
    'available', v_available::text,
    'lines', v_lines,
    'unfunded', v_unfunded::text);
end;
$$;

-- Item archive: only an empty item without active bills.
create function budget.archive_item(p_space uuid, p_item uuid, p_after_month date)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_item budget.items%rowtype;
begin
  select * into v_item from budget.items where id = p_item and space_id = p_space;
  if not found or v_item.kind in ('ready', 'flex') then
    perform budget.raise_budget('BUDGET_INVALID_PLAN', jsonb_build_object('archiveItemId', p_item));
  end if;
  if exists (select 1 from budget.item_lines where item_id = p_item group by currency having sum(amount_minor) <> 0) then
    perform budget.raise_budget('BUDGET_ARCHIVE_NONZERO', budget.item_label(p_item));
  end if;
  if exists (select 1 from budget.bills where item_id = p_item and archived_at is null) then
    perform budget.raise_budget('BUDGET_ITEM_HAS_BILLS', budget.item_label(p_item));
  end if;
  update budget.items set archived_at = coalesce(archived_at, now()) where id = p_item;
  delete from budget.plan_version_items
  where item_id = p_item
    and version_id in (select id from budget.plan_versions where space_id = p_space and effective_month > p_after_month);
end;
$$;

create function budget.archive_group(p_space uuid, p_group uuid, p_after_month date)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_flex uuid;
begin
  if not exists (select 1 from budget.plan_groups where id = p_group and space_id = p_space and archived_at is null) then
    perform budget.raise_budget('BUDGET_INVALID_PLAN', jsonb_build_object('archiveGroupId', p_group));
  end if;
  if exists (select 1 from budget.items where group_id = p_group and kind <> 'flex' and archived_at is null) then
    perform budget.raise_budget('BUDGET_INVALID_PLAN', jsonb_build_object('archiveGroupId', p_group, 'reason', 'items'));
  end if;
  select id into v_flex from budget.items where group_id = p_group and kind = 'flex' and archived_at is null;
  if v_flex is not null and exists (
    select 1 from budget.item_lines where item_id = v_flex group by currency having sum(amount_minor) <> 0) then
    perform budget.raise_budget('BUDGET_ARCHIVE_NONZERO', budget.item_label(v_flex));
  end if;
  update budget.items set archived_at = now() where id = v_flex;
  update budget.plan_groups set archived_at = now() where id = p_group;
  delete from budget.plan_version_groups
  where group_id = p_group
    and version_id in (select id from budget.plan_versions where space_id = p_space and effective_month > p_after_month);
end;
$$;

-- Creates or updates one item from a plan payload and returns its id.
create function budget.upsert_plan_item(p_space uuid, p_group uuid, p_item jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_kind text := p_item ->> 'kind';
  v_id uuid := nullif(p_item ->> 'itemId', '')::uuid;
  v_name_en text := budget.clean_text(p_item ->> 'nameEn', 60);
  v_name_ar text := budget.clean_text(p_item ->> 'nameAr', 60);
  v_target bigint := nullif(p_item ->> 'targetMinor', '')::bigint;
  v_target_date date := nullif(p_item ->> 'targetDate', '')::date;
  v_wallet uuid := nullif(p_item ->> 'walletId', '')::uuid;
  v_existing budget.items%rowtype;
begin
  if jsonb_typeof(p_item) is distinct from 'object' or coalesce(v_kind, '') not in ('spending', 'reserve', 'goal', 'loan_payment') then
    perform budget.raise_budget('BUDGET_INVALID_PLAN', jsonb_build_object('item', p_item));
  end if;
  if v_name_en is null and v_name_ar is null then
    perform budget.raise_budget('BUDGET_INVALID_NAME', jsonb_build_object('item', p_item));
  end if;
  if (v_target is not null or v_target_date is not null) and v_kind not in ('reserve', 'goal') then
    perform budget.raise_budget('BUDGET_INVALID_PLAN', jsonb_build_object('item', p_item, 'reason', 'target'));
  end if;
  if v_target is not null then
    perform budget.require_amount(v_target);
  end if;
  if v_wallet is not null then
    if v_kind <> 'loan_payment' then
      perform budget.raise_budget('BUDGET_INVALID_PLAN', jsonb_build_object('item', p_item, 'reason', 'wallet'));
    end if;
    perform budget.wallet_of_kind(p_space, v_wallet, 'loan', 'i_owe');
  end if;

  if v_id is null then
    insert into budget.items (space_id, group_id, kind, name_en, name_ar, target_minor, target_date, wallet_id)
    values (p_space, p_group, v_kind::budget.item_kind, v_name_en, v_name_ar, v_target, v_target_date, v_wallet)
    returning id into v_id;
    return v_id;
  end if;

  select * into v_existing from budget.items where id = v_id and space_id = p_space;
  if not found or v_existing.archived_at is not null or v_existing.kind::text <> v_kind then
    perform budget.raise_budget('BUDGET_INVALID_PLAN', jsonb_build_object('item', p_item, 'reason', 'existing'));
  end if;
  update budget.items
     set group_id = p_group, name_en = v_name_en, name_ar = v_name_ar,
         target_minor = v_target, target_date = v_target_date, wallet_id = v_wallet
   where id = v_id;
  return v_id;
end;
$$;

-- Creates or updates one group (and its flexible item) and returns its id.
create function budget.upsert_plan_group(p_space uuid, p_group jsonb)
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
  if v_name_en is null and v_name_ar is null then
    perform budget.raise_budget('BUDGET_INVALID_NAME', jsonb_build_object('group', p_group ->> 'groupId'));
  end if;
  if v_id is null then
    insert into budget.plan_groups (space_id, name_en, name_ar) values (p_space, v_name_en, v_name_ar)
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
  update budget.plan_groups set name_en = v_name_en, name_ar = v_name_ar where id = v_id;
  if v_flex_en is not null or v_flex_ar is not null then
    update budget.items
       set name_en = coalesce(v_flex_en, name_en), name_ar = coalesce(v_flex_ar, name_ar)
     where group_id = v_id and kind = 'flex' and archived_at is null;
  end if;
  return v_id;
end;
$$;

-- Saves the complete plan for one month (it applies from that month on).
-- The payload lists every active group and every active item; anything
-- left out must be archived explicitly, so nothing disappears by accident.
create function public.save_plan(p_space uuid, p_request uuid, p_month date, p_expected_revision integer, p_plan jsonb)
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
    insert into budget.plan_version_groups (version_id, space_id, group_id, percent_bps, position)
    values (v_version, p_space, v_group_id, v_bps, v_group_position);

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

revoke all on all functions in schema budget from public, anon, authenticated, service_role;
revoke all on function public.save_plan(uuid, uuid, date, integer, jsonb) from public, anon, service_role;
revoke all on function public.funding_preview(uuid, date, text, bigint) from public, anon, service_role;
grant execute on function public.save_plan(uuid, uuid, date, integer, jsonb) to authenticated;
grant execute on function public.funding_preview(uuid, date, text, bigint) to authenticated;
