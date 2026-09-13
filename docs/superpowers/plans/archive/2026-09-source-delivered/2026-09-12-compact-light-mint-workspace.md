# Compact Light-and-Mint Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the authenticated financial workspace compact and visibly match the approved light-neutral rail with mint active navigation.

**Architecture:** Keep `ApplicationShell` as the source of shell semantics and retain existing routes/actions. Adjust its presentation hooks only when required for deterministic visual coverage; centralize the visual change in `src/styles.css` so every workspace shares the same rail and page-density language.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Playwright, CSS custom properties.

---

### Task 1: Add a shell presentation regression

**Files:**
- Modify: `src/features/shell/application-shell.test.tsx`
- Modify: `src/features/shell/application-shell.tsx`

- [ ] **Step 1: Write the failing test**

Add an expectation after the existing navigation lookup: `expect(screen.getByRole('complementary')).toHaveClass('app-rail', 'app-rail--light');`.

- [ ] **Step 2: Run test to verify it fails**

Run `pnpm vitest run src/features/shell/application-shell.test.tsx`. Expect failure because `app-rail--light` is absent.

- [ ] **Step 3: Write minimal implementation**

Change the rail opening tag to `<aside className="app-rail app-rail--light">`.

- [ ] **Step 4: Run test to verify it passes**

Run `pnpm vitest run src/features/shell/application-shell.test.tsx`. Expect pass.

- [ ] **Step 5: Commit**

Run `git add src/features/shell/application-shell.tsx src/features/shell/application-shell.test.tsx && git commit -m "test(shell): lock light workspace rail hook"`.

### Task 2: Apply the compact light-and-mint visual system

**Files:**
- Modify: `src/styles.css:1-55,176-205,276-286`
- Modify: `e2e/application.visual.spec.ts`

- [ ] **Step 1: Write the failing visual assertion**

Add a named screenshot assertion for the existing authenticated Home route with the sidebar visible: `await expect(page).toHaveScreenshot('application-shell-light-mint-desktop.png', { fullPage: true, animations: 'disabled' });`.

- [ ] **Step 2: Run the visual test to verify it fails**

Run `pnpm playwright test e2e/application.visual.spec.ts --project=chromium`. Expect failure with a missing snapshot named `application-shell-light-mint-desktop.png`.

- [ ] **Step 3: Implement the approved CSS treatment**

Replace dark rail rules with a light neutral rail, subtle divider, dark-green text, mint `.nav-active`, and smaller rail block spacing. Reduce desktop main padding and title/control spacing without changing minimum button height. Use logical CSS properties and update the narrow breakpoint to preserve the light rail. The target declarations include `.app-rail--light { color: #173c32; background: #fbfaf4; border-inline-end: 1px solid #e4e6df; }` and `.primary-nav .nav-active { color: #126955; background: #d8f1e9; }`.

- [ ] **Step 4: Update and verify the desktop snapshot**

Run `pnpm playwright test e2e/application.visual.spec.ts --project=chromium --update-snapshots`, then rerun without `--update-snapshots`. Expect pass.

- [ ] **Step 5: Commit**

Run `git add src/styles.css e2e/application.visual.spec.ts e2e && git commit -m "feat(ui): compact the light mint workspace shell"`.

### Task 3: Verify responsive and RTL behavior

**Files:**
- Modify: `e2e/application.visual.spec.ts`
- Modify: `docs/ui-financial-workspace-qa.md`

- [ ] **Step 1: Write mobile and Arabic shell snapshots**

Add focused EN-mobile and Arabic-desktop screenshots beside the desktop shell assertion, using the existing visual helpers and explicit viewport/locale setup.

- [ ] **Step 2: Run them to verify snapshot creation is required**

Run `pnpm playwright test e2e/application.visual.spec.ts --project=chromium`. Expect only missing-snapshot failures.

- [ ] **Step 3: Update screenshots and inspect them**

Run `pnpm playwright test e2e/application.visual.spec.ts --project=chromium --update-snapshots`. Inspect for no horizontal overflow, a mint active state, readable inactive text, no compact-footer collision, and equivalent RTL ordering.

- [ ] **Step 4: Record local-proof limits**

Append commands and screenshot matrix to `docs/ui-financial-workspace-qa.md`, stating fixture-backed local proof does not prove authenticated production UAT.

- [ ] **Step 5: Run regression checks**

Run `pnpm test`, `pnpm check`, `pnpm build`, and `pnpm playwright test`. Expect configured suites to pass; document intentional skips and existing build warnings separately from failures.

- [ ] **Step 6: Commit**

Run `git add e2e docs/ui-financial-workspace-qa.md && git commit -m "test(ui): cover compact light mint shell"`.
