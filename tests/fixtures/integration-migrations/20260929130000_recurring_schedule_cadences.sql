-- Schedule cadences (task 14 extension): add two recurrence types to the
-- recurring schedule engine.
--
--   * semimonthly: TWO occurrences per month, on the 1st and the 15th.
--     interval_count MUST be 1 for this cadence (rejected otherwise); the
--     "two per month" rule already fixes the interval, so any other value is
--     meaningless.
--   * monthly_last_business_day: monthly on the LAST Monday-Friday of the
--     month. interval_count is the number of months between occurrences
--     (1..12), exactly like `monthly`. There is no holiday calendar -- a
--     "business day" is Monday-Friday and nothing else.
--
-- Forward-only: the cadence CHECK is dropped and re-added with the two new
-- values, and both private.schedule_candidate_due_dates and
-- public.save_schedule are replaced. No existing migration is edited, no
-- existing row is rewritten, and no financial journal row is touched.

alter table public.schedule_revisions drop constraint schedule_revisions_cadence_check;
alter table public.schedule_revisions add constraint schedule_revisions_cadence_check
  check(cadence in ('weekly','monthly','yearly','semimonthly','monthly_last_business_day'));

-- Bounded candidate due-date generator: derives its starting offset from the
-- range start (never an unbounded ancient loop from the schedule's own
-- starts_on) and yields at most 92 candidates per schedule. The clamped
-- month/year day is always recomputed from the ORIGINAL starts_on day, never
-- from the previous due date, so Jan31 -> Feb28 -> Mar31 never gets stuck at 28.
-- The two new cadences keep every one of those guarantees:
--   * semimonthly walks months and emits the 1st then the 15th of each
--     interval month, in date order, applying the same starts_on / from_date /
--     ends_on filters to each candidate.
--   * monthly_last_business_day walks months and walks its due date back from
--     the month's last day while the weekday is Saturday(6) or Sunday(0).
create or replace function private.schedule_candidate_due_dates(
  p_starts_on date, p_cadence text, p_interval_count int, p_ends_on date, p_from_date date, p_to_date date
) returns setof date
language plpgsql immutable set search_path = pg_catalog as $$
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
revoke all on function private.schedule_candidate_due_dates(date,text,int,date,date,date) from public, anon, authenticated, service_role;

-- Task 5: commands. save_schedule creates (expected NULL, schedule absent)
-- or edits (expected must match the current head; currency/kind cannot
-- change -- kind lives only on the immutable schedules row and currency is
-- pinned by the schedule_revisions -> schedules composite FK, so neither can
-- drift once the first revision exists) using the generic IS DISTINCT FROM
-- head comparison from 01-sql-contract rather than special-cased branches.
-- This body is the current definition verbatim; the only changes are the
-- cadence allowlist and the semimonthly interval_count guard.
create or replace function public.save_schedule(
  p_space_id uuid, p_request_id uuid, p_schedule_id uuid, p_expected_revision_id bigint, p_definition jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions as $$
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
$$;
revoke all on function public.save_schedule(uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_schedule(uuid,uuid,uuid,bigint,jsonb) to authenticated;
