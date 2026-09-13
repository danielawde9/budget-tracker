# 29 — USD purchase with LBP change

**Layer:** DB. **Depends on:** 27,28,34a semantic allocation foundation. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Scope and schema

Create `_mixed_currency_purchase.sql`,
`tests/db/mixed-currency-purchase.integration.test.ts`. V1 purchase price and
cash tender are USD, change returned in LBP, no embedded fee/tip. Other direction
requires another explicit contract; reject it rather than approximate.

Add specialised `mixed_purchase` kind through earlier enum migration.
`mixed_purchase_details`: event_id uuid PK,space_id uuid,usd_wallet_id uuid,
lbp_wallet_id uuid,tender_usd_minor bigint>0,expense_usd_minor bigint>0,
change_usd_minor bigint≥0,change_lbp_minor bigint≥0,
CHECK tender=expense+changeUSD; CHECK(changeUSD=0 iff changeLBP=0).
FK event/wallets same space, immutable guards. Deferred validator requires wallets
USD/LBP, exactly USD−tender plus LBP+change when change>0 (no zero movement),
semantic category allocations sum=expense USD, never tender.

`record_mixed_currency_purchase(p_space_id uuid,p_request_id uuid,p_usd_wallet_id uuid,
p_lbp_wallet_id uuid,p_tender_usd_minor text,p_expense_usd_minor text,
p_change_lbp_minor text,p_effective_date date,p_category_id uuid)` → TABLE(id uuid).
category nullable expense same-space. Derive changeUSD=tender−expense≥0.
Zero-change should use ordinary expense UI, but command accepts its validated
single USD leg for idempotent API completeness. No automatic market rate.

Follow27 money request/locks; append all facts/legs/categories atomically. Use34a
semantic allocation helper to expose one expense component and no duplicate
legacy association. Rate is changeLBP/changeUSD only when changeUSD>0. Reversal
negates original cash and expense facts by inverse date, no new price calculation.

## Tests

Tender2000,price1500,changeLBP447500 → USDcash−2000,LBPcash+447500,
USDexpense1500,LBPexpense0,USDincome0. Exchange componentUSD500↔LBP447500.
Undo restores both cash currencies and expense1500. Goal purchase fulfillment
may link only 1500 expense USD, never2000 tender or LBP change. Recurring settlement
uses eligible expense1500. Reject price>tender, change supplied with no surplus,
surplus with zero LBP change, mismatched wallets/category and malformed extra legs.
Run full classification matrix and simultaneous exchange/mixed-purchase race.

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
