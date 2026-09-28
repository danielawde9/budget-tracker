-- W4a-1: one app clock + a per-space timezone (audit 2026-09-25 rank 11, E1/E2a/A7/D12).
--
-- Spaces get a validated IANA `timezone`. A single server helper
-- (`private.space_today`) derives the space's calendar date from `now()` in
-- that zone; the public read `public.space_clock` exposes the space's
-- timezone, current date and current month to the client. The UTC "today"
-- sites on the reads the client actually consumes are forward-fixed to the
-- space-zone date so the month, the as-of date and the "is it this month"
-- comparisons agree.
--
-- Payday anchoring (the period window anchored on a payday) is a later slice
-- (W4a-2) and is deliberately not implemented here.

alter table public.spaces
  add column timezone text not null default 'UTC';

comment on column public.spaces.timezone is
  'IANA time zone name (e.g. Asia/Beirut). Governs the space''s "today" and current month.';

create function private.validate_space_timezone()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.timezone
  ) then
    raise exception using errcode='23514', message='spaces_timezone_unknown';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_space_timezone()
  from public, anon, authenticated, service_role;

create trigger spaces_timezone_valid
  before insert or update of timezone on public.spaces
  for each row execute function private.validate_space_timezone();

-- The single source of "today". `space_date` is the pure form (testable with a
-- pinned instant); `space_today` is the production form anchored on now().
create function private.space_date(p_space_id uuid, p_at timestamptz)
returns date
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select (p_at at time zone coalesce(
    (select space.timezone from public.spaces as space where space.id = p_space_id),
    'UTC'
  ))::date;
$$;
revoke all on function private.space_date(uuid, timestamptz)
  from public, anon, authenticated, service_role;

create function private.space_today(p_space_id uuid)
returns date
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select private.space_date(p_space_id, now());
$$;
revoke all on function private.space_today(uuid)
  from public, anon, authenticated, service_role;

create function public.space_today(p_space_id uuid)
returns date
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
begin
  if p_space_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  return private.space_today(p_space_id);
end;
$$;
revoke all on function public.space_today(uuid) from public, anon, authenticated, service_role;
grant execute on function public.space_today(uuid) to authenticated;

create function public.space_clock(p_space_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_timezone text;
  v_today date;
begin
  if p_space_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  select space.timezone into v_timezone from public.spaces as space where space.id = p_space_id;
  if v_timezone is null then
    raise exception using errcode='42501', message='planning_not_authorized';
  end if;
  v_today := private.space_today(p_space_id);
  return jsonb_build_object(
    'timezone', v_timezone,
    'today', v_today,
    'currentMonth', date_trunc('month', v_today)::date
  );
end;
$$;
revoke all on function public.space_clock(uuid) from public, anon, authenticated, service_role;
grant execute on function public.space_clock(uuid) to authenticated;

-- Forward-fix (reads the client consumes): as-of date and current month in the space's zone.

create or replace function public.available_cash_summary(
  p_space_id uuid, p_currency public.currency_code, p_as_of_date date
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, extensions set statement_timeout='10s' as $$
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
revoke all on function public.available_cash_summary(uuid,public.currency_code,date)
  from public, anon, authenticated, service_role;
grant execute on function public.available_cash_summary(uuid,public.currency_code,date) to authenticated;

create or replace function public.cash_outlook(
  p_space_id uuid, p_currency public.currency_code, p_start_date date, p_days integer, p_scenario text
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, extensions set statement_timeout='10s' as $$
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
revoke all on function public.cash_outlook(uuid,public.currency_code,date,integer,text)
  from public, anon, authenticated, service_role;
grant execute on function public.cash_outlook(uuid,public.currency_code,date,integer,text) to authenticated;

create or replace function public.scheduled_occurrence_page(
  p_space_id uuid, p_from_date date, p_to_date date,
  p_after_due_date date default null, p_after_id uuid default null, p_limit int default 25
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, extensions set statement_timeout='10s' as $$
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
revoke all on function public.scheduled_occurrence_page(uuid,date,date,date,uuid,int) from public,anon,authenticated,service_role;
grant execute on function public.scheduled_occurrence_page(uuid,date,date,date,uuid,int) to authenticated;

create or replace function public.scheduled_overdue_page(
  p_space_id uuid, p_after_due_date date default null, p_after_id uuid default null, p_limit int default 50
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog set statement_timeout = '10s' as $$
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
revoke all on function public.scheduled_overdue_page(uuid,date,uuid,int) from public,anon,authenticated,service_role;
grant execute on function public.scheduled_overdue_page(uuid,date,uuid,int) to authenticated;
