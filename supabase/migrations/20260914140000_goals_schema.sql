-- Goals and milestone schema (task 09): constrained goals, full milestone
-- definitions as children of a versioned goal_revisions snapshot, checklist
-- completion history, an advisory earmark ledger, and purchase associations.
-- Schema and deferred validation only -- no RPC/public command in this
-- migration (task 10). No posting function is changed by this schema file.

create table public.goals (
  id uuid primary key,
  space_id uuid not null references public.spaces(id) on delete restrict,
  currency public.currency_code not null,
  kind text not null check(kind in ('reserve','purchase')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(id,space_id,currency)
);

create table public.goal_revisions (
  id bigint generated always as identity primary key,
  goal_id uuid not null, space_id uuid not null, currency public.currency_code not null,
  expected_revision_id bigint,
  name_en text, name_ar text, note text,
  target_minor bigint not null check(target_minor between 1 and 999999999999999),
  deadline date,
  contribution_mode text not null check(contribution_mode in ('manual_monthly','by_deadline')),
  monthly_minor bigint,
  priority integer not null check(priority between 0 and 999),
  state text not null check(state in ('active','paused','closed')),
  milestone_count integer not null check(milestone_count between 0 and 20),
  request_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(id,goal_id,space_id,currency),unique(space_id,request_id),
  foreign key(goal_id,space_id,currency) references public.goals(id,space_id,currency) on delete restrict,
  foreign key(expected_revision_id,goal_id,space_id,currency)
    references public.goal_revisions(id,goal_id,space_id,currency) on delete restrict,
  check((name_en is null or char_length(btrim(name_en)) between 1 and 120) is true),
  check((name_ar is null or char_length(btrim(name_ar)) between 1 and 120) is true),
  check(name_en is not null or name_ar is not null),
  check(note is null or char_length(note)<=1000),
  check(((contribution_mode='manual_monthly' and monthly_minor is not null
      and monthly_minor between 0 and 999999999999999)
    or (contribution_mode='by_deadline' and monthly_minor is null and deadline is not null)) is true)
);
create unique index goal_initial_idx on public.goal_revisions(goal_id) where expected_revision_id is null;
create unique index goal_successor_idx on public.goal_revisions(expected_revision_id) where expected_revision_id is not null;
create index goal_current_idx on public.goal_revisions(space_id,currency,goal_id,id desc);

create table public.goal_milestones (
  id uuid primary key,
  goal_id uuid not null,space_id uuid not null,currency public.currency_code not null,
  created_at timestamptz not null default now(),
  unique(id,goal_id,space_id,currency),
  foreign key(goal_id,space_id,currency) references public.goals(id,space_id,currency) on delete restrict
);
create table public.goal_revision_milestones (
  revision_id bigint not null,milestone_id uuid not null,
  goal_id uuid not null,space_id uuid not null,currency public.currency_code not null,
  kind text not null check(kind in ('amount','checklist')),
  label_en text,label_ar text,
  check(label_en is not null or label_ar is not null),
  check((label_en is null or char_length(btrim(label_en)) between 1 and 120) is true),
  check((label_ar is null or char_length(btrim(label_ar)) between 1 and 120) is true),
  threshold_minor bigint,due_date date,
  ordinal integer not null check(ordinal between 0 and 19),
  primary key(revision_id,milestone_id),unique(revision_id,ordinal),
  foreign key(revision_id,goal_id,space_id,currency)
    references public.goal_revisions(id,goal_id,space_id,currency) on delete restrict,
  foreign key(milestone_id,goal_id,space_id,currency)
    references public.goal_milestones(id,goal_id,space_id,currency) on delete restrict,
  check(((kind='amount' and threshold_minor is not null and threshold_minor between 1 and 999999999999999)
    or (kind='checklist' and threshold_minor is null)) is true)
);
create table public.goal_milestone_events (
  id bigint generated always as identity primary key,
  milestone_id uuid not null,goal_id uuid not null,space_id uuid not null,currency public.currency_code not null,
  expected_event_id bigint,
  action text not null check(action in ('complete','reopen')),
  request_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(id,milestone_id,space_id),unique(space_id,request_id),
  foreign key(milestone_id,goal_id,space_id,currency)
    references public.goal_milestones(id,goal_id,space_id,currency) on delete restrict,
  foreign key(expected_event_id,milestone_id,space_id)
    references public.goal_milestone_events(id,milestone_id,space_id) on delete restrict
);
create unique index goal_checklist_initial_idx on public.goal_milestone_events(milestone_id) where expected_event_id is null;
create unique index goal_checklist_successor_idx on public.goal_milestone_events(expected_event_id) where expected_event_id is not null;

create table public.goal_earmark_events (
  id bigint generated always as identity primary key,
  space_id uuid not null references public.spaces(id) on delete restrict,
  currency public.currency_code not null,
  operation text not null check(operation in ('reserve','release','move','reverse')),
  reversal_of bigint unique,
  line_count integer not null check(line_count between 1 and 2),
  effective_date date not null default ((now() at time zone 'UTC')::date),
  request_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(id,space_id,currency),unique(space_id,request_id),
  foreign key(reversal_of,space_id,currency)
    references public.goal_earmark_events(id,space_id,currency) on delete restrict,
  check(((operation='reverse' and reversal_of is not null)
    or (operation<>'reverse' and reversal_of is null)) is true)
);
create table public.goal_earmark_lines (
  event_id bigint not null,goal_id uuid not null,space_id uuid not null,currency public.currency_code not null,
  amount_minor bigint not null check(amount_minor<>0 and amount_minor between -999999999999999 and 999999999999999),
  primary key(event_id,goal_id),
  foreign key(event_id,space_id,currency) references public.goal_earmark_events(id,space_id,currency) on delete restrict,
  foreign key(goal_id,space_id,currency) references public.goals(id,space_id,currency) on delete restrict
);
create table public.goal_purchase_links (
  id uuid primary key,
  goal_id uuid not null,space_id uuid not null,currency public.currency_code not null,
  expense_event_id uuid not null,
  amount_minor bigint not null check(amount_minor between 1 and 999999999999999),
  request_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(space_id,request_id,goal_id),
  foreign key(goal_id,space_id,currency) references public.goals(id,space_id,currency) on delete restrict,
  foreign key(expense_event_id,space_id) references public.financial_events(id,space_id) on delete restrict
);
create table public.goal_monthly_target_revisions (
  id bigint generated always as identity primary key,
  goal_id uuid not null,space_id uuid not null,currency public.currency_code not null,
  month_start date not null check(month_start=date_trunc('month',month_start)::date),
  amount_minor bigint not null check(amount_minor between 0 and 999999999999999),
  expected_revision_id bigint,request_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(id,goal_id,space_id,currency,month_start),unique(space_id,request_id),
  foreign key(goal_id,space_id,currency) references public.goals(id,space_id,currency) on delete restrict,
  foreign key(expected_revision_id,goal_id,space_id,currency,month_start)
    references public.goal_monthly_target_revisions(id,goal_id,space_id,currency,month_start) on delete restrict
);
create unique index goal_month_initial_idx on public.goal_monthly_target_revisions(goal_id,month_start) where expected_revision_id is null;
create unique index goal_month_successor_idx on public.goal_monthly_target_revisions(expected_revision_id) where expected_revision_id is not null;

-- Task 2: deferred cross-row validation. Every adapter is SECURITY DEFINER
-- (not INVOKER): a deferred constraint trigger fires at COMMIT, after any
-- SECURITY DEFINER command that did the insert has already returned, back
-- under the plain authenticated role, which has no EXECUTE on these
-- revoked-from-everyone check functions (task 05's lesson, applied here from
-- the start). Each check locks its header row FOR UPDATE first, so
-- concurrent publications of the same stream serialize rather than both
-- validating against a stale sibling set.

create function private.check_goal_definition(p_revision_id bigint)
returns void language plpgsql security definer set search_path = pg_catalog as $$
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
revoke all on function private.check_goal_definition(bigint) from public, anon, authenticated, service_role;

create function private.check_goal_definition_from_header()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform private.check_goal_definition(new.id);
  return null;
end; $$;
create function private.check_goal_definition_from_milestone()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform private.check_goal_definition(new.revision_id);
  return null;
end; $$;
revoke all on function private.check_goal_definition_from_header() from public, anon, authenticated, service_role;
revoke all on function private.check_goal_definition_from_milestone() from public, anon, authenticated, service_role;

create constraint trigger goal_revisions_publish_check
  after insert on public.goal_revisions
  deferrable initially deferred for each row
  execute function private.check_goal_definition_from_header();
create constraint trigger goal_revision_milestones_publish_check
  after insert on public.goal_revision_milestones
  deferrable initially deferred for each row
  execute function private.check_goal_definition_from_milestone();

create function private.check_goal_milestone_event(p_event_id bigint)
returns void language plpgsql security definer set search_path = pg_catalog as $$
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
revoke all on function private.check_goal_milestone_event(bigint) from public, anon, authenticated, service_role;

create function private.check_goal_milestone_event_from_event()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform private.check_goal_milestone_event(new.id);
  return null;
end; $$;
revoke all on function private.check_goal_milestone_event_from_event() from public, anon, authenticated, service_role;

create constraint trigger goal_milestone_events_publish_check
  after insert on public.goal_milestone_events
  deferrable initially deferred for each row
  execute function private.check_goal_milestone_event_from_event();

-- Earmark events: exact declared line shape per operation, nonnegative
-- effective per-goal balance, and a reserve/move increase never exceeds
-- target less fulfilled less existing earmark. Purchase-link fulfillment is
-- included structurally so task 10 needs no further change to this check;
-- schema-only fixtures exercise it with fulfilled always zero, since no RPC
-- grants write access to goal_purchase_links until task 10.
create function private.check_goal_earmark_event(p_event_id bigint)
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
    or (event_contribution > 0 and running_balance > (target - fulfilled));
  if v_bad_balance <> 0 then
    raise exception using errcode='23514', message='goal_earmark_balance_invalid';
  end if;
end;
$$;
revoke all on function private.check_goal_earmark_event(bigint) from public, anon, authenticated, service_role;

create function private.check_goal_earmark_event_from_header()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform private.check_goal_earmark_event(new.id);
  return null;
end; $$;
create function private.check_goal_earmark_event_from_line()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform private.check_goal_earmark_event(new.event_id);
  return null;
end; $$;
revoke all on function private.check_goal_earmark_event_from_header() from public, anon, authenticated, service_role;
revoke all on function private.check_goal_earmark_event_from_line() from public, anon, authenticated, service_role;

create constraint trigger goal_earmark_events_publish_check
  after insert on public.goal_earmark_events
  deferrable initially deferred for each row
  execute function private.check_goal_earmark_event_from_header();
create constraint trigger goal_earmark_lines_publish_check
  after insert on public.goal_earmark_lines
  deferrable initially deferred for each row
  execute function private.check_goal_earmark_event_from_line();

-- Task 3: common guards (reusing task 03's generic private.planning_guard_insert
-- / private.planning_reject_mutation), FK/history indexes, RLS with no API
-- write policy, and privilege revocation on all nine relations.

create trigger goals_guard_insert before insert on public.goals
  for each row execute function private.planning_guard_insert();
create trigger goals_reject_mutation before update or delete or truncate on public.goals
  for each statement execute function private.planning_reject_mutation();

create trigger goal_revisions_guard_insert before insert on public.goal_revisions
  for each row execute function private.planning_guard_insert();
create trigger goal_revisions_reject_mutation before update or delete or truncate on public.goal_revisions
  for each statement execute function private.planning_reject_mutation();

create trigger goal_milestones_guard_insert before insert on public.goal_milestones
  for each row execute function private.planning_guard_insert();
create trigger goal_milestones_reject_mutation before update or delete or truncate on public.goal_milestones
  for each statement execute function private.planning_reject_mutation();

create trigger goal_revision_milestones_guard_insert before insert on public.goal_revision_milestones
  for each row execute function private.planning_guard_insert();
create trigger goal_revision_milestones_reject_mutation before update or delete or truncate on public.goal_revision_milestones
  for each statement execute function private.planning_reject_mutation();

create trigger goal_milestone_events_guard_insert before insert on public.goal_milestone_events
  for each row execute function private.planning_guard_insert();
create trigger goal_milestone_events_reject_mutation before update or delete or truncate on public.goal_milestone_events
  for each statement execute function private.planning_reject_mutation();

create trigger goal_earmark_events_guard_insert before insert on public.goal_earmark_events
  for each row execute function private.planning_guard_insert();
create trigger goal_earmark_events_reject_mutation before update or delete or truncate on public.goal_earmark_events
  for each statement execute function private.planning_reject_mutation();

create trigger goal_earmark_lines_guard_insert before insert on public.goal_earmark_lines
  for each row execute function private.planning_guard_insert();
create trigger goal_earmark_lines_reject_mutation before update or delete or truncate on public.goal_earmark_lines
  for each statement execute function private.planning_reject_mutation();

create trigger goal_purchase_links_guard_insert before insert on public.goal_purchase_links
  for each row execute function private.planning_guard_insert();
create trigger goal_purchase_links_reject_mutation before update or delete or truncate on public.goal_purchase_links
  for each statement execute function private.planning_reject_mutation();

create trigger goal_monthly_target_revisions_guard_insert before insert on public.goal_monthly_target_revisions
  for each row execute function private.planning_guard_insert();
create trigger goal_monthly_target_revisions_reject_mutation before update or delete or truncate on public.goal_monthly_target_revisions
  for each statement execute function private.planning_reject_mutation();

create index goals_space_currency_idx on public.goals(space_id,currency);
create index goal_milestones_goal_idx on public.goal_milestones(goal_id,space_id,currency);
create index goal_revision_milestones_milestone_idx on public.goal_revision_milestones(milestone_id,goal_id,space_id,currency);
create index goal_milestone_events_milestone_idx on public.goal_milestone_events(milestone_id,space_id,id desc);
create index goal_earmark_events_space_currency_idx on public.goal_earmark_events(space_id,currency,id desc);
create index goal_earmark_lines_goal_idx on public.goal_earmark_lines(goal_id,space_id,currency);
create index goal_purchase_links_expense_idx on public.goal_purchase_links(expense_event_id,space_id);
create index goal_purchase_links_goal_idx on public.goal_purchase_links(goal_id,created_at,id);
create index goal_monthly_target_revisions_goal_idx on public.goal_monthly_target_revisions(goal_id,space_id,currency,month_start desc);

alter table public.goals enable row level security;
alter table public.goal_revisions enable row level security;
alter table public.goal_milestones enable row level security;
alter table public.goal_revision_milestones enable row level security;
alter table public.goal_milestone_events enable row level security;
alter table public.goal_earmark_events enable row level security;
alter table public.goal_earmark_lines enable row level security;
alter table public.goal_purchase_links enable row level security;
alter table public.goal_monthly_target_revisions enable row level security;

revoke all on public.goals from public, anon, authenticated, service_role;
revoke all on public.goal_revisions from public, anon, authenticated, service_role;
revoke all on public.goal_milestones from public, anon, authenticated, service_role;
revoke all on public.goal_revision_milestones from public, anon, authenticated, service_role;
revoke all on public.goal_milestone_events from public, anon, authenticated, service_role;
revoke all on public.goal_earmark_events from public, anon, authenticated, service_role;
revoke all on public.goal_earmark_lines from public, anon, authenticated, service_role;
revoke all on public.goal_purchase_links from public, anon, authenticated, service_role;
revoke all on public.goal_monthly_target_revisions from public, anon, authenticated, service_role;
