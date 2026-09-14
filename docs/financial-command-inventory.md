# Financial command inventory

## Implemented posting commands

All actual money and outstanding-principal changes below are written only by
the protected PostgreSQL commands. Browser and background API roles have read
access only; they do not receive direct financial-table write privileges.

| Command | Current entry path | Posted effects |
| --- | --- | --- |
| `public.record_financial_event` | Foundation integration client and `src/features/wallets/supabase-wallets-gateway.ts` | Opening cash, income, expense, and transfer wallet movements. |
| `public.record_usd_to_lbp_exchange` | Foundation integration client; no application UI entry path yet. | One immutable `exchange` event with linked negative USD and positive LBP wallet movements; neither leg is income or expense. |
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

`public.set_monthly_income_plan` and `public.set_monthly_category_target` are
also non-posting planning commands. They append immutable monthly plan revisions
only; `public.monthly_budget_currency_summary` reads their per-currency planned
income, category allocation, loan commitment, and left-to-allocate result.
`private.set_monthly_budget_plan` now takes the shared `public.spaces` row
lock via `private.lock_planning_actor` before its own advisory locks; it
posts no financial row and its return shape/fingerprint are unchanged.

`public.find_planning_command` is a protected, read-only idempotency lookup
introduced as shared foundation for later planning commands
(`docs/superpowers/plans/future-planning/03-planning-foundation-db.md`). It
returns only the calling actor's own receipt from `public.planning_command_receipts`
(never another actor's) and creates or alters no financial row.

`public.save_allocation_template` and `public.publish_allocation_month` are
non-posting planning commands that write through `public.planning_command_receipts`
(the first real callers of task 03's receipt/replay foundation). Neither posts
a financial event, movement, or loan row. `save_allocation_template` upserts
`public.allocation_groups` and appends immutable
`allocation_template_revisions`/`_lines`/`_roots` rows. `publish_allocation_month`
computes apportionment via `private.allocate_planning_income`, then calls the
existing `public.set_monthly_income_plan` and `public.set_monthly_category_target`
(under request IDs it derives deterministically via task 03's
`private.planning_child_request`, never inventing new financial-adjacent
writers) before appending an immutable `allocation_month_snapshots` row and
its group/root/loan-commitment lines. No application UI entry path calls
either command yet (checked against `src/` before writing this sentence, per
the 2026-09-14 correction above).

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

`public.report_monthly_cash_summary`, `public.report_wallet_activity`,
`public.report_category_actual_vs_budget`, and
`public.monthly_budget_category_page_v2` are read-only reporting projections,
not posting commands. They read the existing journal, wallet movements, and
monthly plan revisions and cannot create or alter a financial event, movement,
loan posting, balance, or category association.

**Correction (2026-09-14):** the sentence "no application UI entry path calls
them yet" that stood here at task 02's initial commit was wrong — it was not
checked against `src/` before being written. `src/features/control-room/routes.tsx`'s
Home destination already calls `gateways.reports.loadMonthlyComparison`
(`report_monthly_cash_summary`) and `insightsClient.categoryActualVsBudget`
(`report_category_actual_vs_budget`) on every load via
`src/features/reports/supabase-reports-gateway.ts` and
`src/features/insights/insights-client.ts`. Because task 02's fix migration
(`20260914090000_planning_projection_contracts.sql`) was never deployed to
the live Supabase project, production kept calling the pre-fix, unusable
versions of both functions and the Home page showed "Could not load the
latest data." (the category call degrades silently to an empty budget list
via a `.catch`; the monthly-comparison call does not, hence the visible
error banner). See `docs/decisions.md` (2026-09-14, "Deployed reporting
foundation fix to production").

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

Refunds, savings, assets, contributions, interest, fees, installments,
forgiveness, reminders, and cross-currency settlement other than the protected
USD-to-LBP exchange command are not implemented by this milestone. They require
their own event shapes, command inventory row, database rejection coverage, and
balance reconstruction proof before they can post.
