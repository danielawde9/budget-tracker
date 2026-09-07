# Loans and whole-app ledger coverage

## Status and scope

Approved product direction on 2026-09-07. Implementation is deferred to later
milestones, as requested by Daniel. This document records the Loans feature
and the financial boundary every app feature must follow. It does not expand
the current database-foundation implementation task.

The repository currently contains wallet-journal commands for opening balances,
income, expenses, transfers, and reversals. Loans, monthly repayment planning,
and whole-app coverage are requirements below, not implemented or verified
capabilities. This source review did not rerun database tests.

## One financial control point

Every operation that changes actual money or an outstanding financial obligation
must pass through protected database posting commands and the shared immutable
financial journal. This applies to every future entry path: screens, imports,
offline synchronization, scheduled work, and integrations.

This is one enforced boundary with narrowly scoped commands, not a requirement
to place every feature in one large function. No feature may directly set a
wallet balance, loan balance, or independent authoritative financial total.
Balances and report actuals must be derived from posted journal entries.

The boundary applies to income, expenses, transfers, opening balances,
corrections, refunds, exchanges, savings movements, asset-related financial
events, contributions, both loan directions, and their related features when
implemented. Each feature must define its event shapes before it can post.
Events that only change an obligation or valuation must explicitly allow no
wallet movement; they must not invent a cash movement to fit the current API.

Plans, targets, due dates, reminders, and drafts describe intent. They do not
change posted wallet or loan balances. Reports must distinguish planned amounts
from actual amounts. Changes to loan terms and planning settings retain an
attributed history without pretending cash moved.

## Loans feature

Provide a Loans section with two explicit directions:

- **They owe me:** money lent to another person.
- **I owe them:** money borrowed from another person.

Each loan belongs to one private or household space and records the direction,
person, original principal, currency, effective date, optional due date, and
optional note. New cash loans also identify the source or destination wallet.
Amounts use the existing exact minor-unit convention. The other person does
not need an app account and gains no access to the space by being named.

Show remaining principal, total repaid, full transaction history, and whether
the loan is outstanding, settled, or overdue. Support partial and full
repayments, including repayments before or after the due date. Settlement is
derived from the remaining balance; a status toggle cannot erase a debt.

Keep separate loans distinct even when they involve the same person. Totals
may be grouped by person and currency. Do not silently offset money owed in
opposite directions or add different currencies together.

## Posting behavior

Wallet and loan changes from the same action must post atomically under one
linked financial event. A failure writes neither side.

| Action | Wallet effect | Outstanding principal effect |
| --- | --- | --- |
| Lend money | Decrease the selected wallet | Increase what they owe me |
| Receive repayment | Increase the selected wallet | Decrease what they owe me |
| Borrow money | Increase the selected wallet | Increase what I owe them |
| Repay borrowing | Decrease the selected wallet | Decrease what I owe them |
| Record an existing loan at setup | No new wallet movement | Establish the outstanding opening obligation |
| Reverse an erroneous posting | Reverse the original wallet effect, if any | Reverse the linked principal effect |

Loan principal is tracked separately from earned income and ordinary spending.
For example, receiving borrowed money is a borrowing inflow; buying groceries
with it is a separate expense. Receiving principal back is repayment rather
than salary. Cash-flow views still include the actual loan inflows and outflows
with their correct labels.

For an existing loan at setup, record the principal still outstanding at the
cutover date. Historical repayments before that date are outside app history;
do not fabricate them or move cash again. Show the opening amount as an opening
outstanding balance rather than claiming it is the original lifetime loan.

The initial loan milestone uses the loan currency for all its repayments and
requires wallets in the same space and currency. Cross-currency settlement is
deferred until the exchange model defines explicit linked amounts and rates.

## Monthly plan

Allow an optional monthly repayment target for each loan I owe. Reserve the
target in the plan's available-to-allocate calculation, capped by outstanding
principal. Recording the target does not debit a wallet or reduce the loan.

Show this month's target, repayments actually posted this month, and remaining
planned repayment. Actual payments count once toward the target; the unpaid
reservation is reduced accordingly so the plan does not double-count payments.
The remaining planned amount cannot fall below zero. Extra repayments are
allowed up to outstanding principal. Default to no automatic carry-forward of
missed targets; show the shortfall in the relevant month's history.

Summarize **owed to me**, **I owe**, **due this month**, and **planned repayment
this month**, separately per currency. With no installment schedule, a loan's
optional due date applies to its outstanding principal. Keep due amounts and
voluntary monthly targets visibly distinct.

Expected repayments from others may appear as expected incoming cash, but do
not increase spendable funds until received and posted.

## Enforcement and history

Each posting command must validate the authenticated actor, active membership,
same-space references, currency, bounded payload, positive principal input,
and its event-specific movement shape. Enforce shared invariants in database
constraints and privileges as well as command validation.

Use request IDs and payload fingerprints so identical retries have one effect
and changed-payload retries are rejected. Serialize competing repayments of the
same loan so concurrent requests cannot repay more than the remaining amount.
Reject a repayment that would make outstanding principal negative.

Preserve posted history with linked reversals and replacement events. Apply
corrections to wallet and loan effects together. Reject a reversal that would
invalidate subsequent repayments until the dependent postings are corrected.
Record the actor, server-generated UTC timestamp, effective date, and links
needed to reconstruct each posted balance. Operational logs must not contain
financial notes, tokens, or full personal records.

Application and background roles must have no direct financial-table write
path. Add database guards against posted-history UPDATE, DELETE, and TRUNCATE,
with tests proving they still reject writes if a table privilege is accidentally
granted. Administrative migration and recovery access is a separate operational
boundary, never an application feature path.

## Delivery order and acceptance

1. Complete and prove the wallet-journal foundation and its required rejection
   tests before relying on it for additional financial features.
2. Design and implement loan records, linked obligation journal effects, and
   protected commands for both directions, openings, repayments, and corrections.
3. Build the Loans screens and monthly-plan integration on those commands and
   projections. Verify the rendered creation, partial-repayment, settlement,
   overdue, error-recovery, and private/household flows.
4. Maintain an explicit inventory of every money-changing command and caller
   as app features are introduced. Add a coverage gate that rejects unclassified
   financial commands and direct application writes outside the posting boundary.

Real-Postgres tests must prove both directions' wallet and principal effects,
partial/full repayments, setup without duplicate cash, overpayment rejection,
concurrent repayment safety, atomic rollback, identical and conflicting retries,
space isolation, wrong-currency rejection, immutable history, and corrections
with dependent repayments. Rebuilding projections from journal history must
reproduce wallet balances and outstanding principal.

Plan and report tests must prove targets never post money, actual repayments
are counted once, expected collections are unavailable until posted, and loan
principal remains separate from income and ordinary spending. For every new
financial feature, test its failure paths and reconciliation before claiming
whole-app coverage.

## Deferred extensions

Interest, fees, reminders, installment schedules, forgiveness/write-offs, and
cross-currency settlement require later designs. Their financial effects remain
subject to the same journal boundary. No due date, reminder, or status change
may silently introduce a charge, payment, or forgiveness event.
