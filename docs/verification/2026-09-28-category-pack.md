# 26c Optional category suggestions (X8) — source verification

**Date:** 2026-09-28. **Branch:** `ws/category-pack`. **Starting SHA:** `ed42421475899501cc6c97cfa64a9300980e5bce`.
**Contract:** `docs/superpowers/plans/future-planning/26-daily-tools-ui.md` §"26c Optional category
suggestions (X8)" (lines 36-48) and the closing rules at the end of that file; `00-start-here.md`.
**Method:** TDD (failing tests first), focused UI-config Vitest, `check:ui`, and the named Playwright spec.

## Delivered

An explicit, opt-in starter **suggestion pack** on the existing Categories surface. The packs are
static, version-1, bilingual suggestions (not a mandatory hierarchy and not seeded rows); nothing is
written until the person opts in and confirms. Each selected entry runs the **existing** create-category
command sequentially, one caller-owned request UUID per entry that is reused on retry. Nothing is
persisted anywhere — only the in-memory operation UUIDs/results for the dialog session.

Added:

- `src/features/categories/category-packs.ts` — `CATEGORY_PACKS` (Essentials: Housing/السكن,
  Food/الطعام, Transport/المواصلات; Lifestyle: Dining/المطاعم, Leisure/الترفيه), `MAX_PACK_SELECTION = 10`.
- `src/features/categories/category-pack-dialog.tsx` — opt-in flow: previews every suggestion, edits each
  label, normalizes through the existing category rules, runs create-category sequentially, and reports
  **created / skipped / failed** with a retry that re-runs only the unresolved entries with their **same
  UUIDs**. A normalized-name collision surfaces the existing category; matching is scoped by kind so an
  income category is never treated as satisfying an expense suggestion (or the reverse).
- `src/features/categories/category-name-rules.ts` — a small client mirror of the server's
  `canonical_category_name` / `english_category_key` / `arabic_category_key` used only to detect/report
  collisions; the database remains authoritative.
- `src/features/categories/categories-page.tsx` — an explicit **"Add suggestion pack"** toolbar action and
  the dialog wiring (existing categories + `createCategoryWithRequestId`).
- `src/features/categories/categories-manage.css` — logical-property styles for the action group and pack
  dialog (mobile stacks the toolbar; desktop keeps the action group at the inline end).
- `src/features/categories/use-categories.ts` — exported `normalizeCategoryNames` / `normalizeCategoryDraft`
  (the existing rules) and added `createCategoryWithRequestId`; `createCategory` now delegates to it.
- `src/test/in-memory-categories-gateway.ts` — models the server's per-`(space, kind)` active-name unique
  index so collision tests are realistic.
- Tests: `category-packs.test.ts`, `category-name-rules.test.ts`, `category-pack-dialog.test.tsx`, and
  new cases in `categories-page.test.tsx`.
- `e2e/category-pack.spec.ts`.

**No SQL seeds and no new tables** were added; no migration is required. Off-limits paths
(`src/app.tsx`, `src/features/planning-shared/**`, loans/types, wallets/money, global CSS, `package.json`,
`ops/**`, `supabase/**`, `scripts/**`) were not touched.

## Decisions

- Pack entries are bilingual **expense** roots with a fixed kind; only the labels are editable, matching
  the contract ("previews every choice, editable labels").
- The ≤10 bound is enforced both at selection (an 11th checkbox is disabled) and again at run time (slice).
- A collision detected before submission is reported as **skipped** and surfaces the existing category
  (kind-scoped). A residual server-side `duplicate_name` is also reported as **skipped**, not a retryable
  failure; an unreconciled/other error is **failed** and retryable.
- The create-request UUIDs and per-entry results live in the dialog component's memory for its lifetime;
  closing after a partial run starts a fresh selection (no storage, no seeded rows).

## Red → green

| Step | Command | Result |
| --- | --- | --- |
| Red | `pnpm exec vitest run --config vitest.ui.config.ts src/features/categories` | **FAIL** — 4 test files failed (3 new modules unresolved; 3 new page tests could not find the action), 3 tests failed / 80 passed |
| Green (focused) | `pnpm exec vitest run --config vitest.ui.config.ts src/features/categories` | **PASS** — 10 files, **100 tests passed** |

## Required checks (actual)

| Gate | Command | Result |
| --- | --- | --- |
| UI gate | `pnpm check:ui` | **PASS** — `check:worker-types` + `tsc --noEmit` clean; **122 files, 1491 tests passed**; `vite build` clean |
| New spec | `pnpm test:e2e e2e/category-pack.spec.ts` | **PASS** — 6 passed (3 tests × desktop + mobile) |

`pnpm check:ui` was run whole, so the touched `use-categories.ts` and the shared in-memory fixture were
re-exercised by their existing suites (all green).

## Synthetic vs live evidence (separate statuses)

- UI component tests: **Pass** (jsdom, focused config).
- New Playwright spec: **Pass**, but it drives the local simulated HTTP fixture
  (`e2e/fixtures/loans.ts`) — **synthetic browser evidence, not authenticated live-product/UAT evidence**.
- Deployment: **not performed** (none requested; no push/deploy/SQL applied).

## Remaining limitations

- The client name mirror may differ from the server's exact canonicalization for exotic Unicode; the
  server stays authoritative, and any residual mismatch surfaces as a kind-scoped skip on the server error.
- Only Essentials/Lifestyle exist (5 suggestions), so the 10-cap is exercised with an injected test pack.
- The pack session is per dialog mount; a partial run cannot be resumed after closing the dialog (by
  design — nothing is persisted and no rows/trees are seeded).
- The full e2e suite was intentionally not run (per the task); only `e2e/category-pack.spec.ts` was run.
