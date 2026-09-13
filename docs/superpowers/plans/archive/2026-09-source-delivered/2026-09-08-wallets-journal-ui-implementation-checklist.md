# Wallets and Journal UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bilingual Wallets workspace and immutable general-transaction journal to the authenticated Budget shell without changing the verified financial database boundary.

**Architecture:** Add one typed `WalletsGateway` beside the existing Loans gateway. Its Supabase adapter performs bounded RLS reads, creates wallets through `create_wallet`, posts general events through `record_financial_event`, and creates corrections through `reverse_financial_event`; a dedicated hook owns stale-data clearing, pagination, command reconciliation, and refreshes while presentation components render only server-derived balances and history.

**Tech Stack:** Node 22.22.0, pnpm 11.17.0, React 19, TypeScript strict, Vite, Supabase JS, Vitest, Testing Library, Playwright, semantic HTML, logical CSS properties.

---

## Scope guard

- [ ] Preserve `.swarm/`, `.DS_Store` files, and unrelated work without staging them.
- [ ] Do not edit any file under `supabase/`; do not change migrations, financial tables, RLS, grants, protected functions, or permissions.
- [ ] Allow new browser mutations only through `create_wallet`, `record_financial_event`, and `reverse_financial_event`.
- [ ] Keep the existing Loans mutation allowlist and all Loans behavior unchanged.
- [ ] Read wallet balances only from `wallet_balances`; never store, edit, or predict an authoritative balance.
- [ ] Read `loan_postings` only to classify loan-linked events and route their correction to Loans.
- [ ] Do not add wallet archive/delete, invitations, membership management, categories, notes, recurring transactions, imports, offline sync, budgets, reports, interest, fees, or currency conversion.
- [ ] Keep all reads bounded and every amount as an integer minor-unit string.

## File map

| File | Responsibility |
| --- | --- |
| `src/features/wallets/types.ts` | Wallet projection, event history, page cursor, command input, reconciliation, and gateway contracts. |
| `src/features/wallets/money.ts` | Exact signed minor-unit helpers and localized display built on the existing parser contract. |
| `src/features/wallets/supabase-wallets-gateway.ts` | The only Wallets browser adapter: bounded RLS reads and the three approved RPCs. |
| `src/features/wallets/use-wallets.ts` | Space-scoped loads, immediate stale clearing, pagination, one-request-per-submission state, reconciliation, explicit retry, and refresh. |
| `src/features/wallets/wallet-dialog.tsx` | Accessible wallet-creation dialog and ambiguous-create recovery. |
| `src/features/wallets/transaction-dialog.tsx` | Opening/income/expense/transfer validation, effect preview, submit, reconciliation, and explicit same-request retry. |
| `src/features/wallets/correction-dialog.tsx` | Deliberate linked-reversal confirmation and reversal reconciliation. |
| `src/features/wallets/wallets-page.tsx` | Wallet overview, transaction history, pagination, user states, and dialog composition. |
| `src/features/shell/application-shell.tsx` | Typed active destination and accessible Loans/Wallets navigation. |
| `src/app.tsx`, `src/lib/supabase.ts` | Inject Wallets gateway and choose the active authenticated workspace. |
| `src/test/in-memory-wallets-gateway.ts` | Deterministic component adapter; never reachable from production startup. |
| `src/styles.css` | Existing ledger visual language extended for wallet folios, journal rows, previews, dialogs, mobile, focus, and RTL. |
| `e2e/fixtures/wallets.ts`, `e2e/wallets.visual.spec.ts` | Deterministic Supabase HTTP fixture and rendered desktop/mobile/EN/AR/recovery evidence. |
| `docs/decisions.md`, `docs/financial-command-inventory.md`, `README.md` | Append-only decisions, actual command entry paths, scope, and handoff commands. |

## Task 1: Define the Wallets domain and exact money behavior

**Files:** `src/features/wallets/types.ts`, `src/features/wallets/money.test.ts`, `src/features/wallets/money.ts`

- [ ] Write failing tests for positive USD/LBP parsing, signed string inversion, zero rejection, excessive precision, unsupported input, and values beyond the database minor-unit bound.
- [ ] Run `pnpm test:ui -- src/features/wallets/money.test.ts` and confirm RED because the Wallets money module is absent.
- [ ] Define `WalletProjection`, `JournalEvent`, `JournalMovement`, `JournalPage`, `WalletsGateway`, `CreateWalletInput`, `RecordEventInput`, and `ReverseEventInput`; restrict event kinds to `opening_balance | income | expense | transfer` for new posts while preserving loan/reversal kinds in read models.
- [ ] Implement money helpers using strings and `BigInt`; do not use floating-point arithmetic for parsing, movement construction, summation, or validation.
- [ ] Reuse localized formatting only for display and keep the currency code/value inside a directionally isolated element at render time.
- [ ] Run the focused test, `pnpm typecheck`, and `pnpm test:ui`; commit `feat: define wallet journal domain`.

## Task 2: Add the bounded command-only Supabase gateway

**Files:** `src/lib/supabase.ts`, `src/features/wallets/supabase-wallets-gateway.test.ts`, `src/features/wallets/supabase-wallets-gateway.ts`

- [ ] Write a recording query-client test that proves wallet reads filter `space_id`, active wallets filter `archived_at IS NULL`, balances come from `wallet_balances`, and journal reads order deterministically with an explicit range/page bound.
- [ ] Assert event history joins only bounded `financial_events`, `wallet_movements`, `wallets`, and read-only `loan_postings` rows; classify an event as loan-linked when a posting references it.
- [ ] Assert `createWallet` calls only `create_wallet` with `p_space_id`, normalized `p_name`, and `p_currency`.
- [ ] Assert `recordEvent` calls only `record_financial_event` with exactly `p_space_id`, `p_request_id`, `p_kind`, `p_effective_date`, and `p_movements` using signed minor-unit strings.
- [ ] Assert `reverseEvent` calls only `reverse_financial_event` with exactly `p_space_id`, `p_request_id`, `p_event_id`, and `p_effective_date`.
- [ ] Assert `findEventByRequestId` is an RLS-protected read filtered by both submitted space and request ID and is bounded to one result.
- [ ] Add source ratchets that reject `.insert(`, `.update(`, `.delete(`, `.upsert(`, or `.truncate(` and reject any Wallets RPC outside `create_wallet`, `record_financial_event`, and `reverse_financial_event`.
- [ ] Run `pnpm test:ui -- src/features/wallets/supabase-wallets-gateway.test.ts` and confirm RED before creating the adapter.
- [ ] Implement the minimal adapter, normalize safe PostgREST bigint values to strings at the boundary, reject invalid rows/currencies/event kinds, and return an explicit overflow error rather than silently truncating.
- [ ] Run the focused test, `pnpm typecheck`, `pnpm test:ui`, and the direct-write/allowlist scans; commit `feat: add protected wallet journal gateway`.

## Task 3: Add space-scoped Wallets state and reconciliation

**Files:** `src/features/wallets/use-wallets.test.tsx`, `src/features/wallets/use-wallets.ts`

- [ ] Write a failing hook test proving an initial space load exposes loading, ready, empty-history, and retryable error states.
- [ ] Write a failing race test proving a space change synchronously clears wallets/events before requesting the next space and a late prior-space response cannot repopulate state.
- [ ] Write a failing identity test proving unmount/sign-out and a newly mounted user cannot retain the prior projection or pending command.
- [ ] Write failing wallet-creation tests for accepted creation, database rejection with safe values retained, ambiguous failure followed by fresh wallet reconciliation using space + trimmed name + currency, and no automatic retry.
- [ ] Write failing posting tests proving one UUID is created per submit, duplicate submit is disabled while pending, success refreshes server projections, rejection retains values, and no balance is locally changed.
- [ ] Write failing ambiguous-post tests: query by the same request ID; discovered event becomes success; absence exposes one explicit retry that reuses the identical request ID and payload; editing any input invalidates that retry and starts a new request.
- [ ] Write equivalent correction tests for success, already reversed, inaccessible, dependent-loan rejection, ambiguous reconciliation, and explicit same-request retry.
- [ ] Write pagination tests proving every page is bounded, uses the returned cursor, stops at `hasMore = false`, and ignores duplicate/late page results.
- [ ] Run `pnpm test:ui -- src/features/wallets/use-wallets.test.tsx` and confirm RED before implementing the hook.
- [ ] Implement the hook with request sequence refs and immutable snapshots; run focused tests, all UI tests, and typecheck; commit `feat: add wallet journal recovery state`.

## Task 4: Make Wallets a real shell destination

**Files:** `src/features/shell/application-shell.test.tsx`, `src/features/shell/application-shell.tsx`, `src/app.test.tsx`, `src/app.tsx`

- [ ] Write failing shell tests for accessible Loans and Wallets controls, exactly one `aria-current="page"`, keyboard activation, equivalent Arabic labels, and Reports remaining honestly unavailable.
- [ ] Write a failing app test that starts authenticated in Loans, opens Wallets without unmounting global space/account controls, switches back to Loans unchanged, and clears Wallets when the selected space changes.
- [ ] Run focused tests and confirm RED because Wallets remains disabled.
- [ ] Add a typed `activeDestination` state owned by the authenticated workspace; render `LoansPage` or `WalletsPage` while keeping the selected space and locale global.
- [ ] Keep Reports disabled and keep mobile navigation horizontally reachable instead of hiding Wallets.
- [ ] Run focused tests, all shell/auth/onboarding/Loans UI tests, and typecheck; commit `feat: activate wallets workspace navigation`.

## Task 5: Build the wallet overview and creation dialog

**Files:** `src/features/wallets/wallets-page.test.tsx`, `src/features/wallets/wallets-page.tsx`, `src/features/wallets/wallet-dialog.test.tsx`, `src/features/wallets/wallet-dialog.tsx`, `src/test/in-memory-wallets-gateway.ts`, `src/styles.css`

- [ ] Write failing overview tests for no wallets, one USD wallet, one LBP wallet, multiple currencies, loading, retryable network error, stale-space clearing, inaccessible space callback, and names wrapped in `<bdi>`.
- [ ] Assert every balance comes from the gateway projection, renders with tabular figures and directional isolation, and no balance input/archive/delete control exists.
- [ ] Write failing dialog tests for visible labels, intentional initial focus, focus trap, safe Escape close, focus restoration, mobile full-screen semantics, live loading/success/error regions, and English/Arabic copy.
- [ ] Write failing form tests for trimmed non-empty name, USD/LBP only, selected space payload, pending duplicate prevention, rejection value preservation, ambiguous reconciliation, and no automatic retry.
- [ ] Run the focused tests and confirm RED before creating the components.
- [ ] Implement quiet wallet folio rows within the existing pine/paper/ink/jade/saffron/brick system; use one emphasized balance column and restrained journal rules rather than introducing generic cards.
- [ ] Implement the creation dialog through the hook and `create_wallet` gateway path only.
- [ ] Run focused tests, the complete UI suite, typecheck, and build; commit `feat: add wallet overview and creation`.

## Task 6: Add validated general-event creation

**Files:** `src/features/wallets/transaction-dialog.test.tsx`, `src/features/wallets/transaction-dialog.tsx`, `src/features/wallets/use-wallets.test.tsx`, `src/features/wallets/use-wallets.ts`, `src/styles.css`

- [ ] Write one failing test per supported shape: opening balance and income produce one positive movement; expense produces one negative movement; transfer produces equal/opposite movements that sum to zero.
- [ ] Assert positive amount parsing, supported currency, active wallet, different transfer wallets, matching currencies, and a valid calendar effective date are checked before any gateway call.
- [ ] Assert cross-currency and same-wallet transfers show a local refusal, preserve fields, and send no request.
- [ ] Assert the confirmation step shows plain-language signed effects for each affected wallet without predicting resulting balances.
- [ ] Assert one request UUID per submit, pending duplicate prevention, exact request/payload reuse only after ambiguous absence, and fresh projection/history reads after accepted or reconciled success.
- [ ] Assert no description, note, category, fee, exchange-rate, or mutable-balance field is rendered or sent.
- [ ] Write dialog accessibility tests for initial focus, keyboard order, focus trap/restoration, safe Escape, live regions, mobile full-screen layout, English, Arabic, and RTL.
- [ ] Run focused tests and confirm RED before implementing the transaction workflow.
- [ ] Implement the four event builders and two-step preview/confirmation dialog; route the command only through `record_financial_event`.
- [ ] Run focused tests, all UI tests, typecheck, build, and mutation scans; commit `feat: add general wallet transactions`.

## Task 7: Add immutable history, pagination, and corrections

**Files:** `src/features/wallets/wallets-page.test.tsx`, `src/features/wallets/wallets-page.tsx`, `src/features/wallets/correction-dialog.test.tsx`, `src/features/wallets/correction-dialog.tsx`, `src/styles.css`

- [ ] Write failing history tests for empty state, bounded next-page loading, immutable kind/date/wallet/signed amount, opening/income/expense/transfer labels, loan-originated labels, reversal labels, and original/reversal links.
- [ ] Assert sourced wallet names use `<bdi>`, monetary values are directionally stable/tabular, and USD/LBP are never combined into one total.
- [ ] Assert an unreversed general event exposes Correct; already-reversed/reversal rows do not; loan-linked events expose a direction to Loans and no generic correction action.
- [ ] Write failing correction-dialog tests for a deliberate checkbox, explanation of linked inverse history, effective date validation, pending prevention, successful refresh, and focus behavior.
- [ ] Assert already-reversed, inaccessible, dependent-loan, generic database rejection, and ambiguous-reconciliation states have explicit recovery with safe values retained and no automatic retry.
- [ ] Run focused tests and confirm RED before implementing history and correction UI.
- [ ] Implement correction exclusively through `reverse_financial_event`, preserve the original row, and render its linked server-returned reversal after refresh.
- [ ] Run focused tests, all UI tests, typecheck, build, and command-boundary scans; commit `feat: add immutable wallet history corrections`.

## Task 8: Add deterministic rendered verification

**Files:** `e2e/fixtures/wallets.ts`, `e2e/wallets.visual.spec.ts`, `artifacts/wallets-ui/*.png`

- [ ] Add a test-only Supabase HTTP fixture covering wallet/balance/event/movement/posting reads and the three approved Wallets RPCs; do not add a runtime demo path.
- [ ] Write Playwright scenarios for desktop overview, first wallet creation, income + expense, same-currency transfer, general correction, ambiguous posting reconciliation, multiple spaces with immediate stale clearing, mobile transaction dialog, Arabic RTL overview/history, and adjacent rejection/recovery states.
- [ ] Assert focus trapping/restoration, safe Escape, visible labels, live error recovery, 44px touch targets, no 390px horizontal overflow, and reduced-motion usability.
- [ ] Run `CI=1 pnpm test:e2e -- e2e/wallets.visual.spec.ts` once before fixture completion and record the expected RED.
- [ ] Complete routes and capture deterministic evidence beneath `artifacts/wallets-ui/` at 1440×1000 and 390×844 without credentials or personal data.
- [ ] Open every screenshot at original resolution and inspect hierarchy, clipping, contrast, dialog containment, English/Arabic labels, RTL mirroring, signed values, and recovery copy; correct defects test-first.
- [ ] Run Wallets E2E, the complete E2E suite, UI tests, typecheck, and build; commit `test: verify wallet journal visual flows`.

## Task 9: Audit boundaries and hand off

**Files:** `docs/decisions.md`, `docs/financial-command-inventory.md`, `README.md`

- [ ] Append material Wallets UI/application decisions to `docs/decisions.md`, including what changes if command or pagination contracts change.
- [ ] Update the command inventory so `record_financial_event` and general-event `reverse_financial_event` name the Wallets gateway as an actual entry path; do not change the implemented command set.
- [ ] Update README scope and verification without claiming the Budget application is complete.
- [ ] Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test:ui`, `.env.test`-loaded `pnpm test:db`, `pnpm build`, and `CI=1 pnpm test:e2e`; report exact pass/fail/blocked counts.
- [ ] Run `rg -n '\.(insert|update|delete|upsert|truncate)\(' src` and confirm no direct protected-table write calls.
- [ ] Run a protected-command allowlist scan over browser gateways and confirm the only Wallets mutation RPCs are `create_wallet`, `record_financial_event`, and `reverse_financial_event`, while the existing Loans allowlist is unchanged.
- [ ] Run `git diff --check` and compare `supabase/` against `3a6b237` to prove migrations and financial permissions are unchanged.
- [ ] Inspect `git status --short`, preserve untracked `.swarm/` and `.DS_Store` files, and list every milestone commit with `git log --oneline 3a6b237..HEAD`.
- [ ] Commit documentation as `docs: record wallet journal delivery`.

## Acceptance matrix

- [ ] Wallets and Loans are both reachable in the authenticated shell; Reports remains unavailable.
- [ ] No prior-space or prior-user wallet projection survives switching, inaccessibility, sign-out, or sign-in.
- [ ] Wallet creation reconciles ambiguous transport outcomes before another submission is offered.
- [ ] Opening, income, expense, and same-currency transfer use exact signed minor-unit strings and show a preview.
- [ ] Cross-currency, same-wallet, invalid-date, inactive-wallet, and invalid-amount requests are refused before submission.
- [ ] Ambiguous post/reversal failures reconcile by request ID and only explicit identical retries reuse it.
- [ ] History is bounded, paginated, immutable, reversal-linked, and loan-aware.
- [ ] Desktop/mobile, EN/AR, RTL, keyboard, focus, loading, empty, error, and recovery states have automated and rendered evidence.
- [ ] No financial migration, permission, protected function, direct financial write, deployment, production/Sandooq access, or deferred feature was added.
- [ ] Household invitations/member management, categories, budgeting, reporting, recurring transactions, imports/offline sync, live UAT, deployment, and launch remain explicitly incomplete.
