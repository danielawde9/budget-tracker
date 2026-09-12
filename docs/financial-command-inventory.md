# Financial command inventory

## Implemented posting commands

All actual money and outstanding-principal changes below are written only by
the protected PostgreSQL commands. Browser and background API roles have read
access only; they do not receive direct financial-table write privileges.

| Command | Current entry path | Posted effects |
| --- | --- | --- |
| `public.record_financial_event` | Foundation integration client and `src/features/wallets/supabase-wallets-gateway.ts` | Opening cash, income, expense, and transfer wallet movements. |
| `public.record_categorized_financial_event` | Categories integration client and `src/features/categories/supabase-categories-gateway.ts`, selected from the Wallets income/expense dialog only. | Income or expense wallet movements plus one immutable event-category association. |
| `public.reverse_financial_event` | Foundation/Loans integration clients, `src/features/loans/supabase-loans-gateway.ts`, and `src/features/wallets/supabase-wallets-gateway.ts` | Linked inverse wallet and loan postings when valid. |
| `public.open_loan_outstanding` | Loans integration client and `src/features/loans/supabase-loans-gateway.ts` | Opening outstanding principal only; no wallet movement. |
| `public.record_cash_loan` | Loans integration client and `src/features/loans/supabase-loans-gateway.ts` | Lending/borrowing wallet movement and principal posting together. |
| `public.record_loan_repayment` | Loans integration client and `src/features/loans/supabase-loans-gateway.ts` | Repayment wallet movement and principal reduction together. |

`public.set_loan_monthly_target` is intentionally not a posting command: the
Loans gateway uses it to persist planning history only, and it cannot create
wallet or loan postings. The same gateway reads `public.loan_monthly_plan` and
`public.loan_monthly_currency_summary` as read-only projections.

`public.describe_financial_event` is a protected descriptive-metadata command,
not a posting command. It creates or reuses an immutable, space-scoped payee
and attaches one immutable payee/note association to an already-posted event.
It cannot create or alter a financial event, movement, loan posting, balance,
or category association. The Wallets gateway invokes it only after the
protected posting command has returned the event identifier; its independent
request receipt makes a transport retry safe.

`public.create_category`, `public.create_subcategory`, and `public.archive_category`
are protected metadata lifecycle commands, not posting commands. The browser
entry path for all three lifecycle commands is
`src/features/categories/supabase-categories-gateway.ts`. The Categories
workspace invokes `create_subcategory` only for an active immutable root; the
command derives kind from that root and writes no financial row. It does not
change the implemented financial-writer list above.
`public.get_category_command_result` is a bounded read-only reconciliation
function reached through the same gateway. They cannot create a financial event,
wallet movement, loan posting, or balance effect.

`public.rename_wallet`, `public.archive_wallet`, and `public.restore_wallet` are
protected wallet lifecycle commands, not posting commands. They change only a
wallet's `name` or `archived_at` and append one row to
`public.wallet_command_requests`; `archive_wallet` refuses any non-zero derived
balance. `public.get_wallet_command_result` is their bounded read-only
reconciliation function. The `wallet_movements_require_active_wallet` trigger
refuses every money movement into an archived wallet, including reversals and
loan postings, so it narrows what the posting commands above can write without
adding a writer. No browser entry path calls the lifecycle commands yet.

The Loans and Wallets workspaces are the implemented financial entry paths in
the authenticated application shell; Categories manages metadata only. Wallets
can create wallets, post the four approved general event shapes, optionally
categorize income or expense, and reverse eligible general events only through
the commands listed above. Authentication, visible space selection, and
onboarding do not add a financial posting path; onboarding calls only
`public.create_space` and `public.create_wallet`. No import, offline-sync,
scheduled, or external integration entry path exists yet.
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
