# 44 — CSV parsing and bilingual quick-text drafts

**Layer:** gateway/pure parsing. **Depends on:** 43 for CSV posting; no SQL needed for quick-text. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Execute 44a CSV or 44b quick-text

44a owned `src/features/imports/csv-parser.ts`, `types.ts`,
`supabase-imports-gateway.ts`, `use-imports.ts` and tests, in-memory fake.
44b owned `src/features/quick-text/parser.ts`, `parser.test.ts`, `types.ts`.
Neither task posts from parsing or needs an AI provider.

### 44a Fixed CSV parser

Implement finite-state quoted CSV parser (not split(',')). Input UTF-8≤1MiB,
≤1000datarows,9 exact header fields from 43,cell≤2000chars,no NUL. States unquoted,
quoted,after-quote; accept comma/newline only in legal states, double quote escape,
CRLF/LF, optional BOM. Reject duplicate/unknown/missing headers, malformed quote,
invalid UTF-8 and trailing partial row. No spreadsheet formula evaluation.
Parse dates by calendar roundtrip, kind enum, UUID, minorpositive15digits,currency
validated against the selected wallet server DTO. Preserve raw text only in memory until
stage; trim label fields according to existing metadata caps. Row errors list row key,
column,token, not a guessed correction. No automatic decimal→minor conversion.

Map stage/load/confirm/skip to43 exact RPC. Do not infer request UUID from source hash;
explicit batch UUID, stable per-command UUID and server-derived deterministic financial child requests.
Progress confirmed/skipped/pending counts; reconcile ambiguous receipt before
resubmitting selected100rowbatch. Entire file not uploaded to external provider.
Tests RFC-style quotes,newline in notes,Arabic,wrong encoding,1001rows,oversize,
partial confirmation error,duplicate acknowledgement and timeout after commit.

### 44b Deterministic EN/AR grammar

Supported exact grammar v1: `<action> <amount> <currency> [@wallet] [#category]
[on YYYY-MM-DD] [; note]`. Actions income/دخل,expense/مصروف. Currency USD/LBP
or exact approved aliases دولار/ليرة. Amount accepts Latin/Arabic-Indic digits,
one decimal separator `.` or `٫`, USD0…2fractiondigits,LBP integer only. No commas
thousands or guessed `$`/ambiguous LL. Positive≤15minorDigits. Missing action/
currency/wallet/category returns unresolved field, never posts. Wallet/category
resolve against loaded authorized exact labels/UUIDs; multiple matches unresolved.
Default business date=today shown for review; output explicit warnings includes
used_default_date. Unknown words before semicolon error; notes≤2000chars.

Return discriminated `DraftParseResult = {kind:'draft',draft,unresolved,warnings}
| {kind:'invalid',errors}`. Draft carries canonical money,currency,kind,date,
walletId nullable,categoryId nullable,note. Never treat payee string as an ID.
Tests `مصروف ١٢٫٥٠ USD @Cash #Food on 2026-09-13`→1250, invalid12.501USD,
LBP1.5reject, duplicate wallet names unresolved, negative/zero/dateFeb30reject,
SQL-looking note stored as text, unsupported SMS text invalid. Same typed transaction
confirm flow as existing wallet entry; parser produces no request until review.

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
