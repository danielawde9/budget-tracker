# 46 — Pay dates and allocation across pay cycles

**Layer:** DB. **Depends on:** 11,14,20. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Selected policy and owned files

Pay cycles subdivide a saved monthly plan. They create neither income nor a second
budget. Reuse task 14 income schedules: biweekly means weekly cadence, interval2.
Three-paycheck months retain all three receipts. A missed salary remains expected
until explicitly skipped; it never becomes actual cash merely because it was due.

Create `_pay_cycle_plans.sql` and
`tests/db/pay-cycle-planning.integration.test.ts`. This task uses **fixed monthly
source targets**, not dynamically shrinking remaining targets. Actual spending
updates the comparison, not the saved cycle assignments.

## Relational contract

Create these typed tables, with all columns NOT NULL unless explicitly nullable.
Use standard audit columns, immutable guards, RLS/revokes and same-space FKs.

| Table | Columns / required constraints |
| --- | --- |
| `pay_cycle_revisions` | id bigint identity PK; space_id uuid; currency currency_code; month_start date normalized; source_snapshot_id bigint; expected_revision_id bigint nullable; cycle_count int1…10; assignment_count int0…1000; audit. Same-month predecessor FK, expected<id, initial/successor UNIQUEs. UNIQUE(id,space_id,currency,source_snapshot_id). |
| `pay_cycle_lines` | revision_id bigint; ordinal int1…10; space_id uuid; currency; source_snapshot_id bigint; starts_on/ends_on date; expected_income_minor numeric(30,0) nonnegative; receipt_count int0…10. PK(revision_id,ordinal); composite FK to revision scope/snapshot. |
| `pay_cycle_income_links` | revision_id bigint; cycle_ordinal int; occurrence_id uuid; space_id uuid; expected_minor bigint positive15digits. PK(revision_id,occurrence_id); FK to cycle and occurrence in same space; deferred income-kind/currency and copied-amount checks. |
| `pay_cycle_root_assignments` | revision_id bigint; cycle_ordinal int; snapshot_id bigint; root_id uuid; amount_minor bigint nonnegative15digits. PK(revision_id,cycle_ordinal,root_id); FK(snapshot_id,root_id) to allocation_month_roots(snapshot_id,category_id); FK to cycle. |
| `pay_cycle_goal_assignments` | same cycle/snapshot columns; goal_id uuid; amount_minor bigint nonnegative15digits. PK(revision_id,cycle_ordinal,goal_id); FK(snapshot_id,goal_id) to allocation_month_goal_lines. |
| `pay_cycle_debt_assignments` | same cycle/snapshot columns; amount_minor numeric(30,0) nonnegative. PK(revision_id,cycle_ordinal); FK(snapshot_id) to allocation_month_commitments. One loan pool per snapshot. |
| `pay_cycle_headroom_assignments` | same cycle/snapshot columns; group_id uuid; amount_minor bigint nonnegative15digits. PK(revision_id,cycle_ordinal,group_id); FK(snapshot_id,group_id) to allocation_month_groups. |

For all five assignment tables add a deferred check that snapshot_id equals its
revision's source_snapshot_id; cycle/revision/space/currency cannot be mixed.
Do not replace these relational sources with arbitrary source_id text foreign keys.
Deferred validators also check exact declared counts, one receipt per revision,
cycle dates cover the month without overlap/gaps, and every assignment source's
sum across cycles equals its saved monthly amount.

Source amounts: each saved root target, goal target, original saved loan commitment
(actual paid observation + remaining observation), and each group's positive
headroom after its children. A root is not also included in the full parent group
amount. Unallocated residual income remains visibly unassigned; it is not another
headroom source. Standalone positive goals/roots/debt are included. If commitments
exceed income, save is allowed with a visible deficit, not adjusted to fabricate
balance. Negative loan commitment after unusual correction requires review.
Task 20 signed carry is a fifth assignment source, separate from income and base
targets. Add `pay_cycle_carry_assignments` with revision_id,cycle_ordinal,
snapshot_id,root_id and signed amount_minor numeric(30,0); PK(revision_id,
cycle_ordinal,root_id), FK(snapshot_id,root_id) to budget_month_carry_links
(target_snapshot_id,root_id), FK to cycle. Per-root sum equals exact saved carry.
Default all carry into the opening cycle; user may split same-sign portions
across cycles. Reject mixed positive/negative parts of one carry source or a sum
mismatch. Negative carry lowers cycle capacity and remains visible; it does not
become negative salary. Include carry rows in assignment_count and payload caps.

## Cycle generation and exact RPCs

Start a zero-income opening cycle on monthStart if the first receipt is later.
Subsequent cycles start on each distinct income due date; end on the day before
the next cycle, with the final cycle ending at monthEnd. Same-day receipts share
one cycle through pay_cycle_income_links. No receipts means one zero-income cycle.
Bound at 10 cycles and10 receipt links; reject overflow explicitly. Materialization
must be complete before preview; reads do not create schedule occurrences.

`preview_pay_cycles(p_space_id uuid,p_currency currency_code,p_month date,
p_snapshot_id bigint)` returns JSON:
`{previewHash,expectedRevisionId,cycles,unassignedLines,shortfallDates}`.
Cycle row: ordinal,startsOn,endsOn,incomeOccurrenceIds,expectedIncomeMinor.
Unassigned row: sourceKind root/goal/debt/headroom/carry,sourceId,amountMinor. IDs are UUID
strings except debt sourceId is the fixed text loan_pool. The preview hash covers
snapshot, income occurrence source revisions/states and existing cycle head.

`save_pay_cycle_plan(p_space_id uuid,p_request_id uuid,p_currency currency_code,
p_month date,p_snapshot_id bigint,p_expected_revision_id bigint,
p_accepted_preview_hash text,p_assignments jsonb)` returns `{revisionId}`.
Assignment exact keys: cycleOrdinal,sourceKind,sourceId,amountMinor. Max 1000 rows,
64KiB payload. Validate → space/request lock → replay → compare heads/hash → verify
complete source sums → append all typed tables → receipt. Future dates and expected
amounts remain planning metadata, never salary events.

`pay_cycle_plan(p_space_id uuid,p_currency currency_code,p_month date)` returns
`{revisionId,snapshotId,needsReview,cycles,assignments,unassignedMinorBySource}`.
All money/bigint IDs are text. Changed source plan or income schedule flags review;
old saved cycles stay readable. Current actual receipts/expenses may be returned
as separate comparison fields in a later projection extension, not mixed into
these saved target amounts.

Default preview splits each source evenly across all cycles, with largest-remainder
minor units awarded in date order. The user edits this before save. A bill due
before its receipt is flagged as needing opening cash; timing allocation does
not promise expected salary will arrive. Actual future cash comes from task 17's
scenario, not a duplicate invented account balance.

## Red fixtures

Two pay dates; three biweekly pay dates; first rent before payday; two same-day
receipts; no receipts;1001 minor units across three cycles→334/334/333; duplicate
source assignment; missing child; foreign snapshot/cycle; skipped salary changes
preview hash; two competing expected-head saves; aggregate income exceeding bigint;
positive/negative carry conservation; no financial digest change; common NULL/ACL/upgrade tests.

## Verification and stopping point

Write the listed rejection/acceptance tests before implementation. DB tasks use
new timestamped forward migrations under `supabase/migrations/` and real disposable
PostgreSQL fixtures from 01; update `docs/financial-command-inventory.md` when RPCs
change. Run the listed focused tests, then env-loaded `pnpm check` for DB changes.
Do not relabel synthetic browser tests as authenticated live-product evidence.

Record actual commands/results in `docs/verification/future-planning/<file-id>.md`,
append decisions (including what changes with a different owner answer), inspect
`git diff --check` and staged scope, then make a conventional commit naming this
feature/layer. Stop here; do not execute the downstream layer or deploy/push.
