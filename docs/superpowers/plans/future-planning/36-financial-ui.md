# 36 — Financial extensions UI slices

**Layer:** UI. **Depends on:** 35 for the selected operation. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Owned files and user flows

Create only selected dialog and its tests in `src/features/money-extensions/`,
plus its `e2e/money-extension-<operation>.spec.ts`. Integrate an action in existing
wallet/loan pages, no new shell redesign. Reuse exact formatter from wallets/money.

| Dialog | Required fields and review before Confirm |
| --- | --- |
| exchange-dialog.tsx | From/to wallets, actual sent/received amounts, date; preview each currency delta and derived rate/date, no implied profit/income. |
| mixed-purchase-dialog.tsx | USD price/tender, LBP change, category/date; review expense USD separately from USD cash out and LBP cash in. |
| fx-repayment-dialog.tsx | Loan + payment wallet, principal reduced in loan currency, actual cash in wallet currency; original outstanding and resulting principal. |
| reference-rate-dialog.tsx | Pair,exact ratio,quote date,source; label display reference and stale/missing state. |
| cash-count-dialog.tsx | Wallet,observedcash → current expected amount,difference → savecount → explicit adjustment confirmation. Zero difference displays matched/no event. |
| split-expense-dialog.tsx | Totalwalletamount,2…20 category lines; live exact sum/remainder; block mismatch; one uncategorized line. |
| refund-dialog.tsx | Original expense,remaining refundable byline,receivedwallet,refund line amounts,date; goal allocation when relevant; clearly distinct from Undo. |
| forgiveness-dialog.tsx | Loan,reduction,reason,date; shows principal effect and cash0. |

For all: no floating money inputs, pasted localized Arabic/Latin digits normalized
through approved input parser; clear errors for invalid decimal precision,
missing same-space/currency wallet and archived category. Confirmation shows
actual server result; ambiguous timeout blocks edited/new request until reconciled.
Success navigates to related journal event; count matched has no fictional event link.
Undo respects refund dependency and explains which linked refund remains active.

Use DB plan fixture in Playwright synthetic gateway flow and assert event list/
bar totals update once. Every slice tests cancel/no-write, replay/refreshfailure,
keyboard focus/escape,EN/AR,RTL,widths320/390/768/1440,200%zoom and masked amounts.
Do not store receipt images or personal loan names in test artifacts. Chart
accessibility includes exact table values; color never the only deficit signal.

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

## Loan people and instalment slice

After35's32a/32b methods, add `loan-person-dialog.tsx`, `loan-due-panel.tsx` and
`loan-instalments-dialog.tsx` with matching tests. Explicitly create/link a person;
same-name candidates remain separate until selected. Show borrowed/lent totals
separately, due/overdue/undated rows and exact outstanding by currency. Instalment
editor accepts≤120 dated amounts, displays sum versus outstanding, refuses edits
to already-materialized dates, and links to existing recurring bill settlement.
Test same labels, odd-minor totals, partial repayment/inverse and permission loss.
