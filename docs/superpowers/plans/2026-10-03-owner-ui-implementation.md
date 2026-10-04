# Owner walkthrough UI implementation plan

> For agentic workers: implement each task with focused regression tests and verify the integrated application.

**Goal:** Implement the approved October 3 concept sheets and walkthrough items 1–21 in the existing application.

**Architecture:** Keep existing routes, typed API, accounting rules and native dialogs. Simplify presentation with disclosures, contextual actions and focused editors. Preserve English and Arabic, keyboard access, responsive layouts and separate USD/LBP balances.

**Tech stack:** React, TypeScript, Vite, native dialog/details, existing Lucide icons, Vitest.

**Spec:** `docs/feedback/2026-10-03-owner-walkthrough.md` and `docs/feedback/ui-concepts-2026-10-03/` (all sheets approved in chat).

## Constraints

- Generated names, extraneous navigation and sample balances are illustrative; use the actual app names and data.
- Preserve all record kinds and investment/loan actions behind progressive disclosure.
- Money mutations keep their existing API contracts, revision checks and idempotency.
- No deployment or database reset is part of this task.

## Review focus

- Hidden fields and groups must retain draft values and validate before saving.
- Wallet setup must save a valid filled form before advancing and remain in place on failure.
- Negative balances keep their signs in previews and success messages.
- Arabic layouts and small viewports must retain usable labels and actions.
- Alerts and funding always identify the relevant month; empty and over-assigned states remain actionable.

## Tasks

### 1. Plan and item editing

- [x] Add failing tests for switching groups without losing edits, creating/editing items, and summary validation.
- [x] Implement one-group editor with persistent totals and optional item settings; simplify Plan groups, statement and bills.
- [x] Run plan regression tests and typecheck.

### 2. Record dialogs and accounts forms

- [x] Add failing tests for common actions versus More, debt signs, value previews and relevant money actions.
- [x] Implement focused record selection, plain labels, previews and optional fields; simplify funding, bills, loan/investment/wallet/correction dialogs.
- [x] Run record regression tests and typecheck.

### 3. Sign in and onboarding

- [x] Add failing tests for saving a draft wallet on continue and preserving it on validation/network failure.
- [x] Implement approved sign-in/sample data separation and four calm setup steps with currency explanations.
- [x] Run onboarding tests and typecheck.

### 4. Home, navigation, pages and shared UI

- [x] Add failing tests for the primary next action, hidden details, month-specific alerts, contextual account actions and guided tour progression.
- [x] Implement calmer Home, simplified shell, Activity/Accounts/Settings, glossary, accessible tour and shared dialog styling.
- [x] Run full UI tests, typecheck and build; inspect desktop/mobile and Arabic in the local preview.

### 5. Integrated review

- [x] Review all changes against walkthrough items and concept sheets, fix integration regressions.
- [x] Verify primary workflows and document actual results and any remaining limitation.

## Results — 2026-10-03

Implemented tasks 1–5 in the existing routes and APIs. Final full check: 110 UI tests, 165 database tests, TypeScript, and production build passed. Browser review covered desktop Home, Plan/editor, Record/expense, Accounts/investment value preview, Activity, Settings/glossary and guided navigation; mobile Home/Plan/editor and Arabic Plan.

Review fixes: preserve invalid raw plan drafts across groups and validate optional targets; clarify loaded Activity search scope; correct Home HTML nesting; keep popup footer visible; contain mobile header actions and percentage inputs; hide account action labels visually; wrap glossary definitions.

Evidence and remaining test limits are recorded in `design-qa.md`. No deployment or database reset.
