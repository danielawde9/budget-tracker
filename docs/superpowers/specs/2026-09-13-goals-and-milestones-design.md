# Short- and long-term goals with milestones — proposed design

**Status:** planning only, prepared 2026-09-13. Depends on the
[allocation design](2026-09-13-income-allocation-and-daily-control-design.md).
Implement only after a request names G1, G2 or G3 from the
[implementation packets](../plans/2026-09-13-future-planning-implementation.md).

## 1. Goal types and human flows

| Type | Example | What progress means |
| --- | --- | --- |
| `reserve` | Emergency fund or home deposit | Money currently earmarked and its current cash coverage |
| `purchase` | Laptop or school fees by a date | Currently covered earmark plus explicitly linked fulfilled spending |
| `debt_payoff` (later L4) | Pay off money owed | Reduction in linked loan principal, never a savings balance |

G1–G3 deliver reserve and purchase goals. Debt-payoff uses a later loan-linked
adapter; no duplicated debt table is introduced here. A goal has one currency
and one space. A broader aspiration such as “Move home” can have separate USD
and LBP goals displayed together without a combined monetary progress percent.

Create flow: choose type → name → currency → target → optional deadline →
monthly contribution preference → milestones → review. Existing savings are
funded by earmarking already-recorded wallet cash; entering a goal's starting
amount must never create a second wallet opening or fake income.

Detail shows target, earmarked, cash-covered now, funding shortage, next
milestone, monthly target versus net contribution, and history. Actions:
reserve, release, move allocation between goals, link an existing goal purchase,
edit future target/date, pause/resume, and close. Each action has a review and a
request-stable retry. No direct editing of displayed progress.

Goal horizons are derived using the goal creation UTC date and deadline:
deadline ≤ creation date +12 calendar months is short-term; later is long-term;
no deadline is open-ended. An approaching long-term goal stays in its original
horizon unless its deadline is revised. Also filter by “Due within 90 days.”
Pause stops suggestions and new positive funding, preserves existing earmarks,
and permits release/fulfillment. Close requires zero remaining earmark and
retains history. Reopening is an explicit revision.

## 2. Monthly targets, deadlines and milestones

Target amounts are positive, up to 999999999999999 minor units. Deadlines are
calendar dates; audit timestamps come from database `now()` in UTC. Goal revision
commands receive no client-supplied audit timestamp. A user-selected deadline
or effective planning date is a business date, not an audit timestamp.

Contribution modes: `manual_monthly` (explicit amount, including zero) or
`by_deadline`. For by-deadline goals:

```text
remaining = max(target - currently_cash_covered - fulfilled_amount, 0)
months = calendar months from current UTC month through deadline month, inclusive
suggested_monthly = ceil(remaining / months) when deadline >= today
```

Reserve goals have fulfilled_amount = 0. For a deadline already passed and a
positive remainder, return `overdue` and the remaining amount, not division by
zero or an invented new date. A goal due today has one remaining month slot;
show “Due today” so the monthly suggestion cannot hide urgency. No deadline
uses manual mode. Suggestions do not append monthly targets until reviewed.
Revisioning a goal does not silently rewrite saved monthly budget snapshots.

The optional forecast uses the mean of the last three **completed calendar
months** of signed net contributions, including zero months. Require all three
months of history and a positive mean; otherwise show “Not enough history” or
“No positive contribution pace.” Use exact rational arithmetic and round months
up. Cap displayed projections at 120 months and label them estimates, with no
investment return, inflation, or interest assumption.

Milestones have stable identity within a goal and revisioned definitions:

| Milestone kind | Fields | Completion |
| --- | --- | --- |
| Amount checkpoint | label, threshold_minor, optional due_date, ordinal | Derived from eligible progress; can fall below threshold again |
| Checklist checkpoint | label, optional due_date, ordinal | Explicit member `complete`/`reopen` event; never contributes money |

Up to 20 active milestones per goal. Positive amount thresholds cannot exceed
the goal target. Amount thresholds and their ordering must be strictly increasing;
dated amount checkpoints must be nondecreasing by date and no later than the
goal deadline. Duplicate names are allowed; stable IDs disambiguate them.
Suggested 25/50/75/100% checkpoints are optional, integer-rounded, and deduplicated
for tiny targets. The member can replace them with meaningful checkpoints such
as “First $500,” “One month's essentials,” “Deposit ready.”

A milestone is not a second goal balance: $500/$1,000/$2,000 checkpoints refer
to one $2,000 target, not $3,500 of commitments. Revising a target below existing
thresholds requires revised milestones in the same atomic command. Checklist
completion remains independent of cash and clearly labelled.

## 3. Reservation accounting: preserve the money ledger

Use an append-only **earmark journal**. It records planning intent, not cash
movements or locked funds. It cannot prohibit a later expense. It must never be
called a real bank transfer or an enforceable cash hold.

For each currency, the initial coverage pool is the signed sum of all visible
space wallet balances through the current UTC date. Include negative balances;
do not apply `max(wallet_balance,0)` to each wallet. Future-dated postings do not
count as current cash. The scope is the whole space: separate per-wallet goal
funding and non-spendable assets are later extensions. Missing balances make
coverage unavailable rather than zero.

Let Rg be each goal's nonnegative remaining earmark and C the aggregate cash.
Show earmarks even if sum(Rg) exceeds cash. Compute coverage in priority order
`priority asc, goal.created_at asc, goal.id asc`:

```text
available_pool = max(C, 0)
covered[g] = min(Rg, max(available_pool - sum(earmarks of prior goals), 0))
shortage[g] = Rg - covered[g]
```

The priority allocation is an explicit display/planning rule, not a claim
about which physical wallet holds each goal. Changing priority previews the
effect on every affected goal. Sum(covered) ≤ max(C,0), so the same dollar cannot
be displayed as fully covering two goals. Label “Cash-covered now, before other
bills” until B2 can display all commitments together. Unpaid bills may still
make the overall plan short even when an individual goal is cash-covered.

Example: cash $700, emergency earmark $600, laptop earmark $300. Priority emergency
first gives covered $600 and $100, with laptop shortage $200. Spending $200
without releasing an earmark makes coverage $500/$0 and shortages $100/$300.
The claim journal does not change; the user sees why their plan needs adjustment.

Reservation commands may accept an earmark larger than current cash only with
an explicit `accept_underfunded` review flag. No cash guarantee is made even
when the preview was covered: a simultaneous or subsequent journal posting can
change coverage. Read cash and goals in one statement snapshot for each
projection. Serialize all earmark operations per space/currency and per goal;
existing financial posting commands do not need new locks for this advisory
model. Binding reservations would require a separately approved architecture.

### Earmark operations

| Operation | Remaining earmark | Monthly net contribution | Cash ledger |
| --- | --- | --- | --- |
| Reserve existing cash | +amount | +amount | No change |
| Release earmark | −amount | −amount | No change |
| Move between two goals | −source/+destination atomically | −source/+destination; net zero across goals | No change |
| Fulfill purchase with linked expense | −amount | 0 | Expense was already posted once |
| Reverse planning operation | Inverse of that operation | Inverse contribution where applicable | No change |
| Reverse linked purchase event | Restores effective earmark; reduces fulfilled amount | 0 | Existing journal reversal supplies inverse cash |

Each remaining earmark must stay nonnegative at command commit. Release cannot
exceed it. Reserving above the unfilled target is rejected; reducing the target
below existing earmarks is permitted through a reviewed revision and displays
overfunding without deleting prior allocations. Transfers between goals require
the same space/currency, different goal IDs and stable lock order.

Purchases are linked by a new non-posting command to an existing ordinary
expense event in the same space/currency. Require effective date ≤ today, no
active reversal, and enough remaining earmark. Sum of all active goal links
cannot exceed the event's positive ordinary expense value; lock the event and
goals during validation. One expense may partly fulfill several goals using
bounded association lines (maximum 20), never duplicate the expense in reports.

Fulfillment is effective on the expense date but cannot precede the reserved
funds being available in the goal's effective history. Earmark reserves/releases
use server UTC current date in v1; no backdating. Therefore an old purchase
cannot consume a newly created reserve and masquerade as prior saving. It can
remain an ordinary expense. A later richer opening-history feature needs its
own contract.

If an expense is reversed, the projection nets its fulfillment at the reversal
date and restores the consumed earmark. This is derived from original + inverse
events; no automated plan write is needed. A later correction expense needs
its own explicit association. If reversal restores funds to a closed goal,
display `needs_review` with the restored earmark, include it in coverage and
permit release/reopen. Do not silently discard it or let closed status hide it.
Monthly reports show fulfillment on its business dates and the original link's
recording time in audit history.

For purchase goals, progress = covered remaining earmark + net fulfilled amount.
For reserve goals, progress = covered earmark. Both may fall after corrections
or releases; “currently funded” and “previously achieved” are different facts.
Do not persist a once-true funded boolean as the current balance.

## 4. Proposed SQL relations

Use the allocation spec's command receipts, authorization, limits and immutable
history protections. These are future relations, not current deployed objects.

| Relation | Required shape and constraints |
| --- | --- |
| `goals` | id uuid PK, space_id, currency, goal_kind reserve/purchase, created_by, created_at now(); UNIQUE(id,space_id,currency); kind and currency immutable |
| `goal_revisions` | id bigint identity, goal+space+currency FK, names ≤120 chars, note ≤1000, positive target, optional deadline, contribution_mode, monthly_amount, priority 0…999, state active/paused/closed, expected_revision_id, receipt/actor/time; shape CHECK `IS TRUE` |
| `goal_milestones` | id uuid PK, goal+space FK, created_at/actor; max 20 active identities via command lock |
| `goal_milestone_revisions` | id, milestone+goal+space FK, kind amount/checklist, label ≤120 chars, optional positive threshold, optional due date, ordinal 0…19, archived, receipt/actor/time; discriminated CHECK `IS TRUE` |
| `goal_milestone_events` | id, milestone+goal+space FK, action complete/reopen, expected_event_id, receipt/actor/time; only checklist kind permitted |
| `goal_earmark_events` | id bigint identity, space, currency, operation reserve/release/move/reverse, effective_date server UTC date, reversal_of optional UNIQUE, receipt/actor/time; reverse references same space/currency |
| `goal_earmark_lines` | event+space+currency FK, goal+space+currency FK, signed nonzero amount; UNIQUE(event,goal); 1 line reserve/release, exactly 2 balanced opposite lines move, exact inverse lines reverse |
| `goal_purchase_links` | id, goal+space+currency FK, expense_event+space FK, positive amount, source_earmark_head token, receipt/actor/time; amount bounded by expense; this association reduces effective remaining earmark, not a second earmark debit |
| `goal_monthly_target_revisions` | id, goal+space+currency FK, month_start, amount≥0, expected_revision_id, receipt/actor/time; separate from lifetime target and from cash |
| `allocation_month_goal_lines` | snapshot+space FK, future group+space FK, goal+space+currency FK, goal monthly revision id, amount snapshot; UNIQUE(snapshot,goal); enabled in G1 |

Index all composite foreign keys and `(space_id,currency,goal_id,id desc)` history
access; index expense links by expense ID and goal. Every aggregate uses
numeric intermediate and returns minor units as text. Limit active goals to
100 per space/currency; a closed goal restored by reversal still participates
in coverage and is returned with `needs_review` regardless of that active cap.
Coverage calculation reads all relevant goal heads server-side, not only the
current page; require a bounded 200 relevant goals per currency and reject new
goal creation when that bound would be exceeded until existing restored goals
are resolved. No browser page subtotal may stand in for the coverage pool.

The signed-line shape, nonnegative effective earmark and link amount ceiling
need constraint triggers plus command checks under shared planning locks.
Triggers reject direct writes even if a test grants a role INSERT. Grant no
financial-table writes to implement these commands. Creation, full definition
revision and milestone replacement must be atomic; a stale revision rolls back
all inserted rows. Closed/restored handling is a projection state, not an
unauthorized mutation to a saved goal definition.

## 5. Proposed RPC and TypeScript contracts

Every mutation takes space/request identity, validates active membership before
replay lookup, fingerprints all semantic fields, uses compare-and-swap where
editing heads, and returns stable receipt identity. Query pages are 1…50 goals
or 1…100 history rows; complete cursors required. No unbounded “load all.”

```ts
// Proposed contents of src/features/goals/types.ts; string money is mandatory.
export type GoalKind = 'reserve' | 'purchase';
export type GoalState = 'active' | 'paused' | 'closed';
export interface GoalSummary {
  id: string;
  revisionId: string;
  currency: 'USD' | 'LBP';
  kind: GoalKind;
  state: GoalState;
  nameEn: string | null;
  nameAr: string | null;
  targetMinor: string;
  earmarkedMinor: string;
  coveredMinor: string | null;
  fulfilledMinor: string;
  shortageMinor: string | null;
  monthlyTargetMinor: string;
  monthlyNetContributionMinor: string;
  dueDate: string | null;
  needsReview: boolean;
  asOf: string;
}
export interface GoalDefinition {
  kind: GoalKind;
  currency: 'USD' | 'LBP';
  nameEn: string | null;
  nameAr: string | null;
  targetMinor: string;
  deadline: string | null;
  contributionMode: 'manual_monthly' | 'by_deadline';
  monthlyAmountMinor: string | null;
  priority: number;
}
export interface GoalMilestoneInput {
  id: string;
  kind: 'amount' | 'checklist';
  label: string;
  thresholdMinor: string | null;
  dueDate: string | null;
  ordinal: number;
}
```

```text
create_goal_plan(space, request, definition_json, milestones_json) -> goal_id, revision_id
revise_goal_plan(space, request, goal, expected_revision, definition_json,
                 milestones_json, state) -> revision_id
record_goal_earmark(space, request, goal, action reserve/release, amount,
                    expected_earmark_head, accept_underfunded) -> event_id
move_goal_earmark(space, request, from_goal, to_goal, amount,
                  expected_from_head, expected_to_head, accept_underfunded) -> event_id
reverse_goal_earmark(space, request, original_event, expected_heads_json) -> event_id
link_goal_purchase(space, request, expense_event, goal_lines_json,
                    expected_heads_json) -> link_ids
set_goal_monthly_target(space, request, goal, month, amount, expected_revision) -> revision_id
set_goal_milestone_state(space, request, milestone, complete/reopen,
                          expected_event_id) -> event_id
goal_page(space, currency, state_filter, after_created_at?, after_id?, limit)
  -> GoalSummary rows, complete next cursor
goal_detail(space, goal, month) -> summary + ≤20 milestones + head tokens
goal_history_page(space, goal, before_created_at?, before_source_kind?,
                    before_source_id?, limit) -> bounded audit rows + complete cursor
```

No posting command called `create_goal` exists in the current repository; these
names deliberately refer to product goals and are unrelated to Codex task tools.
Gateway parsers reject unknown states/kinds, duplicate IDs, null money where
required, unsafe JSON numbers, invalid dates and mixed currencies. A goal page
with one invalid row fails as a page, preserving the last confirmed state with
an error; it does not quietly discard the goal.

## 7. Core acceptance matrix

| Fixture | Expected result |
| --- | --- |
| Goal $1,200, $300 covered, October–December slots | Suggested monthly $300 |
| Goal 1001 cents, 3 months, no saving | Suggested 334 cents, final funding capped to remaining 333 |
| Reserve goal $2,000 with checkpoints 500/1000/2000 | One $2,000 target; checkpoints never summed |
| Reserve $200, transfer $200 between wallets | Goal remains $200; cash pool unchanged |
| Reserve $200 then release $50 | Earmark 150; net contribution 150; cash unchanged |
| Move $50 between goals | One transaction, net total earmarks/contributions unchanged |
| Purchase goal earmark $1,000; link $400 valid expense | Earmark 600, fulfilled 400, progress 1000 if remaining cash covers 600; ordinary expense +400 only |
| Reverse that expense on a later date | Earmark restored 1000, fulfilled zero; monthly ordinary expense −400 on reversal date |
| Second link would exceed expense amount | Reject entire command and receipt insert |
| Goal creation starting cash value | No income/opening event generated; use existing money only |
| Same expense linked concurrently | Serialized ceiling check; total links never exceed value |
| Cash falls below reservations | Show uncovered amount; no fabricated saved progress |
| Spend inside budget but salary missing | Keep goal target; show cash coverage and income shortfall separately |
| Release from another member's private space | Denied, including receipt lookup |
| Zero-row DELETE/TRUNCATE on history | Rejected even under temporary test grants |
| Stale editor revises deadline and milestones | Reject all; reload current definition; no partial milestones |
| Target reduced below saved amount | Show overfunded; retain history and permit explicit release |
| Goal's achieved milestone falls below threshold | Current state returns below target; no permanently stuck green badge |
| Close after fulfillment, then journal reversal | Restored earmark visible in needs-review and coverage; release/reopen available |

## 8. UI integration and exclusions

Goals appear within Plan, grouped by horizon, with funded/behind/paused states
and a next milestone. Selecting a card opens a detail with labelled progress
bars and an accessible history table. A 100% bar never means money is locked;
labels disclose earmark versus current coverage. Warnings are factual:
“$200 of this goal is not covered by current cash,” with actions to adjust
priority, release allocation, or inspect entries. No guilt language.

Real verification includes create → contribute → spend unexpectedly → review
shortage → release/reprioritize → fulfill → reverse → inspect milestone changes,
plus keyboard, mobile, EN/AR, RTL, mixed scripts, large amounts and offline errors.
This spec does not design investments, asset valuation, automatic bank transfers,
investment advice, interest forecasts, encrypted attachments or reminders.
