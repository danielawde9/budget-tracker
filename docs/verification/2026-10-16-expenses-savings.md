# Expenses/savings and opening balance verification

Implemented on `codex/home-expenses-savings` from `origin/main` ee44c45. No hosted schema, production data or deployment was changed.

- Complete UI suite: 35 files, 180 tests passed.
- Complete PostgreSQL suite: 17 files, 211 tests passed, using disposable Docker databases.
- TypeScript and production Vite build passed; git diff whitespace check passed.
- Independent review findings fixed: historical category moves, same-month group archives, archives after purpose changes across months, and obsolete Activity pagination. Regression tests reproduce each defect before the corresponding fix.
- Browser inspection used the actual screens and Shell with sample fixture API responses. Checked Home, Plan, Accounts, Activity, account/category opening previews, visible actions, EN/AR and 1280/390/320px. Final 320px Activity filter overflow is zero; row padding is 12px vertically and 16px horizontally. Account names retain a separate row above actions.
- Shared hover padding covers register buttons in Activity/statements, Plan item buttons, text actions, and record back actions. Padding is constant across normal/hover/focus states.
- Full authenticated local preview Playwright suite was not run: no disposable Auth/REST preview backend is configured in this worktree. Its selectors/helpers were updated for the redesigned Home and direct account actions, and pass typecheck. Browser checks and database tests are separate evidence, not authenticated end-to-end proof.
- The design detector ran once. Its inherited legacy CSS warnings were left outside this feature's scope.

## Release order

Apply `supabase/migrations/20261016091750_expenses_savings_opening.sql` with the normal reviewed migration process before publishing the frontend. It adds required plan purpose metadata and the account-opening RPC. It backfills established saving group names (including Insurance and Mazoot); subsequent behavior uses persisted settings. It preserves ledger entries and balances, with no reset or financial seed writes. The previous frontend remains compatible because missing-purpose plan saves retain the stored setting.

The ignored `.superpowers/ui-review/` directory is a local sample-data visual harness, not production application code or a live financial account. Local preview runs on port 5178.
