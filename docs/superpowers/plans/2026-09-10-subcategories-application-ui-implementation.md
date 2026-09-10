# Subcategories Application and UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fully tested one-level subcategory management and selection to the existing bilingual Categories experience without changing database or ledger behavior.

**Architecture:** Extend the typed Categories model and protected Supabase adapter with immutable parent identity and one `create_subcategory` command. Reuse the existing category hook's request-stable recovery, derive a one-level semantic hierarchy in the UI, and leave exact categorized-event posting and history identity unchanged.

**Tech Stack:** Node 22.22.0, pnpm 11.17.0, React 19, TypeScript strict, Vite, Supabase JS, Vitest, Testing Library, Playwright, semantic HTML, logical CSS properties.

---

**Spec:** `docs/superpowers/specs/2026-09-10-subcategories-application-ui-design.md`

## Scope guard

- [ ] Preserve `.swarm/` and every unrelated file without staging it.
- [ ] Do not edit `supabase/migrations`, run hosted commands, access production
  data, insert Essentials children, deploy, push, or send anything externally.
- [ ] Do not change auth, Household, Loans, Wallet balances, financial commands,
  exact minor-unit movement strings, or category association semantics.
- [ ] Permit child creation only through `create_subcategory`; preserve the
  existing protected Categories RPC allowlist and direct-write ratchet.
- [ ] Keep hierarchy depth exactly one and add no rename, delete, unarchive,
  reparent, drag/drop, icons, colors, packs, budgets, or reports.

### Task 1: Record the approved application boundary

**Files:**
- Create: `docs/superpowers/specs/2026-09-10-subcategories-application-ui-design.md`
- Create: `docs/superpowers/plans/2026-09-10-subcategories-application-ui-implementation.md`
- Modify: `docs/decisions.md`

- [ ] Record hierarchy display, root-only child creation, archive ordering,
  exact transaction selection, and unchanged history semantics.
- [ ] Run `git diff --check` and inspect the exact staged scope.
- [ ] Commit as `docs: design subcategories application UI`.

### Task 2: Extend the typed protected gateway

**Files:**
- Modify: `src/features/categories/types.ts`
- Modify: `src/features/categories/supabase-categories-gateway.test.ts`
- Modify: `src/features/categories/supabase-categories-gateway.ts`
- Modify: `src/features/categories/errors.test.ts`
- Modify: `src/features/categories/errors.ts`

- [ ] Write failing projection and command tests requiring a validated nullable
  `parentCategoryId`, exact `create_subcategory` payload, and the new protected
  command-result kind.
- [ ] Run the focused gateway test and confirm RED from the missing parent
  projection and child command.
- [ ] Add `CreateSubcategoryInput`, strict row parsing, the typed gateway method,
  exact protected RPC, and allowlist update.
- [ ] Observe RED for safe invalid-parent, depth, and active-child archive error
  mappings before implementing equivalent EN/AR guidance.
- [ ] Run focused tests, `pnpm typecheck`, and `pnpm test:ui` GREEN.
- [ ] Commit as `feat: extend protected categories gateway for subcategories`.

### Task 3: Add request-stable child lifecycle state

**Files:**
- Modify: `src/features/categories/use-categories.test.tsx`
- Modify: `src/features/categories/use-categories.ts`
- Modify: `src/test/in-memory-categories-gateway.ts`

- [ ] Write failing hook tests for one UUID and exact parent per submission,
  duplicate-pending prevention, normalization, accepted refetch, rejection,
  matching ambiguous reconciliation, explicit unchanged retry, edited payload
  receiving a new UUID, and no optimistic child.
- [ ] Run the focused hook test and confirm RED from the missing lifecycle API.
- [ ] Extend the retry union and reconciliation with `create_subcategory`, expose
  `createSubcategory(parentId, draft)`, and preserve every space/revision guard.
- [ ] Update only the deterministic test gateway contract.
- [ ] Run the focused hook test, all UI tests, and typecheck GREEN.
- [ ] Commit as `feat: add request-stable subcategory lifecycle`.

### Task 4: Build the bilingual one-level management UI

**Files:**
- Create: `src/features/categories/subcategory-dialog.test.tsx`
- Create: `src/features/categories/subcategory-dialog.tsx`
- Modify: `src/features/categories/categories-page.test.tsx`
- Modify: `src/features/categories/categories-page.tsx`
- Modify: `src/features/categories/archive-category-dialog.tsx`
- Modify: `src/styles.css`

- [ ] Write failing page tests for semantic nested lists, `<bdi>` isolation,
  root-only child actions, child archive actions, parent archive guidance,
  mobile kind tabs, and equivalent Arabic copy.
- [ ] Write failing dialog tests for immutable sourced parent, EN/AR validation,
  retained values, explicit unchanged retry, accepted refetch, live regions,
  focus containment, Escape restoration, and pending behavior.
- [ ] Run the focused component tests and confirm RED from the absent hierarchy.
- [ ] Derive roots and children from one snapshot, render nested semantic lists,
  compose the child dialog with `DialogShell`, and add scoped logical styles.
- [ ] Run focused tests, all UI tests, typecheck, and production build GREEN.
- [ ] Commit as `feat: add bilingual subcategory management`.

### Task 5: Preserve category selection while exposing hierarchy

**Files:**
- Modify: `src/features/wallets/transaction-dialog.test.tsx`
- Modify: `src/features/wallets/transaction-dialog.tsx`
- Modify: `src/features/wallets/wallets-page.test.tsx`
- Modify: `src/styles.css`

- [ ] Write failing picker tests requiring roots followed by their active
  children, semantic grouping, names in `<bdi>`, both IDs selectable, and the
  exact selected child ID with unchanged exact minor-unit movements.
- [ ] Run the focused Wallet component tests and confirm hierarchy-only RED.
- [ ] Add presentation-only grouping without changing submission or Wallet
  state logic.
- [ ] Run Wallets and Categories focused tests, all UI tests, typecheck, and
  build GREEN.
- [ ] Commit as `feat: show subcategories in transaction picker`.

### Task 6: Add deterministic visual and flow evidence

**Files:**
- Modify: `e2e/fixtures/loans.ts`
- Modify: `e2e/categories.visual.spec.ts`
- Modify: `README.md`
- Modify: `docs/financial-command-inventory.md`

- [ ] Add parent IDs and a bounded local `create_subcategory` fixture handler.
- [ ] Extend desktop/mobile Playwright flows for hierarchy, create/archive,
  root archive guidance, child transaction selection, EN/AR RTL, error,
  ambiguity, containment, and minimum target sizes.
- [ ] Run the applicable projects and inspect current screenshots at full
  resolution, fixing only verified UI defects.
- [ ] Document the application entry path and unchanged writer boundary.
- [ ] Run focused E2E and `git diff --check`; commit as
  `test: verify subcategories UI flows`.

### Task 7: Final verification and scope audit

- [ ] Run `pnpm check:ops`, typecheck, all UI tests, production build, and the
  applicable Playwright suite with fresh output.
- [ ] Run the database/source ratchets needed to prove the merged SQL contract
  remains untouched, using the ignored test environment only if required; do
  not apply hosted migrations.
- [ ] Run direct-write/RPC allowlist scans, `git diff --check`, status, staged
  scope, and comparison against `4018d81` proving no migration or unrelated
  subsystem edits.
- [ ] Invoke `superpowers:finishing-a-development-branch`, create the final
  `codex/` branch reference if needed, and report commits, counts, screenshots,
  and remaining owner gates without merge, push, deploy, or production writes.

## Self-review

- **Coverage:** Typed contract, RPC, recovery, hierarchy, Wallet picker, EN/AR
  RTL, accessibility, responsive visuals, docs, and scope proof are covered.
- **Placeholders:** No behavior is deferred or unspecified.
- **Type consistency:** `parentCategoryId`, `parent_category_id`,
  `create_subcategory`, `CreateSubcategoryInput`, and the five-argument RPC
  payload are consistent throughout.
