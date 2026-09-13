# 48 — Paycheck-by-paycheck planning UI

**Layer:** UI. **Depends on:** 47;16 upcomingbills. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

Create `src/features/pay-cycles/pay-cycle-page.tsx`, `cycle-assignment-editor.tsx`,
`pay-cycle-timeline.tsx`, tests and `e2e/pay-cycles.spec.ts`. Linkfromexisting Plan
page; no parallel shell. Show month total,eachcycle dates/expected receipts,assigned
roots/goals/debt/headroom and early bill shortfalls. Clearly label future income
expected; missed income is not actual cash. Drag/drop optional; accessible numeric
editormust support full keyboard allocation without dragging.

Complete-per-source totals show assigned/remaining; refusesave mismatch and
surface exactserver errors. Same-date salary occurrences displayed underonecycle.
Threereceiptmonth has3receiptcycles plus possible opening partial cycle; do not
force monthinto two halves. Recalculatepreviewdiff when the monthly plan changes,
retain saved history and require user review before publish.

Test1001allocation,early rent before payday,missed salary,zero-income month,stalehead,
source category archive,space switch,timeout then receipt reconciliation. Cyclebar/table exactmoney,
EN/AR/RTL,320/390/768/1440,keyboard,200%zoom and masked amounts. Confirm changes
planningonly; assert fake journal postingcount remains0.

## Verification and stopping point

Write the listed rejection/acceptance tests before implementation. DB tasks use
new timestamped forward migrations under `supabase/migrations/` and real disposable
PostgreSQL fixtures from 01; update `docs/financial-command-inventory.md` when RPCs
change. Run the listed focused tests, then env-loaded `pnpm check` for DB changes.
Gateway/UI tasks run focused UI-config Vitest, `pnpm typecheck`, `pnpm test:ui`,
`pnpm build`; UI additionally runs its named Playwright spec and `pnpm test:e2e`.
Worker tasks run focused worker tests, `pnpm test:worker`, typecheck and build.
Do not relabel synthetic browser tests as authenticated live-product evidence.

Record actual commands/results in `docs/verification/future-planning/<file-id>.md`,
append decisions (including what changes with a different owner answer), inspect
`git diff --check` and staged scope, then make a conventional commit naming this
feature/layer. Stop here; do not execute the downstream layer or deploy/push.

Signed carry appears as its own cycle adjustment, separate from expected income.
A negative carry reduces capacity visibly. Never change the base percentage or
salary amount to hide it. Test +2000 and−2000 carry into the opening cycle and
exact per-root conservation when the user spreads it across cycles.
