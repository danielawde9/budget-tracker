# Financial Workspace Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the authenticated app into a calm, responsive, transaction-first financial workspace while preserving every verified financial and archive boundary.

**Architecture:** Add presentation-only tokens and components, then compose a bounded Home page from the existing workspace and Wallets read paths. Feature pages retain their typed gateways/hooks and protected commands; `App` owns destination routing and passes only presentation data/actions into the new Home composition.

**Tech Stack:** React 19, TypeScript strict, Vite, Vitest/Testing Library, Playwright, existing Supabase gateways and protected PostgreSQL commands.

**Spec:** `docs/superpowers/specs/2026-09-11-financial-workspace-redesign-design.md`

## Global Constraints

- Do not change financial commands, migrations, schema, RLS, gateway write paths, archive rules, idempotency, or derived-balance calculations.
- Do not invent reports, budgets, search, notifications, bank sync, analytics, goals, or other unapproved routes.
- Use a pinned, audited React icon library rather than text-symbol navigation icons; commit its lockfile change.
- Use logical CSS properties, `bdi` for DB-sourced text, and direction-isolated tabular money.
- Use an 8px visual spacing scale; all new gaps/padding derive from shared tokens.
- Keep Home reads bounded to active wallets plus the existing first journal page; no direct Supabase reads from presentation components.
- Do not touch another lane's archive behavior except to render its already-approved states.
- Test desktop, narrow mobile, English, Arabic RTL, loading, empty, error/recovery, keyboard focus, and destructive-dialog states.

---

## File structure

- `src/styles.css`: shared theme tokens, layout primitives, responsive/RTL rules; remove superseded page-specific visual rules only after each consumer migrates.
- `src/features/ui/*`: presentation-only shell primitives, real icons, empty/notice/header/list patterns.
- `src/features/home/home-page.tsx`: bounded Home composition from injected read-model data and navigation callbacks.
- `src/features/home/home-page.test.tsx`: Home hierarchy, links, locale, empty/read-error coverage.
- `src/features/home/workspace-routes.tsx`: own one Wallets read-state hook for Home and Wallets after a space is selected.
- `src/app.tsx`: add the `home` destination, default it after authentication, and render `WorkspaceRoutes` only after selection.
- `src/features/shell/application-shell.tsx`: compact navigation with Home and accessible real icons.
- `src/features/*/*-page.tsx`, dialogs, and tests: migrate each surface to shared presentation patterns without changing feature behavior.
- `e2e/*.visual.spec.ts`: add desktop/mobile EN/AR visual evidence in ignored per-run output paths.

## Task 1: Establish presentation tokens and real navigation icons

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/styles.css`
- Modify: `src/features/shell/application-shell.tsx`
- Modify: `src/features/shell/application-shell.test.tsx`

**Interfaces:**
- Produces CSS custom properties `--space-1` through `--space-8`, semantic surface/text/action/error tokens, and responsive shell classes.
- Produces `ApplicationDestination = 'home' | 'loans' | 'wallets' | 'categories' | 'household'` with a labelled Home control.

- [ ] **Step 1: Write failing shell tests**

Add assertions that the navigation exposes Home first, contains no Reports control, and each active destination retains `aria-current="page"`. Add an assertion that visible navigation icon containers are `aria-hidden`.

- [ ] **Step 2: Run the focused test to verify failure**

Run: `pnpm test:ui -- src/features/shell/application-shell.test.tsx`

Expected: FAIL because Home is absent and Reports is still rendered.

- [ ] **Step 3: Add the audited icon dependency and tokens**

Run `pnpm add lucide-react`, inspect the resulting package/lockfile license and version, and use its `House`, `WalletCards`, `HandCoins`, `Tags`, `UsersRound`, `Languages`, and `CircleUserRound` exports. Replace text glyphs in `ApplicationShell` with those icons. Add the Home copy in both locales; remove the disabled Reports copy/control.

At the top of `src/styles.css`, define the spacing scale as `4px, 8px, 16px, 24px, 32px, 40px, 48px, 64px`; replace shell-local magic spacing with those variables. Preserve the existing visible focus outline until a tokenized equivalent has a 3:1 non-text contrast check.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm test:ui -- src/features/shell/application-shell.test.tsx && pnpm typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/styles.css src/features/shell/application-shell.tsx src/features/shell/application-shell.test.tsx
git commit -m "feat(ui): establish financial workspace shell"
```

## Task 2: Add bounded Home composition and make it the default

**Files:**
- Create: `src/features/home/home-page.tsx`
- Create: `src/features/home/home-page.test.tsx`
- Create: `src/features/home/workspace-routes.tsx`
- Modify: `src/app.tsx`
- Modify: `src/features/wallets/use-wallets.ts`
- Modify: `src/features/wallets/types.ts`
- Modify: `src/features/wallets/wallets-page.tsx`
- Modify: `src/features/wallets/wallets-page.test.tsx`
- Modify: `src/app.test.tsx`

**Interfaces:**
- Produces `HomePage({ locale, wallets, recentEvents, onOpenWallets, onRecordTransaction })`.
- `wallets` is `readonly WalletProjection[]`; `recentEvents` is the existing first bounded `readonly JournalEvent[]` page, never a new aggregate.
- `onRecordTransaction` changes destination to Wallets and requests the existing transaction dialog through an explicit `WalletsPage` prop; it does not write data itself.

- [ ] **Step 1: Write failing Home tests**

Create fixtures with USD/LBP wallets and two `JournalEvent` entries. Assert: the page renders a localized welcome, active balance rows, the two latest events in descending existing order, an English/Arabic Wallets link, and `onOpenWallets` on activation. Add empty-wallet and no-events assertions that show a single next step rather than an empty metric area.

- [ ] **Step 2: Run the focused test to verify failure**

Run: `pnpm test:ui -- src/features/home/home-page.test.tsx`

Expected: FAIL because `HomePage` does not exist.

- [ ] **Step 3: Implement a presentation-only Home page and bounded adapter**

Export the existing `WalletsState` read fields required by Home from `use-wallets.ts`; do not add gateway methods. Create `WorkspaceRoutes`, rendered by `AuthenticatedWorkspace` only after `workspace.selectedSpace` exists. `WorkspaceRoutes` calls `useWallets(props.walletsGateway, props.spaceId, ...)` exactly once and passes that state to both `HomePage` and a new required `walletState: WalletsState` prop on `WalletsPage`. Remove `WalletsPage`'s internal `useWallets` call. This is the single state owner, so Home and Wallets cannot duplicate network reads or violate React's unconditional-hook rule.

Set `activeDestination` initial state to `'home'`. Render Home only when workspace selection is ready. Home's primary action calls a callback that selects Wallets and opens the existing transaction dialog. Keep the action disabled with a localized explanation when no active wallet exists.

- [ ] **Step 4: Run focused app and Home tests**

Run: `pnpm test:ui -- src/features/home/home-page.test.tsx src/features/wallets/wallets-page.test.tsx src/app.test.tsx`

Expected: PASS; previous authenticated default-destination expectations update from Loans to Home.

- [ ] **Step 5: Commit**

```bash
git add src/features/home src/app.tsx src/app.test.tsx src/features/wallets/use-wallets.ts src/features/wallets/types.ts src/features/wallets/wallets-page.tsx src/features/wallets/wallets-page.test.tsx
git commit -m "feat(home): add bounded financial overview"
```

## Task 3: Rebuild Wallets around the journal as the main work surface

**Files:**
- Modify: `src/features/wallets/wallets-page.tsx`
- Modify: `src/features/wallets/dialog-shell.tsx`
- Modify: `src/features/wallets/transaction-dialog.tsx`
- Modify: `src/features/wallets/wallets-page.test.tsx`
- Modify: `src/features/wallets/transaction-dialog.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes the existing `CategoriesGateway`, `WalletsState`, and lifecycle/undo dialog contracts unchanged.
- Produces `WalletsPage` with required `walletState: WalletsState` plus optional `initialDialog?: 'transaction' | null`; the dialog request is consumed once after navigation.

- [ ] **Step 1: Write failing behavior and semantic-layout tests**

Add tests for one labelled primary `Add transaction` control, compact `Active balances` context, a journal with date/event/wallet/category/amount order, and a visible localized empty-state path. Add a test that `initialDialog="transaction"` opens the existing dialog without invoking a gateway mutation.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `pnpm test:ui -- src/features/wallets/wallets-page.test.tsx src/features/wallets/transaction-dialog.test.tsx`

Expected: FAIL because the initial-dialog contract and revised semantics are absent.

- [ ] **Step 3: Implement the Wallets visual hierarchy**

Use shared page-header and list classes. Keep wallet lifecycle actions, correction eligibility, retry/recovery, category resolution, and pagination exactly as they are. Move balances into a short contextual side/above-journal area that reflows below the journal on narrow screens. Make journal rows readable without nested cards; date and amount use tabular isolated layouts. Update `DialogShell` and transaction form spacing, labels, action order, and sticky narrow-screen action area without changing validation/submission code.

- [ ] **Step 4: Run focused tests, typecheck, and visual suite**

Run: `pnpm test:ui -- src/features/wallets/wallets-page.test.tsx src/features/wallets/transaction-dialog.test.tsx && pnpm typecheck && pnpm test:e2e -- e2e/wallets.visual.spec.ts`

Expected: PASS; screenshots are written only to ignored per-run output.

- [ ] **Step 5: Commit**

```bash
git add src/features/wallets src/styles.css e2e/wallets.visual.spec.ts
git commit -m "feat(ui): redesign wallet journal workspace"
```

## Task 4: Apply the system to Loans and Categories/archive

**Files:**
- Modify: `src/features/loans/loans-page.tsx`
- Modify: `src/features/loans/loan-list.tsx`
- Modify: `src/features/loans/loan-dialogs.tsx`
- Modify: `src/features/categories/categories-page.tsx`
- Modify: `src/features/categories/category-dialog.tsx`
- Modify: `src/features/categories/subcategory-dialog.tsx`
- Modify: `src/features/categories/archive-category-dialog.tsx`
- Modify: corresponding `*.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes all existing loan/category hooks, error classifiers, archive dialog props, and gateway types unchanged.
- Produces presentation-only shared class adoption; no archive/API contract changes.

- [ ] **Step 1: Write failing focused UI tests**

For Loans, assert page-header/action hierarchy, mobile-safe loan rows, localized empty/error recovery, and a dialog action order where cancel precedes the destructive/submit action. For Categories, assert income/expense remain distinguishable, the archive constraint copy remains visible, and mobile tabs keep `aria-pressed` semantics.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `pnpm test:ui -- src/features/loans/loans-page.test.tsx src/features/categories/categories-page.test.tsx src/features/categories/archive-category-dialog.test.tsx`

Expected: FAIL on new semantic/presentation expectations only.

- [ ] **Step 3: Migrate the two feature surfaces**

Replace hard rules, repeated pill styles, and ad-hoc spacing with shared primitives. Keep category archive actions and the “archive subcategories first” truth intact. Do not merge or modify the parallel wallet archive implementation. Ensure form descriptions explain immutable/archive consequences in concise plain language rather than changing what commands allow.

- [ ] **Step 4: Run focused verification**

Run: `pnpm test:ui -- src/features/loans src/features/categories && pnpm typecheck && pnpm test:e2e -- e2e/categories.visual.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/loans src/features/categories src/styles.css e2e/categories.visual.spec.ts
git commit -m "feat(ui): align loans and categories workspace"
```

## Task 5: Apply the system to Household, onboarding, auth, and shared states

**Files:**
- Modify: `src/features/household/household-page.tsx`
- Modify: `src/features/household/household-dialogs.tsx`
- Modify: `src/features/workspace/onboarding-dialog.tsx`
- Modify: `src/features/auth/auth-screen.tsx`
- Modify: `src/app.tsx`
- Modify: corresponding `*.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes existing protected household/auth/workspace action contracts unchanged.
- Produces visually consistent loading, error, empty, confirmation, and narrow-screen dialog states.

- [ ] **Step 1: Write failing regression tests**

Add tests that Household's destructive role/remove/leave controls retain their labels and acknowledgement gate, onboarding still creates a first space then wallet, and auth preserves email/password autocomplete and confirmation/resend flow. Add locale assertions for each rendered page-level action.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `pnpm test:ui -- src/features/household src/features/workspace src/features/auth src/app.test.tsx`

Expected: FAIL only on new structural/visual semantics.

- [ ] **Step 3: Implement state and dialog presentation migration**

Use shared page/notice/dialog patterns. Replace the login screen's conflicting full-screen grid/card treatment with the chosen calm workspace language while retaining a clear authentication boundary. Keep warning/error copy truthful; move operator-only backup detail out of the normal primary task hierarchy, not out of the product.

- [ ] **Step 4: Run focused verification**

Run: `pnpm test:ui -- src/features/household src/features/workspace src/features/auth src/app.test.tsx && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/household src/features/workspace src/features/auth src/app.tsx src/styles.css
git commit -m "feat(ui): unify account and household flows"
```

## Task 6: Full responsive/RTL proof and redesign handoff

**Files:**
- Modify: `e2e/application.visual.spec.ts`
- Modify: `e2e/wallets.visual.spec.ts`
- Modify: `e2e/categories.visual.spec.ts`
- Modify: `e2e/private-uat.spec.ts`
- Create: `docs/ui-financial-workspace-qa.md`

**Interfaces:**
- Produces a Pass/Fail/Blocked matrix for desktop/mobile and English/Arabic primary paths.

- [ ] **Step 1: Add red E2E assertions**

Add deterministic fixture tests that verify Home as default, a Wallets primary action route from Home, no disabled Reports navigation, mobile controls do not horizontally overflow, Arabic sets `dir="rtl"`, and focus returns from every closeable dialog to its opener.

- [ ] **Step 2: Run the selected E2E tests to verify failure**

Run: `pnpm test:e2e -- e2e/application.visual.spec.ts e2e/wallets.visual.spec.ts e2e/categories.visual.spec.ts`

Expected: FAIL until the route and visual contract are present.

- [ ] **Step 3: Implement only the minimal selectors/test hooks needed**

Prefer role/name assertions. Add `data-testid` only when a stable accessible name cannot distinguish an interactive control. Do not make production-only branches or fixture-only UI.

- [ ] **Step 4: Run the full verification matrix**

Run:

```bash
pnpm typecheck
pnpm test:ui
pnpm build
pnpm test:e2e
```

Record exact pass/fail/blocked evidence in `docs/ui-financial-workspace-qa.md`; clearly label fixture-backed evidence as not live Supabase/production proof.

- [ ] **Step 5: Commit**

```bash
git add e2e docs/ui-financial-workspace-qa.md
git commit -m "test(ui): verify financial workspace redesign"
```

## Self-review

- Spec coverage: Tasks 1–6 cover tokens/icons, Home, Wallets, Loans, Categories/archive, Household, auth/onboarding, states, responsive RTL, and evidence. Financial/data boundaries are explicit global constraints.
- Completeness scan: every task has concrete files, focused test command, implementation boundary, and commit scope.
- Type consistency: Home only consumes existing Wallet projection and bounded journal types; no new write gateway interface is introduced.
