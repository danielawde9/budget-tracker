# Existing-User Welcome Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a one-time welcome tour (4 steps with deep links) to existing users who have spaces, with a replay entry point in Manage > Preferences.

**Architecture:** A new `WelcomeTourDialog` renders over the loaded Control Room when `useWorkspace` reports `showWelcome` (localStorage flag `budget:welcome-seen:<userId>` absent). Deep links flow through a one-shot `pendingSection` prop into `ControlRoomRoutes`; the tour emits `onTryIt(target)` and `app.tsx` maps targets to the record sheet, destinations, and sections. Spec: `docs/superpowers/specs/2026-09-29-existing-user-welcome-tour-design.md`.

**Tech Stack:** React 19 + TypeScript, Vitest + Testing Library (`pnpm test:ui`), Playwright e2e (`pnpm test:e2e`), lucide-react icons, plain CSS in `src/styles.css`.

**Test commands:** `pnpm test:ui` runs the component/integration suite. `pnpm typecheck` runs all three TS configs. Run targeted files with `pnpm test:ui src/features/workspace/welcome-tour.test.tsx` (vitest accepts a path filter).

---

## File structure

| File | Responsibility |
|---|---|
| Create: `src/features/workspace/welcome-seen.ts` | Read/write the `budget:welcome-seen:<userId>` flag |
| Create: `src/features/workspace/welcome-tour.tsx` | The 4-step dialog (pure UI; emits `onDismiss`/`onTryIt`) |
| Create: `src/features/workspace/welcome-tour.test.tsx` | Component behavior, EN/AR, focus |
| Modify: `src/features/workspace/use-workspace.ts` | `showWelcome`, `dismissWelcome`, `replayWelcome`, flag write in `finishOnboarding` |
| Modify: `src/features/workspace/use-workspace.test.tsx` | Gating tests |
| Modify: `src/styles.css` | `.welcome-*` rules after the onboarding block (line ~871) |
| Modify: `src/features/control-room/manage-screen.tsx` | `initialSection` deep link + `onReplayWelcome` row |
| Modify: `src/features/control-room/routes.tsx` | Export `PlanSection`, accept `pendingSection` + `onReplayWelcome` |
| Modify: `src/features/control-room/manage-screen.test.tsx` | Deep-link + replay tests (refactor `renderManage` into `manageProps`) |
| Modify: `src/app.tsx` | Render tour, quick-add suppression, `tryIt` intents, threading |
| Modify: `src/app.test.tsx` | Seed flag for existing tests + new welcome-tour integration tests |
| Modify: `e2e/fixtures/loans.ts` | Seed the flag by default; `showWelcomeTour` opt-out |
| Modify: `e2e/fixtures/household.ts` | Seed the flag for `OWNER_ID` |
| Modify: `e2e/application.visual.spec.ts` | Welcome-tour screenshot test |

---

### Task 1: Flag helpers + workspace gating

**Files:**
- Create: `src/features/workspace/welcome-seen.ts`
- Modify: `src/features/workspace/use-workspace.ts`
- Test: `src/features/workspace/use-workspace.test.tsx`

- [ ] **Step 1: Write the failing tests** — append these to the `describe('useWorkspace')` block in `src/features/workspace/use-workspace.test.tsx` (after the existing `resumes at the starting-balance step...` test):

```tsx
  it('shows the welcome tour once for an existing user and never again', async () => {
    const gateway = new FakeWorkspaceGateway();
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.showWelcome).toBe(true);

    act(() => result.current.dismissWelcome());
    expect(result.current.showWelcome).toBe(false);
    expect(localStorage.getItem('budget:welcome-seen:user-1')).toBe('1');

    await act(async () => result.current.refresh());
    expect(result.current.showWelcome).toBe(false);
  });

  it('replays the welcome tour after it was seen', async () => {
    localStorage.setItem('budget:welcome-seen:user-1', '1');
    const gateway = new FakeWorkspaceGateway();
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.showWelcome).toBe(false);

    act(() => result.current.replayWelcome());
    expect(result.current.showWelcome).toBe(true);
  });

  it('marks the tour seen when the first run finishes so new users skip it', async () => {
    const gateway = new FakeWorkspaceGateway();
    gateway.spaces = [personalSpace];
    gateway.wallets = [spaceWallet('w1', 'Cash')];
    seedProgress('user-1', personalSpace.id);
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));
    await waitFor(() => expect(result.current.status).toBe('onboarding'));
    expect(result.current.showWelcome).toBe(false);

    await act(async () => { await result.current.finishOnboarding(personalSpace.id); });
    expect(result.current.status).toBe('ready');
    expect(localStorage.getItem('budget:welcome-seen:user-1')).toBe('1');
    expect(result.current.showWelcome).toBe(false);
  });

  it('never offers the welcome tour before the workspace is ready', async () => {
    const gateway = new FakeWorkspaceGateway();
    gateway.error = new Error('Network request failed');
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.showWelcome).toBe(false);

    gateway.error = null;
    gateway.spaces = [];
    await act(async () => result.current.refresh());
    expect(result.current.status).toBe('empty');
    expect(result.current.showWelcome).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:ui src/features/workspace/use-workspace.test.tsx`
Expected: FAIL — `Property 'showWelcome' does not exist on type ...`

- [ ] **Step 3: Create the flag helpers** — `src/features/workspace/welcome-seen.ts`:

```ts
/**
 * Per-user marker that the welcome tour has already been shown.
 *
 * Written from two places: any tour dismissal path in `app.tsx`, and
 * `useWorkspace.finishOnboarding` (so a person who completes first-run
 * setup never sees the tour). Purely local; no server involvement.
 */
export function welcomeSeenKey(userId: string): string {
  return `budget:welcome-seen:${userId}`;
}

export function readWelcomeSeen(userId: string): boolean {
  return localStorage.getItem(welcomeSeenKey(userId)) !== null;
}

export function writeWelcomeSeen(userId: string): void {
  localStorage.setItem(welcomeSeenKey(userId), '1');
}
```

- [ ] **Step 4: Wire the hook** — in `src/features/workspace/use-workspace.ts`:

Add the import next to the other `./` imports:

```ts
import { readWelcomeSeen, writeWelcomeSeen } from './welcome-seen.js';
```

Add state after `const [setup, setSetup] = useState<OnboardingSetup | null>(null);`:

```ts
  const [showWelcome, setShowWelcome] = useState(false);
```

In `load()`:
- in the `visibleSpaces.length === 0` branch (after `setSetup(null);`), add `setShowWelcome(false);`
- in the `catch` block (after `setSetup(null);`), add `setShowWelcome(false);`
- replace the ready block ending:

```ts
      setActiveSpaceClock(clock);
      setStatus('ready');
      setShowWelcome(!readWelcomeSeen(userId));
```

Change `finishOnboarding` to:

```ts
  const finishOnboarding = useCallback((spaceId?: string) => {
    clearOnboardingProgress(userId);
    // A person who just completed first-run setup skips the welcome tour.
    writeWelcomeSeen(userId);
    setShowWelcome(false);
    setSetup(null);
    return load(false, spaceId ?? '');
  }, [load, userId]);
```

Add the two actions after `finishOnboarding`:

```ts
  const dismissWelcome = useCallback(() => {
    writeWelcomeSeen(userId);
    setShowWelcome(false);
  }, [userId]);

  const replayWelcome = useCallback(() => {
    setShowWelcome(true);
  }, []);
```

Add to the returned object (keep alphabetical-ish grouping with the other onboarding fields):

```ts
    showWelcome,
    dismissWelcome,
    replayWelcome,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test:ui src/features/workspace/use-workspace.test.tsx`
Expected: PASS (all tests, including the 4 new ones)

- [ ] **Step 6: Commit**

```bash
git add src/features/workspace/welcome-seen.ts src/features/workspace/use-workspace.ts src/features/workspace/use-workspace.test.tsx
git commit -m "feat(welcome): gate a one-time welcome tour behind a per-user flag"
```

---

### Task 2: WelcomeTourDialog component + styles

**Files:**
- Create: `src/features/workspace/welcome-tour.tsx`
- Modify: `src/styles.css` (insert after `.onboarding-boundary { ... }`, line ~870)
- Test: `src/features/workspace/welcome-tour.test.tsx`

- [ ] **Step 1: Write the failing test** — create `src/features/workspace/welcome-tour.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WelcomeTourDialog } from './welcome-tour.js';

function renderTour(locale: 'en' | 'ar' = 'en') {
  const onDismiss = vi.fn();
  const onTryIt = vi.fn();
  render(<WelcomeTourDialog locale={locale} onDismiss={onDismiss} onTryIt={onTryIt} />);
  return { onDismiss, onTryIt };
}

describe('WelcomeTourDialog', () => {
  it('starts on the Quick add step with a step counter and a Next action', async () => {
    renderTour();
    const dialog = await screen.findByRole('dialog', { name: 'Welcome back!' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByText('Four quick things that make budgeting easier. 1 of 4.')).toBeInTheDocument();
    expect(within(dialog).getByText('Quick add')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Skip tour' })).toBeInTheDocument();
  });

  it('cycles through all four steps and finishes with Get started', async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderTour();
    const dialog = await screen.findByRole('dialog', { name: 'Welcome back!' });

    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(within(dialog).getByText('Four quick things that make budgeting easier. 2 of 4.')).toBeInTheDocument();
    expect(within(dialog).getByText('Reports & insights')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(within(dialog).getByText('Four quick things that make budgeting easier. 3 of 4.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(within(dialog).getByText('Four quick things that make budgeting easier. 4 of 4.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Get started' })).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Get started' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('emits each step target from Try it', async () => {
    const user = userEvent.setup();
    const { onTryIt } = renderTour();
    const dialog = await screen.findByRole('dialog', { name: 'Welcome back!' });

    await user.click(within(dialog).getByRole('button', { name: 'Try it →' }));
    expect(onTryIt).toHaveBeenCalledWith('record');

    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    await user.click(within(dialog).getByRole('button', { name: 'Try it →' }));
    expect(onTryIt).toHaveBeenLastCalledWith('reports');

    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    await user.click(within(dialog).getByRole('button', { name: 'Try it →' }));
    expect(onTryIt).toHaveBeenLastCalledWith('goals');
  });

  it('keeps focus inside the dialog and dismisses with Escape', async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderTour();
    const dialog = await screen.findByRole('dialog', { name: 'Welcome back!' });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('dismisses with Skip tour', async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderTour();
    const dialog = await screen.findByRole('dialog', { name: 'Welcome back!' });

    await user.click(within(dialog).getByRole('button', { name: 'Skip tour' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('renders the Arabic copy', async () => {
    renderTour('ar');
    expect(await screen.findByRole('dialog', { name: 'مرحبًا بعودتك!' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'التالي' })).toBeInTheDocument();
    expect(screen.getByText('أربع ميزات سريعة تجعل الميزانية أسهل. 1 من 4.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:ui src/features/workspace/welcome-tour.test.tsx`
Expected: FAIL — cannot resolve `./welcome-tour.js`

- [ ] **Step 3: Create the component** — `src/features/workspace/welcome-tour.tsx`:

```tsx
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChartPie, Plus, RotateCcw, Users } from 'lucide-react';
import type { Locale } from '../loans/types.js';

/** Where a "Try it" link lands; `app.tsx` owns the actual navigation. */
export type WelcomeTarget = 'record' | 'reports' | 'goals' | 'household';

interface WelcomeTourProps {
  locale: Locale;
  onDismiss(): void;
  onTryIt(target: WelcomeTarget): void;
}

interface WelcomeStep {
  title: string;
  body: string;
  target: WelcomeTarget;
  Icon: typeof Plus;
}

interface WelcomeCopy {
  product: string;
  title: string;
  intro(step: number): string;
  progress: string;
  next: string;
  getStarted: string;
  skip: string;
  close: string;
  tryIt: string;
  steps: readonly WelcomeStep[];
}

const copy: Record<'en' | 'ar', WelcomeCopy> = {
  en: {
    product: 'Budget ledger',
    title: 'Welcome back!',
    intro: (step) => `Four quick things that make budgeting easier. ${step} of 4.`,
    progress: 'Welcome progress',
    next: 'Next',
    getStarted: 'Get started',
    skip: 'Skip tour',
    close: 'Close',
    tryIt: 'Try it →',
    steps: [
      { title: 'Quick add', body: 'Record an expense or income in seconds — from here, or with an installed-app shortcut.', target: 'record', Icon: Plus },
      { title: 'Reports & insights', body: 'See where your money goes each month and what changed since last month.', target: 'reports', Icon: ChartPie },
      { title: 'Recurring & goals', body: 'Automate the bills you pay and save toward the purchases you plan.', target: 'goals', Icon: RotateCcw },
      { title: 'Household', body: 'Invite the people you live with and keep one budget together.', target: 'household', Icon: Users },
    ],
  },
  ar: {
    product: 'دفتر الميزانية',
    title: 'مرحبًا بعودتك!',
    intro: (step) => `أربع ميزات سريعة تجعل الميزانية أسهل. ${step} من 4.`,
    progress: 'تقدّم الجولة الترحيبية',
    next: 'التالي',
    getStarted: 'ابدأ الآن',
    skip: 'تخطَّ الجولة',
    close: 'إغلاق',
    tryIt: 'جرّبها ←',
    steps: [
      { title: 'الإضافة السريعة', body: 'سجّل مصروفًا أو دخلًا في ثوانٍ — من هنا، أو من اختصار على هاتفك.', target: 'record', Icon: Plus },
      { title: 'التقارير والرؤى', body: 'شاهد أين تذهب أموالك كل شهر وما الذي تغيّر منذ الشهر الماضي.', target: 'reports', Icon: ChartPie },
      { title: 'المتكرر والأهداف', body: 'جدّد الفواتير تلقائيًا وادّخر لما تخطط له من مشتريات.', target: 'goals', Icon: RotateCcw },
      { title: 'المنزل', body: 'ادعُ من تعيش معهم واحتفظوا بميزانية واحدة معًا.', target: 'household', Icon: Users },
    ],
  },
};

function focusable(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
}

export function WelcomeTourDialog({ locale, onDismiss, onTryIt }: WelcomeTourProps) {
  const text = copy[locale];
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const current = text.steps[step]!;
  const last = step === text.steps.length - 1;

  // Return focus to whatever was focused before the tour opened.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    focusable(dialog)[0]?.focus();
  }, [step]);

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onDismiss();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusable(event.currentTarget);
    const first = items[0];
    const lastItem = items.at(-1);
    if (!first || !lastItem) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      lastItem.focus();
    } else if (!event.shiftKey && document.activeElement === lastItem) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="overlay welcome-overlay">
      <section
        ref={dialogRef}
        className="dialog welcome-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        onKeyDown={trapFocus}
      >
        <header className="dialog-header">
          <div>
            <span className="auth-brand"><span className="auth-brand-mark" aria-hidden="true" />{text.product}</span>
            <h1 id="welcome-title">{text.title}</h1>
            <p className="dialog-intro">{text.intro(step + 1)}</p>
          </div>
          <button type="button" className="icon-button" aria-label={text.close} onClick={onDismiss}>×</button>
        </header>
        <ol className="welcome-dots" aria-label={text.progress}>
          {text.steps.map((item, index) => (
            <li
              key={item.title}
              className={index === step ? 'welcome-dot welcome-dot-current' : 'welcome-dot'}
              aria-label={item.title}
              aria-current={index === step ? 'step' : undefined}
            />
          ))}
        </ol>
        <div className="welcome-hero">
          <span className="welcome-icon" aria-hidden="true"><current.Icon size={22} strokeWidth={2} /></span>
          <strong>{current.title}</strong>
          <p>{current.body}</p>
          <button type="button" className="text-button welcome-try" onClick={() => onTryIt(current.target)}>{text.tryIt}</button>
        </div>
        <div className="dialog-actions welcome-actions">
          <button type="button" className="button-secondary" onClick={onDismiss}>{text.skip}</button>
          <button type="button" className="cr-button cr-button--primary" onClick={() => (last ? onDismiss() : setStep(step + 1))}>
            {last ? text.getStarted : text.next}
          </button>
        </div>
      </section>
    </div>
  );
}
```

Note: the tour is rendered over the shell, so the base `.overlay` (fixed, dimmed, blurred, grid-centered) provides the scrim — no `.onboarding-scene` here.

- [ ] **Step 4: Add the styles** — in `src/styles.css`, insert after the `.onboarding-boundary { ... }` rule:

```css
/* ---- Welcome tour (existing users, shown once over the shell) ---- */
.welcome-dialog { padding: 30px; }
.welcome-dialog .dialog-header { padding-bottom: 12px; }
.welcome-dialog .dialog-header h1 { margin-block: 14px 6px; font-size: clamp(1.5rem, 4vw, 2rem); letter-spacing: -0.02em; font-weight: 800; }
.welcome-dialog .dialog-header .dialog-intro { margin: 0; }
.welcome-dots { display: flex; justify-content: center; gap: 8px; list-style: none; margin: 18px 0; padding: 0; }
.welcome-dot { inline-size: 8px; block-size: 8px; flex: none; border-radius: var(--cr-radius-full, 999px); background: var(--cr-border, #dde4e1); }
.welcome-dot-current { inline-size: 22px; background: var(--cr-accent-strong, #0d5d48); }
.welcome-hero { display: grid; justify-items: center; gap: 8px; text-align: center; padding: 30px 20px; border: 1px solid var(--cr-border, #dde4e1); border-radius: var(--cr-radius-sm, 12px); background: var(--cr-accent-soft, #e2f2ec); }
.welcome-icon { inline-size: 46px; block-size: 46px; display: grid; place-items: center; border-radius: var(--cr-radius-full, 999px); background: var(--cr-surface, #ffffff); color: var(--cr-accent-strong, #0d5d48); }
.welcome-hero strong { font-size: 16px; }
.welcome-hero p { margin: 0; color: var(--cr-ink-soft, #55605a); line-height: 1.55; max-inline-size: 44ch; }
.welcome-try { min-height: 32px; font-weight: 700; }
.welcome-actions { justify-content: space-between; }
@media (max-width: 700px) {
  .welcome-dialog { padding: var(--cr-space-6, 24px) var(--cr-space-5, 20px); }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test:ui src/features/workspace/welcome-tour.test.tsx`
Expected: PASS (6 tests)

Also run: `pnpm test:ui src/features/workspace` — expected PASS (workspace suite green).

- [ ] **Step 6: Commit**

```bash
git add src/features/workspace/welcome-tour.tsx src/features/workspace/welcome-tour.test.tsx src/styles.css
git commit -m "feat(welcome): add the four-step welcome tour dialog"
```

---

### Task 3: One-shot deep-link plumbing (`pendingSection` + `initialSection`)

**Files:**
- Modify: `src/features/control-room/routes.tsx`
- Modify: `src/features/control-room/manage-screen.tsx`
- Test: `src/features/control-room/manage-screen.test.tsx`

- [ ] **Step 1: Refactor the test helper and write the failing tests** — in `src/features/control-room/manage-screen.test.tsx`, replace the existing `renderManage` function with a props builder plus the same thin wrapper, and add the new tests at the end of the `describe('ManageScreen section menu')` block:

```tsx
function manageProps(extra: Partial<Parameters<typeof ControlRoomRoutes>[0]> = {}) {
  return {
    locale: 'en' as const,
    spaceId: 'personal-space',
    spaceKind: 'personal' as const,
    destination: 'manage' as const,
    gateways: gateways(),
    recordOpen: false,
    onCloseRecord: () => undefined,
    userId: householdOwnerId,
    spaceName: 'Test space',
    userEmail: 'dana@example.com',
    onLocaleChange: () => undefined,
    onSignOut: () => undefined,
    ...extra,
  };
}

function renderManage(extra: Partial<Parameters<typeof ControlRoomRoutes>[0]> = {}) {
  return render(<ControlRoomRoutes {...manageProps(extra)} />);
}
```

New tests:

```tsx
  it('opens directly on the section a deep link asks for', () => {
    renderManage({ pendingSection: 'household' });
    expect(screen.getByRole('button', { name: 'Back to manage sections' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Manage sections' })).not.toBeInTheDocument();
  });

  it('applies a pending section that arrives while Manage is already open', () => {
    const view = render(<ControlRoomRoutes {...manageProps()} />);
    expect(screen.getByRole('navigation', { name: 'Manage sections' })).toBeInTheDocument();

    view.rerender(<ControlRoomRoutes {...manageProps({ pendingSection: 'household' })} />);
    expect(screen.getByRole('button', { name: 'Back to manage sections' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:ui src/features/control-room/manage-screen.test.tsx`
Expected: FAIL — `Object literal may only specify known properties, 'pendingSection' does not exist...`

- [ ] **Step 3: Implement in `manage-screen.tsx`**

Change the React import to include `useEffect`:

```tsx
import { useEffect, useId, useState, type ReactNode } from 'react';
```

Add to `ManageScreenProps` (after `walletState`):

```ts
  /** One-shot deep link: opens this section instead of the hub, and applies
   *  it again if the value changes while Manage is already mounted. */
  initialSection?: ManageSection | undefined;
```

Replace the `section` state line:

```tsx
  const [section, setSection] = useState<ManageSection | null>(props.initialSection ?? null);
  useEffect(() => {
    if (props.initialSection) setSection(props.initialSection);
  }, [props.initialSection]);
```

(The mount read covers a destination change; the effect covers a deep link that lands while Manage is already open — the replay-tour case.)

- [ ] **Step 4: Implement in `routes.tsx`**

1. Export the section type (line 572):

```ts
export type PlanSection = 'plan' | 'allocation' | 'goals' | 'cash' | 'bills' | 'loans';
```

2. Import `ManageSection` — change the `ManageScreen` import to:

```tsx
import { ManageScreen, type ManageSection } from './manage-screen.js';
```

3. Add to `ControlRoomRoutesProps` (after `onOpenRecord?(): void;`):

```ts
  /** One-shot section the welcome tour deep-links into; consumed when the
   *  destination screen mounts (the tour always leaves `home` for a plan or
   *  manage destination, so a fresh mount is guaranteed). */
  pendingSection?: PlanSection | ManageSection | null;
```

4. Add the type guards right after the `ControlRoomRoutesProps` interface:

```ts
const MANAGE_SECTIONS: readonly ManageSection[] = ['wallets', 'categories', 'household', 'phone'];

function isPlanSection(value: PlanSection | ManageSection): value is PlanSection {
  return PLAN_SECTIONS.some((item) => item.id === value);
}

function isManageSection(value: PlanSection | ManageSection): value is ManageSection {
  return (MANAGE_SECTIONS as readonly string[]).includes(value);
}
```

5. Derive the pending plan section — add directly after the existing `planEntrySection` reset effect (line ~805):

```ts
  const pendingPlanSection = props.pendingSection && isPlanSection(props.pendingSection) ? props.pendingSection : null;
```

6. In the `case 'plan'` render, change:

```tsx
          initialSection={pendingPlanSection ?? planEntrySection}
```

7. In the `case 'manage'` render of `<ManageScreen ... />`, add:

```tsx
          initialSection={props.pendingSection && isManageSection(props.pendingSection) ? props.pendingSection : undefined}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test:ui src/features/control-room/manage-screen.test.tsx`
Expected: PASS (all, including the 2 new deep-link tests)

Run: `pnpm test:ui src/features/control-room/routes.test.tsx`
Expected: PASS (no regressions — `pendingSection` is optional).

- [ ] **Step 6: Commit**

```bash
git add src/features/control-room/routes.tsx src/features/control-room/manage-screen.tsx src/features/control-room/manage-screen.test.tsx
git commit -m "feat(control-room): accept a one-shot pending section for deep links"
```

---

### Task 4: Replay row in Manage > Preferences

**Files:**
- Modify: `src/features/control-room/manage-screen.tsx`
- Modify: `src/features/control-room/routes.tsx`
- Test: `src/features/control-room/manage-screen.test.tsx`

- [ ] **Step 1: Write the failing test** — append to the `describe('ManageScreen section menu')` block:

```tsx
  it('offers the welcome tour replay from Preferences', async () => {
    const user = userEvent.setup();
    const onReplayWelcome = vi.fn();
    renderManage({ onReplayWelcome });

    await user.click(screen.getByRole('button', { name: /Replay welcome tour/ }));
    expect(onReplayWelcome).toHaveBeenCalledOnce();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:ui src/features/control-room/manage-screen.test.tsx`
Expected: FAIL — no button named `/Replay welcome tour/`.

- [ ] **Step 3: Implement the row** — in `manage-screen.tsx`:

Add `RotateCcw` to the lucide import:

```tsx
import { ChevronLeft, ChevronRight, Globe, LogOut, Mail, RotateCcw, Smartphone, Tags, Users, Wallet } from 'lucide-react';
```

Add to `ManageScreenProps` (after `onSignOut`):

```ts
  /** Manage > Preferences: replays the welcome tour. Present whenever the
   *  app wires it (always, in `app.tsx`). */
  onReplayWelcome?: (() => void) | undefined;
```

In the Preferences group, after the "Add from your phone" `ManageHubRow`, add:

```tsx
            {props.onReplayWelcome ? (
              <ManageHubRow
                name={t(locale, 'Replay welcome tour', 'إعادة عرض الجولة الترحيبية')}
                description={t(locale, 'See the welcome introduction again', 'شاهد مقدمة الترحيب مرة أخرى')}
                icon={<RotateCcw size={19} strokeWidth={2} />}
                trail={locale === 'ar' ? <ChevronLeft aria-hidden size={18} /> : <ChevronRight aria-hidden size={18} />}
                onClick={props.onReplayWelcome}
              />
            ) : null}
```

Thread it in `routes.tsx` — add to `ControlRoomRoutesProps` (after `onSignOut?(): void;`):

```ts
  /** Wires Manage > Preferences' "Replay welcome tour" row. */
  onReplayWelcome?(): void;
```

and pass it to `<ManageScreen ... />` (next to `onSignOut`):

```tsx
          onReplayWelcome={props.onReplayWelcome}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:ui src/features/control-room/manage-screen.test.tsx`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add src/features/control-room/manage-screen.tsx src/features/control-room/routes.tsx src/features/control-room/manage-screen.test.tsx
git commit -m "feat(manage): add the replay welcome tour preference row"
```

---

### Task 5: app.tsx integration (render, precedence, intents) + test seeding

**Files:**
- Modify: `src/app.tsx`
- Test: `src/app.test.tsx`

- [ ] **Step 1: Update `renderApp` and seed existing tests** — in `src/app.test.tsx`:

Add `beforeEach` to the vitest import (line 3):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
```

Add a helper after `renderApp`'s `unconfiguredPlanClient` helper:

```ts
function seedWelcomeSeen(userId = 'user-1') {
  localStorage.setItem(`budget:welcome-seen:${userId}`, '1');
}
```

Replace `renderApp` with an options-aware version (the tour is opt-in for tests, so every existing test keeps its current behavior):

```ts
function renderApp(props: Parameters<typeof App>[0] = {}, options: { allowWelcomeTour?: boolean } = {}) {
  if (!options.allowWelcomeTour) seedWelcomeSeen();
  return render(<App
    authGateway={authGateway({ id: 'user-1', email: 'owner@example.com' })}
    workspaceGateway={workspaceGateway()}
    householdGateway={new InMemoryHouseholdGateway()}
    loansGateway={new InMemoryLoansGateway()}
    walletsGateway={new InMemoryWalletsGateway()}
    categoriesGateway={new InMemoryCategoriesGateway()}
    planClient={unconfiguredPlanClient()}
    {...props}
  />);
}
```

Two existing tests pass their own auth user — seed those explicitly at the top of the test body:

- `keeps the shell stable when switching from a household space to a personal space`: add `seedWelcomeSeen(householdOwnerId);` before `render(<App ...`.
- `accepts a fragment invitation before no-space onboarding and selects the new household`: add `seedWelcomeSeen(householdMemberId);` before its `render(<App ...`.

(Both keep their assertions unchanged; seeding only prevents the tour from appearing over the shell they are asserting about.)

- [ ] **Step 2: Run the existing suite to confirm no regressions**

Run: `pnpm test:ui src/app.test.tsx`
Expected: PASS (all existing tests still green — at this point the tour is never rendered by `app.tsx`, so seeding is a no-op; this step proves the helper refactor broke nothing).

- [ ] **Step 3: Write the failing integration tests** — append a new describe block at the end of `src/app.test.tsx`:

```tsx
describe('App welcome tour', () => {
  // Earlier tests in this file (and earlier cases in this block) can leave the
  // flag behind; each tour test starts from a clean "never seen" state.
  beforeEach(() => localStorage.removeItem('budget:welcome-seen:user-1'));

  it('shows the tour once over the shell and never again after dismissal', async () => {
    const user = userEvent.setup();
    const view = renderApp({}, { allowWelcomeTour: true });
    const tour = await screen.findByRole('dialog', { name: 'Welcome back!' });
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();

    await user.click(within(tour).getByRole('button', { name: 'Skip tour' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Welcome back!' })).not.toBeInTheDocument());
    expect(localStorage.getItem('budget:welcome-seen:user-1')).toBe('1');

    view.unmount();
    renderApp({}, { allowWelcomeTour: true });
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Welcome back!' })).not.toBeInTheDocument();
  });

  it('opens the record sheet from the Quick add step', async () => {
    const user = userEvent.setup();
    renderApp({}, { allowWelcomeTour: true });
    const tour = await screen.findByRole('dialog', { name: 'Welcome back!' });

    await user.click(within(tour).getByRole('button', { name: 'Try it →' }));
    expect(await screen.findByRole('dialog', { name: 'Record', exact: true })).toBeInTheDocument();
    expect(localStorage.getItem('budget:welcome-seen:user-1')).toBe('1');
  });

  it('deep-links into Plan goals from the third step', async () => {
    const user = userEvent.setup();
    renderApp({}, { allowWelcomeTour: true });
    const tour = await screen.findByRole('dialog', { name: 'Welcome back!' });

    await user.click(within(tour).getByRole('button', { name: 'Next' }));
    await user.click(within(tour).getByRole('button', { name: 'Next' }));
    await user.click(within(tour).getByRole('button', { name: 'Try it →' }));

    expect(screen.getAllByRole('button', { name: 'Plan' })[0]).toHaveAttribute('aria-current', 'page');
    const sections = await screen.findByRole('navigation', { name: 'Plan sections' });
    expect(within(sections).getByRole('button', { name: 'Goals' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('replays the tour from Manage preferences and deep-links into Household', async () => {
    const user = userEvent.setup();
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Welcome back!' })).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Manage' })[0]!);
    await user.click(await screen.findByRole('button', { name: /Replay welcome tour/ }));
    const tour = await screen.findByRole('dialog', { name: 'Welcome back!' });

    await user.click(within(tour).getByRole('button', { name: 'Next' }));
    await user.click(within(tour).getByRole('button', { name: 'Next' }));
    await user.click(within(tour).getByRole('button', { name: 'Next' }));
    await user.click(within(tour).getByRole('button', { name: 'Try it →' }));

    expect(await screen.findByRole('button', { name: 'Back to manage sections' })).toBeInTheDocument();
  });

  it('defers the tour when a quick-add link opens the app', async () => {
    window.history.replaceState(null, '', '/?add=expense');
    try {
      renderApp({}, { allowWelcomeTour: true });
      expect(await screen.findByRole('dialog', { name: 'Record', exact: true })).toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: 'Welcome back!' })).not.toBeInTheDocument();
      expect(localStorage.getItem('budget:welcome-seen:user-1')).toBeNull();
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm test:ui src/app.test.tsx`
Expected: FAIL — no `dialog` named `Welcome back!` (the tour is not rendered yet).

- [ ] **Step 5: Wire `src/app.tsx`**

1. Add the import next to the other workspace imports:

```tsx
import { WelcomeTourDialog, type WelcomeTarget } from './features/workspace/welcome-tour.js';
```

2. In `AuthenticatedWorkspace`, add state right after the `pendingQuickAdd` declaration (the quick-add intent from the URL, line ~142):

```tsx
  // A quick-add link owns this app open: the tour waits for the next one.
  const [tourSuppressed, setTourSuppressed] = useState(() => pendingQuickAdd !== null);
  // One-shot deep link for the tour's Try it (goals / household).
  const [pendingSection, setPendingSection] = useState<'goals' | 'household' | null>(null);
  const navigateTo = useCallback((destination: ControlRoomDestination) => {
    setActiveDestination(destination);
    setPendingSection(null);
  }, []);
  const onWelcomeTryIt = useCallback((target: WelcomeTarget) => {
    workspace.dismissWelcome();
    if (target === 'record') {
      setRecordInitialKind('expense');
      setRecordOpen(true);
      return;
    }
    if (target === 'reports') {
      navigateTo('home');
      return;
    }
    // navigateTo clears first; the section is set after, in the same batch.
    navigateTo(target === 'goals' ? 'plan' : 'manage');
    setPendingSection(target);
  }, [navigateTo, workspace.dismissWelcome]);
```

3. On `<ControlRoomRoutes ... />` (line ~252), replace `onDestinationChange={setActiveDestination}` with:

```tsx
      onDestinationChange={navigateTo}
      pendingSection={pendingSection}
      onReplayWelcome={() => {
        setTourSuppressed(false);
        workspace.replayWelcome();
      }}
```

4. In the shell fragment (`return <>` at line ~222), add the tour next to the `addingSpace` block (it overlays the shell; `.overlay` is position:fixed, so JSX order is irrelevant):

```tsx
    {workspace.showWelcome && !tourSuppressed ? (
      <WelcomeTourDialog
        locale={props.locale}
        onDismiss={workspace.dismissWelcome}
        onTryIt={onWelcomeTryIt}
      />
    ) : null}
```

Note on precedence: the household-acceptance branch and the `empty`/`onboarding` branches return before this fragment, so the invitation dialog and the first-run wizard always win — no extra guards needed.

- [ ] **Step 6: Run the full app test file**

Run: `pnpm test:ui src/app.test.tsx`
Expected: PASS (old + 5 new tests).

- [ ] **Step 7: Run the whole unit suite**

Run: `pnpm test:ui`
Expected: PASS — if other files render `App`, seed them the same way (search for `renderApp` / `from './app.js'`; none are expected).

- [ ] **Step 8: Commit**

```bash
git add src/app.tsx src/app.test.tsx
git commit -m "feat(welcome): show the tour over the shell with quick-add precedence"
```

---

### Task 6: e2e fixture seeding + visual test

**Files:**
- Modify: `e2e/fixtures/loans.ts`
- Modify: `e2e/fixtures/household.ts`
- Modify: `e2e/application.visual.spec.ts`

- [ ] **Step 1: Seed the flag in the application fixture** — in `e2e/fixtures/loans.ts`:

Add to `ApplicationFixtureOptions` (after `failAvailableCashSummaryOnce?: boolean;`):

```ts
  /** Leave `budget:welcome-seen:visual-user` unset so the existing-user welcome
   *  tour appears. The flag is seeded as seen by default so every other spec
   *  keeps its current behavior; a fresh Playwright context starts with empty
   *  storage, so this branch simply never writes the key (dismissals during the
   *  test still persist across reloads). */
  showWelcomeTour?: boolean;
```

Replace the auth init script (line 363):

```ts
    await page.addInitScript((value) => localStorage.setItem('sb-127-auth-token', JSON.stringify(value)), authSession());
```

with:

```ts
    await page.addInitScript((value: { session: unknown; welcomeTour: boolean }) => {
      localStorage.setItem('sb-127-auth-token', JSON.stringify(value.session));
      if (!value.welcomeTour) localStorage.setItem('budget:welcome-seen:visual-user', '1');
    }, { session: authSession(), welcomeTour: options.showWelcomeTour ?? false });
```

- [ ] **Step 2: Seed the household fixture** — in `e2e/fixtures/household.ts`, after the existing auth init script (line 127), add:

```ts
    await page.addInitScript((userId) => localStorage.setItem(`budget:welcome-seen:${userId}`, '1'), OWNER_ID);
```

(`OWNER_ID` is defined at the top of the same file; if it is not exported, that is fine — the init script lives in this module.)

- [ ] **Step 3: Write the failing visual test** — append to `e2e/application.visual.spec.ts`:

```ts
test('existing user sees the welcome tour once, then never again', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await installApplicationFixture(page, { showWelcomeTour: true });
  await page.goto('/');
  const tour = page.getByRole('dialog', { name: 'Welcome back!' });
  await expect(tour).toBeVisible();
  await expect(tour.getByText('Four quick things that make budgeting easier. 1 of 4.')).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, `welcome-tour-${testInfo.project.name}.png`), fullPage: true });

  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour.getByText('Four quick things that make budgeting easier. 2 of 4.')).toBeVisible();
  await tour.getByRole('button', { name: 'Skip tour' }).click();
  await expect(tour).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Welcome back!' })).toHaveCount(0);
});
```

- [ ] **Step 4: Run the e2e suite**

Run: `pnpm test:e2e`
Expected: PASS — all specs (the flag seeding keeps every other spec tour-free; Playwright's config starts the dev server itself).

- [ ] **Step 5: Write the visual artifact and commit**

Run: `UPDATE_VISUAL_ARTIFACTS=1 pnpm test:e2e e2e/application.visual.spec.ts`
Expected: PASS; creates `artifacts/application-shell/welcome-tour-desktop.png`.

```bash
git add e2e/fixtures/loans.ts e2e/fixtures/household.ts e2e/application.visual.spec.ts artifacts/application-shell/welcome-tour-desktop.png
git commit -m "test(e2e): cover the existing-user welcome tour and its replay"
```

---

### Task 7: Verification evidence + full checks

**Files:**
- Create: `docs/verification/2026-09-29-welcome-tour.md`

- [ ] **Step 1: Run the full checks**

Run: `pnpm typecheck && pnpm test:ui && pnpm build`
Expected: all PASS (this is the `check:ui` pipeline). If typecheck or lint-free build reports issues, fix them before continuing — do not commit broken code.

- [ ] **Step 2: Record the evidence** — create `docs/verification/2026-09-29-welcome-tour.md`:

```markdown
# Welcome tour for existing users (2026-09-29)

Design: `docs/superpowers/specs/2026-09-29-existing-user-welcome-tour-design.md`.

## What shipped

- One-time 4-step welcome tour over the Control Room for users with spaces
  (flag `budget:welcome-seen:<userId>`; first-run completion writes it, so new
  users skip the tour).
- "Try it" deep links: record sheet (expense), Home (reports), Plan > Goals,
  Manage > Household via the one-shot `pendingSection` plumbing.
- Quick-add links (`/?add=expense`) take precedence for that app open.
- Manage > Preferences: "Replay welcome tour" re-opens it on demand.

## Evidence

- `pnpm typecheck` — pass
- `pnpm test:ui` — pass (welcome-tour, use-workspace, manage-screen, app suites)
- `pnpm build` — pass
- `pnpm test:e2e` — pass; screenshot `artifacts/application-shell/welcome-tour-desktop.png`
```

(Adjust the evidence list to the commands actually run and their real results — never record a check that was not executed.)

- [ ] **Step 3: Commit**

```bash
git add docs/verification/2026-09-29-welcome-tour.md
git commit -m "docs(verification): record the welcome tour evidence"
```

---

## Self-review notes (already applied)

- Spec coverage: gating (T1), dialog + a11y + EN/AR + responsive (T2), deep links goals/household (T3), replay row (T4), integration + precedence + focus restore via component (T5), e2e + artifact (T6), verification doc (T7).
- Type consistency: `WelcomeTarget` ('record' | 'reports' | 'goals' | 'household') matches across T2/T5; `pendingSection?: PlanSection | ManageSection | null` matches T3 producer/consumer; `showWelcome`/`dismissWelcome`/`replayWelcome` names identical T1/T5.
- One known spec deviation, deliberate: the spec's `replayWelcome()` "does not touch the flag" — implemented exactly so; the flag is written only by dismissal and first-run completion.
