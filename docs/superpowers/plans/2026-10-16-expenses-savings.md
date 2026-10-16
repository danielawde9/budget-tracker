# Expenses and Savings Implementation Plan

> Implement inline with superpowers:executing-plans; the user explicitly requested implementation.

**Goal:** Make monthly expense reporting distinct from saving, with discoverable opening balances and account actions.
**Architecture:** Versioned group purpose controls shared expense calculations and the Plan split. Existing ledger commands handle category openings; a guarded account-opening RPC adds missing existing assets using opening flows. Activity filtering runs before database pagination.
**Tech Stack:** React/TypeScript, PostgreSQL/Supabase, Vitest and Playwright.
**Spec:** docs/superpowers/specs/2026-10-16-expenses-savings-design.md

## Constraints and review focus
- Preserve EN/AR, USD/LBP exact minor units and current visual system.
- Opening money must never count as income, expense or funding, or be recorded twice on retries.
- Purpose changes must survive renames and preserve older plan months and old-client saves.
- Filters must return records beyond the first page and support archived categories.
- Negative balances/refunds remain signed; mixed currencies are never added.
- Retain save recovery and immutable ledger permissions; migrate before frontend release.

## Tasks
1. [x] Write and run failing database and dashboard tests for purpose, filtering and account openings. Add forward migration with versioned purpose, default/backfill classification, plan serialization and filtered activity; add account-opening RPC with member validation/idempotence and permissions. Run database tests.
2. [x] Add shared typed purpose rules and test savings exclusion. Update Plan editor serialization, group sections and expense-only dashboard, replacing redundant assignment UI. Run relevant UI/model tests.
3. [x] Test and implement separate account/category opening forms with explicit previews, discoverable buttons, direct Accounts actions, and visible Activity filters/badges. Preserve pending/error recovery.
4. [x] Run complete UI/database suites, typecheck/build, detector and browser checks at desktop/mobile sizes; fix evidenced defects and review the final diff. Record release prerequisites and remaining deployment state.

## Execution ledger
- Setup: existing isolated worktree; branch codex/home-expenses-savings starts at latest origin/main ee44c45. User approved design, corrected Mazoot to Savings, and explicitly requested implementation and opening actions in both Accounts and Plan.

- Ruling: user explicitly requested implementation after approving the in-chat design; executed inline without further approval stages.
- Ruling: short-term goal items follow their Expense group; reserves remain set aside. Existing principal/interest ledger semantics are preserved.
- Review: fixed historical reclassification on future item moves, same-month group archive, and prior-purpose archive by retaining monthly classification snapshots. Fixed stale pagination after filter roundtrips/refresh with a request generation. Each financial regression was observed failing before its fix.
- Verification: 180 UI tests and 211 PostgreSQL tests pass; typecheck and production build pass. Browser inspection uses fixture-backed real screens, not a hosted account; desktop/390px/320px, EN/AR, opening previews and native-filter widths checked. Full authenticated local-stack Playwright suite was not run because this worktree has no disposable preview backend configured.
- User follow-up: shared hover padding added to register rows, Plan item buttons, text actions and record back actions. Phone filters constrained to prevent intrinsic-select overflow.
- Design detector: ran once; inherited legacy pattern warnings are outside this scoped change.
- Release: production untouched; apply the forward migration before publishing the frontend. The ignored .superpowers/ui-review directory is temporary sample-data review tooling.
