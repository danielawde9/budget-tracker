# Existing-user welcome tour design

## Status and scope

Today the onboarding dialog (`src/features/workspace/onboarding-dialog.tsx`)
only appears when a person has zero spaces or an unfinished first-run setup.
An existing user — anyone with at least one space and no stored progress —
lands directly in the Control Room with no introduction. This design adds a
one-time welcome tour for those users.

Client-only change: one new dialog component, one new localStorage flag, small
wiring in `app.tsx`, and one small deep-link plumbing addition in the manage
screen. No SQL, RLS, command, trigger, or financial calculation changes, and no
changes to the first-run `OnboardingDialog`.

Decisions already made with the product owner:

- The tour is a step-by-step walkthrough (layout B from the reviewed mockup),
  not an all-at-once overview grid.
- It targets existing users only. Brand-new users who complete the first-run
  wizard never see it.
- Every tour step carries a deep link into the feature it describes.
- Once shown, it never shows again (localStorage, per user).

## Experience

A modal dialog rendered on top of the already-loaded Control Room. The shell
stays visible behind a scrim; the wizard's photographic backdrop scene is not
used — the user's own data is the context. Four steps, each with a hero card,
progress dots, and EN/AR copy:

| # | Step | "Try it" target |
|---|------|-----------------|
| 1 | Quick add — record an expense or income in seconds | record sheet, opened on expense |
| 2 | Reports & insights — see where your money goes | `home` destination (reports/insights live there) |
| 3 | Recurring & goals — automate bills, save toward purchases | `plan` destination, `goals` section |
| 4 | Household — invite the people you live with | `manage` destination, `household` section |

Controls per step:

- Primary: **Next** on steps 1–3, **Get started** on step 4.
- Ghost: **Skip tour** (all steps).
- Hero link: **Try it →** (all steps) — dismisses the tour and navigates.

Every exit path — Next/Get started, Skip, Escape, or Try it — marks the tour
seen. Closing mid-tour counts as seen; there is no resume and no second
chance. The tour always starts at step 1; step progress is never persisted.

Precedence: if the app opened on a quick-add link (`/?add=expense`), the record
sheet wins and the tour is suppressed for that entire app open — it does not
appear after the sheet closes either. The flag is untouched by this deferral,
so the next app open shows the tour.

## Gating and lifecycle

New helper module `src/features/workspace/welcome-seen.ts`:

```ts
welcomeSeenKey(userId): string   // `budget:welcome-seen:<userId>`
readWelcomeSeen(userId): boolean
writeWelcomeSeen(userId): void   // stores the literal '1'
```

Follows the `onboarding-progress.ts` pattern (per-user localStorage key, no
server involvement). A plain marker string; no versioning (YAGNI — a future
"welcome v2" can rename the key).

`useWorkspace` grows two things:

- `showWelcome: boolean` — set during `load()` when the workspace reaches
  `ready` and `readWelcomeSeen(userId)` is false. False in every other status.
- `dismissWelcome()` — writes the flag and flips `showWelcome` off.

The flag is written from exactly two places:

1. `dismissWelcome()` — any tour exit path.
2. `finishOnboarding()` — so a person who completes the first-run wizard is
   marked seen and never gets the tour. `finishOnboarding` runs on first-run
   completion only; an existing user's normal load never calls it.

Consequences, all intentional:

- Existing user, flag absent → tour shows on next app open, then never again.
- Brand-new user → wizard completes → flag written → no tour.
- Existing user on a fresh browser (no localStorage) → tour shows once there.
- Household invitee (new account inheriting a space) → has spaces, skipped the
  wizard, flag absent → sees the tour. They otherwise get no introduction, so
  this is desired.
- User mid-first-run (stored progress) → resumes the wizard first; completion
  writes the flag, so they skip the tour too.

## Deep-link plumbing

`WelcomeTourDialog` never navigates itself. It emits one of:

```ts
type WelcomeTarget = 'record' | 'reports' | 'goals' | 'household';
```

`app.tsx` maps targets to existing machinery:

- `record` — `setRecordInitialKind('expense'); setRecordOpen(true)` (the
  existing quick-add/record-sheet path).
- `reports` — `setActiveDestination('home')`.
- `goals` — `setActiveDestination('plan')` plus the existing one-shot
  `planEntrySection` mechanism in `routes.tsx`: set the entry section, then
  switch destination, so `PlanScreen` mounts with `initialSection='goals'`.
  The tour always starts from `home`, so Plan is not already mounted and the
  remount is guaranteed.
- `household` — `setActiveDestination('manage')` plus a new one-shot intent:
  `ManageScreen` gains an optional `initialSection?: ManageSection` prop
  (`useState(initialSection ?? null)` instead of always `null`), passed
  through a new optional prop on `ControlRoomRoutes`. Same mount-time contract
  as the plan path.

The intent prop is consumed once at mount; there is no URL/routing change.

## Components and files

- **New** `src/features/workspace/welcome-tour.tsx` — `WelcomeTourDialog`:

  ```ts
  interface WelcomeTourProps {
    locale: Locale;
    onDismiss(): void;                      // Get started, Skip, Escape
    onTryIt(target: WelcomeTarget): void;   // hero link
  }
  ```

  Single-purpose; it does not touch `OnboardingDialog`. Reuses the existing
  `overlay`/`dialog` classes and copy-bundle pattern (`copy.en` / `copy.ar`),
  with a small styles addition for the hero card and progress dots. Internal
  state: current step only (0–3).
- **New** `src/features/workspace/welcome-seen.ts` — flag helpers above.
- **Modified** `src/features/workspace/use-workspace.ts` — `showWelcome`,
  `dismissWelcome`, flag write in `finishOnboarding`.
- **Modified** `src/app.tsx` — render the dialog over the shell when
  `workspace.showWelcome`, map `onTryIt` to intents, quick-add precedence.
- **Modified** `src/features/control-room/routes.tsx` and
  `manage-screen.tsx` — one-shot `initialSection` plumbing for manage.
- **Modified** `src/styles.css` — tour-specific rules alongside the existing
  onboarding block.

Rendering condition sits in the main shell branch of `AuthenticatedWorkspace`,
after the `showAcceptance` early return, so a pending household-invitation
acceptance dialog always takes precedence over the tour.

## Accessibility and responsive

Same contract as the setup dialog: `role="dialog"`, `aria-modal="true"`,
focus moved into the dialog on open and on every step change, Tab/Shift+Tab
focus trap, Escape dismisses (counts as seen). Progress dots are a labeled
list with `aria-current="step"` on the active dot and a step counter in the
intro text ("1 of 4"). On close, focus returns to the element focused before
the dialog opened (or `document.body`). All strings live in the EN/AR copy
bundles; the dialog honors RTL. At ≤700px the dialog uses the wizard's
compact padding and the hero card stacks above the controls.

## Testing

- `welcome-tour.test.tsx` — renders step 1 in EN and AR; Next cycles 1→4 and
  the primary label becomes "Get started" on step 4; Skip/Escape call
  `onDismiss`; each hero link calls `onTryIt` with the right target; dots
  reflect the active step; focus lands in the dialog.
- `use-workspace.test.tsx` — existing user without the flag gets
  `showWelcome: true` at `ready`; with the flag, false; `dismissWelcome()`
  persists; `finishOnboarding()` writes the flag (new-user skip); never true
  in `loading`/`empty`/`onboarding`/`error`.
- `src/app.test.tsx` integration — tour renders over the shell for a seeded
  existing user; Try it on step 1 opens the record sheet;
  after dismissal a remount does not show it again.
- Manage deep link — `ManageScreen` opens directly on `household` when
  `initialSection` is passed.
- e2e — one screenshot in `e2e/application.visual.spec.ts` matching the
  existing onboarding baselines under `artifacts/application-shell/`.

## Conventions and out of scope

- Record evidence in `docs/verification/` following the existing
  `*-onboarding-fixes.md` pattern; visual baselines land with the e2e run.
- Out of scope: replaying the tour from a menu, server-side flag, versioned
  re-shows, URL routing for sections, coach-marks anchored to live UI, and any
  change to the first-run wizard.
