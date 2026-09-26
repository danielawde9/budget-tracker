# Phase 0 linking fixes: source verification and handoff

**Date:** 2026-09-26. **Base:** `e5c3f56` (`main`). **Branch:** `fix/linking-phase-0`.
**Implementation head:** `a21e34e`. **Plan:** `docs/superpowers/plans/2026-09-25-linking-fixes-phase-0.md`.

## Delivered in the branch

The 13 implementation tasks cover exact goal amounts, reversal dates, repeat allocation publishing, the Available occurrence window, Plan category totals and paging, bill and salary settlement, overdue bills, and goal top-ups after linked purchases. The whole-branch review then found five Important and eight Minor issues. Nine follow-up commits (`b63ae07` through `3ccc57d`) addressed the review findings; `a21e34e` addressed the two new Minor regressions N1 and N2 found on re-review. The finding-by-finding SHA map is in `2026-09-25-linking-audit.md`.

The focused N1/N2 re-check at `a21e34e` found that the cached occurrence row is used only while the recurring list is loading; a genuinely absent row still shows the missing-row alert once loading ends. A retried Skip uses the pending command's own action, so a refused unrelated Save cannot relabel it as a payment. The focused tests passed **19/19** in this session.

## Verification on `a21e34e`

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | PASS — worker types current; both TypeScript projects clean. |
| `pnpm test:ui` | PASS — 104 files, 1,309 tests. |
| `pnpm test:worker` | PASS — 7 files, 98 tests. |
| `pnpm build` | PASS — 2,040 modules; existing bundle-size advisory remains. |
| `pnpm exec vitest run tests/ops --exclude tests/ops/supabase-scratch-restore.test.ts` | PASS — 14 files, 246 tests. |
| Container-backed `supabase-scratch-restore.test.ts`, through `docker-ssh-bridge.sh` | PASS — 27 tests. |
| `pnpm test:db` with `.env.test` | RED — 35 files passed, 6 failed; 746 tests passed, 28 failed. One new name versus the 29-name baseline was a 30-second household migration timeout while Playwright also ran. |
| Isolated `household-migrations.integration.test.ts` with `.env.test` | PASS — 4/4 tests in 31.32 seconds, after Playwright finished. |
| `pnpm test:e2e` | PASS — 159 passed, 51 skipped, 0 failed (210 cases); exit code 0. The runner paused before the last seven cases, then resumed and exited cleanly. |

The baseline DB run was taken at `c5ef7c5`, whose DB source was byte-identical to the `e5c3f56` fork point. It had **29 named failures**; `2026-09-25-phase-0-baseline.md` records each one. A later whole-branch run at `538be01` had **26 failures and zero new failure names**. This session's full run had **28 failures**: 27 names from the baseline and one new timeout in `household-migrations.integration.test.ts > household migration journal > backfills memberships and preserves seeded financial data`. Two baseline timeout failures (`subcategories` signature check and `wallet-lifecycle` upgrade) passed. The new household test did not reproduce in one isolated rerun; the full-suite result remains red and the timeout remains a test stability risk. The baseline goal tests still hard-code `2026-09-14` while commands use current UTC time.

A serial full-suite rerun was attempted without Playwright. After 21 minutes, `month-copy` and `allocation-projections` were skipped during setup. A separate read-only Postgres connection probe timed out after five seconds; the test host's TCP port opened, but SSH took about 11 seconds to respond. The rerun was interrupted at that point (exit 130) to avoid treating more host delays as source failures. It has no final failure count and does not replace the completed run above.

## Real dev stack and browser check

The prior Task 14 run synced the 55 source migrations to the self-hosted **development** stack and applied its 17 pending migrations with the explicit `--local` flag. Its read-only `LIVE_VERIFY_SQL` check returned `budget_schema_ready` at version `20260925104000`. In this session, `supabase migration list --local` on that host showed **55 matching file/database versions, zero mismatches**, latest `20260925104000`. That is a dev rehearsal, not a production migration.

Browser flow result: **not run in this session** because no dev account is signed in. The preview runs this branch at `http://127.0.0.1:5175/` with the dev API explicitly selected; its page and the dev auth health endpoint both returned HTTP 200. Account creation and password entry are left to the user. The planned click-through still covers exact LBP goal editing, old-date Undo, publishing a second month, and overdue bill payment and notice.

## Release boundary

The branch includes five new forward-only migrations:

- `20260925100000_reversal_date_guard.sql`
- `20260925101000_allocation_template_head.sql`
- `20260925102000_monthly_budget_category_page_v3.sql`
- `20260925103000_scheduled_overdue_page.sql`
- `20260925104000_goal_earmark_check_uses_financing_state.sql`

The release manifest also catches up the pre-existing `20260919100000_journal_search_page.sql` migration. Before applying to live, check for existing early reversals:

```sql
select count(*)
from financial_events r
join financial_events o on o.id = r.reversal_of
where r.effective_date < o.effective_date;
```

The decided order in `docs/decisions.md` is: merge this branch into local `main`, run the guarded live migration from that local source, confirm `budget_schema_ready`, then push. No production migration, push, deploy, or remote publication was performed as part of phase 0 verification.

## Remaining product work outside phase 0

The audit still lists the one-space-clock/payday-period design, goal monthly targets in Plan, month copy/close/rollover UI, onboarding recovery, and a transaction picker for manual bill and goal links. D3 still needs partial, overpayment and cross-currency settlement design; D7 still needs an automatic retry/unlink path. Those are not hidden by the phase 0 status labels.

## Post-merge integration — 2026-09-26

The local `main` merge is `f8dbb64` (parents `666dba5` and `df74718`). It has not been pushed. Existing modified RuFlo files and the untracked `artifacts/desktop-concepts-v2/` folder were preserved. This addendum supersedes only the earlier branch-handoff statement that the merge had not happened.

From merged `main`, `pnpm typecheck` passed, `pnpm test:ui` passed 1,309/1,309, `pnpm test:worker` passed 294/294, and `pnpm build` passed with the existing chunk-size advisory. The ops suite passed 246/246 across 14 files after `vitest.config.ts` excluded nested `.worktrees` from test discovery. A first, unscoped ops attempt was interrupted after a Docker SSH bridge timeout; it had also collected tests from an older nested worktree whose release pins expected 49 rather than 55 migrations. The two `main` migration gate files passed 33/33 after correcting discovery. This does not replace the full DB result above.

The authenticated development preview at `http://127.0.0.1:5175/` was checked in the browser. It is served from the phase-0 worktree, whose implementation head is a parent of the merge. Home, Journal, Plan, Allocation, Goals, Available cash, Upcoming bills, Wallets and Loans loaded. New schedule, goal and loan forms opened and closed; blank loan submission focused its required Person field. No financial records were created. This account has no goals, schedules or transactions, so the populated linking, settlement, reversal and retry paths were not exercised manually. The 159 passing Playwright cases above remain the automated flow evidence.

The remaining release sequence is the read-only early-reversal count query, the owner's guarded live migration, `budget_schema_ready` verification, then a push that triggers frontend deployment. None of those production steps occurred here.
