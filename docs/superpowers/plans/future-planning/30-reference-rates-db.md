# 30 — Dated manual reference rates

**Layer:** DB. **Depends on:** 03. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Tables and RPC

Create `_reference_rate_quotes.sql`, `tests/db/reference-rates.integration.test.ts`.
`exchange_rate_quotes`: id bigint identity PK,space_id uuid,currency_from
currency_code,currency_to currency_code,from_minor bigint1…999999999999999,
to_minor bigint1…999999999999999,quote_date date,source_label text1…120,
expected_quote_id bigint nullable,request_id uuid,actor_id uuid,created_at now.
CHECK from currency<>to; same pair predecessor stream; standard guards/RLS/FKs/
receipt. Index(space_id,currency_from,currency_to,quote_date DESC,id DESC).
These amounts form an exact rational **minor-to-minor** ratio, not major units.

`record_reference_rate(p_space_id uuid,p_request_id uuid,p_from_currency currency_code,
p_to_currency currency_code,p_from_minor text,p_to_minor text,p_quote_date date,
p_source_label text,p_expected_quote_id bigint)` → JSON{quoteId}.
Normalize ratio by greatest common divisor before fingerprint. No rate service,
background fetch, or claim of current official rate. Allow past/today, reject
future date. Source label is user text, not trusted HTML or verified attribution.

`reference_rate_at(p_space_id uuid,p_from_currency currency_code,p_to_currency
currency_code,p_as_of_date date)` → JSON {quoteId,fromMinor,toMinor,quoteDate,
sourceLabel,isStale}; null quote fields if absent. Prefer exact-direction latest
quote≤asOf; do not implicitly choose inverse unless explicitly returned with
inverted=true and reciprocal exact ratio. V1 exact direction only; stale means
quoteDate<asOf, not an invented provider validity SLA.

Display conversion helper numeric multiply then round half-up to target minor
unit: floor((abs(amount)*toMinor*2+fromMinor)/(2*fromMinor)), restore sign. Return
rounded result and residual numerator, never modify canonical balances.

Tests 100USDminor→89500LBPminor synthetic, exact reciprocal absent, half minor tie,
negative display conversion symmetric, maximum-bound numeric intermediate, stale/
missing quote, replay after newer quote, cross-space denied. No event/movement
created by quote command and reports continue separate currency totals.

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
