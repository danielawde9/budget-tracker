# Expense group money and opening balance safeguards

Scope: use group money for new expenses and prevent duplicated or unfunded opening assignments. The user explicitly withdrew the proposed release of Other essentials; this release makes no existing financial allocation changes. Short-term savings remains $900, unassigned remains -$1,433.50, and Other essentials remains $1,553.50.

## Behavior

- An implicit expense cover uses the expense category, then its effective-date group's flexible item, then unassigned money for any remainder. It uses the same currency and the minimum available balance from that date, preserving later recorded spending. Explicit category cover overrides remain available. Non-expense loan/investment outflows retain their rules. The default selector now represents group-first cover; it has no separate Ready-only UI option. Legacy callers may still explicitly supply the Ready UUID.
- The expense form explains group-first coverage and warns for the residual shortfall only. The displayed group amount is an upper-bound estimate from current balances; the copy explicitly says earlier dates are checked when saving.
- Opening forms ask for the resulting total. Only the positive difference is recorded. Equal totals are no-ops, lower totals are blocked with correction guidance, and confirmation distinguishes existing account money from truly missing assets.
- Category openings retain the unassigned affordability check, including when unassigned is negative. A deferred insert-only database trigger also enforces affordability for opening assignments written through maintenance helpers; existing rows are untouched and real expenses remain recordable. Expected balances are checked under the space lock after receipt replay; stale forms have a reload action. Account openings use a checked RPC with the same replay order and signed loan balance handling. Existing clients retain the original RPC.

## Evidence

- Regression tests demonstrated the failures before implementation.
- Full UI suite: 197 tests passed. Full PostgreSQL suite: 227 tests passed. TypeScript, production build and guarded Cloudflare dry run passed; final deployment is recorded with the private release evidence.
- Independent review found no substantive accounting or security defects. The Ready-only UI distinction and bounded historical preview are documented above.
- Browser inspection uses the real screens and forms with sample fixtures. Expense coverage, category totals and account deltas checked at 1280, 390 and 320px, including Arabic account totals; no horizontal overflow. Temporary browser viewport overrides were reset. The preview-only harness needed a missing suggestions stub; no corresponding production API defect exists.
- A private backup captured 18 tables / 414 rows / 71 financial entries and the pre-release functions/grants. A disposable loopback database restored every row exactly and rehearsed the migration with all financial ledger hashes unchanged.
- Production migration guards compare those same hashes before and after schema changes. Separate read-only authenticated reads validate spaces, Plan, Home, Accounts and expense/savings Activity using application schemas; explicit checks preserve $900, -$1,433.50 and $1,553.50.
- Production password sign-in and authenticated browser financial writes were not exercised. Database-backed tests, fixture-based browser checks and authenticated read-only production queries are separate evidence.
