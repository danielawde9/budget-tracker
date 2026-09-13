# 45 — Import review and quick-text entry UI

**Layer:** UI. **Depends on:** 44 selected slice. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## CSV flow

Create `src/features/imports/import-page.tsx`, `import-preview.tsx`,
`import-confirm-dialog.tsx`, tests and `e2e/csv-import.spec.ts`. Explicit filepicker
with template download; client validates beforestage. Show row/column errors,
currency/wallet/category mapping,duplicate candidate events, selection≤100 and
sum by currency. Never onecombined USD/LBPsum. Confirmedrows readonly; progress
shows accepted subsets and pending; refreshresumes via batchID authorizedRPC.
Ambiguoussubmit disables editedretry, checks receipt. Cancelbeforeconfirm has no
financial effect; stageddata notice states retained until chosen retention policy,
not a fictional deletion promise. Openingbalance/loan/transfer rows explain
unsupported template and link appropriate existingentry, no workaround posting.

## Quick-text flow

Create `src/features/quick-text/quick-text-entry.tsx`, tests and
`e2e/quick-text.spec.ts`. Live parsed draft shows kind,money,currency,wallet,category,
date; unresolved fields must be picked. Review then existing transactionConfirm,
not Return key autonomous posting. Unknown parse preserves input and explains exact
error. Show EN/AR grammar examples, no AI claims. Repeatafteraccepted creates a new draft
only from user action; timeout retains original request until reconciled.

Both flows: keyboard,focus management,screen-reader error association,EN/AR/RTL,
320/390/768/1440widths,200%zoom. Syntheticfiles andnames inartifacts, no real bank
SMS/receipts. Maskamounts from 39c applies to preview but user can explicitly reveal
before confirmation; hidden number inputs shouldn't accidentally change values.

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
