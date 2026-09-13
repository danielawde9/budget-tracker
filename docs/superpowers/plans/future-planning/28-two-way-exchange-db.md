# 28 — Two-way USD/LBP exchange

**Layer:** DB. **Depends on:** 27. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Objects and public interface

Create `_two_way_exchange.sql`, `tests/db/two-way-exchange.integration.test.ts`.
Keep existing record_usd_to_lbp_exchange signature/replay fingerprints intact.
New `record_currency_exchange(p_space_id uuid,p_request_id uuid,p_from_wallet_id uuid,
p_to_wallet_id uuid,p_from_amount_minor text,p_to_amount_minor text,p_effective_date date)`
→ TABLE(id uuid). Supports exactly USD↔LBP, differing wallets and currencies,
positive canonical15digit amounts. Authoritative facts are both entered amounts;
no rate lookup or floating conversion. Effective rate is derived rational.

Reuse existing exchange kind and two wallet movements: from−A,to+B. Add immutable
`exchange_details(event_id uuid PK FK event,space_id uuid,from_wallet_id uuid,
to_wallet_id uuid,from_minor bigint>0,to_minor bigint>0)` with same-space FKs,
unique(event_id,space), guards and a deferred exact-leg validator. If legacy
exchange has no detail row, derive its two legs for reporting; never invent a
backfill rate or rewrite applied history. New command requires exactly one detail.

Algorithm auth → request lock/replay → wallets in canonical order from 27 → validate
active/currency → append event/detail/two legs → deferred invariant → return ID.
Forward-adjust old exchange lock ordering without changing old payload fingerprint.
Reverse appends negated legs and corresponding inverse economic projection; keep
original detail identity linked via reversal_of, not a contradictory positive
new exchange detail. Validate inverse exactly matches original legs.

## Red fixtures

USD−10000/LBP+8950000 then LBP−4475000/USD+5000 → exchange only, income/expense0.
Reverse each at later date → its own balances restored, report date separation.
Same currency/same wallet/zero/negative/overflow/extra leg/foreign space rejects.
Two simultaneous opposite exchanges serialize without deadlock. Old command vs
new opposite command race also passes; archive race and replay after archive.
Real money in each currency exact, no aggregate converted total.

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
