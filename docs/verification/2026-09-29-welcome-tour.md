# Welcome tour for existing users (2026-09-29)

Design: `docs/superpowers/specs/2026-09-29-existing-user-welcome-tour-design.md`.
Plan: `docs/superpowers/plans/2026-09-29-existing-user-welcome-tour.md`.

## What shipped

- One-time 4-step welcome tour over the Control Room for users with spaces
  (flag `budget:welcome-seen:<userId>`; first-run completion writes it, so new
  users skip the tour).
- "Try it" deep links: record sheet (expense), Home (reports), Plan > Goals,
  Manage > Household via the one-shot `pendingSection` plumbing (eligibility-
  gated: Household only lands in a household space; consumed-once via
  `onPendingSectionConsumed`).
- Quick-add links (`/?add=expense`) take precedence for that app open.
- Manage > Preferences: "Replay welcome tour" re-opens it on demand, even
  after a quick-add deferral.

## Evidence

- `pnpm typecheck` — PASS (`pnpm check:worker-types && tsc --noEmit && tsc -p tsconfig.worker.json`: wrangler types up to date, no TS errors)
- `pnpm test:ui` — PASS: 124 test files, 1536 tests passed (124 files / 1536 tests, 0 failed; 47.34s)
- `pnpm build` — PASS (`tsc --noEmit && vite build`: 2067 modules transformed, `dist/` emitted, built successfully)
- `pnpm test:e2e` — PASS: 171 passed, 0 failed, 55 skipped (recorded from the Task 6 run; the e2e suite was not re-run for this task)
- Visual artifact: `artifacts/application-shell/welcome-tour-desktop.png`
