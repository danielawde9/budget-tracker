# w4b month copy / close / rollover — source verification

**Date:** 2026-09-28. **Base:** `8a47e00` (`main`). **Branch:** `ws/w4b-month-transitions`.
**Audit:** `docs/verification/2026-09-25-linking-audit.md` §4 ("UI for month copy, close and rollover policy"), A10/B7.
**Contracts:** `docs/superpowers/plans/future-planning/20-month-copy-rollover-db.md`, `21-month-transitions-gateway.md`, `22-month-transitions-ui.md`.

## Delivered

The DB commands already existed and are live on hosted Supabase
(`close_budget_month`, `copy_allocation_month`, `set_rollover_policy`,
`allocation_month_state`; migration `20260916100000_month_transitions.sql`).
`src/` had no caller. This branch adds the missing gateway + hook + UI:

- `src/features/allocation/supabase-allocation-gateway.ts`, `types.ts`, `use-allocation.ts`
  — typed methods and the accepted/ambiguous/retry coordination for preview/copy,
  preview/close and rollover policy, with explicit request ids/receipts.
- `src/features/allocation/month-transitions.tsx`, `month-copy-dialog.tsx`,
  `month-close-dialog.tsx`, `rollover-policy-editor.tsx`, `month-history.tsx`,
  `month-transitions.css`, `errors.ts`, `month-transitions-errors.test.ts`,
  `month-transitions-gateway.test.ts`, `month-transitions-hook.test.tsx`,
  `month-transitions.test.tsx`, and the dialog tests.
- `src/features/control-room/routes.tsx` / `routes.test.tsx` wiring.
- `src/test/in-memory-allocation-gateway.ts` fixtures.

**No migration is required.** The commands, signatures and payloads already exist;
the work is gateway/hook/UI only. Nothing new is posted twice: every mutation
reconciles by request id and refuses on a stale preview hash.

## Gate results (actual)

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck | `pnpm exec tsc --noEmit` | PASS |
| UI gate | `pnpm check:ui` | **PASS** — 118 files, **1468 tests passed**; build clean |
| Focused | `pnpm exec vitest run --config vitest.ui.config.ts src/features/allocation src/features/control-room` | PASS — 26 files, 367 tests |

## Known gap (deliberate)

`e2e/month-transitions.visual.spec.ts` was **not delivered**: the sub-agent hit its
turn limit while writing it, leaving an unfinished spec (debug `console.log`s, a
`waitForTimeout`, a copy-success assertion that never resolved, and a carry
`check()` that did not flip). It was removed rather than committed failing or
weakened. The dialogs themselves are unit-tested (including the carry toggle and
the "Copied" status), so the UI behaviour is covered at the component level; the
browser-level coverage is tracked as follow-up task **W4b-e2e**.

## Remaining limitations

- No desktop/mobile Playwright coverage for the new controls yet (see W4b-e2e).
- `pnpm test:db` was not re-run here (this change adds no SQL); the existing
  month-transition DB integration tests in `tests/db` remain the SQL net.
