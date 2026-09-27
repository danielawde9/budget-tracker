# W2C UI audit fixes (Rank 13 / D13 / E3 / F11)

**Date:** 2026-09-27. **Worktree:** `/Users/daniel/Desktop/Daniel/budget-tracking/.worktrees/w2c-ui-audit`
**Branch:** `ws/w2c-ui-audit`. **Method:** TDD (red reproducer first, then fix), per
`docs/verification/2026-09-25-linking-audit.md` §3.4–3.6 and `docs/decisions.md`.

**Scope:** exactly four audit items. No SQL applied, nothing pushed, no full Playwright
suite run. Owned paths only; `routes.tsx` was read but not edited.

## Test-command note (read first)

`pnpm exec vitest run <files>` as written in the task uses the repo **default**
`vitest.config.ts`, whose `exclude` list contains `**/.worktrees/**`. Running it from
inside this worktree therefore matches no jsdom tests and reports every test in the file
as failed for lack of a DOM (`environment: 'node'`). The correct command is the one
`pnpm test:ui` / `pnpm check:ui` already use:

```
pnpm exec vitest run --config vitest.ui.config.ts <files>
```

Both the literal command and the corrected command are recorded below. The authoritative
gate is `pnpm check:ui`, which passed.

## Baseline (before changes) — red

Command:

```
pnpm exec vitest run --config vitest.ui.config.ts \
  src/features/loans/use-loans.test.tsx \
  src/features/recurring/schedule-editor.test.tsx \
  src/features/cash-control/cash-control-summary.test.tsx \
  src/features/control-room/record-sheet.test.tsx
```

Result (excerpt): `Test Files 4 failed (4)` / `Tests 7 failed | 119 passed (126)` — the 7
failures were exactly the newly authored assertions:

- `use-loans.test.tsx` — 2 (`loads the caller-selected month…`, `reloads when the caller-selected month changes`).
- `schedule-editor.test.tsx` — 1 (`blocks the Details step with an out-of-range repeat interval`, `Received: max="99"`).
- `cash-control-summary.test.tsx` — 1 (expected `Budgets and bills (net of goal cover)`).
- `record-sheet.test.tsx` — 3 (two date-cap tests, one silent category-create failure).

## 1. Rank 13 (E4 / A8 / B13) — Plan "Loan commitments" ignores the selected month

**Finding.** `useLoans` kept its own UTC `currentMonth()` default; `routes.tsx` wires the
hook without a month (`routes.tsx:779`), so the Plan page's loans summary/rows
(`routes.tsx:613-614` → `PlanPage.loanRows`/`loansSummary`) were loaded for the current
UTC month regardless of the month picker. It is `Traced (×3)`, so a reproducer was
required.

**Change.** The hook now accepts an optional controlled `month`, mirroring the existing
controlled `spaceId`:

- `src/features/loans/use-loans.ts` — added `normalizeMonth`, `month?: string` on
  `UseLoansOptions`, renamed internal state to `internalMonth`, derived
  `month = monthOption !== undefined ? normalizeMonth(monthOption) : internalMonth`, and
  made `setMonth` a no-op when the caller owns the month. The existing
  `loadDashboard(spaceId, month)` effect already re-runs on `month` change, so the
  dashboard follows a changed month.

**Test.** `src/features/loans/use-loans.test.tsx` — two new tests proving `loadDashboard`
is called with the selected month (`2026-08-01`) and reloads on change (`2026-07-01`),
and that `result.current.month` reflects the option.

**Wiring the coordinator must apply (NOT applied — `routes.tsx` is off-limits).**
`month` is already in scope at `routes.tsx:779` (declared `routes.tsx:727`). Add it to the
`useLoans` options object:

```tsx
  const loans = useLoans(gateways.loans, {
    spaceId,
    month,
    ...(props.onSpaceUnavailable ? { onSpaceUnavailable: props.onSpaceUnavailable } : {}),
    onRepaymentRecorded,
  });
```

The single line to insert (after `spaceId,`) is:

```tsx
    month,
```

Until this line lands, the Plan "Loan commitments" card still loads the hook's default
UTC month; the hook side is complete and tested.

## 2. D13 — schedule interval 1–99 vs SQL 1–12, and the "Unpaid bills" label

**Finding.** `recurring_schedules.interval_count` CHECK is 1–12
(`M/20260914170000_recurring_schedules.sql:30`); the editor allowed 1–99
(`schedule-editor.tsx:206,337`). The cash summary line labelled "Unpaid bills (net of goal
cover)" renders `expenseCommitmentsMinor`, which the SQL defines as
`Σ bucket max(budget_remaining, unpaid_bills) − goal overlap`
(`M/20260914180000_available_cash_projection.sql:381-382`, `planning_expense_buckets`) —
so the label hid the budget term.

**Changes.**
- `src/features/recurring/schedule-editor.tsx` — `max={12}` on the interval input; gate
  `intervalCount > 12`; message "…from 1 to 12." (EN + AR).
- `src/features/cash-control/cash-control-summary.tsx` — label →
  `Budgets and bills (net of goal cover)` / `الميزانيات والفواتير (بعد تغطية الهدف)`.

**Tests.** `schedule-editor.test.tsx` — the out-of-range test now asserts `max="12"` and
that `13` is rejected with the 1–12 message. `cash-control-summary.test.tsx` — asserts the
new label and `not.toHaveTextContent('Unpaid bills')`.

`commitment-breakdown.tsx`'s "Unpaid bills" column is unchanged: it renders
`group.unpaidBillsMinor`, which really is unpaid bills only. The e2e specs contain no
assertions on either string (grepped `e2e/`).

## 3. E3 — future-dated entries and a date input with no `max`

**Finding.** `wallet_balances` counts future-dated events in Net position, but cash /
Available use `(now() at time zone 'UTC')::date`; the Record sheet's effective-date input
had no upper bound, inviting a date the model cannot represent consistently.

**Change.** `src/features/control-room/record-sheet.tsx`:
- `max={todayLocal()}` on both effective-date inputs (desktop details step and the compact
  mobile form). `todayLocal()` is the sheet's own date basis and its default, so the
  default is never out of range.
- A submit-time guard `if (effectiveDate > todayLocal())` sets a localized error
  (`Choose a date today or earlier.` / `اختر تاريخًا اليوم أو في تاريخ أقدم.`). This is
  defense-in-depth: native constraint validation already blocks an out-of-range value from
  a `<form>` submit (the compact form); the desktop Confirm button is a plain button, so
  the guard is what stops it there.

**Tests.** `record-sheet.test.tsx` — `max` attribute equals today on the desktop details
step and the mobile form; and a future-dated desktop save shows the alert and never calls
`onSubmitRecord`. (The first draft tried to assert the alert via the mobile form's submit;
native validation correctly blocked the submit before the guard, so the alert test was
moved to the desktop Confirm path.)

**Justified bound.** `todayLocal()` (browser-local today), not UTC today: the sheet's
default is local, so a UTC max would mark the default invalid in positive-offset zones
(e.g. Beirut after 21:00 UTC). See limitations.

## 4. F11 — creating a category from the Record sheet failed silently

**Finding.** `createAndSelectCategory` (`record-sheet.tsx:677-700`) had `try/finally` but
no `catch`, so a rejected `onCreateCategory` became an unhandled promise rejection with no
user feedback.

**Change.** `record-sheet.tsx` — added `createError` state, cleared on reset and on name
edits; wrapped the create call in `catch` and rendered the failure with the shared
category error/i18n pattern (`classifyCategoryError` → `localizeCategoryError` from
`src/features/categories/errors.ts`) as a `role="alert"` in the create form. The form
stays open so the user can correct the name and retry.

**Test.** `record-sheet.test.tsx` — a rejected create now surfaces
"An active category already uses one of these names." (via the `duplicate_name` classifier)
and leaves "Create & select" available; no unhandled rejection.

## Green — targeted tests

```
pnpm exec vitest run --config vitest.ui.config.ts \
  src/features/loans/use-loans.test.tsx \
  src/features/recurring/schedule-editor.test.tsx \
  src/features/cash-control/cash-control-summary.test.tsx \
  src/features/control-room/record-sheet.test.tsx
```

Result: `Test Files 4 passed (4)` / `Tests 127 passed (127)`.
(use-loans 47, record-sheet 49, cash-control-summary 17, schedule-editor 14.)

### Literal command, for completeness

```
pnpm exec vitest run src/features/loans/use-loans.test.tsx
```

Result: `Test Files 1 failed (1)` / `Tests 47 failed (47)` — because the default
`vitest.config.ts` excludes `**/.worktrees/**` and runs `environment: 'node'`. This is a
configuration/environment result, not a code result; the `--config vitest.ui.config.ts`
run above and `pnpm check:ui` are the meaningful evidence. It is recorded here rather than
claimed as a pass.

## `pnpm check:ui`

```
pnpm check:ui
```

(`typecheck` = `check:worker-types && tsc --noEmit && tsc -p tsconfig.worker.json`;
`test:ui` = `vitest run --config vitest.ui.config.ts`; `build` = `tsc --noEmit && vite build`.)

Result: **pass**.

- `Test Files 104 passed (104)` / `Tests 1354 passed (1354)` (37.66s).
- `$ tsc --noEmit && vite build` → `✓ 2046 modules transformed` / `✓ built in 1.05s`.

## Wiring not applied

`src/features/control-room/routes.tsx` (off-limits) — the one-line `month,` addition to the
`useLoans` options shown in item 1. Everything else for all four items is applied.

## Remaining limitations / notes

- **Item 1** is not user-visible until the coordinator applies the `routes.tsx` one-liner.
  The hook change is backward compatible: callers that omit `month` keep today's behavior.
- **E3 bound is local, not UTC.** The exact audit concern is the model's UTC "cash to
  today" boundary. Capping at `todayLocal()` prevents clearly future dates but leaves at
  most a one-day window in positive-offset zones where a local "today" is still ahead of
  UTC today (the separate two-clock finding E1, `§1 rank 11`). Aligning the sheet on UTC
  would change its recorded-date default and belongs to E1, not this packet.
- **E3 guard placement.** For `<form>` submits the native `max` blocks first; the
  app-level guard covers the desktop Confirm button and any non-validating path. No test
  asserts the native-validation block itself.
- **F11 message copy** is the category classifier's existing text; the Record sheet shows
  `message` + `recovery` concatenated, matching `SubcategoryDialog.errorCopy`. There is no
  dedicated "retry unchanged request" affordance for the category create (it is a single
  non-idempotent-by-name command); the user retries by re-clicking "Create & select".
- **D13 label** describes the aggregate correctly but still collapses the per-bucket
  `max(budget, bills)` into one summed line; the per-group detail remains in
  `CommitmentBreakdown`, which was not in the owned paths.
- Not run (per instructions): full Playwright e2e, any SQL, any push/deploy. No migration
  was created or applied.
