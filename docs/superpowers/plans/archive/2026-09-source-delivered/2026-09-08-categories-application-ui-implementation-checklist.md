# Categories Application and UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bilingual category management and optional category selection for eligible Wallets income/expense postings without changing the reviewed database or any existing financial boundary.

**Architecture:** Add one typed `CategoriesGateway` beside the existing Loans and Wallets gateways. Its Supabase adapter performs bounded RLS reads, routes category lifecycle through `create_category` and `archive_category`, routes categorized income/expense through `record_categorized_financial_event`, and reconciles ambiguous outcomes through the protected result lookup or bounded event/association reads; `useCategories` owns space-scoped lifecycle state while `useWallets` retains general posting state and delegates only explicitly categorized income/expense commands.

**Tech Stack:** Node 22.22.0, pnpm 11.17.0, React 19, TypeScript strict, Vite, Supabase JS, Vitest, Testing Library, Playwright, semantic HTML, logical CSS properties.

---

## Scope guard

- [ ] Preserve `.swarm/`, `.DS_Store` files, and unrelated work without staging them.
- [ ] Do not edit any file under `supabase/`; do not add or change migrations, tables, RLS, grants, protected functions, financial journal objects, balances, or database lifecycle tooling.
- [ ] Do not touch Household behavior or files; personal and household category behavior remains identical through the selected space contract.
- [ ] Allow Categories browser mutations only through `create_category`, `archive_category`, and `record_categorized_financial_event`; use `get_category_command_result` only as a bounded read-only reconciliation RPC.
- [ ] Keep `record_financial_event` unchanged for uncategorized opening, income, expense, and transfer submissions.
- [ ] Offer categories only for `income` and `expense`; never send a category for openings, transfers, loan commands, reversals, or unsupported event types.
- [ ] Keep every amount as an exact integer minor-unit string and every request-bearing submission to one browser-generated UUID with no automatic retry.
- [ ] Keep category reads at a default page size of 50 and hard cap of 100 using `(created_at, id)` keyset order; resolve category history for no more than the existing 20-event journal page at a time.
- [ ] Do not add rename, delete, unarchive, hierarchy, subcategories, icons, colors, suggested packs, budgets, reports, recurrence, imports, offline sync, email delivery, deployment, or production access.

## File map

| File | Responsibility |
| --- | --- |
| `src/features/categories/types.ts` | Category, cursor, lifecycle command, categorized-posting, reconciliation, and gateway contracts. |
| `src/features/categories/errors.ts` | Safe category rejection and recovery messages without leaking database internals. |
| `src/features/categories/supabase-categories-gateway.ts` | The only Categories browser adapter: bounded RLS reads, three approved mutation RPCs, one read-only reconciliation RPC, and bounded event-category resolution. |
| `src/features/categories/use-categories.ts` | Immediate stale clearing, late-response rejection, pagination, lifecycle request IDs, ambiguous reconciliation, explicit same-request retry, and server refetch. |
| `src/features/categories/category-dialog.tsx` | Accessible bilingual create dialog with independent optional EN/AR names and retained safe values. |
| `src/features/categories/archive-category-dialog.tsx` | Deliberate archive confirmation, ambiguous recovery, and focus restoration without delete/unarchive affordances. |
| `src/features/categories/categories-page.tsx` | Active income/expense category lists, loading/empty/error/retry states, pagination, and dialog composition. |
| `src/features/wallets/types.ts` | Optional category selection in eligible posting drafts and resolved historical category labels. |
| `src/features/wallets/use-wallets.ts` | Existing request-stable submission flow extended to choose the categorized gateway only when eligible and to resolve each bounded history page. |
| `src/features/wallets/transaction-dialog.tsx` | Active kind-matched category picker, explicit uncategorized option, retained review state, and sourced names inside `<bdi>`. |
| `src/features/wallets/wallets-page.tsx` | Inject Categories gateway/state into the transaction and immutable-history surfaces. |
| `src/features/shell/application-shell.tsx`, `src/app.tsx` | Activate Categories as a third authenticated destination and inject the production/test gateway without altering auth, onboarding, Loans, or Reports. |
| `src/test/in-memory-categories-gateway.ts` | Deterministic component adapter that is never reachable from production startup. |
| `src/styles.css` | Existing ledger tokens extended with category registers, kind tabs, dialogs, live states, mobile containment, focus, and RTL. |
| `e2e/fixtures/categories.ts`, `e2e/categories.visual.spec.ts` | Deterministic Supabase HTTP fixture and desktop/mobile/EN/AR/recovery visual evidence. |
| `artifacts/categories-ui/*.png` | Curated inspected screenshots only when `UPDATE_VISUAL_ARTIFACTS=1`. |
| `docs/decisions.md`, `docs/financial-command-inventory.md`, `README.md` | Append-only application decisions, actual command entry paths, current scope, and verification commands. |

## Visual direction

- [ ] Extend the existing paper `#f4f0e5`, ink `#17211d`, pine `#183f35`, jade `#3b755f`, saffron `#d69b2d`, and brick `#a34536` vocabulary; do not redesign shared Loans, Wallets, auth, onboarding, or shell chrome.
- [ ] Make the distinctive element a two-column desktop category register split by income and expense, collapsing into explicit kind tabs on mobile; use quiet ledger rules rather than interchangeable rounded cards.
- [ ] Keep one plain sans/system family with Arabic-capable fallbacks and tabular figures for money; do not add remote fonts or dependencies.
- [ ] Use logical alignment and spacing, mirrored flow in RTL, visible `:focus-visible`, minimum 44px interactive targets, full-screen mobile dialogs, and reduced-motion-safe transitions.
- [ ] Treat empty/error/ambiguous states as instructions with one clear action, not decorative copy.

## Task 1: Define the Categories domain and safe errors

**Files:** `src/features/categories/types.ts`, `src/features/categories/errors.test.ts`, `src/features/categories/errors.ts`

- [ ] Write failing tests for stable handling of missing membership, duplicate normalized name, invalid or archived/wrong-kind category, changed-data request replay, already archived category, ambiguous transport failure, and a safe unknown rejection.
- [ ] Run `pnpm test:ui -- src/features/categories/errors.test.ts` and confirm RED because the Categories modules do not exist.
- [ ] Define `CategoryKind`, `Category`, `CategoryPage`, opaque cursor, `CategoryCommandResult`, `EventCategory`, `CreateCategoryInput`, `ArchiveCategoryInput`, `CategorizedEventInput`, and `CategoriesGateway` with no generic mutation escape hatch.
- [ ] Implement small error helpers that classify transport ambiguity separately and preserve only safe server messages needed for recovery.
- [ ] Run the focused test, typecheck, and all UI tests; commit `feat: define categories application domain`.

## Task 2: Add the bounded command-only Supabase gateway

**Files:** `src/features/categories/supabase-categories-gateway.test.ts`, `src/features/categories/supabase-categories-gateway.ts`

- [ ] Write a recording-client test proving active category reads filter selected `space_id`, exact `kind`, and `archived_at IS NULL`; order by `created_at,id`; request `limit + 1`; reject overflow; and continue with a validated opaque `(created_at,id)` keyset cursor rather than OFFSET.
- [ ] Assert `createCategory` calls only `create_category` with `p_space_id`, `p_request_id`, exact kind, and independent trimmed-or-null `p_name_en`/`p_name_ar` values.
- [ ] Assert `archiveCategory` calls only `archive_category` with `p_space_id`, `p_request_id`, and `p_category_id`.
- [ ] Assert `recordCategorizedEvent` calls only `record_categorized_financial_event` with exact space/request/kind/date/movements/category fields and rejects opening, transfer, and every unsupported kind before RPC.
- [ ] Assert category-command reconciliation uses `get_category_command_result` and accepts at most one result scoped by space + request ID.
- [ ] Assert categorized-event reconciliation first finds at most one event by space + request ID, then at most one association by that event ID, and succeeds only when the category matches.
- [ ] Assert history resolution accepts at most 20 event IDs, loads no more than 20 associations and 20 retained categories, keeps archived labels, validates space/kind references, and never transliterates a missing name.
- [ ] Add source ratchets that reject `.insert(`, `.update(`, `.delete(`, `.upsert(`, or `.truncate(` and reject any Categories RPC outside the three mutations plus the read-only result lookup.
- [ ] Run the focused gateway test and confirm RED before creating the adapter.
- [ ] Implement the minimal adapter with strict row/cursor validation and explicit bounds; run focused tests, typecheck, all UI tests, and mutation/allowlist scans; commit `feat: add protected categories gateway`.

## Task 3: Add space-scoped category state and lifecycle recovery

**Files:** `src/features/categories/use-categories.test.tsx`, `src/features/categories/use-categories.ts`

- [ ] Write failing initial-load tests for loading, ready, independent income/expense empty states, error, and manager-triggered retry.
- [ ] Write a failing race test proving a space change immediately exposes no prior category rows, invalidates pagination/retry state, and ignores every late prior-space response.
- [ ] Write a failing identity/remount test proving a prior user cannot retain category data, pending state, or request IDs after sign-out and another sign-in.
- [ ] Write failing create tests for one UUID per submission, duplicate-submit prevention, trimmed-or-null names, at least one non-empty name, 120-character bounds, successful refetch, database rejection with values retained by the dialog, and no local optimistic row.
- [ ] Write failing ambiguous-create tests: call the result lookup once; a matching `create_category` result refetches and succeeds; absence exposes only explicit retry with identical UUID/payload; any field edit clears that retry and the next submission receives a new UUID.
- [ ] Write equivalent archive tests for accepted refetch, rejection, matching reconciliation, absence with explicit identical retry, and no local removal before server confirmation.
- [ ] Write pagination tests proving kind-specific cursors are bounded, duplicate IDs do not accumulate, and late pages cannot cross a space/kind revision.
- [ ] Run the focused hook test and confirm RED before implementation.
- [ ] Implement immutable snapshots with request-sequence and pending refs; run focused tests, all UI tests, and typecheck; commit `feat: add category lifecycle state`.

## Task 4: Build bilingual category management

**Files:** `src/features/categories/category-dialog.test.tsx`, `src/features/categories/category-dialog.tsx`, `src/features/categories/archive-category-dialog.test.tsx`, `src/features/categories/archive-category-dialog.tsx`, `src/features/categories/categories-page.test.tsx`, `src/features/categories/categories-page.tsx`, `src/test/in-memory-categories-gateway.ts`, `src/styles.css`

- [ ] Write failing page tests for income/expense separation, EN-only, AR-only, bilingual fallback, names inside `<bdi>`, active rows only, loading, empty, error, retry, pagination, and absence of rename/delete/unarchive/hierarchy/icon/color/subcategory controls.
- [ ] Write failing create-dialog tests for kind, optional English and Arabic names, at-least-one validation, character bounds, retained values on rejection/ambiguity, explicit unchanged retry, live regions, and server-refetched success.
- [ ] Write failing archive-dialog tests for sourced category name isolation, deliberate confirmation, rejection/ambiguity recovery, pending duplicate prevention, and no destructive delete wording.
- [ ] Write dialog accessibility tests for labelled descriptions, initial focus, tab/shift-tab containment, Escape close when safe, opener focus restoration, mobile full-screen behavior, equivalent English/Arabic controls, and true RTL.
- [ ] Run focused tests and confirm RED before creating the components.
- [ ] Implement the desktop two-register/mobile kind-tab layout using the established ledger tokens; keep all copy plain, action names consistent, and shared UI changes scoped to reusable existing dialog behavior only.
- [ ] Run focused tests, all UI tests, typecheck, and build; commit `feat: add bilingual category management`.

## Task 5: Activate Categories in the authenticated shell

**Files:** `src/features/shell/application-shell.test.tsx`, `src/features/shell/application-shell.tsx`, `src/app.test.tsx`, `src/app.tsx`

- [ ] Write failing shell tests for accessible Loans, Wallets, and Categories controls; exactly one current page; keyboard activation; equivalent Arabic labels; and Reports remaining unavailable.
- [ ] Write failing app tests proving Categories mounts only after auth/session and visible-space resolution, selected space flows through unchanged, switching destinations preserves the global shell, space switching clears category content, and a new user receives a keyed fresh Categories tree.
- [ ] Run focused tests and confirm RED because Categories is not yet a destination.
- [ ] Inject one production `CategoriesGateway`, make `categories` a typed shell destination, and lazy-load `CategoriesPage` without adding a runtime fixture mode.
- [ ] Run focused tests, all auth/onboarding/Loans/Wallets UI tests, typecheck, and build; commit `feat: activate categories workspace`.

## Task 6: Add optional categorization to eligible Wallets events

**Files:** `src/features/wallets/types.ts`, `src/features/wallets/use-wallets.test.tsx`, `src/features/wallets/use-wallets.ts`, `src/features/wallets/transaction-dialog.test.tsx`, `src/features/wallets/transaction-dialog.tsx`, `src/features/wallets/wallets-page.test.tsx`, `src/features/wallets/wallets-page.tsx`

- [ ] Write one failing test proving uncategorized income/expense still calls the unchanged Wallets gateway, with the same five-field RPC payload and one request UUID.
- [ ] Write failing categorized income and expense tests proving kind-matched selection calls the Categories gateway with the identical signed minor-unit movement strings and one UUID; opening and transfer never render/send a category; Loans remains unmodified.
- [ ] Write failing selection tests for active categories only, independent income/expense lists, explicit `Uncategorized`, sourced names inside `<bdi>`, one-language fallback, selection reset when event kind changes, and review copy that preserves the selected category.
- [ ] Write failing rejection tests proving amount/date/wallet/category values remain available and no authoritative balance/history/category projection changes locally.
- [ ] Write failing ambiguous categorized-post tests: verify bounded event + association reconciliation; discovered exact association becomes success and refetches the Wallets projection; absence exposes only explicit retry with the same UUID/payload; editing any field or category invalidates the retry and creates a fresh UUID.
- [ ] Write failing history tests that resolve categories for each existing 20-event page, display archived historical names, display reversal-inherited categories read-only, preserve `Uncategorized` when no association exists, and never expose category controls on loan events.
- [ ] Run focused tests and confirm RED before changing Wallets behavior.
- [ ] Implement the optional Categories dependency without changing existing Wallets gateway mutation methods; preserve every uncategorized, transfer, correction, loan-routing, pagination, focus, and stale-space behavior.
- [ ] Run focused Wallets/Categories tests, complete UI tests, typecheck, build, and command-boundary scans; commit `feat: categorize eligible wallet transactions`.

## Task 7: Add deterministic rendered verification

**Files:** `e2e/fixtures/categories.ts`, `e2e/categories.visual.spec.ts`, `e2e/fixtures/loans.ts`, `artifacts/categories-ui/*.png`

- [ ] Extend the shared deterministic Supabase HTTP fixture only through a Categories wrapper that supplies active/archived categories, associations, lifecycle RPCs, categorized posting, result lookup, delays, rejections, and ambiguous-success cases; keep production startup fixture-free.
- [ ] Write Playwright scenarios for desktop category registers, create and archive, eligible categorized income/expense, preserved uncategorized posting, archived category history, ambiguous create/post reconciliation without duplicate mutation, immediate space-switch clearing, category load/rejection/retry, mobile dialog focus/containment, and Arabic RTL management/history.
- [ ] Assert dialogs have accessible names/descriptions, keyboard focus traps/restores, Escape behaves safely, live regions announce status, every visible control is at least 44px, no 390px horizontal overflow exists, and reduced-motion mode remains usable.
- [ ] Run `CI=1 pnpm test:e2e -- e2e/categories.visual.spec.ts` before fixture completion and confirm the expected RED.
- [ ] Complete routes and capture curated evidence under `artifacts/categories-ui/` at 1440×1000 and 390×844 only with `UPDATE_VISUAL_ARTIFACTS=1`.
- [ ] Open every curated screenshot at original resolution and inspect hierarchy, clipping, contrast, English/Arabic copy, true RTL mirroring, sourced-name directionality, category kind clarity, dialog containment, and rejection/ambiguous recovery; correct defects test-first.
- [ ] Run Categories E2E, complete E2E, complete UI tests, typecheck, and build; commit `test: verify categories application flows`.

## Task 8: Audit boundaries and hand off

**Files:** `docs/decisions.md`, `docs/financial-command-inventory.md`, `README.md`

- [ ] Append only material Categories application decisions, including the separate gateway boundary, eligible-event selection, archived historical labels, page bounds, and what changes if those contracts change.
- [ ] Update the command inventory so `record_categorized_financial_event`, category lifecycle commands, and result lookup name the actual Categories gateway entry path; keep existing Wallets and Loans rows intact.
- [ ] Update README current capabilities and deferred scope without claiming budgeting, reporting, deployment, live UAT, or the whole product is complete.
- [ ] Run a fresh `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test:ui`, dedicated Budget `.env.test`-loaded `pnpm test:db`, `pnpm build`, and `CI=1 pnpm test:e2e`; report exact pass/fail/skip counts.
- [ ] Run direct-write and RPC allowlist scans over `src`, verify no Categories code calls unsupported RPCs, and verify existing Wallets/Loans allowlists remain unchanged.
- [ ] Run `git diff --check`, compare `supabase/` byte-for-byte against reviewed base `46c0385`, inspect the complete branch diff, and confirm Household files are absent.
- [ ] Inspect `git status --short`, preserve untracked `.swarm/` and `.DS_Store`, and list every milestone commit with `git log --oneline 46c0385..HEAD`.
- [ ] Commit documentation as `docs: record categories application delivery`.

## Acceptance matrix

- [ ] Active space members can create and archive EN-only, AR-only, or bilingual income/expense categories; no forbidden lifecycle or taxonomy control exists.
- [ ] Categories disappear immediately on space/user changes; late reads, pages, reconciliations, and commands cannot restore stale data.
- [ ] Create/archive commands use one UUID per submission, never retry automatically, reconcile through one bounded protected result lookup, and offer only explicit identical retry after confirmed absence.
- [ ] Category pickers appear only for income/expense, retain an explicit uncategorized path, and never reach opening, transfer, loan, reversal, or unsupported commands.
- [ ] Categorized posting preserves exact signed minor-unit strings, one request UUID, bounded ambiguous reconciliation, retained safe fields, and server-refetched Wallets/category projections.
- [ ] Journal category resolution is bounded per 20-event page, preserves archived/reversal history, uses stored-language fallback inside `<bdi>`, and leaves uncategorized rows honest.
- [ ] Desktop/mobile, EN/AR, true RTL, keyboard/focus, loading, empty, error, retry, rejection, and ambiguous recovery states have automated and visually inspected evidence.
- [ ] No SQL, Household file, financial balance logic, Loans behavior, auth/onboarding behavior, direct table write, push, deployment, production/Sandooq access, or deferred feature was added.
