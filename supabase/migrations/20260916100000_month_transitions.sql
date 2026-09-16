-- Month copy, close and signed rollover (task 20): explicit, user-initiated
-- month transitions over the allocation (task 06), goals (task 11) and
-- available-cash (task 17) read models. No scheduler, no automatic
-- rollover, and no posting: nothing here writes a financial event, movement
-- or loan row.
--
-- Carry is a signed per-root adjustment on top of the percentage plan. It is
-- frozen by an explicit close, bound to the next month's snapshot by
-- immutable carry links written in the same transaction that publishes that
-- snapshot, and is never folded into expected income or group percentages.

-- Task 1: structural keys the new composite foreign keys reference. Each
-- extends an existing primary key, so every existing row already satisfies it.
alter table public.allocation_month_roots
  add constraint allocation_month_roots_target_key unique (snapshot_id, category_id, target_minor);

-- Task 1: relations ---------------------------------------------------------

create table public.rollover_policy_revisions (
  id bigint generated always as identity primary key,
  space_id uuid not null references public.spaces(id) on delete restrict,
  currency public.currency_code not null,
  root_id uuid not null,
  root_kind public.category_kind not null default 'expense' check (root_kind = 'expense'),
  enabled boolean not null,
  expected_revision_id bigint,
  request_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, space_id, currency, root_id),
  unique (id, space_id, currency, root_id, enabled),
  unique (space_id, request_id),
  check ((expected_revision_id is null or expected_revision_id < id) is true),
  foreign key (root_id, space_id, root_kind)
    references public.categories(id, space_id, kind) on delete restrict,
  foreign key (expected_revision_id, space_id, currency, root_id)
    references public.rollover_policy_revisions(id, space_id, currency, root_id) on delete restrict
);
create unique index rollover_policy_initial_idx
  on public.rollover_policy_revisions(space_id, currency, root_id) where expected_revision_id is null;
create unique index rollover_policy_successor_idx
  on public.rollover_policy_revisions(expected_revision_id) where expected_revision_id is not null;
create index rollover_policy_current_idx
  on public.rollover_policy_revisions(space_id, currency, root_id, id desc);
create index rollover_policy_root_idx
  on public.rollover_policy_revisions(root_id, space_id, root_kind);

create table public.budget_month_closes (
  id bigint generated always as identity primary key,
  space_id uuid not null references public.spaces(id) on delete restrict,
  currency public.currency_code not null,
  month_start date not null check (month_start = date_trunc('month', month_start)::date),
  source_snapshot_id bigint not null,
  expected_close_id bigint,
  fact_digest bytea not null check (octet_length(fact_digest) = 32),
  fact_count bigint not null check (fact_count between 0 and 100000),
  root_count integer not null check (root_count between 0 and 200),
  closed_income_minor numeric(30,0) not null,
  closed_spending_minor numeric(30,0) not null,
  request_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, space_id, currency, month_start),
  unique (id, space_id, currency, month_start, source_snapshot_id),
  unique (space_id, request_id),
  check ((expected_close_id is null or expected_close_id < id) is true),
  -- A month can only be closed once its UTC calendar month has ended.
  check ((month_start + interval '1 month') <= (created_at at time zone 'UTC')),
  foreign key (source_snapshot_id, space_id, currency, month_start)
    references public.allocation_month_snapshots(id, space_id, currency, month_start) on delete restrict,
  foreign key (expected_close_id, space_id, currency, month_start)
    references public.budget_month_closes(id, space_id, currency, month_start) on delete restrict
);
create unique index budget_month_close_initial_idx
  on public.budget_month_closes(space_id, currency, month_start) where expected_close_id is null;
create unique index budget_month_close_successor_idx
  on public.budget_month_closes(expected_close_id) where expected_close_id is not null;
create index budget_month_close_current_idx
  on public.budget_month_closes(space_id, currency, month_start, id desc);
create index budget_month_close_snapshot_idx
  on public.budget_month_closes(source_snapshot_id, space_id, currency, month_start);

create table public.budget_month_close_roots (
  close_id bigint not null,
  space_id uuid not null,
  currency public.currency_code not null,
  month_start date not null,
  source_snapshot_id bigint not null,
  root_id uuid not null,
  root_kind public.category_kind not null default 'expense' check (root_kind = 'expense'),
  policy_revision_id bigint,
  enabled boolean not null,
  base_target_minor bigint not null check (base_target_minor between 0 and 999999999999999),
  incoming_carry_minor numeric(30,0) not null,
  actual_minor numeric(30,0) not null,
  outgoing_carry_minor numeric(30,0) not null,
  primary key (close_id, root_id),
  unique (close_id, root_id, outgoing_carry_minor, enabled),
  check ((policy_revision_id is not null or not enabled) is true),
  -- Signed, never clamped; a disabled root carries nothing.
  check (outgoing_carry_minor = case when enabled
    then base_target_minor + incoming_carry_minor - actual_minor else 0 end),
  foreign key (close_id, space_id, currency, month_start, source_snapshot_id)
    references public.budget_month_closes(id, space_id, currency, month_start, source_snapshot_id) on delete restrict,
  foreign key (source_snapshot_id, root_id, base_target_minor)
    references public.allocation_month_roots(snapshot_id, category_id, target_minor) on delete restrict,
  foreign key (root_id, space_id, root_kind)
    references public.categories(id, space_id, kind) on delete restrict,
  foreign key (policy_revision_id, space_id, currency, root_id, enabled)
    references public.rollover_policy_revisions(id, space_id, currency, root_id, enabled) on delete restrict
);
create index budget_month_close_roots_snapshot_idx
  on public.budget_month_close_roots(source_snapshot_id, root_id, base_target_minor);
create index budget_month_close_roots_category_idx
  on public.budget_month_close_roots(root_id, space_id, root_kind);
create index budget_month_close_roots_policy_idx
  on public.budget_month_close_roots(policy_revision_id, space_id, currency, root_id, enabled)
  where policy_revision_id is not null;

create table public.budget_month_carry_links (
  id bigint generated always as identity primary key,
  space_id uuid not null,
  currency public.currency_code not null,
  source_close_id bigint not null,
  source_month_start date not null,
  target_snapshot_id bigint not null,
  target_month_start date not null,
  root_id uuid not null,
  source_enabled boolean not null default true check (source_enabled),
  carry_minor numeric(30,0) not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (target_snapshot_id, root_id),
  check (target_month_start = (source_month_start + interval '1 month')::date),
  foreign key (source_close_id, space_id, currency, source_month_start)
    references public.budget_month_closes(id, space_id, currency, month_start) on delete restrict,
  foreign key (target_snapshot_id, space_id, currency, target_month_start)
    references public.allocation_month_snapshots(id, space_id, currency, month_start) on delete restrict,
  -- The carried amount is exactly the source close root's outgoing carry,
  -- and only an enabled close root can be carried.
  foreign key (source_close_id, root_id, carry_minor, source_enabled)
    references public.budget_month_close_roots(close_id, root_id, outgoing_carry_minor, enabled) on delete restrict,
  foreign key (target_snapshot_id, root_id)
    references public.allocation_month_roots(snapshot_id, category_id) on delete restrict
);
create index budget_month_carry_links_source_idx
  on public.budget_month_carry_links(source_close_id, root_id, carry_minor, source_enabled);

-- Task 1: deferred cross-row validation. Every adapter is SECURITY DEFINER:
-- a deferred constraint trigger fires at COMMIT under the plain calling role
-- (task 05's lesson), which has no EXECUTE on these checks.

create function private.check_rollover_policy_revision(p_revision_id bigint)
returns void language plpgsql security definer set search_path = pg_catalog as $$
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
revoke all on function private.check_rollover_policy_revision(bigint) from public, anon, authenticated, service_role;

create function private.check_budget_month_close(p_close_id bigint)
returns void language plpgsql security definer set search_path = pg_catalog as $$
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
revoke all on function private.check_budget_month_close(bigint) from public, anon, authenticated, service_role;

-- Links for one target snapshot: written in the snapshot's own transaction,
-- from the latest close of the immediately prior month, and complete. The
-- expected set is every enabled close root whose category is still active
-- and that is either present in the snapshot or has non-zero carry (a
-- non-zero root absent from the snapshot cannot be linked, so it rejects).
create function private.check_budget_month_carry_links(p_target_snapshot_id bigint)
returns void language plpgsql security definer set search_path = pg_catalog as $$
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
revoke all on function private.check_budget_month_carry_links(bigint) from public, anon, authenticated, service_role;

create function private.check_rollover_policy_from_row()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform private.check_rollover_policy_revision(new.id);
  return null;
end; $$;
create function private.check_budget_month_close_from_header()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform private.check_budget_month_close(new.id);
  return null;
end; $$;
create function private.check_budget_month_close_from_root()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform private.check_budget_month_close(new.close_id);
  return null;
end; $$;
create function private.check_budget_month_carry_from_link()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform private.check_budget_month_carry_links(new.target_snapshot_id);
  return null;
end; $$;
revoke all on function private.check_rollover_policy_from_row() from public, anon, authenticated, service_role;
revoke all on function private.check_budget_month_close_from_header() from public, anon, authenticated, service_role;
revoke all on function private.check_budget_month_close_from_root() from public, anon, authenticated, service_role;
revoke all on function private.check_budget_month_carry_from_link() from public, anon, authenticated, service_role;

create constraint trigger rollover_policy_revisions_publish_check
  after insert on public.rollover_policy_revisions
  deferrable initially deferred for each row
  execute function private.check_rollover_policy_from_row();
create constraint trigger budget_month_closes_publish_check
  after insert on public.budget_month_closes
  deferrable initially deferred for each row
  execute function private.check_budget_month_close_from_header();
create constraint trigger budget_month_close_roots_publish_check
  after insert on public.budget_month_close_roots
  deferrable initially deferred for each row
  execute function private.check_budget_month_close_from_root();
create constraint trigger budget_month_carry_links_publish_check
  after insert on public.budget_month_carry_links
  deferrable initially deferred for each row
  execute function private.check_budget_month_carry_from_link();

-- Task 1: common guards, RLS and privilege lockdown (task 03's generic
-- owner-only INSERT guard and statement-level mutation rejection).
alter table public.rollover_policy_revisions enable row level security;
create trigger rollover_policy_revisions_guard_insert before insert on public.rollover_policy_revisions
  for each row execute function private.planning_guard_insert();
create trigger rollover_policy_revisions_reject_mutation before update or delete or truncate on public.rollover_policy_revisions
  for each statement execute function private.planning_reject_mutation();
revoke all on public.rollover_policy_revisions from public, anon, authenticated, service_role;

alter table public.budget_month_closes enable row level security;
create trigger budget_month_closes_guard_insert before insert on public.budget_month_closes
  for each row execute function private.planning_guard_insert();
create trigger budget_month_closes_reject_mutation before update or delete or truncate on public.budget_month_closes
  for each statement execute function private.planning_reject_mutation();
revoke all on public.budget_month_closes from public, anon, authenticated, service_role;

alter table public.budget_month_close_roots enable row level security;
create trigger budget_month_close_roots_guard_insert before insert on public.budget_month_close_roots
  for each row execute function private.planning_guard_insert();
create trigger budget_month_close_roots_reject_mutation before update or delete or truncate on public.budget_month_close_roots
  for each statement execute function private.planning_reject_mutation();
revoke all on public.budget_month_close_roots from public, anon, authenticated, service_role;

alter table public.budget_month_carry_links enable row level security;
create trigger budget_month_carry_links_guard_insert before insert on public.budget_month_carry_links
  for each row execute function private.planning_guard_insert();
create trigger budget_month_carry_links_reject_mutation before update or delete or truncate on public.budget_month_carry_links
  for each statement execute function private.planning_reject_mutation();
revoke all on public.budget_month_carry_links from public, anon, authenticated, service_role;

revoke all on sequence public.rollover_policy_revisions_id_seq from public, anon, authenticated, service_role;
revoke all on sequence public.budget_month_closes_id_seq from public, anon, authenticated, service_role;
revoke all on sequence public.budget_month_carry_links_id_seq from public, anon, authenticated, service_role;

-- Task 2: frozen month facts ------------------------------------------------

-- One statement selects every ordinary income/expense fact of the month
-- (reversals by their own business date, classified by their original's
-- kind and category), then aggregates income, spending, per-root actuals
-- and a SHA-256 over the sorted fact identities, amounts and classification.
-- Category association and parentage are immutable in this schema, so the
-- category/root IDs are the classification revision. The cap refuses rather
-- than truncates; callers pass the documented 100000.
create function private.budget_month_close_facts(
  p_space_id uuid, p_currency public.currency_code, p_month date, p_snapshot_id bigint, p_fact_cap integer
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, extensions as $$
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
revoke all on function private.budget_month_close_facts(uuid, public.currency_code, date, bigint, integer)
  from public, anon, authenticated, service_role;

-- Task 3: close preview and command ------------------------------------------

-- Incoming carry is the snapshot's own accepted carry link, never a live
-- report. The hash covers the normalized inputs, every read head (snapshot,
-- latest close, policy heads, carry link sources) and the fact digest.
create function private.budget_month_close_preview(
  p_space_id uuid, p_currency public.currency_code, p_month date, p_expected_close_id bigint
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, extensions as $$
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
revoke all on function private.budget_month_close_preview(uuid, public.currency_code, date, bigint)
  from public, anon, authenticated, service_role;

create function public.preview_budget_month_close(
  p_space_id uuid, p_currency public.currency_code, p_month date, p_expected_close_id bigint
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, extensions set statement_timeout='10s' as $$
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
revoke all on function public.preview_budget_month_close(uuid, public.currency_code, date, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.preview_budget_month_close(uuid, public.currency_code, date, bigint) to authenticated;

create function public.close_budget_month(
  p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_month date,
  p_expected_close_id bigint, p_accepted_preview_hash text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions as $$
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
$$;
revoke all on function public.close_budget_month(uuid, uuid, public.currency_code, date, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.close_budget_month(uuid, uuid, public.currency_code, date, bigint, text) to authenticated;

-- Task 3: rollover policy command --------------------------------------------

create function public.set_rollover_policy(
  p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_root_id uuid,
  p_enabled boolean, p_expected_revision_id bigint
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions as $$
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
revoke all on function public.set_rollover_policy(uuid, uuid, public.currency_code, uuid, boolean, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.set_rollover_policy(uuid, uuid, public.currency_code, uuid, boolean, bigint) to authenticated;

-- Task 4: month copy preview and command -------------------------------------

-- Copies the source snapshot's template percentages, base expected income,
-- root base targets, goal monthly targets and loan-pool group -- never
-- actual salary, spending, earmarks or recurring occurrences. Archived roots
-- and non-active goals are omitted with a reason; anything the destination
-- currently requires (template roots, destination positive targets) is
-- included as an explicit zero so publish_allocation_month_v2's complete-set
-- rule is satisfied by acknowledgement, not by silent omission. Carry comes
-- from the latest close of the month immediately before the target.
create function private.month_copy_preview(
  p_space_id uuid, p_currency public.currency_code, p_source_snapshot_id bigint, p_target_month date
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, extensions as $$
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
revoke all on function private.month_copy_preview(uuid, public.currency_code, bigint, date)
  from public, anon, authenticated, service_role;

create function public.preview_month_copy(
  p_space_id uuid, p_currency public.currency_code, p_source_snapshot_id bigint, p_target_month date
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, extensions set statement_timeout='10s' as $$
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
revoke all on function public.preview_month_copy(uuid, public.currency_code, bigint, date)
  from public, anon, authenticated, service_role;
grant execute on function public.preview_month_copy(uuid, public.currency_code, bigint, date) to authenticated;

create function public.copy_allocation_month(
  p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_source_snapshot_id bigint,
  p_target_month date, p_expected_target_snapshot_id bigint, p_accepted_preview_hash text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions as $$
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
$$;
revoke all on function public.copy_allocation_month(uuid, uuid, public.currency_code, bigint, date, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.copy_allocation_month(uuid, uuid, public.currency_code, bigint, date, bigint, text) to authenticated;

-- Task 5: carry-aware read models (tasks 06 and 17) --------------------------

create function private.allocation_snapshot_carry(p_snapshot_id bigint)
returns table(root_id uuid, group_id uuid, carry_minor numeric, source_close_id bigint)
language sql stable security definer set search_path = pg_catalog as $$
  select link.root_id, snapshot_root.group_id, link.carry_minor, link.source_close_id
  from public.budget_month_carry_links link
  join public.allocation_month_roots snapshot_root
    on snapshot_root.snapshot_id = link.target_snapshot_id and snapshot_root.category_id = link.root_id
  where link.target_snapshot_id = p_snapshot_id;
$$;
revoke all on function private.allocation_snapshot_carry(bigint) from public, anon, authenticated, service_role;

-- A snapshot needs carry review when the latest close of its prior month is
-- not the close its links accepted (a restatement), or when that close's
-- non-zero carry for active enabled roots differs from what is linked
-- (including a later republish that carried nothing).
create function private.allocation_snapshot_carry_needs_review(p_snapshot_id bigint)
returns boolean language plpgsql stable security definer set search_path = pg_catalog as $$
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
revoke all on function private.allocation_snapshot_carry_needs_review(bigint) from public, anon, authenticated, service_role;

-- Forward-fix of task 11's allocation_month_state (its migration is not
-- edited): variance is measured against effective capacity (base target +
-- signed carry). Every existing field keeps its meaning; carryMinor,
-- effectiveTargetMinor, carryNeedsReview and carrySourceCloseId are added.
-- With no carry links every value is identical to the prior version.
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

-- Forward-fix of task 06's allocation_category_page: each root row adds its
-- signed carry and effective target, and variance is measured against the
-- effective target (identical to the prior value when carry is zero).
create or replace function public.allocation_category_page(
  p_space_id uuid, p_month date, p_currency public.currency_code, p_snapshot_id bigint,
  p_group_id uuid default null, p_after_root_id uuid default null, p_limit integer default 50
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, extensions set statement_timeout='10s' as $$
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

-- Forward-fix of task 17's expense buckets: a spending group's and a
-- standalone root's remaining budget is measured against effective capacity
-- (base target + signed carry), still floored at zero per bucket.
create or replace function private.planning_expense_buckets(
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
