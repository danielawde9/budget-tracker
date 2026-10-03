# Budget refinement verification — 2026-10-03

The requested refinement is committed on `codex/budget-refinement-release`. Release checks are aligned with the active Supabase project; the two goal migrations are pending application.

## Behavior verified

- Goal purchases select readable eligible expenses rather than requiring internal IDs. Expense discovery follows journal pagination, with currency filtering and loading, empty, error, and retry states.
- Pause, Resume, and Close use a focused confirmation. The lifecycle RPC preserves the existing goal definition and checks the expected revision. Closing a goal with reserved money requires freeing or moving that money first.
- Allocation hides synthetic Unmapped/Uncategorized rows while preserving the totals. Goal targets use the selected month and scan all identity/history pages. Publishing waits for targets to load; refreshed heads support subsequent edits and publishes.
- Available cash flags review when a positive goal target is missing from the published snapshot, including paused or closed goals. Snapshot-based calculations remain intact.
- Funding describes setting money aside, freeing it, or moving it to another goal. These actions change reservations, not wallet balances.
- Wallet transaction actions open the shared Record flow on desktop and mobile with wallet context.
- Goal, milestone, category, subcategory, category-pack, inline-category, and recurring names show the active language input. Existing hidden translations are preserved during edits.
- Default categories have distinct Lucide icons; custom categories retain a generic fallback. Category panels align, and loading layouts follow the final controls.
- Upcoming bills show the selected month once, with matching currency totals. Materialization retains its independent rolling forecast horizon.
- The space switcher disables the current space row and shows its selected state with consistent spacing.

## Verification evidence

Commands used Node 22 from `/opt/homebrew/opt/node@22/bin`.

| Check | Result | Evidence |
| --- | --- | --- |
| `pnpm test:ui` | 131 files, 1,591 tests passed | `/private/tmp/budget-final-ui.log` |
| `pnpm typecheck` | Passed, including worker type checks | `/private/tmp/budget-final-typecheck.log` |
| `pnpm build` | Passed | `/private/tmp/budget-final-build.log` |
| Goal-command and Available-cash DB integration suites | 2 files, 82 tests passed against the dedicated disposable Budget dev PostgreSQL server | `/private/tmp/budget-final-db.log` |
| Goals, categories, wallets, recurring Playwright suites | 62 passed, 28 scope-based skips | `/private/tmp/budget-final-browser-confirm.log` |
| Allocation/cash and selected goal/category browser checks | 29 applicable checks passed; two lifecycle selector failures subsequently corrected and rerun | `/private/tmp/budget-final-integration-browser.log` |
| Pause/Resume/Close browser rerun | 2 passed, desktop and mobile | `/private/tmp/budget-final-lifecycle-browser.log` |
| Impeccable detector, scoped to changed UI | No findings (`[]`) | `/private/tmp/budget-final-impeccable.json` |
| `git -c core.fsmonitor=false diff --check` | Passed | Final workspace check |

Browser checks include desktop, mobile, and Arabic RTL flows. Bounded screenshot inspection and confirmation were completed; saved confirmation images are under `/private/tmp/budget-refinement-visual-confirm/`.

An earlier UI run experienced long timing stalls. The affected suites passed separately, and the final full run passed all 1,591 tests in 48.58 seconds. Existing non-blocking output includes jsdom navigation warnings and Vite's bundle-size warning.

Both disposable PostgreSQL clusters were stopped after testing. Production data was not modified.

## 2026-10-03 release readiness audit

The active Supabase project is `dfuxxzlhmxscgvxdmwti` (`Budget Tracker`, `ap-northeast-2`). Its migration history now matches the release journal: 24 migrations are already applied, including the two household-delivery migrations from current `origin/main`; the two goal migrations below are the only pending entries. Read-only checks show that `set_goal_state` and the goal-target review update are not present yet.

The release migration runner checks the exact project, verifies a private pre-migration backup, dry-runs the two pending migrations, asks for an exact confirmation phrase, applies them, and checks the resulting schema. It has not been run because the operator still needs to enter the Supabase access token and database password in its secure prompts.

The frontend-only Cloudflare build and dry run pass. The live Worker has no secrets configured, so the release uses the static frontend path. Pushing to `main` triggers Cloudflare's automatic frontend deployment.

The database tests use a separate 65-file historical fixture so the existing upgrade tests remain intact while the production release journal contains only its current 26 files. The goal-command and Available-cash integration suites pass against the dedicated disposable Budget dev database.

## Deployment prerequisites

Apply these migrations through the normal production migration process before deploying the updated application:

1. `supabase/migrations/20261002170000_goal_state_only.sql`
2. `supabase/migrations/20261002171000_cash_goal_target_review.sql`

The first provides the lifecycle-only RPC. The second updates goal-target review handling for Available cash. These changes passed the goal-command and Available-cash integration suites against the dedicated disposable Budget dev database.

Unrelated existing changes in `.claude-flow/daemon-state.json`, `.claude-flow/logs/daemon.log`, and `supabase/.temp/cli-latest` were preserved and should be excluded from a refinement commit.
