# 11 — Goal coverage and planning integration implementation plan

> **For agentic workers:** Use executing-plans and test-driven-development.

**Goal:** Expose truthful goal progress and integrate monthly targets once.
**Layer:** DB. **Depends on:** 06,10. **Tech Stack:** PostgreSQL/pg/Vitest.
Create `_goal_projections.sql`, `tests/db/goal-projections.integration.test.ts`,
`tests/db/goal-month-integration.integration.test.ts`; decisions/inventory/evidence11.

## Task 1 — Cash coverage, monthly contribution and milestone calculations

Compute all relevant goal financing states server-side in one snapshot, then
page/filter. Relevant includes active/paused goals and closed goals with restored
earmarks. Enforce ≤200 relevant rows per currency; on excess fail explicitly,
never truncate before allocating coverage. Sort `priority,created_at,id`.

```sql
with ranked as (
  select goal_id,earmarked_minor,
    coalesce(sum(earmarked_minor) over(order by priority,created_at,goal_id
      rows between unbounded preceding and 1 preceding),0) prior_claims
  from relevant_goals
)
select goal_id,
  least(earmarked_minor,greatest(cash_pool_minor-prior_claims,0)) covered_minor
from ranked;
```

`relevant_goals` is the bounded CTE using task 10 states and current definitions;
`cash_pool_minor` is the single task 10 pool value, not a client field. Use
max(pool,0) conceptually; the greatest expression already prevents negative
coverage. Shortage=earmarked−covered. Sum(covered)≤max(pool,0).

Monthly contribution=sum signed earmark lines by their event date, including
moves/releases and inverses; purchase links/expense reversals contribute zero.
Purchase progress=covered+fulfilled; reserve progress=covered. Milestone amount
complete iff progress≥threshold now; checklist complete by current event head.
Do not persist a funded boolean. Overfunded progress can exceed100%; bars retain
the value and show the amount above target.

Suggested deadline contribution: remaining=max(target−progress,0), months=
12*(deadline.year−today.year)+deadline.month−today.month+1. If overdue and
remaining>0, return overdue with no monthly suggestion. Otherwise ceil(remaining/
months). No date uses manual mode. Short horizon uses creation date+12 calendar
months versus deadline; due-soon filtering uses today. Forecast needs three full
completed months, includes zero months, positive signed mean, rounds periods up,
caps at 120 months and returns an estimate label.

## Task 2 — Public RPCs, exact response fields

| RPC | Arguments | Return |
| --- | --- | --- |
| `goal_page` | p_space_id uuid,p_currency currency_code,p_state_filter text,p_after_created_at timestamptz default null,p_after_id uuid default null,p_limit int default25 | rows,hasMore,nextCursor,asOf |
| `goal_detail` | p_space_id uuid,p_goal_id uuid,p_month date | summary,milestones≤20,earmarkHead,definitionHead,asOf |
| `goal_history_page` | p_space_id uuid,p_goal_id uuid,p_before_created_at timestamptz default null,p_before_source_kind text default null,p_before_source_id text default null,p_limit int default25 | rows,hasMore,nextCursor |

JSON names exact. Summary fields:
`id,revisionId,currency,kind,state,nameEn,nameAr,targetMinor,earmarkedMinor,
coveredMinor,fulfilledMinor,shortageMinor,monthlyTargetMinor,
monthlyNetContributionMinor,dueDate,horizon,needsReview,suggestedMonthlyMinor,
forecastMonth,forecastState,asOf`. All money/revision fields text; nullable only
covered/shortage when coverage unavailable, dueDate/suggestion/forecastMonth.
`horizon=short|long|open`; `forecastState=estimate|insufficient_history|no_positive_pace|beyond_horizon`.
`state_filter=active|paused|closed|all|needs_review`; current relevant closed goals
must still be returned by needs_review. Page filtering happens after coverage.

Milestone row: `id,kind,labelEn,labelAr,thresholdMinor,dueDate,ordinal,currentState`;
threshold null for checklist, currentState complete/incomplete. History uses
complete tuple `(created_at,source_kind,source_id)` in descending order. Source
kinds: definition,earmark,purchase_link,checklist,monthly_target,financial_reversal.
Return one row per source event; bound nested lines≤20. Reject partial cursors.
Every function authorizes current membership and a goal's same-space identity.

## Task 3 — Goal monthly snapshot integration

Add a forward column `goal_line_count integer NOT NULL DEFAULT 0 CHECK 0…100`
to allocation_month_snapshots, and this relation:

```sql
create table public.allocation_month_goal_lines (
  snapshot_id bigint not null,goal_id uuid not null,
  space_id uuid not null,currency public.currency_code not null,
  month_start date not null,group_id uuid,
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
```

Do not overload the old publish RPC ambiguously with default arguments. Create
`publish_allocation_month_v2` with task 05's exact arguments plus
`p_goal_targets jsonb` (required last arg). Goal line shape:
`goalId,groupId` nullable,`amountMinor,expectedRevisionId`. Complete-set publication
includes every positive existing monthly goal target and any selected zero goal.
Zero explicitly removes it from positive commitment; omission rejects.

Under the same transaction, invoke the goal monthly setter using derived child
requests, capture exact revision IDs, persist goal lines/count, validate Future
group debt commitment+goal targets≤group target. Old publish function remains
callable with zero goal lines for months without goal targets; reject use if
existing positive goal targets would be omitted. Old clients cannot accidentally
erase goals. Add common guards/ACLs/indexes and deferred goal_count/exact amount/
Future-purpose checks. Current goal target changes mark snapshot childPlanChanged.

Extend allocation_month_state: Future actual=debt paid + monthly signed net goal
contributions; leftToAllocate subtracts standalone goal targets and Future
excess once. Savings are not category expense, wallet delta or income. Snapshot
goal targets are fixed; fulfilled purchases remain ordinary expenses in actuals.

Tests: pool70000 with claims60000/30000 →60000/10000; drop pool50000 →50000/0;
1001 remaining across3 months →334; late deadline; same goals on different pages
retain identical coverage; a goal target and parent Future target counted once;
old-publish omission rejects; receipt retry of v2 stable; stale goal revision;
closed-restored goals included; all projection authorization/cursor cases.

Run both focused files, seeded upgrade including old snapshots with default0,
full DB check; commit `feat(goals): expose cash coverage and monthly planning`.
