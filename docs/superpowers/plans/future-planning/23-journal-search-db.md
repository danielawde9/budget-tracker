# 23 — Journal search and report drilldown

**Layer:** DB. **Depends on:** 02. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Owned files and first tests

Create `_journal_search.sql`, `tests/db/journal-search.integration.test.ts` and
`tests/db/report-drilldown.integration.test.ts`. Preserve existing journal RPC
return shapes. Do not add a search service or extension before measuring Postgres.

## Exact read interface

`journal_search_page(p_space_id uuid,p_from_date date,p_to_date date,
p_wallet_id uuid,p_root_id uuid,p_payee text,p_min_minor text,p_max_minor text,
p_query text,p_uncategorized_only boolean,p_before_effective_date date,p_before_created_at timestamptz,
p_before_id uuid,p_limit int)` → JSON `{rows,hasMore,nextCursor}`. All optional
filters/cursor args are required positions accepting NULL; limit1…100, dates
inclusive≤366days, query/payee trimmed≤120chars; amount filters nonnegative 15 digits,
min≤max. Full cursor tuple required or all NULL. Order effective_date DESC,
created_at DESC,id DESC, with identical tuple predicate and limit+1.

Rows one per financial event, not per movement. Fields:
`id,kind,effectiveDate,createdAt,actorId,note,payee,reversalOf,movements,categories`.
Movement row≤20: walletId,walletName,currency,amountMinor. Category row≤20:
categoryId,rootId,nameEn,nameAr,amountMinor,currency. Notes/payees use latest
existing metadata revisions, no second mutable column. Explicit NULL when absent.
Reversed source and inverse are both visible with links. No artificial negation.

Filter wallet/root via EXISTS so a transfer/split event remains one row.
min/max applies to absolute movement amount for a selected wallet; without wallet
it matches any leg (clearly named “any leg amount”), never a nonsense cross-currency
sum. Query literal substring over note/payee/category display names; escape `%`,
`_` and backslash before ILIKE ESCAPE. Use current existing normalization for Arabic
names, not stemming. Parameterized SQL only. No SQL fragment concatenation.

`report_category_trend(p_space_id uuid,p_currency currency_code,p_root_id uuid,
p_start_month date,p_months int)` returns `{currency,rootId,months}` with ≤12 rows:
month,incomeMinor,expenseMinor,targetMinor,varianceMinor. Normalize month required,
root expense-only same space; incomeMinor is space ordinary income, not root income.
Use task 02 classification and task 34 semantic allocations once present; zero-fill
months. Category root must include its children once. Label the income denominator.

## SQL shape and indexes

Start filtered_events CTE using events(space_id,effective_date DESC,created_at DESC,id
DESC); EXISTS movement/event indexes, latest metadata lateral indexed(event_id,id
DESC). Page event IDs before collecting nested rows. Search string scanning is
bounded by date and statement timeout, but do not truncate candidate events before
applying query filters. Add an index only if absent; measure10000-event fixture.
Keep protected reads DEFINER member-authorized; no new raw plan table grants.
Classify new RPC in existing command inventory/ratchets.

## Acceptance

1. Create150events, match in oldest page → searchable despite not loaded in UI.
2. Same date/time three UUIDs, transfer with two legs, split20lines → stable unique
   event pages; no duplicate/omitted IDs when concatenated without new writes.
3. Literal `50%`, `_`, apostrophe and Arabic diacritics normalization cases.
4. Root rollup sums child once; expense−5000 plus inverse+5000 nets0.
5. Another space's wallet/root rejects instead of returning sensitive existence.
6. Movement maximum-bound and aggregate text exact; NULL partial cursor rejects.
Concurrent new writes may appear only in a fresh first page; ordinary search is
not a frozen export. Test metadata changes without promising snapshot pagination.

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

`p_uncategorized_only` is required boolean (normal search false). When true require
root filter NULL and match an uncategorized semantic income/expense allocation,
not “all events because root was null.” A split with one NULL-category portion
matches once; a transfer/exchange with no category does not become uncategorized
ordinary spending. Add this field to the typed query in25 and toolbar26a.
