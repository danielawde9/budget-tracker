# Loans UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a manager-friendly, bilingual Loans SPA that reads the verified ledger and changes financial state only through the seven approved loan commands.

**Architecture:** Build a Vite/React single-page application around a narrow `LoansGateway`. The Supabase implementation may select RLS-protected spaces, wallets, loans, balances, postings, and financial events, but every mutation must call one of the approved RPCs; components consume composed view models and never calculate or mutate authoritative balances. Component tests use an in-memory gateway, while gateway contract tests prove RPC names and payloads and Playwright verifies real responsive layouts with deterministic mocked HTTP responses.

**Tech Stack:** Node 22.22.0, pnpm 11.17.0, React, TypeScript strict, Vite, Supabase JS, Vitest, Testing Library, Playwright, semantic HTML, logical CSS properties.

---

## Scope guard

- [ ] Keep `.swarm/` and all unrelated files unchanged.
- [ ] Do not change SQL migrations, financial privileges, RLS, or database lifecycle commands.
- [ ] Allow financial mutations only through `open_loan_outstanding`, `record_cash_loan`, `record_loan_repayment`, `reverse_financial_event`, and `set_loan_monthly_target`.
- [ ] Read monthly figures only through `loan_monthly_plan` and `loan_monthly_currency_summary`; read immutable detail rows from existing RLS-protected tables/views.
- [ ] Do not expose interest, fees, reminders, installments, forgiveness, imports, sync, or cross-currency settlement.
- [ ] Do not show editable balances or combine currencies.

## File map

- `index.html`, `src/main.tsx`, `src/app.tsx`: Vite entry point and authenticated-session shell.
- `src/i18n.tsx`: typed English/Arabic copy, locale state, document `lang`/`dir` synchronization.
- `src/styles.css`: compact ledger-inspired design tokens, responsive layout, full-screen complex overlays, focus and reduced-motion behavior.
- `src/features/loans/types.ts`: exact domain, view-model, gateway, form, and command result types.
- `src/features/loans/money.ts`: safe minor-unit parsing and locale-aware currency formatting.
- `src/features/loans/errors.ts`: database/client error classification and recovery copy keys.
- `src/features/loans/supabase-loans-gateway.ts`: the only browser data adapter; RLS reads plus the seven approved RPCs.
- `src/features/loans/use-loans.ts`: bounded load/submit state, request-ID lifecycle, refresh, and retry behavior.
- `src/features/loans/loans-page.tsx`: page composition, space/month/direction controls, empty/loading/error states.
- `src/features/loans/loan-summary.tsx`: one row per currency with owed, owing, due, target, paid, and reserved values kept separate.
- `src/features/loans/loan-list.tsx`: direction groups, state chips, due amounts, monthly planning line, and detail entry.
- `src/features/loans/loan-dialogs.tsx`: large/full-screen create, repayment, target, correction, and history overlays.
- `src/test/in-memory-loans-gateway.ts`: deterministic test adapter only, never selected by production entry code.
- `src/**/*.test.ts(x)`: unit, gateway contract, and component flow tests.
- `e2e/loans.visual.spec.ts`, `playwright.config.ts`: desktop/mobile EN/AR and error/recovery visual checks and screenshots.

### Task 1: Application test harness and shell

**Files:** `package.json`, `pnpm-lock.yaml`, `vitest.config.ts`, `tsconfig.json`, `index.html`, `src/test/setup.ts`, `src/app.test.tsx`, `src/app.tsx`, `src/main.tsx`

- [ ] Add exact runtime and development dependencies with `--save-exact`; retain the existing database scripts and add `dev`, `build`, `test:ui`, `test:ui:watch`, `test:e2e`, and `check:ui`.
- [ ] Configure jsdom only for `src/**/*.test.ts(x)` so `tests/db` remains on Node and the current database gate is unchanged.
- [ ] Write a failing shell test asserting a Loans heading, locale control, and accessible main landmark.
- [ ] Run `pnpm test:ui src/app.test.tsx` and confirm failure because the shell is absent.
- [ ] Implement the minimal semantic shell and run the focused test to green.
- [ ] Run `pnpm typecheck`, `pnpm test:ui`, and the environment-loaded `pnpm test:db`.
- [ ] Commit as `chore: establish loans ui application shell`.

### Task 2: Money, status, and error domain

**Files:** `src/features/loans/types.ts`, `src/features/loans/money.test.ts`, `src/features/loans/money.ts`, `src/features/loans/errors.test.ts`, `src/features/loans/errors.ts`

- [ ] Write failing tests for exact decimal-to-minor conversion in USD and LBP, rejecting zero, negative, excessive precision, non-numeric input, and values above the database's 15-digit minor-unit bound.
- [ ] Run the focused money test and confirm failures because conversion is absent.
- [ ] Implement string-only conversion without floating-point multiplication and locale-aware display formatting.
- [ ] Write failing status tests for `settled` at zero, `overdue` only when outstanding after a past due date, and `outstanding` otherwise.
- [ ] Implement the pure status derivation and keep authoritative outstanding values sourced from `loan_balances`.
- [ ] Write failing error-mapping tests for wrong currency, overpayment, changed-payload retry collision, inactive membership, dependent-repayment correction rejection, and an unknown database rejection that preserves a safe server message.
- [ ] Implement explicit error-code/message classification with next-step recovery instructions and no automatic changed-payload retry.
- [ ] Run focused tests, all UI tests, and typecheck.
- [ ] Commit as `feat: define loans ui domain rules`.

### Task 3: Command-only Supabase gateway

**Files:** `src/lib/supabase.ts`, `src/features/loans/supabase-loans-gateway.test.ts`, `src/features/loans/supabase-loans-gateway.ts`

- [ ] Define a `LoansGateway` with bounded methods: `listSpaces`, `loadDashboard`, `loadLoanHistory`, `createLoan`, `recordRepayment`, `setMonthlyTarget`, and `reverseEvent`.
- [ ] Write failing adapter tests with a recording Supabase client that assert creation routes to `open_loan_outstanding` or `record_cash_loan`, repayment to `record_loan_repayment`, target changes to `set_loan_monthly_target`, correction to `reverse_financial_event`, and monthly reads to the two approved projection RPCs.
- [ ] Assert exact RPC parameter names, minor-unit strings, space IDs, wallet IDs, effective/due dates, and caller-owned request IDs.
- [ ] Add a ratchet test that fails if `.insert`, `.update`, `.delete`, or `.upsert` appears in the browser gateway and rejects any mutation RPC outside the approved allowlist.
- [ ] Run the gateway tests and confirm failure because the adapter is absent.
- [ ] Implement parallel bounded RLS reads for loans, balances, wallets, events, movements, and postings; merge by IDs into immutable view models.
- [ ] Give every read a deterministic upper bound of 500 rows and return an explicit overflow error instead of silently truncating history.
- [ ] Implement only the seven approved RPC calls and surface Supabase errors unchanged to the error classifier.
- [ ] Run focused tests, all UI tests, typecheck, and `rg -n '\.(insert|update|delete|upsert)\(' src` expecting no matches.
- [ ] Commit as `feat: integrate loans protected commands`.

### Task 4: Bilingual dashboard, space flows, and loan list

**Files:** `src/i18n.test.tsx`, `src/i18n.tsx`, `src/features/loans/loan-summary.test.tsx`, `src/features/loans/loan-summary.tsx`, `src/features/loans/loan-list.test.tsx`, `src/features/loans/loan-list.tsx`, `src/features/loans/loans-page.test.tsx`, `src/features/loans/loans-page.tsx`, `src/styles.css`

- [ ] Write failing tests that switch EN to AR, update `<html lang="ar" dir="rtl">`, retain currency codes inside `<bdi>`, and expose equivalent accessible names in both languages.
- [ ] Write failing summary tests that render one independent row per currency and separate `owed to me`, `I owe`, `due`, `target`, `paid`, `remaining reservation`, and `expected collection` without a grand total.
- [ ] Write failing list tests for both directions and outstanding/settled/overdue states, due amounts, no-due-date copy, and the `I owe them` monthly plan line.
- [ ] Write failing page tests for personal/household switching, empty, loading, membership rejection, and refresh recovery.
- [ ] Implement the page using a calm ledger rail: paper background, ink text, jade for settled/received, saffron for due planning, and brick only for overdue/rejection. Use a tabular-number system face and native Arabic-capable fallback fonts without CDN assets.
- [ ] Keep the desktop list as readable rows rather than identical cards; stack label/value pairs on narrow screens using logical CSS properties.
- [ ] Run focused tests, all UI tests, typecheck, and build.
- [ ] Commit as `feat: add bilingual loans overview`.

### Task 5: Large loan creation flow

**Files:** `src/features/loans/loan-dialogs.test.tsx`, `src/features/loans/loan-dialogs.tsx`, `src/features/loans/use-loans.test.tsx`, `src/features/loans/use-loans.ts`

- [ ] Write failing tests for the three explicit creation paths: opening outstanding obligation, lending from a same-currency wallet, and borrowing into a same-currency wallet.
- [ ] Assert direction and transaction type are chosen before details; wallet selection is hidden for openings and filtered to the loan currency for cash loans.
- [ ] Assert person, positive amount, currency, effective date, due date order, note length, and wallet are validated before calling the gateway.
- [ ] Assert submission creates one UUID request ID, disables duplicate submit while pending, reuses that request ID only for an unchanged transport retry, closes on success, refreshes projections, and opens the new detail.
- [ ] Run the focused tests and confirm failure because creation is absent.
- [ ] Implement an accessible `<dialog>`-based large overlay with visible title/description, focus containment, Escape/close recovery, and a full-screen mobile layout.
- [ ] Show a plain-language preview: opening changes the obligation only; lending lowers the chosen wallet; borrowing raises it. Never predict or edit the resulting balance.
- [ ] Map server rejections inline and keep entered data available for correction.
- [ ] Run focused tests, all UI tests, typecheck, and build.
- [ ] Commit as `feat: add protected loan creation flows`.

### Task 6: Detail, history, repayments, and settlement

**Files:** `src/features/loans/loan-dialogs.test.tsx`, `src/features/loans/use-loans.test.tsx`, `src/features/loans/loan-dialogs.tsx`, `src/features/loans/use-loans.ts`

- [ ] Write failing detail tests for person/direction, opening amount, immutable remaining principal, total repaid, due/state, note, and chronological event history with reversal links.
- [ ] Write failing repayment tests for partial amount, `Pay/receive full remaining amount`, same-currency active wallet filtering, effective date, pending duplicate prevention, successful refresh, and settled-state transition from refreshed ledger data.
- [ ] Write failing recovery tests for overpayment and wrong-currency rejection; entered values stay visible, the outstanding source value remains unchanged, and the user is directed to refresh or select a matching wallet.
- [ ] Run the focused tests and confirm failure because detail/repayment behavior is absent.
- [ ] Implement direction-aware labels (`Receive repayment` versus `Record repayment`) and a full-screen-on-mobile repayment overlay.
- [ ] Render history from immutable financial events/postings, not a local editable transaction list.
- [ ] Run focused tests, all UI tests, typecheck, and build.
- [ ] Commit as `feat: add loan history and repayments`.

### Task 7: Monthly targets and correction recovery

**Files:** `src/features/loans/loan-dialogs.test.tsx`, `src/features/loans/use-loans.test.tsx`, `src/features/loans/loan-dialogs.tsx`, `src/features/loans/use-loans.ts`

- [ ] Write failing target tests showing controls only for `I owe them`, accepting zero as clear, rejecting target above current outstanding, and keeping target, paid, remaining reservation, and due amount visually separate.
- [ ] Write failing correction tests requiring explicit event selection, explanation that correction adds a linked reversal rather than editing history, effective date, and a final consequence confirmation.
- [ ] Assert dependent-repayment rejection uses exact recovery guidance: reverse later repayments first, then retry the earlier correction; do not offer force, delete, edit, or forgiveness.
- [ ] Assert already-reversed and retry-collision errors retain the dialog and offer refresh or request correction rather than silent retry.
- [ ] Run focused tests and confirm failure because target/correction behavior is absent.
- [ ] Implement target and correction overlays through `set_loan_monthly_target` and `reverse_financial_event` only.
- [ ] Refresh list, summary, plan, detail, and history after successful commands.
- [ ] Run focused tests, all UI tests, typecheck, build, and the source mutation ratchet.
- [ ] Commit as `feat: add loan planning and corrections`.

### Task 8: Rendered visual and accessibility verification

**Files:** `playwright.config.ts`, `e2e/fixtures/loans.ts`, `e2e/loans.visual.spec.ts`, `artifacts/loans-ui/*.png`

- [ ] Build deterministic browser fixtures for personal and household spaces without adding a runtime demo/fixture path to production code.
- [ ] Write Playwright tests that intercept only Supabase test traffic, then verify desktop EN list/summary/detail, mobile EN creation/repayment, desktop AR RTL household, and mobile AR overdue/error/correction recovery states.
- [ ] Assert dialogs have accessible names, keyboard focus stays in overlays, Escape restores focus, touch targets are at least 44 px, no horizontal overflow exists at 390 px, and reduced-motion mode remains usable.
- [ ] Run the visual test once before fixtures/routes are complete and confirm the expected failure.
- [ ] Complete deterministic routes and take named screenshots at 1440×1000 and 390×844.
- [ ] Inspect every screenshot at original resolution; revise hierarchy, clipping, directionality, contrast, and error recovery defects and rerun affected component tests first.
- [ ] Run `pnpm test:e2e`, `pnpm check:ui`, and the environment-loaded complete `pnpm check`.
- [ ] Commit as `test: verify loans ui visual flows`.

### Task 9: Final boundary audit and handoff

**Files:** `docs/decisions.md`, `docs/financial-command-inventory.md`, `README.md`

- [ ] Append only material UI/integration decisions and record what changes if a future owner chooses differently.
- [ ] Update the command inventory entry paths from “future client RPC” to the actual Supabase Loans gateway without changing the command set.
- [ ] Document local environment keys and commands without recording secrets.
- [ ] Run `git diff --check`, source scans for forbidden writes/deferred feature labels, `pnpm check:ui`, `pnpm test:e2e`, and `set -a; source ./.env.test; set +a; pnpm check`.
- [ ] Inspect `git status --short` and confirm only milestone files plus preserved `.swarm/` are present.
- [ ] Commit as `docs: record loans ui delivery evidence`.

## Acceptance matrix

- [ ] Both directions and all three creation entry paths are covered by tests.
- [ ] Partial/full repayment, settlement, overdue, correction, and dependent-repayment rejection are covered.
- [ ] Wrong currency, overpayment, retry collision, missing membership, unknown database rejection, and recovery are covered.
- [ ] Personal/household, desktop/mobile, EN/AR RTL, focus, and adjacent error states have rendered evidence.
- [ ] Monthly target, actual paid, remaining reservation, due amount, and expected collections stay visibly distinct per currency.
- [ ] No browser financial-table write, mutable balance control, deferred feature UI, push, deploy, production access, or Sandooq modification occurred.
