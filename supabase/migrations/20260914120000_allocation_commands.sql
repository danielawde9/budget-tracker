-- Allocation commands (task 05): exact apportionment arithmetic, then the two
-- public commands that write templates and publish monthly snapshots. All
-- domain tables already exist (task 04).

create function private.allocate_planning_income(p_income text,p_groups jsonb)
returns table(group_id uuid,target_minor bigint,is_residual boolean)
language plpgsql immutable set search_path=pg_catalog as $$
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
end; $$;
revoke all on function private.allocate_planning_income(text,jsonb)
  from public,anon,authenticated,service_role;

-- Forward fix (found while building task 05's real command path, not by
-- task 04's own tests, which only ever raw-inserted as the table owner): a
-- deferred constraint trigger fires at COMMIT, outside any calling function's
-- stack -- so once a SECURITY DEFINER command like save_allocation_template
-- below has returned, its deferred trigger runs back under the plain
-- 'authenticated' session role, not the elevated definer role. These seven
-- adapters called SECURITY DEFINER private.check_allocation_template/month,
-- whose EXECUTE is revoked from authenticated, as SECURITY INVOKER -- so
-- every deferred check failed with "permission denied" the moment a real
-- command (not a raw owner insert) touched these tables. CREATE OR REPLACE
-- only; 20260914110000_allocation_schema.sql is not edited.
-- Forward strengthening of task 04's group-target check (task 05 item 5):
-- the aggregate sum+bps check alone would accept a snapshot whose per-group
-- amounts don't actually match private.allocate_planning_income's own
-- largest-remainder distribution, as long as they summed correctly. Compare
-- every group's (and the residual's) exact computed amount, not just the
-- total. Everything else in this function is unchanged from task 04.
create or replace function private.check_allocation_month(p_snapshot_id bigint)
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_snapshot public.allocation_month_snapshots%rowtype;
  v_group_count integer;
  v_root_count integer;
  v_loan_line_count integer;
  v_target_sum bigint;
  v_bps_sum integer;
  v_group_problems integer;
  v_root_problems integer;
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

  select count(*) into v_over_target_groups
  from (
    select month_group.group_id, month_group.target_minor, coalesce(sum(root.target_minor),0) as root_total
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

create or replace function private.check_allocation_template_from_header()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform private.check_allocation_template(new.id);
  return null;
end; $$;
create or replace function private.check_allocation_template_from_line()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform private.check_allocation_template(new.template_id);
  return null;
end; $$;
create or replace function private.check_allocation_template_from_root()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform private.check_allocation_template(new.template_id);
  return null;
end; $$;
create or replace function private.check_allocation_month_from_header()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform private.check_allocation_month(new.id);
  return null;
end; $$;
create or replace function private.check_allocation_month_from_group()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform private.check_allocation_month(new.snapshot_id);
  return null;
end; $$;
create or replace function private.check_allocation_month_from_root()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform private.check_allocation_month(new.snapshot_id);
  return null;
end; $$;
create or replace function private.check_allocation_month_from_commitment()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform private.check_allocation_month(new.snapshot_id);
  return null;
end; $$;

-- Task 2: save_allocation_template. Validates and canonicalizes groups and
-- root mappings, replays via the task 03 receipt ledger, checks the revision
-- head, locks referenced categories, upserts only unseen group identities
-- (never silently reusing a foreign one), and inserts the new template
-- header + lines under the space lock task 03 added to this family.
create function public.save_allocation_template(
  p_space_id uuid, p_request_id uuid, p_currency public.currency_code,
  p_expected_revision_id bigint, p_groups jsonb, p_root_mappings jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions as $$
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
$$;
revoke all on function public.save_allocation_template(uuid,uuid,public.currency_code,bigint,jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.save_allocation_template(uuid,uuid,public.currency_code,bigint,jsonb,jsonb)
  to authenticated;

-- Task 3: publish_allocation_month. Computes apportionment from the chosen
-- template, enforces the complete-set root rule, calls the existing
-- set_monthly_income_plan/set_monthly_category_target commands with
-- deterministic child request IDs (task 03's private.planning_child_request),
-- and publishes an immutable snapshot from their returned revision IDs.
create function public.publish_allocation_month(
  p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code,
  p_expected_snapshot_id bigint, p_template_revision_id bigint,
  p_expected_income_revision_id bigint, p_income_minor text,
  p_root_targets jsonb, p_loan_group_id uuid
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions as $$
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
    base_income_minor, unallocated_minor, group_count, root_count, loan_line_count, request_id, actor_id
  ) values (
    p_space_id, p_currency, v_month, p_template_revision_id, v_income_id, p_expected_snapshot_id,
    v_income_minor,
    (select coalesce((g->>'targetMinor')::bigint, 0) from jsonb_array_elements(v_group_targets) g where (g->>'isResidual')::boolean is true),
    (select count(*) from jsonb_array_elements(v_group_targets) g where (g->>'isResidual')::boolean is not true),
    jsonb_array_length(v_canonical_roots), 1, p_request_id, v_actor
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
$$;
revoke all on function public.publish_allocation_month(uuid,uuid,date,public.currency_code,bigint,bigint,bigint,text,jsonb,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.publish_allocation_month(uuid,uuid,date,public.currency_code,bigint,bigint,bigint,text,jsonb,uuid)
  to authenticated;
