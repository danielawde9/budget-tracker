# 31 — Cross-currency loan repayment

**Layer:** DB. **Depends on:** 27,28. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Tables, arguments and algorithm

Create `_cross_currency_repayment.sql`,
`tests/db/cross-currency-repayment.integration.test.ts`. Add kind
`loan_fx_repayment` in an earlier enum migration. One specialised event supports
both directions: i_owe_them cash out; they_owe_me cash in. Loan principal stays
in loan currency. No implied conversion using reference rates.

`loan_fx_repayment_details`: event_id uuid PK,space_id uuid,loan_id uuid,
wallet_id uuid,loan_minor bigint>0,cash_minor bigint>0,loan_currency,cash_currency,
CHECK different currencies, same tenant FKs to event/loan/wallet. Deferred shape
checks require exactly one loan posting(principal_delta=−loanMinor,
repayment_effect=+loanMinor) and one wallet movement(−cashMinor if debt,+ if asset).
All individual values capped15digits. Ratify current repayment_effect semantics
against existing fixtures before extending; inverse negates both posting columns.

`record_cross_currency_repayment(p_space_id uuid,p_request_id uuid,p_loan_id uuid,
p_wallet_id uuid,p_loan_amount_minor text,p_cash_amount_minor text,p_effective_date date)`
→ TABLE(event_id uuid). Auth/request replay → loan FOR UPDATE → wallet lock →
validate currency pair/active, amount≤current outstanding → append event/detail/
loan posting/movement. No fee or excess-overpayment support; explicit reject.

Update reports: debt reduction shown in loan currency; actual cash repayment
shown in wallet currency. Budget cash commitment consumption in payment currency
uses actual cash fact. Do not subtract loanMinor as if it were cashMinor. Future
scheduled loan amount stays loan currency until paid; outlook for another wallet
currency requires an explicitly chosen display scenario rate, otherwise unavailable
for that conversion. No manufactured one-for-one remaining obligation conversion.

TestsUSDloan10000 paidLBP8950000 → principal−10000USD,cash−8950000LBP,ordinary
expense0. Reverse restores both. Lend-collection sign test. Concurrent two full
repayments: one rejects overpayment; old same-currency repayment vs new command
shares loan lock. Wrong tenant/NULL/same currency/zero/15digit overflow reject.

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
