# 09 — Goal and milestone schema implementation plan

> **For agentic workers:** Use executing-plans and test-driven-development.

**Goal:** Constrain goals, full milestone definitions, planning events and
purchase associations without changing the money journal. **Layer:** DB.
**Depends on:** 03,04. **Tech Stack:** PostgreSQL/pg/Vitest.

Create timestamped `_goals_schema.sql`, `tests/db/goals-schema.integration.test.ts`,
`tests/db/goals-migrations.integration.test.ts`; update decisions and evidence09.

## Exact data refinement

Milestone **definitions** are children of a full `goal_revisions` snapshot,
with stable IDs from `goal_milestones`. This replaces the earlier separate
`goal_milestone_revisions` stream; target/deadline/milestones cannot become
inconsistent through independent writes. Checklist completion has its own event
history. Earmark journal and purchase links remain separate from actual money.

## Task 1 — Add complete table shapes after failing constraint tests

```sql
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
```

Add `allocation_month_goal_lines` in task 11 when publication can write it
atomically. No dangling goal column is added to task 04's loan relation.

## Task 2 — Relational/deferred enforcement

Create narrow check helpers/adapters, guarded by the common space lock for new
commands. Definition header+children require exact milestone_count; thresholds
strictly increase by ordinal, ≤target; due dates nondecreasing for amount
checkpoints and ≤goal deadline when present. Checklist state command cannot
target a milestone absent from latest definition or one with kind amount.

Earmark event children: exact declared count; reserve one positive line; release
one negative; move exactly two distinct goals, sum0; reverse exact inverse of
referenced event and cannot reverse a reverse. Effective date equals server UTC
date when command creates it. Existing events never become invalid tomorrow:
do not make a stored CHECK depend on today's moving date.

`private.check_goal_earmark_event(event_id)` is a deferred constraint trigger on
header/lines. It validates nonnegative effective goal earmarks after combining
earmark lines and purchase fulfillment. Schema-only tests may use just earmark
lines; task 10 adds fulfillment awareness before any linking RPC is granted.
An event cannot claim reserve above target less fulfilled less existing earmark.
Target reduction below existing earmark is allowed and does not retroactively
invalidate prior reserve rows. Current command insertion checks enforce it.

Purchase links require purchase-kind goal, ordinary nonreversed expense,
same currency, total links≤eligible expense, and available goal balance from
the expense business date onward. A link is a consumption association; do not
also insert a negative earmark line. Later reversal is derived and restores
consumed earmark. No posting function is changed by this schema file.

## Task 3 — Security and schema tests

Attach common INSERT/mutation guards, revoke API table/sequence rights and enable
RLS on all nine relations. Add FK indexes and goal history/current indexes;
purchase links need indexes by `(expense_event_id,space_id)` and `(goal_id,created_at,id)`.

Cases: foreign goal/currency; null discriminator; missing by-deadline date;
manual amount missing; duplicate milestone/order; threshold>target; 21 milestones;
decreasing threshold/date; incomplete earmark lines; same-goal move; unequal move;
double reversal; reverse-of-reverse; negative resulting earmark; append a late
line to committed event; late milestone child; initial/head forks; grants/RLS/
INSERT guard/zero-row DELETE/TRUNCATE; prior financial digests unchanged.

Run both focused files, empty/seeded replay and full DB gate; commit
`feat(goals): add constrained goal and earmark schema`. No gateway/UI yet.
