# 25 — Search and export gateway

**Layer:** gateway/hooks. **Depends on:** 23,24. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Owned files and contracts

Create `src/features/journal-query/types.ts`, `supabase-journal-query-gateway.ts`,
`use-journal-query.ts`, `csv-export.ts` and corresponding `.test.ts`/`.test.tsx`;
add `src/test/in-memory-journal-query-gateway.ts`. Reuse task 07 shared transport.
Extend only necessary client composition. No UI or SQL in this task.

Methods search(query,cursor),trend(root,startMonth,months),prepareExport(filters,
requestId),exportPage(jobId,afterOrdinal),discardExport(jobId) map exactly to23/24
RPC fields. Parse every nested field/cursor and canonical money. Search aborts
previous request; late responses cannot replace another space/filter. Fetch next
page only explicitly, max 100 visible rows per page; no unbounded load-all array.

Implement `escapeCsvCell(value: string): string`: normalize CRLF to LF, prefix a
single apostrophe when value begins with whitespace followed by `=`, `+`, `-`,
`@`, TAB or CR (for textual fields), double internal quotes and wrap in quotes.
Money fields are canonical validated **text**, exported with a type/currency
column; no locale decimal ambiguity. Use columns event_id,effective_date,kind,
wallet_id,currency,amount_minor,payee,note,category_id; one row per movement or
category allocation with explicit row_type to avoid interpreting them as additive
copies. Header version1 and manifest jobId included in metadata file/preview.

Bound export to100000events/20MiB encoded output too (CSV escaping can expand JSON
size). Stream pages to supported writable target; fallback accumulate byte chunks
only within20MiB and revoke blob URL after download. Abort/cancel stops remaining
pages, cleans up job through authorized discard. Never embed credentials in URLs.
One explicit user download action starts export; no external upload.

Tests: quotes/newlines/formula text, Arabic fields, exact9007199254740993 string,
20MiB cap accounting after encoding, cancelled midpage, expired job, removed
member, received accepted prepare but refresh timeout, and no extra prepare UUID.
Use `pnpm exec vitest run --config vitest.ui.config.ts src/features/journal-query`.

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
