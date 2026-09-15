-- Available cash and cash outlook (task 17): read-only DB projections over
-- allocation (task 06), goals (task 11) and recurring schedules (task 14).
-- No money writer, persisted balance or mandatory reserve is introduced --
-- every function here is STABLE and reads existing tables only.

-- Task 2a: goal-to-bill coverage. Allocates each relevant purchase goal's
-- already-computed cash coverage (private.goal_coverage_set, task 11) across
-- its own linked unpaid occurrences, oldest due_date/id first, so each goal
-- minor unit ever covers at most one bill. A window-function running sum
-- (the same "prior claims" trick private.goal_coverage_set itself uses)
-- replaces a per-goal loop, so the whole allocation is one indexed scan.
create function private.planning_goal_bill_coverage(
  p_space_id uuid, p_currency public.currency_code, p_as_of date, p_horizon_end date
) returns table(occurrence_id uuid, goal_id uuid, applied_minor numeric)
language sql stable security definer set search_path = pg_catalog as $$
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
revoke all on function private.planning_goal_bill_coverage(uuid,public.currency_code,date,date)
  from public, anon, authenticated, service_role;

-- Task 2b: per-spending-group and per-standalone-root bill/budget buckets.
-- A spending group's B is computed ONCE at the GROUP level (its saved
-- allocation_month_groups.target_minor less spend rolled up across every
-- root mapped to it) -- never by re-using an individual root's own target,
-- which would be wrong the moment a group has more than one mapped root.
-- An unmapped root (has a saved target but no group) or a rootless bill (no
-- category, or a category never given a target at all) each form their own
-- standalone bucket per the brief. Q is computed PER BUCKET here -- never
-- combined first -- because max(B,O)-min(G,max(B,O)) does not distribute
-- over a sum of separate B/O/G pairs; only the resulting Q values may be
-- summed by the caller.
create function private.planning_expense_buckets(
  p_space_id uuid, p_currency public.currency_code, p_as_of date, p_month_end date, p_horizon_end date
) returns table(
  group_id uuid, root_id uuid,
  budget_remaining_minor numeric, unpaid_bills_minor numeric, goal_overlap_minor numeric, commitment_minor numeric
)
language sql stable security definer set search_path = pg_catalog as $$
  with snapshot as (
    select id from public.allocation_month_snapshots
    where space_id = p_space_id and currency = p_currency and month_start = date_trunc('month', p_as_of)::date
    order by id desc limit 1
  ), root_targets as (
    select r.category_id as root_id, r.group_id, r.target_minor
    from public.allocation_month_roots r
    where r.snapshot_id = (select id from snapshot)
  ), group_targets as (
    select g.group_id, g.target_minor
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
    -- Roll every mapped root's spend/bills up to its ONE shared group budget.
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
    -- A root (or root_id null = truly uncategorized) with unpaid bills but
    -- no saved target row at all: B=0, its own standalone obligation bucket.
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
revoke all on function private.planning_expense_buckets(uuid,public.currency_code,date,date,date)
  from public, anon, authenticated, service_role;

-- Task 2c: Future-group commitment buckets. One row per Future group in the
-- current month's saved snapshot, plus one synthetic standalone row
-- (group_id null) for goals/debt not linked to any group. debtCommitment is
-- max(D,O_debt) summed per loan (never D+O_debt): a loan with no matching
-- schedule contributes O_debt_loan=0 so max()=D_loan passes through
-- unchanged, and a loan with no reservation contributes D_loan=0 so
-- max()=O_debt_loan passes through unchanged -- "match by loan ID before
-- grouping" falls out of doing the max() per loan_id before the sum, with no
-- separate "residual pool" bookkeeping required. U and the group-target
-- subtraction inside headroom both use the goal's SAVED (snapshot) monthly
-- target, never a live target that may have drifted since publish --
-- available_cash_summary flags that drift itself via needsReview.
create function private.planning_cash_commitments(p_space_id uuid, p_currency public.currency_code, p_as_of date)
returns table(
  group_id uuid, group_target_minor numeric,
  debt_commitment_minor numeric, goal_topups_minor numeric,
  saved_goal_targets_minor numeric, original_debt_commitment_minor numeric
)
language plpgsql stable security definer set search_path = pg_catalog as $$
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
revoke all on function private.planning_cash_commitments(uuid,public.currency_code,date)
  from public, anon, authenticated, service_role;

-- Task 2d: bounded detection of missing materialization in a date window --
-- reused identically by available_cash_summary (90-day window from today)
-- and cash_outlook (the requested window). Never materializes; only counts.
create function private.planning_materialization_gap(p_space_id uuid, p_currency public.currency_code, p_from date, p_to date)
returns integer language sql stable security definer set search_path = pg_catalog as $$
  select count(*)::integer
  from private.schedule_occurrence_candidates(p_space_id, p_from, p_to) c
  where c.currency = p_currency
    and not exists (
      select 1 from public.scheduled_occurrences so where so.schedule_id = c.schedule_id and so.due_date = c.due_date
    );
$$;
revoke all on function private.planning_materialization_gap(uuid,public.currency_code,date,date)
  from public, anon, authenticated, service_role;

create function private.planning_unpaid_backlog_count(p_space_id uuid, p_currency public.currency_code, p_as_of date, p_to date)
returns integer language sql stable security definer set search_path = pg_catalog as $$
  select count(*)::integer
  from public.scheduled_occurrences so
  cross join lateral private.schedule_occurrence_settlement(so.id, p_as_of) stl
  where so.space_id = p_space_id and so.currency = p_currency and so.due_date <= p_to
    and not stl.skipped and greatest(so.expected_minor - stl.settled_minor, 0) > 0;
$$;
revoke all on function private.planning_unpaid_backlog_count(uuid,public.currency_code,date,date)
  from public, anon, authenticated, service_role;

-- Task 2e: public read RPC -- available_cash_summary. v1: current-date only
-- (p_as_of_date must equal DB UTC today); historical reconstruction is out
-- of scope. availableMinor/deficitMinor/spendableMinor/dailyExtraGuideMinor
-- and expenseCommitmentsMinor/debtCommitmentsMinor/goalTopupsMinor/
-- futureHeadroomMinor are NULL whenever state is not 'ready' -- never a
-- guessed number. groups=[] in that case too, for the same reason.
create function public.available_cash_summary(
  p_space_id uuid, p_currency public.currency_code, p_as_of_date date
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, extensions set statement_timeout='10s' as $$
declare
  v_today date := (now() at time zone 'UTC')::date;
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
revoke all on function public.available_cash_summary(uuid,public.currency_code,date)
  from public, anon, authenticated, service_role;
grant execute on function public.available_cash_summary(uuid,public.currency_code,date) to authenticated;

-- Task 2f: public read RPC -- cash_outlook. Income only ever uses unpaid
-- SCHEDULED income occurrences, never the monthly planned income figure --
-- a household with no scheduled/actual salary never sees an invented
-- inflow. Goal earmarks are advisory and never appear on the cash line.
-- Overdue unpaid obligations are bucketed into today's own outflow (via
-- greatest(due_date,start_date) below, same as any due-today item), but
-- that alone leaves a big unexplained day-0 outflow -- overdueCount/
-- overdueMinor and the assumption text make the "why" explicit, per the
-- brief's own "bucketed today with explicit overdue label/count".
create function public.cash_outlook(
  p_space_id uuid, p_currency public.currency_code, p_start_date date, p_days integer, p_scenario text
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, extensions set statement_timeout='10s' as $$
declare
  v_today date := (now() at time zone 'UTC')::date;
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
      then format(' Today''s outflow includes %s overdue unpaid bill%s totaling %s already past due.',
        v_overdue_count, case when v_overdue_count = 1 then '' else 's' end, v_overdue_minor::text)
      else '' end;

  with days as (
    select gs.day_offset from generate_series(0, p_days - 1) as gs(day_offset)
  ), day_dates as (
    select days.day_offset, (p_start_date + days.day_offset)::date as day_date from days
  ), income_by_day as (
    select greatest(so.due_date, p_start_date) as bucket_date,
      sum(greatest(so.expected_minor - stl.settled_minor, 0)) as amount_minor
    from public.scheduled_occurrences so
    join public.schedules sch on sch.id = so.schedule_id and sch.space_id = p_space_id and sch.kind = 'income'
    cross join lateral private.schedule_occurrence_settlement(so.id, p_start_date) stl
    where so.space_id = p_space_id and so.currency = p_currency and p_scenario = 'expected'
      and not stl.skipped and greatest(so.expected_minor - stl.settled_minor, 0) > 0
      and greatest(so.due_date, p_start_date) <= v_end_date
    group by greatest(so.due_date, p_start_date)
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
revoke all on function public.cash_outlook(uuid,public.currency_code,date,integer,text)
  from public, anon, authenticated, service_role;
grant execute on function public.cash_outlook(uuid,public.currency_code,date,integer,text) to authenticated;
