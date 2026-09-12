# Task-oriented Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the authenticated Budget sidebar with a task-oriented desktop rail and accessible mobile navigation drawer while preserving every existing destination and business boundary.

**Architecture:** Extract destination/group rendering and the selected-space disclosure into focused shell components. `ApplicationShell` remains the only composition point and dispatches its existing callbacks; it adds only local drawer/focus state. CSS swaps the mobile horizontal rail for a modal drawer and uses logical properties for RTL.

**Tech Stack:** React 19, TypeScript, lucide-react, CSS custom properties, Vitest with Testing Library, Playwright.

---

## File structure

- Create: `src/features/shell/workspace-navigation.tsx` — typed group metadata and reusable destination navigation.
- Create: `src/features/shell/space-switcher.tsx` — selected-space disclosure, space choices, and add-space action.
- Modify: `src/features/shell/application-shell.tsx` — assemble desktop rail, mobile bar/drawer, existing callbacks, and focus lifecycle.
- Modify: `src/features/shell/application-shell.test.tsx` — unit coverage for grouping, conditional Household visibility, space action, and drawer keyboard lifecycle.
- Modify: `src/styles.css` — replace rail/mobile navigation rules with the approved shell layout.
- Modify: `e2e/application.visual.spec.ts` — fresh EN/AR desktop/mobile visual and keyboard browser coverage.
- Modify: `docs/ui-financial-workspace-qa.md` — record the local visual matrix and its boundaries.

### Task 1: Lock the information architecture with red shell tests

**Files:**

- Create: `src/features/shell/workspace-navigation.tsx`
- Modify: `src/features/shell/application-shell.tsx`
- Modify: `src/features/shell/application-shell.test.tsx`

- [ ] **Step 1: Write the failing group/order test**

Add this test after the current desktop shell test:

```tsx
it('groups available destinations by task and exposes Reports', () => {
  render(<ApplicationShell locale="en" userEmail="owner@example.com" spaces={[householdSpace]} selectedSpace={householdSpace} activeDestination="home" onDestinationChange={vi.fn()} onSpaceChange={vi.fn()} onAddSpace={vi.fn()} onLocaleChange={vi.fn()} onSignOut={vi.fn()}><div>Overview</div></ApplicationShell>);

  const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });
  expect(within(navigation).getByRole('heading', { name: 'Daily money' })).toBeInTheDocument();
  expect(within(navigation).getByRole('heading', { name: 'Review' })).toBeInTheDocument();
  expect(within(navigation).getByRole('heading', { name: 'Setup' })).toBeInTheDocument();
  expect(within(navigation).getAllByRole('button').map((button) => button.textContent)).toEqual([
    'Overview', 'Wallets', 'Loans', 'Reports', 'Categories', 'Household',
  ]);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run `pnpm exec vitest run src/features/shell/application-shell.test.tsx`.

Expected: the new test fails because the current shell has ungrouped `Home` navigation and no section headings.

- [ ] **Step 3: Add the typed navigation model**

Create `src/features/shell/workspace-navigation.tsx`. Export `WorkspaceNavigation`, which accepts the existing `ApplicationDestination`, `Locale`, `Space['kind']`, and destination callback types. Return the following ordered groups, filtering Household unless `spaceKind === 'household'`:

```tsx
const groups = [
  { id: 'daily', label: t(locale, 'Daily money', 'المال اليومي'), items: [overview, wallets] },
  { id: 'review', label: t(locale, 'Review', 'المراجعة'), items: [loans, reports] },
  { id: 'setup', label: t(locale, 'Setup', 'الإعداد'), items: [categories, household] },
];

return <nav className="primary-nav" aria-label={t(locale, 'Primary navigation', 'التنقل الرئيسي')}>
  {groups.map((group) => <section key={group.id} className="navigation-group" aria-labelledby={`${idPrefix}-${group.id}`}>
    <h2 id={`${idPrefix}-${group.id}`}>{group.label}</h2>
    {group.items.filter(Boolean).map((item) => <button key={item.destination} type="button" className={item.destination === activeDestination ? 'nav-active' : ''} aria-current={item.destination === activeDestination ? 'page' : undefined} onClick={() => onDestinationChange(item.destination)}>
      <item.Icon aria-hidden="true" /><span>{item.label}</span>
    </button>)}
  </section>)}
</nav>;
```

Use the existing installed Lucide icons. The component must neither own state nor change routes itself.

- [ ] **Step 4: Rewire the shell and make the test pass**

Replace the hand-written nav buttons in `src/features/shell/application-shell.tsx` with `WorkspaceNavigation`, passing the existing callback. Change only the shell’s visible Home label to `Overview` / `النظرة العامة`; retain `home` as the callback value and retain `WorkspaceRoutes` unchanged.

Run `pnpm exec vitest run src/features/shell/application-shell.test.tsx`.

Expected: PASS, including updated existing assertions that now query Overview.

- [ ] **Step 5: Commit the tested navigation model**

Run:

```bash
git add src/features/shell/workspace-navigation.tsx src/features/shell/application-shell.tsx src/features/shell/application-shell.test.tsx
git commit -m "feat(shell): group workspace navigation by task"
```

### Task 2: Consolidate selected-space controls

**Files:**

- Create: `src/features/shell/space-switcher.tsx`
- Modify: `src/features/shell/application-shell.tsx`
- Modify: `src/features/shell/application-shell.test.tsx`

- [ ] **Step 1: Write failing space-switcher tests**

Replace the current combobox assertion with a disclosure test:

```tsx
const switcher = screen.getByRole('button', { name: /Current space: Home budget/ });
await user.click(switcher);
await user.click(screen.getByRole('button', { name: 'Switch to Home budget' }));
expect(changeSpace).toHaveBeenCalledWith(householdSpace.id);
expect(screen.getByRole('button', { name: 'Add another space' })).toBeInTheDocument();
expect(screen.getAllByText('Home budget').filter((element) => element.closest('bdi'))).toHaveLength(1);
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run `pnpm exec vitest run src/features/shell/application-shell.test.tsx`.

Expected: FAIL because the current rail exposes both a select and a second `.space-current-name` display.

- [ ] **Step 3: Implement `SpaceSwitcher`**

Create `src/features/shell/space-switcher.tsx` with props `locale`, `spaces`, `selectedSpace`, `onSpaceChange`, and `onAddSpace`. Render a `<details className="space-switcher">` with a summary labelled `Current space: {selected name}` / `المساحة الحالية: {selected name}`. The summary contains `<bdi>{selectedSpace.name}</bdi>` and a localized personal/household hint. Render each space as a button named `Switch to {name}` / `التبديل إلى {name}`, calling only `onSpaceChange(space.id)` and marking the selected choice with `aria-current="true"`. Render the existing add-space callback as the final button.

- [ ] **Step 4: Integrate and verify behavior**

Replace `.rail-space`, its `<select>`, and `.space-current-name` in `ApplicationShell` with `SpaceSwitcher`. Keep the existing callbacks exactly as received from `App`.

Run:

```bash
pnpm exec vitest run src/features/shell/application-shell.test.tsx
pnpm exec vitest run src/app.test.tsx
```

Expected: both commands PASS; space changes still flow through the unchanged workspace hook.

- [ ] **Step 5: Commit the tested space switcher**

Run:

```bash
git add src/features/shell/space-switcher.tsx src/features/shell/application-shell.tsx src/features/shell/application-shell.test.tsx
git commit -m "feat(shell): consolidate selected space controls"
```

### Task 3: Replace mobile horizontal navigation with a bounded drawer

**Files:**

- Modify: `src/features/shell/application-shell.tsx`
- Modify: `src/features/shell/application-shell.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing drawer interaction tests**

Add tests that click `Menu`, assert a `role="dialog"` named `Navigation menu`, press Escape, and assert focus returns to Menu. Add a second test that opens Menu, activates Wallets, and asserts `changeDestination` received `wallets` and the dialog disappeared.

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run `pnpm exec vitest run src/features/shell/application-shell.test.tsx`.

Expected: FAIL because the current shell contains no Menu button or dialog.

- [ ] **Step 3: Implement local drawer state and focus lifecycle**

In `ApplicationShell`, add `mobileMenuOpen` state and refs for the Menu trigger and close button. When open, render this shell-only dialog after main content:

```tsx
<div className="mobile-navigation-backdrop" role="presentation" onMouseDown={closeMobileMenu}>
  <section className="mobile-navigation-drawer" role="dialog" aria-modal="true" aria-labelledby="mobile-navigation-title" onMouseDown={(event) => event.stopPropagation()} onKeyDown={trapDrawerTabKey}>
    <div className="mobile-navigation-heading"><h2 id="mobile-navigation-title">{text.navigation}</h2><button ref={closeButtonRef} type="button" onClick={closeMobileMenu}>{text.closeMenu}</button></div>
    <WorkspaceNavigation activeDestination={activeDestination} locale={props.locale} spaceKind={props.selectedSpace.kind} onDestinationChange={(destination) => { props.onDestinationChange?.(destination); closeMobileMenu(); }} />
    <SpaceSwitcher locale={props.locale} spaces={props.spaces} selectedSpace={props.selectedSpace} onSpaceChange={props.onSpaceChange} onAddSpace={props.onAddSpace} />
  </section>
</div>
```

Put the existing locale and Account controls below `SpaceSwitcher`. On open, focus `closeButtonRef`. `closeMobileMenu` clears state and focuses `menuTriggerRef.current` using `requestAnimationFrame`. `trapDrawerTabKey` gathers enabled buttons and summaries in the drawer; it loops Tab from the last to the first and Shift+Tab from the first to the last, and calls `closeMobileMenu` on Escape. Do not add a document listener, direct DOM routing, or a dependency.

- [ ] **Step 4: Apply responsive CSS**

At `@media (max-width: 1023px)`, hide `.app-rail`, display `.mobile-shell-bar`, and remove the current horizontal scrolling `.primary-nav` rule. Style `.mobile-navigation-backdrop` as a fixed logical inset overlay and `.mobile-navigation-drawer` with `inset-inline-end: 0`, `width: min(360px, 100%)`, bounded scroll height, and a 44px minimum close button. Use `border-inline-start`, `padding-inline`, and `text-align: start`; do not introduce `left` or `right`. At `min-width: 1024px`, hide `.mobile-shell-bar` and the closed drawer path.

- [ ] **Step 5: Run focused unit tests and commit**

Run `pnpm exec vitest run src/features/shell/application-shell.test.tsx`.

Expected: PASS, including Escape, focus restoration, destination dispatch, and existing personal-versus-household visibility.

Run:

```bash
git add src/features/shell/application-shell.tsx src/features/shell/application-shell.test.tsx src/styles.css
git commit -m "feat(shell): use a mobile workspace navigation drawer"
```

### Task 4: Prove responsive RTL navigation and retain recovery access

**Files:**

- Modify: `e2e/application.visual.spec.ts`
- Modify: `docs/ui-financial-workspace-qa.md`

- [ ] **Step 1: Write failing browser tests**

Replace light-mint-rail-only assertions with tests named `task-oriented navigation` that assert desktop group headings and Reports, while mobile exposes Menu and no visible `.app-rail`. Add this mobile interaction check:

```ts
await page.getByRole('button', { name: 'Menu' }).click();
await expect(page.getByRole('dialog', { name: 'Navigation menu' })).toBeVisible();
await page.keyboard.press('Escape');
await expect(page.getByRole('button', { name: 'Menu' })).toBeFocused();
expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
```

Add EN desktop, AR desktop, EN mobile, and AR mobile screenshots of the desktop rail or open mobile drawer. Update stale expectations that say Reports is absent; Reports is an implemented existing destination.

- [ ] **Step 2: Run the focused browser file and confirm it fails**

Run:

```bash
pnpm exec playwright test e2e/application.visual.spec.ts --project=desktop --project=mobile --grep "task-oriented navigation"
```

Expected: FAIL before implementation because the named tests and snapshots do not exist.

- [ ] **Step 3: Update snapshots and inspect all four states**

Run the same command with `--update-snapshots --workers=1`, then rerun without snapshot updates. Inspect each generated screenshot for group labels, active state, no clipped text, no horizontal page overflow, the RTL rail/drawer at logical inline-end, and a visible close action.

- [ ] **Step 4: Verify feature error recovery stays reachable**

Use the existing application fixture error option to expose the Wallets `role="alert"` panel. Add desktop and mobile assertions that navigate from that panel to Loans through the new navigation. Keep initial workspace loading/error and onboarding tests unchanged because they intentionally render before a selected space exists.

- [ ] **Step 5: Run the full verification matrix**

Run:

```bash
pnpm test:ui
pnpm typecheck
pnpm build
pnpm exec playwright test e2e/application.visual.spec.ts --project=desktop --project=mobile
pnpm test:e2e
```

Expected: each command either PASSes or reports a separately documented pre-existing environment blocker. Do not claim live authentication, physical-device, or deployment proof from this fixture-backed matrix.

- [ ] **Step 6: Record evidence and commit**

Append exact commands, pass/fail/skipped counts, screenshot paths, and verification limits to `docs/ui-financial-workspace-qa.md`. Then run:

```bash
git add e2e/application.visual.spec.ts e2e docs/ui-financial-workspace-qa.md
git commit -m "test(shell): cover task-oriented responsive navigation"
```

## Plan self-review

- **Spec coverage:** Tasks 1–2 implement destination groups and the single space switcher; Task 3 implements the mobile drawer and keyboard contract; Task 4 verifies EN/AR, desktop/mobile, errors, and the documented proof boundary. No financial or database task is included.
- **Placeholder scan:** The plan contains no unfinished placeholders. Every task names exact files, test commands, expected outcomes, and a commit boundary.
- **Type consistency:** `ApplicationDestination` remains the existing union; `WorkspaceNavigation` and the drawer dispatch that exact type through the existing callback. `SpaceSwitcher` only passes existing space IDs.
