-- Allocation schema (task 04): immutable group identity, versioned templates,
-- and immutable monthly snapshots. Schema and deferred validation only -- no
-- RPC/public command in this migration (task 05).

alter table public.monthly_budget_plan_revisions
  add constraint monthly_budget_revision_space_key unique(id,space_id);

create table public.allocation_groups (
  id uuid primary key,
  space_id uuid not null references public.spaces(id) on delete restrict,
  currency public.currency_code not null,
  purpose text not null check(purpose in ('spending','future')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(id,space_id,currency),
  check(id <> 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
);
create index allocation_groups_space_currency_idx on public.allocation_groups(space_id,currency);

create table public.allocation_template_revisions (
  id bigint generated always as identity primary key,
  space_id uuid not null references public.spaces(id) on delete restrict,
  currency public.currency_code not null,
  expected_revision_id bigint,
  group_count integer not null check(group_count between 0 and 12),
  root_count integer not null check(root_count between 0 and 200),
  request_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(id,space_id,currency), unique(space_id,request_id),
  foreign key(expected_revision_id,space_id,currency)
    references public.allocation_template_revisions(id,space_id,currency)
    on delete restrict
);
create unique index allocation_template_initial_idx
  on public.allocation_template_revisions(space_id,currency)
  where expected_revision_id is null;
create unique index allocation_template_successor_idx
  on public.allocation_template_revisions(expected_revision_id)
  where expected_revision_id is not null;
create index allocation_template_current_idx
  on public.allocation_template_revisions(space_id,currency,id desc);

create table public.allocation_template_lines (
  template_id bigint not null,
  group_id uuid not null,
  space_id uuid not null,
  currency public.currency_code not null,
  name_en text,
  name_ar text,
  display_order integer not null check(display_order between 0 and 11),
  basis_points integer not null check(basis_points between 0 and 10000),
  primary key(template_id,group_id),
  unique(template_id,display_order),
  unique(template_id,group_id,space_id,currency),
  foreign key(template_id,space_id,currency)
    references public.allocation_template_revisions(id,space_id,currency) on delete restrict,
  foreign key(group_id,space_id,currency)
    references public.allocation_groups(id,space_id,currency) on delete restrict,
  check((name_en is null or char_length(btrim(name_en)) between 1 and 80) is true),
  check((name_ar is null or char_length(btrim(name_ar)) between 1 and 80) is true),
  check(name_en is not null or name_ar is not null)
);
create index allocation_template_lines_group_idx
  on public.allocation_template_lines(group_id,space_id,currency);

create table public.allocation_template_roots (
  template_id bigint not null,
  category_id uuid not null,
  category_kind public.category_kind not null default 'expense' check(category_kind='expense'),
  group_id uuid not null,
  space_id uuid not null,
  currency public.currency_code not null,
  primary key(template_id,category_id),
  foreign key(template_id,group_id,space_id,currency)
    references public.allocation_template_lines(template_id,group_id,space_id,currency)
    on delete restrict,
  foreign key(category_id,space_id,category_kind)
    references public.categories(id,space_id,kind) on delete restrict
);
create index allocation_template_roots_category_idx
  on public.allocation_template_roots(category_id,space_id,category_kind);

create table public.allocation_month_snapshots (
  id bigint generated always as identity primary key,
  space_id uuid not null references public.spaces(id) on delete restrict,
  currency public.currency_code not null,
  month_start date not null check(month_start=date_trunc('month',month_start)::date),
  template_revision_id bigint not null,
  income_plan_revision_id bigint not null,
  expected_snapshot_id bigint,
  base_income_minor bigint not null check(base_income_minor between 0 and 999999999999999),
  unallocated_minor bigint not null check(unallocated_minor between 0 and 999999999999999),
  group_count integer not null check(group_count between 0 and 12),
  root_count integer not null check(root_count between 0 and 200),
  loan_line_count integer not null check(loan_line_count between 0 and 1),
  request_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(id,space_id,currency), unique(id,space_id,currency,month_start),
  unique(space_id,request_id),
  foreign key(template_revision_id,space_id,currency)
    references public.allocation_template_revisions(id,space_id,currency) on delete restrict,
  foreign key(income_plan_revision_id,space_id)
    references public.monthly_budget_plan_revisions(id,space_id) on delete restrict,
  foreign key(expected_snapshot_id,space_id,currency,month_start)
    references public.allocation_month_snapshots(id,space_id,currency,month_start)
    on delete restrict
);
create unique index allocation_month_initial_idx
  on public.allocation_month_snapshots(space_id,currency,month_start)
  where expected_snapshot_id is null;
create unique index allocation_month_successor_idx
  on public.allocation_month_snapshots(expected_snapshot_id)
  where expected_snapshot_id is not null;
create index allocation_month_current_idx
  on public.allocation_month_snapshots(space_id,month_start,currency,id desc);
create index allocation_month_snapshots_template_idx
  on public.allocation_month_snapshots(template_revision_id,space_id,currency);
create index allocation_month_snapshots_income_idx
  on public.allocation_month_snapshots(income_plan_revision_id,space_id);

create table public.allocation_month_groups (
  snapshot_id bigint not null,
  group_id uuid not null,
  space_id uuid not null,
  currency public.currency_code not null,
  name_en text,
  name_ar text,
  purpose text not null check(purpose in ('spending','future')),
  display_order integer not null check(display_order between 0 and 11),
  basis_points integer not null check(basis_points between 0 and 10000),
  target_minor bigint not null check(target_minor between 0 and 999999999999999),
  primary key(snapshot_id,group_id), unique(snapshot_id,display_order),
  unique(snapshot_id,group_id,space_id,currency),
  foreign key(snapshot_id,space_id,currency)
    references public.allocation_month_snapshots(id,space_id,currency) on delete restrict,
  foreign key(group_id,space_id,currency)
    references public.allocation_groups(id,space_id,currency) on delete restrict,
  check((name_en is null or char_length(btrim(name_en)) between 1 and 80) is true),
  check((name_ar is null or char_length(btrim(name_ar)) between 1 and 80) is true),
  check(name_en is not null or name_ar is not null)
);
create index allocation_month_groups_group_idx
  on public.allocation_month_groups(group_id,space_id,currency);

create table public.allocation_month_roots (
  snapshot_id bigint not null,
  category_id uuid not null,
  category_kind public.category_kind not null default 'expense' check(category_kind='expense'),
  group_id uuid,
  space_id uuid not null,
  currency public.currency_code not null,
  target_revision_id bigint not null,
  target_minor bigint not null check(target_minor between 0 and 999999999999999),
  primary key(snapshot_id,category_id),
  foreign key(snapshot_id,space_id,currency)
    references public.allocation_month_snapshots(id,space_id,currency) on delete restrict,
  foreign key(snapshot_id,group_id,space_id,currency)
    references public.allocation_month_groups(snapshot_id,group_id,space_id,currency)
    on delete restrict,
  foreign key(category_id,space_id,category_kind)
    references public.categories(id,space_id,kind) on delete restrict,
  foreign key(target_revision_id,space_id)
    references public.monthly_budget_plan_revisions(id,space_id) on delete restrict
);
create index allocation_month_roots_category_idx
  on public.allocation_month_roots(category_id,space_id,category_kind);
create index allocation_month_roots_target_revision_idx
  on public.allocation_month_roots(target_revision_id,space_id);
create index allocation_month_roots_group_idx
  on public.allocation_month_roots(group_id,space_id,currency);

create table public.allocation_month_commitments (
  snapshot_id bigint primary key,
  space_id uuid not null,
  currency public.currency_code not null,
  group_id uuid,
  source_kind text not null check(source_kind='loan_pool'),
  observed_actual_minor bigint not null,
  observed_remaining_minor bigint not null check(observed_remaining_minor>=0),
  foreign key(snapshot_id,space_id,currency)
    references public.allocation_month_snapshots(id,space_id,currency) on delete restrict,
  foreign key(snapshot_id,group_id,space_id,currency)
    references public.allocation_month_groups(snapshot_id,group_id,space_id,currency)
    on delete restrict
);
create index allocation_month_commitments_group_idx
  on public.allocation_month_commitments(group_id,space_id,currency);

-- Task 2: deferred cross-row validation. Each check locks its header row
-- first (FOR UPDATE), so concurrent publications of the same stream serialize
-- rather than both validating against a stale sibling set.

create function private.check_allocation_template(p_template_id bigint)
returns void language plpgsql security definer set search_path = pg_catalog as $$
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
revoke all on function private.check_allocation_template(bigint) from public, anon, authenticated, service_role;

create function private.check_allocation_template_from_header()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  perform private.check_allocation_template(new.id);
  return null;
end; $$;
create function private.check_allocation_template_from_line()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  perform private.check_allocation_template(new.template_id);
  return null;
end; $$;
create function private.check_allocation_template_from_root()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  perform private.check_allocation_template(new.template_id);
  return null;
end; $$;
revoke all on function private.check_allocation_template_from_header() from public, anon, authenticated, service_role;
revoke all on function private.check_allocation_template_from_line() from public, anon, authenticated, service_role;
revoke all on function private.check_allocation_template_from_root() from public, anon, authenticated, service_role;

create constraint trigger allocation_template_revisions_publish_check
  after insert on public.allocation_template_revisions
  deferrable initially deferred for each row
  execute function private.check_allocation_template_from_header();
create constraint trigger allocation_template_lines_publish_check
  after insert on public.allocation_template_lines
  deferrable initially deferred for each row
  execute function private.check_allocation_template_from_line();
create constraint trigger allocation_template_roots_publish_check
  after insert on public.allocation_template_roots
  deferrable initially deferred for each row
  execute function private.check_allocation_template_from_root();

create function private.check_allocation_month(p_snapshot_id bigint)
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
revoke all on function private.check_allocation_month(bigint) from public, anon, authenticated, service_role;

create function private.check_allocation_month_from_header()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  perform private.check_allocation_month(new.id);
  return null;
end; $$;
create function private.check_allocation_month_from_group()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  perform private.check_allocation_month(new.snapshot_id);
  return null;
end; $$;
create function private.check_allocation_month_from_root()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  perform private.check_allocation_month(new.snapshot_id);
  return null;
end; $$;
create function private.check_allocation_month_from_commitment()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  perform private.check_allocation_month(new.snapshot_id);
  return null;
end; $$;
revoke all on function private.check_allocation_month_from_header() from public, anon, authenticated, service_role;
revoke all on function private.check_allocation_month_from_group() from public, anon, authenticated, service_role;
revoke all on function private.check_allocation_month_from_root() from public, anon, authenticated, service_role;
revoke all on function private.check_allocation_month_from_commitment() from public, anon, authenticated, service_role;

create constraint trigger allocation_month_snapshots_publish_check
  after insert on public.allocation_month_snapshots
  deferrable initially deferred for each row
  execute function private.check_allocation_month_from_header();
create constraint trigger allocation_month_groups_publish_check
  after insert on public.allocation_month_groups
  deferrable initially deferred for each row
  execute function private.check_allocation_month_from_group();
create constraint trigger allocation_month_roots_publish_check
  after insert on public.allocation_month_roots
  deferrable initially deferred for each row
  execute function private.check_allocation_month_from_root();
create constraint trigger allocation_month_commitments_publish_check
  after insert on public.allocation_month_commitments
  deferrable initially deferred for each row
  execute function private.check_allocation_month_from_commitment();

-- Task 3: common guards (reusing task 03's generic private.planning_guard_insert
-- / private.planning_reject_mutation -- they read tg_relid, so they need no
-- per-table adapter), RLS, and privilege lockdown on all eight relations.
alter table public.allocation_groups enable row level security;
create trigger allocation_groups_guard_insert before insert on public.allocation_groups
  for each row execute function private.planning_guard_insert();
create trigger allocation_groups_reject_mutation before update or delete or truncate on public.allocation_groups
  for each statement execute function private.planning_reject_mutation();
revoke all on public.allocation_groups from public, anon, authenticated, service_role;

alter table public.allocation_template_revisions enable row level security;
create trigger allocation_template_revisions_guard_insert before insert on public.allocation_template_revisions
  for each row execute function private.planning_guard_insert();
create trigger allocation_template_revisions_reject_mutation before update or delete or truncate on public.allocation_template_revisions
  for each statement execute function private.planning_reject_mutation();
revoke all on public.allocation_template_revisions from public, anon, authenticated, service_role;

alter table public.allocation_template_lines enable row level security;
create trigger allocation_template_lines_guard_insert before insert on public.allocation_template_lines
  for each row execute function private.planning_guard_insert();
create trigger allocation_template_lines_reject_mutation before update or delete or truncate on public.allocation_template_lines
  for each statement execute function private.planning_reject_mutation();
revoke all on public.allocation_template_lines from public, anon, authenticated, service_role;

alter table public.allocation_template_roots enable row level security;
create trigger allocation_template_roots_guard_insert before insert on public.allocation_template_roots
  for each row execute function private.planning_guard_insert();
create trigger allocation_template_roots_reject_mutation before update or delete or truncate on public.allocation_template_roots
  for each statement execute function private.planning_reject_mutation();
revoke all on public.allocation_template_roots from public, anon, authenticated, service_role;

alter table public.allocation_month_snapshots enable row level security;
create trigger allocation_month_snapshots_guard_insert before insert on public.allocation_month_snapshots
  for each row execute function private.planning_guard_insert();
create trigger allocation_month_snapshots_reject_mutation before update or delete or truncate on public.allocation_month_snapshots
  for each statement execute function private.planning_reject_mutation();
revoke all on public.allocation_month_snapshots from public, anon, authenticated, service_role;

alter table public.allocation_month_groups enable row level security;
create trigger allocation_month_groups_guard_insert before insert on public.allocation_month_groups
  for each row execute function private.planning_guard_insert();
create trigger allocation_month_groups_reject_mutation before update or delete or truncate on public.allocation_month_groups
  for each statement execute function private.planning_reject_mutation();
revoke all on public.allocation_month_groups from public, anon, authenticated, service_role;

alter table public.allocation_month_roots enable row level security;
create trigger allocation_month_roots_guard_insert before insert on public.allocation_month_roots
  for each row execute function private.planning_guard_insert();
create trigger allocation_month_roots_reject_mutation before update or delete or truncate on public.allocation_month_roots
  for each statement execute function private.planning_reject_mutation();
revoke all on public.allocation_month_roots from public, anon, authenticated, service_role;

alter table public.allocation_month_commitments enable row level security;
create trigger allocation_month_commitments_guard_insert before insert on public.allocation_month_commitments
  for each row execute function private.planning_guard_insert();
create trigger allocation_month_commitments_reject_mutation before update or delete or truncate on public.allocation_month_commitments
  for each statement execute function private.planning_reject_mutation();
revoke all on public.allocation_month_commitments from public, anon, authenticated, service_role;

revoke all on sequence public.allocation_template_revisions_id_seq from public, anon, authenticated, service_role;
revoke all on sequence public.allocation_month_snapshots_id_seq from public, anon, authenticated, service_role;
