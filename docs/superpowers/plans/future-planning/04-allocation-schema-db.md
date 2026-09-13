# 04 — Allocation schema implementation plan

> **For agentic workers:** Use executing-plans and test-driven-development.

**Goal:** Store immutable templates and monthly snapshots with relational
tenancy, currency, predecessor and child constraints. **Layer:** DB.
**Depends on:** 03. **Tech Stack:** PostgreSQL/pg/Vitest.

Create timestamped `_allocation_schema.sql`,
`tests/db/allocation-schema.integration.test.ts`,
`tests/db/allocation-migrations.integration.test.ts`; update decisions/evidence.
No RPC publishing or application edits in this file.

## Refinement that wins over the earlier proposal

Group identity is immutable and scoped to space/currency. Group names, order
and percentages are versioned as **template lines**, eliminating a second
independently mutable group-definition stream. A group omitted from the newest
template is inactive for new planning; historical lines remain readable. Group
purpose is immutable; changing purpose creates a new identity. Month snapshots
copy exact labels/weights and record source revisions. This removes the need
for the earlier proposed `allocation_group_revisions` table.

## Task 1 — Write schema rejection tests, then add this DDL

All tables receive the common guards/ACLs/RLS in task 3 below. Column shapes
alone are not the completed migration.

```sql
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
```

Null group on month roots/loan pool means a standalone commitment, not a lost
line. Template mappings require a group. Income revision and target revision
IDs must match snapshot kind/category/month/currency/amount in task 2 checks.

## Task 2 — Deferred validation (mandatory, same migration)

Implement `private.check_allocation_template(p_template_id bigint) RETURNS void`
and `private.check_allocation_month(p_snapshot_id bigint) RETURNS void`.
Both select/lock their header first and raise `23514` with a stable constraint
token. Invoke them from deferred row constraint triggers on the header and each
child relation. Trigger body uses `NEW.id` on header and `NEW.template_id` /
`NEW.snapshot_id` on children; use separate short trigger adapters, not dynamic SQL.

Template checks, in order:

1. Child counts exactly equal header counts; total basis points≤10000.
2. Every mapped category is an expense root; its group purpose is spending.
3. No group reference escapes template space/currency (FK also enforces this).
4. Predecessor ID is smaller than new ID and is the head before this row;
   initial/successor indexes prevent stream branching under injected inserts.

Month checks, in order:

1. Exact declared group/root/loan counts; all groups copy the selected template
   labels/order/purpose/bps; compare with `IS DISTINCT FROM` including nulls.
2. Target amounts and unallocated equal task 05 apportionment output once that
   helper exists. In this schema-only step enforce sum(targets)+unallocated=
   base_income and bps≤10000; task 05 strengthens to exact apportionment.
3. Income revision has kind income, matching space/month/currency/amount.
4. Each root revision has kind expense_category, matching root/month/currency/
   amount. Each nonnull group matches that root's chosen template mapping.
5. Roots with a group sum≤spending group target. A loan group has purpose future
   and its observed commitment fits the group at publication. No negative
   principal cash sum may be silently clamped in an ordinary report.
6. Current active-category validation is **at command insertion time**, not a
   permanent invariant: archiving a category tomorrow must not invalidate an
   old immutable month. Root parent/kind/space are immutable and remain checked.

## Task 3 — Guards, indexes and schema-only evidence

Add FK-supporting indexes for every referencing key not covered by an existing
left-prefix PK/index: group space/currency; template-line group; template-root
category; month template and income revision; month-group group; month-root
category/target revision/group; month-commitment group. Inspect catalog, do not
add redundant copies of an already-covered prefix.

Enable RLS, revoke all API table/sequence rights, attach common INSERT and
statement mutation guards to all eight new relations. Tables remain command-only.

Write real-engine cases: wrong space/currency FK; income category as root;
nonnull child parent; duplicate root/group/order; 13 groups; 201 roots; total
10001 bps; initial revision fork; successor fork; header with missing child;
late child inserted into committed snapshot; wrong referenced plan kind;
temporary privilege/policy bypass still denied by INSERT guard; zero-row delete.

Run focused schema+migration files and full DB checks from test recipes. Because
public commands do not yet exist, seed valid normalized rows as admin solely in
disposable tests and force deferred constraints before commit. Commit
`feat(planning): add constrained allocation revision schema`. Exit before 05.
