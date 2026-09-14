-- Goal projections (task 11): truthful cash coverage, monthly contribution,
-- and milestone progress over task 10's commands -- read-only, no posting.

-- Task 1: bounded relevant-goal set with financing state. Never truncates
-- before allocating coverage: counts first, raises if the space/currency
-- has more than 200 relevant goals.
create function private.goal_relevant_set(p_space_id uuid, p_currency public.currency_code, p_as_of date)
returns table(
  goal_id uuid, revision_id bigint, kind text, state text, name_en text, name_ar text,
  target_minor bigint, deadline date, contribution_mode text, monthly_minor bigint,
  priority integer, created_at timestamptz,
  earmarked_minor numeric, fulfilled_minor numeric, head text
)
language plpgsql stable security definer set search_path = pg_catalog as $$
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
revoke all on function private.goal_relevant_set(uuid, public.currency_code, date) from public, anon, authenticated, service_role;

-- Coverage: prior-claim window ordered priority,created_at,goal_id exactly
-- as given; least(earmarked, greatest(pool-priorClaims,0)) so covered never
-- exceeds either the goal's own claim or the space's actual cash.
create function private.goal_coverage_set(p_space_id uuid, p_currency public.currency_code, p_as_of date)
returns table(
  goal_id uuid, revision_id bigint, kind text, state text, name_en text, name_ar text,
  target_minor bigint, deadline date, contribution_mode text, monthly_minor bigint,
  priority integer, created_at timestamptz,
  earmarked_minor numeric, fulfilled_minor numeric, head text, covered_minor numeric
)
language sql stable security definer set search_path = pg_catalog as $$
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
revoke all on function private.goal_coverage_set(uuid, public.currency_code, date) from public, anon, authenticated, service_role;

-- Per-goal, per-month figures that don't belong in the space-wide coverage
-- pass: the declared monthly target, the actual signed net earmark movement
-- that month, the deadline-implied suggestion, and a pace-based forecast.
create function private.goal_monthly_extras(
  p_goal_id uuid, p_kind text, p_target_minor bigint, p_deadline date,
  p_covered_minor numeric, p_fulfilled_minor numeric, p_month date
) returns table(
  monthly_target_minor bigint, monthly_net_contribution_minor numeric,
  suggested_monthly_minor bigint, forecast_month date, forecast_state text
)
language plpgsql stable security definer set search_path = pg_catalog as $$
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
revoke all on function private.goal_monthly_extras(uuid, text, bigint, date, numeric, numeric, date) from public, anon, authenticated, service_role;

-- Task 2: public read RPCs -----------------------------------------------

create function public.goal_page(
  p_space_id uuid, p_currency public.currency_code, p_state_filter text,
  p_after_created_at timestamptz default null, p_after_id uuid default null, p_limit integer default 25
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, extensions set statement_timeout='10s' as $$
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
revoke all on function public.goal_page(uuid, public.currency_code, text, timestamptz, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.goal_page(uuid, public.currency_code, text, timestamptz, uuid, integer) to authenticated;

create function public.goal_detail(p_space_id uuid, p_goal_id uuid, p_month date)
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, extensions set statement_timeout='10s' as $$
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
revoke all on function public.goal_detail(uuid, uuid, date) from public, anon, authenticated, service_role;
grant execute on function public.goal_detail(uuid, uuid, date) to authenticated;

create function public.goal_history_page(
  p_space_id uuid, p_goal_id uuid, p_before_created_at timestamptz default null,
  p_before_source_kind text default null, p_before_source_id text default null, p_limit integer default 25
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, extensions set statement_timeout='10s' as $$
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
revoke all on function public.goal_history_page(uuid, uuid, timestamptz, text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.goal_history_page(uuid, uuid, timestamptz, text, text, integer) to authenticated;

-- Task 3: goal monthly snapshot integration -------------------------------

alter table public.allocation_month_snapshots
  add column goal_line_count integer not null default 0 check (goal_line_count between 0 and 100);

create table public.allocation_month_goal_lines (
  snapshot_id bigint not null, goal_id uuid not null,
  space_id uuid not null, currency public.currency_code not null,
  month_start date not null, group_id uuid,
  target_revision_id bigint not null,
  amount_minor bigint not null check(amount_minor between 0 and 999999999999999),
  primary key(snapshot_id,goal_id),
  foreign key(snapshot_id,space_id,currency,month_start)
    references public.allocation_month_snapshots(id,space_id,currency,month_start) on delete restrict,
  foreign key(snapshot_id,group_id,space_id,currency)
    references public.allocation_month_groups(snapshot_id,group_id,space_id,currency) on delete restrict,
  foreign key(target_revision_id,goal_id,space_id,currency,month_start)
    references public.goal_monthly_target_revisions(id,goal_id,space_id,currency,month_start) on delete restrict
);
create index allocation_month_goal_lines_goal_idx on public.allocation_month_goal_lines(goal_id,space_id,currency);
create index allocation_month_goal_lines_group_idx on public.allocation_month_goal_lines(group_id,space_id,currency);

-- Forward-fix (task 05's own committed migration file is not edited):
-- extend the deferred snapshot check with the goal-line count, each line's
-- exact amount against its own declared revision, and Future-only group
-- linkage -- mirroring the existing root/commitment checks exactly.
create or replace function private.check_allocation_month(p_snapshot_id bigint)
returns void language plpgsql security definer set search_path = pg_catalog as $$
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

create function private.check_allocation_month_from_goal_line()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform private.check_allocation_month(new.snapshot_id);
  return null;
end; $$;
revoke all on function private.check_allocation_month_from_goal_line() from public, anon, authenticated, service_role;
create constraint trigger allocation_month_goal_lines_publish_check
  after insert on public.allocation_month_goal_lines
  deferrable initially deferred for each row
  execute function private.check_allocation_month_from_goal_line();

alter table public.allocation_month_goal_lines enable row level security;
create trigger allocation_month_goal_lines_guard_insert before insert on public.allocation_month_goal_lines
  for each row execute function private.planning_guard_insert();
create trigger allocation_month_goal_lines_reject_mutation before update or delete or truncate on public.allocation_month_goal_lines
  for each statement execute function private.planning_reject_mutation();
revoke all on public.allocation_month_goal_lines from public, anon, authenticated, service_role;

-- Forward-fix: v1 has no way to represent a goal target, so it must refuse
-- to publish over an existing positive goal monthly target it would
-- otherwise silently omit from the new snapshot -- old clients cannot
-- accidentally erase a goal's monthly commitment.
create or replace function public.publish_allocation_month(
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
$$;

-- publish_allocation_month_v2: task 05's exact arguments plus a required
-- p_goal_targets jsonb (goalId,groupId nullable,amountMinor,expectedRevisionId).
-- Not an overload of v1 with a default -- a distinct function, per the task's
-- own instruction, so old and new clients are never ambiguous about which
-- one they called.
create function public.publish_allocation_month_v2(
  p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code,
  p_expected_snapshot_id bigint, p_template_revision_id bigint,
  p_expected_income_revision_id bigint, p_income_minor text,
  p_root_targets jsonb, p_loan_group_id uuid, p_goal_targets jsonb
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
$$;
revoke all on function public.publish_allocation_month_v2(uuid,uuid,date,public.currency_code,bigint,bigint,bigint,text,jsonb,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.publish_allocation_month_v2(uuid,uuid,date,public.currency_code,bigint,bigint,bigint,text,jsonb,uuid,jsonb)
  to authenticated;

-- Forward-fix: extend allocation_month_state's Future-group actual to
-- include monthly signed net goal contributions (debt paid + goal
-- movement), and leftToAllocate to subtract standalone goal targets and a
-- Future excess generalized across every Future group (not only the single
-- loan-linked one), each exactly once.
create or replace function public.allocation_month_state(
  p_space_id uuid, p_month date, p_currency public.currency_code, p_snapshot_id bigint default null
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, extensions set statement_timeout='10s' as $$
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
  v_uncategorized_actual numeric := 0;
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

    v_left_to_allocate := v_snapshot.unallocated_minor - v_standalone_root_targets - v_standalone_goal_targets - v_standalone_debt - v_future_excess;

    -- Real group rows: spending groups' actual is root-mapped expense
    -- activity; a future group's actual is its linked debt commitment plus
    -- the monthly signed net earmark movement of every goal whose current
    -- monthly target links to it.
    v_groups := (
      select coalesce(jsonb_agg(jsonb_build_object(
        'groupId', month_group.group_id, 'rowKind', month_group.purpose,
        'nameEn', month_group.name_en, 'nameAr', month_group.name_ar, 'order', month_group.display_order,
        'targetMinor', month_group.target_minor::text,
        'actualMinor', (case when month_group.purpose = 'future' then coalesce(commitment_actual.observed_actual_minor, 0) + coalesce(goal_actual.actual, 0)
          else coalesce(group_actual.actual, 0) end)::text,
        'varianceMinor', (month_group.target_minor - (case when month_group.purpose = 'future' then coalesce(commitment_actual.observed_actual_minor, 0) + coalesce(goal_actual.actual, 0)
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
    'targetMinor', v_unmapped_target::text, 'actualMinor', v_unmapped_actual::text,
    'varianceMinor', (v_unmapped_target - v_unmapped_actual)::text, 'basisPoints', null,
    'actualShareOfIncomeBps', case when v_actual_income > 0 then floor(v_unmapped_actual * 10000 / v_actual_income)::text else null end,
    'hasPlan', v_unmapped_target <> 0
  ));
  v_groups := v_groups || jsonb_build_array(jsonb_build_object(
    'groupId', null, 'rowKind', 'uncategorized', 'nameEn', null, 'nameAr', null, 'order', null,
    'targetMinor', null, 'actualMinor', v_uncategorized_actual::text, 'varianceMinor', null, 'basisPoints', null,
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
    'childPlanChanged', v_child_plan_changed, 'asOf', now(), 'groups', v_groups
  );
  return v_result;
end;
$$;
