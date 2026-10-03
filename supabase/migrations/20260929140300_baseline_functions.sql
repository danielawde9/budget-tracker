-- Baseline part 5 of 9: functions. Final schema exported from the original 61 migrations; apply in filename order to an empty database only.
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: active_household_invitation_key_version(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.active_household_invitation_key_version() RETURNS smallint
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_key_version smallint;
begin
  select keyring.key_version
  into v_key_version
  from private.household_invitation_keys as keyring
  where keyring.retired_at is null;

  if not found then
    raise exception using errcode = '55000', message = 'invitation_key_unavailable';
  end if;

  return v_key_version;
end;
$$;


ALTER FUNCTION private.active_household_invitation_key_version() OWNER TO postgres;

--
-- Name: allocate_planning_income(text, jsonb); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.allocate_planning_income(p_income text, p_groups jsonb) RETURNS TABLE(group_id uuid, target_minor bigint, is_residual boolean)
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog'
    AS $_$
declare v_income bigint; v_entry jsonb; v_id uuid; v_order integer; v_bps integer;
  v_ids uuid[] := '{}'; v_orders integer[] := '{}'; v_sum integer := 0;
begin
  v_income := private.planning_minor(p_income);
  if p_groups is null or jsonb_typeof(p_groups) is distinct from 'array'
    or octet_length(p_groups::text)>65536 then
    raise exception using errcode='22023',message='planning_invalid_input';
  end if;
  if jsonb_array_length(p_groups)>12 then
    raise exception using errcode='22023',message='planning_invalid_input';
  end if;
  for v_entry in select value from jsonb_array_elements(p_groups) loop
    if jsonb_typeof(v_entry) is distinct from 'object' then
      raise exception using errcode='22023',message='planning_invalid_input';
    end if;
    if (v_entry ?& array['id','order','basisPoints']) is not true
      or (v_entry - array['id','order','basisPoints']) <> '{}'::jsonb
      or jsonb_typeof(v_entry->'id') is distinct from 'string'
      or jsonb_typeof(v_entry->'order') is distinct from 'number'
      or jsonb_typeof(v_entry->'basisPoints') is distinct from 'number'
      or (v_entry->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (v_entry->>'order') !~ '^(0|[1-9][0-9]?)$'
      or (v_entry->>'basisPoints') !~ '^(0|[1-9][0-9]{0,4})$' then
      raise exception using errcode='22023',message='planning_invalid_input';
    end if;
    v_id := (v_entry->>'id')::uuid;
    v_order := (v_entry->>'order')::integer;
    v_bps := (v_entry->>'basisPoints')::integer;
    if v_id='ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid or v_id=any(v_ids)
      or v_order=any(v_orders) or v_order>11 or v_bps>10000 then
      raise exception using errcode='22023',message='planning_invalid_input';
    end if;
    v_ids := array_append(v_ids,v_id); v_orders := array_append(v_orders,v_order);
    v_sum := v_sum+v_bps;
  end loop;
  if v_sum>10000 then
    raise exception using errcode='22023',message='planning_invalid_input';
  end if;
  return query
  with weights as (
    select (e->>'id')::uuid gid,(e->>'order')::integer ord,
      (e->>'basisPoints')::integer bps,false residual
    from jsonb_array_elements(p_groups) e
    union all select 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,12,10000-v_sum,true
  ), parts as (
    select *,floor(v_income::numeric*bps/10000) base,
      mod(v_income::numeric*bps,10000) fraction from weights
  ), ranked as (
    select *,row_number() over(order by fraction desc,ord,gid) rnk,
      v_income::numeric-sum(base) over() extra from parts
  )
  select gid,(base+case when rnk<=extra then 1 else 0 end)::bigint,residual
  from ranked order by ord,gid;
end; $_$;


ALTER FUNCTION private.allocate_planning_income(p_income text, p_groups jsonb) OWNER TO postgres;

--
-- Name: allocation_snapshot_carry(bigint); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.allocation_snapshot_carry(p_snapshot_id bigint) RETURNS TABLE(root_id uuid, group_id uuid, carry_minor numeric, source_close_id bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select link.root_id, snapshot_root.group_id, link.carry_minor, link.source_close_id
  from public.budget_month_carry_links link
  join public.allocation_month_roots snapshot_root
    on snapshot_root.snapshot_id = link.target_snapshot_id and snapshot_root.category_id = link.root_id
  where link.target_snapshot_id = p_snapshot_id;
$$;


ALTER FUNCTION private.allocation_snapshot_carry(p_snapshot_id bigint) OWNER TO postgres;

--
-- Name: allocation_snapshot_carry_needs_review(bigint); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.allocation_snapshot_carry_needs_review(p_snapshot_id bigint) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_snapshot public.allocation_month_snapshots%rowtype;
  v_latest_close bigint;
  v_linked_close bigint;
begin
  select * into v_snapshot from public.allocation_month_snapshots where id = p_snapshot_id;
  if not found then
    return false;
  end if;
  select id into v_latest_close from public.budget_month_closes
    where space_id = v_snapshot.space_id and currency = v_snapshot.currency
      and month_start = (v_snapshot.month_start - interval '1 month')::date
    order by id desc limit 1;
  if v_latest_close is null then
    return false;
  end if;
  select max(link.source_close_id) into v_linked_close
    from public.budget_month_carry_links link where link.target_snapshot_id = p_snapshot_id;
  if v_linked_close is not null and v_linked_close <> v_latest_close then
    return true;
  end if;
  return exists (
    with expected as (
      select close_root.root_id, close_root.outgoing_carry_minor as carry_minor
      from public.budget_month_close_roots close_root
      join public.categories category
        on category.id = close_root.root_id and category.space_id = close_root.space_id and category.archived_at is null
      where close_root.close_id = v_latest_close and close_root.enabled and close_root.outgoing_carry_minor <> 0
    ), linked as (
      select link.root_id, link.carry_minor from public.budget_month_carry_links link
      where link.target_snapshot_id = p_snapshot_id and link.carry_minor <> 0
    )
    (select * from expected except select * from linked)
    union all
    (select * from linked except select * from expected)
  );
end;
$$;


ALTER FUNCTION private.allocation_snapshot_carry_needs_review(p_snapshot_id bigint) OWNER TO postgres;

--
-- Name: assert_space_membership_invariant(uuid); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.assert_space_membership_invariant(p_space_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_kind public.space_kind;
  v_membership_count integer;
  v_active_owner_count integer;
begin
  select space.kind
  into v_kind
  from public.spaces as space
  where space.id = p_space_id
  for update;

  if not found then
    return;
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where membership.status = 'active' and membership.role = 'owner'
    )::integer
  into v_membership_count, v_active_owner_count
  from public.space_memberships as membership
  where membership.space_id = p_space_id;

  if v_kind = 'personal'
    and not (v_membership_count = 1 and v_active_owner_count = 1) then
    raise exception using
      errcode = '23514',
      message = 'personal space membership invariant violated';
  end if;

  if v_kind = 'household' and v_active_owner_count < 1 then
    raise exception using
      errcode = '23514',
      message = 'household must retain an active owner';
  end if;
end;
$$;


ALTER FUNCTION private.assert_space_membership_invariant(p_space_id uuid) OWNER TO postgres;

--
-- Name: budget_month_close_facts(uuid, public.currency_code, date, bigint, integer); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.budget_month_close_facts(p_space_id uuid, p_currency public.currency_code, p_month date, p_snapshot_id bigint, p_fact_cap integer) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_next_month date;
  v_count bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_currency is null or p_month is null or p_snapshot_id is null
    or p_fact_cap is null or p_fact_cap < 0 or p_month <> date_trunc('month', p_month)::date then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_next_month := (p_month + interval '1 month')::date;

  -- Cheap early refusal before building the digest input.
  select count(*) into v_count
  from public.financial_events event
  join public.wallet_movements movement on movement.event_id = event.id and movement.space_id = event.space_id
  join public.wallets wallet on wallet.id = movement.wallet_id and wallet.space_id = event.space_id
  left join public.financial_events original on original.id = event.reversal_of and original.space_id = event.space_id
  where event.space_id = p_space_id and event.effective_date >= p_month and event.effective_date < v_next_month
    and wallet.currency = p_currency and coalesce(original.kind, event.kind) in ('income', 'expense');
  if v_count > p_fact_cap then
    raise exception using errcode='54000', message='range_too_large';
  end if;

  with facts as (
    select event.id as event_id, movement.id as movement_id, event.effective_date, event.kind as event_kind,
      coalesce(original.kind, event.kind) as semantic_kind,
      category.id as category_id, coalesce(category.parent_category_id, category.id) as root_id,
      movement.amount_minor
    from public.financial_events event
    join public.wallet_movements movement on movement.event_id = event.id and movement.space_id = event.space_id
    join public.wallets wallet on wallet.id = movement.wallet_id and wallet.space_id = event.space_id
    left join public.financial_events original on original.id = event.reversal_of and original.space_id = event.space_id
    left join public.financial_event_categories event_category
      on event_category.event_id = event.id and event_category.space_id = event.space_id
    left join public.financial_event_categories original_category
      on original_category.event_id = original.id and original_category.space_id = event.space_id
    left join public.categories category
      on category.id = coalesce(event_category.category_id, original_category.category_id) and category.space_id = event.space_id
    where event.space_id = p_space_id and event.effective_date >= p_month and event.effective_date < v_next_month
      and wallet.currency = p_currency and coalesce(original.kind, event.kind) in ('income', 'expense')
  ), totals as (
    select count(*) as fact_count,
      coalesce(sum(amount_minor::numeric) filter (where semantic_kind = 'income'), 0) as income_minor,
      coalesce(sum(-amount_minor::numeric) filter (where semantic_kind = 'expense'), 0) as spending_minor,
      extensions.digest(
        '{"version":1,"currency":' || to_jsonb(p_currency::text)::text
          || ',"month":' || to_jsonb(p_month)::text
          || ',"count":' || count(*)::text
          || ',"facts":[' || coalesce(string_agg(jsonb_build_array(
            event_id, movement_id, effective_date, event_kind, semantic_kind, category_id, root_id, amount_minor::text
          )::text, ',' order by event_id, movement_id), '') || ']}',
        'sha256') as fact_digest
    from facts
  ), root_actuals as (
    select snapshot_root.category_id as root_id,
      coalesce(sum(-fact.amount_minor::numeric) filter (where fact.semantic_kind = 'expense'), 0) as actual_minor
    from public.allocation_month_roots snapshot_root
    left join facts fact on fact.root_id = snapshot_root.category_id
    where snapshot_root.snapshot_id = p_snapshot_id
    group by snapshot_root.category_id
  )
  select jsonb_build_object(
    'factCount', totals.fact_count::text,
    'factDigest', encode(totals.fact_digest, 'hex'),
    'incomeMinor', totals.income_minor::text,
    'spendingMinor', totals.spending_minor::text,
    'roots', coalesce((select jsonb_object_agg(root_actuals.root_id::text, root_actuals.actual_minor::text) from root_actuals), '{}'::jsonb)
  ) into v_result
  from totals;

  if (v_result->>'factCount')::bigint > p_fact_cap then
    raise exception using errcode='54000', message='range_too_large';
  end if;
  return v_result;
end;
$$;


ALTER FUNCTION private.budget_month_close_facts(p_space_id uuid, p_currency public.currency_code, p_month date, p_snapshot_id bigint, p_fact_cap integer) OWNER TO postgres;

--
-- Name: budget_month_close_preview(uuid, public.currency_code, date, bigint); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.budget_month_close_preview(p_space_id uuid, p_currency public.currency_code, p_month date, p_expected_close_id bigint) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_today date := (now() at time zone 'UTC')::date;
  v_snapshot public.allocation_month_snapshots%rowtype;
  v_head public.budget_month_closes%rowtype;
  v_has_head boolean;
  v_facts jsonb;
  v_roots jsonb;
  v_restatement boolean := false;
  v_preview jsonb;
begin
  if (p_month + interval '1 month')::date > v_today then
    raise exception using errcode='22023', message='budget_month_not_ended';
  end if;

  select * into v_snapshot from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = p_month
    order by id desc limit 1;
  if not found then
    raise exception using errcode='P0001', message='budget_month_close_requires_plan';
  end if;

  select * into v_head from public.budget_month_closes
    where space_id = p_space_id and currency = p_currency and month_start = p_month
    order by id desc limit 1;
  v_has_head := found;

  v_facts := private.budget_month_close_facts(p_space_id, p_currency, p_month, v_snapshot.id, 100000);

  select coalesce(jsonb_agg(jsonb_build_object(
      'categoryId', snapshot_root.category_id, 'nameEn', category.name_en, 'nameAr', category.name_ar,
      'groupId', snapshot_root.group_id,
      'baseMinor', snapshot_root.target_minor::text,
      'carryMinor', coalesce(link.carry_minor, 0)::text,
      'effectiveMinor', (snapshot_root.target_minor + coalesce(link.carry_minor, 0))::text,
      'actualMinor', coalesce(v_facts->'roots'->>snapshot_root.category_id::text, '0'),
      'outgoingCarryMinor', (case when coalesce(policy.enabled, false)
        then snapshot_root.target_minor + coalesce(link.carry_minor, 0)
          - coalesce((v_facts->'roots'->>snapshot_root.category_id::text)::numeric, 0)
        else 0 end)::text,
      'enabled', coalesce(policy.enabled, false),
      'policyRevisionId', policy.id::text,
      'carrySourceCloseId', link.source_close_id::text
    ) order by snapshot_root.category_id), '[]'::jsonb)
  into v_roots
  from public.allocation_month_roots snapshot_root
  join public.categories category on category.id = snapshot_root.category_id and category.space_id = p_space_id
  left join lateral (
    select revision.id, revision.enabled from public.rollover_policy_revisions revision
    where revision.space_id = p_space_id and revision.currency = p_currency and revision.root_id = snapshot_root.category_id
    order by revision.id desc limit 1
  ) policy on true
  left join public.budget_month_carry_links link
    on link.target_snapshot_id = snapshot_root.snapshot_id and link.root_id = snapshot_root.category_id
  where snapshot_root.snapshot_id = v_snapshot.id;

  -- Restatement is required exactly when re-closing now would freeze
  -- something different from the latest close.
  if v_has_head then
    v_restatement := v_head.source_snapshot_id is distinct from v_snapshot.id
      or encode(v_head.fact_digest, 'hex') is distinct from (v_facts->>'factDigest')
      or v_head.fact_count::text is distinct from (v_facts->>'factCount')
      or (select coalesce(jsonb_agg(jsonb_build_object(
            'categoryId', close_root.root_id, 'baseMinor', close_root.base_target_minor::text,
            'carryMinor', close_root.incoming_carry_minor::text, 'actualMinor', close_root.actual_minor::text,
            'outgoingCarryMinor', close_root.outgoing_carry_minor::text, 'enabled', close_root.enabled,
            'policyRevisionId', close_root.policy_revision_id::text
          ) order by close_root.root_id), '[]'::jsonb)
          from public.budget_month_close_roots close_root where close_root.close_id = v_head.id)
        is distinct from
         (select coalesce(jsonb_agg(jsonb_build_object(
            'categoryId', root->'categoryId', 'baseMinor', root->'baseMinor', 'carryMinor', root->'carryMinor',
            'actualMinor', root->'actualMinor', 'outgoingCarryMinor', root->'outgoingCarryMinor',
            'enabled', root->'enabled', 'policyRevisionId', root->'policyRevisionId'
          ) order by (root->>'categoryId')::uuid), '[]'::jsonb)
          from jsonb_array_elements(v_roots) root);
  end if;

  v_preview := jsonb_build_object(
    'month', p_month, 'currency', p_currency,
    'expectedCloseId', case when v_has_head then v_head.id::text else null end,
    'snapshotId', v_snapshot.id::text,
    'incomeMinor', v_facts->'incomeMinor', 'spendingMinor', v_facts->'spendingMinor',
    'factCount', v_facts->'factCount', 'factDigest', v_facts->'factDigest',
    'restatementRequired', v_restatement, 'roots', v_roots
  );
  return v_preview || jsonb_build_object('previewHash', encode(extensions.digest(jsonb_build_object(
    'version', 1, 'kind', 'budget_month_close', 'spaceId', p_space_id,
    'expectedCloseIdInput', p_expected_close_id::text, 'preview', v_preview
  )::text, 'sha256'), 'hex'));
end;
$$;


ALTER FUNCTION private.budget_month_close_preview(p_space_id uuid, p_currency public.currency_code, p_month date, p_expected_close_id bigint) OWNER TO postgres;

--
-- Name: check_allocation_month(bigint); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_allocation_month(p_snapshot_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_snapshot public.allocation_month_snapshots%rowtype;
  v_group_count integer;
  v_root_count integer;
  v_loan_line_count integer;
  v_goal_line_count integer;
  v_target_sum bigint;
  v_bps_sum integer;
  v_group_problems integer;
  v_root_problems integer;
  v_goal_problems integer;
  v_income public.monthly_budget_plan_revisions%rowtype;
  v_over_target_groups integer;
  v_bad_commitments integer;
  v_head_id bigint;
  v_exact_mismatches integer;
begin
  select * into v_snapshot from public.allocation_month_snapshots where id = p_snapshot_id for update;
  if not found then
    raise exception using errcode='23514', message='allocation_month_header_missing';
  end if;

  select count(*) into v_group_count from public.allocation_month_groups where snapshot_id = p_snapshot_id;
  if v_group_count is distinct from v_snapshot.group_count then
    raise exception using errcode='23514', message='allocation_month_group_count_mismatch';
  end if;
  select count(*) into v_root_count from public.allocation_month_roots where snapshot_id = p_snapshot_id;
  if v_root_count is distinct from v_snapshot.root_count then
    raise exception using errcode='23514', message='allocation_month_root_count_mismatch';
  end if;
  select count(*) into v_loan_line_count from public.allocation_month_commitments where snapshot_id = p_snapshot_id;
  if v_loan_line_count is distinct from v_snapshot.loan_line_count then
    raise exception using errcode='23514', message='allocation_month_loan_line_count_mismatch';
  end if;
  select count(*) into v_goal_line_count from public.allocation_month_goal_lines where snapshot_id = p_snapshot_id;
  if v_goal_line_count is distinct from v_snapshot.goal_line_count then
    raise exception using errcode='23514', message='allocation_month_goal_line_count_mismatch';
  end if;

  select count(*) into v_group_problems
  from public.allocation_month_groups month_group
  left join public.allocation_template_lines template_line
    on template_line.template_id = v_snapshot.template_revision_id
    and template_line.group_id = month_group.group_id
  left join public.allocation_groups grp
    on grp.id = month_group.group_id and grp.space_id = month_group.space_id
  where month_group.snapshot_id = p_snapshot_id
    and (
      template_line.template_id is null
      or month_group.name_en is distinct from template_line.name_en
      or month_group.name_ar is distinct from template_line.name_ar
      or month_group.display_order is distinct from template_line.display_order
      or month_group.basis_points is distinct from template_line.basis_points
      or month_group.purpose is distinct from grp.purpose
    );
  if v_group_problems <> 0 then
    raise exception using errcode='23514', message='allocation_month_group_copy_mismatch';
  end if;

  select coalesce(sum(target_minor),0), coalesce(sum(basis_points),0)
    into v_target_sum, v_bps_sum
    from public.allocation_month_groups where snapshot_id = p_snapshot_id;
  if v_bps_sum > 10000 or v_target_sum + v_snapshot.unallocated_minor <> v_snapshot.base_income_minor then
    raise exception using errcode='23514', message='allocation_month_apportionment_mismatch';
  end if;

  select count(*) into v_exact_mismatches
  from private.allocate_planning_income(
    v_snapshot.base_income_minor::text,
    (select coalesce(jsonb_agg(jsonb_build_object('id', line.group_id, 'order', line.display_order, 'basisPoints', line.basis_points)), '[]'::jsonb)
     from public.allocation_template_lines line where line.template_id = v_snapshot.template_revision_id)
  ) computed
  left join public.allocation_month_groups month_group
    on month_group.snapshot_id = p_snapshot_id and month_group.group_id = computed.group_id
  where (computed.is_residual and computed.target_minor <> v_snapshot.unallocated_minor)
     or (not computed.is_residual and (month_group.group_id is null or month_group.target_minor <> computed.target_minor));
  if v_exact_mismatches <> 0 then
    raise exception using errcode='23514', message='allocation_month_apportionment_mismatch';
  end if;

  select * into v_income from public.monthly_budget_plan_revisions
    where id = v_snapshot.income_plan_revision_id and space_id = v_snapshot.space_id;
  if not found or v_income.plan_kind <> 'income' or v_income.month_start <> v_snapshot.month_start
    or v_income.currency <> v_snapshot.currency or v_income.amount_minor <> v_snapshot.base_income_minor then
    raise exception using errcode='23514', message='allocation_month_income_revision_invalid';
  end if;

  select count(*) into v_root_problems
  from public.allocation_month_roots root
  left join public.monthly_budget_plan_revisions revision
    on revision.id = root.target_revision_id and revision.space_id = root.space_id
  where root.snapshot_id = p_snapshot_id
    and (
      revision.id is null
      or revision.plan_kind <> 'expense_category'
      or revision.category_id <> root.category_id
      or revision.month_start <> v_snapshot.month_start
      or revision.currency <> root.currency
      or revision.amount_minor <> root.target_minor
      or (root.group_id is not null and not exists (
        select 1 from public.allocation_template_roots template_root
        where template_root.template_id = v_snapshot.template_revision_id
          and template_root.category_id = root.category_id
          and template_root.group_id = root.group_id
      ))
    );
  if v_root_problems <> 0 then
    raise exception using errcode='23514', message='allocation_month_root_revision_invalid';
  end if;

  select count(*) into v_goal_problems
  from public.allocation_month_goal_lines goal_line
  left join public.goal_monthly_target_revisions revision
    on revision.id = goal_line.target_revision_id and revision.goal_id = goal_line.goal_id
  left join public.allocation_month_groups target_group
    on target_group.snapshot_id = goal_line.snapshot_id and target_group.group_id = goal_line.group_id
  where goal_line.snapshot_id = p_snapshot_id
    and (
      revision.id is null
      or revision.space_id <> goal_line.space_id
      or revision.currency <> goal_line.currency
      or revision.month_start <> v_snapshot.month_start
      or revision.amount_minor <> goal_line.amount_minor
      or (goal_line.group_id is not null and target_group.purpose <> 'future')
    );
  if v_goal_problems <> 0 then
    raise exception using errcode='23514', message='allocation_month_goal_line_invalid';
  end if;

  select count(*) into v_over_target_groups
  from (
    select month_group.group_id, month_group.target_minor,
      coalesce(sum(root.target_minor),0) + coalesce((
        select sum(goal_line.amount_minor) from public.allocation_month_goal_lines goal_line
        where goal_line.snapshot_id = p_snapshot_id and goal_line.group_id = month_group.group_id
      ), 0) as root_total
    from public.allocation_month_groups month_group
    left join public.allocation_month_roots root
      on root.snapshot_id = month_group.snapshot_id and root.group_id = month_group.group_id
    where month_group.snapshot_id = p_snapshot_id
    group by month_group.group_id, month_group.target_minor
  ) totals
  where totals.root_total > totals.target_minor;
  if v_over_target_groups <> 0 then
    raise exception using errcode='23514', message='allocation_month_group_overallocated';
  end if;

  select count(*) into v_bad_commitments
  from public.allocation_month_commitments commitment
  left join public.allocation_month_groups grp
    on grp.snapshot_id = commitment.snapshot_id and grp.group_id = commitment.group_id
  where commitment.snapshot_id = p_snapshot_id
    and commitment.group_id is not null
    and (grp.group_id is null or grp.purpose <> 'future'
      or commitment.observed_actual_minor + commitment.observed_remaining_minor > grp.target_minor);
  if v_bad_commitments <> 0 then
    raise exception using errcode='23514', message='allocation_month_commitment_invalid';
  end if;

  if v_snapshot.expected_snapshot_id is not null then
    if v_snapshot.expected_snapshot_id >= v_snapshot.id then
      raise exception using errcode='23514', message='allocation_month_predecessor_not_older';
    end if;
    select max(id) into v_head_id from public.allocation_month_snapshots
      where space_id = v_snapshot.space_id and currency = v_snapshot.currency
        and month_start = v_snapshot.month_start and id < v_snapshot.id;
    if v_head_id is distinct from v_snapshot.expected_snapshot_id then
      raise exception using errcode='23514', message='allocation_month_predecessor_not_head';
    end if;
  end if;
end;
$$;


ALTER FUNCTION private.check_allocation_month(p_snapshot_id bigint) OWNER TO postgres;

--
-- Name: check_allocation_month_from_commitment(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_allocation_month_from_commitment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  perform private.check_allocation_month(new.snapshot_id);
  return null;
end; $$;


ALTER FUNCTION private.check_allocation_month_from_commitment() OWNER TO postgres;

--
-- Name: check_allocation_month_from_goal_line(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_allocation_month_from_goal_line() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  perform private.check_allocation_month(new.snapshot_id);
  return null;
end; $$;


ALTER FUNCTION private.check_allocation_month_from_goal_line() OWNER TO postgres;

--
-- Name: check_allocation_month_from_group(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_allocation_month_from_group() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  perform private.check_allocation_month(new.snapshot_id);
  return null;
end; $$;


ALTER FUNCTION private.check_allocation_month_from_group() OWNER TO postgres;

--
-- Name: check_allocation_month_from_header(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_allocation_month_from_header() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  perform private.check_allocation_month(new.id);
  return null;
end; $$;


ALTER FUNCTION private.check_allocation_month_from_header() OWNER TO postgres;

--
-- Name: check_allocation_month_from_root(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_allocation_month_from_root() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  perform private.check_allocation_month(new.snapshot_id);
  return null;
end; $$;


ALTER FUNCTION private.check_allocation_month_from_root() OWNER TO postgres;

--
-- Name: check_allocation_template(bigint); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_allocation_template(p_template_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_header public.allocation_template_revisions%rowtype;
  v_line_count integer;
  v_bps_sum integer;
  v_root_count integer;
  v_valid_root_count integer;
  v_head_id bigint;
begin
  select * into v_header from public.allocation_template_revisions where id = p_template_id for update;
  if not found then
    raise exception using errcode='23514', message='allocation_template_header_missing';
  end if;

  select count(*), coalesce(sum(basis_points),0) into v_line_count, v_bps_sum
    from public.allocation_template_lines where template_id = p_template_id;
  if v_line_count is distinct from v_header.group_count or v_bps_sum > 10000 then
    raise exception using errcode='23514', message='allocation_template_group_count_or_bps_invalid';
  end if;

  select count(*) into v_root_count
    from public.allocation_template_roots where template_id = p_template_id;
  if v_root_count is distinct from v_header.root_count then
    raise exception using errcode='23514', message='allocation_template_root_count_mismatch';
  end if;

  select count(*) into v_valid_root_count
  from public.allocation_template_roots root
  join public.categories category
    on category.id = root.category_id and category.space_id = root.space_id and category.kind = 'expense'
  join public.allocation_groups grp
    on grp.id = root.group_id and grp.space_id = root.space_id
  where root.template_id = p_template_id
    and category.parent_category_id is null
    and grp.purpose = 'spending';
  if v_valid_root_count is distinct from v_root_count then
    raise exception using errcode='23514', message='allocation_template_root_category_or_purpose_invalid';
  end if;

  if v_header.expected_revision_id is not null then
    if v_header.expected_revision_id >= v_header.id then
      raise exception using errcode='23514', message='allocation_template_predecessor_not_older';
    end if;
    select max(id) into v_head_id from public.allocation_template_revisions
      where space_id = v_header.space_id and currency = v_header.currency and id < v_header.id;
    if v_head_id is distinct from v_header.expected_revision_id then
      raise exception using errcode='23514', message='allocation_template_predecessor_not_head';
    end if;
  end if;
end;
$$;


ALTER FUNCTION private.check_allocation_template(p_template_id bigint) OWNER TO postgres;

--
-- Name: check_allocation_template_from_header(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_allocation_template_from_header() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  perform private.check_allocation_template(new.id);
  return null;
end; $$;


ALTER FUNCTION private.check_allocation_template_from_header() OWNER TO postgres;

--
-- Name: check_allocation_template_from_line(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_allocation_template_from_line() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  perform private.check_allocation_template(new.template_id);
  return null;
end; $$;


ALTER FUNCTION private.check_allocation_template_from_line() OWNER TO postgres;

--
-- Name: check_allocation_template_from_root(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_allocation_template_from_root() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  perform private.check_allocation_template(new.template_id);
  return null;
end; $$;


ALTER FUNCTION private.check_allocation_template_from_root() OWNER TO postgres;

--
-- Name: check_budget_month_carry_from_link(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_budget_month_carry_from_link() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  perform private.check_budget_month_carry_links(new.target_snapshot_id);
  return null;
end; $$;


ALTER FUNCTION private.check_budget_month_carry_from_link() OWNER TO postgres;

--
-- Name: check_budget_month_carry_links(bigint); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_budget_month_carry_links(p_target_snapshot_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_snapshot public.allocation_month_snapshots%rowtype;
  v_close_count integer;
  v_close_id bigint;
  v_head bigint;
  v_problems integer;
begin
  select * into v_snapshot from public.allocation_month_snapshots where id = p_target_snapshot_id for update;
  if not found then
    raise exception using errcode='23514', message='budget_month_carry_snapshot_missing';
  end if;

  -- now() is the transaction timestamp: a snapshot or link from any earlier
  -- transaction cannot match it.
  if v_snapshot.created_at is distinct from now() or exists (
    select 1 from public.budget_month_carry_links link
    where link.target_snapshot_id = p_target_snapshot_id and link.created_at is distinct from now()
  ) then
    raise exception using errcode='23514', message='budget_month_carry_link_late';
  end if;

  select count(distinct link.source_close_id), max(link.source_close_id) into v_close_count, v_close_id
    from public.budget_month_carry_links link where link.target_snapshot_id = p_target_snapshot_id;
  if v_close_count <> 1 then
    raise exception using errcode='23514', message='budget_month_carry_links_mixed_sources';
  end if;

  select max(id) into v_head from public.budget_month_closes
    where space_id = v_snapshot.space_id and currency = v_snapshot.currency
      and month_start = (v_snapshot.month_start - interval '1 month')::date;
  if v_head is distinct from v_close_id then
    raise exception using errcode='23514', message='budget_month_carry_link_source_not_head';
  end if;

  with expected as (
    select close_root.root_id, close_root.outgoing_carry_minor as carry_minor
    from public.budget_month_close_roots close_root
    join public.categories category
      on category.id = close_root.root_id and category.space_id = close_root.space_id and category.archived_at is null
    where close_root.close_id = v_close_id and close_root.enabled
      and (close_root.outgoing_carry_minor <> 0 or exists (
        select 1 from public.allocation_month_roots snapshot_root
        where snapshot_root.snapshot_id = p_target_snapshot_id and snapshot_root.category_id = close_root.root_id
      ))
  ), linked as (
    select link.root_id, link.carry_minor from public.budget_month_carry_links link
    where link.target_snapshot_id = p_target_snapshot_id
  )
  select count(*) into v_problems from (
    (select * from expected except select * from linked)
    union all
    (select * from linked except select * from expected)
  ) difference;
  if v_problems <> 0 then
    raise exception using errcode='23514', message='budget_month_carry_links_incomplete';
  end if;
end;
$$;


ALTER FUNCTION private.check_budget_month_carry_links(p_target_snapshot_id bigint) OWNER TO postgres;

--
-- Name: check_budget_month_close(bigint); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_budget_month_close(p_close_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_close public.budget_month_closes%rowtype;
  v_root_count integer;
  v_snapshot_root_count integer;
  v_problems integer;
  v_head bigint;
begin
  select * into v_close from public.budget_month_closes where id = p_close_id for update;
  if not found then
    raise exception using errcode='23514', message='budget_month_close_header_missing';
  end if;

  select count(*) into v_root_count from public.budget_month_close_roots where close_id = p_close_id;
  select root_count into v_snapshot_root_count from public.allocation_month_snapshots where id = v_close.source_snapshot_id;
  if v_root_count is distinct from v_close.root_count or v_close.root_count is distinct from v_snapshot_root_count then
    raise exception using errcode='23514', message='budget_month_close_root_count_mismatch';
  end if;

  -- Each root observed the policy head and the snapshot's own accepted carry.
  select count(*) into v_problems
  from public.budget_month_close_roots close_root
  left join lateral (
    select policy.id from public.rollover_policy_revisions policy
    where policy.space_id = close_root.space_id and policy.currency = close_root.currency
      and policy.root_id = close_root.root_id
    order by policy.id desc limit 1
  ) policy_head on true
  left join public.budget_month_carry_links link
    on link.target_snapshot_id = close_root.source_snapshot_id and link.root_id = close_root.root_id
  where close_root.close_id = p_close_id
    and (policy_head.id is distinct from close_root.policy_revision_id
      or coalesce(link.carry_minor, 0) <> close_root.incoming_carry_minor);
  if v_problems <> 0 then
    raise exception using errcode='23514', message='budget_month_close_root_inputs_invalid';
  end if;

  select max(id) into v_head from public.budget_month_closes
    where space_id = v_close.space_id and currency = v_close.currency
      and month_start = v_close.month_start and id < v_close.id;
  if v_head is distinct from v_close.expected_close_id then
    raise exception using errcode='23514', message='budget_month_close_predecessor_not_head';
  end if;
end;
$$;


ALTER FUNCTION private.check_budget_month_close(p_close_id bigint) OWNER TO postgres;

--
-- Name: check_budget_month_close_from_header(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_budget_month_close_from_header() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  perform private.check_budget_month_close(new.id);
  return null;
end; $$;


ALTER FUNCTION private.check_budget_month_close_from_header() OWNER TO postgres;

--
-- Name: check_budget_month_close_from_root(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_budget_month_close_from_root() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  perform private.check_budget_month_close(new.close_id);
  return null;
end; $$;


ALTER FUNCTION private.check_budget_month_close_from_root() OWNER TO postgres;

--
-- Name: check_goal_definition(bigint); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_goal_definition(p_revision_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_header public.goal_revisions%rowtype;
  v_milestone_count integer;
  v_bad_amount_order integer;
  v_head_id bigint;
begin
  select * into v_header from public.goal_revisions where id = p_revision_id for update;
  if not found then
    raise exception using errcode='23514', message='goal_revision_header_missing';
  end if;

  select count(*) into v_milestone_count from public.goal_revision_milestones where revision_id = p_revision_id;
  if v_milestone_count is distinct from v_header.milestone_count then
    raise exception using errcode='23514', message='goal_milestone_count_mismatch';
  end if;

  -- Thresholds strictly increase by ordinal among amount-kind milestones
  -- (checklist milestones are skipped, not reset); threshold <= target; due
  -- dates nondecreasing by ordinal among amount-kind; due date <= deadline.
  select count(*) into v_bad_amount_order
  from (
    select threshold_minor, due_date,
      lag(threshold_minor) over (order by ordinal) as prev_threshold,
      lag(due_date) over (order by ordinal) as prev_due_date
    from public.goal_revision_milestones
    where revision_id = p_revision_id and kind = 'amount'
  ) ordered
  where threshold_minor > v_header.target_minor
    or (prev_threshold is not null and threshold_minor <= prev_threshold)
    or (due_date is not null and prev_due_date is not null and due_date < prev_due_date)
    or (due_date is not null and v_header.deadline is not null and due_date > v_header.deadline);
  if v_bad_amount_order <> 0 then
    raise exception using errcode='23514', message='goal_milestone_threshold_or_due_date_invalid';
  end if;

  if v_header.expected_revision_id is not null then
    if v_header.expected_revision_id >= v_header.id then
      raise exception using errcode='23514', message='goal_revision_predecessor_not_older';
    end if;
    select max(id) into v_head_id from public.goal_revisions
      where goal_id = v_header.goal_id and id < v_header.id;
    if v_head_id is distinct from v_header.expected_revision_id then
      raise exception using errcode='23514', message='goal_revision_predecessor_not_head';
    end if;
  end if;
end;
$$;


ALTER FUNCTION private.check_goal_definition(p_revision_id bigint) OWNER TO postgres;

--
-- Name: check_goal_definition_from_header(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_goal_definition_from_header() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  perform private.check_goal_definition(new.id);
  return null;
end; $$;


ALTER FUNCTION private.check_goal_definition_from_header() OWNER TO postgres;

--
-- Name: check_goal_definition_from_milestone(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_goal_definition_from_milestone() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  perform private.check_goal_definition(new.revision_id);
  return null;
end; $$;


ALTER FUNCTION private.check_goal_definition_from_milestone() OWNER TO postgres;

--
-- Name: check_goal_earmark_event(bigint); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_goal_earmark_event(p_event_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_event public.goal_earmark_events%rowtype;
  v_original public.goal_earmark_events%rowtype;
  v_line_count integer;
  v_positive_count integer;
  v_negative_count integer;
  v_distinct_goals integer;
  v_line_sum bigint;
  v_reverse_mismatch integer;
  v_bad_balance integer;
  v_as_of date;
begin
  select * into v_event from public.goal_earmark_events where id = p_event_id for update;
  if not found then
    raise exception using errcode='23514', message='goal_earmark_event_missing';
  end if;
  v_as_of := greatest((now() at time zone 'UTC')::date, v_event.effective_date);

  select count(*), count(*) filter (where amount_minor > 0), count(*) filter (where amount_minor < 0),
    count(distinct goal_id), coalesce(sum(amount_minor),0)
    into v_line_count, v_positive_count, v_negative_count, v_distinct_goals, v_line_sum
    from public.goal_earmark_lines where event_id = p_event_id;

  if v_line_count is distinct from v_event.line_count then
    raise exception using errcode='23514', message='goal_earmark_line_count_mismatch';
  end if;

  if v_event.operation = 'reserve' then
    if v_line_count <> 1 or v_positive_count <> 1 then
      raise exception using errcode='23514', message='goal_earmark_reserve_shape_invalid';
    end if;
  elsif v_event.operation = 'release' then
    if v_line_count <> 1 or v_negative_count <> 1 then
      raise exception using errcode='23514', message='goal_earmark_release_shape_invalid';
    end if;
  elsif v_event.operation = 'move' then
    if v_line_count <> 2 or v_distinct_goals <> 2 or v_positive_count <> 1
      or v_negative_count <> 1 or v_line_sum <> 0 then
      raise exception using errcode='23514', message='goal_earmark_move_shape_invalid';
    end if;
  elsif v_event.operation = 'reverse' then
    select * into v_original from public.goal_earmark_events where id = v_event.reversal_of for update;
    if not found or v_original.operation = 'reverse' then
      raise exception using errcode='23514', message='goal_earmark_reverse_target_invalid';
    end if;
    if v_line_count is distinct from v_original.line_count then
      raise exception using errcode='23514', message='goal_earmark_reverse_shape_invalid';
    end if;
    select count(*) into v_reverse_mismatch
    from public.goal_earmark_lines orig
    where orig.event_id = v_original.id
      and not exists(
        select 1 from public.goal_earmark_lines rev
        where rev.event_id = p_event_id and rev.goal_id = orig.goal_id and rev.amount_minor = -orig.amount_minor
      );
    if v_reverse_mismatch <> 0 then
      raise exception using errcode='23514', message='goal_earmark_reverse_shape_invalid';
    end if;
  end if;

  -- Same definitions as the reserve command (audit C1): earmark net of linked
  -- purchases plus what those purchases fulfilled must stay within the target,
  -- and the net earmark may never go below zero. Evaluated as of the later of
  -- UTC "today" and this event's own effective_date (v_as_of above), not
  -- UTC "today" alone: every RPC-written event posts at today, so v_as_of
  -- equals today for all of them and this is a no-op change for the command
  -- path, but an owner-level insert backdating effective_date into the future
  -- can no longer hide its own contribution from this check by outrunning
  -- "today". UTC "today" matches the command until the Spec 1 space clock
  -- replaces both together.
  select count(*) into v_bad_balance
  from (
    select el.goal_id, sum(el.amount_minor) as event_contribution,
      state.earmarked_minor, state.fulfilled_minor,
      (select target_minor from public.goal_revisions where goal_id = el.goal_id order by id desc limit 1) as target
    from public.goal_earmark_lines el
    cross join lateral private.goal_financing_state(el.goal_id, v_as_of) state
    where el.event_id = p_event_id
    group by el.goal_id, state.earmarked_minor, state.fulfilled_minor
  ) totals
  where earmarked_minor < 0
    or (v_event.operation <> 'reverse' and event_contribution > 0 and earmarked_minor + fulfilled_minor > target);
  if v_bad_balance <> 0 then
    raise exception using errcode='23514', message='goal_earmark_balance_invalid';
  end if;
end;
$$;


ALTER FUNCTION private.check_goal_earmark_event(p_event_id bigint) OWNER TO postgres;

--
-- Name: check_goal_earmark_event_from_header(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_goal_earmark_event_from_header() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  perform private.check_goal_earmark_event(new.id);
  return null;
end; $$;


ALTER FUNCTION private.check_goal_earmark_event_from_header() OWNER TO postgres;

--
-- Name: check_goal_earmark_event_from_line(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_goal_earmark_event_from_line() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  perform private.check_goal_earmark_event(new.event_id);
  return null;
end; $$;


ALTER FUNCTION private.check_goal_earmark_event_from_line() OWNER TO postgres;

--
-- Name: check_goal_milestone_event(bigint); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_goal_milestone_event(p_event_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_event public.goal_milestone_events%rowtype;
  v_current_definition_id bigint;
  v_milestone_in_current_definition boolean;
  v_head_id bigint;
begin
  select * into v_event from public.goal_milestone_events where id = p_event_id for update;
  if not found then
    raise exception using errcode='23514', message='goal_milestone_event_missing';
  end if;

  select id into v_current_definition_id from public.goal_revisions
    where goal_id = v_event.goal_id and space_id = v_event.space_id
    order by id desc limit 1;

  select exists(
    select 1 from public.goal_revision_milestones
    where revision_id = v_current_definition_id and milestone_id = v_event.milestone_id and kind = 'checklist'
  ) into v_milestone_in_current_definition;
  if not v_milestone_in_current_definition then
    raise exception using errcode='23514', message='goal_milestone_absent_or_not_checklist';
  end if;

  if v_event.expected_event_id is not null then
    if v_event.expected_event_id >= v_event.id then
      raise exception using errcode='23514', message='goal_milestone_event_predecessor_not_older';
    end if;
    select max(id) into v_head_id from public.goal_milestone_events
      where milestone_id = v_event.milestone_id and id < v_event.id;
    if v_head_id is distinct from v_event.expected_event_id then
      raise exception using errcode='23514', message='goal_milestone_event_predecessor_not_head';
    end if;
  end if;
end;
$$;


ALTER FUNCTION private.check_goal_milestone_event(p_event_id bigint) OWNER TO postgres;

--
-- Name: check_goal_milestone_event_from_event(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_goal_milestone_event_from_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  perform private.check_goal_milestone_event(new.id);
  return null;
end; $$;


ALTER FUNCTION private.check_goal_milestone_event_from_event() OWNER TO postgres;

--
-- Name: check_occurrence_event(bigint); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_occurrence_event(p_event_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_event public.occurrence_events%rowtype;
  v_head_id bigint;
  v_prior_action text;
  v_settled numeric;
  v_skipped boolean;
  v_eligible numeric;
  v_total_allocated numeric;
begin
  select * into v_event from public.occurrence_events where id = p_event_id for update;
  if not found then
    raise exception using errcode='23514', message='occurrence_event_missing';
  end if;

  if v_event.expected_event_id is not null then
    if v_event.expected_event_id >= v_event.id then
      raise exception using errcode='23514', message='occurrence_event_predecessor_not_older';
    end if;
    select max(id) into v_head_id from public.occurrence_events
      where occurrence_id = v_event.occurrence_id and id < v_event.id;
    if v_head_id is distinct from v_event.expected_event_id then
      raise exception using errcode='23514', message='occurrence_event_predecessor_not_head';
    end if;
  end if;

  select action into v_prior_action from public.occurrence_events
    where occurrence_id = v_event.occurrence_id and id < v_event.id order by id desc limit 1;

  if v_event.action = 'skip' then
    if v_prior_action = 'skip' then
      raise exception using errcode='23514', message='occurrence_already_skipped';
    end if;
    select settled_minor, skipped into v_settled, v_skipped
      from private.schedule_occurrence_settlement(v_event.occurrence_id, (now() at time zone 'UTC')::date);
    if v_settled <> 0 then
      raise exception using errcode='23514', message='occurrence_settled_amount_nonzero_for_skip';
    end if;
  elsif v_event.action = 'reopen' then
    if v_prior_action is distinct from 'skip' then
      raise exception using errcode='23514', message='occurrence_not_skipped_for_reopen';
    end if;
  elsif v_event.action in ('link','confirm') then
    if v_prior_action = 'skip' then
      raise exception using errcode='23514', message='occurrence_skipped_rejects_settlement';
    end if;

    -- Recompute the same allocation-sum cap link_scheduled_payment/
    -- confirm_scheduled_occurrence already enforce at command time, purely
    -- from the linked financial event's own kind and postings -- defense in
    -- depth against a privileged direct insert bypassing the command,
    -- mirroring the skip-invariant recheck above.
    if v_event.linked_event_id is not null then
      select case fe.kind
        when 'expense' then coalesce((select -sum(m.amount_minor) from public.wallet_movements m where m.event_id = fe.id), 0)
        when 'income' then coalesce((select sum(m.amount_minor) from public.wallet_movements m where m.event_id = fe.id), 0)
        when 'loan_repay_borrowing' then coalesce((select abs(lp.principal_delta_minor) from public.loan_postings lp where lp.event_id = fe.id), 0)
        when 'loan_receive_repayment' then coalesce((select abs(lp.principal_delta_minor) from public.loan_postings lp where lp.event_id = fe.id), 0)
        else 0
      end into v_eligible
      from public.financial_events fe where fe.id = v_event.linked_event_id;

      select coalesce(sum(oe.link_amount_minor), 0) into v_total_allocated
        from public.occurrence_events oe
        where oe.linked_event_id = v_event.linked_event_id and oe.action in ('link','confirm');

      if v_total_allocated > coalesce(v_eligible, 0) then
        raise exception using errcode='23514', message='occurrence_allocation_exceeds_eligible_amount';
      end if;
    end if;
  end if;
end;
$$;


ALTER FUNCTION private.check_occurrence_event(p_event_id bigint) OWNER TO postgres;

--
-- Name: check_occurrence_event_from_row(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_occurrence_event_from_row() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  perform private.check_occurrence_event(new.id);
  return null;
end; $$;


ALTER FUNCTION private.check_occurrence_event_from_row() OWNER TO postgres;

--
-- Name: check_rollover_policy_from_row(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_rollover_policy_from_row() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  perform private.check_rollover_policy_revision(new.id);
  return null;
end; $$;


ALTER FUNCTION private.check_rollover_policy_from_row() OWNER TO postgres;

--
-- Name: check_rollover_policy_revision(bigint); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_rollover_policy_revision(p_revision_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_row public.rollover_policy_revisions%rowtype;
  v_head bigint;
begin
  select * into v_row from public.rollover_policy_revisions where id = p_revision_id for update;
  if not found then
    raise exception using errcode='23514', message='rollover_policy_header_missing';
  end if;
  if not exists (
    select 1 from public.categories category
    where category.id = v_row.root_id and category.space_id = v_row.space_id
      and category.kind = 'expense' and category.parent_category_id is null
  ) then
    raise exception using errcode='23514', message='rollover_policy_scope_invalid';
  end if;
  select max(id) into v_head from public.rollover_policy_revisions
    where space_id = v_row.space_id and currency = v_row.currency and root_id = v_row.root_id and id < v_row.id;
  if v_head is distinct from v_row.expected_revision_id then
    raise exception using errcode='23514', message='rollover_policy_predecessor_not_head';
  end if;
end;
$$;


ALTER FUNCTION private.check_rollover_policy_revision(p_revision_id bigint) OWNER TO postgres;

--
-- Name: check_schedule_revision(bigint); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_schedule_revision(p_revision_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_header public.schedule_revisions%rowtype;
  v_kind text;
  v_head_id bigint;
  v_category_kind public.category_kind;
  v_loan_ok boolean;
  v_goal_ok boolean;
  v_wallet_ok boolean;
begin
  select * into v_header from public.schedule_revisions where id = p_revision_id for update;
  if not found then
    raise exception using errcode='23514', message='schedule_revision_header_missing';
  end if;

  if v_header.expected_revision_id is not null then
    if v_header.expected_revision_id >= v_header.id then
      raise exception using errcode='23514', message='schedule_revision_predecessor_not_older';
    end if;
    select max(id) into v_head_id from public.schedule_revisions
      where schedule_id = v_header.schedule_id and id < v_header.id;
    if v_head_id is distinct from v_header.expected_revision_id then
      raise exception using errcode='23514', message='schedule_revision_predecessor_not_head';
    end if;
  end if;

  select kind into v_kind from public.schedules where id = v_header.schedule_id;

  if v_kind = 'expense' then
    if v_header.loan_id is not null then
      raise exception using errcode='23514', message='schedule_loan_must_be_null_for_expense';
    end if;
    if v_header.category_id is not null then
      select kind into v_category_kind from public.categories
        where id = v_header.category_id and space_id = v_header.space_id;
      if not found or v_category_kind <> 'expense' then
        raise exception using errcode='23514', message='schedule_category_kind_mismatch';
      end if;
    end if;
    if v_header.funding_goal_id is not null then
      select exists(
        select 1 from public.goals g
        join public.goal_revisions gr on gr.goal_id = g.id
        where g.id = v_header.funding_goal_id and g.space_id = v_header.space_id
          and g.currency = v_header.currency and g.kind = 'purchase' and gr.state = 'active'
          and gr.id = (select max(id) from public.goal_revisions where goal_id = g.id)
      ) into v_goal_ok;
      if not v_goal_ok then
        raise exception using errcode='23514', message='schedule_funding_goal_invalid';
      end if;
    end if;
  elsif v_kind = 'income' then
    if v_header.loan_id is not null then
      raise exception using errcode='23514', message='schedule_loan_must_be_null_for_income';
    end if;
    if v_header.funding_goal_id is not null then
      raise exception using errcode='23514', message='schedule_goal_must_be_null_for_income';
    end if;
    if v_header.category_id is not null then
      select kind into v_category_kind from public.categories
        where id = v_header.category_id and space_id = v_header.space_id;
      if not found or v_category_kind <> 'income' then
        raise exception using errcode='23514', message='schedule_category_kind_mismatch';
      end if;
    end if;
  elsif v_kind = 'debt_payment' then
    if v_header.category_id is not null then
      raise exception using errcode='23514', message='schedule_category_must_be_null_for_debt_payment';
    end if;
    if v_header.funding_goal_id is not null then
      raise exception using errcode='23514', message='schedule_goal_must_be_null_for_debt_payment';
    end if;
    if v_header.loan_id is null then
      raise exception using errcode='23514', message='schedule_loan_required_for_debt_payment';
    end if;
    select exists(
      select 1 from public.loans where id = v_header.loan_id and space_id = v_header.space_id
        and currency = v_header.currency and direction = 'i_owe_them'
    ) into v_loan_ok;
    if not v_loan_ok then
      raise exception using errcode='23514', message='schedule_loan_invalid';
    end if;
  end if;

  if v_header.preferred_wallet_id is not null then
    select exists(
      select 1 from public.wallets where id = v_header.preferred_wallet_id and space_id = v_header.space_id
        and currency = v_header.currency and archived_at is null
    ) into v_wallet_ok;
    if not v_wallet_ok then
      raise exception using errcode='23514', message='schedule_wallet_invalid';
    end if;
  end if;
end;
$$;


ALTER FUNCTION private.check_schedule_revision(p_revision_id bigint) OWNER TO postgres;

--
-- Name: check_schedule_revision_from_header(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.check_schedule_revision_from_header() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  perform private.check_schedule_revision(new.id);
  return null;
end; $$;


ALTER FUNCTION private.check_schedule_revision_from_header() OWNER TO postgres;

--
-- Name: derive_household_invitation_token(smallint, uuid, uuid, uuid, bytea); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.derive_household_invitation_token(p_key_version smallint, p_actor_user_id uuid, p_request_id uuid, p_space_id uuid, p_identity_digest bytea) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_key bytea;
  v_encoded text;
begin
  select keyring.token_hmac_key
  into v_key
  from private.household_invitation_keys as keyring
  where keyring.key_version = p_key_version;

  if not found then
    raise exception using errcode = '55000', message = 'invitation_key_unavailable';
  end if;

  v_encoded := encode(
    extensions.hmac(
      convert_to(
        'household-invitation-token-v1|'
          || p_actor_user_id::text || '|'
          || p_request_id::text || '|'
          || p_space_id::text || '|'
          || encode(p_identity_digest, 'hex'),
        'UTF8'
      ),
      v_key,
      'sha256'
    ),
    'base64'
  );

  return rtrim(replace(replace(replace(v_encoded, E'\n', ''), '+', '-'), '/', '_'), '=');
end;
$$;


ALTER FUNCTION private.derive_household_invitation_token(p_key_version smallint, p_actor_user_id uuid, p_request_id uuid, p_space_id uuid, p_identity_digest bytea) OWNER TO postgres;

--
-- Name: enforce_household_invitation_space(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.enforce_household_invitation_space() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from public.spaces as space
    where space.id = new.space_id and space.kind = 'household'
  ) then
    raise exception using
      errcode = '23514',
      message = 'household invitations require a household space';
  end if;
  return null;
end;
$$;


ALTER FUNCTION private.enforce_household_invitation_space() OWNER TO postgres;

--
-- Name: enforce_space_membership_invariant(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.enforce_space_membership_invariant() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if tg_op <> 'INSERT' then
    perform private.assert_space_membership_invariant(old.space_id);
  end if;
  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.space_id is distinct from old.space_id) then
    perform private.assert_space_membership_invariant(new.space_id);
  elsif tg_op = 'UPDATE' then
    perform private.assert_space_membership_invariant(new.space_id);
  end if;
  return null;
end;
$$;


ALTER FUNCTION private.enforce_space_membership_invariant() OWNER TO postgres;

--
-- Name: enforce_space_row_membership_invariant(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.enforce_space_row_membership_invariant() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform private.assert_space_membership_invariant(new.id);

  if new.kind = 'personal' and exists (
    select 1
    from public.household_invitations as invitation
    where invitation.space_id = new.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'household invitations require a household space';
  end if;

  return null;
end;
$$;


ALTER FUNCTION private.enforce_space_row_membership_invariant() OWNER TO postgres;

--
-- Name: goal_cash_pool(uuid, public.currency_code, date); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.goal_cash_pool(p_space_id uuid, p_currency public.currency_code, p_as_of date) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select coalesce(sum(m.amount_minor), 0)::numeric
  from public.wallet_movements m
  join public.wallets w on w.id = m.wallet_id and w.space_id = m.space_id
  join public.financial_events e on e.id = m.event_id and e.space_id = m.space_id
  where m.space_id = p_space_id and w.currency = p_currency and e.effective_date <= p_as_of;
$$;


ALTER FUNCTION private.goal_cash_pool(p_space_id uuid, p_currency public.currency_code, p_as_of date) OWNER TO postgres;

--
-- Name: goal_coverage_set(uuid, public.currency_code, date); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.goal_coverage_set(p_space_id uuid, p_currency public.currency_code, p_as_of date) RETURNS TABLE(goal_id uuid, revision_id bigint, kind text, state text, name_en text, name_ar text, target_minor bigint, deadline date, contribution_mode text, monthly_minor bigint, priority integer, created_at timestamp with time zone, earmarked_minor numeric, fulfilled_minor numeric, head text, covered_minor numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  with relevant as (
    select * from private.goal_relevant_set(p_space_id, p_currency, p_as_of)
  ), ranked as (
    select relevant.*,
      coalesce(sum(earmarked_minor) over (
        order by priority, created_at, goal_id rows between unbounded preceding and 1 preceding
      ), 0) as prior_claims
    from relevant
  )
  select ranked.goal_id, ranked.revision_id, ranked.kind, ranked.state, ranked.name_en, ranked.name_ar,
    ranked.target_minor, ranked.deadline, ranked.contribution_mode, ranked.monthly_minor,
    ranked.priority, ranked.created_at, ranked.earmarked_minor, ranked.fulfilled_minor, ranked.head,
    least(ranked.earmarked_minor, greatest(
      (select private.goal_cash_pool(p_space_id, p_currency, p_as_of)) - ranked.prior_claims, 0
    )) as covered_minor
  from ranked;
$$;


ALTER FUNCTION private.goal_coverage_set(p_space_id uuid, p_currency public.currency_code, p_as_of date) OWNER TO postgres;

--
-- Name: goal_financing_state(uuid, date); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.goal_financing_state(p_goal_id uuid, p_as_of date) RETURNS TABLE(earmarked_minor numeric, fulfilled_minor numeric, head text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_earmark_sum numeric;
  v_link_before numeric;
  v_link_reversed_before numeric;
  v_current_revision_id bigint;
  v_latest_event_id bigint;
  v_latest_link_created_at timestamptz;
  v_latest_link_id uuid;
  v_reversal_count bigint;
  v_earmarked numeric;
  v_fulfilled numeric;
  v_head text;
begin
  select coalesce(sum(el.amount_minor), 0) into v_earmark_sum
  from public.goal_earmark_lines el
  join public.goal_earmark_events ge on ge.id = el.event_id
  where el.goal_id = p_goal_id and ge.effective_date <= p_as_of;

  select coalesce(sum(gpl.amount_minor), 0) into v_link_before
  from public.goal_purchase_links gpl
  join public.financial_events fe on fe.id = gpl.expense_event_id
  where gpl.goal_id = p_goal_id and fe.effective_date <= p_as_of;

  select coalesce(sum(gpl.amount_minor), 0) into v_link_reversed_before
  from public.goal_purchase_links gpl
  join public.financial_events orig on orig.id = gpl.expense_event_id
  join public.financial_events rev on rev.reversal_of = orig.id
  where gpl.goal_id = p_goal_id and rev.effective_date <= p_as_of;

  v_earmarked := v_earmark_sum - v_link_before + v_link_reversed_before;
  v_fulfilled := v_link_before - v_link_reversed_before;

  select id into v_current_revision_id from public.goal_revisions
    where goal_id = p_goal_id order by id desc limit 1;
  select max(event_id) into v_latest_event_id from public.goal_earmark_lines where goal_id = p_goal_id;
  select gpl.created_at, gpl.id into v_latest_link_created_at, v_latest_link_id
    from public.goal_purchase_links gpl where gpl.goal_id = p_goal_id
    order by gpl.created_at desc, gpl.id desc limit 1;
  select count(*) into v_reversal_count
    from public.goal_purchase_links gpl
    join public.financial_events orig on orig.id = gpl.expense_event_id
    join public.financial_events rev on rev.reversal_of = orig.id
    where gpl.goal_id = p_goal_id and rev.effective_date <= p_as_of;

  v_head := encode(extensions.digest(jsonb_build_object(
    'revisionId', v_current_revision_id, 'latestEarmarkEventId', v_latest_event_id,
    'latestPurchaseLink', jsonb_build_object('createdAt', v_latest_link_created_at, 'id', v_latest_link_id),
    'reversalCount', v_reversal_count, 'earmarkedMinor', v_earmarked::text, 'fulfilledMinor', v_fulfilled::text
  )::text, 'sha256'), 'hex');

  return query select v_earmarked, v_fulfilled, v_head;
end;
$$;


ALTER FUNCTION private.goal_financing_state(p_goal_id uuid, p_as_of date) OWNER TO postgres;

--
-- Name: goal_monthly_extras(uuid, text, bigint, date, numeric, numeric, date); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.goal_monthly_extras(p_goal_id uuid, p_kind text, p_target_minor bigint, p_deadline date, p_covered_minor numeric, p_fulfilled_minor numeric, p_month date) RETURNS TABLE(monthly_target_minor bigint, monthly_net_contribution_minor numeric, suggested_monthly_minor bigint, forecast_month date, forecast_state text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_today date := (now() at time zone 'UTC')::date;
  v_this_month date := date_trunc('month', v_today)::date;
  v_monthly_target bigint;
  v_net_contribution numeric;
  v_progress numeric;
  v_remaining numeric;
  v_months integer;
  v_suggested bigint;
  v_goal_created date;
  v_history_start date;
  v_mean numeric;
  v_periods numeric;
  v_forecast_month date;
  v_forecast_state text;
begin
  select amount_minor into v_monthly_target from public.goal_monthly_target_revisions
    where goal_id = p_goal_id and month_start = p_month order by id desc limit 1;

  select coalesce(sum(el.amount_minor), 0) into v_net_contribution
  from public.goal_earmark_lines el join public.goal_earmark_events ge on ge.id = el.event_id
  where el.goal_id = p_goal_id and date_trunc('month', ge.effective_date)::date = p_month;

  v_progress := p_covered_minor + case when p_kind = 'purchase' then p_fulfilled_minor else 0 end;
  v_remaining := greatest(p_target_minor - v_progress, 0);

  if p_deadline is null then
    v_suggested := null;
  else
    v_months := 12 * (extract(year from p_deadline)::integer - extract(year from v_this_month)::integer)
      + (extract(month from p_deadline)::integer - extract(month from v_this_month)::integer) + 1;
    if v_months <= 0 then
      v_suggested := case when v_remaining > 0 then null else 0 end;
    else
      v_suggested := ceil(v_remaining / v_months::numeric)::bigint;
    end if;
  end if;

  select g.created_at::date into v_goal_created from public.goals g where g.id = p_goal_id;
  v_history_start := (v_this_month - interval '3 months')::date;
  if v_goal_created > v_history_start then
    v_forecast_month := null;
    v_forecast_state := 'insufficient_history';
  else
    select avg(month_sum) into v_mean
    from (
      select coalesce((
        select sum(el.amount_minor) from public.goal_earmark_lines el
        join public.goal_earmark_events ge on ge.id = el.event_id
        where el.goal_id = p_goal_id and date_trunc('month', ge.effective_date)::date = months.month_start
      ), 0) as month_sum
      from (
        select (v_history_start + (n * interval '1 month'))::date as month_start
        from generate_series(0, 2) as n
      ) months
    ) samples;
    if v_mean is null or v_mean <= 0 then
      v_forecast_month := null;
      v_forecast_state := 'no_positive_pace';
    else
      v_periods := ceil(v_remaining / v_mean);
      if v_periods > 120 then
        v_forecast_month := null;
        v_forecast_state := 'beyond_horizon';
      else
        v_forecast_month := (v_this_month + (v_periods::integer * interval '1 month'))::date;
        v_forecast_state := 'estimate';
      end if;
    end if;
  end if;

  return query select v_monthly_target, v_net_contribution, v_suggested, v_forecast_month, v_forecast_state;
end;
$$;


ALTER FUNCTION private.goal_monthly_extras(p_goal_id uuid, p_kind text, p_target_minor bigint, p_deadline date, p_covered_minor numeric, p_fulfilled_minor numeric, p_month date) OWNER TO postgres;

--
-- Name: goal_relevant_set(uuid, public.currency_code, date); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.goal_relevant_set(p_space_id uuid, p_currency public.currency_code, p_as_of date) RETURNS TABLE(goal_id uuid, revision_id bigint, kind text, state text, name_en text, name_ar text, target_minor bigint, deadline date, contribution_mode text, monthly_minor bigint, priority integer, created_at timestamp with time zone, earmarked_minor numeric, fulfilled_minor numeric, head text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.goals g
  join lateral (
    select gr.state from public.goal_revisions gr where gr.goal_id = g.id order by gr.id desc limit 1
  ) current_revision on true
  cross join lateral private.goal_financing_state(g.id, p_as_of) fs
  where g.space_id = p_space_id and g.currency = p_currency
    and (current_revision.state in ('active','paused')
      or (current_revision.state = 'closed' and fs.earmarked_minor <> 0));
  if v_count > 200 then
    raise exception using errcode='P0001', message='more than 200 relevant goals exist for this space and currency';
  end if;

  return query
  select g.id, current_revision.id, g.kind, current_revision.state, current_revision.name_en, current_revision.name_ar,
    current_revision.target_minor, current_revision.deadline, current_revision.contribution_mode, current_revision.monthly_minor,
    current_revision.priority, g.created_at, fs.earmarked_minor, fs.fulfilled_minor, fs.head
  from public.goals g
  join lateral (
    select gr.id, gr.state, gr.priority, gr.name_en, gr.name_ar, gr.target_minor, gr.deadline,
      gr.contribution_mode, gr.monthly_minor
    from public.goal_revisions gr where gr.goal_id = g.id order by gr.id desc limit 1
  ) current_revision on true
  cross join lateral private.goal_financing_state(g.id, p_as_of) fs
  where g.space_id = p_space_id and g.currency = p_currency
    and (current_revision.state in ('active','paused')
      or (current_revision.state = 'closed' and fs.earmarked_minor <> 0));
end;
$$;


ALTER FUNCTION private.goal_relevant_set(p_space_id uuid, p_currency public.currency_code, p_as_of date) OWNER TO postgres;

--
-- Name: goal_space_earmarked_total(uuid, public.currency_code, date); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.goal_space_earmarked_total(p_space_id uuid, p_currency public.currency_code, p_as_of date) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select coalesce(sum(
    (select el.amount_minor_sum from (
      select coalesce(sum(el.amount_minor), 0)
        - coalesce((select sum(gpl.amount_minor) from public.goal_purchase_links gpl
            join public.financial_events fe on fe.id = gpl.expense_event_id
            where gpl.goal_id = g.id and fe.effective_date <= p_as_of), 0)
        + coalesce((select sum(gpl.amount_minor) from public.goal_purchase_links gpl
            join public.financial_events orig on orig.id = gpl.expense_event_id
            join public.financial_events rev on rev.reversal_of = orig.id
            where gpl.goal_id = g.id and rev.effective_date <= p_as_of), 0) as amount_minor_sum
      from public.goal_earmark_lines el where el.goal_id = g.id
        and el.event_id in (select id from public.goal_earmark_events ge2 where ge2.effective_date <= p_as_of)
    ) el)
  ), 0)::numeric
  from public.goals g where g.space_id = p_space_id and g.currency = p_currency;
$$;


ALTER FUNCTION private.goal_space_earmarked_total(p_space_id uuid, p_currency public.currency_code, p_as_of date) OWNER TO postgres;

--
-- Name: guard_category_archive_transition(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.guard_category_archive_transition() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_owner_name name;
begin
  select pg_catalog.pg_get_userbyid(relation.relowner)
  into v_owner_name
  from pg_catalog.pg_class as relation
  where relation.oid = tg_relid
  limit 1;

  if current_user <> v_owner_name then
    raise exception using
      errcode = '42501',
      message = 'protected rows may be written only by their owning command';
  end if;

  -- Stored generated keys are not computed yet in a BEFORE UPDATE trigger.
  -- Every other column except the one-way archive pair remains immutable.
  if old.archived_at is not null
    or old.archived_by is not null
    or new.archived_at is null
    or new.archived_by is null
    or (pg_catalog.to_jsonb(new) - array['archived_at', 'archived_by', 'name_en_key', 'name_ar_key'])
      is distinct from
      (pg_catalog.to_jsonb(old) - array['archived_at', 'archived_by', 'name_en_key', 'name_ar_key']) then
    raise exception using
      errcode = '42501',
      message = 'categories may only transition once from active to archived';
  end if;

  if new.parent_category_id is null and exists (
    select 1
    from public.categories as child
    where child.parent_category_id = old.id
      and child.space_id = old.space_id
      and child.kind = old.kind
      and child.archived_at is null
    limit 1
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'archive active subcategories before archiving their parent';
  end if;

  return new;
end;
$$;


ALTER FUNCTION private.guard_category_archive_transition() OWNER TO postgres;

--
-- Name: guard_wallet_update(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.guard_wallet_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_owner_name name;
begin
  select pg_catalog.pg_get_userbyid(relation.relowner)
  into v_owner_name
  from pg_catalog.pg_class as relation
  where relation.oid = tg_relid;

  if current_user <> v_owner_name then
    raise exception using
      errcode = '42501',
      message = 'protected rows may be written only by their owning command';
  end if;

  if new.id is distinct from old.id
    or new.space_id is distinct from old.space_id
    or new.currency is distinct from old.currency
    or new.created_at is distinct from old.created_at
    or (old.archived_at is not null
      and new.archived_at is not null
      and new.archived_at is distinct from old.archived_at) then
    raise exception using
      errcode = '42501',
      message = 'wallets may change only their name and archive state';
  end if;

  return new;
end;
$$;


ALTER FUNCTION private.guard_wallet_update() OWNER TO postgres;

--
-- Name: household_actor_email_confirmed(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.household_actor_email_confirmed() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from auth.users as account
    where account.id = auth.uid()
      and account.email is not null
      and account.email_confirmed_at is not null
  );
$$;


ALTER FUNCTION private.household_actor_email_confirmed() OWNER TO postgres;

--
-- Name: household_actor_identity_digest(smallint); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.household_actor_identity_digest(p_key_version smallint) RETURNS bytea
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select private.household_identity_digest(
    p_key_version,
    private.normalize_household_invitee_email(account.email)
  )
  from auth.users as account
  where account.id = auth.uid()
    and account.email is not null
    and account.email_confirmed_at is not null;
$$;


ALTER FUNCTION private.household_actor_identity_digest(p_key_version smallint) OWNER TO postgres;

--
-- Name: household_actor_user_id(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.household_actor_user_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select auth.uid();
$$;


ALTER FUNCTION private.household_actor_user_id() OWNER TO postgres;

--
-- Name: household_command_fingerprint(text); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.household_command_fingerprint(p_canonical_input text) RETURNS bytea
    LANGUAGE sql IMMUTABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
  select extensions.digest(convert_to(p_canonical_input, 'UTF8'), 'sha256');
$$;


ALTER FUNCTION private.household_command_fingerprint(p_canonical_input text) OWNER TO postgres;

--
-- Name: household_execute_invitation_creation(uuid, uuid, text); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.household_execute_invitation_creation(p_space_id uuid, p_request_id uuid, p_invitee_email text) RETURNS TABLE(invitation_id uuid, invitation_token text, expires_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor_id uuid := private.household_actor_user_id();
  v_normalized_email text;
  v_key_version smallint;
  v_identity_digest bytea;
  v_fingerprint bytea;
  v_existing_event public.household_membership_events%rowtype;
  v_existing_invitation public.household_invitations%rowtype;
  v_space_kind public.space_kind;
  v_invitation_id uuid;
  v_token text;
  v_created_at timestamptz := now();
  v_expires_at timestamptz;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_request_id is null or p_space_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  v_normalized_email := private.normalize_household_invitee_email(p_invitee_email);
  perform private.lock_household_request(v_actor_id, p_request_id);

  select event.*
  into v_existing_event
  from public.household_membership_events as event
  where event.actor_user_id = v_actor_id
    and event.request_id = p_request_id;

  if found then
    if v_existing_event.kind <> 'invitation_created'
      or v_existing_event.invitation_id is null then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;

    select invitation.*
    into v_existing_invitation
    from public.household_invitations as invitation
    where invitation.id = v_existing_event.invitation_id;

    v_identity_digest := private.household_identity_digest(
      v_existing_invitation.key_version,
      v_normalized_email
    );
    v_fingerprint := private.household_command_fingerprint(
      'create_household_invitation|'
        || p_space_id::text || '|'
        || encode(v_identity_digest, 'hex')
    );

    if v_existing_invitation.space_id <> p_space_id
      or v_existing_event.request_fingerprint <> v_fingerprint then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;

    v_token := private.derive_household_invitation_token(
      v_existing_invitation.key_version,
      v_actor_id,
      p_request_id,
      p_space_id,
      v_identity_digest
    );
    return query
    select v_existing_invitation.id, v_token, v_existing_invitation.expires_at;
    return;
  end if;

  v_key_version := private.active_household_invitation_key_version();
  v_identity_digest := private.household_identity_digest(v_key_version, v_normalized_email);
  v_fingerprint := private.household_command_fingerprint(
    'create_household_invitation|'
      || p_space_id::text || '|'
      || encode(v_identity_digest, 'hex')
  );

  v_space_kind := private.lock_household_space(p_space_id);
  if v_space_kind is null then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;
  if v_space_kind <> 'household' then
    raise exception using errcode = 'P0001', message = 'personal_space_prohibited';
  end if;
  if not private.is_active_owner(p_space_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  perform private.lock_household_invitee(p_space_id, v_identity_digest);

  if private.household_has_active_identity(
    p_space_id,
    v_key_version,
    v_identity_digest
  ) then
    raise exception using errcode = 'P0001', message = 'membership_already_active';
  end if;

  if exists (
    select 1
    from public.household_invitations as invitation
    where invitation.space_id = p_space_id
      and invitation.invitee_identity_digest = v_identity_digest
      and invitation.status = 'pending'
      and invitation.expires_at > v_created_at
  ) then
    raise exception using errcode = 'P0001', message = 'invitation_already_pending';
  end if;

  v_invitation_id := extensions.gen_random_uuid();
  v_token := private.derive_household_invitation_token(
    v_key_version,
    v_actor_id,
    p_request_id,
    p_space_id,
    v_identity_digest
  );
  v_expires_at := v_created_at + interval '7 days';

  insert into public.household_invitations (
    id, space_id, key_version, invitee_identity_digest, token_digest, status,
    created_by_user_id, created_at, expires_at
  )
  values (
    v_invitation_id, p_space_id, v_key_version, v_identity_digest,
    private.household_invitation_token_digest(v_token), 'pending',
    v_actor_id, v_created_at, v_expires_at
  );

  insert into public.household_membership_events (
    space_id, actor_user_id, request_id, request_fingerprint,
    kind, invitation_id, occurred_at
  )
  values (
    p_space_id, v_actor_id, p_request_id, v_fingerprint,
    'invitation_created', v_invitation_id, v_created_at
  );

  return query select v_invitation_id, v_token, v_expires_at;
end;
$$;


ALTER FUNCTION private.household_execute_invitation_creation(p_space_id uuid, p_request_id uuid, p_invitee_email text) OWNER TO postgres;

--
-- Name: household_execute_invitation_listing(uuid, integer, timestamp with time zone, uuid); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.household_execute_invitation_listing(p_space_id uuid, p_limit integer DEFAULT 50, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid) RETURNS TABLE(invitation_id uuid, effective_status text, created_at timestamp with time zone, expires_at timestamp with time zone, accepted_at timestamp with time zone, cancelled_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  if p_limit is null or p_limit not between 1 and 100
    or ((p_after_created_at is null) <> (p_after_id is null)) then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if private.household_actor_user_id() is null
    or private.household_space_kind(p_space_id) <> 'household'
    or not private.is_active_owner(p_space_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  return query
  select invitation.id,
         case when invitation.status = 'pending' and invitation.expires_at <= now()
           then 'expired' else invitation.status::text end,
         invitation.created_at, invitation.expires_at,
         invitation.accepted_at, invitation.cancelled_at
  from public.household_invitations as invitation
  where invitation.space_id = p_space_id
    and (p_after_created_at is null
      or (invitation.created_at, invitation.id) < (p_after_created_at, p_after_id))
  order by invitation.created_at desc, invitation.id desc
  limit p_limit;
end;
$$;


ALTER FUNCTION private.household_execute_invitation_listing(p_space_id uuid, p_limit integer, p_after_created_at timestamp with time zone, p_after_id uuid) OWNER TO postgres;

--
-- Name: household_execute_member_listing(uuid, integer, uuid); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.household_execute_member_listing(p_space_id uuid, p_limit integer DEFAULT 50, p_after_user_id uuid DEFAULT NULL::uuid) RETURNS TABLE(user_id uuid, role public.member_role, status public.membership_status, created_at timestamp with time zone, activated_at timestamp with time zone, ended_at timestamp with time zone, is_self boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_actor_id uuid := private.household_actor_user_id();
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if v_actor_id is null or private.household_space_kind(p_space_id) <> 'household'
    or not private.is_active_owner(p_space_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  return query
  select membership.user_id, membership.role, membership.status,
         membership.created_at, membership.activated_at, membership.ended_at,
         membership.user_id = v_actor_id
  from public.space_memberships as membership
  where membership.space_id = p_space_id
    and (p_after_user_id is null or membership.user_id > p_after_user_id)
  order by membership.user_id
  limit p_limit;
end;
$$;


ALTER FUNCTION private.household_execute_member_listing(p_space_id uuid, p_limit integer, p_after_user_id uuid) OWNER TO postgres;

--
-- Name: household_has_active_identity(uuid, smallint, bytea); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.household_has_active_identity(p_space_id uuid, p_key_version smallint, p_identity_digest bytea) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.space_memberships as membership
    join auth.users as account on account.id = membership.user_id
    where membership.space_id = p_space_id
      and membership.status = 'active'
      and account.email is not null
      and private.household_identity_digest(
        p_key_version,
        private.normalize_household_invitee_email(account.email)
      ) = p_identity_digest
  );
$$;


ALTER FUNCTION private.household_has_active_identity(p_space_id uuid, p_key_version smallint, p_identity_digest bytea) OWNER TO postgres;

--
-- Name: household_identity_digest(smallint, text); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.household_identity_digest(p_key_version smallint, p_normalized_email text) RETURNS bytea
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_key bytea;
begin
  select keyring.identity_hmac_key
  into v_key
  from private.household_invitation_keys as keyring
  where keyring.key_version = p_key_version;

  if not found then
    raise exception using errcode = '55000', message = 'invitation_key_unavailable';
  end if;

  return extensions.hmac(
    convert_to('household-invitation-identity-v1|' || p_normalized_email, 'UTF8'),
    v_key,
    'sha256'
  );
end;
$$;


ALTER FUNCTION private.household_identity_digest(p_key_version smallint, p_normalized_email text) OWNER TO postgres;

--
-- Name: household_invitation_token_digest(text); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.household_invitation_token_digest(p_token text) RETURNS bytea
    LANGUAGE sql IMMUTABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
  select extensions.digest(convert_to(p_token, 'UTF8'), 'sha256');
$$;


ALTER FUNCTION private.household_invitation_token_digest(p_token text) OWNER TO postgres;

--
-- Name: household_space_kind(uuid); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.household_space_kind(p_space_id uuid) RETURNS public.space_kind
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select space.kind from public.spaces as space where space.id = p_space_id;
$$;


ALTER FUNCTION private.household_space_kind(p_space_id uuid) OWNER TO postgres;

--
-- Name: is_active_member(uuid); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.is_active_member(p_space_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.space_memberships as membership
    where membership.space_id = p_space_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  );
$$;


ALTER FUNCTION private.is_active_member(p_space_id uuid) OWNER TO postgres;

--
-- Name: is_active_owner(uuid); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.is_active_owner(p_space_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.space_memberships as membership
    where membership.space_id = p_space_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and membership.role = 'owner'
  );
$$;


ALTER FUNCTION private.is_active_owner(p_space_id uuid) OWNER TO postgres;

--
-- Name: lock_category_request(uuid, uuid); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.lock_category_request(p_space_id uuid, p_request_id uuid) RETURNS void
    LANGUAGE sql
    SET search_path TO 'pg_catalog'
    AS $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('category:' || p_space_id::text || ':' || p_request_id::text, 0)
  );
$$;


ALTER FUNCTION private.lock_category_request(p_space_id uuid, p_request_id uuid) OWNER TO postgres;

--
-- Name: lock_financial_request(uuid, uuid); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.lock_financial_request(p_space_id uuid, p_request_id uuid) RETURNS void
    LANGUAGE sql
    SET search_path TO 'pg_catalog'
    AS $$
  select pg_advisory_xact_lock(hashtextextended(p_space_id::text || ':' || p_request_id::text, 0));
$$;


ALTER FUNCTION private.lock_financial_request(p_space_id uuid, p_request_id uuid) OWNER TO postgres;

--
-- Name: lock_household_invitee(uuid, bytea); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.lock_household_invitee(p_space_id uuid, p_identity_digest bytea) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select pg_advisory_xact_lock(
    hashtextextended(p_space_id::text || ':' || encode(p_identity_digest, 'hex'), 7422)
  );
$$;


ALTER FUNCTION private.lock_household_invitee(p_space_id uuid, p_identity_digest bytea) OWNER TO postgres;

--
-- Name: lock_household_request(uuid, uuid); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.lock_household_request(p_actor_user_id uuid, p_request_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select pg_advisory_xact_lock(
    hashtextextended(p_actor_user_id::text || ':' || p_request_id::text, 7421)
  );
$$;


ALTER FUNCTION private.lock_household_request(p_actor_user_id uuid, p_request_id uuid) OWNER TO postgres;

--
-- Name: lock_household_space(uuid); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.lock_household_space(p_space_id uuid) RETURNS public.space_kind
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select space.kind
  from public.spaces as space
  where space.id = p_space_id
  for update;
$$;


ALTER FUNCTION private.lock_household_space(p_space_id uuid) OWNER TO postgres;

--
-- Name: lock_planning_actor(uuid); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.lock_planning_actor(p_space_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or p_space_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  perform 1 from public.spaces where id=p_space_id for update;
  if not found or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  return v_actor;
end; $$;


ALTER FUNCTION private.lock_planning_actor(p_space_id uuid) OWNER TO postgres;

--
-- Name: lock_space_wallet(uuid, uuid); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.lock_space_wallet(p_space_id uuid, p_wallet_id uuid) RETURNS public.wallets
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_wallet public.wallets;
begin
  select wallet.*
  into v_wallet
  from public.wallets as wallet
  where wallet.id = p_wallet_id
    and wallet.space_id = p_space_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'the wallet does not belong to the requested space';
  end if;

  return v_wallet;
end;
$$;


ALTER FUNCTION private.lock_space_wallet(p_space_id uuid, p_wallet_id uuid) OWNER TO postgres;

--
-- Name: month_copy_preview(uuid, public.currency_code, bigint, date); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.month_copy_preview(p_space_id uuid, p_currency public.currency_code, p_source_snapshot_id bigint, p_target_month date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_source public.allocation_month_snapshots%rowtype;
  v_distance integer;
  v_target_head bigint;
  v_income_head bigint;
  v_loan_group uuid;
  v_close_id bigint;
  v_roots jsonb;
  v_carry jsonb;
  v_root_omissions jsonb;
  v_root_count integer;
  v_goals jsonb;
  v_goal_omissions jsonb;
  v_goal_count integer;
  v_groups jsonb;
  v_omissions jsonb;
  v_preview jsonb;
begin
  select * into v_source from public.allocation_month_snapshots
    where id = p_source_snapshot_id and space_id = p_space_id and currency = p_currency;
  if not found then
    raise exception using errcode='P0001', message='month_copy_source_not_found';
  end if;

  v_distance := 12 * (extract(year from p_target_month)::integer - extract(year from v_source.month_start)::integer)
    + (extract(month from p_target_month)::integer - extract(month from v_source.month_start)::integer);
  if v_distance = 0 or abs(v_distance) > 24 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  select id into v_target_head from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = p_target_month
    order by id desc limit 1;
  select id into v_income_head from public.monthly_budget_plan_revisions
    where space_id = p_space_id and currency = p_currency and month_start = p_target_month and plan_kind = 'income'
    order by id desc limit 1;
  select group_id into v_loan_group from public.allocation_month_commitments where snapshot_id = v_source.id;
  select id into v_close_id from public.budget_month_closes
    where space_id = p_space_id and currency = p_currency
      and month_start = (p_target_month - interval '1 month')::date
    order by id desc limit 1;

  with source_roots as (
    select source_root.category_id, source_root.target_minor
    from public.allocation_month_roots source_root where source_root.snapshot_id = v_source.id
  ), destination_positive as (
    -- Mirrors publish_allocation_month_v2's complete-set rule exactly.
    select distinct revision.category_id
    from public.monthly_budget_plan_revisions revision
    where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = p_target_month
      and revision.plan_kind = 'expense_category' and revision.amount_minor > 0
  ), carry_candidates as (
    select close_root.root_id, close_root.outgoing_carry_minor
    from public.budget_month_close_roots close_root
    where close_root.close_id = v_close_id and close_root.enabled
  ), candidate_ids as (
    select category_id from source_roots
    union select category_id from destination_positive
    union select root_id from carry_candidates where outgoing_carry_minor <> 0
    union select template_root.category_id from public.allocation_template_roots template_root
      where template_root.template_id = v_source.template_revision_id
  ), resolved as (
    select category.id as category_id, category.name_en, category.name_ar,
      category.archived_at is not null as archived,
      template_root.group_id,
      source_roots.category_id is not null as in_source,
      source_roots.target_minor as source_target,
      destination_positive.category_id is not null as destination_positive,
      carry_candidates.outgoing_carry_minor as close_carry
    from candidate_ids
    join public.categories category on category.id = candidate_ids.category_id and category.space_id = p_space_id
    left join source_roots on source_roots.category_id = candidate_ids.category_id
    left join public.allocation_template_roots template_root
      on template_root.template_id = v_source.template_revision_id and template_root.category_id = candidate_ids.category_id
    left join destination_positive on destination_positive.category_id = candidate_ids.category_id
    left join carry_candidates on carry_candidates.root_id = candidate_ids.category_id
  ), included as (
    select resolved.*,
      case when resolved.in_source and not resolved.archived then resolved.source_target else 0 end as base_minor,
      case when not resolved.archived then resolved.close_carry else null end as link_carry,
      head.id as expected_revision_id
    from resolved
    left join lateral (
      select revision.id from public.monthly_budget_plan_revisions revision
      where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = p_target_month
        and revision.plan_kind = 'expense_category' and revision.category_id = resolved.category_id
      order by revision.id desc limit 1
    ) head on true
    where (resolved.in_source and not resolved.archived) or resolved.group_id is not null
      or resolved.destination_positive or (not resolved.archived and coalesce(resolved.close_carry, 0) <> 0)
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
        'categoryId', included.category_id, 'nameEn', included.name_en, 'nameAr', included.name_ar,
        'groupId', included.group_id, 'baseMinor', included.base_minor::text,
        'carryMinor', coalesce(included.link_carry, 0)::text,
        'effectiveMinor', (included.base_minor + coalesce(included.link_carry, 0))::text,
        'actualMinor', null, 'outgoingCarryMinor', null,
        'expectedRevisionId', included.expected_revision_id::text
      ) order by included.category_id), '[]'::jsonb) from included),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'rootId', included.category_id, 'sourceCloseId', v_close_id::text, 'carryMinor', included.link_carry::text
      ) order by included.category_id), '[]'::jsonb) from included where included.link_carry is not null),
    (select coalesce(jsonb_agg(omission.value), '[]'::jsonb) from (
        select jsonb_build_object('entityId', resolved.category_id, 'kind', 'root', 'reason', 'archived') as value
        from resolved where resolved.in_source and resolved.archived
        union all
        select jsonb_build_object('entityId', resolved.category_id, 'kind', 'carry', 'reason', 'archived')
        from resolved where resolved.archived and coalesce(resolved.close_carry, 0) <> 0
      ) omission),
    (select count(*) from included)
  into v_roots, v_carry, v_root_omissions, v_root_count;
  if v_root_count > 200 then
    raise exception using errcode='P0001', message='month_copy_too_many_roots';
  end if;

  with source_goals as (
    select goal_line.goal_id, goal_line.group_id, goal_line.amount_minor
    from public.allocation_month_goal_lines goal_line where goal_line.snapshot_id = v_source.id
  ), destination_positive_goals as (
    select latest.goal_id from (
      select distinct on (revision.goal_id) revision.goal_id, revision.amount_minor
      from public.goal_monthly_target_revisions revision
      where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = p_target_month
      order by revision.goal_id, revision.id desc
    ) latest where latest.amount_minor > 0
  ), candidate_goals as (
    select goal_id from source_goals union select goal_id from destination_positive_goals
  ), resolved_goals as (
    select candidate_goals.goal_id, goal_state.state,
      source_goals.goal_id is not null as in_source, source_goals.group_id, source_goals.amount_minor,
      destination_positive_goals.goal_id is not null as destination_positive,
      head.id as expected_revision_id
    from candidate_goals
    join lateral (
      select revision.state from public.goal_revisions revision
      where revision.goal_id = candidate_goals.goal_id order by revision.id desc limit 1
    ) goal_state on true
    left join source_goals on source_goals.goal_id = candidate_goals.goal_id
    left join destination_positive_goals on destination_positive_goals.goal_id = candidate_goals.goal_id
    left join lateral (
      select revision.id from public.goal_monthly_target_revisions revision
      where revision.goal_id = candidate_goals.goal_id and revision.month_start = p_target_month
      order by revision.id desc limit 1
    ) head on true
  ), included_goals as (
    select resolved_goals.goal_id,
      case when resolved_goals.in_source and resolved_goals.state = 'active' then resolved_goals.group_id else null end as group_id,
      case when resolved_goals.in_source and resolved_goals.state = 'active' then resolved_goals.amount_minor else 0 end as target_minor,
      resolved_goals.expected_revision_id
    from resolved_goals
    where (resolved_goals.in_source and resolved_goals.state = 'active') or resolved_goals.destination_positive
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
        'goalId', included_goals.goal_id, 'groupId', included_goals.group_id,
        'targetMinor', included_goals.target_minor::text,
        'expectedRevisionId', included_goals.expected_revision_id::text
      ) order by included_goals.goal_id), '[]'::jsonb) from included_goals),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'entityId', resolved_goals.goal_id, 'kind', 'goal', 'reason', resolved_goals.state
      )), '[]'::jsonb) from resolved_goals where resolved_goals.in_source and resolved_goals.state <> 'active'),
    (select count(*) from included_goals)
  into v_goals, v_goal_omissions, v_goal_count;
  if v_goal_count > 100 then
    raise exception using errcode='P0001', message='month_copy_too_many_goals';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'groupId', month_group.group_id, 'nameEn', month_group.name_en, 'nameAr', month_group.name_ar,
      'purpose', month_group.purpose, 'order', month_group.display_order, 'basisPoints', month_group.basis_points,
      'targetMinor', month_group.target_minor::text,
      'carryMinor', coalesce(group_carry.carry_minor, 0)::text,
      'effectiveMinor', (month_group.target_minor + coalesce(group_carry.carry_minor, 0))::text
    ) order by month_group.display_order), '[]'::jsonb)
  into v_groups
  from public.allocation_month_groups month_group
  left join (
    select (root->>'groupId')::uuid as group_id, sum((root->>'carryMinor')::numeric) as carry_minor
    from jsonb_array_elements(v_roots) root
    where root->>'groupId' is not null
    group by (root->>'groupId')::uuid
  ) group_carry on group_carry.group_id = month_group.group_id
  where month_group.snapshot_id = v_source.id;

  select coalesce(jsonb_agg(omission order by omission->>'kind', (omission->>'entityId') collate "C"), '[]'::jsonb)
    into v_omissions
    from jsonb_array_elements(v_root_omissions || v_goal_omissions) omission;

  v_preview := jsonb_build_object(
    'sourceSnapshotId', v_source.id::text, 'sourceMonth', v_source.month_start, 'targetMonth', p_target_month,
    'currency', p_currency, 'expectedTargetSnapshotId', v_target_head::text,
    'templateRevisionId', v_source.template_revision_id::text, 'expectedIncomeRevisionId', v_income_head::text,
    'incomeMinor', v_source.base_income_minor::text, 'loanGroupId', v_loan_group,
    'carryCloseId', v_close_id::text,
    'groups', v_groups, 'roots', v_roots, 'goals', v_goals, 'omissions', v_omissions, 'carrySources', v_carry
  );
  return v_preview || jsonb_build_object('previewHash', encode(extensions.digest(jsonb_build_object(
    'version', 1, 'kind', 'month_copy', 'spaceId', p_space_id, 'preview', v_preview
  )::text, 'sha256'), 'hex'));
end;
$$;


ALTER FUNCTION private.month_copy_preview(p_space_id uuid, p_currency public.currency_code, p_source_snapshot_id bigint, p_target_month date) OWNER TO postgres;

--
-- Name: normalize_household_invitee_email(text); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.normalize_household_invitee_email(p_email text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_email text := lower(btrim(p_email));
begin
  if p_email is null
    or octet_length(v_email) not between 3 and 254
    or v_email ~ '[[:space:][:cntrl:]]'
    or length(v_email) - length(replace(v_email, '@', '')) <> 1
    or split_part(v_email, '@', 1) = ''
    or split_part(v_email, '@', 2) = '' then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  return v_email;
end;
$$;


ALTER FUNCTION private.normalize_household_invitee_email(p_email text) OWNER TO postgres;

--
-- Name: parse_nonnegative_minor_amount(text); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.parse_nonnegative_minor_amount(p_amount_minor text) RETURNS bigint
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog'
    AS $_$
begin
  if p_amount_minor is null or p_amount_minor !~ '^(0|[1-9][0-9]{0,14})$' then
    raise exception using
      errcode = 'P0001',
      message = 'amount must be a nonnegative integer minor-unit value within the allowed bound';
  end if;

  return p_amount_minor::bigint;
end;
$_$;


ALTER FUNCTION private.parse_nonnegative_minor_amount(p_amount_minor text) OWNER TO postgres;

--
-- Name: parse_positive_minor_amount(text); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.parse_positive_minor_amount(p_amount_minor text) RETURNS bigint
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog'
    AS $_$
begin
  if p_amount_minor is null or p_amount_minor !~ '^[1-9][0-9]{0,14}$' then
    raise exception using
      errcode = 'P0001',
      message = 'amount must be a positive integer minor-unit value within the allowed bound';
  end if;

  return p_amount_minor::bigint;
end;
$_$;


ALTER FUNCTION private.parse_positive_minor_amount(p_amount_minor text) OWNER TO postgres;

--
-- Name: planning_cash_commitments(uuid, public.currency_code, date); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.planning_cash_commitments(p_space_id uuid, p_currency public.currency_code, p_as_of date) RETURNS TABLE(group_id uuid, group_target_minor numeric, debt_commitment_minor numeric, goal_topups_minor numeric, saved_goal_targets_minor numeric, original_debt_commitment_minor numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_month date := date_trunc('month', p_as_of)::date;
  v_month_end date := (v_month + interval '1 month - 1 day')::date;
  v_snapshot_id bigint;
  v_has_snapshot boolean := false;
  v_commitment_group_id uuid;
  v_commitment_original numeric := 0;
  v_live_debt numeric := 0;
begin
  select id into v_snapshot_id from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = v_month
    order by id desc limit 1;
  v_has_snapshot := v_snapshot_id is not null;

  if v_has_snapshot then
    select commitment.group_id, commitment.observed_actual_minor + commitment.observed_remaining_minor
      into v_commitment_group_id, v_commitment_original
      from public.allocation_month_commitments commitment where commitment.snapshot_id = v_snapshot_id;
  end if;

  select coalesce(sum(greatest(plan.remaining_reservation_minor, coalesce(sched.remaining_minor, 0))), 0)
    into v_live_debt
  from public.loan_monthly_plan(p_space_id, v_month) plan
  left join (
    select so.loan_id, sum(greatest(so.expected_minor - stl.settled_minor, 0)) as remaining_minor
    from public.scheduled_occurrences so
    cross join lateral private.schedule_occurrence_settlement(so.id, p_as_of) stl
    where so.space_id = p_space_id and so.currency = p_currency and so.loan_id is not null
      and so.due_date <= v_month_end and not stl.skipped
      and greatest(so.expected_minor - stl.settled_minor, 0) > 0
    group by so.loan_id
  ) sched on sched.loan_id = plan.loan_id
  where plan.currency = p_currency and plan.direction = 'i_owe_them';

  return query
  with buckets as (
    select month_group.group_id as bucket_id, month_group.target_minor::numeric as bucket_target
    from public.allocation_month_groups month_group
    where v_has_snapshot and month_group.snapshot_id = v_snapshot_id and month_group.purpose = 'future'
    union all
    select null::uuid, null::numeric
  ), goal_rows as (
    select relevant.goal_id,
      saved.group_id as bucket_id,
      coalesce(saved.amount_minor, 0)::numeric as saved_target,
      greatest(coalesce(saved.amount_minor, 0) - coalesce((
        select sum(el.amount_minor) from public.goal_earmark_lines el
        join public.goal_earmark_events ge on ge.id = el.event_id
        where el.goal_id = relevant.goal_id and date_trunc('month', ge.effective_date)::date = v_month
      ), 0), 0) as u_minor
    from private.goal_coverage_set(p_space_id, p_currency, p_as_of) relevant
    left join public.allocation_month_goal_lines saved
      on v_has_snapshot and saved.snapshot_id = v_snapshot_id and saved.goal_id = relevant.goal_id
  )
  -- Debt attaches to whichever bucket the snapshot's loan pool names
  -- (v_commitment_group_id, defaulting to null/standalone when no snapshot
  -- exists at all) -- never gated on v_has_snapshot itself, so a live debt
  -- fact still surfaces via the standalone bucket even before any month is
  -- ever published.
  select buckets.bucket_id, buckets.bucket_target,
    case when buckets.bucket_id is not distinct from v_commitment_group_id then v_live_debt else 0 end,
    coalesce((select sum(goal_rows.u_minor) from goal_rows where goal_rows.bucket_id is not distinct from buckets.bucket_id), 0),
    coalesce((select sum(goal_rows.saved_target) from goal_rows where goal_rows.bucket_id is not distinct from buckets.bucket_id), 0),
    case when buckets.bucket_id is not distinct from v_commitment_group_id then coalesce(v_commitment_original, 0) else 0 end
  from buckets;
end;
$$;


ALTER FUNCTION private.planning_cash_commitments(p_space_id uuid, p_currency public.currency_code, p_as_of date) OWNER TO postgres;

--
-- Name: planning_child_request(uuid, text); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.planning_child_request(p_parent uuid, p_operation text) RETURNS uuid
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare v_bytes bytea; v_hex text;
begin
  if p_parent is null or p_operation is null or char_length(p_operation) not between 1 and 120 then
    raise exception using errcode='22023',message='planning_invalid_input';
  end if;
  v_bytes:=substring(extensions.digest(jsonb_build_array(p_parent,p_operation)::text,'sha256') from 1 for 16);
  v_bytes:=set_byte(v_bytes,6,(get_byte(v_bytes,6) & 15) | 128);
  v_bytes:=set_byte(v_bytes,8,(get_byte(v_bytes,8) & 63) | 128);
  v_hex:=encode(v_bytes,'hex');
  return (substring(v_hex,1,8)||'-'||substring(v_hex,9,4)||'-'||
    substring(v_hex,13,4)||'-'||substring(v_hex,17,4)||'-'||substring(v_hex,21,12))::uuid;
end; $$;


ALTER FUNCTION private.planning_child_request(p_parent uuid, p_operation text) OWNER TO postgres;

--
-- Name: planning_expense_buckets(uuid, public.currency_code, date, date, date); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.planning_expense_buckets(p_space_id uuid, p_currency public.currency_code, p_as_of date, p_month_end date, p_horizon_end date) RETURNS TABLE(group_id uuid, root_id uuid, budget_remaining_minor numeric, unpaid_bills_minor numeric, goal_overlap_minor numeric, commitment_minor numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  with snapshot as (
    select id from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = date_trunc('month', p_as_of)::date
    order by id desc limit 1
  ), root_targets as (
    select r.category_id as root_id, r.group_id,
      r.target_minor::numeric + coalesce(link.carry_minor, 0) as target_minor
    from public.allocation_month_roots r
    left join public.budget_month_carry_links link
      on link.target_snapshot_id = r.snapshot_id and link.root_id = r.category_id
    where r.snapshot_id = (select id from snapshot)
  ), group_targets as (
    select g.group_id,
      g.target_minor::numeric + coalesce((
        select sum(link.carry_minor)
        from public.budget_month_carry_links link
        join public.allocation_month_roots r on r.snapshot_id = link.target_snapshot_id and r.category_id = link.root_id
        where link.target_snapshot_id = g.snapshot_id and r.group_id = g.group_id
      ), 0) as target_minor
    from public.allocation_month_groups g
    where g.snapshot_id = (select id from snapshot) and g.purpose = 'spending'
  ), spent as (
    select act.root_id, sum(act.expense_minor) as spent_minor
    from private.planning_ordinary_activity(p_space_id, date_trunc('month', p_as_of)::date, p_as_of + 1) act
    where act.currency = p_currency and act.root_id is not null
    group by act.root_id
  ), unpaid_bills as (
    select coalesce(cat.parent_category_id, cat.id) as root_id, so.id as occurrence_id,
      greatest(so.expected_minor - stl.settled_minor, 0) as remaining_minor
    from public.scheduled_occurrences so
    join public.schedules sch on sch.id = so.schedule_id and sch.space_id = p_space_id and sch.kind = 'expense'
    left join public.categories cat on cat.id = so.category_id and cat.space_id = p_space_id
    cross join lateral private.schedule_occurrence_settlement(so.id, p_as_of) stl
    where so.space_id = p_space_id and so.currency = p_currency
      and so.due_date <= p_month_end and not stl.skipped
      and greatest(so.expected_minor - stl.settled_minor, 0) > 0
  ), coverage as (
    select * from private.planning_goal_bill_coverage(p_space_id, p_currency, p_as_of, p_horizon_end)
  ), bill_totals as (
    select unpaid_bills.root_id, sum(unpaid_bills.remaining_minor) as o_minor,
      coalesce(sum(coverage.applied_minor), 0) as g_minor
    from unpaid_bills
    left join coverage on coverage.occurrence_id = unpaid_bills.occurrence_id
    group by unpaid_bills.root_id
  ), mapped_group_totals as (
    select root_targets.group_id,
      coalesce(sum(spent.spent_minor), 0) as spent_minor,
      coalesce(sum(bill_totals.o_minor), 0) as o_minor,
      coalesce(sum(bill_totals.g_minor), 0) as g_minor
    from root_targets
    left join spent on spent.root_id = root_targets.root_id
    left join bill_totals on bill_totals.root_id = root_targets.root_id
    where root_targets.group_id is not null
    group by root_targets.group_id
  ), group_buckets as (
    select group_targets.group_id, null::uuid as root_id,
      greatest(group_targets.target_minor - coalesce(mapped_group_totals.spent_minor, 0), 0) as b_minor,
      coalesce(mapped_group_totals.o_minor, 0) as o_minor, coalesce(mapped_group_totals.g_minor, 0) as g_minor
    from group_targets
    left join mapped_group_totals on mapped_group_totals.group_id = group_targets.group_id
  ), unmapped_root_buckets as (
    select null::uuid as group_id, root_targets.root_id,
      greatest(root_targets.target_minor - coalesce(spent.spent_minor, 0), 0) as b_minor,
      coalesce(bill_totals.o_minor, 0) as o_minor, coalesce(bill_totals.g_minor, 0) as g_minor
    from root_targets
    left join spent on spent.root_id = root_targets.root_id
    left join bill_totals on bill_totals.root_id = root_targets.root_id
    where root_targets.group_id is null
  ), untargeted_bill_buckets as (
    select null::uuid as group_id, bill_totals.root_id,
      0::numeric as b_minor, bill_totals.o_minor, bill_totals.g_minor
    from bill_totals
    where not exists (
      select 1 from root_targets where root_targets.root_id is not distinct from bill_totals.root_id
    )
  ), buckets as (
    select * from group_buckets
    union all select * from unmapped_root_buckets
    union all select * from untargeted_bill_buckets
  )
  select buckets.group_id, buckets.root_id, buckets.b_minor, buckets.o_minor, buckets.g_minor,
    greatest(buckets.b_minor, buckets.o_minor) - least(buckets.g_minor, greatest(buckets.b_minor, buckets.o_minor))
  from buckets;
$$;


ALTER FUNCTION private.planning_expense_buckets(p_space_id uuid, p_currency public.currency_code, p_as_of date, p_month_end date, p_horizon_end date) OWNER TO postgres;

--
-- Name: planning_fingerprint(text, uuid, jsonb); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.planning_fingerprint(p_command text, p_actor uuid, p_payload jsonb) RETURNS bytea
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
  select extensions.digest(jsonb_build_object(
    'version',1,'command',p_command,'actor',p_actor,'payload',p_payload)::text,'sha256')
$$;


ALTER FUNCTION private.planning_fingerprint(p_command text, p_actor uuid, p_payload jsonb) OWNER TO postgres;

--
-- Name: planning_goal_bill_coverage(uuid, public.currency_code, date, date); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.planning_goal_bill_coverage(p_space_id uuid, p_currency public.currency_code, p_as_of date, p_horizon_end date) RETURNS TABLE(occurrence_id uuid, goal_id uuid, applied_minor numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  with coverage as (
    select goal_id, covered_minor from private.goal_coverage_set(p_space_id, p_currency, p_as_of)
    where kind = 'purchase' and covered_minor > 0
  ), linked as (
    select cov.goal_id, cov.covered_minor, so.id as occurrence_id, so.due_date,
      greatest(so.expected_minor - stl.settled_minor, 0) as remaining_minor
    from coverage cov
    join public.scheduled_occurrences so
      on so.funding_goal_id = cov.goal_id and so.space_id = p_space_id and so.currency = p_currency
    cross join lateral private.schedule_occurrence_settlement(so.id, p_as_of) stl
    where so.due_date <= p_horizon_end and not stl.skipped
      and greatest(so.expected_minor - stl.settled_minor, 0) > 0
  ), ranked as (
    select linked.*, coalesce(sum(remaining_minor) over (
      partition by goal_id order by due_date, occurrence_id
      rows between unbounded preceding and 1 preceding
    ), 0) as prior_remaining_minor
    from linked
  )
  select occurrence_id, goal_id,
    least(remaining_minor, greatest(covered_minor - prior_remaining_minor, 0)) as applied_minor
  from ranked;
$$;


ALTER FUNCTION private.planning_goal_bill_coverage(p_space_id uuid, p_currency public.currency_code, p_as_of date, p_horizon_end date) OWNER TO postgres;

--
-- Name: planning_guard_insert(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.planning_guard_insert() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
declare v_owner name;
begin
  select r.rolname into v_owner from pg_catalog.pg_class c
  join pg_catalog.pg_roles r on r.oid=c.relowner where c.oid=tg_relid;
  if current_user is distinct from v_owner then
    raise exception using errcode='42501', message='planning_command_required';
  end if;
  return new;
end; $$;


ALTER FUNCTION private.planning_guard_insert() OWNER TO postgres;

--
-- Name: planning_materialization_gap(uuid, public.currency_code, date, date); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.planning_materialization_gap(p_space_id uuid, p_currency public.currency_code, p_from date, p_to date) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select count(*)::integer
  from private.schedule_occurrence_candidates(p_space_id, p_from, p_to) c
  where c.currency = p_currency
    and not exists (
      select 1 from public.scheduled_occurrences so where so.schedule_id = c.schedule_id and so.due_date = c.due_date
    );
$$;


ALTER FUNCTION private.planning_materialization_gap(p_space_id uuid, p_currency public.currency_code, p_from date, p_to date) OWNER TO postgres;

--
-- Name: planning_minor(text, boolean); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.planning_minor(p_value text, p_positive boolean DEFAULT false) RETURNS bigint
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog'
    AS $_$
begin
  if p_value is null or p_positive is null
    or p_value !~ '^(0|[1-9][0-9]{0,14})$'
    or (p_positive and p_value = '0') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  return p_value::bigint;
end; $_$;


ALTER FUNCTION private.planning_minor(p_value text, p_positive boolean) OWNER TO postgres;

--
-- Name: planning_ordinary_activity(uuid, date, date); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.planning_ordinary_activity(p_space_id uuid, p_from date, p_to date) RETURNS TABLE(event_id uuid, effective_date date, currency public.currency_code, root_id uuid, income_minor numeric, expense_minor numeric, cash_minor numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  if p_space_id is null or p_from is null or p_to is null or p_to <= p_from
    or p_to > p_from + 366 or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  return query
  select e.id,e.effective_date,w.currency,
    coalesce(c.parent_category_id,c.id) as root_id,
    case when coalesce(o.kind,e.kind)='income' then m.amount_minor::numeric else 0 end,
    case when coalesce(o.kind,e.kind)='expense' then -m.amount_minor::numeric else 0 end,
    m.amount_minor::numeric
  from public.financial_events e
  join public.wallet_movements m on m.event_id=e.id and m.space_id=e.space_id
  join public.wallets w on w.id=m.wallet_id and w.space_id=e.space_id
  left join public.financial_events o on o.id=e.reversal_of and o.space_id=e.space_id
  left join public.financial_event_categories ec on ec.event_id=e.id and ec.space_id=e.space_id
  left join public.financial_event_categories oc on oc.event_id=o.id and oc.space_id=e.space_id
  left join public.categories c on c.id=coalesce(ec.category_id,oc.category_id) and c.space_id=e.space_id
  where e.space_id=p_space_id and e.effective_date>=p_from and e.effective_date<p_to;
end;
$$;


ALTER FUNCTION private.planning_ordinary_activity(p_space_id uuid, p_from date, p_to date) OWNER TO postgres;

--
-- Name: planning_reject_mutation(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.planning_reject_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
begin
  raise exception using errcode='42501', message='planning_history_immutable';
end; $$;


ALTER FUNCTION private.planning_reject_mutation() OWNER TO postgres;

--
-- Name: planning_replay(uuid, uuid, text, uuid, bytea); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.planning_replay(p_space_id uuid, p_request_id uuid, p_command text, p_actor uuid, p_fingerprint bytea) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    SET statement_timeout TO '10s'
    AS $$
declare v_receipt public.planning_command_receipts%rowtype;
begin
  if p_space_id is null or p_request_id is null or p_command is null
    or p_actor is null or p_fingerprint is null
    or char_length(p_command) not between 1 and 80
    or octet_length(p_fingerprint)<>32 then
    raise exception using errcode='22023',message='planning_invalid_input';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'budget-planning-request:'||p_space_id::text||':'||p_request_id::text,0));
  select * into v_receipt from public.planning_command_receipts
  where space_id=p_space_id and request_id=p_request_id;
  if not found then return null; end if;
  if v_receipt.command is distinct from p_command
    or v_receipt.actor_id is distinct from p_actor
    or v_receipt.fingerprint is distinct from p_fingerprint then
    raise exception using errcode='P0001',message='planning_idempotency_conflict';
  end if;
  return v_receipt.result;
end; $$;


ALTER FUNCTION private.planning_replay(p_space_id uuid, p_request_id uuid, p_command text, p_actor uuid, p_fingerprint bytea) OWNER TO postgres;

--
-- Name: planning_unpaid_backlog_count(uuid, public.currency_code, date, date); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.planning_unpaid_backlog_count(p_space_id uuid, p_currency public.currency_code, p_as_of date, p_to date) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select count(*)::integer
  from public.scheduled_occurrences so
  cross join lateral private.schedule_occurrence_settlement(so.id, p_as_of) stl
  where so.space_id = p_space_id and so.currency = p_currency and so.due_date <= p_to
    and not stl.skipped and greatest(so.expected_minor - stl.settled_minor, 0) > 0;
$$;


ALTER FUNCTION private.planning_unpaid_backlog_count(p_space_id uuid, p_currency public.currency_code, p_as_of date, p_to date) OWNER TO postgres;

--
-- Name: reject_category_history_mutation(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.reject_category_history_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
begin
  raise exception using
    errcode = '42501',
    message = 'category history is immutable';
end;
$$;


ALTER FUNCTION private.reject_category_history_mutation() OWNER TO postgres;

--
-- Name: reject_household_membership_event_mutation(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.reject_household_membership_event_mutation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  raise exception using
    errcode = '55000',
    message = 'household membership events are immutable';
end;
$$;


ALTER FUNCTION private.reject_household_membership_event_mutation() OWNER TO postgres;

--
-- Name: reject_monthly_budget_plan_mutation(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.reject_monthly_budget_plan_mutation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  raise exception using errcode = '42501', message = 'monthly budget plan history is immutable';
end;
$$;


ALTER FUNCTION private.reject_monthly_budget_plan_mutation() OWNER TO postgres;

--
-- Name: reject_posted_history_mutation(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.reject_posted_history_mutation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  raise exception using
    errcode = '42501',
    message = 'posted financial history is immutable';
end;
$$;


ALTER FUNCTION private.reject_posted_history_mutation() OWNER TO postgres;

--
-- Name: reject_reversal_before_original(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.reject_reversal_before_original() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_original_date date;
begin
  select event.effective_date into v_original_date
  from public.financial_events as event
  where event.id = new.reversal_of;
  if v_original_date is not null and new.effective_date < v_original_date then
    raise exception using errcode = '23514', message = 'a reversal cannot be dated before the entry it reverses';
  end if;
  return new;
end;
$$;


ALTER FUNCTION private.reject_reversal_before_original() OWNER TO postgres;

--
-- Name: reject_subcategory_budget_target(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.reject_subcategory_budget_target() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_parent_category_id uuid;
begin
  if new.plan_kind = 'expense_category' then
    select category.parent_category_id into v_parent_category_id
    from public.categories as category
    where category.id = new.category_id and category.space_id = new.space_id;
    if v_parent_category_id is not null then
      raise exception using errcode = 'P0001', message = 'a monthly budget target must reference a root category, not a subcategory';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION private.reject_subcategory_budget_target() OWNER TO postgres;

--
-- Name: reject_wallet_command_history_mutation(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.reject_wallet_command_history_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
begin
  raise exception using
    errcode = '42501',
    message = 'wallet command history is immutable';
end;
$$;


ALTER FUNCTION private.reject_wallet_command_history_mutation() OWNER TO postgres;

--
-- Name: reject_wallet_deletion(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.reject_wallet_deletion() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
begin
  raise exception using
    errcode = '42501',
    message = 'wallets are archived, never deleted';
end;
$$;


ALTER FUNCTION private.reject_wallet_deletion() OWNER TO postgres;

--
-- Name: replay_wallet_command(uuid, uuid, text, bytea, uuid); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.replay_wallet_command(p_space_id uuid, p_request_id uuid, p_command_kind text, p_fingerprint bytea, p_wallet_id uuid) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_existing_kind text;
  v_existing_fingerprint bytea;
  v_existing_wallet_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('wallet:' || p_space_id::text || ':' || p_request_id::text, 0)
  );

  select request.command_kind, request.request_fingerprint, request.wallet_id
  into v_existing_kind, v_existing_fingerprint, v_existing_wallet_id
  from public.wallet_command_requests as request
  where request.space_id = p_space_id
    and request.request_id = p_request_id;

  if not found then
    return false;
  end if;

  if v_existing_kind <> p_command_kind
    or v_existing_fingerprint <> p_fingerprint
    or v_existing_wallet_id <> p_wallet_id then
    raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
  end if;

  return true;
end;
$$;


ALTER FUNCTION private.replay_wallet_command(p_space_id uuid, p_request_id uuid, p_command_kind text, p_fingerprint bytea, p_wallet_id uuid) OWNER TO postgres;

--
-- Name: require_active_movement_wallet(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.require_active_movement_wallet() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_wallet_id uuid;
begin
  -- FOR SHARE conflicts with archive_wallet's FOR UPDATE, so a movement and an
  -- archive of the same wallet serialize instead of both committing.
  select wallet.id
  into v_wallet_id
  from public.wallets as wallet
  where wallet.id = new.wallet_id
    and wallet.space_id = new.space_id
    and wallet.archived_at is null
  for share;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'every wallet movement must use an active wallet';
  end if;

  return new;
end;
$$;


ALTER FUNCTION private.require_active_movement_wallet() OWNER TO postgres;

--
-- Name: require_table_owner_write(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.require_table_owner_write() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_owner_name name;
begin
  select pg_catalog.pg_get_userbyid(relation.relowner)
  into v_owner_name
  from pg_catalog.pg_class as relation
  where relation.oid = tg_relid;

  if current_user <> v_owner_name then
    raise exception using
      errcode = '42501',
      message = 'protected rows may be written only by their owning command';
  end if;

  return new;
end;
$$;


ALTER FUNCTION private.require_table_owner_write() OWNER TO postgres;

--
-- Name: require_wallet_command_actor(uuid, uuid, uuid); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.require_wallet_command_actor(p_space_id uuid, p_request_id uuid, p_wallet_id uuid) RETURNS uuid
    LANGUAGE plpgsql STABLE
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  if p_request_id is null or p_wallet_id is null then
    raise exception using errcode = 'P0001', message = 'request ID and wallet ID are required';
  end if;

  return v_actor_id;
end;
$$;


ALTER FUNCTION private.require_wallet_command_actor(p_space_id uuid, p_request_id uuid, p_wallet_id uuid) OWNER TO postgres;

--
-- Name: schedule_candidate_due_dates(date, text, integer, date, date, date); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.schedule_candidate_due_dates(p_starts_on date, p_cadence text, p_interval_count integer, p_ends_on date, p_from_date date, p_to_date date) RETURNS SETOF date
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_n0 integer;
  v_due date;
  v_month_start date;
  v_last_day date;
  v_day integer;
  v_year integer;
  v_month integer;
  v_period_days integer;
  v_month_diff integer;
  v_year_diff integer;
  v_i integer;
begin
  if p_starts_on is null or p_cadence is null or p_interval_count is null
    or p_from_date is null or p_to_date is null or p_interval_count < 1 or p_interval_count > 12 then
    return;
  end if;
  if p_starts_on > p_to_date or (p_ends_on is not null and p_ends_on < p_from_date) then
    return;
  end if;

  if p_cadence = 'weekly' then
    v_period_days := 7 * p_interval_count;
    v_n0 := greatest(0, ceil((p_from_date - p_starts_on)::numeric / v_period_days)::integer);
    for v_i in 0..91 loop
      v_due := p_starts_on + (v_n0 + v_i) * v_period_days;
      if v_due > p_to_date then
        exit;
      end if;
      if v_due >= p_from_date and (p_ends_on is null or v_due <= p_ends_on) then
        return next v_due;
      end if;
    end loop;

  elsif p_cadence = 'monthly' then
    v_month_diff := (extract(year from p_from_date)::int - extract(year from p_starts_on)::int) * 12
      + (extract(month from p_from_date)::int - extract(month from p_starts_on)::int);
    v_n0 := greatest(0, floor(v_month_diff::numeric / p_interval_count)::integer - 1);
    for v_i in 0..91 loop
      v_month_start := (date_trunc('month', p_starts_on) + make_interval(months => (v_n0 + v_i) * p_interval_count))::date;
      v_last_day := (date_trunc('month', v_month_start) + interval '1 month - 1 day')::date;
      v_day := least(extract(day from p_starts_on)::int, extract(day from v_last_day)::int);
      v_due := v_month_start + (v_day - 1);
      if v_due > p_to_date then
        exit;
      end if;
      if v_due >= p_from_date and v_due >= p_starts_on and (p_ends_on is null or v_due <= p_ends_on) then
        return next v_due;
      end if;
    end loop;

  elsif p_cadence = 'yearly' then
    v_year_diff := extract(year from p_from_date)::int - extract(year from p_starts_on)::int;
    v_n0 := greatest(0, floor(v_year_diff::numeric / p_interval_count)::integer - 1);
    for v_i in 0..91 loop
      v_year := extract(year from p_starts_on)::int + (v_n0 + v_i) * p_interval_count;
      v_month := extract(month from p_starts_on)::int;
      v_day := extract(day from p_starts_on)::int;
      if v_month = 2 and v_day = 29 and not (v_year % 4 = 0 and (v_year % 100 <> 0 or v_year % 400 = 0)) then
        v_day := 28;
      end if;
      v_due := make_date(v_year, v_month, v_day);
      if v_due > p_to_date then
        exit;
      end if;
      if v_due >= p_from_date and v_due >= p_starts_on and (p_ends_on is null or v_due <= p_ends_on) then
        return next v_due;
      end if;
    end loop;

  elsif p_cadence = 'semimonthly' then
    v_month_diff := (extract(year from p_from_date)::int - extract(year from p_starts_on)::int) * 12
      + (extract(month from p_from_date)::int - extract(month from p_starts_on)::int);
    v_n0 := greatest(0, floor(v_month_diff::numeric / p_interval_count)::integer - 1);
    for v_i in 0..91 loop
      v_month_start := (date_trunc('month', p_starts_on) + make_interval(months => (v_n0 + v_i) * p_interval_count))::date;
      if v_month_start > p_to_date then
        exit;
      end if;
      -- The 1st of the interval month.
      v_due := v_month_start;
      if v_due >= p_from_date and v_due >= p_starts_on and (p_ends_on is null or v_due <= p_ends_on) then
        return next v_due;
      end if;
      -- Then the 15th. Past p_to_date ends the walk: every later month starts
      -- strictly later, so nothing beyond this date can be in range either.
      v_due := v_month_start + 14;
      if v_due > p_to_date then
        exit;
      end if;
      if v_due >= p_from_date and v_due >= p_starts_on and (p_ends_on is null or v_due <= p_ends_on) then
        return next v_due;
      end if;
    end loop;

  elsif p_cadence = 'monthly_last_business_day' then
    v_month_diff := (extract(year from p_from_date)::int - extract(year from p_starts_on)::int) * 12
      + (extract(month from p_from_date)::int - extract(month from p_starts_on)::int);
    v_n0 := greatest(0, floor(v_month_diff::numeric / p_interval_count)::integer - 1);
    for v_i in 0..91 loop
      v_month_start := (date_trunc('month', p_starts_on) + make_interval(months => (v_n0 + v_i) * p_interval_count))::date;
      v_last_day := (date_trunc('month', v_month_start) + interval '1 month - 1 day')::date;
      -- Walk back from the month's last day while it is Saturday(6)/Sunday(0),
      -- keeping the latest Monday-Friday on or before month end.
      while extract(dow from v_last_day)::int in (0, 6) loop
        v_last_day := v_last_day - 1;
      end loop;
      v_due := v_last_day;
      if v_due > p_to_date then
        exit;
      end if;
      if v_due >= p_from_date and v_due >= p_starts_on and (p_ends_on is null or v_due <= p_ends_on) then
        return next v_due;
      end if;
    end loop;
  end if;
  return;
end;
$$;


ALTER FUNCTION private.schedule_candidate_due_dates(p_starts_on date, p_cadence text, p_interval_count integer, p_ends_on date, p_from_date date, p_to_date date) OWNER TO postgres;

--
-- Name: schedule_occurrence_candidates(uuid, date, date); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.schedule_occurrence_candidates(p_space_id uuid, p_from_date date, p_to_date date) RETURNS TABLE(schedule_id uuid, space_id uuid, currency public.currency_code, source_revision_id bigint, category_id uuid, loan_id uuid, funding_goal_id uuid, preferred_wallet_id uuid, expected_minor bigint, due_date date)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select sch.id, sch.space_id, sch.currency, rev.id,
    rev.category_id, rev.loan_id, rev.funding_goal_id, rev.preferred_wallet_id, rev.expected_minor,
    cand.candidate_date
  from public.schedules sch
  join lateral (
    select * from public.schedule_revisions r where r.schedule_id = sch.id order by r.id desc limit 1
  ) rev on true
  cross join lateral private.schedule_candidate_due_dates(
    rev.starts_on, rev.cadence, rev.interval_count, rev.ends_on, p_from_date, p_to_date
  ) as cand(candidate_date)
  where sch.space_id = p_space_id and rev.state = 'active';
$$;


ALTER FUNCTION private.schedule_occurrence_candidates(p_space_id uuid, p_from_date date, p_to_date date) OWNER TO postgres;

--
-- Name: schedule_occurrence_id(uuid, date); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.schedule_occurrence_id(p_schedule_id uuid, p_due_date date) RETURNS uuid
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog'
    AS $$
  select private.planning_child_request(p_schedule_id, 'occurrence:' || p_due_date::text);
$$;


ALTER FUNCTION private.schedule_occurrence_id(p_schedule_id uuid, p_due_date date) OWNER TO postgres;

--
-- Name: schedule_occurrence_settlement(uuid, date); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.schedule_occurrence_settlement(p_occurrence_id uuid, p_as_of date) RETURNS TABLE(settled_minor numeric, skipped boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_settled numeric;
  v_reversed numeric;
  v_last_action text;
begin
  select coalesce(sum(oe.link_amount_minor), 0) into v_settled
  from public.occurrence_events oe
  join public.financial_events fe on fe.id = oe.linked_event_id
  where oe.occurrence_id = p_occurrence_id and oe.action in ('link','confirm')
    and fe.effective_date <= p_as_of;

  select coalesce(sum(oe.link_amount_minor), 0) into v_reversed
  from public.occurrence_events oe
  join public.financial_events orig on orig.id = oe.linked_event_id
  join public.financial_events rev on rev.reversal_of = orig.id
  where oe.occurrence_id = p_occurrence_id and oe.action in ('link','confirm')
    and rev.effective_date <= p_as_of;

  select oe.action into v_last_action from public.occurrence_events oe
    where oe.occurrence_id = p_occurrence_id order by oe.id desc limit 1;

  return query select (v_settled - v_reversed), coalesce(v_last_action = 'skip', false);
end;
$$;


ALTER FUNCTION private.schedule_occurrence_settlement(p_occurrence_id uuid, p_as_of date) OWNER TO postgres;

--
-- Name: set_monthly_budget_plan(uuid, uuid, uuid, date, public.currency_code, text, bigint, text); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.set_monthly_budget_plan(p_space_id uuid, p_request_id uuid, p_category_id uuid, p_month date, p_currency public.currency_code, p_amount_minor text, p_expected_revision_id bigint, p_plan_kind text) RETURNS TABLE(id bigint, month_start date)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_month_start date;
  v_amount_minor bigint;
  v_fingerprint bytea;
  v_existing_fingerprint bytea;
  v_existing_id bigint;
  v_current_id bigint;
  v_category_archived_at timestamptz;
  v_category_parent_id uuid;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;
  if p_request_id is null or p_month is null or p_currency is null or p_plan_kind not in ('income', 'expense_category') then
    raise exception using errcode = 'P0001', message = 'monthly budget plan inputs are required';
  end if;
  if p_plan_kind = 'income' and p_category_id is not null then
    raise exception using errcode = 'P0001', message = 'income plans cannot have a category';
  end if;
  if p_plan_kind = 'expense_category' and p_category_id is null then
    raise exception using errcode = 'P0001', message = 'expense category targets require a category';
  end if;
  v_amount_minor := private.parse_nonnegative_minor_amount(p_amount_minor);
  v_month_start := date_trunc('month', p_month)::date;
  v_fingerprint := extensions.digest(
    'monthly_budget|' || p_plan_kind || '|' || coalesce(p_category_id::text, '') || '|' || v_month_start::text || '|' || p_currency::text || '|' || v_amount_minor::text || '|' || coalesce(p_expected_revision_id::text, ''),
    'sha256'
  );
  perform private.lock_planning_actor(p_space_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_space_id::text || '|' || p_request_id::text, 0));
  select revision.request_fingerprint, revision.id into v_existing_fingerprint, v_existing_id
  from public.monthly_budget_plan_revisions as revision
  where revision.space_id = p_space_id and revision.request_id = p_request_id;
  if found then
    if v_existing_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;
    return query select v_existing_id, v_month_start;
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_space_id::text || '|' || p_plan_kind || '|' || coalesce(p_category_id::text, '') || '|' || v_month_start::text || '|' || p_currency::text, 0));
  select revision.id into v_current_id
  from public.monthly_budget_plan_revisions as revision
  where revision.space_id = p_space_id and revision.month_start = v_month_start and revision.currency = p_currency
    and revision.plan_kind = p_plan_kind and revision.category_id is not distinct from p_category_id
  order by revision.id desc limit 1 for update;
  if v_current_id is distinct from p_expected_revision_id then
    raise exception using errcode = 'P0001', message = 'the monthly budget plan has changed; refresh and try again';
  end if;
  if p_plan_kind = 'expense_category' then
    select category.archived_at, category.parent_category_id into v_category_archived_at, v_category_parent_id from public.categories as category
    where category.id = p_category_id and category.space_id = p_space_id and category.kind = 'expense';
    if not found then raise exception using errcode = 'P0001', message = 'the requested expense category was not found'; end if;
    if v_category_parent_id is not null then
      raise exception using errcode = 'P0001', message = 'a monthly budget target must reference a root category, not a subcategory';
    end if;
    if v_category_archived_at is not null and v_amount_minor > 0 then
      raise exception using errcode = 'P0001', message = 'an archived category cannot receive a positive target';
    end if;
  end if;
  insert into public.monthly_budget_plan_revisions (
    space_id, request_id, request_fingerprint, plan_kind, month_start, currency, category_id, category_kind, amount_minor, expected_revision_id, actor_id
  ) values (
    p_space_id, p_request_id, v_fingerprint, p_plan_kind, v_month_start, p_currency, p_category_id,
    case when p_plan_kind = 'expense_category' then 'expense'::public.category_kind else null end,
    v_amount_minor, p_expected_revision_id, v_actor_id
  ) returning monthly_budget_plan_revisions.id into v_existing_id;
  return query select v_existing_id, v_month_start;
end;
$$;


ALTER FUNCTION private.set_monthly_budget_plan(p_space_id uuid, p_request_id uuid, p_category_id uuid, p_month date, p_currency public.currency_code, p_amount_minor text, p_expected_revision_id bigint, p_plan_kind text) OWNER TO postgres;

--
-- Name: space_date(uuid, timestamp with time zone); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.space_date(p_space_id uuid, p_at timestamp with time zone) RETURNS date
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select (p_at at time zone coalesce(
    (select space.timezone from public.spaces as space where space.id = p_space_id),
    'UTC'
  ))::date;
$$;


ALTER FUNCTION private.space_date(p_space_id uuid, p_at timestamp with time zone) OWNER TO postgres;

--
-- Name: space_period_anchor(uuid, date); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.space_period_anchor(p_space_id uuid, p_month date) RETURNS date
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_payday integer;
  v_month date := (date_trunc('month', p_month))::date;
begin
  select greatest(1, least(31, coalesce(space.payday_day, 1)))
    into v_payday
    from public.spaces as space where space.id = p_space_id;
  v_payday := coalesce(v_payday, 1);
  return least(
    v_month + (v_payday - 1),
    (v_month + interval '1 month' - interval '1 day')::date
  );
end;
$$;


ALTER FUNCTION private.space_period_anchor(p_space_id uuid, p_month date) OWNER TO postgres;

--
-- Name: space_period_bounds(uuid, date); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.space_period_bounds(p_space_id uuid, p_month date) RETURNS TABLE(period_start date, period_end date)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select
    private.space_period_anchor(p_space_id, p_month) as period_start,
    private.space_period_anchor(
      p_space_id,
      (date_trunc('month', p_month) + interval '1 month')::date
    ) as period_end;
$$;


ALTER FUNCTION private.space_period_bounds(p_space_id uuid, p_month date) OWNER TO postgres;

--
-- Name: space_period_start(uuid, timestamp with time zone); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.space_period_start(p_space_id uuid, p_at timestamp with time zone) RETURNS date
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_today date := private.space_date(p_space_id, p_at);
  v_payday integer;
  v_month date;
  v_anchor date;
begin
  select greatest(1, least(31, coalesce(space.payday_day, 1)))
    into v_payday
    from public.spaces as space where space.id = p_space_id;
  v_payday := coalesce(v_payday, 1);

  v_month := (date_trunc('month', v_today))::date;
  v_anchor := least(
    v_month + (v_payday - 1),
    (v_month + interval '1 month' - interval '1 day')::date
  );
  if v_today >= v_anchor then
    return v_anchor;
  end if;

  v_month := (date_trunc('month', v_today - interval '1 month'))::date;
  return least(
    v_month + (v_payday - 1),
    (v_month + interval '1 month' - interval '1 day')::date
  );
end;
$$;


ALTER FUNCTION private.space_period_start(p_space_id uuid, p_at timestamp with time zone) OWNER TO postgres;

--
-- Name: space_today(uuid); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.space_today(p_space_id uuid) RETURNS date
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
  select private.space_date(p_space_id, now());
$$;


ALTER FUNCTION private.space_today(p_space_id uuid) OWNER TO postgres;

--
-- Name: validate_category_parent(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.validate_category_parent() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_parent_archived_at timestamptz;
  v_parent_parent_id uuid;
begin
  if new.parent_category_id is null then
    return new;
  end if;

  select category.archived_at, category.parent_category_id
  into v_parent_archived_at, v_parent_parent_id
  from public.categories as category
  where category.id = new.parent_category_id
    and category.space_id = new.space_id
    and category.kind = new.kind
  limit 1
  -- Conflict with direct owner archive UPDATE, including its NO KEY UPDATE lock.
  for update;

  if not found or v_parent_archived_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'the parent category must be an active root in the requested space and kind';
  end if;

  if v_parent_parent_id is not null then
    raise exception using
      errcode = 'P0001',
      message = 'subcategory depth is limited to one level';
  end if;

  return new;
end;
$$;


ALTER FUNCTION private.validate_category_parent() OWNER TO postgres;

--
-- Name: validate_reversal_category_copy(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.validate_reversal_category_copy() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_original_category_id uuid;
  v_original_category_kind public.category_kind;
begin
  if new.event_kind <> 'reversal' then
    return new;
  end if;

  select original_category.category_id, original_category.category_kind
  into v_original_category_id, v_original_category_kind
  from public.financial_events as reversal
  join public.financial_event_categories as original_category
    on original_category.event_id = reversal.reversal_of
   and original_category.space_id = reversal.space_id
  where reversal.id = new.event_id
    and reversal.space_id = new.space_id;

  if not found
    or new.category_id is distinct from v_original_category_id
    or new.category_kind is distinct from v_original_category_kind then
    raise exception using
      errcode = '42501',
      message = 'a reversal category must exactly copy its original event';
  end if;

  return new;
end;
$$;


ALTER FUNCTION private.validate_reversal_category_copy() OWNER TO postgres;

--
-- Name: validate_space_timezone(); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.validate_space_timezone() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.timezone
  ) then
    raise exception using errcode='23514', message='spaces_timezone_unknown';
  end if;
  return new;
end;
$$;


ALTER FUNCTION private.validate_space_timezone() OWNER TO postgres;

--
-- Name: accept_household_invitation(uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.accept_household_invitation(p_request_id uuid, p_invitation_token text) RETURNS TABLE(space_id uuid, membership_status public.membership_status, role public.member_role)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor_id uuid := private.household_actor_user_id();
  v_token_digest bytea;
  v_fingerprint bytea;
  v_existing_event public.household_membership_events%rowtype;
  v_discovered_space_id uuid;
  v_invitation public.household_invitations%rowtype;
  v_membership public.space_memberships%rowtype;
  v_actor_identity_digest bytea;
  v_space_kind public.space_kind;
  v_now timestamptz := now();
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_request_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  if p_invitation_token is null
    or p_invitation_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception using errcode = 'P0001', message = 'invitation_unavailable';
  end if;

  v_token_digest := private.household_invitation_token_digest(p_invitation_token);
  v_fingerprint := private.household_command_fingerprint(
    'accept_household_invitation|' || encode(v_token_digest, 'hex')
  );
  perform private.lock_household_request(v_actor_id, p_request_id);

  select event.*
  into v_existing_event
  from public.household_membership_events as event
  where event.actor_user_id = v_actor_id
    and event.request_id = p_request_id;

  if found then
    if v_existing_event.kind <> 'invitation_accepted'
      or v_existing_event.request_fingerprint <> v_fingerprint
      or v_existing_event.subject_user_id <> v_actor_id then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;

    return query
    select v_existing_event.space_id, v_existing_event.next_status, v_existing_event.next_role;
    return;
  end if;

  if not private.household_actor_email_confirmed() then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select invitation.space_id
  into v_discovered_space_id
  from public.household_invitations as invitation
  where invitation.token_digest = v_token_digest;

  if not found then
    raise exception using errcode = 'P0001', message = 'invitation_unavailable';
  end if;

  v_space_kind := private.lock_household_space(v_discovered_space_id);
  if v_space_kind is null or v_space_kind <> 'household' then
    raise exception using errcode = 'P0001', message = 'invitation_unavailable';
  end if;

  select invitation.*
  into v_invitation
  from public.household_invitations as invitation
  where invitation.token_digest = v_token_digest
  for update;

  v_actor_identity_digest := private.household_actor_identity_digest(v_invitation.key_version);
  if v_invitation.status <> 'pending'
    or v_invitation.expires_at <= v_now
    or v_actor_identity_digest is null
    or v_actor_identity_digest <> v_invitation.invitee_identity_digest then
    raise exception using errcode = 'P0001', message = 'invitation_unavailable';
  end if;

  select membership.*
  into v_membership
  from public.space_memberships as membership
  where membership.space_id = v_invitation.space_id
    and membership.user_id = v_actor_id
  for update;

  if found and v_membership.status = 'active' then
    raise exception using errcode = 'P0001', message = 'invitation_unavailable';
  end if;

  if found then
    update public.space_memberships
    set status = 'active',
        role = 'member',
        activated_at = v_now,
        ended_at = null,
        ended_by_user_id = null
    where space_memberships.space_id = v_invitation.space_id
      and space_memberships.user_id = v_actor_id;
  else
    insert into public.space_memberships (
      space_id, user_id, role, status, created_at, activated_at
    )
    values (
      v_invitation.space_id, v_actor_id, 'member', 'active', v_now, v_now
    );
  end if;

  update public.household_invitations
  set status = 'accepted',
      accepted_by_user_id = v_actor_id,
      accepted_at = v_now
  where id = v_invitation.id;

  insert into public.household_membership_events (
    space_id, actor_user_id, subject_user_id, request_id, request_fingerprint,
    kind, invitation_id, prior_status, next_status, prior_role, next_role, occurred_at
  )
  values (
    v_invitation.space_id, v_actor_id, v_actor_id, p_request_id, v_fingerprint,
    'invitation_accepted', v_invitation.id,
    v_membership.status, 'active', v_membership.role, 'member', v_now
  );

  return query select v_invitation.space_id, 'active'::public.membership_status, 'member'::public.member_role;
end;
$_$;


ALTER FUNCTION public.accept_household_invitation(p_request_id uuid, p_invitation_token text) OWNER TO postgres;

--
-- Name: allocation_category_page(uuid, date, public.currency_code, bigint, uuid, uuid, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.allocation_category_page(p_space_id uuid, p_month date, p_currency public.currency_code, p_snapshot_id bigint, p_group_id uuid DEFAULT NULL::uuid, p_after_root_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
declare
  v_month date;
  v_snapshot_exists boolean;
  v_rows jsonb;
  v_row_count integer;
  v_next_root_id uuid;
  v_has_more boolean;
begin
  if p_space_id is null or p_month is null or p_currency is null or p_snapshot_id is null
    or p_month <> date_trunc('month', p_month)::date or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_month := p_month;

  select exists(
    select 1 from public.allocation_month_snapshots
    where id = p_snapshot_id and space_id = p_space_id and currency = p_currency and month_start = v_month
  ) into v_snapshot_exists;
  if not v_snapshot_exists then
    raise exception using errcode='P0001', message='the requested snapshot does not belong to this space, currency, and month';
  end if;

  with page as (
    select root.category_id as root_id, category.name_en, category.name_ar,
      root.target_minor, coalesce(link.carry_minor, 0) as carry_minor,
      coalesce(activity.actual, 0) as actual_minor, root.group_id
    from public.allocation_month_roots root
    join public.categories category on category.id = root.category_id and category.space_id = p_space_id
    left join public.budget_month_carry_links link
      on link.target_snapshot_id = root.snapshot_id and link.root_id = root.category_id
    left join (
      select act.root_id, sum(act.expense_minor) as actual
      from private.planning_ordinary_activity(p_space_id, v_month, (v_month + interval '1 month')::date) act
      where act.currency = p_currency
      group by act.root_id
    ) activity on activity.root_id = root.category_id
    where root.snapshot_id = p_snapshot_id
      and (p_group_id is null or root.group_id = p_group_id)
      and (p_after_root_id is null or root.category_id > p_after_root_id)
    order by root.category_id
    limit p_limit + 1
  )
  , numbered as (select page.*, row_number() over (order by root_id) as rn from page)
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
      'rootId', root_id, 'nameEn', name_en, 'nameAr', name_ar,
      'targetMinor', target_minor::text, 'carryMinor', carry_minor::text,
      'effectiveTargetMinor', (target_minor + carry_minor)::text,
      'actualMinor', actual_minor::text,
      'varianceMinor', (target_minor + carry_minor - actual_minor)::text, 'hasPlan', true, 'groupId', group_id
    ) order by root_id), '[]'::jsonb) from numbered where rn <= p_limit),
    (select count(*) from numbered where rn <= p_limit),
    exists(select 1 from numbered where rn > p_limit),
    (select root_id from numbered where rn = p_limit)
  into v_rows, v_row_count, v_has_more, v_next_root_id;

  return jsonb_build_object('rows', v_rows, 'nextRootId', case when v_has_more then v_next_root_id else null end, 'hasMore', coalesce(v_has_more, false));
end;
$$;


ALTER FUNCTION public.allocation_category_page(p_space_id uuid, p_month date, p_currency public.currency_code, p_snapshot_id bigint, p_group_id uuid, p_after_root_id uuid, p_limit integer) OWNER TO postgres;

--
-- Name: allocation_history_page(uuid, date, public.currency_code, bigint, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.allocation_history_page(p_space_id uuid, p_month date, p_currency public.currency_code, p_before_id bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 20) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
declare
  v_month date;
  v_rows jsonb;
  v_has_more boolean;
  v_next_id bigint;
begin
  if p_space_id is null or p_month is null or p_currency is null
    or p_month <> date_trunc('month', p_month)::date or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_month := p_month;

  with page as (
    select id, created_at, actor_id, base_income_minor, template_revision_id
    from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = v_month
      and (p_before_id is null or id < p_before_id)
    order by id desc
    limit p_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'snapshotId', id::text, 'createdAt', created_at, 'actorId', actor_id,
      'plannedIncomeMinor', base_income_minor::text, 'templateRevisionId', template_revision_id::text
    ) order by id desc) filter (where rn <= p_limit), '[]'::jsonb),
    bool_or(rn > p_limit),
    min(id) filter (where rn <= p_limit)
  into v_rows, v_has_more, v_next_id
  from (select page.*, row_number() over (order by id desc) as rn from page) page;

  return jsonb_build_object('rows', v_rows, 'nextId', case when v_has_more then v_next_id::text else null end, 'hasMore', coalesce(v_has_more, false));
end;
$$;


ALTER FUNCTION public.allocation_history_page(p_space_id uuid, p_month date, p_currency public.currency_code, p_before_id bigint, p_limit integer) OWNER TO postgres;

--
-- Name: allocation_month_state(uuid, date, public.currency_code, bigint); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.allocation_month_state(p_space_id uuid, p_month date, p_currency public.currency_code, p_snapshot_id bigint DEFAULT NULL::bigint) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
declare
  v_month date;
  v_snapshot public.allocation_month_snapshots%rowtype;
  v_has_plan boolean := false;
  v_actual_income numeric := 0;
  v_expense numeric := 0;
  v_loan_actual bigint := 0;
  v_loan_remaining bigint := 0;
  v_income_after_spending numeric;
  v_current_income_id bigint;
  v_child_plan_changed boolean := false;
  v_standalone_root_targets numeric := 0;
  v_standalone_goal_targets numeric := 0;
  v_standalone_debt numeric := 0;
  v_future_excess numeric := 0;
  v_left_to_allocate numeric := 0;
  v_groups jsonb := '[]'::jsonb;
  v_unmapped_actual numeric := 0;
  v_unmapped_target numeric := 0;
  v_unmapped_carry numeric := 0;
  v_uncategorized_actual numeric := 0;
  v_carry_total numeric := 0;
  v_carry_source_close_id bigint;
  v_carry_needs_review boolean := false;
  v_result jsonb;
begin
  if p_space_id is null or p_month is null or p_currency is null
    or p_month <> date_trunc('month', p_month)::date or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  v_month := p_month;

  if p_snapshot_id is not null then
    select * into v_snapshot from public.allocation_month_snapshots
      where id = p_snapshot_id and space_id = p_space_id and currency = p_currency and month_start = v_month;
    if not found then
      raise exception using errcode='P0001', message='the requested snapshot does not belong to this space, currency, and month';
    end if;
    v_has_plan := true;
  else
    select * into v_snapshot from public.allocation_month_snapshots
      where space_id = p_space_id and currency = p_currency and month_start = v_month
      order by id desc limit 1;
    v_has_plan := found;
  end if;

  select coalesce(sum(activity.income_minor), 0), coalesce(sum(activity.expense_minor), 0)
    into v_actual_income, v_expense
    from private.planning_ordinary_activity(p_space_id, v_month, (v_month + interval '1 month')::date) activity
    where activity.currency = p_currency;
  v_income_after_spending := v_actual_income - v_expense;

  select coalesce(summary.actual_repayment_minor,0), coalesce(summary.remaining_reservation_minor,0)
    into v_loan_actual, v_loan_remaining
    from public.loan_monthly_currency_summary(p_space_id, v_month) as summary
    where summary.currency = p_currency;
  v_loan_actual := coalesce(v_loan_actual, 0);
  v_loan_remaining := coalesce(v_loan_remaining, 0);

  select id into v_current_income_id from public.monthly_budget_plan_revisions
    where space_id = p_space_id and currency = p_currency and month_start = v_month and plan_kind = 'income'
    order by id desc limit 1;

  if v_has_plan then
    if v_current_income_id is distinct from v_snapshot.income_plan_revision_id then
      v_child_plan_changed := true;
    end if;
    if exists (
      select 1 from public.allocation_month_roots root
      left join lateral (
        select revision.id from public.monthly_budget_plan_revisions revision
        where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = v_month
          and revision.plan_kind = 'expense_category' and revision.category_id = root.category_id
        order by revision.id desc limit 1
      ) current_head on true
      where root.snapshot_id = v_snapshot.id and current_head.id is distinct from root.target_revision_id
    ) then
      v_child_plan_changed := true;
    end if;

    select coalesce(sum(carry.carry_minor), 0), max(carry.source_close_id),
      coalesce(sum(carry.carry_minor) filter (where carry.group_id is null), 0)
      into v_carry_total, v_carry_source_close_id, v_unmapped_carry
      from private.allocation_snapshot_carry(v_snapshot.id) carry;
    v_carry_needs_review := private.allocation_snapshot_carry_needs_review(v_snapshot.id);

    select coalesce(sum(root.target_minor),0) into v_standalone_root_targets
      from public.allocation_month_roots root where root.snapshot_id = v_snapshot.id and root.group_id is null;
    select coalesce(sum(goal_line.amount_minor),0) into v_standalone_goal_targets
      from public.allocation_month_goal_lines goal_line where goal_line.snapshot_id = v_snapshot.id and goal_line.group_id is null;

    select case when commitment.group_id is null then coalesce(commitment.observed_actual_minor,0) + coalesce(commitment.observed_remaining_minor,0) else 0 end
      into v_standalone_debt
      from public.allocation_month_commitments commitment
      where commitment.snapshot_id = v_snapshot.id;

    select coalesce(sum(greatest(
        coalesce(commitment_for_group.debt_committed,0) + coalesce(goal_for_group.goal_committed,0) - month_group.target_minor, 0
      )),0) into v_future_excess
      from public.allocation_month_groups month_group
      left join (
        select commitment.group_id, commitment.observed_actual_minor + commitment.observed_remaining_minor as debt_committed
        from public.allocation_month_commitments commitment
        where commitment.snapshot_id = v_snapshot.id and commitment.group_id is not null
      ) commitment_for_group on commitment_for_group.group_id = month_group.group_id
      left join (
        select goal_line.group_id, sum(goal_line.amount_minor) as goal_committed
        from public.allocation_month_goal_lines goal_line
        where goal_line.snapshot_id = v_snapshot.id and goal_line.group_id is not null
        group by goal_line.group_id
      ) goal_for_group on goal_for_group.group_id = month_group.group_id
      where month_group.snapshot_id = v_snapshot.id and month_group.purpose = 'future';

    -- Carry is a distinct adjustment, never salary: left-to-allocate is
    -- still measured against base expected income only.
    v_left_to_allocate := v_snapshot.unallocated_minor - v_standalone_root_targets - v_standalone_goal_targets - v_standalone_debt - v_future_excess;

    v_groups := (
      select coalesce(jsonb_agg(jsonb_build_object(
        'groupId', month_group.group_id, 'rowKind', month_group.purpose,
        'nameEn', month_group.name_en, 'nameAr', month_group.name_ar, 'order', month_group.display_order,
        'targetMinor', month_group.target_minor::text,
        'carryMinor', coalesce(group_carry.carry_minor, 0)::text,
        'effectiveTargetMinor', (month_group.target_minor + coalesce(group_carry.carry_minor, 0))::text,
        'actualMinor', (case when month_group.purpose = 'future' then coalesce(commitment_actual.observed_actual_minor, 0) + coalesce(goal_actual.actual, 0)
          else coalesce(group_actual.actual, 0) end)::text,
        'varianceMinor', (month_group.target_minor + coalesce(group_carry.carry_minor, 0)
          - (case when month_group.purpose = 'future' then coalesce(commitment_actual.observed_actual_minor, 0) + coalesce(goal_actual.actual, 0)
          else coalesce(group_actual.actual, 0) end))::text,
        'basisPoints', month_group.basis_points,
        'actualShareOfIncomeBps', case when v_actual_income > 0 then
          floor((case when month_group.purpose = 'future' then coalesce(commitment_actual.observed_actual_minor, 0) + coalesce(goal_actual.actual, 0) else coalesce(group_actual.actual, 0) end) * 10000 / v_actual_income)::text
          else null end,
        'hasPlan', true
      ) order by month_group.display_order), '[]'::jsonb)
      from public.allocation_month_groups month_group
      left join public.allocation_month_commitments commitment_actual
        on commitment_actual.snapshot_id = month_group.snapshot_id and commitment_actual.group_id = month_group.group_id
      left join (
        select root.group_id, sum(activity.expense_minor) as actual
        from public.allocation_month_roots root
        join private.planning_ordinary_activity(p_space_id, v_month, (v_month + interval '1 month')::date) activity
          on activity.root_id = root.category_id and activity.currency = p_currency
        where root.snapshot_id = v_snapshot.id and root.group_id is not null
        group by root.group_id
      ) group_actual on group_actual.group_id = month_group.group_id
      left join (
        select goal_line.group_id, sum(monthly.net) as actual
        from public.allocation_month_goal_lines goal_line
        cross join lateral (
          select coalesce(sum(el.amount_minor),0) as net
          from public.goal_earmark_lines el join public.goal_earmark_events ge on ge.id = el.event_id
          where el.goal_id = goal_line.goal_id and date_trunc('month', ge.effective_date)::date = v_month
        ) monthly
        where goal_line.snapshot_id = v_snapshot.id and goal_line.group_id is not null
        group by goal_line.group_id
      ) goal_actual on goal_actual.group_id = month_group.group_id
      left join (
        select carry.group_id, sum(carry.carry_minor) as carry_minor
        from private.allocation_snapshot_carry(v_snapshot.id) carry
        where carry.group_id is not null
        group by carry.group_id
      ) group_carry on group_carry.group_id = month_group.group_id
      where month_group.snapshot_id = v_snapshot.id
    );

    select coalesce(sum(activity.expense_minor), 0) into v_unmapped_actual
      from private.planning_ordinary_activity(p_space_id, v_month, (v_month + interval '1 month')::date) activity
      where activity.currency = p_currency and activity.root_id is not null
        and not exists (
          select 1 from public.allocation_month_roots root
          where root.snapshot_id = v_snapshot.id and root.category_id = activity.root_id and root.group_id is not null
        );
    v_unmapped_target := v_standalone_root_targets;
  else
    select coalesce(sum(activity.expense_minor), 0) into v_unmapped_actual
      from private.planning_ordinary_activity(p_space_id, v_month, (v_month + interval '1 month')::date) activity
      where activity.currency = p_currency and activity.root_id is not null;
  end if;

  select coalesce(sum(activity.expense_minor), 0) into v_uncategorized_actual
    from private.planning_ordinary_activity(p_space_id, v_month, (v_month + interval '1 month')::date) activity
    where activity.currency = p_currency and activity.root_id is null;

  v_groups := v_groups || jsonb_build_array(jsonb_build_object(
    'groupId', null, 'rowKind', 'unmapped', 'nameEn', null, 'nameAr', null, 'order', null,
    'targetMinor', v_unmapped_target::text,
    'carryMinor', v_unmapped_carry::text,
    'effectiveTargetMinor', (v_unmapped_target + v_unmapped_carry)::text,
    'actualMinor', v_unmapped_actual::text,
    'varianceMinor', (v_unmapped_target + v_unmapped_carry - v_unmapped_actual)::text, 'basisPoints', null,
    'actualShareOfIncomeBps', case when v_actual_income > 0 then floor(v_unmapped_actual * 10000 / v_actual_income)::text else null end,
    'hasPlan', v_unmapped_target <> 0
  ));
  v_groups := v_groups || jsonb_build_array(jsonb_build_object(
    'groupId', null, 'rowKind', 'uncategorized', 'nameEn', null, 'nameAr', null, 'order', null,
    'targetMinor', null, 'carryMinor', null, 'effectiveTargetMinor', null,
    'actualMinor', v_uncategorized_actual::text, 'varianceMinor', null, 'basisPoints', null,
    'actualShareOfIncomeBps', case when v_actual_income > 0 then floor(v_uncategorized_actual * 10000 / v_actual_income)::text else null end,
    'hasPlan', false
  ));

  v_result := jsonb_build_object(
    'snapshotId', v_snapshot.id::text, 'templateRevisionId', v_snapshot.template_revision_id::text,
    'incomeRevisionId', v_snapshot.income_plan_revision_id::text, 'hasPlan', v_has_plan,
    'plannedIncomeMinor', case when v_has_plan then v_snapshot.base_income_minor::text else null end,
    'actualIncomeMinor', v_actual_income::text, 'expenseMinor', v_expense::text,
    'incomeAfterSpendingMinor', v_income_after_spending::text,
    'ownDebtPaidMinor', v_loan_actual::text, 'remainingDebtMinor', v_loan_remaining::text,
    'leftToAllocateMinor', case when v_has_plan then v_left_to_allocate::text else null end,
    'childPlanChanged', v_child_plan_changed,
    'carryMinor', v_carry_total::text, 'carrySourceCloseId', v_carry_source_close_id::text,
    'carryNeedsReview', v_carry_needs_review,
    'asOf', now(), 'groups', v_groups
  );
  return v_result;
end;
$$;


ALTER FUNCTION public.allocation_month_state(p_space_id uuid, p_month date, p_currency public.currency_code, p_snapshot_id bigint) OWNER TO postgres;

--
-- Name: allocation_template_head(uuid, public.currency_code); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.allocation_template_head(p_space_id uuid, p_currency public.currency_code) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_head bigint;
begin
  if p_space_id is null or p_currency is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'planning_not_authorized';
  end if;
  select revision.id into v_head
  from public.allocation_template_revisions as revision
  where revision.space_id = p_space_id and revision.currency = p_currency
  order by revision.id desc
  limit 1;
  return jsonb_build_object('templateRevisionId', v_head::text);
end;
$$;


ALTER FUNCTION public.allocation_template_head(p_space_id uuid, p_currency public.currency_code) OWNER TO postgres;

--
-- Name: allocation_trend(uuid, public.currency_code, date, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.allocation_trend(p_space_id uuid, p_currency public.currency_code, p_first_month date, p_month_count integer) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
declare
  v_months jsonb;
begin
  if p_space_id is null or p_currency is null or p_first_month is null
    or p_first_month <> date_trunc('month', p_first_month)::date or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  if p_month_count is null or p_month_count < 1 or p_month_count > 12 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  with series as (
    select (p_first_month + (n * interval '1 month'))::date as month_start
    from generate_series(0, p_month_count - 1) as n
  ), income_expense as (
    select date_trunc('month', activity.effective_date)::date as month_start,
      sum(activity.income_minor) as income, sum(activity.expense_minor) as expense
    from private.planning_ordinary_activity(p_space_id, p_first_month, (p_first_month + (p_month_count * interval '1 month'))::date) activity
    where activity.currency = p_currency
    group by date_trunc('month', activity.effective_date)::date
  ), loans as (
    select series.month_start, summary.actual_repayment_minor
    from series
    cross join lateral public.loan_monthly_currency_summary(p_space_id, series.month_start) as summary
    where summary.currency = p_currency
  ), snapshots as (
    select distinct on (snapshot.month_start) snapshot.month_start, snapshot.base_income_minor
    from public.allocation_month_snapshots snapshot
    where snapshot.space_id = p_space_id and snapshot.currency = p_currency
      and snapshot.month_start >= p_first_month and snapshot.month_start < (p_first_month + (p_month_count * interval '1 month'))::date
    order by snapshot.month_start, snapshot.id desc
  )
  select jsonb_agg(jsonb_build_object(
    'month', series.month_start, 'incomeMinor', coalesce(ie.income,0)::text, 'expenseMinor', coalesce(ie.expense,0)::text,
    'ownDebtPaidMinor', coalesce(loans.actual_repayment_minor,0)::text,
    'hasPlan', snap.month_start is not null, 'plannedIncomeMinor', snap.base_income_minor::text
  ) order by series.month_start)
  into v_months
  from series
  left join income_expense ie on ie.month_start = series.month_start
  left join loans on loans.month_start = series.month_start
  left join snapshots snap on snap.month_start = series.month_start;

  return jsonb_build_object('months', coalesce(v_months, '[]'::jsonb));
end;
$$;


ALTER FUNCTION public.allocation_trend(p_space_id uuid, p_currency public.currency_code, p_first_month date, p_month_count integer) OWNER TO postgres;

--
-- Name: archive_category(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.archive_category(p_space_id uuid, p_request_id uuid, p_category_id uuid) RETURNS TABLE(id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_fingerprint bytea;
  v_existing_kind text;
  v_existing_fingerprint bytea;
  v_existing_category_id uuid;
  v_archived_at timestamptz;
  v_parent_category_id uuid;
  v_category_kind public.category_kind;
begin
  if p_space_id is null or p_request_id is null or p_category_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'space, request ID, and category are required';
  end if;

  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  perform private.lock_category_request(p_space_id, p_request_id);

  v_fingerprint := extensions.digest(
    pg_catalog.jsonb_build_object(
      'version', 1,
      'command', 'archive_category',
      'categoryId', p_category_id
    )::text,
    'sha256'
  );

  select request.command_kind, request.request_fingerprint, request.category_id
  into v_existing_kind, v_existing_fingerprint, v_existing_category_id
  from public.category_command_requests as request
  where request.space_id = p_space_id
    and request.request_id = p_request_id
  limit 1;

  if found then
    if v_existing_kind is distinct from 'archive_category'
      or v_existing_fingerprint is distinct from v_fingerprint
      or v_existing_category_id is distinct from p_category_id then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_existing_category_id;
    return;
  end if;

  -- Match child creation's lock order: request first, then the parent/target row.
  select category.archived_at, category.parent_category_id, category.kind
  into v_archived_at, v_parent_category_id, v_category_kind
  from public.categories as category
  where category.id = p_category_id
    and category.space_id = p_space_id
  limit 1
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'the category does not belong to the requested space';
  end if;

  if v_archived_at is not null then
    raise exception using errcode = 'P0001', message = 'the category is already archived';
  end if;

  if v_parent_category_id is null and exists (
    select 1
    from public.categories as child
    where child.parent_category_id = p_category_id
      and child.space_id = p_space_id
      and child.kind = v_category_kind
      and child.archived_at is null
    limit 1
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'archive active subcategories before archiving their parent';
  end if;

  update public.categories
  set archived_by = v_actor_id,
      archived_at = now()
  where categories.id = p_category_id;

  insert into public.category_command_requests (
    space_id, request_id, command_kind, request_fingerprint, category_id, actor_id
  )
  values (
    p_space_id, p_request_id, 'archive_category', v_fingerprint, p_category_id, v_actor_id
  );

  return query select p_category_id;
end;
$$;


ALTER FUNCTION public.archive_category(p_space_id uuid, p_request_id uuid, p_category_id uuid) OWNER TO postgres;

--
-- Name: archive_wallet(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.archive_wallet(p_space_id uuid, p_request_id uuid, p_wallet_id uuid) RETURNS TABLE(id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor_id uuid;
  v_fingerprint bytea;
  v_wallet public.wallets;
  v_balance_minor numeric;
begin
  v_actor_id := private.require_wallet_command_actor(p_space_id, p_request_id, p_wallet_id);
  v_fingerprint := extensions.digest(
    pg_catalog.jsonb_build_object('version', 1, 'command', 'archive_wallet', 'walletId', p_wallet_id)::text,
    'sha256'
  );

  if private.replay_wallet_command(p_space_id, p_request_id, 'archive_wallet', v_fingerprint, p_wallet_id) then
    return query select p_wallet_id;
    return;
  end if;

  v_wallet := private.lock_space_wallet(p_space_id, p_wallet_id);

  if v_wallet.archived_at is not null then
    raise exception using errcode = 'P0001', message = 'the wallet is already archived';
  end if;

  select coalesce(sum(movement.amount_minor), 0)
  into v_balance_minor
  from public.wallet_movements as movement
  where movement.wallet_id = p_wallet_id
    and movement.space_id = p_space_id;

  if v_balance_minor <> 0 then
    raise exception using errcode = 'P0001', message = 'the wallet balance must be zero to archive';
  end if;

  update public.wallets as wallet
  set archived_at = pg_catalog.now()
  where wallet.id = p_wallet_id;

  insert into public.wallet_command_requests (
    space_id, request_id, command_kind, request_fingerprint, wallet_id, actor_id
  )
  values (p_space_id, p_request_id, 'archive_wallet', v_fingerprint, p_wallet_id, v_actor_id);

  return query select p_wallet_id;
end;
$$;


ALTER FUNCTION public.archive_wallet(p_space_id uuid, p_request_id uuid, p_wallet_id uuid) OWNER TO postgres;

--
-- Name: available_cash_summary(uuid, public.currency_code, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.available_cash_summary(p_space_id uuid, p_currency public.currency_code, p_as_of_date date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
declare
  v_today date := private.space_today(p_space_id);
  v_month date;
  v_month_end date;
  v_horizon_end date;
  v_snapshot public.allocation_month_snapshots%rowtype;
  v_has_snapshot boolean := false;
  v_missing_count integer := 0;
  v_backlog_count integer := 0;
  v_unmaterialized_count integer := 0;
  v_state text;
  v_needs_review boolean := false;
  v_cash numeric := 0;
  v_claims numeric := 0;
  v_received_income numeric := 0;
  v_ordinary_spending numeric := 0;
  v_uncategorized numeric := 0;
  v_days_remaining integer;
  v_expense_commitments numeric;
  v_debt_commitments numeric;
  v_goal_topups numeric;
  v_future_headroom numeric;
  v_available numeric;
  v_deficit numeric;
  v_spendable numeric;
  v_daily_guide numeric;
  v_groups jsonb := '[]'::jsonb;
  v_current_income_id bigint;
begin
  if p_space_id is null or p_currency is null or p_as_of_date is null
    or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  if p_as_of_date <> v_today then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  v_month := date_trunc('month', v_today)::date;
  v_month_end := (v_month + interval '1 month - 1 day')::date;
  v_horizon_end := v_today + 89;
  v_days_remaining := (v_month_end - v_today) + 1;

  v_cash := private.goal_cash_pool(p_space_id, p_currency, v_today);
  v_claims := private.goal_space_earmarked_total(p_space_id, p_currency, v_today);

  select coalesce(sum(activity.income_minor), 0), coalesce(sum(activity.expense_minor), 0),
    coalesce(sum(activity.expense_minor) filter (where activity.root_id is null), 0)
    into v_received_income, v_ordinary_spending, v_uncategorized
    from private.planning_ordinary_activity(p_space_id, v_month, v_today + 1) activity
    where activity.currency = p_currency;

  select * into v_snapshot from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = v_month
    order by id desc limit 1;
  v_has_snapshot := found;

  if v_has_snapshot then
    v_missing_count := private.planning_materialization_gap(p_space_id, p_currency, v_today, v_horizon_end);
    if v_missing_count = 0 then
      v_backlog_count := private.planning_unpaid_backlog_count(p_space_id, p_currency, v_today, v_horizon_end);
    end if;
  end if;

  if not v_has_snapshot then
    v_state := 'unplanned';
  elsif v_missing_count > 0 or v_backlog_count > 500 then
    v_state := 'incomplete';
  else
    v_state := 'ready';
  end if;

  -- unmaterializedCount reports "how many things need materializing before
  -- this number can be trusted," never the ordinary unpaid-bill count of a
  -- healthy plan. v_backlog_count is computed (and only computed) once
  -- v_missing_count is already known to be zero, so it is meaningful only
  -- as the specific >500 trigger the brief names, never as a generic bill
  -- count: report it only when it actually exceeded that cap.
  if v_missing_count > 0 then
    v_unmaterialized_count := v_missing_count;
  elsif v_backlog_count > 500 then
    v_unmaterialized_count := v_backlog_count;
  end if;

  if v_state = 'ready' then
    select id into v_current_income_id from public.monthly_budget_plan_revisions
      where space_id = p_space_id and currency = p_currency and month_start = v_month and plan_kind = 'income'
      order by id desc limit 1;
    if v_current_income_id is distinct from v_snapshot.income_plan_revision_id then
      v_needs_review := true;
    end if;
    if not v_needs_review and exists (
      select 1 from public.allocation_month_roots root
      left join lateral (
        select revision.id from public.monthly_budget_plan_revisions revision
        where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = v_month
          and revision.plan_kind = 'expense_category' and revision.category_id = root.category_id
        order by revision.id desc limit 1
      ) current_head on true
      where root.snapshot_id = v_snapshot.id and current_head.id is distinct from root.target_revision_id
    ) then
      v_needs_review := true;
    end if;
    if not v_needs_review and exists (
      select 1 from public.allocation_month_goal_lines goal_line
      left join lateral (
        select revision.id from public.goal_monthly_target_revisions revision
        where revision.goal_id = goal_line.goal_id and revision.space_id = p_space_id
          and revision.currency = p_currency and revision.month_start = v_month
        order by revision.id desc limit 1
      ) current_head on true
      where goal_line.snapshot_id = v_snapshot.id and current_head.id is distinct from goal_line.target_revision_id
    ) then
      v_needs_review := true;
    end if;

    select coalesce(sum(bucket.commitment_minor), 0) into v_expense_commitments
      from private.planning_expense_buckets(p_space_id, p_currency, v_today, v_month_end, v_horizon_end) bucket;

    select coalesce(sum(commitment.debt_commitment_minor), 0), coalesce(sum(commitment.goal_topups_minor), 0),
      coalesce(sum(greatest(
        commitment.group_target_minor - commitment.saved_goal_targets_minor - commitment.original_debt_commitment_minor, 0
      )) filter (where commitment.group_target_minor is not null), 0)
      into v_debt_commitments, v_goal_topups, v_future_headroom
      from private.planning_cash_commitments(p_space_id, p_currency, v_today) commitment;

    v_available := v_cash - v_claims - v_expense_commitments - v_debt_commitments - v_goal_topups - v_future_headroom;
    v_deficit := greatest(-v_available, 0);
    v_spendable := greatest(v_available, 0);
    v_daily_guide := floor(v_spendable / v_days_remaining);

    v_groups := (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', month_group.group_id, 'nameEn', month_group.name_en, 'nameAr', month_group.name_ar,
        'budgetRemainingMinor',
          (case when month_group.purpose = 'future'
            then commitment.group_target_minor - commitment.saved_goal_targets_minor - commitment.original_debt_commitment_minor
            else bucket.budget_remaining_minor end)::text,
        'unpaidBillsMinor', (case when month_group.purpose = 'future' then null else bucket.unpaid_bills_minor::text end),
        'goalOverlapMinor', (case when month_group.purpose = 'future' then null else bucket.goal_overlap_minor::text end),
        'commitmentMinor',
          (case when month_group.purpose = 'future'
            then commitment.debt_commitment_minor + commitment.goal_topups_minor
              + greatest(commitment.group_target_minor - commitment.saved_goal_targets_minor - commitment.original_debt_commitment_minor, 0)
            else coalesce(bucket.commitment_minor, 0) end)::text
      ) order by month_group.display_order), '[]'::jsonb)
      from public.allocation_month_groups month_group
      left join private.planning_expense_buckets(p_space_id, p_currency, v_today, v_month_end, v_horizon_end) bucket
        on bucket.group_id = month_group.group_id
      left join private.planning_cash_commitments(p_space_id, p_currency, v_today) commitment
        on commitment.group_id = month_group.group_id
      where month_group.snapshot_id = v_snapshot.id
    );
  end if;

  return jsonb_build_object(
    'currency', p_currency, 'asOf', p_as_of_date, 'state', v_state, 'needsReview', v_needs_review,
    'snapshotId', case when v_has_snapshot then v_snapshot.id::text else null end,
    'cashMinor', v_cash::text, 'goalClaimsMinor', v_claims::text,
    'expenseCommitmentsMinor', case when v_state = 'ready' then v_expense_commitments::text else null end,
    'debtCommitmentsMinor', case when v_state = 'ready' then v_debt_commitments::text else null end,
    'goalTopupsMinor', case when v_state = 'ready' then v_goal_topups::text else null end,
    'futureHeadroomMinor', case when v_state = 'ready' then v_future_headroom::text else null end,
    'availableMinor', case when v_state = 'ready' then v_available::text else null end,
    'deficitMinor', case when v_state = 'ready' then v_deficit::text else null end,
    'spendableMinor', case when v_state = 'ready' then v_spendable::text else null end,
    'dailyExtraGuideMinor', case when v_state = 'ready' then v_daily_guide::text else null end,
    'daysRemaining', v_days_remaining,
    'receivedIncomeMinor', v_received_income::text, 'ordinarySpendingMinor', v_ordinary_spending::text,
    'incomeMinusSpendingMinor', (v_received_income - v_ordinary_spending)::text,
    'uncategorizedMinor', v_uncategorized::text,
    'unmaterializedCount', v_unmaterialized_count,
    'groups', v_groups
  );
end;
$$;


ALTER FUNCTION public.available_cash_summary(p_space_id uuid, p_currency public.currency_code, p_as_of_date date) OWNER TO postgres;

--
-- Name: cancel_household_invitation(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.cancel_household_invitation(p_space_id uuid, p_request_id uuid, p_invitation_id uuid) RETURNS TABLE(invitation_id uuid, status public.household_invitation_status)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_actor_id uuid := private.household_actor_user_id();
  v_fingerprint bytea;
  v_existing_event public.household_membership_events%rowtype;
  v_invitation public.household_invitations%rowtype;
  v_space_kind public.space_kind;
  v_now timestamptz := now();
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_space_id is null or p_request_id is null or p_invitation_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  v_fingerprint := private.household_command_fingerprint(
    'cancel_household_invitation|' || p_space_id::text || '|' || p_invitation_id::text
  );
  perform private.lock_household_request(v_actor_id, p_request_id);

  select event.*
  into v_existing_event
  from public.household_membership_events as event
  where event.actor_user_id = v_actor_id
    and event.request_id = p_request_id;

  if found then
    if v_existing_event.kind <> 'invitation_cancelled'
      or v_existing_event.request_fingerprint <> v_fingerprint
      or v_existing_event.invitation_id <> p_invitation_id then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;
    return query select p_invitation_id, 'cancelled'::public.household_invitation_status;
    return;
  end if;

  v_space_kind := private.lock_household_space(p_space_id);
  if v_space_kind is null then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;
  if v_space_kind <> 'household' then
    raise exception using errcode = 'P0001', message = 'personal_space_prohibited';
  end if;
  if not private.is_active_owner(p_space_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  select invitation.*
  into v_invitation
  from public.household_invitations as invitation
  where invitation.id = p_invitation_id
    and invitation.space_id = p_space_id
  for update;

  if not found or v_invitation.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'invitation_unavailable';
  end if;

  update public.household_invitations
  set status = 'cancelled',
      cancelled_by_user_id = v_actor_id,
      cancelled_at = v_now
  where id = v_invitation.id;

  insert into public.household_membership_events (
    space_id, actor_user_id, request_id, request_fingerprint,
    kind, invitation_id, occurred_at
  )
  values (
    p_space_id, v_actor_id, p_request_id, v_fingerprint,
    'invitation_cancelled', p_invitation_id, v_now
  );

  return query select p_invitation_id, 'cancelled'::public.household_invitation_status;
end;
$$;


ALTER FUNCTION public.cancel_household_invitation(p_space_id uuid, p_request_id uuid, p_invitation_id uuid) OWNER TO postgres;

--
-- Name: cash_outlook(uuid, public.currency_code, date, integer, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.cash_outlook(p_space_id uuid, p_currency public.currency_code, p_start_date date, p_days integer, p_scenario text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
declare
  v_today date := private.space_today(p_space_id);
  v_end_date date;
  v_opening numeric;
  v_missing_count integer;
  v_backlog_count integer;
  v_overdue_count integer := 0;
  v_overdue_minor numeric := 0;
  v_state text := 'ready';
  v_days jsonb;
  v_first_negative date;
  v_assumption text;
begin
  if p_space_id is null or p_currency is null or p_start_date is null or p_days is null or p_scenario is null
    or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  if p_start_date <> v_today then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_days < 1 or p_days > 90 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_scenario not in ('expected', 'no_future_income') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_end_date := p_start_date + (p_days - 1);

  v_missing_count := private.planning_materialization_gap(p_space_id, p_currency, p_start_date, v_end_date);
  if v_missing_count = 0 then
    v_backlog_count := private.planning_unpaid_backlog_count(p_space_id, p_currency, p_start_date, v_end_date);
  else
    v_backlog_count := 0;
  end if;
  if v_missing_count > 0 or v_backlog_count > 500 then
    v_state := 'incomplete';
  end if;

  v_opening := private.goal_cash_pool(p_space_id, p_currency, p_start_date);

  select coalesce(count(*), 0), coalesce(sum(greatest(so.expected_minor - stl.settled_minor, 0)), 0)
    into v_overdue_count, v_overdue_minor
  from public.scheduled_occurrences so
  join public.schedules sch on sch.id = so.schedule_id and sch.space_id = p_space_id and sch.kind in ('expense', 'debt_payment')
  cross join lateral private.schedule_occurrence_settlement(so.id, p_start_date) stl
  where so.space_id = p_space_id and so.currency = p_currency
    and so.due_date < p_start_date and not stl.skipped
    and greatest(so.expected_minor - stl.settled_minor, 0) > 0;

  v_assumption := case when p_scenario = 'expected'
    then 'Projects only unpaid scheduled income and scheduled bills; unplanned day-to-day spending can still lower this line.'
    else 'Assumes no further income arrives in this window; scheduled bills still apply.' end
    || case when v_overdue_count > 0
      then format(' Today''s outflow includes %s overdue unpaid bill%s already past due.',
        v_overdue_count, case when v_overdue_count = 1 then '' else 's' end)
      else '' end;

  with days as (
    select gs.day_offset from generate_series(0, p_days - 1) as gs(day_offset)
  ), day_dates as (
    select days.day_offset, (p_start_date + days.day_offset)::date as day_date from days
  ), income_by_day as (
    -- Unlike outflow_by_day below, overdue unpaid income (due_date before
    -- p_start_date) is never bucketed onto today -- an unconfirmed salary
    -- from weeks ago is not silently assumed to arrive today just because
    -- today is the earliest day left in this window. The conservative
    -- default for a shortfall-warning screen is to exclude it from
    -- expectedIncomeMinor entirely, never invent an arrival day for it; see
    -- docs/decisions.md, "final review fix wave" entry, finding 2.
    select so.due_date as bucket_date,
      sum(greatest(so.expected_minor - stl.settled_minor, 0)) as amount_minor
    from public.scheduled_occurrences so
    join public.schedules sch on sch.id = so.schedule_id and sch.space_id = p_space_id and sch.kind = 'income'
    cross join lateral private.schedule_occurrence_settlement(so.id, p_start_date) stl
    where so.space_id = p_space_id and so.currency = p_currency and p_scenario = 'expected'
      and not stl.skipped and greatest(so.expected_minor - stl.settled_minor, 0) > 0
      and so.due_date >= p_start_date and so.due_date <= v_end_date
    group by so.due_date
  ), outflow_by_day as (
    select greatest(so.due_date, p_start_date) as bucket_date,
      sum(greatest(so.expected_minor - stl.settled_minor, 0)) as amount_minor
    from public.scheduled_occurrences so
    join public.schedules sch on sch.id = so.schedule_id and sch.space_id = p_space_id and sch.kind in ('expense', 'debt_payment')
    cross join lateral private.schedule_occurrence_settlement(so.id, p_start_date) stl
    where so.space_id = p_space_id and so.currency = p_currency
      and not stl.skipped and greatest(so.expected_minor - stl.settled_minor, 0) > 0
      and greatest(so.due_date, p_start_date) <= v_end_date
    group by greatest(so.due_date, p_start_date)
  ), per_day as (
    select day_dates.day_offset, day_dates.day_date,
      coalesce(income_by_day.amount_minor, 0) as income_minor,
      coalesce(outflow_by_day.amount_minor, 0) as outflow_minor
    from day_dates
    left join income_by_day on income_by_day.bucket_date = day_dates.day_date
    left join outflow_by_day on outflow_by_day.bucket_date = day_dates.day_date
  ), running as (
    select per_day.*,
      v_opening + coalesce(sum(income_minor - outflow_minor) over (
        order by day_offset rows between unbounded preceding and 1 preceding
      ), 0) as opening_minor
    from per_day
  ), closed as (
    select running.*, running.opening_minor + running.income_minor - running.outflow_minor as closing_minor
    from running
  )
  select jsonb_agg(jsonb_build_object(
      'date', closed.day_date, 'openingCashMinor', closed.opening_minor::text,
      'expectedIncomeMinor', closed.income_minor::text, 'expectedOutflowMinor', closed.outflow_minor::text,
      'closingCashMinor', closed.closing_minor::text
    ) order by closed.day_offset),
    min(closed.day_date) filter (where closed.closing_minor < 0)
  into v_days, v_first_negative
  from closed;

  return jsonb_build_object(
    'currency', p_currency, 'startDate', p_start_date, 'scenario', p_scenario, 'assumption', v_assumption,
    'days', coalesce(v_days, '[]'::jsonb), 'firstNegativeDate', v_first_negative, 'state', v_state,
    'overdueCount', v_overdue_count, 'overdueMinor', v_overdue_minor::text
  );
end;
$$;


ALTER FUNCTION public.cash_outlook(p_space_id uuid, p_currency public.currency_code, p_start_date date, p_days integer, p_scenario text) OWNER TO postgres;

--
-- Name: close_budget_month(uuid, uuid, public.currency_code, date, bigint, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.close_budget_month(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_month date, p_expected_close_id bigint, p_accepted_preview_hash text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_preview jsonb;
  v_snapshot_id bigint;
  v_close_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_currency is null or p_month is null
    or p_accepted_preview_hash is null or p_accepted_preview_hash !~ '^[0-9a-f]{64}$'
    or p_month <> date_trunc('month', p_month)::date then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  v_actor := private.lock_planning_actor(p_space_id);
  v_fingerprint := private.planning_fingerprint('close_budget_month', v_actor, jsonb_build_object(
    'currency', p_currency, 'month', p_month, 'expectedCloseId', p_expected_close_id::text,
    'acceptedPreviewHash', p_accepted_preview_hash
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'close_budget_month', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  -- Recompute under the space lock: a posting committed since the preview
  -- changes the fact digest and therefore the hash.
  v_preview := private.budget_month_close_preview(p_space_id, p_currency, p_month, p_expected_close_id);
  if (v_preview->>'expectedCloseId') is distinct from p_expected_close_id::text
    or (v_preview->>'previewHash') is distinct from p_accepted_preview_hash then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;
  v_snapshot_id := (v_preview->>'snapshotId')::bigint;

  insert into public.budget_month_closes (
    space_id, currency, month_start, source_snapshot_id, expected_close_id, fact_digest, fact_count, root_count,
    closed_income_minor, closed_spending_minor, request_id, actor_id
  ) values (
    p_space_id, p_currency, p_month, v_snapshot_id, p_expected_close_id, decode(v_preview->>'factDigest', 'hex'),
    (v_preview->>'factCount')::bigint, jsonb_array_length(v_preview->'roots'),
    (v_preview->>'incomeMinor')::numeric, (v_preview->>'spendingMinor')::numeric, p_request_id, v_actor
  ) returning id into v_close_id;

  insert into public.budget_month_close_roots (
    close_id, space_id, currency, month_start, source_snapshot_id, root_id, policy_revision_id, enabled,
    base_target_minor, incoming_carry_minor, actual_minor, outgoing_carry_minor
  )
  select v_close_id, p_space_id, p_currency, p_month, v_snapshot_id, (root->>'categoryId')::uuid,
    (root->>'policyRevisionId')::bigint, (root->>'enabled')::boolean, (root->>'baseMinor')::bigint,
    (root->>'carryMinor')::numeric, (root->>'actualMinor')::numeric, (root->>'outgoingCarryMinor')::numeric
  from jsonb_array_elements(v_preview->'roots') root;

  v_result := jsonb_build_object(
    'closeId', v_close_id::text, 'previewHash', p_accepted_preview_hash, 'restatesCloseId', p_expected_close_id::text
  );
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'close_budget_month', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$_$;


ALTER FUNCTION public.close_budget_month(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_month date, p_expected_close_id bigint, p_accepted_preview_hash text) OWNER TO postgres;

--
-- Name: confirm_scheduled_occurrence(uuid, uuid, uuid, bigint, text, date, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.confirm_scheduled_occurrence(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_expected_event_id bigint, p_actual_amount_minor text, p_effective_date date, p_wallet_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_occurrence public.scheduled_occurrences%rowtype;
  v_schedule_kind text;
  v_current_event_id bigint;
  v_settled numeric; v_skipped boolean;
  v_today date := (now() at time zone 'UTC')::date;
  v_amount_minor bigint;
  v_wallet_currency public.currency_code;
  v_category_kind public.category_kind;
  v_goal public.goals%rowtype;
  v_goal_state text;
  v_movements jsonb;
  v_financial_event_id uuid;
  v_occurrence_event_id bigint;
  v_earmarked numeric; v_fulfilled numeric; v_head text;
  v_goal_alloc numeric;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_occurrence_id is null
    or p_actual_amount_minor is null or p_effective_date is null or p_wallet_id is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_effective_date > v_today then
    raise exception using errcode='P0001', message='a payment cannot be confirmed before its effective date has occurred';
  end if;
  v_amount_minor := private.planning_minor(p_actual_amount_minor, true);

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('confirm_scheduled_occurrence', v_actor, jsonb_build_object(
    'occurrenceId', p_occurrence_id, 'expectedEventId', p_expected_event_id,
    'actualAmountMinor', v_amount_minor::text, 'effectiveDate', p_effective_date, 'walletId', p_wallet_id
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'confirm_scheduled_occurrence', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select * into v_occurrence from public.scheduled_occurrences where id = p_occurrence_id and space_id = p_space_id for update;
  if not found then
    raise exception using errcode='P0001', message='the occurrence does not belong to the requested space';
  end if;
  select kind into v_schedule_kind from public.schedules where id = v_occurrence.schedule_id;

  select max(id) into v_current_event_id from public.occurrence_events where occurrence_id = p_occurrence_id;
  if v_current_event_id is distinct from p_expected_event_id then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  select settled_minor, skipped into v_settled, v_skipped
    from private.schedule_occurrence_settlement(p_occurrence_id, v_today);
  if v_skipped then
    raise exception using errcode='P0001', message='a skipped occurrence cannot be confirmed';
  end if;

  select currency into v_wallet_currency from public.wallets
    where id = p_wallet_id and space_id = p_space_id and archived_at is null;
  if not found or v_wallet_currency is distinct from v_occurrence.currency then
    raise exception using errcode='P0001', message='the payment wallet must be active and share the occurrence currency';
  end if;

  if v_occurrence.category_id is not null then
    select kind into v_category_kind from public.categories
      where id = v_occurrence.category_id and space_id = p_space_id and archived_at is null;
    if not found or v_category_kind::text is distinct from v_schedule_kind then
      raise exception using errcode='P0001', message='the referenced category is no longer active or eligible';
    end if;
  end if;

  if v_schedule_kind = 'debt_payment' then
    if v_occurrence.loan_id is null then
      raise exception using errcode='P0001', message='a debt payment occurrence requires a loan reference';
    end if;
    perform 1 from public.loans
      where id = v_occurrence.loan_id and space_id = p_space_id and currency = v_occurrence.currency and direction = 'i_owe_them';
    if not found then
      raise exception using errcode='P0001', message='the referenced loan is no longer eligible for this payment';
    end if;
    select event_id into v_financial_event_id from public.record_loan_repayment(
      p_space_id, private.planning_child_request(p_request_id, 'confirm_scheduled_occurrence:post'),
      v_occurrence.loan_id, p_wallet_id, v_amount_minor::text, p_effective_date
    );
  else
    v_movements := jsonb_build_array(jsonb_build_object(
      'walletId', p_wallet_id::text,
      'amountMinor', (case when v_schedule_kind = 'income' then v_amount_minor else -v_amount_minor end)::text
    ));
    if v_occurrence.category_id is not null then
      select id into v_financial_event_id from public.record_categorized_financial_event(
        p_space_id, private.planning_child_request(p_request_id, 'confirm_scheduled_occurrence:post'),
        v_schedule_kind::public.financial_event_kind, p_effective_date, v_movements, v_occurrence.category_id
      );
    else
      select id into v_financial_event_id from public.record_financial_event(
        p_space_id, private.planning_child_request(p_request_id, 'confirm_scheduled_occurrence:post'),
        v_schedule_kind::public.financial_event_kind, p_effective_date, v_movements
      );
    end if;
  end if;

  insert into public.occurrence_events (
    occurrence_id, space_id, expected_event_id, action, linked_event_id, link_amount_minor, request_id, actor_id
  ) values (
    p_occurrence_id, p_space_id, p_expected_event_id, 'confirm', v_financial_event_id, v_amount_minor, p_request_id, v_actor
  ) returning id into v_occurrence_event_id;

  if v_schedule_kind = 'expense' and v_occurrence.funding_goal_id is not null then
    select * into v_goal from public.goals where id = v_occurrence.funding_goal_id and space_id = p_space_id;
    if found and v_goal.currency = v_occurrence.currency then
      select state into v_goal_state from public.goal_revisions where goal_id = v_goal.id order by id desc limit 1;
      if v_goal_state = 'active' then
        select earmarked_minor, fulfilled_minor, head into v_earmarked, v_fulfilled, v_head
          from private.goal_financing_state(v_goal.id, v_today);
        v_goal_alloc := least(greatest(v_earmarked,0), v_amount_minor);
        if v_goal_alloc > 0 then
          perform public.link_goal_purchase(
            p_space_id, private.planning_child_request(p_request_id, 'confirm_scheduled_occurrence:goal'),
            v_financial_event_id, jsonb_build_array(jsonb_build_object(
              'goalId', v_goal.id::text, 'amountMinor', v_goal_alloc::text, 'expectedHead', v_head
            ))
          );
        end if;
      end if;
    end if;
  end if;

  v_result := jsonb_build_object(
    'occurrenceId', p_occurrence_id::text, 'occurrenceEventId', v_occurrence_event_id::text,
    'financialEventId', v_financial_event_id::text
  );
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'confirm_scheduled_occurrence', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$$;


ALTER FUNCTION public.confirm_scheduled_occurrence(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_expected_event_id bigint, p_actual_amount_minor text, p_effective_date date, p_wallet_id uuid) OWNER TO postgres;

--
-- Name: copy_allocation_month(uuid, uuid, public.currency_code, bigint, date, bigint, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.copy_allocation_month(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_source_snapshot_id bigint, p_target_month date, p_expected_target_snapshot_id bigint, p_accepted_preview_hash text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_preview jsonb;
  v_published jsonb;
  v_snapshot_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_currency is null or p_source_snapshot_id is null
    or p_target_month is null or p_target_month <> date_trunc('month', p_target_month)::date
    or p_accepted_preview_hash is null or p_accepted_preview_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  v_actor := private.lock_planning_actor(p_space_id);
  v_fingerprint := private.planning_fingerprint('copy_allocation_month', v_actor, jsonb_build_object(
    'currency', p_currency, 'sourceSnapshotId', p_source_snapshot_id::text, 'targetMonth', p_target_month,
    'expectedTargetSnapshotId', p_expected_target_snapshot_id::text, 'acceptedPreviewHash', p_accepted_preview_hash
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'copy_allocation_month', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  v_preview := private.month_copy_preview(p_space_id, p_currency, p_source_snapshot_id, p_target_month);
  if (v_preview->>'expectedTargetSnapshotId') is distinct from p_expected_target_snapshot_id::text
    or (v_preview->>'previewHash') is distinct from p_accepted_preview_hash then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  -- The accepted preview is published through the existing v2 command under
  -- a request ID derived from this command's own, so v2 keeps every one of
  -- its own checks (complete set, group fit, loan re-observation).
  v_published := public.publish_allocation_month_v2(
    p_space_id, private.planning_child_request(p_request_id, 'copy_allocation_month:publish'),
    p_target_month, p_currency, p_expected_target_snapshot_id,
    (v_preview->>'templateRevisionId')::bigint, (v_preview->>'expectedIncomeRevisionId')::bigint,
    v_preview->>'incomeMinor',
    (select coalesce(jsonb_agg(jsonb_build_object(
        'categoryId', root->'categoryId', 'amountMinor', root->'baseMinor', 'expectedRevisionId', root->'expectedRevisionId'
      )), '[]'::jsonb) from jsonb_array_elements(v_preview->'roots') root),
    (v_preview->>'loanGroupId')::uuid,
    (select coalesce(jsonb_agg(jsonb_build_object(
        'goalId', goal->'goalId', 'groupId', goal->'groupId', 'amountMinor', goal->'targetMinor',
        'expectedRevisionId', goal->'expectedRevisionId'
      )), '[]'::jsonb) from jsonb_array_elements(v_preview->'goals') goal)
  );
  v_snapshot_id := (v_published->>'snapshotId')::bigint;

  insert into public.budget_month_carry_links (
    space_id, currency, source_close_id, source_month_start, target_snapshot_id, target_month_start,
    root_id, carry_minor, actor_id
  )
  select p_space_id, p_currency, (carry->>'sourceCloseId')::bigint, (p_target_month - interval '1 month')::date,
    v_snapshot_id, p_target_month, (carry->>'rootId')::uuid, (carry->>'carryMinor')::numeric, v_actor
  from jsonb_array_elements(v_preview->'carrySources') carry;

  v_result := jsonb_build_object(
    'snapshotId', v_snapshot_id::text, 'sourceSnapshotId', p_source_snapshot_id::text,
    'previewHash', p_accepted_preview_hash
  );
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'copy_allocation_month', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$_$;


ALTER FUNCTION public.copy_allocation_month(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_source_snapshot_id bigint, p_target_month date, p_expected_target_snapshot_id bigint, p_accepted_preview_hash text) OWNER TO postgres;

--
-- Name: create_category(uuid, uuid, public.category_kind, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_category(p_space_id uuid, p_request_id uuid, p_kind public.category_kind, p_name_en text, p_name_ar text) RETURNS TABLE(id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_name_en text;
  v_name_ar text;
  v_fingerprint bytea;
  v_existing_kind text;
  v_existing_fingerprint bytea;
  v_category_id uuid;
  v_constraint_name text;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  perform private.lock_category_request(p_space_id, p_request_id);

  v_name_en := private.canonical_category_name(p_name_en);
  v_name_ar := private.canonical_category_name(p_name_ar);

  if p_kind is null
    or (v_name_en is null and v_name_ar is null)
    or (v_name_en is not null and pg_catalog.char_length(v_name_en) > 120)
    or (v_name_ar is not null and pg_catalog.char_length(v_name_ar) > 120)
    or (v_name_en is not null and pg_catalog.btrim(private.english_category_key(v_name_en)) = '')
    or (v_name_ar is not null and pg_catalog.btrim(private.arabic_category_key(v_name_ar)) = '') then
    raise exception using errcode = 'P0001', message = 'a kind and at least one bounded searchable category name are required';
  end if;

  v_fingerprint := extensions.digest(
    pg_catalog.jsonb_build_object(
      'version', 1,
      'command', 'create_category',
      'kind', p_kind::text,
      'nameEn', v_name_en,
      'nameAr', v_name_ar
    )::text,
    'sha256'
  );

  select request.command_kind, request.request_fingerprint, request.category_id
  into v_existing_kind, v_existing_fingerprint, v_category_id
  from public.category_command_requests as request
  where request.space_id = p_space_id
    and request.request_id = p_request_id;

  if found then
    if v_existing_kind is distinct from 'create_category'
      or v_existing_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_category_id;
    return;
  end if;

  begin
    insert into public.categories (space_id, kind, name_en, name_ar, created_by)
    values (p_space_id, p_kind, v_name_en, v_name_ar, v_actor_id)
    returning categories.id into v_category_id;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name in ('categories_active_name_en_idx', 'categories_active_name_ar_idx') then
        raise exception using
          errcode = 'P0001',
          message = 'an active category already uses one of the supplied normalized names';
      end if;
      raise;
  end;

  insert into public.category_command_requests (
    space_id, request_id, command_kind, request_fingerprint, category_id, actor_id
  )
  values (
    p_space_id, p_request_id, 'create_category', v_fingerprint, v_category_id, v_actor_id
  );

  return query select v_category_id;
end;
$$;


ALTER FUNCTION public.create_category(p_space_id uuid, p_request_id uuid, p_kind public.category_kind, p_name_en text, p_name_ar text) OWNER TO postgres;

--
-- Name: create_goal_plan(uuid, uuid, uuid, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_goal_plan(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_definition jsonb, p_milestones jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_kind text; v_currency public.currency_code; v_name_en text; v_name_ar text; v_note text;
  v_target_minor bigint; v_deadline date; v_contribution_mode text; v_monthly_minor bigint; v_priority integer;
  v_canonical_milestones jsonb;
  v_entry jsonb;
  v_milestone_ids uuid[] := '{}';
  v_active_count integer;
  v_relevant_count integer;
  v_revision_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_goal_id is null or p_definition is null or p_milestones is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if jsonb_typeof(p_definition) is distinct from 'object'
    or (p_definition ?& array['kind','currency','nameEn','nameAr','note','targetMinor','deadline','contributionMode','monthlyAmountMinor','priority']) is not true
    or (p_definition - array['kind','currency','nameEn','nameAr','note','targetMinor','deadline','contributionMode','monthlyAmountMinor','priority']) <> '{}'::jsonb
  then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if jsonb_typeof(p_definition->'kind') is distinct from 'string' or (p_definition->>'kind') not in ('reserve','purchase') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_kind := p_definition->>'kind';
  if jsonb_typeof(p_definition->'currency') is distinct from 'string' or (p_definition->>'currency') not in ('USD','LBP') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_currency := (p_definition->>'currency')::public.currency_code;
  if jsonb_typeof(p_definition->'nameEn') not in ('string','null') or jsonb_typeof(p_definition->'nameAr') not in ('string','null') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if jsonb_typeof(p_definition->'note') not in ('string','null') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_name_en := nullif(p_definition->>'nameEn', '');
  v_name_ar := nullif(p_definition->>'nameAr', '');
  v_note := p_definition->>'note';
  v_target_minor := private.planning_minor(p_definition->>'targetMinor', true);
  if jsonb_typeof(p_definition->'deadline') not in ('string','null') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if nullif(p_definition->>'deadline','') is not null and not pg_input_is_valid(p_definition->>'deadline', 'date') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_deadline := nullif(p_definition->>'deadline', '')::date;
  if jsonb_typeof(p_definition->'contributionMode') is distinct from 'string'
    or (p_definition->>'contributionMode') not in ('manual_monthly','by_deadline')
  then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_contribution_mode := p_definition->>'contributionMode';
  if jsonb_typeof(p_definition->'monthlyAmountMinor') not in ('string','null') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_monthly_minor := case when p_definition->>'monthlyAmountMinor' is null then null
    else private.planning_minor(p_definition->>'monthlyAmountMinor', false) end;
  if jsonb_typeof(p_definition->'priority') is distinct from 'number'
    or (p_definition->>'priority')::numeric <> floor((p_definition->>'priority')::numeric)
  then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_priority := (p_definition->>'priority')::integer;
  if v_priority < 0 or v_priority > 999 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  if jsonb_typeof(p_milestones) is distinct from 'array' or jsonb_array_length(p_milestones) > 20 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  for v_entry in select value from jsonb_array_elements(p_milestones) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or (v_entry ?& array['id','kind','labelEn','labelAr','thresholdMinor','dueDate','ordinal']) is not true
      or (v_entry - array['id','kind','labelEn','labelAr','thresholdMinor','dueDate','ordinal']) <> '{}'::jsonb
      or jsonb_typeof(v_entry->'id') is distinct from 'string'
      or (v_entry->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (v_entry->>'kind') not in ('amount','checklist')
      or jsonb_typeof(v_entry->'labelEn') not in ('string','null')
      or jsonb_typeof(v_entry->'labelAr') not in ('string','null')
      or jsonb_typeof(v_entry->'thresholdMinor') not in ('string','null')
      or jsonb_typeof(v_entry->'dueDate') not in ('string','null')
      or (nullif(v_entry->>'dueDate','') is not null and not pg_input_is_valid(v_entry->>'dueDate', 'date'))
      or (nullif(v_entry->>'thresholdMinor','') is not null and v_entry->>'thresholdMinor' !~ '^[0-9]+$')
      or jsonb_typeof(v_entry->'ordinal') is distinct from 'number'
      or (v_entry->>'ordinal')::numeric <> floor((v_entry->>'ordinal')::numeric)
      or (v_entry->>'ordinal')::numeric not between 0 and 19
    then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    if (v_entry->>'id')::uuid = any(v_milestone_ids) then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_milestone_ids := array_append(v_milestone_ids, (v_entry->>'id')::uuid);
  end loop;
  v_canonical_milestones := (select coalesce(jsonb_agg(m order by m->>'id'), '[]'::jsonb) from jsonb_array_elements(p_milestones) m);

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('create_goal_plan', v_actor, jsonb_build_object(
    'goalId', p_goal_id, 'definition', p_definition, 'milestones', v_canonical_milestones
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'create_goal_plan', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select count(*) into v_active_count from public.goals g
    where g.space_id = p_space_id and g.currency = v_currency
      and (select state from public.goal_revisions where goal_id = g.id order by id desc limit 1) in ('active','paused');
  if v_active_count >= 100 then
    raise exception using errcode='P0001', message='this space already has 100 active or paused goals in this currency';
  end if;
  select count(*) into v_relevant_count from public.goals g where g.space_id = p_space_id and g.currency = v_currency;
  if v_relevant_count >= 200 then
    raise exception using errcode='P0001', message='this space already has 200 goals in this currency';
  end if;

  insert into public.goals (id, space_id, currency, kind, actor_id)
    values (p_goal_id, p_space_id, v_currency, v_kind, v_actor);
  insert into public.goal_revisions (
    goal_id, space_id, currency, expected_revision_id, name_en, name_ar, note, target_minor, deadline,
    contribution_mode, monthly_minor, priority, state, milestone_count, request_id, actor_id
  ) values (
    p_goal_id, p_space_id, v_currency, null, v_name_en, v_name_ar, v_note, v_target_minor, v_deadline,
    v_contribution_mode, v_monthly_minor, v_priority, 'active', jsonb_array_length(p_milestones), p_request_id, v_actor
  ) returning id into v_revision_id;

  for v_entry in select value from jsonb_array_elements(p_milestones) loop
    insert into public.goal_milestones (id, goal_id, space_id, currency)
      values ((v_entry->>'id')::uuid, p_goal_id, p_space_id, v_currency);
    insert into public.goal_revision_milestones (
      revision_id, milestone_id, goal_id, space_id, currency, kind, label_en, label_ar, threshold_minor, due_date, ordinal
    ) values (
      v_revision_id, (v_entry->>'id')::uuid, p_goal_id, p_space_id, v_currency, v_entry->>'kind',
      nullif(v_entry->>'labelEn',''), nullif(v_entry->>'labelAr',''),
      case when v_entry->>'thresholdMinor' is null then null else private.planning_minor(v_entry->>'thresholdMinor', true) end,
      nullif(v_entry->>'dueDate','')::date, (v_entry->>'ordinal')::integer
    );
  end loop;

  v_result := jsonb_build_object('goalId', p_goal_id::text, 'revisionId', v_revision_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'create_goal_plan', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$_$;


ALTER FUNCTION public.create_goal_plan(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_definition jsonb, p_milestones jsonb) OWNER TO postgres;

--
-- Name: create_household_invitation(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_household_invitation(p_space_id uuid, p_request_id uuid, p_invitee_email text) RETURNS TABLE(invitation_id uuid, invitation_token text, expires_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_actor_id uuid := private.household_actor_user_id();
  v_space_kind public.space_kind;
  v_normalized_email text;
  v_request_exists boolean;
  v_duplicate_exists boolean;
  v_now timestamptz := now();
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_request_id is null or p_space_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  perform private.lock_household_request(v_actor_id, p_request_id);
  v_space_kind := private.lock_household_space(p_space_id);
  if v_space_kind is null then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;
  if v_space_kind <> 'household' then
    raise exception using errcode = 'P0001', message = 'personal_space_prohibited';
  end if;
  if not private.is_active_owner(p_space_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  select exists (
    select 1
    from public.household_membership_events as event
    where event.actor_user_id = v_actor_id
      and event.request_id = p_request_id
    limit 1
  )
  into v_request_exists;

  if not v_request_exists then
    v_normalized_email := private.normalize_household_invitee_email(p_invitee_email);
    select exists (
      select 1
      from public.household_invitations as invitation
      where invitation.space_id = p_space_id
        and invitation.status = 'pending'
        and invitation.expires_at > v_now
        and invitation.invitee_identity_digest = private.household_identity_digest(
          invitation.key_version,
          v_normalized_email
        )
      limit 1
    )
    into v_duplicate_exists;

    if v_duplicate_exists then
      raise exception using errcode = 'P0001', message = 'invitation_already_pending';
    end if;
  end if;

  return query
  select result.invitation_id, result.invitation_token, result.expires_at
  from private.household_execute_invitation_creation(
    p_space_id,
    p_request_id,
    p_invitee_email
  ) as result;
end;
$$;


ALTER FUNCTION public.create_household_invitation(p_space_id uuid, p_request_id uuid, p_invitee_email text) OWNER TO postgres;

--
-- Name: create_space(text, public.space_kind); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_space(p_name text, p_kind public.space_kind) RETURNS TABLE(id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_space_id uuid;
begin
  if v_actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'an authenticated user is required';
  end if;

  insert into public.spaces (name, kind)
  values (btrim(p_name), p_kind)
  returning spaces.id into v_space_id;

  insert into public.space_memberships (space_id, user_id, role)
  values (v_space_id, v_actor_id, 'owner');

  return query select v_space_id;
end;
$$;


ALTER FUNCTION public.create_space(p_name text, p_kind public.space_kind) OWNER TO postgres;

--
-- Name: create_subcategory(uuid, uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_subcategory(p_space_id uuid, p_request_id uuid, p_parent_category_id uuid, p_name_en text, p_name_ar text) RETURNS TABLE(id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_name_en text;
  v_name_ar text;
  v_fingerprint bytea;
  v_existing_kind text;
  v_existing_fingerprint bytea;
  v_existing_category_id uuid;
  v_category_id uuid;
  v_parent_kind public.category_kind;
  v_parent_archived_at timestamptz;
  v_parent_parent_id uuid;
  v_constraint_name text;
begin
  if p_space_id is null or p_request_id is null or p_parent_category_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'space, request ID, and parent category are required';
  end if;

  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  perform private.lock_category_request(p_space_id, p_request_id);

  v_name_en := private.canonical_category_name(p_name_en);
  v_name_ar := private.canonical_category_name(p_name_ar);

  if (v_name_en is null and v_name_ar is null)
    or (v_name_en is not null and pg_catalog.char_length(v_name_en) > 120)
    or (v_name_ar is not null and pg_catalog.char_length(v_name_ar) > 120)
    or (v_name_en is not null and pg_catalog.btrim(private.english_category_key(v_name_en)) = '')
    or (v_name_ar is not null and pg_catalog.btrim(private.arabic_category_key(v_name_ar)) = '') then
    raise exception using
      errcode = 'P0001',
      message = 'at least one bounded searchable category name is required';
  end if;

  v_fingerprint := extensions.digest(
    pg_catalog.jsonb_build_object(
      'version', 1,
      'command', 'create_subcategory',
      'parentCategoryId', p_parent_category_id,
      'nameEn', v_name_en,
      'nameAr', v_name_ar
    )::text,
    'sha256'
  );

  select request.command_kind, request.request_fingerprint, request.category_id, category.id
  into v_existing_kind, v_existing_fingerprint, v_existing_category_id, v_category_id
  from public.category_command_requests as request
  left join public.categories as category
    on category.id = request.category_id
   and category.space_id = request.space_id
  where request.space_id = p_space_id
    and request.request_id = p_request_id
  limit 1;

  if found then
    if v_existing_kind is distinct from 'create_subcategory'
      or v_existing_fingerprint is distinct from v_fingerprint
      or v_existing_category_id is distinct from v_category_id then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_category_id;
    return;
  end if;

  select category.kind, category.archived_at, category.parent_category_id
  into v_parent_kind, v_parent_archived_at, v_parent_parent_id
  from public.categories as category
  where category.id = p_parent_category_id
    and category.space_id = p_space_id
  limit 1
  for update;

  if not found or v_parent_archived_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'the parent category must be an active root in the requested space and kind';
  end if;

  if v_parent_parent_id is not null then
    raise exception using
      errcode = 'P0001',
      message = 'subcategory depth is limited to one level';
  end if;

  begin
    insert into public.categories (
      space_id, kind, name_en, name_ar, parent_category_id, created_by
    )
    values (p_space_id, v_parent_kind, v_name_en, v_name_ar, p_parent_category_id, v_actor_id)
    returning categories.id into v_category_id;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name in ('categories_active_name_en_idx', 'categories_active_name_ar_idx') then
        raise exception using
          errcode = 'P0001',
          message = 'an active category already uses one of the supplied normalized names';
      end if;
      raise;
  end;

  insert into public.category_command_requests (
    space_id, request_id, command_kind, request_fingerprint, category_id, actor_id
  )
  values (
    p_space_id, p_request_id, 'create_subcategory', v_fingerprint, v_category_id, v_actor_id
  );

  return query select v_category_id;
end;
$$;


ALTER FUNCTION public.create_subcategory(p_space_id uuid, p_request_id uuid, p_parent_category_id uuid, p_name_en text, p_name_ar text) OWNER TO postgres;

--
-- Name: create_wallet(uuid, text, public.currency_code); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_wallet(p_space_id uuid, p_name text, p_currency public.currency_code) RETURNS TABLE(id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_wallet_id uuid;
begin
  if not private.is_active_member(p_space_id) then
    raise exception using
      errcode = '42501',
      message = 'an active space membership is required';
  end if;

  insert into public.wallets (space_id, name, currency)
  values (p_space_id, btrim(p_name), p_currency)
  returning wallets.id into v_wallet_id;

  return query select v_wallet_id;
end;
$$;


ALTER FUNCTION public.create_wallet(p_space_id uuid, p_name text, p_currency public.currency_code) OWNER TO postgres;

--
-- Name: describe_financial_event(uuid, uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.describe_financial_event(p_space_id uuid, p_request_id uuid, p_event_id uuid, p_payee_name text, p_note text) RETURNS TABLE(id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_payee_name text := private.canonical_payee_name(p_payee_name);
  v_note text := nullif(pg_catalog.btrim(pg_catalog.normalize(p_note, 'NFKC')), '');
  v_fingerprint bytea;
  v_existing_fingerprint bytea;
  v_existing_event_id uuid;
  v_payee_id uuid;
begin
  if v_actor_id is null or p_request_id is null or p_event_id is null
    or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  if (v_payee_name is not null and pg_catalog.char_length(v_payee_name) > 120)
    or (v_payee_name is not null and pg_catalog.btrim(private.payee_name_key(v_payee_name)) = '')
    or (v_note is not null and pg_catalog.char_length(v_note) > 2000)
    or (v_payee_name is null and v_note is null) then
    raise exception using errcode = 'P0001', message = 'a bounded payee or note is required';
  end if;

  v_fingerprint := extensions.digest(
    pg_catalog.jsonb_build_object(
      'version', 1,
      'command', 'describe_financial_event',
      'eventId', p_event_id,
      'payeeName', v_payee_name,
      'note', v_note
    )::text,
    'sha256'
  );
  perform private.lock_financial_request(p_space_id, p_request_id);

  select request.request_fingerprint, request.event_id
  into v_existing_fingerprint, v_existing_event_id
  from public.financial_event_description_requests as request
  where request.space_id = p_space_id and request.request_id = p_request_id;

  if found then
    if v_existing_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;
    return query select v_existing_event_id;
    return;
  end if;

  if not exists (select 1 from public.financial_events as event where event.id = p_event_id and event.space_id = p_space_id) then
    raise exception using errcode = 'P0001', message = 'the event is not available in the requested space';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_space_id::text || ':description:' || p_event_id::text, 0));
  if exists (select 1 from public.financial_event_descriptions as description where description.event_id = p_event_id) then
    raise exception using errcode = 'P0001', message = 'the event already has immutable descriptive metadata';
  end if;

  if v_payee_name is not null then
    insert into public.payees (space_id, name, created_by)
    values (p_space_id, v_payee_name, v_actor_id)
    on conflict (space_id, name_key) do nothing;

    select payee.id into v_payee_id
    from public.payees as payee
    where payee.space_id = p_space_id and payee.name_key = private.payee_name_key(v_payee_name);
  end if;

  insert into public.financial_event_descriptions (event_id, space_id, payee_id, note, created_by)
  values (p_event_id, p_space_id, v_payee_id, v_note, v_actor_id);

  insert into public.financial_event_description_requests (space_id, request_id, request_fingerprint, event_id, actor_id)
  values (p_space_id, p_request_id, v_fingerprint, p_event_id, v_actor_id);

  return query select p_event_id;
end;
$$;


ALTER FUNCTION public.describe_financial_event(p_space_id uuid, p_request_id uuid, p_event_id uuid, p_payee_name text, p_note text) OWNER TO postgres;

--
-- Name: find_planning_command(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.find_planning_command(p_space_id uuid, p_request_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    SET statement_timeout TO '10s'
    AS $$
declare v_actor uuid:=auth.uid(); v_result jsonb;
begin
  if v_actor is null or p_space_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501',message='planning_not_authorized';
  end if;
  if p_request_id is null then
    raise exception using errcode='22023',message='planning_invalid_input';
  end if;
  select jsonb_build_object('command',command,'sequenceId',sequence_id::text,'result',result)
  into v_result from public.planning_command_receipts
  where space_id=p_space_id and request_id=p_request_id and actor_id=v_actor;
  return v_result;
end; $$;


ALTER FUNCTION public.find_planning_command(p_space_id uuid, p_request_id uuid) OWNER TO postgres;

--
-- Name: get_category_command_result(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_category_command_result(p_space_id uuid, p_request_id uuid) RETURNS TABLE(command_kind text, category_id uuid, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  if auth.uid() is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  return query
  select request.command_kind, request.category_id, request.created_at
  from public.category_command_requests as request
  where request.space_id = p_space_id
    and request.request_id = p_request_id
  limit 1;
end;
$$;


ALTER FUNCTION public.get_category_command_result(p_space_id uuid, p_request_id uuid) OWNER TO postgres;

--
-- Name: get_wallet_command_result(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_wallet_command_result(p_space_id uuid, p_request_id uuid) RETURNS TABLE(command_kind text, wallet_id uuid, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  if auth.uid() is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  return query
  select request.command_kind, request.wallet_id, request.created_at
  from public.wallet_command_requests as request
  where request.space_id = p_space_id
    and request.request_id = p_request_id
  limit 1;
end;
$$;


ALTER FUNCTION public.get_wallet_command_result(p_space_id uuid, p_request_id uuid) OWNER TO postgres;

--
-- Name: goal_detail(uuid, uuid, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.goal_detail(p_space_id uuid, p_goal_id uuid, p_month date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
declare
  v_as_of date := (now() at time zone 'UTC')::date;
  v_goal public.goals%rowtype;
  v_row record;
  v_extras record;
  v_milestones jsonb;
  v_summary jsonb;
begin
  if p_space_id is null or p_goal_id is null or p_month is null
    or p_month <> date_trunc('month', p_month)::date or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;

  select * into v_goal from public.goals where id = p_goal_id and space_id = p_space_id;
  if not found then
    raise exception using errcode='P0001', message='the goal does not belong to the requested space';
  end if;

  select * into v_row from private.goal_coverage_set(p_space_id, v_goal.currency, v_as_of) coverage
    where coverage.goal_id = p_goal_id;
  if not found then
    raise exception using errcode='P0001', message='the goal is not currently relevant';
  end if;

  select * into v_extras from private.goal_monthly_extras(
    v_row.goal_id, v_row.kind, v_row.target_minor, v_row.deadline, v_row.covered_minor, v_row.fulfilled_minor, p_month
  );

  v_milestones := (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', grm.milestone_id::text, 'kind', grm.kind, 'labelEn', grm.label_en, 'labelAr', grm.label_ar,
      'thresholdMinor', grm.threshold_minor::text, 'dueDate', grm.due_date, 'ordinal', grm.ordinal,
      'currentState', case
        when grm.kind = 'amount' then
          case when (v_row.covered_minor + case when v_row.kind = 'purchase' then v_row.fulfilled_minor else 0 end) >= grm.threshold_minor
            then 'complete' else 'incomplete' end
        else case when (
          select event.action from public.goal_milestone_events event
          where event.milestone_id = grm.milestone_id order by event.id desc limit 1
        ) = 'complete' then 'complete' else 'incomplete' end
      end
    ) order by grm.ordinal), '[]'::jsonb)
    from public.goal_revision_milestones grm where grm.revision_id = v_row.revision_id
  );

  v_summary := jsonb_build_object(
    'id', v_row.goal_id::text, 'revisionId', v_row.revision_id::text, 'currency', v_goal.currency,
    'kind', v_row.kind, 'state', v_row.state, 'nameEn', v_row.name_en, 'nameAr', v_row.name_ar,
    'targetMinor', v_row.target_minor::text, 'earmarkedMinor', v_row.earmarked_minor::text,
    'coveredMinor', v_row.covered_minor::text, 'fulfilledMinor', v_row.fulfilled_minor::text,
    'shortageMinor', (v_row.earmarked_minor - v_row.covered_minor)::text,
    'monthlyTargetMinor', v_extras.monthly_target_minor::text,
    'monthlyNetContributionMinor', v_extras.monthly_net_contribution_minor::text,
    'dueDate', v_row.deadline,
    'horizon', case when v_row.deadline is null then 'open'
      when v_row.deadline <= (v_row.created_at::date + interval '12 months')::date then 'short' else 'long' end,
    'needsReview', v_row.state = 'closed' and v_row.earmarked_minor <> 0,
    'suggestedMonthlyMinor', v_extras.suggested_monthly_minor::text,
    'forecastMonth', v_extras.forecast_month, 'forecastState', v_extras.forecast_state, 'asOf', v_as_of
  );

  return jsonb_build_object(
    'summary', v_summary, 'milestones', v_milestones,
    'earmarkHead', v_row.head, 'definitionHead', v_row.revision_id::text, 'asOf', v_as_of
  );
end;
$$;


ALTER FUNCTION public.goal_detail(p_space_id uuid, p_goal_id uuid, p_month date) OWNER TO postgres;

--
-- Name: goal_history_page(uuid, uuid, timestamp with time zone, text, text, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.goal_history_page(p_space_id uuid, p_goal_id uuid, p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_source_kind text DEFAULT NULL::text, p_before_source_id text DEFAULT NULL::text, p_limit integer DEFAULT 25) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
declare
  v_goal public.goals%rowtype;
  v_cursor_fields integer;
  v_rows jsonb;
  v_has_more boolean;
  v_next_created_at timestamptz;
  v_next_source_kind text;
  v_next_source_id text;
begin
  if p_space_id is null or p_goal_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  v_cursor_fields := (case when p_before_created_at is null then 0 else 1 end)
    + (case when p_before_source_kind is null then 0 else 1 end)
    + (case when p_before_source_id is null then 0 else 1 end);
  if v_cursor_fields not in (0, 3) then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  select * into v_goal from public.goals where id = p_goal_id and space_id = p_space_id;
  if not found then
    raise exception using errcode='P0001', message='the goal does not belong to the requested space';
  end if;

  with events as (
    select gr.created_at, 'definition'::text as source_kind, gr.id::text as source_id,
      jsonb_build_object(
        'revisionId', gr.id::text, 'nameEn', gr.name_en, 'nameAr', gr.name_ar,
        'targetMinor', gr.target_minor::text, 'deadline', gr.deadline,
        'contributionMode', gr.contribution_mode, 'monthlyMinor', gr.monthly_minor::text,
        'priority', gr.priority, 'state', gr.state,
        'milestones', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', grm.milestone_id::text, 'kind', grm.kind, 'labelEn', grm.label_en, 'labelAr', grm.label_ar,
            'thresholdMinor', grm.threshold_minor::text, 'dueDate', grm.due_date, 'ordinal', grm.ordinal
          ) order by grm.ordinal), '[]'::jsonb)
          from public.goal_revision_milestones grm where grm.revision_id = gr.id limit 20
        )
      ) as detail
    from public.goal_revisions gr where gr.goal_id = p_goal_id
    union all
    select ge.created_at, 'earmark', ge.id::text,
      jsonb_build_object(
        'operation', ge.operation, 'amountMinor', el.amount_minor::text, 'reversalOf', ge.reversal_of::text
      )
    from public.goal_earmark_events ge
    join public.goal_earmark_lines el on el.event_id = ge.id and el.goal_id = p_goal_id
    union all
    select gpl.created_at, 'purchase_link', gpl.id::text,
      jsonb_build_object('expenseEventId', gpl.expense_event_id::text, 'amountMinor', gpl.amount_minor::text)
    from public.goal_purchase_links gpl where gpl.goal_id = p_goal_id
    union all
    select gme.created_at, 'checklist', gme.id::text,
      jsonb_build_object('milestoneId', gme.milestone_id::text, 'action', gme.action)
    from public.goal_milestone_events gme where gme.goal_id = p_goal_id
    union all
    select gmtr.created_at, 'monthly_target', gmtr.id::text,
      jsonb_build_object('monthStart', gmtr.month_start, 'amountMinor', gmtr.amount_minor::text)
    from public.goal_monthly_target_revisions gmtr where gmtr.goal_id = p_goal_id
    union all
    select rev.created_at, 'financial_reversal', rev.id::text,
      jsonb_build_object('originalExpenseEventId', rev.reversal_of::text, 'effectiveDate', rev.effective_date)
    from public.financial_events rev
    where rev.reversal_of in (select gpl.expense_event_id from public.goal_purchase_links gpl where gpl.goal_id = p_goal_id)
  ), page as (
    select * from events
    where p_before_created_at is null
      or (created_at, source_kind, source_id) < (p_before_created_at, p_before_source_kind, p_before_source_id)
    order by created_at desc, source_kind desc, source_id desc
    limit p_limit + 1
  ), numbered as (
    select page.*, row_number() over (order by created_at desc, source_kind desc, source_id desc) as rn from page
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
      'createdAt', numbered.created_at, 'sourceKind', numbered.source_kind, 'sourceId', numbered.source_id,
      'detail', numbered.detail
    ) order by numbered.created_at desc, numbered.source_kind desc, numbered.source_id desc), '[]'::jsonb)
     from numbered where rn <= p_limit),
    exists(select 1 from numbered where rn > p_limit),
    (select created_at from numbered where rn = p_limit),
    (select source_kind from numbered where rn = p_limit),
    (select source_id from numbered where rn = p_limit)
  into v_rows, v_has_more, v_next_created_at, v_next_source_kind, v_next_source_id;

  return jsonb_build_object(
    'rows', v_rows, 'hasMore', coalesce(v_has_more, false),
    'nextCursor', case when v_has_more then
      jsonb_build_object('createdAt', v_next_created_at, 'sourceKind', v_next_source_kind, 'sourceId', v_next_source_id)
      else null end
  );
end;
$$;


ALTER FUNCTION public.goal_history_page(p_space_id uuid, p_goal_id uuid, p_before_created_at timestamp with time zone, p_before_source_kind text, p_before_source_id text, p_limit integer) OWNER TO postgres;

--
-- Name: goal_page(uuid, public.currency_code, text, timestamp with time zone, uuid, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.goal_page(p_space_id uuid, p_currency public.currency_code, p_state_filter text, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 25) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
declare
  v_as_of date := (now() at time zone 'UTC')::date;
  v_this_month date := date_trunc('month', v_as_of)::date;
  v_rows jsonb;
  v_has_more boolean;
  v_next_created_at timestamptz;
  v_next_id uuid;
begin
  if p_space_id is null or p_currency is null or p_state_filter is null
    or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  if p_state_filter not in ('active','paused','closed','all','needs_review') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if (p_after_created_at is null) is distinct from (p_after_id is null) then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  with coverage as (
    select * from private.goal_coverage_set(p_space_id, p_currency, v_as_of)
  ), filtered as (
    select * from coverage
    where (p_state_filter = 'all')
      or (p_state_filter = 'needs_review' and state = 'closed')
      or (p_state_filter <> 'all' and p_state_filter <> 'needs_review' and state = p_state_filter)
  ), page as (
    select * from filtered
    where p_after_created_at is null
      or (created_at, goal_id) > (p_after_created_at, p_after_id)
    order by created_at, goal_id
    limit p_limit + 1
  ), numbered as (
    select page.*, row_number() over (order by created_at, goal_id) as rn from page
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
      'id', numbered.goal_id::text, 'revisionId', numbered.revision_id::text, 'currency', p_currency,
      'kind', numbered.kind, 'state', numbered.state, 'nameEn', numbered.name_en, 'nameAr', numbered.name_ar,
      'targetMinor', numbered.target_minor::text, 'earmarkedMinor', numbered.earmarked_minor::text,
      'coveredMinor', numbered.covered_minor::text, 'fulfilledMinor', numbered.fulfilled_minor::text,
      'shortageMinor', (numbered.earmarked_minor - numbered.covered_minor)::text,
      'monthlyTargetMinor', extras.monthly_target_minor::text,
      'monthlyNetContributionMinor', extras.monthly_net_contribution_minor::text,
      'dueDate', numbered.deadline,
      'horizon', case when numbered.deadline is null then 'open'
        when numbered.deadline <= (numbered.created_at::date + interval '12 months')::date then 'short' else 'long' end,
      'needsReview', numbered.state = 'closed' and numbered.earmarked_minor <> 0,
      'suggestedMonthlyMinor', extras.suggested_monthly_minor::text,
      'forecastMonth', extras.forecast_month, 'forecastState', extras.forecast_state, 'asOf', v_as_of
    ) order by numbered.created_at, numbered.goal_id), '[]'::jsonb)
     from numbered
     cross join lateral private.goal_monthly_extras(
       numbered.goal_id, numbered.kind, numbered.target_minor, numbered.deadline,
       numbered.covered_minor, numbered.fulfilled_minor, v_this_month
     ) extras
     where numbered.rn <= p_limit),
    exists(select 1 from numbered where rn > p_limit),
    (select created_at from numbered where rn = p_limit),
    (select goal_id from numbered where rn = p_limit)
  into v_rows, v_has_more, v_next_created_at, v_next_id;

  return jsonb_build_object(
    'rows', v_rows, 'hasMore', coalesce(v_has_more, false),
    'nextCursor', case when v_has_more then jsonb_build_object('createdAt', v_next_created_at, 'id', v_next_id::text) else null end,
    'asOf', v_as_of
  );
end;
$$;


ALTER FUNCTION public.goal_page(p_space_id uuid, p_currency public.currency_code, p_state_filter text, p_after_created_at timestamp with time zone, p_after_id uuid, p_limit integer) OWNER TO postgres;

--
-- Name: journal_search_page(uuid, date, date, uuid, uuid, uuid, bigint, bigint, text, text, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.journal_search_page(p_space_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_wallet_id uuid DEFAULT NULL::uuid, p_root_category_id uuid DEFAULT NULL::uuid, p_payee_id uuid DEFAULT NULL::uuid, p_min_amount_minor bigint DEFAULT NULL::bigint, p_max_amount_minor bigint DEFAULT NULL::bigint, p_query text DEFAULT NULL::text, p_cursor text DEFAULT NULL::text, p_limit integer DEFAULT 50) RETURNS TABLE(id uuid, space_id uuid, request_id uuid, kind public.financial_event_kind, effective_date date, actor_id uuid, reversal_of uuid, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_parts text[];
  v_cursor_date date;
  v_cursor_created timestamptz;
  v_cursor_id uuid;
  v_query text;
  v_limit integer;
begin
  v_limit := coalesce(p_limit, 50);
  if v_limit not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  if p_from is not null and p_to is not null
    and (p_from > p_to or p_to - p_from > 366) then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  v_query := nullif(pg_catalog.btrim(p_query), '');
  if v_query is not null and pg_catalog.char_length(v_query) > 120 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if v_query is not null then
    v_query := lower(v_query);
  end if;

  if p_cursor is not null then
    v_parts := pg_catalog.string_to_array(p_cursor, '|');
    if v_parts is null or pg_catalog.array_length(v_parts, 1) <> 3 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    begin
      v_cursor_date := v_parts[1]::date;
      v_cursor_created := v_parts[2]::timestamptz;
      v_cursor_id := v_parts[3]::uuid;
    exception when others then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end;
  end if;

  return query
  select event.id, event.space_id, event.request_id, event.kind,
         event.effective_date, event.actor_id, event.reversal_of, event.created_at
  from public.financial_events as event
  where event.space_id = p_space_id
    and (p_from is null or event.effective_date >= p_from)
    and (p_to is null or event.effective_date <= p_to)
    and (v_cursor_date is null
      or (event.effective_date, date_trunc('milliseconds', event.created_at), event.id)
         < (v_cursor_date, date_trunc('milliseconds', v_cursor_created), v_cursor_id))
    and (p_wallet_id is null or exists (
      select 1 from public.wallet_movements as movement
      where movement.event_id = event.id
        and movement.space_id = event.space_id
        and movement.wallet_id = p_wallet_id))
    and (p_payee_id is null or exists (
      select 1 from public.financial_event_descriptions as description
      where description.event_id = event.id
        and description.space_id = event.space_id
        and description.payee_id = p_payee_id))
    and (p_min_amount_minor is null or exists (
      select 1 from public.wallet_movements as movement
      where movement.event_id = event.id
        and movement.space_id = event.space_id
        and movement.amount_minor >= p_min_amount_minor))
    and (p_max_amount_minor is null or exists (
      select 1 from public.wallet_movements as movement
      where movement.event_id = event.id
        and movement.space_id = event.space_id
        and movement.amount_minor <= p_max_amount_minor))
    and (p_root_category_id is null or exists (
      select 1
      from public.financial_event_categories as association
      join public.categories as category
        on category.id = association.category_id
       and category.space_id = association.space_id
      left join public.categories as parent
        on parent.id = category.parent_category_id
       and parent.space_id = category.space_id
      where association.event_id = event.id
        and association.space_id = event.space_id
        and coalesce(parent.id, category.id) = p_root_category_id))
    and (v_query is null
      or exists (
        select 1
        from public.financial_event_descriptions as description
        left join public.payees as payee
          on payee.id = description.payee_id
         and payee.space_id = description.space_id
        where description.event_id = event.id
          and description.space_id = event.space_id
          and (
            position(v_query in lower(coalesce(description.note, ''))) > 0
            or position(v_query in lower(coalesce(payee.name, ''))) > 0
          ))
      or exists (
        select 1
        from public.wallet_movements as movement
        join public.wallets as wallet
          on wallet.id = movement.wallet_id
         and wallet.space_id = movement.space_id
        where movement.event_id = event.id
          and movement.space_id = event.space_id
          and position(v_query in lower(wallet.name)) > 0
      )
      or exists (
        select 1
        from public.financial_event_categories as association
        join public.categories as category
          on category.id = association.category_id
         and category.space_id = association.space_id
        left join public.categories as parent
          on parent.id = category.parent_category_id
         and parent.space_id = category.space_id
        where association.event_id = event.id
          and association.space_id = event.space_id
          and (
            position(v_query in lower(coalesce(category.name_en, ''))) > 0
            or position(v_query in lower(coalesce(category.name_ar, ''))) > 0
            or position(v_query in lower(coalesce(parent.name_en, ''))) > 0
            or position(v_query in lower(coalesce(parent.name_ar, ''))) > 0
          )
      ))
  order by event.effective_date desc, date_trunc('milliseconds', event.created_at) desc, event.id desc
  limit v_limit;
end;
$$;


ALTER FUNCTION public.journal_search_page(p_space_id uuid, p_from date, p_to date, p_wallet_id uuid, p_root_category_id uuid, p_payee_id uuid, p_min_amount_minor bigint, p_max_amount_minor bigint, p_query text, p_cursor text, p_limit integer) OWNER TO postgres;

--
-- Name: leave_household_space(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.leave_household_space(p_space_id uuid, p_request_id uuid) RETURNS TABLE(user_id uuid, status public.membership_status)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_actor_id uuid := private.household_actor_user_id();
  v_fingerprint bytea;
  v_event public.household_membership_events%rowtype;
  v_membership public.space_memberships%rowtype;
  v_space_kind public.space_kind;
  v_now timestamptz := now();
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_space_id is null or p_request_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  v_fingerprint := private.household_command_fingerprint(
    'leave_household_space|' || p_space_id::text
  );
  perform private.lock_household_request(v_actor_id, p_request_id);
  select event.* into v_event
  from public.household_membership_events as event
  where event.actor_user_id = v_actor_id and event.request_id = p_request_id;
  if found then
    if v_event.kind <> 'member_left'
      or v_event.request_fingerprint <> v_fingerprint
      or v_event.subject_user_id <> v_actor_id then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;
    return query select v_actor_id, v_event.next_status;
    return;
  end if;
  v_space_kind := private.lock_household_space(p_space_id);
  if v_space_kind is null then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;
  if v_space_kind <> 'household' then
    raise exception using errcode = 'P0001', message = 'personal_space_prohibited';
  end if;
  select membership.* into v_membership
  from public.space_memberships as membership
  where membership.space_id = p_space_id and membership.user_id = v_actor_id
  for update;
  if not found or v_membership.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'membership_not_active';
  end if;
  if v_membership.role = 'owner'
    and (select count(*) from public.space_memberships as owner_membership
         where owner_membership.space_id = p_space_id
           and owner_membership.status = 'active'
           and owner_membership.role = 'owner') <= 1 then
    raise exception using errcode = 'P0001', message = 'last_owner';
  end if;
  update public.space_memberships
  set status = 'left', ended_at = v_now, ended_by_user_id = v_actor_id
  where space_id = p_space_id and space_memberships.user_id = v_actor_id;
  insert into public.household_membership_events (
    space_id, actor_user_id, subject_user_id, request_id, request_fingerprint,
    kind, prior_status, next_status, prior_role, next_role, occurred_at
  ) values (
    p_space_id, v_actor_id, v_actor_id, p_request_id, v_fingerprint,
    'member_left', 'active', 'left', v_membership.role, v_membership.role, v_now
  );
  return query select v_actor_id, 'left'::public.membership_status;
end;
$$;


ALTER FUNCTION public.leave_household_space(p_space_id uuid, p_request_id uuid) OWNER TO postgres;

--
-- Name: link_goal_purchase(uuid, uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.link_goal_purchase(p_space_id uuid, p_request_id uuid, p_expense_event_id uuid, p_lines jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_expense public.financial_events%rowtype;
  v_currency_count integer;
  v_currency public.currency_code;
  v_expense_total numeric;
  v_existing_links numeric;
  v_entry jsonb;
  v_goal_ids uuid[] := '{}';
  v_new_total numeric := 0;
  v_goal_id uuid;
  v_goal public.goals%rowtype;
  v_head text;
  v_would_go_negative boolean;
  v_link_ids uuid[] := '{}';
  v_link_id uuid;
  v_canonical_lines jsonb;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_expense_event_id is null or p_lines is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 20 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  for v_entry in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or (v_entry ?& array['goalId','amountMinor','expectedHead']) is not true
      or (v_entry - array['goalId','amountMinor','expectedHead']) <> '{}'::jsonb
      or jsonb_typeof(v_entry->'goalId') is distinct from 'string'
      or (v_entry->>'goalId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_entry->'amountMinor') is distinct from 'string'
      or jsonb_typeof(v_entry->'expectedHead') is distinct from 'string'
      or (v_entry->>'expectedHead') !~ '^[0-9a-f]{64}$'
    then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    if (v_entry->>'goalId')::uuid = any(v_goal_ids) then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_goal_ids := array_append(v_goal_ids, (v_entry->>'goalId')::uuid);
    v_new_total := v_new_total + private.planning_minor(v_entry->>'amountMinor', true);
  end loop;
  v_canonical_lines := (select coalesce(jsonb_agg(l order by l->>'goalId'), '[]'::jsonb) from jsonb_array_elements(p_lines) l);

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('link_goal_purchase', v_actor, jsonb_build_object(
    'expenseEventId', p_expense_event_id, 'lines', v_canonical_lines
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'link_goal_purchase', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select * into v_expense from public.financial_events where id = p_expense_event_id and space_id = p_space_id for update;
  if not found or v_expense.kind <> 'expense' then
    raise exception using errcode='P0001', message='the referenced event must be an unreversed expense in this space';
  end if;
  if exists(select 1 from public.financial_events where reversal_of = p_expense_event_id) then
    raise exception using errcode='P0001', message='the referenced event must be an unreversed expense in this space';
  end if;
  if v_expense.effective_date > (now() at time zone 'UTC')::date then
    raise exception using errcode='P0001', message='a purchase cannot be linked before its effective date has occurred';
  end if;
  if exists(select 1 from public.loan_postings where event_id = p_expense_event_id) then
    raise exception using errcode='P0001', message='a loan-linked event cannot be linked to a goal';
  end if;

  select count(distinct w.currency) into v_currency_count
  from public.wallet_movements m join public.wallets w on w.id = m.wallet_id and w.space_id = m.space_id
  where m.event_id = p_expense_event_id;
  if v_currency_count <> 1 then
    raise exception using errcode='P0001', message='the referenced expense must be single-currency';
  end if;
  select w.currency into v_currency
  from public.wallet_movements m join public.wallets w on w.id = m.wallet_id and w.space_id = m.space_id
  where m.event_id = p_expense_event_id limit 1;
  select coalesce(-sum(amount_minor), 0) into v_expense_total from public.wallet_movements where event_id = p_expense_event_id;

  select coalesce(sum(amount_minor), 0) into v_existing_links from public.goal_purchase_links where expense_event_id = p_expense_event_id;
  if v_existing_links + v_new_total > v_expense_total then
    raise exception using errcode='P0001', message='total linked amounts cannot exceed the expense''s own total';
  end if;

  foreach v_goal_id in array (select array_agg(x order by x) from unnest(v_goal_ids) x) loop
    perform 1 from public.goals where id = v_goal_id and space_id = p_space_id for update;
    if not found then
      raise exception using errcode='P0001', message='every linked goal must belong to the requested space';
    end if;
  end loop;

  for v_entry in select value from jsonb_array_elements(p_lines) loop
    v_goal_id := (v_entry->>'goalId')::uuid;
    select * into v_goal from public.goals where id = v_goal_id and space_id = p_space_id;
    if v_goal.currency is distinct from v_currency then
      raise exception using errcode='P0001', message='a linked goal must share the expense''s currency';
    end if;

    select head into v_head from private.goal_financing_state(v_goal_id, (now() at time zone 'UTC')::date);
    if v_head is distinct from (v_entry->>'expectedHead') then
      raise exception using errcode='40001', message='planning_stale_revision';
    end if;

    -- The link reduces the goal's earmark as of the EXPENSE's own date, not
    -- today; verify the running balance never goes negative at any
    -- checkpoint from that date through today, not just today's snapshot.
    select bool_or(running_sum < 0) into v_would_go_negative
    from (
      select sum(delta) over (order by event_date, sort_key rows between unbounded preceding and current row) as running_sum, event_date
      from (
        select ge.effective_date as event_date, el.event_id::text as sort_key, el.amount_minor as delta
        from public.goal_earmark_lines el join public.goal_earmark_events ge on ge.id = el.event_id
        where el.goal_id = v_goal_id
        union all
        select fe.effective_date, 'link:' || gpl.id::text, -gpl.amount_minor
        from public.goal_purchase_links gpl join public.financial_events fe on fe.id = gpl.expense_event_id
        where gpl.goal_id = v_goal_id
        union all
        select rev.effective_date, 'linkrev:' || gpl.id::text, gpl.amount_minor
        from public.goal_purchase_links gpl
        join public.financial_events orig on orig.id = gpl.expense_event_id
        join public.financial_events rev on rev.reversal_of = orig.id
        where gpl.goal_id = v_goal_id
        union all
        select v_expense.effective_date, 'newlink', -private.planning_minor(v_entry->>'amountMinor', true)
      ) events
    ) timeline
    where event_date >= v_expense.effective_date and event_date <= (now() at time zone 'UTC')::date;
    if v_would_go_negative then
      raise exception using errcode='P0001', message='linking this purchase would make an earlier or current goal balance negative';
    end if;

    v_link_id := extensions.gen_random_uuid();
    insert into public.goal_purchase_links (id, goal_id, space_id, currency, expense_event_id, amount_minor, request_id, actor_id)
      values (v_link_id, v_goal_id, p_space_id, v_currency, p_expense_event_id, private.planning_minor(v_entry->>'amountMinor', true), p_request_id, v_actor);
    v_link_ids := array_append(v_link_ids, v_link_id);
  end loop;

  v_result := jsonb_build_object('linkIds', to_jsonb(array(select id::text from unnest(v_link_ids) as id)));
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'link_goal_purchase', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$_$;


ALTER FUNCTION public.link_goal_purchase(p_space_id uuid, p_request_id uuid, p_expense_event_id uuid, p_lines jsonb) OWNER TO postgres;

--
-- Name: link_scheduled_payment(uuid, uuid, uuid, uuid, text, bigint); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.link_scheduled_payment(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_event_id uuid, p_amount_minor text, p_expected_event_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_occurrence public.scheduled_occurrences%rowtype;
  v_schedule_kind text;
  v_current_event_id bigint;
  v_settled numeric; v_skipped boolean;
  v_today date := (now() at time zone 'UTC')::date;
  v_amount_minor bigint;
  v_event public.financial_events%rowtype;
  v_currency_count integer;
  v_event_currency public.currency_code;
  v_eligible numeric;
  v_loan_id uuid;
  v_principal_delta bigint;
  v_existing_allocations numeric;
  v_new_total numeric;
  v_occurrence_event_id bigint;
  v_goal public.goals%rowtype;
  v_goal_state text;
  v_earmarked numeric; v_fulfilled numeric; v_head text;
  v_existing_goal_links numeric;
  v_remaining_fundable numeric;
  v_goal_alloc numeric;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_occurrence_id is null or p_event_id is null
    or p_amount_minor is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_amount_minor := private.planning_minor(p_amount_minor, true);

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('link_scheduled_payment', v_actor, jsonb_build_object(
    'occurrenceId', p_occurrence_id, 'eventId', p_event_id, 'amountMinor', v_amount_minor::text,
    'expectedEventId', p_expected_event_id
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'link_scheduled_payment', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select * into v_occurrence from public.scheduled_occurrences where id = p_occurrence_id and space_id = p_space_id for update;
  if not found then
    raise exception using errcode='P0001', message='the occurrence does not belong to the requested space';
  end if;
  select kind into v_schedule_kind from public.schedules where id = v_occurrence.schedule_id;

  select max(id) into v_current_event_id from public.occurrence_events where occurrence_id = p_occurrence_id;
  if v_current_event_id is distinct from p_expected_event_id then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  select settled_minor, skipped into v_settled, v_skipped
    from private.schedule_occurrence_settlement(p_occurrence_id, v_today);
  if v_skipped then
    raise exception using errcode='P0001', message='a skipped occurrence cannot receive a payment link';
  end if;

  select * into v_event from public.financial_events where id = p_event_id and space_id = p_space_id for update;
  if not found or v_event.kind = 'reversal' then
    raise exception using errcode='P0001', message='the referenced event cannot be linked';
  end if;
  if exists(select 1 from public.financial_events where reversal_of = p_event_id) then
    raise exception using errcode='P0001', message='the referenced event already has a reversal';
  end if;
  if v_event.effective_date > v_today then
    raise exception using errcode='P0001', message='a payment cannot be linked before its effective date has occurred';
  end if;

  select count(distinct w.currency) into v_currency_count
  from public.wallet_movements m join public.wallets w on w.id = m.wallet_id and w.space_id = m.space_id
  where m.event_id = p_event_id;
  select w.currency into v_event_currency
  from public.wallet_movements m join public.wallets w on w.id = m.wallet_id and w.space_id = m.space_id
  where m.event_id = p_event_id limit 1;
  if v_currency_count <> 1 or v_event_currency is distinct from v_occurrence.currency then
    raise exception using errcode='P0001', message='the referenced event must be single-currency and share the occurrence currency';
  end if;

  if v_schedule_kind = 'debt_payment' then
    select posting.loan_id, posting.principal_delta_minor into v_loan_id, v_principal_delta
      from public.loan_postings posting where posting.event_id = p_event_id;
    if v_loan_id is distinct from v_occurrence.loan_id or v_event.kind not in ('loan_receive_repayment','loan_repay_borrowing') then
      raise exception using errcode='P0001', message='the referenced event must be a repayment on the occurrence''s own loan';
    end if;
    v_eligible := abs(v_principal_delta);
  elsif v_schedule_kind = 'expense' then
    if v_event.kind <> 'expense' then
      raise exception using errcode='P0001', message='the referenced event must be an expense';
    end if;
    select coalesce(-sum(amount_minor), 0) into v_eligible from public.wallet_movements where event_id = p_event_id;
  else
    if v_event.kind <> 'income' then
      raise exception using errcode='P0001', message='the referenced event must be income';
    end if;
    select coalesce(sum(amount_minor), 0) into v_eligible from public.wallet_movements where event_id = p_event_id;
  end if;

  select coalesce(sum(link_amount_minor), 0) into v_existing_allocations
    from public.occurrence_events where linked_event_id = p_event_id and action in ('link','confirm');
  v_new_total := v_existing_allocations + v_amount_minor;
  if v_new_total > v_eligible then
    raise exception using errcode='P0001', message='the linked amount exceeds the referenced event''s remaining eligible amount';
  end if;

  insert into public.occurrence_events (
    occurrence_id, space_id, expected_event_id, action, linked_event_id, link_amount_minor, request_id, actor_id
  ) values (
    p_occurrence_id, p_space_id, p_expected_event_id, 'link', p_event_id, v_amount_minor, p_request_id, v_actor
  ) returning id into v_occurrence_event_id;

  if v_schedule_kind = 'expense' and v_occurrence.funding_goal_id is not null then
    select * into v_goal from public.goals where id = v_occurrence.funding_goal_id and space_id = p_space_id;
    if found and v_goal.currency = v_occurrence.currency then
      select state into v_goal_state from public.goal_revisions where goal_id = v_goal.id order by id desc limit 1;
      if v_goal_state = 'active' then
        select earmarked_minor, fulfilled_minor, head into v_earmarked, v_fulfilled, v_head
          from private.goal_financing_state(v_goal.id, v_today);
        select coalesce(sum(amount_minor), 0) into v_existing_goal_links
          from public.goal_purchase_links where expense_event_id = p_event_id;
        v_remaining_fundable := greatest(v_eligible - v_existing_goal_links, 0);
        v_goal_alloc := least(greatest(v_earmarked,0), v_amount_minor, v_remaining_fundable);
        if v_goal_alloc > 0 then
          perform public.link_goal_purchase(
            p_space_id, private.planning_child_request(p_request_id, 'link_scheduled_payment:goal'),
            p_event_id, jsonb_build_array(jsonb_build_object(
              'goalId', v_goal.id::text, 'amountMinor', v_goal_alloc::text, 'expectedHead', v_head
            ))
          );
        end if;
      end if;
    end if;
  end if;

  v_result := jsonb_build_object(
    'occurrenceId', p_occurrence_id::text, 'occurrenceEventId', v_occurrence_event_id::text,
    'financialEventId', p_event_id::text
  );
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'link_scheduled_payment', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$$;


ALTER FUNCTION public.link_scheduled_payment(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_event_id uuid, p_amount_minor text, p_expected_event_id bigint) OWNER TO postgres;

--
-- Name: list_household_invitations(uuid, integer, timestamp with time zone, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.list_household_invitations(p_space_id uuid, p_limit integer DEFAULT 50, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid) RETURNS TABLE(invitation_id uuid, effective_status text, created_at timestamp with time zone, expires_at timestamp with time zone, accepted_at timestamp with time zone, cancelled_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_after_created_at timestamptz;
begin
  if p_limit is null or p_limit not between 1 and 100
    or ((p_after_created_at is null) <> (p_after_id is null)) then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if private.household_actor_user_id() is null
    or private.household_space_kind(p_space_id) <> 'household'
    or not private.is_active_owner(p_space_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  if p_after_id is not null then
    select invitation.created_at
    into v_after_created_at
    from public.household_invitations as invitation
    where invitation.space_id = p_space_id
      and invitation.id = p_after_id;
    if not found
      or date_trunc('milliseconds', v_after_created_at)
        <> date_trunc('milliseconds', p_after_created_at) then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
  end if;

  return query
  select result.invitation_id, result.effective_status, result.created_at,
         result.expires_at, result.accepted_at, result.cancelled_at
  from private.household_execute_invitation_listing(
    p_space_id,
    p_limit,
    v_after_created_at,
    p_after_id
  ) as result;
end;
$$;


ALTER FUNCTION public.list_household_invitations(p_space_id uuid, p_limit integer, p_after_created_at timestamp with time zone, p_after_id uuid) OWNER TO postgres;

--
-- Name: list_household_members(uuid, integer, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.list_household_members(p_space_id uuid, p_limit integer DEFAULT 50, p_after_user_id uuid DEFAULT NULL::uuid) RETURNS TABLE(user_id uuid, role public.member_role, status public.membership_status, created_at timestamp with time zone, activated_at timestamp with time zone, ended_at timestamp with time zone, is_self boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if private.household_actor_user_id() is null
    or private.household_space_kind(p_space_id) <> 'household'
    or not private.is_active_owner(p_space_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;
  if p_after_user_id is not null and not exists (
    select 1
    from public.space_memberships as membership
    where membership.space_id = p_space_id
      and membership.user_id = p_after_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  return query
  select result.user_id, result.role, result.status, result.created_at,
         result.activated_at, result.ended_at, result.is_self
  from private.household_execute_member_listing(
    p_space_id,
    p_limit,
    p_after_user_id
  ) as result;
end;
$$;


ALTER FUNCTION public.list_household_members(p_space_id uuid, p_limit integer, p_after_user_id uuid) OWNER TO postgres;

--
-- Name: loan_monthly_currency_summary(uuid, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.loan_monthly_currency_summary(p_space_id uuid, p_month date) RETURNS TABLE(currency public.currency_code, owed_to_me_minor bigint, i_owe_minor bigint, due_amount_minor bigint, planned_repayment_minor bigint, actual_repayment_minor bigint, remaining_reservation_minor bigint, expected_collection_minor bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  if not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  return query
  select
    plan.currency,
    coalesce(sum(case when plan.direction = 'they_owe_me' then balance.outstanding_minor else 0 end), 0)::bigint,
    coalesce(sum(case when plan.direction = 'i_owe_them' then balance.outstanding_minor else 0 end), 0)::bigint,
    coalesce(sum(plan.due_amount_minor), 0)::bigint,
    coalesce(sum(case when plan.direction = 'i_owe_them' then plan.target_minor else 0 end), 0)::bigint,
    coalesce(sum(case when plan.direction = 'i_owe_them' then plan.actual_repayment_minor else 0 end), 0)::bigint,
    coalesce(sum(case when plan.direction = 'i_owe_them' then plan.remaining_reservation_minor else 0 end), 0)::bigint,
    coalesce(sum(plan.expected_collection_minor), 0)::bigint
  from public.loan_monthly_plan(p_space_id, p_month) as plan
  join public.loan_balances as balance on balance.loan_id = plan.loan_id
  group by plan.currency;
end;
$$;


ALTER FUNCTION public.loan_monthly_currency_summary(p_space_id uuid, p_month date) OWNER TO postgres;

--
-- Name: loan_monthly_plan(uuid, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.loan_monthly_plan(p_space_id uuid, p_month date) RETURNS TABLE(loan_id uuid, currency public.currency_code, direction public.loan_direction, target_minor bigint, actual_repayment_minor bigint, remaining_reservation_minor bigint, due_amount_minor bigint, expected_collection_minor bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_next_month date := (date_trunc('month', p_month) + interval '1 month')::date;
begin
  if not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  return query
  with latest_target as (
    select distinct on (revision.loan_id)
      revision.loan_id,
      revision.target_minor
    from public.loan_monthly_target_revisions as revision
    where revision.space_id = p_space_id
      and revision.target_month = v_month
    order by revision.loan_id, revision.created_at desc, revision.id desc
  ),
  actual_repayments as (
    select
      posting.loan_id,
      coalesce(sum(posting.repayment_effect_minor), 0)::bigint as actual_repayment_minor
    from public.loan_postings as posting
    join public.financial_events as event on event.id = posting.event_id
    where posting.space_id = p_space_id
      and event.effective_date >= v_month
      and event.effective_date < v_next_month
    group by posting.loan_id
  )
  select
    loan.id,
    loan.currency,
    loan.direction,
    coalesce(target.target_minor, 0)::bigint,
    greatest(coalesce(actual.actual_repayment_minor, 0), 0)::bigint,
    least(
      greatest(
        coalesce(target.target_minor, 0) - greatest(coalesce(actual.actual_repayment_minor, 0), 0),
        0
      ),
      balance.outstanding_minor
    )::bigint,
    case
      when loan.due_date >= v_month and loan.due_date < v_next_month then balance.outstanding_minor
      else 0
    end::bigint,
    case when loan.direction = 'they_owe_me' then balance.outstanding_minor else 0 end::bigint
  from public.loans as loan
  join public.loan_balances as balance on balance.loan_id = loan.id
  left join latest_target as target on target.loan_id = loan.id
  left join actual_repayments as actual on actual.loan_id = loan.id
  where loan.space_id = p_space_id;
end;
$$;


ALTER FUNCTION public.loan_monthly_plan(p_space_id uuid, p_month date) OWNER TO postgres;

--
-- Name: materialize_schedule_occurrences(uuid, uuid, date, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.materialize_schedule_occurrences(p_space_id uuid, p_request_id uuid, p_from_date date, p_to_date date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_candidates_total integer;
  v_existing_count integer;
  v_new_count integer;
  v_created_count integer;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_from_date is null or p_to_date is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_to_date < p_from_date or (p_to_date - p_from_date) > 90 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('materialize_schedule_occurrences', v_actor, jsonb_build_object(
    'fromDate', p_from_date, 'toDate', p_to_date
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'materialize_schedule_occurrences', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select count(*), count(*) filter (where exists(
    select 1 from public.scheduled_occurrences so where so.schedule_id = c.schedule_id and so.due_date = c.due_date
  ))
  into v_candidates_total, v_existing_count
  from private.schedule_occurrence_candidates(p_space_id, p_from_date, p_to_date) c;

  v_new_count := coalesce(v_candidates_total, 0) - coalesce(v_existing_count, 0);
  if v_new_count > 500 then
    raise exception using errcode='P0001', message='materializing this range would create more than 500 new occurrences';
  end if;

  insert into public.scheduled_occurrences (
    id, schedule_id, source_revision_id, space_id, currency, due_date, expected_minor,
    category_id, loan_id, funding_goal_id, preferred_wallet_id, request_id, actor_id
  )
  select
    private.schedule_occurrence_id(c.schedule_id, c.due_date), c.schedule_id, c.source_revision_id,
    c.space_id, c.currency, c.due_date, c.expected_minor,
    c.category_id, c.loan_id, c.funding_goal_id, c.preferred_wallet_id,
    private.planning_child_request(p_request_id, 'materialize:' || c.schedule_id::text || ':' || c.due_date::text),
    v_actor
  from private.schedule_occurrence_candidates(p_space_id, p_from_date, p_to_date) c
  where not exists(
    select 1 from public.scheduled_occurrences so where so.schedule_id = c.schedule_id and so.due_date = c.due_date
  )
  on conflict (schedule_id,due_date) do nothing;
  get diagnostics v_created_count = row_count;

  v_result := jsonb_build_object(
    'createdCount', v_created_count, 'existingCount', coalesce(v_existing_count,0),
    'fromDate', p_from_date, 'toDate', p_to_date
  );
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'materialize_schedule_occurrences', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$$;


ALTER FUNCTION public.materialize_schedule_occurrences(p_space_id uuid, p_request_id uuid, p_from_date date, p_to_date date) OWNER TO postgres;

--
-- Name: monthly_budget_category_page(uuid, date, timestamp with time zone, uuid, public.currency_code, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.monthly_budget_category_page(p_space_id uuid, p_month date, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_category_id uuid DEFAULT NULL::uuid, p_after_currency public.currency_code DEFAULT NULL::public.currency_code, p_limit integer DEFAULT 50) RETURNS TABLE(category_id uuid, name_en text, name_ar text, archived_at timestamp with time zone, currency public.currency_code, target_minor bigint, actual_spent_minor bigint, remaining_minor bigint, overspent_minor bigint, target_revision_id bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_month_start date := date_trunc('month', p_month)::date;
begin
  if p_month is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = 'P0001', message = 'monthly budget category page limit must be between 1 and 100';
  end if;
  if (p_after_created_at is null) <> (p_after_category_id is null)
    or (p_after_created_at is null) <> (p_after_currency is null) then
    raise exception using errcode = 'P0001', message = 'monthly budget category cursor is incomplete';
  end if;
  return query
  with latest as (
    select distinct on (revision.currency, revision.category_id) revision.*
    from public.monthly_budget_plan_revisions as revision
    where revision.space_id = p_space_id and revision.month_start = v_month_start
      and revision.plan_kind = 'expense_category'
    order by revision.currency, revision.category_id, revision.id desc
  ), expense_actual as (
    select wallet.currency, association.category_id, (-sum(movement.amount_minor))::bigint as spent_minor
    from public.financial_events as event
    join public.wallet_movements as movement on movement.event_id = event.id
    join public.wallets as wallet on wallet.id = movement.wallet_id
    join public.financial_event_categories as association on association.event_id = event.id
    left join public.financial_events as original on original.id = event.reversal_of
    where event.space_id = p_space_id and event.effective_date >= v_month_start
      and event.effective_date < (v_month_start + interval '1 month')::date
      and coalesce(original.kind, event.kind) = 'expense'
      and not exists (select 1 from public.loan_postings as posting where posting.event_id = event.id)
    group by wallet.currency, association.category_id
  ), rows as (
    select category.id as selected_category_id, category.created_at, category.name_en, category.name_ar,
      category.archived_at, currency.currency as selected_currency,
      coalesce(target.amount_minor, 0)::bigint as selected_target_minor,
      coalesce(actual.spent_minor, 0)::bigint as selected_actual_spent_minor,
      target.id as selected_target_revision_id
    from public.categories as category
    cross join (values ('USD'::public.currency_code), ('LBP'::public.currency_code)) as currency(currency)
    left join latest as target on target.category_id = category.id and target.currency = currency.currency
    left join expense_actual as actual on actual.category_id = category.id and actual.currency = currency.currency
    where category.space_id = p_space_id and category.kind = 'expense'
      and (category.archived_at is null or coalesce(target.amount_minor, 0) <> 0 or coalesce(actual.spent_minor, 0) <> 0)
  )
  select rows.selected_category_id, rows.name_en, rows.name_ar, rows.archived_at, rows.selected_currency,
    rows.selected_target_minor, rows.selected_actual_spent_minor,
    greatest(rows.selected_target_minor - rows.selected_actual_spent_minor, 0)::bigint,
    greatest(rows.selected_actual_spent_minor - rows.selected_target_minor, 0)::bigint,
    rows.selected_target_revision_id
  from rows
  where p_after_created_at is null
    or (rows.created_at, rows.selected_category_id, rows.selected_currency) > (p_after_created_at, p_after_category_id, p_after_currency)
  order by rows.created_at, rows.selected_category_id, rows.selected_currency
  limit p_limit;
end;
$$;


ALTER FUNCTION public.monthly_budget_category_page(p_space_id uuid, p_month date, p_after_created_at timestamp with time zone, p_after_category_id uuid, p_after_currency public.currency_code, p_limit integer) OWNER TO postgres;

--
-- Name: monthly_budget_category_page_v2(uuid, date, text, uuid, public.currency_code, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.monthly_budget_category_page_v2(p_space_id uuid, p_month date, p_after_created_at text DEFAULT NULL::text, p_after_category_id uuid DEFAULT NULL::uuid, p_after_currency public.currency_code DEFAULT NULL::public.currency_code, p_limit integer DEFAULT 50) RETURNS TABLE(category_id uuid, category_created_at text, currency public.currency_code, name_en text, name_ar text, archived_at timestamp with time zone, target_minor text, actual_spent_minor text, remaining_minor text, overspent_minor text, target_revision_id text, has_more boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_month_start date := date_trunc('month', p_month)::date;
  -- A JS client's Date object round-trips a timestamptz at millisecond
  -- precision, which can duplicate or drop rows across a page boundary when
  -- two rows share a microsecond-precision timestamp. Returning and accepting
  -- this cursor field as text (like the money fields already do for bigint)
  -- keeps full precision through that round trip; cast back here to compare.
  v_after_created_at timestamptz := p_after_created_at::timestamptz;
begin
  if p_month is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = 'P0001', message = 'monthly budget category page limit must be between 1 and 100';
  end if;
  if (p_after_created_at is null) <> (p_after_category_id is null)
    or (p_after_created_at is null) <> (p_after_currency is null) then
    raise exception using errcode = 'P0001', message = 'monthly budget category cursor is incomplete';
  end if;
  return query
  with latest as (
    select distinct on (revision.currency, revision.category_id) revision.*
    from public.monthly_budget_plan_revisions as revision
    where revision.space_id = p_space_id and revision.month_start = v_month_start
      and revision.plan_kind = 'expense_category'
    order by revision.currency, revision.category_id, revision.id desc
  ), expense_actual as (
    select wallet.currency, association.category_id, (-sum(movement.amount_minor))::bigint as spent_minor
    from public.financial_events as event
    join public.wallet_movements as movement on movement.event_id = event.id
    join public.wallets as wallet on wallet.id = movement.wallet_id
    join public.financial_event_categories as association on association.event_id = event.id
    left join public.financial_events as original on original.id = event.reversal_of
    where event.space_id = p_space_id and event.effective_date >= v_month_start
      and event.effective_date < (v_month_start + interval '1 month')::date
      and coalesce(original.kind, event.kind) = 'expense'
      and not exists (select 1 from public.loan_postings as posting where posting.event_id = event.id)
    group by wallet.currency, association.category_id
  ), rows as (
    select category.id as selected_category_id, category.created_at, category.name_en, category.name_ar,
      category.archived_at, currency.currency as selected_currency,
      target.amount_minor as selected_target_minor,
      coalesce(actual.spent_minor, 0)::bigint as selected_actual_spent_minor,
      target.id as selected_target_revision_id
    from public.categories as category
    cross join (values ('USD'::public.currency_code), ('LBP'::public.currency_code)) as currency(currency)
    left join latest as target on target.category_id = category.id and target.currency = currency.currency
    left join expense_actual as actual on actual.category_id = category.id and actual.currency = currency.currency
    where category.space_id = p_space_id and category.kind = 'expense'
      and category.parent_category_id is null
      and (target.id is not null or coalesce(actual.spent_minor, 0) <> 0)
  )
  select rows.selected_category_id, rows.created_at::text, rows.selected_currency, rows.name_en, rows.name_ar, rows.archived_at,
    coalesce(rows.selected_target_minor, 0)::text,
    rows.selected_actual_spent_minor::text,
    greatest(coalesce(rows.selected_target_minor, 0) - rows.selected_actual_spent_minor, 0)::text,
    greatest(rows.selected_actual_spent_minor - coalesce(rows.selected_target_minor, 0), 0)::text,
    rows.selected_target_revision_id::text,
    count(*) over () > p_limit
  from rows
  where v_after_created_at is null
    or (rows.created_at, rows.selected_category_id, rows.selected_currency) > (v_after_created_at, p_after_category_id, p_after_currency)
  order by rows.created_at, rows.selected_category_id, rows.selected_currency
  limit p_limit;
end;
$$;


ALTER FUNCTION public.monthly_budget_category_page_v2(p_space_id uuid, p_month date, p_after_created_at text, p_after_category_id uuid, p_after_currency public.currency_code, p_limit integer) OWNER TO postgres;

--
-- Name: monthly_budget_category_page_v3(uuid, date, public.currency_code, text, uuid, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.monthly_budget_category_page_v3(p_space_id uuid, p_month date, p_currency public.currency_code, p_after_created_at text DEFAULT NULL::text, p_after_category_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100) RETURNS TABLE(category_id uuid, category_created_at text, name_en text, name_ar text, archived_at timestamp with time zone, target_minor text, actual_spent_minor text, remaining_minor text, overspent_minor text, target_revision_id text, has_more boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_month_start date := date_trunc('month', p_month)::date;
  v_after_created_at timestamptz := p_after_created_at::timestamptz;
begin
  if p_month is null or p_currency is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = 'P0001', message = 'monthly budget category page limit must be between 1 and 100';
  end if;
  if (p_after_created_at is null) <> (p_after_category_id is null) then
    raise exception using errcode = 'P0001', message = 'monthly budget category cursor is incomplete';
  end if;
  return query
  with latest as (
    select distinct on (revision.category_id) revision.*
    from public.monthly_budget_plan_revisions as revision
    where revision.space_id = p_space_id and revision.month_start = v_month_start
      and revision.currency = p_currency and revision.plan_kind = 'expense_category'
    order by revision.category_id, revision.id desc
  ), expense_actual as (
    select coalesce(tagged.parent_category_id, tagged.id) as root_id,
      (-sum(movement.amount_minor))::bigint as spent_minor
    from public.financial_events as event
    join public.wallet_movements as movement on movement.event_id = event.id
    join public.wallets as wallet on wallet.id = movement.wallet_id and wallet.currency = p_currency
    join public.financial_event_categories as association on association.event_id = event.id
    join public.categories as tagged on tagged.id = association.category_id
    left join public.financial_events as original on original.id = event.reversal_of
    where event.space_id = p_space_id and event.effective_date >= v_month_start
      and event.effective_date < (v_month_start + interval '1 month')::date
      and coalesce(original.kind, event.kind) = 'expense'
      and not exists (select 1 from public.loan_postings as posting where posting.event_id = event.id)
    group by coalesce(tagged.parent_category_id, tagged.id)
  ), rows as (
    select category.id as selected_category_id, category.created_at, category.name_en, category.name_ar,
      category.archived_at, target.amount_minor as selected_target_minor,
      coalesce(actual.spent_minor, 0)::bigint as selected_actual_spent_minor,
      target.id as selected_target_revision_id
    from public.categories as category
    left join latest as target on target.category_id = category.id
    left join expense_actual as actual on actual.root_id = category.id
    where category.space_id = p_space_id and category.kind = 'expense'
      and category.parent_category_id is null
      and (category.archived_at is null or coalesce(target.amount_minor, 0) <> 0 or coalesce(actual.spent_minor, 0) <> 0)
  )
  select rows.selected_category_id, rows.created_at::text, rows.name_en, rows.name_ar, rows.archived_at,
    coalesce(rows.selected_target_minor, 0)::text,
    rows.selected_actual_spent_minor::text,
    greatest(coalesce(rows.selected_target_minor, 0) - rows.selected_actual_spent_minor, 0)::text,
    greatest(rows.selected_actual_spent_minor - coalesce(rows.selected_target_minor, 0), 0)::text,
    rows.selected_target_revision_id::text,
    count(*) over () > p_limit
  from rows
  where v_after_created_at is null
    or (rows.created_at, rows.selected_category_id) > (v_after_created_at, p_after_category_id)
  order by rows.created_at, rows.selected_category_id
  limit p_limit;
end;
$$;


ALTER FUNCTION public.monthly_budget_category_page_v3(p_space_id uuid, p_month date, p_currency public.currency_code, p_after_created_at text, p_after_category_id uuid, p_limit integer) OWNER TO postgres;

--
-- Name: monthly_budget_currency_summary(uuid, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.monthly_budget_currency_summary(p_space_id uuid, p_month date) RETURNS TABLE(currency public.currency_code, planned_income_minor bigint, actual_income_minor bigint, category_target_total_minor bigint, category_actual_spent_minor bigint, uncategorized_spent_minor bigint, category_overspent_minor bigint, actual_loan_repayment_minor bigint, remaining_loan_reservation_minor bigint, loan_commitment_minor bigint, unallocated_minor bigint, overallocated_minor bigint, income_plan_revision_id bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare v_month_start date := date_trunc('month', p_month)::date;
begin
  if p_month is null or not private.is_active_member(p_space_id) then raise exception using errcode = '42501', message = 'an active space membership is required'; end if;
  return query
  with latest as (
    select distinct on (r.plan_kind, r.currency, r.category_id) r.* from public.monthly_budget_plan_revisions r
    where r.space_id = p_space_id and r.month_start = v_month_start order by r.plan_kind, r.currency, r.category_id, r.id desc
  ), currencies as (
    select wallet.currency from public.wallets as wallet where wallet.space_id = p_space_id
    union select latest.currency from latest
    union select loan_summary.currency from public.loan_monthly_currency_summary(p_space_id, v_month_start) as loan_summary
  ), plan as (
    select latest.currency, coalesce(max(latest.amount_minor) filter (where latest.plan_kind = 'income'), 0)::bigint as income,
      coalesce(sum(latest.amount_minor) filter (where latest.plan_kind = 'expense_category'), 0)::bigint as targets,
      max(latest.id) filter (where latest.plan_kind = 'income') as income_revision_id from latest group by latest.currency
  ), loans as (
    select loan_summary.currency, loan_summary.actual_repayment_minor, loan_summary.remaining_reservation_minor
    from public.loan_monthly_currency_summary(p_space_id, v_month_start) as loan_summary
  ), expense_actual as (
    select wallet.currency, association.category_id, (-sum(movement.amount_minor))::bigint as spent_minor
    from public.financial_events as event
    join public.wallet_movements as movement on movement.event_id = event.id
    join public.wallets as wallet on wallet.id = movement.wallet_id
    left join public.financial_event_categories as association on association.event_id = event.id
    left join public.financial_events as original on original.id = event.reversal_of
    where event.space_id = p_space_id and event.effective_date >= v_month_start
      and event.effective_date < (v_month_start + interval '1 month')::date
      and coalesce(original.kind, event.kind) = 'expense'
      and not exists (select 1 from public.loan_postings as posting where posting.event_id = event.id)
    group by wallet.currency, association.category_id
  ), income_actual as (
    select wallet.currency, sum(movement.amount_minor)::bigint as received_minor
    from public.financial_events as event
    join public.wallet_movements as movement on movement.event_id = event.id
    join public.wallets as wallet on wallet.id = movement.wallet_id
    left join public.financial_events as original on original.id = event.reversal_of
    where event.space_id = p_space_id and event.effective_date >= v_month_start
      and event.effective_date < (v_month_start + interval '1 month')::date
      and coalesce(original.kind, event.kind) = 'income'
      and not exists (select 1 from public.loan_postings as posting where posting.event_id = event.id)
    group by wallet.currency
  ), expense_summary as (
    select expense_actual.currency, coalesce(sum(expense_actual.spent_minor) filter (where expense_actual.category_id is not null), 0)::bigint as categorized_minor,
      coalesce(sum(expense_actual.spent_minor) filter (where expense_actual.category_id is null), 0)::bigint as uncategorized_minor
    from expense_actual group by expense_actual.currency
  ), overspent as (
    select target.currency, coalesce(sum(greatest(coalesce(actual.spent_minor, 0) - target.amount_minor, 0)), 0)::bigint as amount_minor
    from latest as target left join expense_actual as actual on actual.currency = target.currency and actual.category_id = target.category_id
    where target.plan_kind = 'expense_category' group by target.currency
  )
  select c.currency, coalesce(p.income,0), coalesce(i.received_minor,0), coalesce(p.targets,0), coalesce(e.categorized_minor,0), coalesce(e.uncategorized_minor,0), coalesce(o.amount_minor,0),
    coalesce(l.actual_repayment_minor,0), coalesce(l.remaining_reservation_minor,0),
    (coalesce(l.actual_repayment_minor,0) + coalesce(l.remaining_reservation_minor,0))::bigint,
    greatest(coalesce(p.income,0) - coalesce(p.targets,0) - coalesce(l.actual_repayment_minor,0) - coalesce(l.remaining_reservation_minor,0), 0)::bigint,
    greatest(-(coalesce(p.income,0) - coalesce(p.targets,0) - coalesce(l.actual_repayment_minor,0) - coalesce(l.remaining_reservation_minor,0)), 0)::bigint,
    p.income_revision_id
  from currencies c left join plan p using(currency) left join loans l using(currency)
    left join income_actual i using(currency) left join expense_summary e using(currency) left join overspent o using(currency)
  order by c.currency;
end;
$$;


ALTER FUNCTION public.monthly_budget_currency_summary(p_space_id uuid, p_month date) OWNER TO postgres;

--
-- Name: move_goal_earmark(uuid, uuid, uuid, uuid, text, text, text, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.move_goal_earmark(p_space_id uuid, p_request_id uuid, p_from_goal_id uuid, p_to_goal_id uuid, p_amount_minor text, p_expected_from_head text, p_expected_to_head text, p_accept_underfunded boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_from public.goals%rowtype;
  v_to public.goals%rowtype;
  v_to_state text; v_to_target bigint;
  v_amount_minor bigint;
  v_today date;
  v_from_earmarked numeric; v_from_fulfilled numeric; v_from_head text;
  v_to_earmarked numeric; v_to_fulfilled numeric; v_to_head text;
  v_max_reserve numeric;
  v_event_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_from_goal_id is null or p_to_goal_id is null
    or p_amount_minor is null or p_expected_from_head is null or p_expected_to_head is null or p_accept_underfunded is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_from_goal_id = p_to_goal_id then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_expected_from_head !~ '^[0-9a-f]{64}$' or p_expected_to_head !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_amount_minor := private.planning_minor(p_amount_minor, true);
  v_today := (now() at time zone 'UTC')::date;

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('move_goal_earmark', v_actor, jsonb_build_object(
    'fromGoalId', p_from_goal_id, 'toGoalId', p_to_goal_id, 'amountMinor', v_amount_minor::text,
    'expectedFromHead', p_expected_from_head, 'expectedToHead', p_expected_to_head, 'acceptUnderfunded', p_accept_underfunded
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'move_goal_earmark', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select * into v_from from public.goals where id = p_from_goal_id and space_id = p_space_id;
  select * into v_to from public.goals where id = p_to_goal_id and space_id = p_space_id;
  if v_from.id is null or v_to.id is null then
    raise exception using errcode='P0001', message='both goals must belong to the requested space';
  end if;
  if v_from.currency is distinct from v_to.currency then
    raise exception using errcode='P0001', message='a move requires both goals to share a currency';
  end if;

  select earmarked_minor, fulfilled_minor, head into v_from_earmarked, v_from_fulfilled, v_from_head
    from private.goal_financing_state(p_from_goal_id, v_today);
  select earmarked_minor, fulfilled_minor, head into v_to_earmarked, v_to_fulfilled, v_to_head
    from private.goal_financing_state(p_to_goal_id, v_today);
  if v_from_head is distinct from p_expected_from_head or v_to_head is distinct from p_expected_to_head then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  if v_amount_minor > v_from_earmarked then
    raise exception using errcode='P0001', message='the move exceeds the source goal''s current earmark';
  end if;
  select state, target_minor into v_to_state, v_to_target from public.goal_revisions where goal_id = p_to_goal_id order by id desc limit 1;
  if v_to_state <> 'active' then
    raise exception using errcode='P0001', message='a move destination requires an active goal';
  end if;
  v_max_reserve := greatest(v_to_target - v_to_earmarked - v_to_fulfilled, 0);
  if v_amount_minor > v_max_reserve then
    raise exception using errcode='P0001', message='the move exceeds the destination goal''s remaining room';
  end if;

  insert into public.goal_earmark_events (space_id, currency, operation, line_count, request_id, actor_id)
    values (p_space_id, v_from.currency, 'move', 2, p_request_id, v_actor) returning id into v_event_id;
  insert into public.goal_earmark_lines (event_id, goal_id, space_id, currency, amount_minor) values
    (v_event_id, p_from_goal_id, p_space_id, v_from.currency, -v_amount_minor),
    (v_event_id, p_to_goal_id, p_space_id, v_from.currency, v_amount_minor);

  v_result := jsonb_build_object('eventId', v_event_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'move_goal_earmark', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$_$;


ALTER FUNCTION public.move_goal_earmark(p_space_id uuid, p_request_id uuid, p_from_goal_id uuid, p_to_goal_id uuid, p_amount_minor text, p_expected_from_head text, p_expected_to_head text, p_accept_underfunded boolean) OWNER TO postgres;

--
-- Name: open_loan_outstanding(uuid, uuid, public.loan_direction, text, public.currency_code, text, date, date, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.open_loan_outstanding(p_space_id uuid, p_request_id uuid, p_direction public.loan_direction, p_person_name text, p_currency public.currency_code, p_amount_minor text, p_effective_date date, p_due_date date DEFAULT NULL::date, p_note text DEFAULT NULL::text) RETURNS TABLE(loan_id uuid, event_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_amount_minor bigint;
  v_fingerprint bytea;
  v_existing_fingerprint bytea;
  v_existing_loan_id uuid;
  v_existing_event_id uuid;
  v_loan_id uuid;
  v_event_id uuid;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using
      errcode = '42501',
      message = 'an active space membership is required';
  end if;

  if char_length(btrim(p_person_name)) not between 1 and 120
    or (p_note is not null and char_length(p_note) > 2_000)
    or (p_due_date is not null and p_due_date < p_effective_date) then
    raise exception using errcode = 'P0001', message = 'the loan details are invalid';
  end if;

  v_amount_minor := private.parse_positive_minor_amount(p_amount_minor);
  v_fingerprint := extensions.digest(
    'loan_opening|' || p_direction::text || '|' || btrim(p_person_name) || '|'
      || p_currency::text || '|' || p_amount_minor || '|' || p_effective_date::text || '|'
      || coalesce(p_due_date::text, '') || '|' || coalesce(p_note, ''),
    'sha256'
  );

  perform private.lock_financial_request(p_space_id, p_request_id);

  select event.request_fingerprint, posting.loan_id, event.id
  into v_existing_fingerprint, v_existing_loan_id, v_existing_event_id
  from public.financial_events as event
  join public.loan_postings as posting on posting.event_id = event.id
  where event.space_id = p_space_id
    and event.request_id = p_request_id;

  if found then
    if v_existing_fingerprint <> v_fingerprint then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_existing_loan_id, v_existing_event_id;
    return;
  end if;

  insert into public.loans (
    space_id, direction, person_name, currency, effective_date, due_date, note, actor_id
  )
  values (
    p_space_id, p_direction, btrim(p_person_name), p_currency, p_effective_date,
    p_due_date, p_note, v_actor_id
  )
  returning id into v_loan_id;

  insert into public.financial_events (
    space_id, request_id, request_fingerprint, kind, effective_date, actor_id
  )
  values (
    p_space_id, p_request_id, v_fingerprint, 'loan_opening', p_effective_date, v_actor_id
  )
  returning id into v_event_id;

  insert into public.loan_postings (
    event_id, loan_id, space_id, principal_delta_minor
  )
  values (v_event_id, v_loan_id, p_space_id, v_amount_minor);

  return query select v_loan_id, v_event_id;
end;
$$;


ALTER FUNCTION public.open_loan_outstanding(p_space_id uuid, p_request_id uuid, p_direction public.loan_direction, p_person_name text, p_currency public.currency_code, p_amount_minor text, p_effective_date date, p_due_date date, p_note text) OWNER TO postgres;

--
-- Name: preview_budget_month_close(uuid, public.currency_code, date, bigint); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.preview_budget_month_close(p_space_id uuid, p_currency public.currency_code, p_month date, p_expected_close_id bigint) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
begin
  if p_space_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  if p_currency is null or p_month is null or p_month <> date_trunc('month', p_month)::date then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  return private.budget_month_close_preview(p_space_id, p_currency, p_month, p_expected_close_id);
end;
$$;


ALTER FUNCTION public.preview_budget_month_close(p_space_id uuid, p_currency public.currency_code, p_month date, p_expected_close_id bigint) OWNER TO postgres;

--
-- Name: preview_month_copy(uuid, public.currency_code, bigint, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.preview_month_copy(p_space_id uuid, p_currency public.currency_code, p_source_snapshot_id bigint, p_target_month date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
begin
  if p_space_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  if p_currency is null or p_source_snapshot_id is null or p_target_month is null
    or p_target_month <> date_trunc('month', p_target_month)::date then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  return private.month_copy_preview(p_space_id, p_currency, p_source_snapshot_id, p_target_month);
end;
$$;


ALTER FUNCTION public.preview_month_copy(p_space_id uuid, p_currency public.currency_code, p_source_snapshot_id bigint, p_target_month date) OWNER TO postgres;

--
-- Name: publish_allocation_month(uuid, uuid, date, public.currency_code, bigint, bigint, bigint, text, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.publish_allocation_month(p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code, p_expected_snapshot_id bigint, p_template_revision_id bigint, p_expected_income_revision_id bigint, p_income_minor text, p_root_targets jsonb, p_loan_group_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_month date;
  v_income_minor bigint;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_current_snapshot_id bigint;
  v_template_space uuid;
  v_template_currency public.currency_code;
  v_template_groups jsonb;
  v_group_targets jsonb;
  v_canonical_roots jsonb := '[]'::jsonb;
  v_category_ids uuid[] := '{}';
  v_entry jsonb;
  v_category_id uuid;
  v_amount_minor bigint;
  v_expected_revision_id bigint;
  v_required_missing integer;
  v_existing_positive_goals integer;
  v_over_target_groups integer;
  v_loan_group_purpose text;
  v_loan_group_target bigint;
  v_loan_actual bigint;
  v_loan_remaining bigint;
  v_income_child_request uuid;
  v_income_id bigint;
  v_income_month date;
  v_child_request uuid;
  v_root_revision_id bigint;
  v_snapshot_id bigint;
  v_group_count integer;
  v_root_count integer;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_month is null or p_currency is null
    or p_template_revision_id is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_month <> date_trunc('month', p_month)::date then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_month := p_month;
  v_income_minor := private.planning_minor(p_income_minor);
  if p_root_targets is null or jsonb_typeof(p_root_targets) is distinct from 'array'
    or jsonb_array_length(p_root_targets) > 200 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  for v_entry in select value from jsonb_array_elements(p_root_targets) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or (v_entry ?& array['categoryId','amountMinor','expectedRevisionId']) is not true
      or (v_entry - array['categoryId','amountMinor','expectedRevisionId']) <> '{}'::jsonb
      or jsonb_typeof(v_entry->'categoryId') is distinct from 'string'
      or (v_entry->>'categoryId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_entry->'amountMinor') is distinct from 'string'
      or jsonb_typeof(v_entry->'expectedRevisionId') not in ('string','null')
      or (jsonb_typeof(v_entry->'expectedRevisionId') = 'string' and (v_entry->>'expectedRevisionId') !~ '^(0|[1-9][0-9]{0,18})$')
    then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_category_id := (v_entry->>'categoryId')::uuid;
    if v_category_id = any(v_category_ids) then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_amount_minor := private.planning_minor(v_entry->>'amountMinor');
    v_category_ids := array_append(v_category_ids, v_category_id);
    v_canonical_roots := v_canonical_roots || jsonb_build_array(jsonb_build_object(
      'categoryId', v_category_id, 'amountMinor', v_amount_minor::text,
      'expectedRevisionId', v_entry->'expectedRevisionId'
    ));
  end loop;
  v_canonical_roots := (select coalesce(jsonb_agg(r order by r->>'categoryId'), '[]'::jsonb) from jsonb_array_elements(v_canonical_roots) r);

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('publish_allocation_month', v_actor, jsonb_build_object(
    'month', v_month, 'currency', p_currency, 'expectedSnapshotId', p_expected_snapshot_id,
    'templateRevisionId', p_template_revision_id, 'expectedIncomeRevisionId', p_expected_income_revision_id,
    'incomeMinor', v_income_minor::text, 'rootTargets', v_canonical_roots, 'loanGroupId', p_loan_group_id
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'publish_allocation_month', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select id into v_current_snapshot_id from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = v_month
    order by id desc limit 1;
  if v_current_snapshot_id is distinct from p_expected_snapshot_id then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  select count(*) into v_existing_positive_goals
  from (
    select revision.goal_id from public.goal_monthly_target_revisions revision
    where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = v_month
  ) required
  cross join lateral (
    select latest.amount_minor from public.goal_monthly_target_revisions latest
    where latest.goal_id = required.goal_id and latest.space_id = p_space_id
      and latest.currency = p_currency and latest.month_start = v_month
    order by latest.id desc limit 1
  ) latest_target
  where latest_target.amount_minor > 0;
  if v_existing_positive_goals <> 0 then
    raise exception using errcode='P0001', message='existing positive goal targets must be included via publish_allocation_month_v2';
  end if;

  -- The template need not be the latest revision -- the caller deliberately
  -- selected it -- but it must be a real revision belonging to this exact
  -- space and currency.
  select space_id, currency into v_template_space, v_template_currency
    from public.allocation_template_revisions where id = p_template_revision_id;
  if not found or v_template_space is distinct from p_space_id or v_template_currency is distinct from p_currency then
    raise exception using errcode='P0001', message='the selected template does not belong to this space and currency';
  end if;

  v_template_groups := (
    select coalesce(jsonb_agg(jsonb_build_object('id', line.group_id, 'order', line.display_order, 'basisPoints', line.basis_points)), '[]'::jsonb)
    from public.allocation_template_lines line where line.template_id = p_template_revision_id
  );
  v_group_targets := (select coalesce(jsonb_agg(jsonb_build_object(
      'groupId', g.group_id, 'targetMinor', g.target_minor, 'isResidual', g.is_residual
    )), '[]'::jsonb) from private.allocate_planning_income(v_income_minor::text, v_template_groups) g);

  -- Complete-set rule: every template-mapped root, plus every category that
  -- currently has a positive manual target this month/currency, must appear
  -- in this submission (a stopped target is submitted explicitly as zero).
  select count(*) into v_required_missing
  from (
    select template_root.category_id from public.allocation_template_roots template_root
    where template_root.template_id = p_template_revision_id
    union
    select revision.category_id
    from public.monthly_budget_plan_revisions revision
    where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = v_month
      and revision.plan_kind = 'expense_category'
  ) required
  left join public.monthly_budget_plan_revisions latest_target
    on latest_target.space_id = p_space_id and latest_target.currency = p_currency
    and latest_target.month_start = v_month and latest_target.plan_kind = 'expense_category'
    and latest_target.category_id = required.category_id
  where (latest_target.amount_minor is null or latest_target.amount_minor > 0)
    and not (required.category_id = any(v_category_ids));
  if v_required_missing <> 0 then
    raise exception using errcode='P0001', message='every template-mapped root and existing positive target must be included in a complete-set publication';
  end if;

  -- Fail fast on group overallocation (the deferred check re-verifies this
  -- exactly against the snapshot rows once they are actually inserted).
  select count(*) into v_over_target_groups
  from (
    select (g->>'groupId')::uuid as group_id, (g->>'targetMinor')::bigint as target_minor
    from jsonb_array_elements(v_group_targets) g where (g->>'isResidual')::boolean is not true
  ) group_target
  left join (
    select tr.group_id, sum((rt->>'amountMinor')::bigint) as root_total
    from jsonb_array_elements(v_canonical_roots) rt
    join public.allocation_template_roots tr
      on tr.template_id = p_template_revision_id and tr.category_id = (rt->>'categoryId')::uuid
    group by tr.group_id
  ) mapped on mapped.group_id = group_target.group_id
  where coalesce(mapped.root_total, 0) > group_target.target_minor;
  if v_over_target_groups <> 0 then
    raise exception using errcode='P0001', message='the requested root targets exceed their spending group target';
  end if;

  -- Loan pool: a linked group must be an included Future group large enough
  -- for the observed commitment; a standalone loan pool has no group-fit
  -- constraint and may be saved even while overallocated.
  select coalesce(summary.actual_repayment_minor, 0), coalesce(summary.remaining_reservation_minor, 0)
    into v_loan_actual, v_loan_remaining
    from public.loan_monthly_currency_summary(p_space_id, v_month) as summary
    where summary.currency = p_currency;
  v_loan_actual := coalesce(v_loan_actual, 0);
  v_loan_remaining := coalesce(v_loan_remaining, 0);
  if p_loan_group_id is not null then
    select (g->>'targetMinor')::bigint into v_loan_group_target
      from jsonb_array_elements(v_group_targets) g where (g->>'groupId')::uuid = p_loan_group_id;
    select purpose into v_loan_group_purpose from public.allocation_groups
      where id = p_loan_group_id and space_id = p_space_id and currency = p_currency;
    if v_loan_group_target is null or v_loan_group_purpose is distinct from 'future' then
      raise exception using errcode='P0001', message='the loan pool group must be an included Future group';
    end if;
    if v_loan_actual + v_loan_remaining > v_loan_group_target then
      raise exception using errcode='P0001', message='the observed loan commitment does not fit its linked Future group';
    end if;
  end if;

  -- Publish the income plan, then each root target, in category-UUID order,
  -- each under a request ID deterministically derived from this command's
  -- own request ID so a retry with the same parent request replays the same
  -- children instead of minting new revisions.
  v_income_child_request := private.planning_child_request(p_request_id, 'income:' || p_currency::text || ':' || v_month::text);
  select id, month_start into v_income_id, v_income_month
    from public.set_monthly_income_plan(p_space_id, v_income_child_request, v_month, p_currency, v_income_minor::text, p_expected_income_revision_id);

  insert into public.allocation_month_snapshots (
    space_id, currency, month_start, template_revision_id, income_plan_revision_id, expected_snapshot_id,
    base_income_minor, unallocated_minor, group_count, root_count, loan_line_count, goal_line_count, request_id, actor_id
  ) values (
    p_space_id, p_currency, v_month, p_template_revision_id, v_income_id, p_expected_snapshot_id,
    v_income_minor,
    (select coalesce((g->>'targetMinor')::bigint, 0) from jsonb_array_elements(v_group_targets) g where (g->>'isResidual')::boolean is true),
    (select count(*) from jsonb_array_elements(v_group_targets) g where (g->>'isResidual')::boolean is not true),
    jsonb_array_length(v_canonical_roots), 1, 0, p_request_id, v_actor
  ) returning id into v_snapshot_id;

  insert into public.allocation_month_groups (snapshot_id, group_id, space_id, currency, name_en, name_ar, purpose, display_order, basis_points, target_minor)
  select v_snapshot_id, line.group_id, p_space_id, p_currency, line.name_en, line.name_ar, grp.purpose, line.display_order, line.basis_points,
    (select (g->>'targetMinor')::bigint from jsonb_array_elements(v_group_targets) g where (g->>'groupId')::uuid = line.group_id)
  from public.allocation_template_lines line
  join public.allocation_groups grp on grp.id = line.group_id and grp.space_id = p_space_id
  where line.template_id = p_template_revision_id;

  for v_entry in select value from jsonb_array_elements(v_canonical_roots) loop
    v_category_id := (v_entry->>'categoryId')::uuid;
    v_expected_revision_id := nullif(v_entry->>'expectedRevisionId', '')::bigint;
    v_child_request := private.planning_child_request(p_request_id, 'category:' || v_category_id::text || ':' || p_currency::text || ':' || v_month::text);
    select id into v_root_revision_id from public.set_monthly_category_target(
      p_space_id, v_child_request, v_category_id, v_month, p_currency, v_entry->>'amountMinor', v_expected_revision_id
    );
    insert into public.allocation_month_roots (snapshot_id, category_id, group_id, space_id, currency, target_revision_id, target_minor)
    values (
      v_snapshot_id, v_category_id,
      (select template_root.group_id from public.allocation_template_roots template_root
        where template_root.template_id = p_template_revision_id and template_root.category_id = v_category_id),
      p_space_id, p_currency, v_root_revision_id, (v_entry->>'amountMinor')::bigint
    );
  end loop;

  insert into public.allocation_month_commitments (snapshot_id, space_id, currency, group_id, source_kind, observed_actual_minor, observed_remaining_minor)
  values (v_snapshot_id, p_space_id, p_currency, p_loan_group_id, 'loan_pool', v_loan_actual, v_loan_remaining);

  v_result := jsonb_build_object('snapshotId', v_snapshot_id::text, 'incomeRevisionId', v_income_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'publish_allocation_month', v_fingerprint, v_actor, v_result);

  return v_result;
end;
$_$;


ALTER FUNCTION public.publish_allocation_month(p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code, p_expected_snapshot_id bigint, p_template_revision_id bigint, p_expected_income_revision_id bigint, p_income_minor text, p_root_targets jsonb, p_loan_group_id uuid) OWNER TO postgres;

--
-- Name: publish_allocation_month_v2(uuid, uuid, date, public.currency_code, bigint, bigint, bigint, text, jsonb, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.publish_allocation_month_v2(p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code, p_expected_snapshot_id bigint, p_template_revision_id bigint, p_expected_income_revision_id bigint, p_income_minor text, p_root_targets jsonb, p_loan_group_id uuid, p_goal_targets jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_month date;
  v_income_minor bigint;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_current_snapshot_id bigint;
  v_template_space uuid;
  v_template_currency public.currency_code;
  v_template_groups jsonb;
  v_group_targets jsonb;
  v_canonical_roots jsonb := '[]'::jsonb;
  v_canonical_goals jsonb := '[]'::jsonb;
  v_category_ids uuid[] := '{}';
  v_goal_ids uuid[] := '{}';
  v_entry jsonb;
  v_category_id uuid;
  v_goal_id uuid;
  v_amount_minor bigint;
  v_expected_revision_id bigint;
  v_required_missing integer;
  v_required_missing_goals integer;
  v_over_target_groups integer;
  v_over_target_goal_groups integer;
  v_loan_group_purpose text;
  v_loan_group_target bigint;
  v_loan_actual bigint;
  v_loan_remaining bigint;
  v_income_child_request uuid;
  v_income_id bigint;
  v_income_month date;
  v_child_request uuid;
  v_root_revision_id bigint;
  v_goal_revision_id bigint;
  v_snapshot_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_month is null or p_currency is null
    or p_template_revision_id is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_month <> date_trunc('month', p_month)::date then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_month := p_month;
  v_income_minor := private.planning_minor(p_income_minor);
  if p_root_targets is null or jsonb_typeof(p_root_targets) is distinct from 'array'
    or jsonb_array_length(p_root_targets) > 200 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_goal_targets is null or jsonb_typeof(p_goal_targets) is distinct from 'array'
    or jsonb_array_length(p_goal_targets) > 100 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  for v_entry in select value from jsonb_array_elements(p_root_targets) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or (v_entry ?& array['categoryId','amountMinor','expectedRevisionId']) is not true
      or (v_entry - array['categoryId','amountMinor','expectedRevisionId']) <> '{}'::jsonb
      or jsonb_typeof(v_entry->'categoryId') is distinct from 'string'
      or (v_entry->>'categoryId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_entry->'amountMinor') is distinct from 'string'
      or jsonb_typeof(v_entry->'expectedRevisionId') not in ('string','null')
      or (jsonb_typeof(v_entry->'expectedRevisionId') = 'string' and (v_entry->>'expectedRevisionId') !~ '^(0|[1-9][0-9]{0,18})$')
    then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_category_id := (v_entry->>'categoryId')::uuid;
    if v_category_id = any(v_category_ids) then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_amount_minor := private.planning_minor(v_entry->>'amountMinor');
    v_category_ids := array_append(v_category_ids, v_category_id);
    v_canonical_roots := v_canonical_roots || jsonb_build_array(jsonb_build_object(
      'categoryId', v_category_id, 'amountMinor', v_amount_minor::text,
      'expectedRevisionId', v_entry->'expectedRevisionId'
    ));
  end loop;
  v_canonical_roots := (select coalesce(jsonb_agg(r order by r->>'categoryId'), '[]'::jsonb) from jsonb_array_elements(v_canonical_roots) r);

  for v_entry in select value from jsonb_array_elements(p_goal_targets) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or (v_entry ?& array['goalId','groupId','amountMinor','expectedRevisionId']) is not true
      or (v_entry - array['goalId','groupId','amountMinor','expectedRevisionId']) <> '{}'::jsonb
      or jsonb_typeof(v_entry->'goalId') is distinct from 'string'
      or (v_entry->>'goalId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_entry->'groupId') not in ('string','null')
      or (jsonb_typeof(v_entry->'groupId') = 'string' and (v_entry->>'groupId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      or jsonb_typeof(v_entry->'amountMinor') is distinct from 'string'
      or jsonb_typeof(v_entry->'expectedRevisionId') not in ('string','null')
      or (jsonb_typeof(v_entry->'expectedRevisionId') = 'string' and (v_entry->>'expectedRevisionId') !~ '^(0|[1-9][0-9]{0,18})$')
    then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_goal_id := (v_entry->>'goalId')::uuid;
    if v_goal_id = any(v_goal_ids) then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_amount_minor := private.planning_minor(v_entry->>'amountMinor');
    v_goal_ids := array_append(v_goal_ids, v_goal_id);
    v_canonical_goals := v_canonical_goals || jsonb_build_array(jsonb_build_object(
      'goalId', v_goal_id, 'groupId', v_entry->'groupId', 'amountMinor', v_amount_minor::text,
      'expectedRevisionId', v_entry->'expectedRevisionId'
    ));
  end loop;
  v_canonical_goals := (select coalesce(jsonb_agg(g order by g->>'goalId'), '[]'::jsonb) from jsonb_array_elements(v_canonical_goals) g);

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('publish_allocation_month_v2', v_actor, jsonb_build_object(
    'month', v_month, 'currency', p_currency, 'expectedSnapshotId', p_expected_snapshot_id,
    'templateRevisionId', p_template_revision_id, 'expectedIncomeRevisionId', p_expected_income_revision_id,
    'incomeMinor', v_income_minor::text, 'rootTargets', v_canonical_roots, 'loanGroupId', p_loan_group_id,
    'goalTargets', v_canonical_goals
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'publish_allocation_month_v2', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select id into v_current_snapshot_id from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = v_month
    order by id desc limit 1;
  if v_current_snapshot_id is distinct from p_expected_snapshot_id then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  select space_id, currency into v_template_space, v_template_currency
    from public.allocation_template_revisions where id = p_template_revision_id;
  if not found or v_template_space is distinct from p_space_id or v_template_currency is distinct from p_currency then
    raise exception using errcode='P0001', message='the selected template does not belong to this space and currency';
  end if;

  v_template_groups := (
    select coalesce(jsonb_agg(jsonb_build_object('id', line.group_id, 'order', line.display_order, 'basisPoints', line.basis_points)), '[]'::jsonb)
    from public.allocation_template_lines line where line.template_id = p_template_revision_id
  );
  v_group_targets := (select coalesce(jsonb_agg(jsonb_build_object(
      'groupId', g.group_id, 'targetMinor', g.target_minor, 'isResidual', g.is_residual
    )), '[]'::jsonb) from private.allocate_planning_income(v_income_minor::text, v_template_groups) g);

  select count(*) into v_required_missing
  from (
    select template_root.category_id from public.allocation_template_roots template_root
    where template_root.template_id = p_template_revision_id
    union
    select revision.category_id
    from public.monthly_budget_plan_revisions revision
    where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = v_month
      and revision.plan_kind = 'expense_category'
  ) required
  left join public.monthly_budget_plan_revisions latest_target
    on latest_target.space_id = p_space_id and latest_target.currency = p_currency
    and latest_target.month_start = v_month and latest_target.plan_kind = 'expense_category'
    and latest_target.category_id = required.category_id
  where (latest_target.amount_minor is null or latest_target.amount_minor > 0)
    and not (required.category_id = any(v_category_ids));
  if v_required_missing <> 0 then
    raise exception using errcode='P0001', message='every template-mapped root and existing positive target must be included in a complete-set publication';
  end if;

  -- Complete-set rule for goals: every goal with a currently positive
  -- monthly target this month/currency must appear (zero explicitly clears
  -- it; omission rejects). Goals have no template mapping to union in.
  select count(*) into v_required_missing_goals
  from (
    select distinct revision.goal_id from public.goal_monthly_target_revisions revision
    where revision.space_id = p_space_id and revision.currency = p_currency and revision.month_start = v_month
  ) required
  cross join lateral (
    select latest.amount_minor from public.goal_monthly_target_revisions latest
    where latest.goal_id = required.goal_id and latest.space_id = p_space_id
      and latest.currency = p_currency and latest.month_start = v_month
    order by latest.id desc limit 1
  ) latest_target
  where latest_target.amount_minor > 0 and not (required.goal_id = any(v_goal_ids));
  if v_required_missing_goals <> 0 then
    raise exception using errcode='P0001', message='every existing positive goal target must be included in a complete-set publication';
  end if;

  select count(*) into v_over_target_groups
  from (
    select (g->>'groupId')::uuid as group_id, (g->>'targetMinor')::bigint as target_minor
    from jsonb_array_elements(v_group_targets) g where (g->>'isResidual')::boolean is not true
  ) group_target
  left join (
    select tr.group_id, sum((rt->>'amountMinor')::bigint) as root_total
    from jsonb_array_elements(v_canonical_roots) rt
    join public.allocation_template_roots tr
      on tr.template_id = p_template_revision_id and tr.category_id = (rt->>'categoryId')::uuid
    group by tr.group_id
  ) mapped on mapped.group_id = group_target.group_id
  where coalesce(mapped.root_total, 0) > group_target.target_minor;
  if v_over_target_groups <> 0 then
    raise exception using errcode='P0001', message='the requested root targets exceed their spending group target';
  end if;

  select coalesce(summary.actual_repayment_minor, 0), coalesce(summary.remaining_reservation_minor, 0)
    into v_loan_actual, v_loan_remaining
    from public.loan_monthly_currency_summary(p_space_id, v_month) as summary
    where summary.currency = p_currency;
  v_loan_actual := coalesce(v_loan_actual, 0);
  v_loan_remaining := coalesce(v_loan_remaining, 0);
  if p_loan_group_id is not null then
    select (g->>'targetMinor')::bigint into v_loan_group_target
      from jsonb_array_elements(v_group_targets) g where (g->>'groupId')::uuid = p_loan_group_id;
    select purpose into v_loan_group_purpose from public.allocation_groups
      where id = p_loan_group_id and space_id = p_space_id and currency = p_currency;
    if v_loan_group_target is null or v_loan_group_purpose is distinct from 'future' then
      raise exception using errcode='P0001', message='the loan pool group must be an included Future group';
    end if;
    if v_loan_actual + v_loan_remaining > v_loan_group_target then
      raise exception using errcode='P0001', message='the observed loan commitment does not fit its linked Future group';
    end if;
  end if;

  -- Every goal target linked to a group must target an included Future
  -- group, and debt commitment plus goal targets together must not exceed
  -- that group's own target.
  for v_entry in select value from jsonb_array_elements(v_canonical_goals) loop
    if v_entry->>'groupId' is null then
      continue;
    end if;
    if not exists (
      select 1 from jsonb_array_elements(v_group_targets) g
      where (g->>'groupId')::uuid = (v_entry->>'groupId')::uuid and (g->>'isResidual')::boolean is not true
    ) then
      raise exception using errcode='P0001', message='a goal target must link to an included group';
    end if;
    select purpose into v_loan_group_purpose from public.allocation_groups
      where id = (v_entry->>'groupId')::uuid and space_id = p_space_id and currency = p_currency;
    if v_loan_group_purpose is distinct from 'future' then
      raise exception using errcode='P0001', message='a goal target must link to a Future group';
    end if;
  end loop;

  select count(*) into v_over_target_goal_groups
  from (
    select (g->>'groupId')::uuid as group_id, (g->>'targetMinor')::bigint as target_minor
    from jsonb_array_elements(v_group_targets) g where (g->>'isResidual')::boolean is not true
  ) group_target
  left join (
    select (gt->>'groupId')::uuid as group_id, sum((gt->>'amountMinor')::bigint) as goal_total
    from jsonb_array_elements(v_canonical_goals) gt where gt->>'groupId' is not null
    group by (gt->>'groupId')::uuid
  ) goal_sum on goal_sum.group_id = group_target.group_id
  where coalesce(goal_sum.goal_total, 0)
    + (case when group_target.group_id = p_loan_group_id then v_loan_actual + v_loan_remaining else 0 end)
    > group_target.target_minor;
  if v_over_target_goal_groups <> 0 then
    raise exception using errcode='P0001', message='the requested goal targets and debt commitment exceed their Future group target';
  end if;

  v_income_child_request := private.planning_child_request(p_request_id, 'income:' || p_currency::text || ':' || v_month::text);
  select id, month_start into v_income_id, v_income_month
    from public.set_monthly_income_plan(p_space_id, v_income_child_request, v_month, p_currency, v_income_minor::text, p_expected_income_revision_id);

  insert into public.allocation_month_snapshots (
    space_id, currency, month_start, template_revision_id, income_plan_revision_id, expected_snapshot_id,
    base_income_minor, unallocated_minor, group_count, root_count, loan_line_count, goal_line_count, request_id, actor_id
  ) values (
    p_space_id, p_currency, v_month, p_template_revision_id, v_income_id, p_expected_snapshot_id,
    v_income_minor,
    (select coalesce((g->>'targetMinor')::bigint, 0) from jsonb_array_elements(v_group_targets) g where (g->>'isResidual')::boolean is true),
    (select count(*) from jsonb_array_elements(v_group_targets) g where (g->>'isResidual')::boolean is not true),
    jsonb_array_length(v_canonical_roots), 1, jsonb_array_length(v_canonical_goals), p_request_id, v_actor
  ) returning id into v_snapshot_id;

  insert into public.allocation_month_groups (snapshot_id, group_id, space_id, currency, name_en, name_ar, purpose, display_order, basis_points, target_minor)
  select v_snapshot_id, line.group_id, p_space_id, p_currency, line.name_en, line.name_ar, grp.purpose, line.display_order, line.basis_points,
    (select (g->>'targetMinor')::bigint from jsonb_array_elements(v_group_targets) g where (g->>'groupId')::uuid = line.group_id)
  from public.allocation_template_lines line
  join public.allocation_groups grp on grp.id = line.group_id and grp.space_id = p_space_id
  where line.template_id = p_template_revision_id;

  for v_entry in select value from jsonb_array_elements(v_canonical_roots) loop
    v_category_id := (v_entry->>'categoryId')::uuid;
    v_expected_revision_id := nullif(v_entry->>'expectedRevisionId', '')::bigint;
    v_child_request := private.planning_child_request(p_request_id, 'category:' || v_category_id::text || ':' || p_currency::text || ':' || v_month::text);
    select id into v_root_revision_id from public.set_monthly_category_target(
      p_space_id, v_child_request, v_category_id, v_month, p_currency, v_entry->>'amountMinor', v_expected_revision_id
    );
    insert into public.allocation_month_roots (snapshot_id, category_id, group_id, space_id, currency, target_revision_id, target_minor)
    values (
      v_snapshot_id, v_category_id,
      (select template_root.group_id from public.allocation_template_roots template_root
        where template_root.template_id = p_template_revision_id and template_root.category_id = v_category_id),
      p_space_id, p_currency, v_root_revision_id, (v_entry->>'amountMinor')::bigint
    );
  end loop;

  for v_entry in select value from jsonb_array_elements(v_canonical_goals) loop
    v_goal_id := (v_entry->>'goalId')::uuid;
    v_expected_revision_id := nullif(v_entry->>'expectedRevisionId', '')::bigint;
    v_child_request := private.planning_child_request(p_request_id, 'goal:' || v_goal_id::text || ':' || p_currency::text || ':' || v_month::text);
    v_goal_revision_id := (public.set_goal_monthly_target(
      p_space_id, v_child_request, v_goal_id, v_month, v_entry->>'amountMinor', v_expected_revision_id
    )->>'revisionId')::bigint;
    insert into public.allocation_month_goal_lines (snapshot_id, goal_id, space_id, currency, month_start, group_id, target_revision_id, amount_minor)
    values (
      v_snapshot_id, v_goal_id, p_space_id, p_currency, v_month,
      nullif(v_entry->>'groupId', '')::uuid, v_goal_revision_id, (v_entry->>'amountMinor')::bigint
    );
  end loop;

  insert into public.allocation_month_commitments (snapshot_id, space_id, currency, group_id, source_kind, observed_actual_minor, observed_remaining_minor)
  values (v_snapshot_id, p_space_id, p_currency, p_loan_group_id, 'loan_pool', v_loan_actual, v_loan_remaining);

  v_result := jsonb_build_object('snapshotId', v_snapshot_id::text, 'incomeRevisionId', v_income_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'publish_allocation_month_v2', v_fingerprint, v_actor, v_result);

  return v_result;
end;
$_$;


ALTER FUNCTION public.publish_allocation_month_v2(p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code, p_expected_snapshot_id bigint, p_template_revision_id bigint, p_expected_income_revision_id bigint, p_income_minor text, p_root_targets jsonb, p_loan_group_id uuid, p_goal_targets jsonb) OWNER TO postgres;

--
-- Name: record_cash_loan(uuid, uuid, public.loan_direction, text, public.currency_code, uuid, text, date, date, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.record_cash_loan(p_space_id uuid, p_request_id uuid, p_direction public.loan_direction, p_person_name text, p_currency public.currency_code, p_wallet_id uuid, p_amount_minor text, p_effective_date date, p_due_date date DEFAULT NULL::date, p_note text DEFAULT NULL::text) RETURNS TABLE(loan_id uuid, event_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_amount_minor bigint;
  v_wallet_currency public.currency_code;
  v_kind public.financial_event_kind;
  v_wallet_delta bigint;
  v_fingerprint bytea;
  v_existing_fingerprint bytea;
  v_existing_loan_id uuid;
  v_existing_event_id uuid;
  v_loan_id uuid;
  v_event_id uuid;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  if char_length(btrim(p_person_name)) not between 1 and 120
    or (p_note is not null and char_length(p_note) > 2_000)
    or (p_due_date is not null and p_due_date < p_effective_date) then
    raise exception using errcode = 'P0001', message = 'the loan details are invalid';
  end if;

  v_amount_minor := private.parse_positive_minor_amount(p_amount_minor);

  select wallet.currency
  into v_wallet_currency
  from public.wallets as wallet
  where wallet.id = p_wallet_id
    and wallet.space_id = p_space_id
    and wallet.archived_at is null;

  if not found or v_wallet_currency <> p_currency then
    raise exception using errcode = 'P0001', message = 'the wallet must be active, in the requested space, and in the loan currency';
  end if;

  if p_direction = 'they_owe_me' then
    v_kind := 'loan_lend';
    v_wallet_delta := -v_amount_minor;
  else
    v_kind := 'loan_borrow';
    v_wallet_delta := v_amount_minor;
  end if;

  v_fingerprint := extensions.digest(
    'cash_loan|' || p_direction::text || '|' || btrim(p_person_name) || '|'
      || p_currency::text || '|' || p_wallet_id::text || '|' || p_amount_minor || '|'
      || p_effective_date::text || '|' || coalesce(p_due_date::text, '') || '|'
      || coalesce(p_note, ''),
    'sha256'
  );
  perform private.lock_financial_request(p_space_id, p_request_id);

  select event.request_fingerprint, posting.loan_id, event.id
  into v_existing_fingerprint, v_existing_loan_id, v_existing_event_id
  from public.financial_events as event
  left join public.loan_postings as posting on posting.event_id = event.id
  where event.space_id = p_space_id
    and event.request_id = p_request_id;

  if found then
    if v_existing_fingerprint <> v_fingerprint or v_existing_loan_id is null then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_existing_loan_id, v_existing_event_id;
    return;
  end if;

  insert into public.loans (
    space_id, direction, person_name, currency, effective_date, due_date, note, actor_id
  )
  values (
    p_space_id, p_direction, btrim(p_person_name), p_currency, p_effective_date,
    p_due_date, p_note, v_actor_id
  )
  returning id into v_loan_id;

  insert into public.financial_events (
    space_id, request_id, request_fingerprint, kind, effective_date, actor_id
  )
  values (p_space_id, p_request_id, v_fingerprint, v_kind, p_effective_date, v_actor_id)
  returning id into v_event_id;

  insert into public.wallet_movements (event_id, space_id, wallet_id, amount_minor)
  values (v_event_id, p_space_id, p_wallet_id, v_wallet_delta);

  insert into public.loan_postings (event_id, loan_id, space_id, principal_delta_minor)
  values (v_event_id, v_loan_id, p_space_id, v_amount_minor);

  return query select v_loan_id, v_event_id;
end;
$$;


ALTER FUNCTION public.record_cash_loan(p_space_id uuid, p_request_id uuid, p_direction public.loan_direction, p_person_name text, p_currency public.currency_code, p_wallet_id uuid, p_amount_minor text, p_effective_date date, p_due_date date, p_note text) OWNER TO postgres;

--
-- Name: record_categorized_financial_event(uuid, uuid, public.financial_event_kind, date, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.record_categorized_financial_event(p_space_id uuid, p_request_id uuid, p_kind public.financial_event_kind, p_effective_date date, p_movements jsonb, p_category_id uuid) RETURNS TABLE(id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_event_id uuid;
  v_existing_fingerprint bytea;
  v_fingerprint bytea;
  v_existing_category_id uuid;
  v_category_kind public.category_kind;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  if p_kind is null or p_effective_date is null or p_movements is null or p_category_id is null then
    raise exception using errcode = 'P0001', message = 'event kind, effective date, movements, and category are required';
  end if;

  if p_kind not in ('income', 'expense') then
    raise exception using errcode = 'P0001', message = 'only income and expense events may be categorized';
  end if;

  if pg_catalog.jsonb_typeof(p_movements) <> 'array'
    or pg_catalog.jsonb_array_length(p_movements) not between 1 and 20 then
    raise exception using errcode = 'P0001', message = 'movements must contain between one and twenty entries';
  end if;

  v_fingerprint := extensions.digest(
    p_kind::text || '|' || p_effective_date::text || '|' || p_movements::text,
    'sha256'
  );
  perform private.lock_financial_request(p_space_id, p_request_id);

  select event.id, event.request_fingerprint, category.category_id
  into v_event_id, v_existing_fingerprint, v_existing_category_id
  from public.financial_events as event
  left join public.financial_event_categories as category on category.event_id = event.id
  where event.space_id = p_space_id
    and event.request_id = p_request_id;

  if found then
    if v_existing_fingerprint is distinct from v_fingerprint
      or v_existing_category_id is distinct from p_category_id then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_event_id;
    return;
  end if;

  select category.kind
  into v_category_kind
  from public.categories as category
  where category.id = p_category_id
    and category.space_id = p_space_id
    and category.kind::text = p_kind::text
    and category.archived_at is null
  for key share;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'the category must be active, in the requested space, and match the event kind';
  end if;

  select event.id
  into v_event_id
  from public.record_financial_event(
    p_space_id,
    p_request_id,
    p_kind,
    p_effective_date,
    p_movements
  ) as event;

  insert into public.financial_event_categories (
    event_id, space_id, event_kind, category_id, category_kind
  )
  values (
    v_event_id, p_space_id, p_kind, p_category_id, v_category_kind
  );

  return query select v_event_id;
end;
$$;


ALTER FUNCTION public.record_categorized_financial_event(p_space_id uuid, p_request_id uuid, p_kind public.financial_event_kind, p_effective_date date, p_movements jsonb, p_category_id uuid) OWNER TO postgres;

--
-- Name: record_financial_event(uuid, uuid, public.financial_event_kind, date, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.record_financial_event(p_space_id uuid, p_request_id uuid, p_kind public.financial_event_kind, p_effective_date date, p_movements jsonb) RETURNS TABLE(id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor_id uuid := auth.uid();
  v_event_id uuid;
  v_existing_fingerprint bytea;
  v_fingerprint bytea;
  v_input_count integer;
  v_valid_count integer;
  v_wallet_count integer;
  v_distinct_wallet_count integer;
  v_amount_total bigint;
  v_all_positive boolean;
  v_all_negative boolean;
  v_currency_count integer;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  if p_kind is null or p_effective_date is null or p_movements is null then
    raise exception using errcode = 'P0001', message = 'event kind, effective date, and movements are required';
  end if;

  if pg_catalog.jsonb_typeof(p_movements) <> 'array'
    or pg_catalog.jsonb_array_length(p_movements) not between 1 and 20 then
    raise exception using errcode = 'P0001', message = 'movements must contain between one and twenty entries';
  end if;

  v_fingerprint := extensions.digest(
    p_kind::text || '|' || p_effective_date::text || '|' || p_movements::text,
    'sha256'
  );
  perform private.lock_financial_request(p_space_id, p_request_id);

  select event.request_fingerprint, event.id
  into v_existing_fingerprint, v_event_id
  from public.financial_events as event
  where event.space_id = p_space_id
    and event.request_id = p_request_id;

  if found then
    if v_existing_fingerprint is distinct from v_fingerprint
      or exists (
        select 1
        from public.financial_event_categories as category
        where category.event_id = v_event_id
      ) then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_event_id;
    return;
  end if;

  with movement_input as (
    select
      case
        when pg_catalog.jsonb_typeof(entry) = 'object'
          and pg_catalog.jsonb_typeof(entry -> 'walletId') = 'string'
          and (entry ->> 'walletId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (entry ->> 'walletId')::uuid
      end as wallet_id,
      case
        when pg_catalog.jsonb_typeof(entry) = 'object'
          and pg_catalog.jsonb_typeof(entry -> 'amountMinor') = 'string'
          and (entry ->> 'amountMinor') ~ '^-?[1-9][0-9]{0,14}$'
        then (entry ->> 'amountMinor')::bigint
      end as amount_minor
    from pg_catalog.jsonb_array_elements(p_movements) as entry
  )
  select
    pg_catalog.count(*),
    pg_catalog.count(*) filter (where input.wallet_id is not null and input.amount_minor is not null),
    pg_catalog.count(wallet.id),
    pg_catalog.count(distinct input.wallet_id),
    coalesce(pg_catalog.sum(input.amount_minor), 0),
    pg_catalog.bool_and(input.amount_minor > 0),
    pg_catalog.bool_and(input.amount_minor < 0),
    pg_catalog.count(distinct wallet.currency)
  into
    v_input_count,
    v_valid_count,
    v_wallet_count,
    v_distinct_wallet_count,
    v_amount_total,
    v_all_positive,
    v_all_negative,
    v_currency_count
  from movement_input as input
  left join public.wallets as wallet
    on wallet.id = input.wallet_id
   and wallet.space_id = p_space_id
   and wallet.archived_at is null;

  if v_valid_count <> v_input_count
    or v_wallet_count <> v_input_count
    or v_distinct_wallet_count <> v_input_count then
    raise exception using
      errcode = 'P0001',
      message = 'every movement must contain a unique active wallet and a bounded nonzero minor-unit amount';
  end if;

  if (p_kind = 'opening_balance' and not (v_input_count = 1 and v_all_positive))
    or (p_kind = 'income' and not v_all_positive)
    or (p_kind = 'expense' and not v_all_negative)
    or (p_kind = 'transfer' and not (v_input_count >= 2 and v_amount_total = 0 and v_currency_count = 1))
    or p_kind not in ('opening_balance', 'income', 'expense', 'transfer') then
    raise exception using errcode = 'P0001', message = 'the requested event kind has an invalid movement shape';
  end if;

  insert into public.financial_events (
    space_id, request_id, request_fingerprint, kind, effective_date, actor_id
  )
  values (p_space_id, p_request_id, v_fingerprint, p_kind, p_effective_date, v_actor_id)
  returning financial_events.id into v_event_id;

  insert into public.wallet_movements (event_id, space_id, wallet_id, amount_minor)
  select
    v_event_id,
    p_space_id,
    (entry ->> 'walletId')::uuid,
    (entry ->> 'amountMinor')::bigint
  from pg_catalog.jsonb_array_elements(p_movements) as entry;

  return query select v_event_id;
end;
$_$;


ALTER FUNCTION public.record_financial_event(p_space_id uuid, p_request_id uuid, p_kind public.financial_event_kind, p_effective_date date, p_movements jsonb) OWNER TO postgres;

--
-- Name: record_goal_earmark(uuid, uuid, uuid, text, text, text, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.record_goal_earmark(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_action text, p_amount_minor text, p_expected_head text, p_accept_underfunded boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_goal public.goals%rowtype;
  v_state text;
  v_target_minor bigint;
  v_amount_minor bigint;
  v_today date;
  v_earmarked numeric; v_fulfilled numeric; v_head text;
  v_max_reserve numeric;
  v_space_total numeric;
  v_cash_pool numeric;
  v_event_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_goal_id is null or p_action is null
    or p_amount_minor is null or p_expected_head is null or p_accept_underfunded is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_action not in ('reserve','release') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_expected_head !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_amount_minor := private.planning_minor(p_amount_minor, true);
  v_today := (now() at time zone 'UTC')::date;

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('record_goal_earmark', v_actor, jsonb_build_object(
    'goalId', p_goal_id, 'action', p_action, 'amountMinor', v_amount_minor::text,
    'expectedHead', p_expected_head, 'acceptUnderfunded', p_accept_underfunded
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'record_goal_earmark', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select * into v_goal from public.goals where id = p_goal_id and space_id = p_space_id;
  if not found then
    raise exception using errcode='P0001', message='the goal does not belong to the requested space';
  end if;
  select state, target_minor into v_state, v_target_minor from public.goal_revisions where goal_id = p_goal_id order by id desc limit 1;

  select earmarked_minor, fulfilled_minor, head into v_earmarked, v_fulfilled, v_head
    from private.goal_financing_state(p_goal_id, v_today);
  if v_head is distinct from p_expected_head then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  if p_action = 'reserve' then
    if v_state <> 'active' then
      raise exception using errcode='P0001', message='a reserve requires an active goal';
    end if;
    v_max_reserve := greatest(v_target_minor - v_earmarked - v_fulfilled, 0);
    if v_amount_minor > v_max_reserve then
      raise exception using errcode='P0001', message='the reserve exceeds the goal''s remaining room';
    end if;
    if not p_accept_underfunded then
      select coalesce(sum(t), 0) into v_space_total from (
        select private.goal_space_earmarked_total(p_space_id, v_goal.currency, v_today) as t
      ) totals;
      v_cash_pool := greatest(private.goal_cash_pool(p_space_id, v_goal.currency, v_today), 0);
      if v_space_total + v_amount_minor > v_cash_pool then
        raise exception using errcode='22023', message='goal_underfunded_confirmation_required';
      end if;
    end if;
    insert into public.goal_earmark_events (space_id, currency, operation, line_count, request_id, actor_id)
      values (p_space_id, v_goal.currency, 'reserve', 1, p_request_id, v_actor) returning id into v_event_id;
    insert into public.goal_earmark_lines (event_id, goal_id, space_id, currency, amount_minor)
      values (v_event_id, p_goal_id, p_space_id, v_goal.currency, v_amount_minor);
  else
    if v_amount_minor > v_earmarked then
      raise exception using errcode='P0001', message='the release exceeds the goal''s current earmark';
    end if;
    insert into public.goal_earmark_events (space_id, currency, operation, line_count, request_id, actor_id)
      values (p_space_id, v_goal.currency, 'release', 1, p_request_id, v_actor) returning id into v_event_id;
    insert into public.goal_earmark_lines (event_id, goal_id, space_id, currency, amount_minor)
      values (v_event_id, p_goal_id, p_space_id, v_goal.currency, -v_amount_minor);
  end if;

  v_result := jsonb_build_object('eventId', v_event_id::text, 'goalId', p_goal_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'record_goal_earmark', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$_$;


ALTER FUNCTION public.record_goal_earmark(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_action text, p_amount_minor text, p_expected_head text, p_accept_underfunded boolean) OWNER TO postgres;

--
-- Name: record_loan_repayment(uuid, uuid, uuid, uuid, text, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.record_loan_repayment(p_space_id uuid, p_request_id uuid, p_loan_id uuid, p_wallet_id uuid, p_amount_minor text, p_effective_date date) RETURNS TABLE(event_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_direction public.loan_direction;
  v_currency public.currency_code;
  v_wallet_currency public.currency_code;
  v_amount_minor bigint;
  v_outstanding_minor bigint;
  v_kind public.financial_event_kind;
  v_wallet_delta bigint;
  v_fingerprint bytea;
  v_existing_fingerprint bytea;
  v_existing_event_id uuid;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  v_amount_minor := private.parse_positive_minor_amount(p_amount_minor);
  perform private.lock_financial_request(p_space_id, p_request_id);

  select loan.direction, loan.currency
  into v_direction, v_currency
  from public.loans as loan
  where loan.id = p_loan_id
    and loan.space_id = p_space_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'the loan does not belong to the requested space';
  end if;

  if v_direction = 'they_owe_me' then
    v_kind := 'loan_receive_repayment';
    v_wallet_delta := v_amount_minor;
  else
    v_kind := 'loan_repay_borrowing';
    v_wallet_delta := -v_amount_minor;
  end if;

  v_fingerprint := extensions.digest(
    'loan_repayment|' || p_loan_id::text || '|' || p_wallet_id::text || '|'
      || p_amount_minor || '|' || p_effective_date::text,
    'sha256'
  );

  select event.request_fingerprint, event.id
  into v_existing_fingerprint, v_existing_event_id
  from public.financial_events as event
  where event.space_id = p_space_id
    and event.request_id = p_request_id;

  if found then
    if v_existing_fingerprint <> v_fingerprint then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_existing_event_id;
    return;
  end if;

  select wallet.currency
  into v_wallet_currency
  from public.wallets as wallet
  where wallet.id = p_wallet_id
    and wallet.space_id = p_space_id
    and wallet.archived_at is null;

  if not found or v_wallet_currency <> v_currency then
    raise exception using errcode = 'P0001', message = 'the wallet must be active, in the requested space, and in the loan currency';
  end if;

  select coalesce(sum(posting.principal_delta_minor), 0)
  into v_outstanding_minor
  from public.loan_postings as posting
  where posting.loan_id = p_loan_id;

  if v_amount_minor > v_outstanding_minor then
    raise exception using errcode = 'P0001', message = 'the repayment exceeds the outstanding principal';
  end if;

  insert into public.financial_events (
    space_id, request_id, request_fingerprint, kind, effective_date, actor_id
  )
  values (p_space_id, p_request_id, v_fingerprint, v_kind, p_effective_date, v_actor_id)
  returning id into v_existing_event_id;

  insert into public.wallet_movements (event_id, space_id, wallet_id, amount_minor)
  values (v_existing_event_id, p_space_id, p_wallet_id, v_wallet_delta);

  insert into public.loan_postings (
    event_id, loan_id, space_id, principal_delta_minor, repayment_effect_minor
  )
  values (v_existing_event_id, p_loan_id, p_space_id, -v_amount_minor, v_amount_minor);

  return query select v_existing_event_id;
end;
$$;


ALTER FUNCTION public.record_loan_repayment(p_space_id uuid, p_request_id uuid, p_loan_id uuid, p_wallet_id uuid, p_amount_minor text, p_effective_date date) OWNER TO postgres;

--
-- Name: record_usd_to_lbp_exchange(uuid, uuid, uuid, uuid, text, text, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.record_usd_to_lbp_exchange(p_space_id uuid, p_request_id uuid, p_usd_wallet_id uuid, p_lbp_wallet_id uuid, p_usd_amount_minor text, p_lbp_amount_minor text, p_effective_date date) RETURNS TABLE(id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor_id uuid := auth.uid();
  v_event_id uuid;
  v_existing_fingerprint bytea;
  v_fingerprint bytea;
  v_usd_wallet public.wallets;
  v_lbp_wallet public.wallets;
  v_usd_amount_minor bigint;
  v_lbp_amount_minor bigint;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  if p_request_id is null
    or p_usd_wallet_id is null
    or p_lbp_wallet_id is null
    or p_effective_date is null
    or p_usd_amount_minor is null
    or p_lbp_amount_minor is null then
    raise exception using errcode = 'P0001', message = 'exchange request, wallets, amounts, and effective date are required';
  end if;

  if p_usd_wallet_id = p_lbp_wallet_id
    or p_usd_amount_minor !~ '^[1-9][0-9]{0,14}$'
    or p_lbp_amount_minor !~ '^[1-9][0-9]{0,14}$' then
    raise exception using errcode = 'P0001', message = 'exchange wallets must differ and amounts must be bounded positive minor-unit integers';
  end if;

  v_usd_amount_minor := p_usd_amount_minor::bigint;
  v_lbp_amount_minor := p_lbp_amount_minor::bigint;
  v_fingerprint := extensions.digest(
    pg_catalog.jsonb_build_object(
      'version', 1,
      'command', 'usd_to_lbp_exchange',
      'usdWalletId', p_usd_wallet_id,
      'lbpWalletId', p_lbp_wallet_id,
      'usdAmountMinor', p_usd_amount_minor,
      'lbpAmountMinor', p_lbp_amount_minor,
      'effectiveDate', p_effective_date
    )::text,
    'sha256'
  );
  perform private.lock_financial_request(p_space_id, p_request_id);

  select event.id, event.request_fingerprint
  into v_event_id, v_existing_fingerprint
  from public.financial_events as event
  where event.space_id = p_space_id
    and event.request_id = p_request_id;

  if found then
    if v_existing_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_event_id;
    return;
  end if;

  select wallet.*
  into v_usd_wallet
  from public.wallets as wallet
  where wallet.id = p_usd_wallet_id
    and wallet.space_id = p_space_id
    and wallet.archived_at is null
  for update;

  select wallet.*
  into v_lbp_wallet
  from public.wallets as wallet
  where wallet.id = p_lbp_wallet_id
    and wallet.space_id = p_space_id
    and wallet.archived_at is null
  for update;

  if v_usd_wallet.id is null
    or v_lbp_wallet.id is null
    or v_usd_wallet.currency <> 'USD'
    or v_lbp_wallet.currency <> 'LBP' then
    raise exception using errcode = 'P0001', message = 'the exchange requires active USD source and LBP destination wallets in the requested space';
  end if;

  insert into public.financial_events (
    space_id, request_id, request_fingerprint, kind, effective_date, actor_id
  )
  values (
    p_space_id, p_request_id, v_fingerprint, 'exchange', p_effective_date, v_actor_id
  )
  returning financial_events.id into v_event_id;

  insert into public.wallet_movements (event_id, space_id, wallet_id, amount_minor)
  values
    (v_event_id, p_space_id, p_usd_wallet_id, -v_usd_amount_minor),
    (v_event_id, p_space_id, p_lbp_wallet_id, v_lbp_amount_minor);

  return query select v_event_id;
end;
$_$;


ALTER FUNCTION public.record_usd_to_lbp_exchange(p_space_id uuid, p_request_id uuid, p_usd_wallet_id uuid, p_lbp_wallet_id uuid, p_usd_amount_minor text, p_lbp_amount_minor text, p_effective_date date) OWNER TO postgres;

--
-- Name: remove_household_member(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.remove_household_member(p_space_id uuid, p_request_id uuid, p_member_user_id uuid) RETURNS TABLE(user_id uuid, status public.membership_status)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_actor_id uuid := private.household_actor_user_id();
  v_fingerprint bytea;
  v_event public.household_membership_events%rowtype;
  v_membership public.space_memberships%rowtype;
  v_space_kind public.space_kind;
  v_now timestamptz := now();
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_space_id is null or p_request_id is null or p_member_user_id is null
    or p_member_user_id = v_actor_id then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  v_fingerprint := private.household_command_fingerprint(
    'remove_household_member|' || p_space_id::text || '|' || p_member_user_id::text
  );
  perform private.lock_household_request(v_actor_id, p_request_id);
  select event.* into v_event
  from public.household_membership_events as event
  where event.actor_user_id = v_actor_id and event.request_id = p_request_id;
  if found then
    if v_event.kind <> 'member_removed'
      or v_event.request_fingerprint <> v_fingerprint
      or v_event.subject_user_id <> p_member_user_id then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;
    return query select p_member_user_id, v_event.next_status;
    return;
  end if;
  v_space_kind := private.lock_household_space(p_space_id);
  if v_space_kind is null then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;
  if v_space_kind <> 'household' then
    raise exception using errcode = 'P0001', message = 'personal_space_prohibited';
  end if;
  if not private.is_active_owner(p_space_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;
  select membership.* into v_membership
  from public.space_memberships as membership
  where membership.space_id = p_space_id and membership.user_id = p_member_user_id
  for update;
  if not found or v_membership.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'membership_not_active';
  end if;
  if v_membership.role = 'owner'
    and (select count(*) from public.space_memberships as owner_membership
         where owner_membership.space_id = p_space_id
           and owner_membership.status = 'active'
           and owner_membership.role = 'owner') <= 1 then
    raise exception using errcode = 'P0001', message = 'last_owner';
  end if;
  update public.space_memberships
  set status = 'revoked', ended_at = v_now, ended_by_user_id = v_actor_id
  where space_id = p_space_id and space_memberships.user_id = p_member_user_id;
  insert into public.household_membership_events (
    space_id, actor_user_id, subject_user_id, request_id, request_fingerprint,
    kind, prior_status, next_status, prior_role, next_role, occurred_at
  ) values (
    p_space_id, v_actor_id, p_member_user_id, p_request_id, v_fingerprint,
    'member_removed', 'active', 'revoked', v_membership.role, v_membership.role, v_now
  );
  return query select p_member_user_id, 'revoked'::public.membership_status;
end;
$$;


ALTER FUNCTION public.remove_household_member(p_space_id uuid, p_request_id uuid, p_member_user_id uuid) OWNER TO postgres;

--
-- Name: rename_wallet(uuid, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.rename_wallet(p_space_id uuid, p_request_id uuid, p_wallet_id uuid, p_name text) RETURNS TABLE(id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor_id uuid;
  v_name text := pg_catalog.btrim(p_name);
  v_fingerprint bytea;
  v_wallet public.wallets;
begin
  v_actor_id := private.require_wallet_command_actor(p_space_id, p_request_id, p_wallet_id);
  v_fingerprint := extensions.digest(
    pg_catalog.jsonb_build_object(
      'version', 1,
      'command', 'rename_wallet',
      'walletId', p_wallet_id,
      'name', v_name
    )::text,
    'sha256'
  );

  if private.replay_wallet_command(p_space_id, p_request_id, 'rename_wallet', v_fingerprint, p_wallet_id) then
    return query select p_wallet_id;
    return;
  end if;

  v_wallet := private.lock_space_wallet(p_space_id, p_wallet_id);

  if v_wallet.archived_at is not null then
    raise exception using errcode = 'P0001', message = 'the wallet is archived';
  end if;

  if v_name is null or pg_catalog.char_length(v_name) not between 1 and 120 then
    raise exception using errcode = 'P0001', message = 'the wallet name must be 1 to 120 characters';
  end if;

  if v_name = v_wallet.name then
    raise exception using errcode = 'P0001', message = 'the wallet already has this name';
  end if;

  update public.wallets as wallet
  set name = v_name
  where wallet.id = p_wallet_id;

  insert into public.wallet_command_requests (
    space_id, request_id, command_kind, request_fingerprint, wallet_id, actor_id, previous_name, name
  )
  values (
    p_space_id, p_request_id, 'rename_wallet', v_fingerprint, p_wallet_id, v_actor_id, v_wallet.name, v_name
  );

  return query select p_wallet_id;
end;
$$;


ALTER FUNCTION public.rename_wallet(p_space_id uuid, p_request_id uuid, p_wallet_id uuid, p_name text) OWNER TO postgres;

--
-- Name: report_category_actual_vs_budget(uuid, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.report_category_actual_vs_budget(p_space_id uuid, p_month date) RETURNS TABLE(category_key text, category_name_en text, category_name_ar text, category_kind public.category_kind, currency public.currency_code, actual_net_minor bigint, budget_minor bigint, remaining_minor bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_start date;
  v_end date;
begin
  if p_space_id is null or p_month is null or p_month <> date_trunc('month', p_month)::date or not private.is_active_member(p_space_id) then raise exception using errcode='42501', message='an active space membership and normalized month are required'; end if;
  select bounds.period_start, bounds.period_end into v_start, v_end
  from public.space_period_bounds(p_space_id, p_month) bounds;
  return query with current_targets as (
    select distinct on (revision.space_id, revision.category_id, revision.currency) revision.category_id, revision.currency, revision.amount_minor
    from public.monthly_budget_plan_revisions revision where revision.space_id=p_space_id and revision.plan_kind='expense_category' and revision.month_start=p_month order by revision.space_id, revision.category_id, revision.currency, revision.id desc
  ), actuals as (
    -- Roll a subcategory's spend into its root: association.category_id names
    -- the exact tagged category, but the target lives on the root, so group by
    -- coalesce(tagged.parent_category_id, tagged.id) instead of the tagged id.
    -- movement.amount_minor is already correctly signed for a reversal, so a
    -- single -sum(...) nets it, matching monthly_budget_currency_summary.
    select coalesce(root.id::text, 'uncategorized:expense') key, root.id as category_id, wallet.currency, (-sum(movement.amount_minor))::bigint amount
    from public.financial_events event join public.wallet_movements movement on movement.event_id=event.id and movement.space_id=p_space_id join public.wallets wallet on wallet.id=movement.wallet_id and wallet.space_id=p_space_id
    left join public.financial_event_categories category on category.event_id=event.id and category.space_id=p_space_id
    left join public.categories tagged on tagged.id=category.category_id and tagged.space_id=p_space_id
    left join public.categories root on root.id=coalesce(tagged.parent_category_id, tagged.id) and root.space_id=p_space_id
    left join public.financial_events original on original.id=event.reversal_of and original.space_id=p_space_id
    where event.space_id=p_space_id and event.effective_date >= v_start and event.effective_date < v_end and coalesce(original.kind,event.kind)='expense'
    group by coalesce(root.id::text, 'uncategorized:expense'), root.id, wallet.currency
  -- Bare "currency" here is ambiguous against the function's own OUT
  -- parameter of the same name; every reference must be CTE-qualified.
  ), keys as (select category_id, current_targets.currency from current_targets union select category_id, actuals.currency from actuals)
  select coalesce(category.id::text, 'uncategorized:expense'), category.name_en, category.name_ar, coalesce(category.kind, 'expense'::public.category_kind), keys.currency,
    coalesce(actuals.amount,0), coalesce(current_targets.amount_minor,0), coalesce(current_targets.amount_minor,0)-coalesce(actuals.amount,0)
  from keys left join public.categories category on category.id=keys.category_id and category.space_id=p_space_id left join current_targets on current_targets.category_id is not distinct from keys.category_id and current_targets.currency=keys.currency left join actuals on actuals.category_id is not distinct from keys.category_id and actuals.currency=keys.currency
  order by category.name_en nulls last, category.id, keys.currency;
end; $$;


ALTER FUNCTION public.report_category_actual_vs_budget(p_space_id uuid, p_month date) OWNER TO postgres;

--
-- Name: report_monthly_cash_summary(uuid, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.report_monthly_cash_summary(p_space_id uuid, p_anchor_month date) RETURNS TABLE(period_month date, period_role text, currency public.currency_code, income_net_minor bigint, expense_net_minor bigint, wallet_delta_net_minor bigint)
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  v_current_start date;
  v_current_end date;
  v_previous_start date;
begin
  if p_space_id is null or p_anchor_month is null or p_anchor_month <> date_trunc('month', p_anchor_month)::date or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership and normalized month are required';
  end if;
  select bounds.period_start, bounds.period_end into v_current_start, v_current_end
  from public.space_period_bounds(p_space_id, p_anchor_month) bounds;
  select bounds.period_start into v_previous_start
  from public.space_period_bounds(p_space_id, (date_trunc('month', p_anchor_month) - interval '1 month')::date) bounds;
  return query
  with periods as (
    select v_previous_start as period_start, v_current_start as period_end, 'previous'::text as role
    union all
    select v_current_start, v_current_end, 'current'
  ),
  dimensions as (select periods.period_start, periods.period_end, periods.role, currency.value::public.currency_code currency from periods cross join (values ('USD'), ('LBP')) currency(value)),
  movements as (
    select event.effective_date, wallet.currency, event.kind, event.reversal_of, movement.amount_minor
    from public.financial_events event join public.wallet_movements movement on movement.event_id = event.id and movement.space_id = p_space_id
    join public.wallets wallet on wallet.id = movement.wallet_id and wallet.space_id = p_space_id
    where event.space_id = p_space_id and event.effective_date >= v_previous_start and event.effective_date < v_current_end
  ), normalized as (
    -- movement.amount_minor is already correctly signed for a reversal (it is
    -- the negation of the original movement); re-negating it here undid the
    -- cancellation and doubled the reversed amount instead of netting it.
    select movement.*, coalesce(original.kind, movement.kind) semantic_kind, movement.amount_minor as normalized_amount
    from movements movement left join public.financial_events original on original.id = movement.reversal_of and original.space_id = p_space_id
  )
  select dimensions.period_start, dimensions.role, dimensions.currency,
    coalesce(sum(case when normalized.semantic_kind = 'income' then normalized.normalized_amount else 0 end), 0)::bigint,
    coalesce(sum(case when normalized.semantic_kind = 'expense' then -normalized.normalized_amount else 0 end), 0)::bigint,
    coalesce(sum(normalized.amount_minor), 0)::bigint
  from dimensions left join normalized on normalized.currency = dimensions.currency and normalized.effective_date >= dimensions.period_start and normalized.effective_date < dimensions.period_end
  group by dimensions.period_start, dimensions.role, dimensions.currency order by dimensions.period_start, dimensions.currency;
end; $$;


ALTER FUNCTION public.report_monthly_cash_summary(p_space_id uuid, p_anchor_month date) OWNER TO postgres;

--
-- Name: report_wallet_activity(uuid, date, date, uuid, public.currency_code, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.report_wallet_activity(p_space_id uuid, p_from_date date, p_to_date date, p_wallet_id uuid DEFAULT NULL::uuid, p_currency public.currency_code DEFAULT NULL::public.currency_code, p_event_limit integer DEFAULT 50) RETURNS TABLE(event_id uuid, kind public.financial_event_kind, effective_date date, created_at timestamp with time zone, reversal_of uuid, wallet_id uuid, wallet_name text, currency public.currency_code, amount_minor bigint, has_more boolean)
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
begin
  if p_space_id is null or p_from_date is null or p_to_date is null or p_to_date <= p_from_date or p_to_date > p_from_date + 366 or p_event_limit is null or p_event_limit not between 1 and 100 or not private.is_active_member(p_space_id) then raise exception using errcode = '42501', message = 'a visible space and bounded report window are required'; end if;
  if p_wallet_id is not null and not exists (select 1 from public.wallets where id=p_wallet_id and space_id=p_space_id) then raise exception using errcode='42501', message='the requested wallet is not visible in this space'; end if;
  if p_wallet_id is not null and p_currency is not null and not exists (select 1 from public.wallets where id=p_wallet_id and space_id=p_space_id and currency=p_currency) then raise exception using errcode='P0001', message='wallet currency does not match the requested currency'; end if;
  return query with selected as (
    select event.id from public.financial_events event where event.space_id=p_space_id and event.effective_date >= p_from_date and event.effective_date < p_to_date
      and (p_wallet_id is null or exists (select 1 from public.wallet_movements m where m.event_id=event.id and m.wallet_id=p_wallet_id and m.space_id=p_space_id))
    order by event.effective_date desc, event.created_at desc, event.id desc limit p_event_limit + 1
  ), visible as (select id from selected limit p_event_limit), more as (select count(*) > p_event_limit has_more from selected)
  select event.id, event.kind, event.effective_date, event.created_at, event.reversal_of, wallet.id, wallet.name, wallet.currency, movement.amount_minor, more.has_more
  from visible join public.financial_events event on event.id=visible.id and event.space_id=p_space_id join public.wallet_movements movement on movement.event_id=event.id and movement.space_id=p_space_id join public.wallets wallet on wallet.id=movement.wallet_id and wallet.space_id=p_space_id cross join more
  where (p_wallet_id is null or wallet.id=p_wallet_id) and (p_currency is null or wallet.currency=p_currency)
  order by event.effective_date desc, event.created_at desc, event.id desc, wallet.id;
end; $$;


ALTER FUNCTION public.report_wallet_activity(p_space_id uuid, p_from_date date, p_to_date date, p_wallet_id uuid, p_currency public.currency_code, p_event_limit integer) OWNER TO postgres;

--
-- Name: restore_wallet(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.restore_wallet(p_space_id uuid, p_request_id uuid, p_wallet_id uuid) RETURNS TABLE(id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor_id uuid;
  v_fingerprint bytea;
  v_wallet public.wallets;
begin
  v_actor_id := private.require_wallet_command_actor(p_space_id, p_request_id, p_wallet_id);
  v_fingerprint := extensions.digest(
    pg_catalog.jsonb_build_object('version', 1, 'command', 'restore_wallet', 'walletId', p_wallet_id)::text,
    'sha256'
  );

  if private.replay_wallet_command(p_space_id, p_request_id, 'restore_wallet', v_fingerprint, p_wallet_id) then
    return query select p_wallet_id;
    return;
  end if;

  v_wallet := private.lock_space_wallet(p_space_id, p_wallet_id);

  if v_wallet.archived_at is null then
    raise exception using errcode = 'P0001', message = 'the wallet is not archived';
  end if;

  update public.wallets as wallet
  set archived_at = null
  where wallet.id = p_wallet_id;

  insert into public.wallet_command_requests (
    space_id, request_id, command_kind, request_fingerprint, wallet_id, actor_id
  )
  values (p_space_id, p_request_id, 'restore_wallet', v_fingerprint, p_wallet_id, v_actor_id);

  return query select p_wallet_id;
end;
$$;


ALTER FUNCTION public.restore_wallet(p_space_id uuid, p_request_id uuid, p_wallet_id uuid) OWNER TO postgres;

--
-- Name: reverse_financial_event(uuid, uuid, uuid, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.reverse_financial_event(p_space_id uuid, p_request_id uuid, p_event_id uuid, p_effective_date date) RETURNS TABLE(id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_event_id uuid;
  v_existing_fingerprint bytea;
  v_fingerprint bytea;
  v_original_kind public.financial_event_kind;
  v_loan_id uuid;
  v_principal_delta_minor bigint;
  v_repayment_effect_minor bigint;
  v_outstanding_minor bigint;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  if p_event_id is null or p_effective_date is null then
    raise exception using errcode = 'P0001', message = 'event ID and effective date are required';
  end if;

  v_fingerprint := extensions.digest(
    'reversal|' || p_event_id::text || '|' || p_effective_date::text,
    'sha256'
  );
  perform private.lock_financial_request(p_space_id, p_request_id);

  select event.id, event.request_fingerprint
  into v_event_id, v_existing_fingerprint
  from public.financial_events as event
  where event.space_id = p_space_id
    and event.request_id = p_request_id;

  if found then
    if v_existing_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_event_id;
    return;
  end if;

  select event.kind
  into v_original_kind
  from public.financial_events as event
  where event.id = p_event_id
    and event.space_id = p_space_id
  for update;

  if not found or v_original_kind = 'reversal' then
    raise exception using errcode = 'P0001', message = 'the requested event cannot be reversed';
  end if;

  if exists (
    select 1
    from public.financial_events as event
    where event.reversal_of = p_event_id
  ) then
    raise exception using errcode = 'P0001', message = 'the requested event already has a reversal';
  end if;

  select posting.loan_id, posting.principal_delta_minor, posting.repayment_effect_minor
  into v_loan_id, v_principal_delta_minor, v_repayment_effect_minor
  from public.loan_postings as posting
  where posting.event_id = p_event_id;

  if found then
    perform 1
    from public.loans as loan
    where loan.id = v_loan_id
    for update;

    select coalesce(pg_catalog.sum(posting.principal_delta_minor), 0)
    into v_outstanding_minor
    from public.loan_postings as posting
    where posting.loan_id = v_loan_id;

    if v_outstanding_minor - v_principal_delta_minor < 0 then
      raise exception using
        errcode = 'P0001',
        message = 'the correction would invalidate dependent repayments';
    end if;
  end if;

  insert into public.financial_events (
    space_id, request_id, request_fingerprint, kind, effective_date, actor_id, reversal_of
  )
  values (
    p_space_id, p_request_id, v_fingerprint, 'reversal', p_effective_date, v_actor_id, p_event_id
  )
  returning financial_events.id into v_event_id;

  insert into public.wallet_movements (event_id, space_id, wallet_id, amount_minor)
  select v_event_id, p_space_id, movement.wallet_id, -movement.amount_minor
  from public.wallet_movements as movement
  where movement.event_id = p_event_id;

  if v_loan_id is not null then
    insert into public.loan_postings (
      event_id, loan_id, space_id, principal_delta_minor, repayment_effect_minor
    )
    values (
      v_event_id,
      v_loan_id,
      p_space_id,
      -v_principal_delta_minor,
      -v_repayment_effect_minor
    );
  end if;

  insert into public.financial_event_categories (
    event_id, space_id, event_kind, category_id, category_kind
  )
  select
    v_event_id,
    p_space_id,
    'reversal',
    category.category_id,
    category.category_kind
  from public.financial_event_categories as category
  where category.event_id = p_event_id;

  return query select v_event_id;
end;
$$;


ALTER FUNCTION public.reverse_financial_event(p_space_id uuid, p_request_id uuid, p_event_id uuid, p_effective_date date) OWNER TO postgres;

--
-- Name: reverse_goal_earmark(uuid, uuid, bigint, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.reverse_goal_earmark(p_space_id uuid, p_request_id uuid, p_event_id bigint, p_expected_heads jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_original public.goal_earmark_events%rowtype;
  v_today date;
  v_entry jsonb;
  v_expected_goal_ids uuid[] := '{}';
  v_original_goal_ids uuid[];
  v_head text;
  v_new_event_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_event_id is null or p_expected_heads is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if jsonb_typeof(p_expected_heads) is distinct from 'array' or jsonb_array_length(p_expected_heads) not between 1 and 2 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  for v_entry in select value from jsonb_array_elements(p_expected_heads) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or (v_entry ?& array['goalId','head']) is not true or (v_entry - array['goalId','head']) <> '{}'::jsonb
      or jsonb_typeof(v_entry->'goalId') is distinct from 'string'
      or (v_entry->>'goalId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_entry->'head') is distinct from 'string'
      or (v_entry->>'head') !~ '^[0-9a-f]{64}$'
    then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_expected_goal_ids := array_append(v_expected_goal_ids, (v_entry->>'goalId')::uuid);
  end loop;
  v_today := (now() at time zone 'UTC')::date;

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('reverse_goal_earmark', v_actor, jsonb_build_object(
    'eventId', p_event_id, 'expectedHeads', (select coalesce(jsonb_agg(e order by e->>'goalId'), '[]'::jsonb) from jsonb_array_elements(p_expected_heads) e)
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'reverse_goal_earmark', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select * into v_original from public.goal_earmark_events where id = p_event_id and space_id = p_space_id for update;
  if not found or v_original.operation = 'reverse' then
    raise exception using errcode='P0001', message='the requested event cannot be reversed';
  end if;
  if exists(select 1 from public.goal_earmark_events where reversal_of = p_event_id) then
    raise exception using errcode='P0001', message='the requested event already has a reversal';
  end if;

  select coalesce(array_agg(distinct goal_id order by goal_id), '{}') into v_original_goal_ids
    from public.goal_earmark_lines where event_id = p_event_id;
  if (select array_agg(x order by x) from unnest(v_expected_goal_ids) x) is distinct from v_original_goal_ids then
    raise exception using errcode='P0001', message='expected heads must name exactly the original event''s goals';
  end if;

  for v_entry in select value from jsonb_array_elements(p_expected_heads) loop
    select head into v_head from private.goal_financing_state((v_entry->>'goalId')::uuid, v_today);
    if v_head is distinct from (v_entry->>'head') then
      raise exception using errcode='40001', message='planning_stale_revision';
    end if;
  end loop;

  insert into public.goal_earmark_events (space_id, currency, operation, reversal_of, line_count, request_id, actor_id)
    values (p_space_id, v_original.currency, 'reverse', p_event_id, v_original.line_count, p_request_id, v_actor)
    returning id into v_new_event_id;
  insert into public.goal_earmark_lines (event_id, goal_id, space_id, currency, amount_minor)
    select v_new_event_id, goal_id, space_id, currency, -amount_minor
    from public.goal_earmark_lines where event_id = p_event_id;

  v_result := jsonb_build_object('eventId', v_new_event_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'reverse_goal_earmark', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$_$;


ALTER FUNCTION public.reverse_goal_earmark(p_space_id uuid, p_request_id uuid, p_event_id bigint, p_expected_heads jsonb) OWNER TO postgres;

--
-- Name: revise_goal_plan(uuid, uuid, uuid, bigint, jsonb, jsonb, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.revise_goal_plan(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_expected_revision_id bigint, p_definition jsonb, p_milestones jsonb, p_state text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_goal public.goals%rowtype;
  v_current_revision_id bigint;
  v_name_en text; v_name_ar text; v_note text;
  v_target_minor bigint; v_deadline date; v_contribution_mode text; v_monthly_minor bigint; v_priority integer;
  v_canonical_milestones jsonb;
  v_entry jsonb;
  v_milestone_ids uuid[] := '{}';
  v_bad_kind_change integer;
  v_earmarked numeric;
  v_revision_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_goal_id is null or p_expected_revision_id is null
    or p_definition is null or p_milestones is null or p_state is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_state not in ('active','paused','closed') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if jsonb_typeof(p_definition) is distinct from 'object'
    or (p_definition ?& array['kind','currency','nameEn','nameAr','note','targetMinor','deadline','contributionMode','monthlyAmountMinor','priority']) is not true
    or (p_definition - array['kind','currency','nameEn','nameAr','note','targetMinor','deadline','contributionMode','monthlyAmountMinor','priority']) <> '{}'::jsonb
  then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if jsonb_typeof(p_definition->'kind') is distinct from 'string' or (p_definition->>'kind') not in ('reserve','purchase') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if jsonb_typeof(p_definition->'currency') is distinct from 'string' or (p_definition->>'currency') not in ('USD','LBP') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if jsonb_typeof(p_definition->'nameEn') not in ('string','null') or jsonb_typeof(p_definition->'nameAr') not in ('string','null') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if jsonb_typeof(p_definition->'note') not in ('string','null') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_name_en := nullif(p_definition->>'nameEn', '');
  v_name_ar := nullif(p_definition->>'nameAr', '');
  v_note := p_definition->>'note';
  v_target_minor := private.planning_minor(p_definition->>'targetMinor', true);
  if jsonb_typeof(p_definition->'deadline') not in ('string','null') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if nullif(p_definition->>'deadline','') is not null and not pg_input_is_valid(p_definition->>'deadline', 'date') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_deadline := nullif(p_definition->>'deadline', '')::date;
  if jsonb_typeof(p_definition->'contributionMode') is distinct from 'string'
    or (p_definition->>'contributionMode') not in ('manual_monthly','by_deadline')
  then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_contribution_mode := p_definition->>'contributionMode';
  if jsonb_typeof(p_definition->'monthlyAmountMinor') not in ('string','null') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_monthly_minor := case when p_definition->>'monthlyAmountMinor' is null then null
    else private.planning_minor(p_definition->>'monthlyAmountMinor', false) end;
  if jsonb_typeof(p_definition->'priority') is distinct from 'number'
    or (p_definition->>'priority')::numeric <> floor((p_definition->>'priority')::numeric)
  then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_priority := (p_definition->>'priority')::integer;
  if v_priority < 0 or v_priority > 999 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  if jsonb_typeof(p_milestones) is distinct from 'array' or jsonb_array_length(p_milestones) > 20 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  for v_entry in select value from jsonb_array_elements(p_milestones) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or (v_entry ?& array['id','kind','labelEn','labelAr','thresholdMinor','dueDate','ordinal']) is not true
      or (v_entry - array['id','kind','labelEn','labelAr','thresholdMinor','dueDate','ordinal']) <> '{}'::jsonb
      or (v_entry->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (v_entry->>'kind') not in ('amount','checklist')
      or jsonb_typeof(v_entry->'labelEn') not in ('string','null')
      or jsonb_typeof(v_entry->'labelAr') not in ('string','null')
      or jsonb_typeof(v_entry->'thresholdMinor') not in ('string','null')
      or jsonb_typeof(v_entry->'dueDate') not in ('string','null')
      or (nullif(v_entry->>'dueDate','') is not null and not pg_input_is_valid(v_entry->>'dueDate', 'date'))
      or (nullif(v_entry->>'thresholdMinor','') is not null and v_entry->>'thresholdMinor' !~ '^[0-9]+$')
      or jsonb_typeof(v_entry->'ordinal') is distinct from 'number'
      or (v_entry->>'ordinal')::numeric <> floor((v_entry->>'ordinal')::numeric)
      or (v_entry->>'ordinal')::numeric not between 0 and 19
    then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    if (v_entry->>'id')::uuid = any(v_milestone_ids) then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_milestone_ids := array_append(v_milestone_ids, (v_entry->>'id')::uuid);
  end loop;
  v_canonical_milestones := (select coalesce(jsonb_agg(m order by m->>'id'), '[]'::jsonb) from jsonb_array_elements(p_milestones) m);

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('revise_goal_plan', v_actor, jsonb_build_object(
    'goalId', p_goal_id, 'expectedRevisionId', p_expected_revision_id, 'definition', p_definition,
    'milestones', v_canonical_milestones, 'state', p_state
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'revise_goal_plan', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select * into v_goal from public.goals where id = p_goal_id and space_id = p_space_id;
  if not found then
    raise exception using errcode='P0001', message='the goal does not belong to the requested space';
  end if;
  if (p_definition->>'kind') is distinct from v_goal.kind or (p_definition->>'currency') is distinct from v_goal.currency::text then
    raise exception using errcode='P0001', message='a goal revision cannot change its kind or currency';
  end if;

  select id into v_current_revision_id from public.goal_revisions
    where goal_id = p_goal_id order by id desc limit 1;
  if v_current_revision_id is distinct from p_expected_revision_id then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  if p_state = 'closed' then
    select earmarked_minor into v_earmarked from private.goal_financing_state(p_goal_id, (now() at time zone 'UTC')::date);
    if v_earmarked <> 0 then
      raise exception using errcode='P0001', message='closing a goal requires its current earmark to be zero';
    end if;
  end if;

  -- A milestone identity already carrying checklist events cannot change kind
  -- or move to another goal (the goal is fixed by the identity's own FK; only
  -- the kind can drift across revisions without this check).
  select count(*) into v_bad_kind_change
  from jsonb_array_elements(p_milestones) m
  join public.goal_milestones existing on existing.id = (m->>'id')::uuid and existing.goal_id = p_goal_id
  where exists(select 1 from public.goal_milestone_events ev where ev.milestone_id = existing.id)
    and exists(
      select 1 from public.goal_revision_milestones grm
      where grm.milestone_id = existing.id and grm.kind is distinct from (m->>'kind')
    );
  if v_bad_kind_change <> 0 then
    raise exception using errcode='P0001', message='a milestone with checklist history cannot change kind';
  end if;

  insert into public.goal_revisions (
    goal_id, space_id, currency, expected_revision_id, name_en, name_ar, note, target_minor, deadline,
    contribution_mode, monthly_minor, priority, state, milestone_count, request_id, actor_id
  ) values (
    p_goal_id, p_space_id, v_goal.currency, p_expected_revision_id, v_name_en, v_name_ar, v_note, v_target_minor, v_deadline,
    v_contribution_mode, v_monthly_minor, v_priority, p_state, jsonb_array_length(p_milestones), p_request_id, v_actor
  ) returning id into v_revision_id;

  for v_entry in select value from jsonb_array_elements(p_milestones) loop
    insert into public.goal_milestones (id, goal_id, space_id, currency)
      values ((v_entry->>'id')::uuid, p_goal_id, v_goal.space_id, v_goal.currency)
      on conflict (id) do nothing;
    insert into public.goal_revision_milestones (
      revision_id, milestone_id, goal_id, space_id, currency, kind, label_en, label_ar, threshold_minor, due_date, ordinal
    ) values (
      v_revision_id, (v_entry->>'id')::uuid, p_goal_id, v_goal.space_id, v_goal.currency, v_entry->>'kind',
      nullif(v_entry->>'labelEn',''), nullif(v_entry->>'labelAr',''),
      case when v_entry->>'thresholdMinor' is null then null else private.planning_minor(v_entry->>'thresholdMinor', true) end,
      nullif(v_entry->>'dueDate','')::date, (v_entry->>'ordinal')::integer
    );
  end loop;

  v_result := jsonb_build_object('goalId', p_goal_id::text, 'revisionId', v_revision_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'revise_goal_plan', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$_$;


ALTER FUNCTION public.revise_goal_plan(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_expected_revision_id bigint, p_definition jsonb, p_milestones jsonb, p_state text) OWNER TO postgres;

--
-- Name: save_allocation_template(uuid, uuid, public.currency_code, bigint, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.save_allocation_template(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_expected_revision_id bigint, p_groups jsonb, p_root_mappings jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_current_template_id bigint;
  v_template_id bigint;
  v_group_count integer;
  v_root_count integer;
  v_canonical_groups jsonb := '[]'::jsonb;
  v_canonical_roots jsonb := '[]'::jsonb;
  v_payload jsonb;
  v_result jsonb;
  v_entry jsonb;
  v_id uuid;
  v_name_en text;
  v_name_ar text;
  v_category_id uuid;
  v_group_id uuid;
  v_category_ids uuid[] := '{}';
  v_valid_category_count integer;
  v_existing_space uuid;
  v_existing_currency public.currency_code;
  v_existing_purpose text;
begin
  if p_space_id is null or p_request_id is null or p_currency is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_groups is null or jsonb_typeof(p_groups) is distinct from 'array'
    or jsonb_array_length(p_groups) > 12 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_root_mappings is null or jsonb_typeof(p_root_mappings) is distinct from 'array'
    or jsonb_array_length(p_root_mappings) > 200 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_group_count := jsonb_array_length(p_groups);
  v_root_count := jsonb_array_length(p_root_mappings);

  for v_entry in select value from jsonb_array_elements(p_groups) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or (v_entry ?& array['id','purpose','nameEn','nameAr','order','basisPoints']) is not true
      or (v_entry - array['id','purpose','nameEn','nameAr','order','basisPoints']) <> '{}'::jsonb
      or jsonb_typeof(v_entry->'id') is distinct from 'string'
      or (v_entry->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_entry->'purpose') is distinct from 'string'
      or (v_entry->>'purpose') not in ('spending','future')
      or jsonb_typeof(v_entry->'order') is distinct from 'number'
      or jsonb_typeof(v_entry->'basisPoints') is distinct from 'number'
      or jsonb_typeof(v_entry->'nameEn') not in ('string','null')
      or jsonb_typeof(v_entry->'nameAr') not in ('string','null')
    then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_id := (v_entry->>'id')::uuid;
    v_name_en := private.canonical_category_name(v_entry->>'nameEn');
    v_name_ar := private.canonical_category_name(v_entry->>'nameAr');
    if char_length(coalesce(v_name_en,'')) > 80 or char_length(coalesce(v_name_ar,'')) > 80
      or (v_name_en is null and v_name_ar is null) then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_canonical_groups := v_canonical_groups || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'purpose', v_entry->>'purpose', 'nameEn', v_name_en, 'nameAr', v_name_ar,
      'order', (v_entry->>'order')::integer, 'basisPoints', (v_entry->>'basisPoints')::integer
    ));
  end loop;

  -- Reuse the apportionment helper purely to validate the {id,order,
  -- basisPoints} shape/bounds (12-group cap, duplicate id/order, bps<=10000
  -- total, reserved sentinel, order<=11) instead of re-deriving those rules
  -- a second time; the numeric income (0) is discarded.
  perform private.allocate_planning_income('0', (
    select coalesce(jsonb_agg(jsonb_build_object('id', g->>'id', 'order', g->'order', 'basisPoints', g->'basisPoints')), '[]'::jsonb)
    from jsonb_array_elements(v_canonical_groups) g
  ));

  for v_entry in select value from jsonb_array_elements(p_root_mappings) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or (v_entry ?& array['categoryId','groupId']) is not true
      or (v_entry - array['categoryId','groupId']) <> '{}'::jsonb
      or jsonb_typeof(v_entry->'categoryId') is distinct from 'string'
      or jsonb_typeof(v_entry->'groupId') is distinct from 'string'
      or (v_entry->>'categoryId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (v_entry->>'groupId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_category_id := (v_entry->>'categoryId')::uuid;
    v_group_id := (v_entry->>'groupId')::uuid;
    if v_category_id = any(v_category_ids) then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    -- Each mapping must point to a spending group included in this same
    -- submission, not an arbitrary pre-existing group.
    if not exists (
      select 1 from jsonb_array_elements(v_canonical_groups) g
      where (g->>'id')::uuid = v_group_id and g->>'purpose' = 'spending'
    ) then
      raise exception using errcode='22023', message='planning_invalid_input';
    end if;
    v_category_ids := array_append(v_category_ids, v_category_id);
    v_canonical_roots := v_canonical_roots || jsonb_build_array(jsonb_build_object(
      'categoryId', v_category_id, 'groupId', v_group_id
    ));
  end loop;

  -- Stable identity order: sort groups by id, roots by categoryId, so a
  -- semantically identical resubmission in a different array order still
  -- fingerprints and inserts the same way.
  v_canonical_groups := (select coalesce(jsonb_agg(g order by g->>'id'), '[]'::jsonb) from jsonb_array_elements(v_canonical_groups) g);
  v_canonical_roots := (select coalesce(jsonb_agg(r order by r->>'categoryId'), '[]'::jsonb) from jsonb_array_elements(v_canonical_roots) r);

  v_actor := private.lock_planning_actor(p_space_id);

  v_payload := jsonb_build_object(
    'currency', p_currency, 'expectedRevisionId', p_expected_revision_id,
    'groups', v_canonical_groups, 'rootMappings', v_canonical_roots
  );
  v_fingerprint := private.planning_fingerprint('save_allocation_template', v_actor, v_payload);
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'save_allocation_template', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select id into v_current_template_id from public.allocation_template_revisions
    where space_id = p_space_id and currency = p_currency order by id desc limit 1;
  if v_current_template_id is distinct from p_expected_revision_id then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  if v_root_count > 0 then
    select count(*) into v_valid_category_count
    from public.categories category
    where category.id = any(v_category_ids) and category.space_id = p_space_id
      and category.kind = 'expense' and category.parent_category_id is null
      and category.archived_at is null;
    if v_valid_category_count is distinct from array_length(v_category_ids, 1) then
      raise exception using errcode='P0001', message='every root mapping must reference an active root expense category in this space';
    end if;
    -- Lock the referenced category rows in a stable ascending order so two
    -- concurrent commands touching an overlapping category set cannot
    -- deadlock against each other.
    perform 1 from public.categories where id = any(v_category_ids) and space_id = p_space_id
      order by id for share;
  end if;

  for v_entry in select value from jsonb_array_elements(v_canonical_groups) loop
    v_id := (v_entry->>'id')::uuid;
    select space_id, currency, purpose into v_existing_space, v_existing_currency, v_existing_purpose
      from public.allocation_groups where id = v_id;
    if found then
      if v_existing_space is distinct from p_space_id or v_existing_currency is distinct from p_currency
        or v_existing_purpose is distinct from v_entry->>'purpose' then
        raise exception using errcode='P0001', message='a submitted group id already exists with a different space, currency, or purpose';
      end if;
    else
      insert into public.allocation_groups (id, space_id, currency, purpose, actor_id)
        values (v_id, p_space_id, p_currency, v_entry->>'purpose', v_actor);
    end if;
  end loop;

  insert into public.allocation_template_revisions
    (space_id, currency, expected_revision_id, group_count, root_count, request_id, actor_id)
    values (p_space_id, p_currency, p_expected_revision_id, v_group_count, v_root_count, p_request_id, v_actor)
    returning id into v_template_id;

  insert into public.allocation_template_lines (template_id, group_id, space_id, currency, name_en, name_ar, display_order, basis_points)
    select v_template_id, (g->>'id')::uuid, p_space_id, p_currency, g->>'nameEn', g->>'nameAr',
      (g->>'order')::integer, (g->>'basisPoints')::integer
    from jsonb_array_elements(v_canonical_groups) g;

  insert into public.allocation_template_roots (template_id, category_id, group_id, space_id, currency)
    select v_template_id, (r->>'categoryId')::uuid, (r->>'groupId')::uuid, p_space_id, p_currency
    from jsonb_array_elements(v_canonical_roots) r;

  v_result := jsonb_build_object('templateRevisionId', v_template_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'save_allocation_template', v_fingerprint, v_actor, v_result);

  return v_result;
end;
$_$;


ALTER FUNCTION public.save_allocation_template(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_expected_revision_id bigint, p_groups jsonb, p_root_mappings jsonb) OWNER TO postgres;

--
-- Name: save_schedule(uuid, uuid, uuid, bigint, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.save_schedule(p_space_id uuid, p_request_id uuid, p_schedule_id uuid, p_expected_revision_id bigint, p_definition jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $_$
declare
  v_actor uuid;
  v_actor_email text;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_schedule public.schedules%rowtype;
  v_kind text; v_currency public.currency_code; v_state text;
  v_name_en text; v_name_ar text;
  v_expected_minor bigint; v_starts_on date; v_ends_on date;
  v_cadence text; v_interval_count integer;
  v_category_id uuid; v_loan_id uuid; v_funding_goal_id uuid; v_preferred_wallet_id uuid;
  v_current_head bigint;
  v_previous_state text;
  v_schedule_exists boolean;
  v_active_count integer;
  v_revision_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_schedule_id is null or p_definition is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if jsonb_typeof(p_definition) is distinct from 'object'
    or (p_definition ?& array['currency','kind','state','nameEn','nameAr','expectedMinor','startsOn','endsOn',
        'cadence','intervalCount','categoryId','loanId','fundingGoalId','preferredWalletId']) is not true
    or (p_definition - array['currency','kind','state','nameEn','nameAr','expectedMinor','startsOn','endsOn',
        'cadence','intervalCount','categoryId','loanId','fundingGoalId','preferredWalletId']) <> '{}'::jsonb
  then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if jsonb_typeof(p_definition->'currency') is distinct from 'string' or (p_definition->>'currency') not in ('USD','LBP') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_currency := (p_definition->>'currency')::public.currency_code;
  if jsonb_typeof(p_definition->'kind') is distinct from 'string' or (p_definition->>'kind') not in ('income','expense','debt_payment') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_kind := p_definition->>'kind';
  if jsonb_typeof(p_definition->'state') is distinct from 'string' or (p_definition->>'state') not in ('active','paused','ended') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_state := p_definition->>'state';
  if jsonb_typeof(p_definition->'nameEn') not in ('string','null') or jsonb_typeof(p_definition->'nameAr') not in ('string','null') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_name_en := nullif(p_definition->>'nameEn', '');
  v_name_ar := nullif(p_definition->>'nameAr', '');
  if jsonb_typeof(p_definition->'expectedMinor') is distinct from 'string' then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_expected_minor := private.planning_minor(p_definition->>'expectedMinor', true);
  if jsonb_typeof(p_definition->'startsOn') is distinct from 'string'
    or not pg_input_is_valid(p_definition->>'startsOn', 'date') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_starts_on := (p_definition->>'startsOn')::date;
  if jsonb_typeof(p_definition->'endsOn') not in ('string','null') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if nullif(p_definition->>'endsOn','') is not null and not pg_input_is_valid(p_definition->>'endsOn', 'date') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_ends_on := nullif(p_definition->>'endsOn', '')::date;
  if jsonb_typeof(p_definition->'cadence') is distinct from 'string'
    or (p_definition->>'cadence') not in ('weekly','monthly','yearly','semimonthly','monthly_last_business_day') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_cadence := p_definition->>'cadence';
  if jsonb_typeof(p_definition->'intervalCount') is distinct from 'number'
    or (p_definition->>'intervalCount')::numeric <> floor((p_definition->>'intervalCount')::numeric)
    or (p_definition->>'intervalCount')::numeric not between 1 and 12
  then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_interval_count := (p_definition->>'intervalCount')::integer;
  -- semimonthly already means "twice a month", so any interval other than 1
  -- is meaningless and rejected rather than silently reinterpreted.
  if v_cadence = 'semimonthly' and v_interval_count <> 1 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if jsonb_typeof(p_definition->'categoryId') not in ('string','null')
    or jsonb_typeof(p_definition->'loanId') not in ('string','null')
    or jsonb_typeof(p_definition->'fundingGoalId') not in ('string','null')
    or jsonb_typeof(p_definition->'preferredWalletId') not in ('string','null')
    or (nullif(p_definition->>'categoryId','') is not null
      and (p_definition->>'categoryId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or (nullif(p_definition->>'loanId','') is not null
      and (p_definition->>'loanId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or (nullif(p_definition->>'fundingGoalId','') is not null
      and (p_definition->>'fundingGoalId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or (nullif(p_definition->>'preferredWalletId','') is not null
      and (p_definition->>'preferredWalletId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_category_id := nullif(p_definition->>'categoryId','')::uuid;
  v_loan_id := nullif(p_definition->>'loanId','')::uuid;
  v_funding_goal_id := nullif(p_definition->>'fundingGoalId','')::uuid;
  v_preferred_wallet_id := nullif(p_definition->>'preferredWalletId','')::uuid;

  v_actor := private.lock_planning_actor(p_space_id);

  -- Labels never default to an account's private email: a UI bug that
  -- pre-fills a bill/income label with the signed-in account's own address
  -- would otherwise leak it into a shared space.
  select email into v_actor_email from auth.users where id = v_actor;
  if v_actor_email is not null and (
    lower(btrim(coalesce(v_name_en,''))) = lower(btrim(v_actor_email))
    or lower(btrim(coalesce(v_name_ar,''))) = lower(btrim(v_actor_email))
  ) then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  v_fingerprint := private.planning_fingerprint('save_schedule', v_actor, jsonb_build_object(
    'scheduleId', p_schedule_id, 'expectedRevisionId', p_expected_revision_id, 'definition', p_definition
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'save_schedule', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select * into v_schedule from public.schedules where id = p_schedule_id and space_id = p_space_id;
  v_schedule_exists := found;
  if v_schedule_exists then
    if v_kind is distinct from v_schedule.kind or v_currency is distinct from v_schedule.currency then
      raise exception using errcode='P0001', message='a schedule revision cannot change its kind or currency';
    end if;
    select id, state into v_current_head, v_previous_state
      from public.schedule_revisions where schedule_id = p_schedule_id order by id desc limit 1;
  else
    v_current_head := null;
    v_previous_state := null;
  end if;

  if v_current_head is distinct from p_expected_revision_id then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  -- The 200-active-schedule cap must bound every transition INTO 'active'
  -- (creation, or an existing paused/ended schedule reactivated), not just
  -- creation -- otherwise a schedule created paused and later flipped
  -- active would never be counted. A schedule that is already active and
  -- stays active does not need to be recounted.
  if v_state = 'active' and v_previous_state is distinct from 'active' then
    select count(*) into v_active_count from public.schedules s
      where s.space_id = p_space_id and s.id <> p_schedule_id
        and (select state from public.schedule_revisions where schedule_id = s.id order by id desc limit 1) = 'active';
    if v_active_count >= 200 then
      raise exception using errcode='P0001', message='this space already has 200 active schedules';
    end if;
  end if;

  if not v_schedule_exists then
    insert into public.schedules (id, space_id, currency, kind, actor_id)
      values (p_schedule_id, p_space_id, v_currency, v_kind, v_actor);
  end if;

  insert into public.schedule_revisions (
    schedule_id, space_id, currency, expected_revision_id, state, name_en, name_ar, expected_minor,
    starts_on, ends_on, cadence, interval_count, category_id, loan_id, funding_goal_id, preferred_wallet_id,
    request_id, actor_id
  ) values (
    p_schedule_id, p_space_id, v_currency, p_expected_revision_id, v_state, v_name_en, v_name_ar, v_expected_minor,
    v_starts_on, v_ends_on, v_cadence, v_interval_count, v_category_id, v_loan_id, v_funding_goal_id, v_preferred_wallet_id,
    p_request_id, v_actor
  ) returning id into v_revision_id;

  v_result := jsonb_build_object('scheduleId', p_schedule_id::text, 'revisionId', v_revision_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'save_schedule', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$_$;


ALTER FUNCTION public.save_schedule(p_space_id uuid, p_request_id uuid, p_schedule_id uuid, p_expected_revision_id bigint, p_definition jsonb) OWNER TO postgres;

--
-- Name: scheduled_occurrence_page(uuid, date, date, date, uuid, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.scheduled_occurrence_page(p_space_id uuid, p_from_date date, p_to_date date, p_after_due_date date DEFAULT NULL::date, p_after_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 25) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    SET statement_timeout TO '10s'
    AS $$
declare
  v_as_of date := private.space_today(p_space_id);
  v_rows jsonb;
  v_has_more boolean;
  v_next_due_date date;
  v_next_id uuid;
begin
  if p_space_id is null or p_from_date is null or p_to_date is null or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  if p_to_date < p_from_date or (p_to_date - p_from_date) > 90 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if (p_after_due_date is null) is distinct from (p_after_id is null) then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  with page as (
    select so.*, sch.kind as schedule_kind, rev.name_en, rev.name_ar
    from public.scheduled_occurrences so
    join public.schedules sch on sch.id = so.schedule_id and sch.space_id = so.space_id
    join public.schedule_revisions rev on rev.id = so.source_revision_id
    where so.space_id = p_space_id and so.due_date between p_from_date and p_to_date
      and (p_after_due_date is null or (so.due_date, so.id) > (p_after_due_date, p_after_id))
    order by so.due_date, so.id
    limit p_limit + 1
  ), numbered as (
    select page.*, row_number() over (order by due_date, id) as rn from page
  ), settled as (
    select numbered.*, stl.settled_minor, stl.skipped
    from numbered
    cross join lateral private.schedule_occurrence_settlement(numbered.id, v_as_of) stl
    where numbered.rn <= p_limit
  ), funded as (
    select settled.*, coalesce((
      select sum(gpl.amount_minor) from public.goal_purchase_links gpl
      where gpl.goal_id = settled.funding_goal_id
        and gpl.expense_event_id in (
          select oe.linked_event_id from public.occurrence_events oe
          where oe.occurrence_id = settled.id and oe.action in ('link','confirm')
        )
    ), 0) as goal_funded_minor
    from settled
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
       'id', funded.id::text, 'scheduleId', funded.schedule_id::text,
       'sourceRevisionId', funded.source_revision_id::text,
       'currentEventId', (select max(id)::text from public.occurrence_events where occurrence_id = funded.id),
       'linkedEventId', (select oe.linked_event_id::text
         from public.occurrence_events oe
         join public.financial_events fe on fe.id = oe.linked_event_id
         where oe.occurrence_id = funded.id and oe.action in ('link','confirm')
           and fe.effective_date <= v_as_of
           and not exists (
             select 1 from public.financial_events rev
             where rev.reversal_of = oe.linked_event_id and rev.effective_date <= v_as_of
           )
         order by oe.id desc limit 1),
       'currency', funded.currency, 'kind', funded.schedule_kind,
       'nameEn', funded.name_en, 'nameAr', funded.name_ar, 'dueDate', funded.due_date,
       'expectedMinor', funded.expected_minor::text,
       'settledMinor', funded.settled_minor::text,
       'remainingMinor', greatest(funded.expected_minor - funded.settled_minor, 0)::text,
       'state', case when funded.skipped then 'skipped'
         when funded.settled_minor <= 0 then 'pending'
         when funded.settled_minor < funded.expected_minor then 'partial'
         else 'settled' end,
       'overdue', (funded.due_date < v_as_of and not funded.skipped and (funded.expected_minor - funded.settled_minor) > 0),
       'categoryId', funded.category_id::text, 'loanId', funded.loan_id::text,
       'fundingGoalId', funded.funding_goal_id::text, 'preferredWalletId', funded.preferred_wallet_id::text,
       'fundingShortfallMinor', case when funded.funding_goal_id is null then null
         else greatest(funded.settled_minor - funded.goal_funded_minor, 0)::text end,
       'asOf', v_as_of
     ) order by funded.due_date, funded.id), '[]'::jsonb)
     from funded),
    exists(select 1 from numbered where rn > p_limit),
    (select due_date from numbered where rn = p_limit),
    (select id from numbered where rn = p_limit)
  into v_rows, v_has_more, v_next_due_date, v_next_id;

  return jsonb_build_object(
    'rows', v_rows, 'hasMore', coalesce(v_has_more, false),
    'nextCursor', case when v_has_more then jsonb_build_object('dueDate', v_next_due_date, 'id', v_next_id::text) else null end,
    'asOf', v_as_of
  );
end;
$$;


ALTER FUNCTION public.scheduled_occurrence_page(p_space_id uuid, p_from_date date, p_to_date date, p_after_due_date date, p_after_id uuid, p_limit integer) OWNER TO postgres;

--
-- Name: scheduled_overdue_page(uuid, date, uuid, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.scheduled_overdue_page(p_space_id uuid, p_after_due_date date DEFAULT NULL::date, p_after_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    SET statement_timeout TO '10s'
    AS $$
declare
  v_as_of date := private.space_today(p_space_id);
  v_rows jsonb;
  v_has_more boolean;
  v_next_due_date date;
  v_next_id uuid;
begin
  if p_space_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  if (p_after_due_date is null) is distinct from (p_after_id is null) then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  with unpaid as (
    select so.*, sch.kind as schedule_kind, rev.name_en, rev.name_ar, stl.settled_minor, stl.skipped
    from public.scheduled_occurrences so
    join public.schedules sch on sch.id = so.schedule_id and sch.space_id = so.space_id
    join public.schedule_revisions rev on rev.id = so.source_revision_id
    cross join lateral private.schedule_occurrence_settlement(so.id, v_as_of) stl
    where so.space_id = p_space_id and so.due_date < v_as_of
      and not stl.skipped and so.expected_minor - stl.settled_minor > 0
      and (p_after_due_date is null or (so.due_date, so.id) > (p_after_due_date, p_after_id))
    order by so.due_date, so.id
    limit p_limit + 1
  ), numbered as (
    select unpaid.*, row_number() over (order by due_date, id) as rn from unpaid
  ), settled as (
    select numbered.* from numbered where numbered.rn <= p_limit
  ), funded as (
    select settled.*, coalesce((
      select sum(gpl.amount_minor) from public.goal_purchase_links gpl
      where gpl.goal_id = settled.funding_goal_id
        and gpl.expense_event_id in (
          select oe.linked_event_id from public.occurrence_events oe
          where oe.occurrence_id = settled.id and oe.action in ('link','confirm')
        )
    ), 0) as goal_funded_minor
    from settled
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
       'id', funded.id::text, 'scheduleId', funded.schedule_id::text,
       'sourceRevisionId', funded.source_revision_id::text,
       'currentEventId', (select max(id)::text from public.occurrence_events where occurrence_id = funded.id),
       'linkedEventId', (select oe.linked_event_id::text
         from public.occurrence_events oe
         join public.financial_events fe on fe.id = oe.linked_event_id
         where oe.occurrence_id = funded.id and oe.action in ('link','confirm')
           and fe.effective_date <= v_as_of
           and not exists (
             select 1 from public.financial_events rev
             where rev.reversal_of = oe.linked_event_id and rev.effective_date <= v_as_of
           )
         order by oe.id desc limit 1),
       'currency', funded.currency, 'kind', funded.schedule_kind,
       'nameEn', funded.name_en, 'nameAr', funded.name_ar, 'dueDate', funded.due_date,
       'expectedMinor', funded.expected_minor::text,
       'settledMinor', funded.settled_minor::text,
       'remainingMinor', greatest(funded.expected_minor - funded.settled_minor, 0)::text,
       'state', case when funded.skipped then 'skipped'
         when funded.settled_minor <= 0 then 'pending'
         when funded.settled_minor < funded.expected_minor then 'partial'
         else 'settled' end,
       'overdue', (funded.due_date < v_as_of and not funded.skipped and (funded.expected_minor - funded.settled_minor) > 0),
       'categoryId', funded.category_id::text, 'loanId', funded.loan_id::text,
       'fundingGoalId', funded.funding_goal_id::text, 'preferredWalletId', funded.preferred_wallet_id::text,
       'fundingShortfallMinor', case when funded.funding_goal_id is null then null
         else greatest(funded.settled_minor - funded.goal_funded_minor, 0)::text end,
       'asOf', v_as_of
     ) order by funded.due_date, funded.id), '[]'::jsonb)
     from funded),
    exists(select 1 from numbered where rn > p_limit),
    (select due_date from numbered where rn = p_limit),
    (select id from numbered where rn = p_limit)
  into v_rows, v_has_more, v_next_due_date, v_next_id;

  return jsonb_build_object(
    'rows', v_rows, 'hasMore', coalesce(v_has_more, false),
    'nextCursor', case when v_has_more then jsonb_build_object('dueDate', v_next_due_date, 'id', v_next_id::text) else null end,
    'asOf', v_as_of
  );
end;
$$;


ALTER FUNCTION public.scheduled_overdue_page(p_space_id uuid, p_after_due_date date, p_after_id uuid, p_limit integer) OWNER TO postgres;

--
-- Name: set_goal_milestone_state(uuid, uuid, uuid, text, bigint); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_goal_milestone_state(p_space_id uuid, p_request_id uuid, p_milestone_id uuid, p_action text, p_expected_event_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_milestone public.goal_milestones%rowtype;
  v_current_definition_id bigint;
  v_in_current_definition boolean;
  v_current_event_id bigint;
  v_last_action text;
  v_event_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_milestone_id is null or p_action is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_action not in ('complete','reopen') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('set_goal_milestone_state', v_actor, jsonb_build_object(
    'milestoneId', p_milestone_id, 'action', p_action, 'expectedEventId', p_expected_event_id
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'set_goal_milestone_state', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select * into v_milestone from public.goal_milestones where id = p_milestone_id and space_id = p_space_id;
  if not found then
    raise exception using errcode='P0001', message='the milestone does not belong to the requested space';
  end if;

  select id into v_current_definition_id from public.goal_revisions
    where goal_id = v_milestone.goal_id order by id desc limit 1;
  select exists(
    select 1 from public.goal_revision_milestones
    where revision_id = v_current_definition_id and milestone_id = p_milestone_id and kind = 'checklist'
  ) into v_in_current_definition;
  if not v_in_current_definition then
    raise exception using errcode='P0001', message='only a checklist milestone in the current definition can change state';
  end if;

  select id, action into v_current_event_id, v_last_action from public.goal_milestone_events
    where milestone_id = p_milestone_id order by id desc limit 1;
  if v_current_event_id is distinct from p_expected_event_id then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;
  if v_last_action is null and p_action = 'reopen' then
    raise exception using errcode='P0001', message='a milestone with no history cannot be reopened';
  end if;
  if v_last_action = p_action then
    raise exception using errcode='P0001', message='the milestone is already in the requested state';
  end if;

  insert into public.goal_milestone_events (milestone_id, goal_id, space_id, currency, expected_event_id, action, request_id, actor_id)
    values (p_milestone_id, v_milestone.goal_id, v_milestone.space_id, v_milestone.currency, p_expected_event_id, p_action, p_request_id, v_actor)
    returning id into v_event_id;

  v_result := jsonb_build_object('eventId', v_event_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'set_goal_milestone_state', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$$;


ALTER FUNCTION public.set_goal_milestone_state(p_space_id uuid, p_request_id uuid, p_milestone_id uuid, p_action text, p_expected_event_id bigint) OWNER TO postgres;

--
-- Name: set_goal_monthly_target(uuid, uuid, uuid, date, text, bigint); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_goal_monthly_target(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_month date, p_amount_minor text, p_expected_revision_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_goal public.goals%rowtype;
  v_state text;
  v_amount_minor bigint;
  v_month date;
  v_current_id bigint;
  v_revision_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_goal_id is null or p_month is null or p_amount_minor is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_month <> date_trunc('month', p_month)::date then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  v_month := p_month;
  v_amount_minor := private.planning_minor(p_amount_minor, false);

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('set_goal_monthly_target', v_actor, jsonb_build_object(
    'goalId', p_goal_id, 'month', v_month, 'amountMinor', v_amount_minor::text, 'expectedRevisionId', p_expected_revision_id
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'set_goal_monthly_target', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select * into v_goal from public.goals where id = p_goal_id and space_id = p_space_id;
  if not found then
    raise exception using errcode='P0001', message='the goal does not belong to the requested space';
  end if;
  select state into v_state from public.goal_revisions where goal_id = p_goal_id order by id desc limit 1;
  if v_amount_minor > 0 and v_state <> 'active' then
    raise exception using errcode='P0001', message='a positive monthly target requires an active goal';
  end if;

  select id into v_current_id from public.goal_monthly_target_revisions
    where goal_id = p_goal_id and month_start = v_month order by id desc limit 1;
  if v_current_id is distinct from p_expected_revision_id then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  insert into public.goal_monthly_target_revisions (goal_id, space_id, currency, month_start, amount_minor, expected_revision_id, request_id, actor_id)
    values (p_goal_id, v_goal.space_id, v_goal.currency, v_month, v_amount_minor, p_expected_revision_id, p_request_id, v_actor)
    returning id into v_revision_id;

  v_result := jsonb_build_object('revisionId', v_revision_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'set_goal_monthly_target', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$$;


ALTER FUNCTION public.set_goal_monthly_target(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_month date, p_amount_minor text, p_expected_revision_id bigint) OWNER TO postgres;

--
-- Name: set_household_member_role(uuid, uuid, uuid, public.member_role); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_household_member_role(p_space_id uuid, p_request_id uuid, p_member_user_id uuid, p_role public.member_role) RETURNS TABLE(user_id uuid, status public.membership_status, role public.member_role)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_actor_id uuid := private.household_actor_user_id();
  v_fingerprint bytea;
  v_kind public.household_membership_event_kind;
  v_event public.household_membership_events%rowtype;
  v_membership public.space_memberships%rowtype;
  v_space_kind public.space_kind;
  v_now timestamptz := now();
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_space_id is null or p_request_id is null or p_member_user_id is null or p_role is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  v_kind := case when p_role = 'owner' then 'member_promoted' else 'member_demoted' end;
  v_fingerprint := private.household_command_fingerprint(
    'set_household_member_role|' || p_space_id::text || '|'
      || p_member_user_id::text || '|' || p_role::text
  );
  perform private.lock_household_request(v_actor_id, p_request_id);
  select event.* into v_event
  from public.household_membership_events as event
  where event.actor_user_id = v_actor_id and event.request_id = p_request_id;
  if found then
    if v_event.kind <> v_kind
      or v_event.request_fingerprint <> v_fingerprint
      or v_event.subject_user_id <> p_member_user_id then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;
    return query select p_member_user_id, v_event.next_status, v_event.next_role;
    return;
  end if;

  v_space_kind := private.lock_household_space(p_space_id);
  if v_space_kind is null then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;
  if v_space_kind <> 'household' then
    raise exception using errcode = 'P0001', message = 'personal_space_prohibited';
  end if;
  if not private.is_active_owner(p_space_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  select membership.* into v_membership
  from public.space_memberships as membership
  where membership.space_id = p_space_id and membership.user_id = p_member_user_id
  for update;
  if not found or v_membership.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'membership_not_active';
  end if;
  if v_membership.role = p_role then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if v_membership.role = 'owner' and p_role = 'member'
    and (select count(*) from public.space_memberships as owner_membership
         where owner_membership.space_id = p_space_id
           and owner_membership.status = 'active'
           and owner_membership.role = 'owner') <= 1 then
    raise exception using errcode = 'P0001', message = 'last_owner';
  end if;

  update public.space_memberships
  set role = p_role
  where space_id = p_space_id and space_memberships.user_id = p_member_user_id;
  insert into public.household_membership_events (
    space_id, actor_user_id, subject_user_id, request_id, request_fingerprint,
    kind, prior_status, next_status, prior_role, next_role, occurred_at
  ) values (
    p_space_id, v_actor_id, p_member_user_id, p_request_id, v_fingerprint,
    v_kind, 'active', 'active', v_membership.role, p_role, v_now
  );
  return query select p_member_user_id, 'active'::public.membership_status, p_role;
end;
$$;


ALTER FUNCTION public.set_household_member_role(p_space_id uuid, p_request_id uuid, p_member_user_id uuid, p_role public.member_role) OWNER TO postgres;

--
-- Name: set_loan_monthly_target(uuid, uuid, uuid, date, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_loan_monthly_target(p_space_id uuid, p_request_id uuid, p_loan_id uuid, p_month date, p_target_minor text) RETURNS TABLE(id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_target_month date := date_trunc('month', p_month)::date;
  v_target_minor bigint;
  v_direction public.loan_direction;
  v_outstanding_minor bigint;
  v_fingerprint bytea;
  v_existing_fingerprint bytea;
  v_existing_id uuid;
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  v_target_minor := private.parse_nonnegative_minor_amount(p_target_minor);
  v_fingerprint := extensions.digest(
    'loan_monthly_target|' || p_loan_id::text || '|' || v_target_month::text || '|'
      || p_target_minor,
    'sha256'
  );
  perform private.lock_financial_request(p_space_id, p_request_id);

  select revision.request_fingerprint, revision.id
  into v_existing_fingerprint, v_existing_id
  from public.loan_monthly_target_revisions as revision
  where revision.space_id = p_space_id
    and revision.request_id = p_request_id;

  if found then
    if v_existing_fingerprint <> v_fingerprint then
      raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
    end if;

    return query select v_existing_id;
    return;
  end if;

  select loan.direction
  into v_direction
  from public.loans as loan
  where loan.id = p_loan_id
    and loan.space_id = p_space_id
  for update;

  if not found or v_direction <> 'i_owe_them' then
    raise exception using errcode = 'P0001', message = 'monthly repayment targets are available only for loans I owe';
  end if;

  select coalesce(sum(posting.principal_delta_minor), 0)
  into v_outstanding_minor
  from public.loan_postings as posting
  where posting.loan_id = p_loan_id;

  if v_target_minor > v_outstanding_minor then
    raise exception using errcode = 'P0001', message = 'the monthly target cannot exceed outstanding principal';
  end if;

  insert into public.loan_monthly_target_revisions (
    space_id, loan_id, request_id, request_fingerprint, target_month, target_minor, actor_id
  )
  values (
    p_space_id, p_loan_id, p_request_id, v_fingerprint, v_target_month, v_target_minor, v_actor_id
  )
  returning loan_monthly_target_revisions.id into v_existing_id;

  return query select v_existing_id;
end;
$$;


ALTER FUNCTION public.set_loan_monthly_target(p_space_id uuid, p_request_id uuid, p_loan_id uuid, p_month date, p_target_minor text) OWNER TO postgres;

--
-- Name: set_monthly_category_target(uuid, uuid, uuid, date, public.currency_code, text, bigint); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_monthly_category_target(p_space_id uuid, p_request_id uuid, p_category_id uuid, p_month date, p_currency public.currency_code, p_amount_minor text, p_expected_revision_id bigint DEFAULT NULL::bigint) RETURNS TABLE(id bigint, month_start date)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$ select * from private.set_monthly_budget_plan(p_space_id, p_request_id, p_category_id, p_month, p_currency, p_amount_minor, p_expected_revision_id, 'expense_category') $$;


ALTER FUNCTION public.set_monthly_category_target(p_space_id uuid, p_request_id uuid, p_category_id uuid, p_month date, p_currency public.currency_code, p_amount_minor text, p_expected_revision_id bigint) OWNER TO postgres;

--
-- Name: set_monthly_income_plan(uuid, uuid, date, public.currency_code, text, bigint); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_monthly_income_plan(p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code, p_amount_minor text, p_expected_revision_id bigint DEFAULT NULL::bigint) RETURNS TABLE(id bigint, month_start date)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$ select * from private.set_monthly_budget_plan(p_space_id, p_request_id, null, p_month, p_currency, p_amount_minor, p_expected_revision_id, 'income') $$;


ALTER FUNCTION public.set_monthly_income_plan(p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code, p_amount_minor text, p_expected_revision_id bigint) OWNER TO postgres;

--
-- Name: set_occurrence_state(uuid, uuid, uuid, bigint, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_occurrence_state(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_expected_event_id bigint, p_action text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_occurrence public.scheduled_occurrences%rowtype;
  v_current_event_id bigint;
  v_settled numeric; v_skipped boolean;
  v_today date := (now() at time zone 'UTC')::date;
  v_event_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_occurrence_id is null or p_action is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;
  if p_action not in ('skip','reopen') then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  v_actor := private.lock_planning_actor(p_space_id);

  v_fingerprint := private.planning_fingerprint('set_occurrence_state', v_actor, jsonb_build_object(
    'occurrenceId', p_occurrence_id, 'expectedEventId', p_expected_event_id, 'action', p_action
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'set_occurrence_state', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select * into v_occurrence from public.scheduled_occurrences where id = p_occurrence_id and space_id = p_space_id for update;
  if not found then
    raise exception using errcode='P0001', message='the occurrence does not belong to the requested space';
  end if;

  select max(id) into v_current_event_id from public.occurrence_events where occurrence_id = p_occurrence_id;
  if v_current_event_id is distinct from p_expected_event_id then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  select settled_minor, skipped into v_settled, v_skipped
    from private.schedule_occurrence_settlement(p_occurrence_id, v_today);

  if p_action = 'skip' then
    if v_skipped then
      raise exception using errcode='P0001', message='the occurrence is already skipped';
    end if;
    if v_settled <> 0 then
      raise exception using errcode='P0001', message='a partially or fully paid occurrence cannot be skipped';
    end if;
  else
    if not v_skipped then
      raise exception using errcode='P0001', message='only a skipped occurrence can be reopened';
    end if;
  end if;

  insert into public.occurrence_events (occurrence_id, space_id, expected_event_id, action, request_id, actor_id)
    values (p_occurrence_id, p_space_id, p_expected_event_id, p_action, p_request_id, v_actor)
    returning id into v_event_id;

  v_result := jsonb_build_object('occurrenceId', p_occurrence_id::text, 'eventId', v_event_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'set_occurrence_state', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$$;


ALTER FUNCTION public.set_occurrence_state(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_expected_event_id bigint, p_action text) OWNER TO postgres;

--
-- Name: set_rollover_policy(uuid, uuid, public.currency_code, uuid, boolean, bigint); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_rollover_policy(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_root_id uuid, p_enabled boolean, p_expected_revision_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_actor uuid;
  v_fingerprint bytea;
  v_existing_result jsonb;
  v_head bigint;
  v_category public.categories%rowtype;
  v_revision_id bigint;
  v_result jsonb;
begin
  if p_space_id is null or p_request_id is null or p_currency is null or p_root_id is null or p_enabled is null then
    raise exception using errcode='22023', message='planning_invalid_input';
  end if;

  v_actor := private.lock_planning_actor(p_space_id);
  v_fingerprint := private.planning_fingerprint('set_rollover_policy', v_actor, jsonb_build_object(
    'currency', p_currency, 'rootId', p_root_id, 'enabled', p_enabled, 'expectedRevisionId', p_expected_revision_id::text
  ));
  v_existing_result := private.planning_replay(p_space_id, p_request_id, 'set_rollover_policy', v_actor, v_fingerprint);
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select id into v_head from public.rollover_policy_revisions
    where space_id = p_space_id and currency = p_currency and root_id = p_root_id
    order by id desc limit 1;
  if v_head is distinct from p_expected_revision_id then
    raise exception using errcode='40001', message='planning_stale_revision';
  end if;

  -- FOR SHARE serializes this read against a concurrent archive_category.
  select * into v_category from public.categories
    where id = p_root_id and space_id = p_space_id for share;
  if not found or v_category.kind <> 'expense' or v_category.parent_category_id is not null then
    raise exception using errcode='P0001', message='rollover_policy_requires_expense_root';
  end if;
  if p_enabled and v_category.archived_at is not null then
    raise exception using errcode='P0001', message='rollover_policy_archived_root';
  end if;

  insert into public.rollover_policy_revisions (space_id, currency, root_id, enabled, expected_revision_id, request_id, actor_id)
    values (p_space_id, p_currency, p_root_id, p_enabled, p_expected_revision_id, p_request_id, v_actor)
    returning id into v_revision_id;

  v_result := jsonb_build_object('revisionId', v_revision_id::text);
  insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
    values (p_space_id, p_request_id, 'set_rollover_policy', v_fingerprint, v_actor, v_result);
  return v_result;
end;
$$;


ALTER FUNCTION public.set_rollover_policy(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_root_id uuid, p_enabled boolean, p_expected_revision_id bigint) OWNER TO postgres;

--
-- Name: space_clock(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.space_clock(p_space_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  v_timezone text;
  v_payday integer;
  v_today date;
  v_period_start date;
begin
  if p_space_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  select space.timezone, greatest(1, least(31, space.payday_day))
    into v_timezone, v_payday
    from public.spaces as space where space.id = p_space_id;
  if v_timezone is null then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  v_today := private.space_today(p_space_id);
  v_period_start := private.space_period_start(p_space_id, now());
  return jsonb_build_object(
    'timezone', v_timezone,
    'today', v_today,
    'currentMonth', (date_trunc('month', v_period_start))::date,
    'paydayDay', v_payday,
    'periodStart', v_period_start,
    'periodEnd', (v_period_start + interval '1 month' - interval '1 day')::date
  );
end;
$$;


ALTER FUNCTION public.space_clock(p_space_id uuid) OWNER TO postgres;

--
-- Name: space_period_bounds(uuid, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.space_period_bounds(p_space_id uuid, p_month date) RETURNS TABLE(period_start date, period_end date)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
begin
  if p_space_id is null or p_month is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'planning_not_authorized';
  end if;
  return query select bounds.period_start, bounds.period_end
    from private.space_period_bounds(p_space_id, p_month) bounds;
end;
$$;


ALTER FUNCTION public.space_period_bounds(p_space_id uuid, p_month date) OWNER TO postgres;

--
-- Name: space_today(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.space_today(p_space_id uuid) RETURNS date
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
begin
  if p_space_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  return private.space_today(p_space_id);
end;
$$;


ALTER FUNCTION public.space_today(p_space_id uuid) OWNER TO postgres;

--
-- PostgreSQL database dump complete
--



-- Put the session settings the export changed back, so later migrations on this connection are unaffected.
select pg_catalog.set_config('search_path', '"$user", public, extensions', false);
reset statement_timeout; reset lock_timeout; reset idle_in_transaction_session_timeout; reset transaction_timeout;
reset check_function_bodies; reset row_security; reset client_min_messages; reset xmloption;
