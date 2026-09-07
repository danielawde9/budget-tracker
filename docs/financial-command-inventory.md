# Financial command inventory

## Implemented posting commands

All actual money and outstanding-principal changes below are written only by
the protected PostgreSQL commands. Browser and background API roles have read
access only; they do not receive direct financial-table write privileges.

| Command | Current entry path | Posted effects |
| --- | --- | --- |
| `public.record_financial_event` | Foundation integration client; future client RPC | Opening cash, income, expense, and transfer wallet movements. |
| `public.reverse_financial_event` | Foundation/Loans integration clients and `src/features/loans/supabase-loans-gateway.ts` | Linked inverse wallet and loan postings when valid. |
| `public.open_loan_outstanding` | Loans integration client and `src/features/loans/supabase-loans-gateway.ts` | Opening outstanding principal only; no wallet movement. |
| `public.record_cash_loan` | Loans integration client and `src/features/loans/supabase-loans-gateway.ts` | Lending/borrowing wallet movement and principal posting together. |
| `public.record_loan_repayment` | Loans integration client and `src/features/loans/supabase-loans-gateway.ts` | Repayment wallet movement and principal reduction together. |

`public.set_loan_monthly_target` is intentionally not a posting command: the
Loans gateway uses it to persist planning history only, and it cannot create
wallet or loan postings. The same gateway reads `public.loan_monthly_plan` and
`public.loan_monthly_currency_summary` as read-only projections.

The Loans UI remains the only implemented financial entry path and is now
mounted inside the authenticated application shell. Authentication, visible
space selection, and onboarding do not add a financial posting path;
onboarding calls only `public.create_space` and `public.create_wallet`. No
import, offline-sync, scheduled, or external integration entry path exists yet.
When one is introduced, it must call one of the protected commands or add a new
classified command here with a real-Postgres rejection and reconciliation test.
It must never write a wallet balance, loan balance, event, movement, posting, or
target history table directly.

## Deferred financial features

Refunds, exchanges, savings, assets, contributions, interest, fees,
installments, forgiveness, reminders, and cross-currency settlement are not
implemented by this milestone. They require their own event shapes, command
inventory row, database rejection coverage, and balance reconstruction proof
before they can post.
