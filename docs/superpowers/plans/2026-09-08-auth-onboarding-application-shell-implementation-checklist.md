# Authentication, Onboarding, and Application Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe Supabase email/password authentication, first-space/first-wallet onboarding, visible-space selection, and a bilingual application shell around the existing verified Loans workspace.

**Architecture:** Keep three explicit browser boundaries: `AuthGateway` wraps only Supabase Auth, `WorkspaceGateway` performs bounded RLS reads plus only `create_space` and `create_wallet`, and the existing `LoansGateway` retains its current protected-command allowlist. `App` owns configuration and session state; the authenticated workspace owns locale and selected-space state; Loans receives one selected space and clears its previous dashboard before loading another space.

**Tech Stack:** Node 22.22.0, pnpm 11.17.0, React 19, TypeScript strict, Vite, Supabase JS 2.116.0, Vitest, Testing Library, Playwright, semantic HTML, logical CSS properties.

---

## Scope guard

- [ ] Preserve `.swarm/` and unrelated work.
- [ ] Do not edit any file under `supabase/migrations/` or change financial tables, RLS, grants, or protected functions.
- [ ] Keep Loans mutations restricted to `open_loan_outstanding`, `record_cash_loan`, `record_loan_repayment`, `reverse_financial_event`, and `set_loan_monthly_target`; keep its projection reads restricted to `loan_monthly_plan` and `loan_monthly_currency_summary`.
- [ ] Permit onboarding mutations only through `create_space` and `create_wallet`; do not add membership or invitation mutations.
- [ ] Do not automatically retry either onboarding mutation after a transport failure.
- [ ] Do not push, deploy, provision hosted Supabase, or access Sandooq/production.

## File map

| File | Responsibility |
| --- | --- |
| `src/lib/supabase.ts` | Create one configured browser client without exposing configuration values. |
| `src/features/auth/types.ts` | Minimal user/session and auth-gateway contract that excludes tokens. |
| `src/features/auth/supabase-auth-gateway.ts` | Wrap `getSession`, auth events, email/password sign-in/sign-up, and sign-out. |
| `src/features/auth/use-auth-session.ts` | Initial loading, refresh, sign-in, sign-out, expiry, and stale-callback protection. |
| `src/features/auth/auth-screen.tsx` | Signed-out, failure, and confirmation-required states. |
| `src/features/workspace/types.ts` | Space/wallet onboarding inputs, results, and gateway contract. |
| `src/features/workspace/supabase-workspace-gateway.ts` | Bounded safe reads plus the two onboarding RPCs. |
| `src/features/workspace/use-workspace.ts` | Visible-space refresh, safe selection persistence, onboarding recovery, and user isolation. |
| `src/features/workspace/onboarding-dialog.tsx` | Full-screen accessible first-space and first-wallet workflow. |
| `src/features/shell/application-shell.tsx` | Product identity, navigation, language, account, space switcher, and sign-out. |
| `src/app.tsx` | Configuration/session state machine and service composition. |
| `src/features/loans/loans-page.tsx`, `src/features/loans/use-loans.ts` | Controlled Loans workspace that loads only the shell-selected space. |
| `src/i18n.ts`, `src/styles.css` | Complete EN/AR copy, RTL mirroring, responsive shell, auth, and onboarding styles. |
| `src/test/in-memory-app-services.ts` | Deterministic auth/workspace test services without credentials or tokens. |
| `e2e/fixtures/application.ts`, `e2e/application.visual.spec.ts` | Auth/onboarding/space fixtures and rendered state coverage. |

### Task 1: Configuration and authentication gateway

**Files:** `src/lib/supabase.ts`, `src/features/auth/types.ts`, `src/features/auth/supabase-auth-gateway.test.ts`, `src/features/auth/supabase-auth-gateway.ts`

- [ ] Write a failing gateway test proving session results expose only user ID/email, sign-in/sign-up forward only email/password, sign-out calls Supabase Auth, and auth subscriptions unsubscribe.
- [ ] Run `pnpm test:ui -- src/features/auth/supabase-auth-gateway.test.ts` and confirm failure because the gateway does not exist.
- [ ] Implement the minimal typed wrapper and never copy access tokens, refresh tokens, anon keys, or raw session objects into application state.
- [ ] Add a source ratchet asserting no auth UI or application logger prints password/token/key fields.
- [ ] Run the focused test, `pnpm typecheck`, and all UI tests.
- [ ] Append the auth-boundary decision to `docs/decisions.md` and commit `feat: add safe supabase authentication gateway`.

### Task 2: Authentication state machine and signed-out UI

**Files:** `src/features/auth/use-auth-session.test.tsx`, `src/features/auth/use-auth-session.ts`, `src/features/auth/auth-screen.test.tsx`, `src/features/auth/auth-screen.tsx`, `src/app.test.tsx`, `src/app.tsx`, `src/i18n.ts`, `src/styles.css`

- [ ] Write failing tests for configuration missing, initial loading without Loans content, existing session, sign-in failure, sign-up with a session, sign-up without a session, refresh, sign-out, expiry, and another user signing in after sign-out.
- [ ] Verify the focused tests fail for missing state-machine/UI behavior.
- [ ] Implement immediate auth subscription plus initial `getSession`, ignore stale completions after user/session changes, and treat a lost previously-authenticated session as expired.
- [ ] Implement visible email/password labels, browser autocomplete attributes, pending duplicate prevention, safe generic auth errors, confirmation-required guidance, locale switching, and a live status region.
- [ ] Run focused tests, all UI tests, typecheck, and build.
- [ ] Append the signed-out/expiry recovery decision and commit `feat: add bilingual authentication flows`.

### Task 3: Workspace gateway and mutation boundary ratchets

**Files:** `src/features/workspace/types.ts`, `src/features/workspace/supabase-workspace-gateway.test.ts`, `src/features/workspace/supabase-workspace-gateway.ts`, `src/features/loans/supabase-loans-gateway.test.ts`

- [ ] Write failing tests proving visible spaces and wallets use bounded `SELECT` reads; space creation calls only `create_space(p_name,p_kind)`; wallet creation calls only `create_wallet(p_space_id,p_name,p_currency)`.
- [ ] Add a repository source test rejecting `.insert`, `.update`, `.delete`, `.upsert`, or `.truncate` against protected tables and rejecting mutation RPCs outside the onboarding and existing Loans allowlists.
- [ ] Verify the tests fail because the workspace gateway is absent.
- [ ] Implement the gateway with a 500-row overflow guard and safe row validation.
- [ ] Run focused gateway tests, all UI tests, typecheck, and `rg -n '\.(insert|update|delete|upsert)\(' src` expecting no matches.
- [ ] Append the onboarding-command boundary decision and commit `feat: add protected onboarding gateway`.

### Task 4: Visible-space state and stale-data prevention

**Files:** `src/features/workspace/use-workspace.test.tsx`, `src/features/workspace/use-workspace.ts`, `src/features/loans/use-loans.test.tsx`, `src/features/loans/use-loans.ts`, `src/features/loans/loans-page.tsx`

- [ ] Write failing tests for no spaces, one space, multiple personal/household spaces, stored selection still visible, stored selection no longer visible, membership disappearing, network retry recovery, and sign-out/new-user isolation.
- [ ] Write a failing Loans test that switches space while the first request is unresolved and proves previous-space names and late responses never render.
- [ ] Verify the focused tests fail for missing controlled selection and stale-load protection.
- [ ] Implement per-user selected-space persistence, validate it against each fresh visible-space result, clear it when invalid, and clear Loans dashboard synchronously before every selected-space load.
- [ ] Use request sequence IDs and unmount guards so obsolete reads cannot restore previous-user or previous-space data.
- [ ] Run focused tests, every existing Loans test, typecheck, and build.
- [ ] Append the selection-isolation decision and commit `feat: isolate visible space selection`.

### Task 5: Safe onboarding workflow

**Files:** `src/features/workspace/onboarding-dialog.test.tsx`, `src/features/workspace/onboarding-dialog.tsx`, `src/features/workspace/use-workspace.test.tsx`, `src/features/workspace/use-workspace.ts`, `src/i18n.ts`, `src/styles.css`

- [ ] Write failing tests for personal/household choice, bounded name validation, first USD/LBP wallet choice, database rejections preserving safe form values, and the household-invitations unavailable message.
- [ ] Write failing ambiguous-failure tests proving `create_space` and `create_wallet` are each called once, visible spaces/wallets are refetched, a discovered result advances safely, and another submission is disabled until reconciliation finishes.
- [ ] Verify the tests fail because onboarding is absent.
- [ ] Implement a two-step full-screen dialog with focus containment, visible title/description, live errors/status, safe Escape only before a mutation becomes ambiguous, and focus restoration.
- [ ] Never auto-retry mutations; after a transport-shaped error, reconcile safe reads before enabling a deliberate retry and preserve entered names/currency.
- [ ] Run focused tests, all UI tests, typecheck, and build.
- [ ] Append the ambiguous-onboarding recovery decision and commit `feat: add safe first-space onboarding`.

### Task 6: Authenticated application shell and Loans integration

**Files:** `src/features/shell/application-shell.test.tsx`, `src/features/shell/application-shell.tsx`, `src/app.test.tsx`, `src/app.tsx`, `src/features/loans/loans-page.tsx`, `src/i18n.ts`, `src/styles.css`

- [ ] Write failing tests for product identity, active Loans navigation, non-interactive coming-later destinations, space name in `<bdi>`, personal/household label, language control, account menu, and sign-out.
- [ ] Write failing integration tests proving no-space users see onboarding instead of a Loans membership error and ready users see exactly one existing Loans workspace inside the shell.
- [ ] Verify focused tests fail because the authenticated shell is absent.
- [ ] Implement a manager-friendly rail/header shell with locale and selected space owned above Loans; keep future financial destinations visibly unavailable and non-interactive.
- [ ] On sign-out, remove all authenticated content immediately and key the authenticated tree by user ID so a different user receives fresh workspace state.
- [ ] Run focused tests, every existing Loans test, all UI tests, typecheck, and build.
- [ ] Append the shell/information-architecture decision and commit `feat: integrate loans application shell`.

### Task 7: Deterministic Playwright states and visual evidence

**Files:** `e2e/fixtures/application.ts`, `e2e/application.visual.spec.ts`, `e2e/loans.visual.spec.ts`, `playwright.config.ts`, `artifacts/application-shell/*.png`

- [ ] Add deterministic Auth REST fixtures for signed-out, failed sign-in then recovery, confirmation-required sign-up, first-time onboarding, and authenticated multi-space users.
- [ ] Write Playwright coverage for signed-out desktop, sign-in recovery, first-time onboarding, multi-space switching into Loans, mobile onboarding, Arabic RTL shell/Loans, expired session, membership disappearance, ambiguous creation recovery, and sign-out/different-user isolation.
- [ ] Assert focus containment/restoration, safe Escape behavior, live-region recovery, 44 px touch targets, no horizontal overflow at 390 px, and no credential/token text in screenshots or DOM output.
- [ ] Run the new suite before all routes are implemented and confirm the expected failing state.
- [ ] Complete fixtures, save deterministic evidence under `artifacts/application-shell/`, and inspect every image at original resolution for hierarchy, clipping, focus, RTL, and stale financial content.
- [ ] Fix each rendered defect test-first, then run `pnpm test:e2e`, `pnpm check:ui`, and the environment-loaded `pnpm check`.
- [ ] Commit `test: verify authenticated application flows`.

### Task 8: Final boundary audit and handoff

**Files:** `README.md`, `docs/decisions.md`, `docs/financial-command-inventory.md`

- [ ] Update README state/commands and explicitly list deferred invitations, general wallets/transactions, budgeting/reporting, live UAT, and launch work.
- [ ] Keep the financial command inventory unchanged unless an entry-path wording needs clarification; do not add onboarding RPCs as financial posting commands.
- [ ] Run `git diff --check`, migration diff inspection, forbidden protected-table write scans, Loans RPC allowlist scans, and auth secret/log scans.
- [ ] Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test:ui`, the environment-loaded `pnpm test:db`, `pnpm build`, and `pnpm test:e2e` and record exact counts.
- [ ] Inspect `git status --short` and `git log --oneline` for every milestone commit; confirm `.swarm/` remains unmodified and all financial migrations/permissions are unchanged.
- [ ] Commit documentation/evidence as `docs: record authenticated shell delivery`.

## Acceptance matrix

- [ ] Authentication loading, signed out, sign-in failure/recovery, confirmation-required sign-up, expiry, sign-out, and different-user sign-in are covered.
- [ ] No-space, personal/household creation, first USD/LBP wallet, mutation rejection, ambiguous recovery, and missing invitation commands are covered.
- [ ] One/multiple/disappearing spaces, per-user valid selection preservation, and stale-space data suppression are covered.
- [ ] Desktop/mobile, EN/AR RTL, keyboard focus, Escape, focus restoration, live regions, and adjacent recovery states have rendered evidence.
- [ ] Existing Loans command/database rejection behavior and every current Loans automated test remain green.
- [ ] No financial migration, financial permission, ledger function, direct protected-table write, push, deploy, hosted provisioning, production access, or Sandooq modification occurred.
