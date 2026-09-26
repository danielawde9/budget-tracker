# Phase 0 baseline: linking-fixes plan

**Baseline commit:** `e5c3f566acbd7098a67a5869cafb239806ced9cd` (`main` — "Merge feat/site-revamp: one page header per destination and quick add from the phone").
**Branch / worktree:** `fix/linking-phase-0`, `.worktrees/linking-phase-0`.
**Plan:** `docs/superpowers/plans/2026-09-25-linking-fixes-phase-0.md`, spec `docs/verification/2026-09-25-linking-audit.md`.

This is the baseline every later task in the plan compares against. Fast gates and
Playwright were recorded directly at the baseline commit `e5c3f56`. The DB suite
needed `.env.test` (a gitignored, per-checkout secret pointing at the dedicated
Budget dev Postgres), which this worktree didn't have; once it was restored, the
DB suite was run at `c5ef7c5` (HEAD at that time). `git diff --stat e5c3f56 HEAD --
supabase tests/db` is empty at the time of this commit — `supabase/` and
`tests/db/` are byte-identical between `e5c3f56` and the current branch tip, so
the DB failure list below is the correct baseline for `e5c3f56` too (Tasks 1, 2,
4, 9 and 10, which landed in between, touched only UI).

No product code was changed to produce this baseline.

## 1. Fast gates (run at `e5c3f56`)

Command: `pnpm typecheck && pnpm test:ui && pnpm test:worker && pnpm build && pnpm exec vitest run tests/ops`. Overall exit code 1 (see the two `tests/ops` findings below; every other gate passed).

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm test:ui` | PASS — Test Files 94 passed (94); Tests 1193 passed (1193) |
| `pnpm test:worker` | PASS — Test Files 7 passed (7); Tests 98 passed (98) |
| `pnpm build` | PASS — 2033 modules transformed. Vite warns one post-minification chunk is >500 kB (`dist/assets/index-*.js`, ~911 kB / ~243 kB gzip); informational, not a failure |
| `pnpm exec vitest run tests/ops` | FAIL — Test Files 2 failed \| 13 passed (15); Tests 1 failed \| 262 passed \| 9 skipped (272) |

### `tests/ops` findings (both pre-existing / environmental — not fixed here)

1. **`tests/ops/migration-manifest.test.ts` — "pins the month transitions release as 49 immutable migrations."** `supabase/migrations/` has 50 files (newest: `20260919100000_journal_search_page.sql`), but `ops/budget-migrations.sha256` still has only 49 entries and stops at `20260916100000_month_transitions.sql`. Pre-existing since `3318f00` ("feat(journal): search the full history with journal_search_page", 2026-09-20), which added the migration file without regenerating the manifest. Already anticipated by this plan: Task 3 adds `20260919100000` to the manifest as a "catch-up" entry (release count 49 → 51).
2. **`tests/ops/supabase-scratch-restore.test.ts` — suite-level failure, "Could not find a working container runtime strategy."** This file provisions a real Postgres via Testcontainers, which needs a reachable Docker daemon. Step 2's command runs `tests/ops` directly, without `scripts/ops/docker-ssh-bridge.sh`, and this dev machine has no local Docker (Docker is only reachable through the SSH bridge to the remote Ubuntu host). Environment fact, not a code defect.

## 2. DB baseline (run at `c5ef7c5`, after `.env.test` was restored)

Command: `set -a && . ./.env.test && set +a && pnpm test:db` (`BUDGET_TEST_DATABASE_URL` pointing at the dedicated Budget dev stack on `100.76.160.91:54422`, started via `scripts/remote-supabase.sh start`).

**Result:** Test Files 6 failed | 30 passed (36); Tests **29 failed** | 727 passed (756); Duration 983.41s; exit 1.

The previous recorded DB baseline (2026-09-16) was 26 failures (goal `TODAY` hardcoding + a household planner assertion). Of the 29 failures recorded here, 25 are in the goal test files (`goal-funding`, `goal-month-integration`, `goal-projections`) — consistent with the same hard-coded-"today" pattern, now covering more cases in those files. The remaining 4 look like a different, unrelated cause: one `household-membership` `EXPLAIN`-plan assertion ("uses the selective membership and invitation indexes after representative ANALYZE"); one `subcategories` migration-upgrade test that times out at the vitest test level, not the database ("preserves complete seeded state and command compatibility when upgrading 18 to 19 migrations", `Error: Test timed out in 30000ms`); and two tests that fail with a Postgres driver `Query read timeout` — a *different* `subcategories` test ("pins exact command signatures, fixed search paths, and effective execution grants") plus `wallet-lifecycle`'s migration upgrade ("preserves seeded data and existing commands when upgrading 32 to 33 migrations"). Recorded as observed; none of this was fixed.

### Failing tests (29, sorted)

```
tests/db/goal-funding.integration.test.ts > additional funding edge cases > allows a release out of a paused goal
tests/db/goal-funding.integration.test.ts > additional funding edge cases > allows a reversal to exceed a since-reduced target because it restores history rather than expressing new intent
tests/db/goal-funding.integration.test.ts > additional funding edge cases > does not require acknowledgement for an ordinary later cash drop below the earmark total
tests/db/goal-funding.integration.test.ts > additional funding edge cases > nets out correctly by today even when a reversal is dated before its original expense
tests/db/goal-funding.integration.test.ts > additional funding edge cases > rejects a release that exceeds the current earmark
tests/db/goal-funding.integration.test.ts > additional funding edge cases > rejects a reverse of an event that already has a reversal
tests/db/goal-funding.integration.test.ts > additional funding edge cases > rejects linking an old expense to funds that were reserved only afterward
tests/db/goal-funding.integration.test.ts > additional funding edge cases > retains earmarked history after a target reduction and blocks further reserves past the new ceiling
tests/db/goal-funding.integration.test.ts > funding scenarios (task 10 Task 5 numeric table) > cash70000; reserving 60000 then 30000 needs acknowledgement once the space total would exceed cash
tests/db/goal-funding.integration.test.ts > funding scenarios (task 10 Task 5 numeric table) > closing after full fulfillment then reversing the expense retains the closed definition but exposes the restored earmark
tests/db/goal-funding.integration.test.ts > funding scenarios (task 10 Task 5 numeric table) > linking 40000 twice against a 50000 expense rejects the second link with no partial state
tests/db/goal-funding.integration.test.ts > funding scenarios (task 10 Task 5 numeric table) > move5000 shifts source down and destination up leaving combined claims unchanged
tests/db/goal-funding.integration.test.ts > funding scenarios (task 10 Task 5 numeric table) > purchase reserve100000; link expense40000 leaves earmark60000 fulfilled40000 with no new cash rows
tests/db/goal-funding.integration.test.ts > funding scenarios (task 10 Task 5 numeric table) > releasing the same 60000 twice concurrently lets the first succeed and rejects the second as stale, never negative
tests/db/goal-funding.integration.test.ts > funding scenarios (task 10 Task 5 numeric table) > replays an identical request after the goal changed, returning the original result untouched
tests/db/goal-funding.integration.test.ts > funding scenarios (task 10 Task 5 numeric table) > reserve20000; release5000 leaves earmarked15000
tests/db/goal-funding.integration.test.ts > funding scenarios (task 10 Task 5 numeric table) > reversing the linked expense restores earmark100000 fulfilled0 as of the reversal date
tests/db/goal-month-integration.integration.test.ts > cash coverage across the space > covers 60000/10000 for two goals racing a 70000 pool, then 50000/0 once the pool drops
tests/db/goal-projections.integration.test.ts > goal_detail > computes a monthly target, net contribution, and needsReview flag
tests/db/goal-projections.integration.test.ts > goal_history_page > includes a financial reversal row for a reversed linked expense
tests/db/goal-projections.integration.test.ts > goal_history_page > paginates with the three-part cursor
tests/db/goal-projections.integration.test.ts > goal_page > filters by state and separates needs_review from a plain active/paused list
tests/db/goal-projections.integration.test.ts > private.goal_coverage_set > covers claims in priority order up to the cash pool, leaving the rest as shortage
tests/db/goal-projections.integration.test.ts > private.goal_coverage_set > drops covered amounts when the pool shrinks, without changing earmarked totals
tests/db/goal-projections.integration.test.ts > private.goal_coverage_set > excludes a fully-settled closed goal but includes a closed goal with a restored earmark
tests/db/household-membership.integration.test.ts > household member administration and bounded owner reads > uses the selective membership and invitation indexes after representative ANALYZE
tests/db/subcategories.integration.test.ts > subcategories database foundation > pins exact command signatures, fixed search paths, and effective execution grants
tests/db/subcategories.integration.test.ts > subcategories database foundation > preserves complete seeded state and command compatibility when upgrading 18 to 19 migrations
tests/db/wallet-lifecycle.integration.test.ts > wallet lifecycle database contract > preserves seeded data and existing commands when upgrading 32 to 33 migrations
```

## 3. Playwright (run at `e5c3f56`)

Command: `pnpm test:e2e`.

**Result: 155 passed, 51 skipped, 0 failed** (206/206 tests accounted for). Confirmed identically on two independent full runs, counted directly from the `list` reporter's per-test markers (`✓`/`-`/`✘`), because the run itself did not print its own closing summary line on either attempt — see the concern below.

**Concern (not a test failure):** on both runs, once all 206 tests had a result, the `pnpm test:e2e` process produced no further output and consumed ~0% CPU indefinitely instead of exiting — a reproducible post-completion hang. It required manual termination both times (`TaskStop` on attempt 1; `SIGTERM` on attempt 2, which recorded `STEP4_EXIT_CODE=143`). Ruled out: Tailscale/Docker (this suite touches neither), and the known "Chrome can't reach localhost" machine flakiness (`curl http://127.0.0.1:4173/` answered instantly throughout, and no new Chrome process had even been spawned during the hang). Recommend later tasks wrap `pnpm test:e2e` in an external `timeout` (actual test execution finishes in under 3 minutes both times) rather than trusting the process to exit on its own.

## Summary for later tasks

| Gate | Baseline result |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm test:ui` | PASS — 1193 tests |
| `pnpm test:worker` | PASS — 98 tests |
| `pnpm build` | PASS |
| `pnpm exec vitest run tests/ops` | 1 pre-existing failure (migration-manifest, since `3318f00`) + 1 environmental failure (supabase-scratch-restore needs the Docker bridge) |
| `pnpm test:db` | 29 failing tests (list above) — only *new* failures beyond this list count against a later task |
| `pnpm test:e2e` | 155 passed / 51 skipped / 0 failed — compare later Playwright runs against this count |
