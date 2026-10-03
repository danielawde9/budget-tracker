-- Goal commands (task 10): atomic, authorized, request-idempotent goal
-- definition/milestone/funding commands over task 09's schema. No wallet
-- posting is ever written here; earmarks are an advisory ledger only.

-- Task 3: point-in-time financing state and cash pool. Both are STABLE, one
-- statement, and never accept a client-supplied balance.

-- earmarked/fulfilled as of a date, plus an opaque SHA-256 stale token built
-- from every fact that can change the answer -- including a later financial
-- reversal that inserts no new planning row at all.
create function private.goal_financing_state(p_goal_id uuid, p_as_of date)
returns table(earmarked_minor numeric, fulfilled_minor numeric, head text)
language plpgsql stable security definer set search_path = pg_catalog, extensions as $$
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
revoke all on function private.goal_financing_state(uuid, date) from public, anon, authenticated, service_role;

-- Signed sum of all same-space/currency wallet movements as of a date -- the
-- real, reconstructible cash position. No per-wallet floor, no float, no
-- excluded wallet kind.
create function private.goal_cash_pool(p_space_id uuid, p_currency public.currency_code, p_as_of date)
returns numeric language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(sum(m.amount_minor), 0)::numeric
  from public.wallet_movements m
  join public.wallets w on w.id = m.wallet_id and w.space_id = m.space_id
  join public.financial_events e on e.id = m.event_id and e.space_id = m.space_id
  where m.space_id = p_space_id and w.currency = p_currency and e.effective_date <= p_as_of;
$$;
revoke all on function private.goal_cash_pool(uuid, public.currency_code, date) from public, anon, authenticated, service_role;

-- Sum of goal_financing_state.earmarked_minor across every goal in a
-- space/currency as of a date, in one statement (never looped per goal).
create function private.goal_space_earmarked_total(p_space_id uuid, p_currency public.currency_code, p_as_of date)
returns numeric language sql stable security definer set search_path = pg_catalog as $$
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
revoke all on function private.goal_space_earmarked_total(uuid, public.currency_code, date) from public, anon, authenticated, service_role;

-- Task 2: goal definitions and monthly targets.

create function public.create_goal_plan(
  p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_definition jsonb, p_milestones jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions as $$
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
$$;
revoke all on function public.create_goal_plan(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_goal_plan(uuid,uuid,uuid,jsonb,jsonb) to authenticated;

create function public.revise_goal_plan(
  p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_expected_revision_id bigint,
  p_definition jsonb, p_milestones jsonb, p_state text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions as $$
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
$$;
revoke all on function public.revise_goal_plan(uuid,uuid,uuid,bigint,jsonb,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.revise_goal_plan(uuid,uuid,uuid,bigint,jsonb,jsonb,text) to authenticated;

create function public.set_goal_monthly_target(
  p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_month date, p_amount_minor text, p_expected_revision_id bigint
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions as $$
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
revoke all on function public.set_goal_monthly_target(uuid,uuid,uuid,date,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.set_goal_monthly_target(uuid,uuid,uuid,date,text,bigint) to authenticated;

create function public.set_goal_milestone_state(
  p_space_id uuid, p_request_id uuid, p_milestone_id uuid, p_action text, p_expected_event_id bigint
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions as $$
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
revoke all on function public.set_goal_milestone_state(uuid,uuid,uuid,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.set_goal_milestone_state(uuid,uuid,uuid,text,bigint) to authenticated;

-- Task 4: funding operations.

-- Forward fix (task 09's own check was written before this task's explicit
-- rule existed): a reverse operation restores history and must never be
-- capped by a since-reduced target -- only a genuinely new funding intent
-- (reserve, or the destination side of a move) is checked against the
-- ceiling. 20260914140000_goals_schema.sql is not edited.
create or replace function private.check_goal_earmark_event(p_event_id bigint)
returns void language plpgsql security definer set search_path = pg_catalog as $$
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
begin
  select * into v_event from public.goal_earmark_events where id = p_event_id for update;
  if not found then
    raise exception using errcode='23514', message='goal_earmark_event_missing';
  end if;

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

  select count(*) into v_bad_balance
  from (
    select el.goal_id, sum(el.amount_minor) as event_contribution,
      (select coalesce(sum(amount_minor),0) from public.goal_earmark_lines where goal_id = el.goal_id) as running_balance,
      (select target_minor from public.goal_revisions where goal_id = el.goal_id order by id desc limit 1) as target,
      (select coalesce(sum(amount_minor),0) from public.goal_purchase_links where goal_id = el.goal_id) as fulfilled
    from public.goal_earmark_lines el
    where el.event_id = p_event_id
    group by el.goal_id
  ) totals
  where running_balance < 0
    or (v_event.operation <> 'reverse' and event_contribution > 0 and running_balance > (target - fulfilled));
  if v_bad_balance <> 0 then
    raise exception using errcode='23514', message='goal_earmark_balance_invalid';
  end if;
end;
$$;
revoke all on function private.check_goal_earmark_event(bigint) from public, anon, authenticated, service_role;

create function public.record_goal_earmark(
  p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_action text, p_amount_minor text,
  p_expected_head text, p_accept_underfunded boolean
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions as $$
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
$$;
revoke all on function public.record_goal_earmark(uuid,uuid,uuid,text,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.record_goal_earmark(uuid,uuid,uuid,text,text,text,boolean) to authenticated;

create function public.move_goal_earmark(
  p_space_id uuid, p_request_id uuid, p_from_goal_id uuid, p_to_goal_id uuid, p_amount_minor text,
  p_expected_from_head text, p_expected_to_head text, p_accept_underfunded boolean
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions as $$
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
$$;
revoke all on function public.move_goal_earmark(uuid,uuid,uuid,uuid,text,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.move_goal_earmark(uuid,uuid,uuid,uuid,text,text,text,boolean) to authenticated;

create function public.reverse_goal_earmark(
  p_space_id uuid, p_request_id uuid, p_event_id bigint, p_expected_heads jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions as $$
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
$$;
revoke all on function public.reverse_goal_earmark(uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.reverse_goal_earmark(uuid,uuid,bigint,jsonb) to authenticated;

create function public.link_goal_purchase(
  p_space_id uuid, p_request_id uuid, p_expense_event_id uuid, p_lines jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions as $$
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
$$;
revoke all on function public.link_goal_purchase(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.link_goal_purchase(uuid,uuid,uuid,jsonb) to authenticated;
