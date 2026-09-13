# 26 — Daily tools, charts and explicit category setup

**Layer:** UI. **Depends on:** 25; existing wallet/category gateways; 06 for report comparison. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Execute one named slice per request

26a Search/export;26b repeat/favourites/installability;26c category pack;26d report
drilldown. Do not implement all four when only one is selected. Each has its own
evidence suffix and green commit. No new DB tables or direct Supabase writes.

### 26a Search and full export (X4/X5)

Create `src/features/journal-query/journal-search-panel.tsx`,
`journal-export-dialog.tsx` and tests; integrate only wallet journal toolbar.
Date range, wallet, root, literal text and amount filters; reset pagination on
filter change. Show range/“any leg amount” semantics, clear filters, no-results,
retry and next/previous pages. Export preview names scope/count/currencies before
explicit Download; show progress/cancel/cap error. `e2e/journal-query.spec.ts`.

### 26b Quick entry and installable shell (X3)

Reuse `src/features/wallets/quick-entry.ts` repeat-as-new source. Add
`quick-entry-preferences.ts` and tests for user+space+device scoped favorites≤10,
version1, no amounts/notes persisted by default. Favourites hold type,wallet/category
IDs only; missing/archived IDs require correction. A repeat fills a draft, creates
no event until Confirm and uses a fresh UUID per new confirmed draft. Pending
ambiguous old request cannot be repeated as a workaround. Add manifest/icons
locally under `public/`, theme/name, standalone display; no service-worker caching
of authenticated responses or offline posting. `e2e/quick-entry.spec.ts` proves
repeated expense must be reviewed and posted exactly once. Installability checks
report tested browser/device, not universal mobile support.

### 26c Optional category suggestions (X8)

Create `src/features/categories/category-packs.ts`, `category-pack-dialog.tsx`
and tests. Static version1 bilingual suggestions (Essentials: Housing/السكن,
Food/الطعام, Transport/المواصلات; Lifestyle: Dining/المطاعم, Leisure/الترفيه).
These are suggestion roots, not a mandatory universal hierarchy or seeded rows.
Preview every choice, editable labels, normalize through existing category rules.
Execute existing create-category command≤10 selected entries sequentially, persist
only operation UUIDs/results in in-memory session. On error show created/skipped/
failed and retry only unresolved same UUIDs. Existing normalized name collision
shows existing category, never silently merges income and expense. No SQL seeds.
Owner's earlier Essentials setup remains authoritative for that account.
`e2e/category-pack.spec.ts` tests explicit opt-in, partial failure and no duplicates.

### 26d Reports (N2)

Create `src/features/reports/category-trend.tsx`, `report-drilldown.tsx` and tests;
use typed task 23 trend and search to drill into exact category/month facts. Bars
compare target/actual with signed variance and separate currencies;12month line
shows net ordinary expense and received income, zero months retained. Show
uncategorized totals. Reuse task 08 geometry/accessible table, no floating money.
`e2e/report-drilldown.spec.ts` verifies root totals match event detail.

All slices use current approved workspace shell, logical CSS, `<bdi>` for DB text,
EN/AR, keyboard,320/390/768/1440 widths,200% zoom and amounts masked if H4 active.

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
