# Financial command inventory

## Implemented posting commands

All actual money and outstanding-principal changes below are written only by
the protected PostgreSQL commands. The browser role has read access only; it
does not receive direct table-write privileges.

| Command | Current entry path | Posted effects |
| --- | --- | --- |
| `public.record_financial_event` | Foundation integration client; future client RPC | Opening cash, income, expense, and transfer wallet movements. |
| `public.reverse_financial_event` | Foundation and Loans integration client; future client RPC | Linked inverse wallet and loan postings when valid. |
| `public.open_loan_outstanding` | Loans integration client; future client RPC | Opening outstanding principal only; no wallet movement. |
| `public.record_cash_loan` | Loans integration client; future client RPC | Lending/borrowing wallet movement and principal posting together. |
| `public.record_loan_repayment` | Loans integration client; future client RPC | Repayment wallet movement and principal reduction together. |

`public.set_loan_monthly_target` is intentionally not a posting command: it
persists planning history only and cannot create wallet or loan postings.
`public.loan_monthly_plan` and `public.loan_monthly_currency_summary` are
read-only projections.

No UI, import, offline-sync, scheduled, or integration entry path exists yet.
When any such path is introduced, it must call one of the protected commands
or add a new classified command here with a real-Postgres rejection and
reconciliation test. It must never write a wallet balance, loan balance, event,
movement, posting, or target history table directly.

## Deferred financial features

Refunds, exchanges, savings, assets, contributions, interest, fees,
installments, forgiveness, reminders, and cross-currency settlement are not
implemented by this milestone. They require their own event shapes, command
inventory row, database rejection coverage, and balance reconstruction proof
before they can post.
