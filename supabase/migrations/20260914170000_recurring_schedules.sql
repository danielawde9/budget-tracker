-- Recurring schedules and settlement (task 14): immutable bill/income/debt
-- schedules, a bounded materializer that turns an active definition into
-- dated occurrences, and settlement commands (skip/reopen/confirm/link) that
-- post through the existing record_financial_event /
-- record_categorized_financial_event / record_loan_repayment / task 10
-- link_goal_purchase primitives. No job posts money or sends reminders here.
-- Editing a schedule changes only not-yet-materialized dates; an already
-- materialized occurrence keeps its original amount/date/references forever.

create table public.schedules (
  id uuid primary key,
  space_id uuid not null references public.spaces(id) on delete restrict,
  currency public.currency_code not null,
  kind text not null check(kind in ('income','expense','debt_payment')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(id,space_id,currency)
);

create table public.schedule_revisions (
  id bigint generated always as identity primary key,
  schedule_id uuid not null, space_id uuid not null, currency public.currency_code not null,
  expected_revision_id bigint,
  state text not null check(state in ('active','paused','ended')),
  name_en text, name_ar text,
  expected_minor bigint not null check(expected_minor between 1 and 999999999999999),
  starts_on date not null,
  ends_on date,
  cadence text not null check(cadence in ('weekly','monthly','yearly')),
  interval_count integer not null check(interval_count between 1 and 12),
  category_id uuid,
  loan_id uuid,
  funding_goal_id uuid,
  preferred_wallet_id uuid,
  request_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(id,schedule_id,space_id,currency), unique(space_id,request_id),
  foreign key(schedule_id,space_id,currency) references public.schedules(id,space_id,currency) on delete restrict,
  foreign key(expected_revision_id,schedule_id,space_id,currency)
    references public.schedule_revisions(id,schedule_id,space_id,currency) on delete restrict,
  foreign key(category_id,space_id) references public.categories(id,space_id) on delete restrict,
  foreign key(loan_id,space_id) references public.loans(id,space_id) on delete restrict,
  foreign key(funding_goal_id,space_id,currency) references public.goals(id,space_id,currency) on delete restrict,
  foreign key(preferred_wallet_id,space_id) references public.wallets(id,space_id) on delete restrict,
  check(expected_revision_id is null or expected_revision_id < id),
  check((name_en is null or char_length(btrim(name_en)) between 1 and 80) is true),
  check((name_ar is null or char_length(btrim(name_ar)) between 1 and 80) is true),
  check(name_en is not null or name_ar is not null),
  check(ends_on is null or ends_on >= starts_on)
);
create unique index schedule_initial_idx on public.schedule_revisions(schedule_id) where expected_revision_id is null;
create unique index schedule_successor_idx on public.schedule_revisions(expected_revision_id) where expected_revision_id is not null;
create index schedule_revisions_current_idx on public.schedule_revisions(schedule_id,id desc);
create index schedule_revisions_category_idx on public.schedule_revisions(category_id) where category_id is not null;
create index schedule_revisions_loan_idx on public.schedule_revisions(loan_id) where loan_id is not null;
create index schedule_revisions_goal_idx on public.schedule_revisions(funding_goal_id) where funding_goal_id is not null;
create index schedule_revisions_wallet_idx on public.schedule_revisions(preferred_wallet_id) where preferred_wallet_id is not null;

create table public.scheduled_occurrences (
  id uuid primary key,
  schedule_id uuid not null, source_revision_id bigint not null,
  space_id uuid not null, currency public.currency_code not null,
  due_date date not null,
  expected_minor bigint not null check(expected_minor between 1 and 999999999999999),
  category_id uuid, loan_id uuid, funding_goal_id uuid, preferred_wallet_id uuid,
  request_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(schedule_id,due_date), unique(id,schedule_id,space_id), unique(id,space_id),
  foreign key(schedule_id,space_id,currency) references public.schedules(id,space_id,currency) on delete restrict,
  foreign key(source_revision_id,schedule_id,space_id,currency)
    references public.schedule_revisions(id,schedule_id,space_id,currency) on delete restrict,
  foreign key(category_id,space_id) references public.categories(id,space_id) on delete restrict,
  foreign key(loan_id,space_id) references public.loans(id,space_id) on delete restrict,
  foreign key(funding_goal_id,space_id,currency) references public.goals(id,space_id,currency) on delete restrict,
  foreign key(preferred_wallet_id,space_id) references public.wallets(id,space_id) on delete restrict
);
create index scheduled_occurrences_page_idx on public.scheduled_occurrences(space_id,due_date,id);
create index scheduled_occurrences_schedule_idx on public.scheduled_occurrences(schedule_id,due_date);
create index scheduled_occurrences_goal_idx on public.scheduled_occurrences(funding_goal_id) where funding_goal_id is not null;

create table public.occurrence_events (
  id bigint generated always as identity primary key,
  occurrence_id uuid not null, space_id uuid not null,
  expected_event_id bigint,
  action text not null check(action in ('skip','reopen','link','confirm')),
  linked_event_id uuid,
  link_amount_minor bigint,
  request_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(id,occurrence_id,space_id), unique(space_id,request_id),
  foreign key(occurrence_id,space_id) references public.scheduled_occurrences(id,space_id) on delete restrict,
  foreign key(expected_event_id,occurrence_id,space_id)
    references public.occurrence_events(id,occurrence_id,space_id) on delete restrict,
  foreign key(linked_event_id,space_id) references public.financial_events(id,space_id) on delete restrict,
  check(expected_event_id is null or expected_event_id < id),
  check(((action in ('link','confirm'))
    = (linked_event_id is not null and link_amount_minor is not null and link_amount_minor > 0)) is true)
);
create unique index occurrence_events_initial_idx on public.occurrence_events(occurrence_id) where expected_event_id is null;
create unique index occurrence_events_successor_idx on public.occurrence_events(expected_event_id) where expected_event_id is not null;
create index occurrence_events_occurrence_idx on public.occurrence_events(occurrence_id,id desc);
create index occurrence_events_linked_event_idx on public.occurrence_events(linked_event_id) where linked_event_id is not null;

-- Task 2: deferred cross-row validation, mirroring 09/10's
-- check_goal_definition / check_goal_milestone_event lesson: every adapter is
-- SECURITY DEFINER because a deferred constraint trigger fires at COMMIT,
-- after the SECURITY DEFINER command that did the insert has already
-- returned, back under the plain authenticated role which has no EXECUTE on
-- these revoked-from-everyone check functions.

create function private.check_schedule_revision(p_revision_id bigint)
returns void language plpgsql security definer set search_path = pg_catalog as $$
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
revoke all on function private.check_schedule_revision(bigint) from public, anon, authenticated, service_role;

create function private.check_schedule_revision_from_header()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform private.check_schedule_revision(new.id);
  return null;
end; $$;
revoke all on function private.check_schedule_revision_from_header() from public, anon, authenticated, service_role;

create constraint trigger schedule_revisions_publish_check
  after insert on public.schedule_revisions
  deferrable initially deferred for each row
  execute function private.check_schedule_revision_from_header();

create function private.check_occurrence_event(p_event_id bigint)
returns void language plpgsql security definer set search_path = pg_catalog as $$
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
revoke all on function private.check_occurrence_event(bigint) from public, anon, authenticated, service_role;

create function private.check_occurrence_event_from_row()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform private.check_occurrence_event(new.id);
  return null;
end; $$;
revoke all on function private.check_occurrence_event_from_row() from public, anon, authenticated, service_role;

create constraint trigger occurrence_events_publish_check
  after insert on public.occurrence_events
  deferrable initially deferred for each row
  execute function private.check_occurrence_event_from_row();

-- Task 3: common guards (task 03's generic private.planning_guard_insert /
-- private.planning_reject_mutation), FK/history indexes, RLS with no API
-- write policy, and privilege revocation on all four relations.

create trigger schedules_guard_insert before insert on public.schedules
  for each row execute function private.planning_guard_insert();
create trigger schedules_reject_mutation before update or delete or truncate on public.schedules
  for each statement execute function private.planning_reject_mutation();

create trigger schedule_revisions_guard_insert before insert on public.schedule_revisions
  for each row execute function private.planning_guard_insert();
create trigger schedule_revisions_reject_mutation before update or delete or truncate on public.schedule_revisions
  for each statement execute function private.planning_reject_mutation();

create trigger scheduled_occurrences_guard_insert before insert on public.scheduled_occurrences
  for each row execute function private.planning_guard_insert();
create trigger scheduled_occurrences_reject_mutation before update or delete or truncate on public.scheduled_occurrences
  for each statement execute function private.planning_reject_mutation();

create trigger occurrence_events_guard_insert before insert on public.occurrence_events
  for each row execute function private.planning_guard_insert();
create trigger occurrence_events_reject_mutation before update or delete or truncate on public.occurrence_events
  for each statement execute function private.planning_reject_mutation();

create index schedules_space_currency_idx on public.schedules(space_id,currency);

alter table public.schedules enable row level security;
alter table public.schedule_revisions enable row level security;
alter table public.scheduled_occurrences enable row level security;
alter table public.occurrence_events enable row level security;

revoke all on public.schedules from public, anon, authenticated, service_role;
revoke all on public.schedule_revisions from public, anon, authenticated, service_role;
revoke all on public.scheduled_occurrences from public, anon, authenticated, service_role;
revoke all on public.occurrence_events from public, anon, authenticated, service_role;

-- Task 4: read helpers shared by commands and the protected read below. Both
-- are STABLE, one statement, and never accept a client-supplied balance.

-- Net settlement for one occurrence as of a date, plus whether the latest
-- action is currently 'skip'. A later reversal of a linked/confirmed
-- financial event zeroes that link's contribution from the reversal's own
-- effective date onward; it appends no fictional occurrence event.
create function private.schedule_occurrence_settlement(p_occurrence_id uuid, p_as_of date)
returns table(settled_minor numeric, skipped boolean)
language plpgsql stable security definer set search_path = pg_catalog as $$
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
revoke all on function private.schedule_occurrence_settlement(uuid,date) from public, anon, authenticated, service_role;

-- Bounded candidate due-date generator: derives its starting offset from the
-- range start (never an unbounded ancient loop from the schedule's own
-- starts_on) and yields at most 92 candidates per schedule. The clamped
-- month/year day is always recomputed from the ORIGINAL starts_on day, never
-- from the previous due date, so Jan31 -> Feb28 -> Mar31 never gets stuck at 28.
create function private.schedule_candidate_due_dates(
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
  end if;
  return;
end;
$$;
revoke all on function private.schedule_candidate_due_dates(date,text,int,date,date,date) from public, anon, authenticated, service_role;

-- Deterministic occurrence identity from (schedule_id, due_date), reusing
-- task 03's planning_child_request digest derivation, so re-materializing an
-- already-covered range always resolves to the same row instead of a fresh
-- UUID racing the unique(schedule_id,due_date) business key.
create function private.schedule_occurrence_id(p_schedule_id uuid, p_due_date date)
returns uuid language sql immutable set search_path = pg_catalog as $$
  select private.planning_child_request(p_schedule_id, 'occurrence:' || p_due_date::text);
$$;
revoke all on function private.schedule_occurrence_id(uuid,date) from public, anon, authenticated, service_role;

-- Bounded candidate set for one materialization call: every currently active
-- schedule in the space, its current revision's copied references, and every
-- due date its cadence produces in [from,to].
create function private.schedule_occurrence_candidates(p_space_id uuid, p_from_date date, p_to_date date)
returns table(
  schedule_id uuid, space_id uuid, currency public.currency_code, source_revision_id bigint,
  category_id uuid, loan_id uuid, funding_goal_id uuid, preferred_wallet_id uuid,
  expected_minor bigint, due_date date
)
language sql stable security definer set search_path = pg_catalog as $$
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
revoke all on function private.schedule_occurrence_candidates(uuid,date,date) from public, anon, authenticated, service_role;

-- Task 5: commands. save_schedule creates (expected NULL, schedule absent)
-- or edits (expected must match the current head; currency/kind cannot
-- change -- kind lives only on the immutable schedules row and currency is
-- pinned by the schedule_revisions -> schedules composite FK, so neither can
-- drift once the first revision exists) using the generic IS DISTINCT FROM
-- head comparison from 01-sql-contract rather than special-cased branches.

create function public.save_schedule(
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
  if jsonb_typeof(p_definition->'cadence') is distinct from 'string' or (p_definition->>'cadence') not in ('weekly','monthly','yearly') then
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

create function public.materialize_schedule_occurrences(
  p_space_id uuid, p_request_id uuid, p_from_date date, p_to_date date
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions as $$
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
revoke all on function public.materialize_schedule_occurrences(uuid,uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.materialize_schedule_occurrences(uuid,uuid,date,date) to authenticated;

create function public.set_occurrence_state(
  p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_expected_event_id bigint, p_action text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions as $$
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
revoke all on function public.set_occurrence_state(uuid,uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.set_occurrence_state(uuid,uuid,uuid,bigint,text) to authenticated;

-- Confirmation algorithm (01's lock/replay order): authorize/space/request
-- lock -> receipt replay -> occurrence head comparison -> validate active
-- referenced identities -> invoke the existing generic/categorized/loan
-- posting primitive with a derived child request -> append one settlement
-- event -> optional same-transaction goal fulfillment through task 10's
-- link_goal_purchase -> append the parent receipt. Any failure rolls the
-- posted event, the settlement row, the goal link and the receipt back
-- together because this is all one function body / one transaction.
create function public.confirm_scheduled_occurrence(
  p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_expected_event_id bigint,
  p_actual_amount_minor text, p_effective_date date, p_wallet_id uuid
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions as $$
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
revoke all on function public.confirm_scheduled_occurrence(uuid,uuid,uuid,bigint,text,date,uuid) from public,anon,authenticated,service_role;
grant execute on function public.confirm_scheduled_occurrence(uuid,uuid,uuid,bigint,text,date,uuid) to authenticated;

-- Link-existing algorithm: lock the ORIGINAL financial event before checking
-- its kind, currency, loan identity, effective date and remaining eligible
-- amount (the same event-row lock order reverse_financial_event uses, so a
-- concurrent reversal on this exact row serializes against this command in
-- either order rather than racing an incompatible lock order).
create function public.link_scheduled_payment(
  p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_event_id uuid,
  p_amount_minor text, p_expected_event_id bigint
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions as $$
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
revoke all on function public.link_scheduled_payment(uuid,uuid,uuid,uuid,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.link_scheduled_payment(uuid,uuid,uuid,uuid,text,bigint) to authenticated;

-- Task 6: protected read. Range <=90 days, limit 1..100, tuple
-- (due_date,id) ascending, fetch limit+1, all-or-none cursor.
create function public.scheduled_occurrence_page(
  p_space_id uuid, p_from_date date, p_to_date date,
  p_after_due_date date default null, p_after_id uuid default null, p_limit int default 25
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, extensions set statement_timeout='10s' as $$
declare
  v_as_of date := (now() at time zone 'UTC')::date;
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
