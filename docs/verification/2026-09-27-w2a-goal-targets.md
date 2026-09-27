# W2a — wire goal monthly targets into the Plan / Future group

**Task:** audit rows C3/B6 (rank 10) and §3.2/§3.3, plus D6/D9 context.
**Branch:** `ws/w2a-goal-targets`. **Worktree:** `.worktrees/w2a-goal-targets`.
**Date:** 2026-09-27.

The audit finding: *"No UI calls `publishMonthV2` or the goals `setMonthlyTarget`.
Goal monthly targets never reach the plan or the Future group."* The data layer
(`GoalsGateway.setMonthlyTarget`, `useGoals.setMonthlyTarget`,
`AllocationGateway.publishMonthV2`, `useAllocation.publishMonthV2`) already
existed and was tested; this packet is UI/route wiring only.

Owner decision (fixed): the monthly target **amount** is edited from the GOAL
surface (the goal detail editor), not the Allocation screen. The Allocation
publish then carries those goal lines.

## Item 1 — Goal surface "Monthly target" control

**Files**
- `src/features/goals/goal-monthly-target-dialog.tsx` (new) — the control.
- `src/features/goals/goal-detail.tsx` — a "Set monthly target" action and the
  dialog, plus the plan-month revision head derivation.
- `src/features/goals/monthly-target.ts` (new) — `latestMonthlyTargetRevisionId`.
- `src/features/goals/types.ts` — new `GoalMonthlyTargetLine` type.

The dialog calls `useGoals.setMonthlyTarget` via
`props.goals.setMonthlyTarget({ goalId, month, amountMinor, expectedRevisionId })`
(`SetMonthlyTargetInput` minus the hook-supplied `spaceId`/`requestId`). The
amount may be `0` to clear the target. `GoalDetail`'s "Monthly target" metric
reads `summary.monthlyTargetMinor`, so once a target exists it shows the amount
instead of "None set".

`set_goal_monthly_target` requires the current `goal_monthly_target_revisions`
head as `p_expected_revision_id`, but `goal_page`/`goal_detail` do not expose it.
It is the `sourceId` of the newest `monthly_target` history row whose
`detail.monthStart` equals the plan month, so `GoalDetail` derives it from the
history feed it already loads. No schema/read-projection change was needed.

## Item 2 — Allocation publish carries the goal lines

**Files**
- `src/features/goals/monthly-target.ts` (new) — `loadGoalMonthlyTargetLines`.
- `src/features/goals/use-goal-monthly-targets.ts` (new) — the wiring hook.
- `src/features/allocation/allocation-setup.tsx` — new `goalLines` prop; Confirm
  now calls `publishMonthV2` when `submission.goalTargets.length > 0`, else the
  unchanged `publishMonth` (v1). This is an explicit, typed branch — never an
  ambiguous overload.
- `src/features/allocation/allocation-month-editor.tsx` — a per-goal
  Standalone / Future-group link selector and a review row; the submission
  gained `goalTargets: AllocationGoalTargetInput[]`.

A goal's Future-group link lives only on `allocation_month_goal_lines.group_id`
(it has no goal-level column), so it is a publish-time choice made in the
Allocation editor; the goal surface edits the amount. The editor builds
`{ goalId, groupId: <chosen or null>, amountMinor, expectedRevisionId }` per
line, exactly matching the spec's standalone/Future-group rules (§6) and
`PublishMonthV2Input.goalTargets`.

## Item 3 — Tests

- `src/features/goals/monthly-target.test.ts` — helper + loader unit tests.
- `src/features/goals/use-goal-monthly-targets.test.tsx` — hook tests.
- `src/features/goals/goal-detail.test.tsx` — (a) the goal surface calls
  `setMonthlyTarget` with the current month and revision head; the metric shows
  "None set" only until a target exists.
- `src/features/allocation/allocation-month-editor.test.tsx` — link selector and
  the exact `goalTargets` submission shape.
- `src/features/allocation/allocation-setup.test.tsx` — (b) the publish path
  calls `publishMonthV2` with the expected `goalTargets`; the audit example
  (income 3000, Future 600, reserve 600) publishes a **linked** goal target of
  `60000` in the Future group; a second case publishes a **standalone**
  (`groupId: null`) goal target; and a regression case proves v1 is still used
  when no goal has a monthly target.

### Red → green

Red (tests written first, before implementation):

```
pnpm exec vitest run --config vitest.ui.config.ts \
  src/features/goals/monthly-target.test.ts src/features/goals/goal-detail.test.tsx \
  src/features/allocation/allocation-setup.test.tsx src/features/allocation/allocation-month-editor.test.tsx
# Test Files  4 failed (4)   Tests  6 failed | 56 passed (62)
```

Green (same command, after implementation):

```
pnpm exec vitest run --config vitest.ui.config.ts \
  src/features/goals/monthly-target.test.ts src/features/goals/use-goal-monthly-targets.test.tsx \
  src/features/goals/goal-detail.test.tsx src/features/allocation/allocation-setup.test.tsx \
  src/features/allocation/allocation-month-editor.test.tsx
# Test Files  5 passed (5)   Tests  73 passed (73)

pnpm exec vitest run --config vitest.ui.config.ts \
  src/features/goals src/features/allocation src/features/plan src/features/cash-control
# Test Files  31 passed (31)   Tests  479 passed (479)
```

### `pnpm check:ui`

```
pnpm check:ui
#   tsc --noEmit            : exit 0
#   vitest run (ui)         : Test Files 106 passed (106)   Tests 1386 passed (1386)
#   vite build              : ✓ built in 1.22s
```

No Playwright e2e was run (out of scope). No SQL was applied. Nothing was pushed.

## Migration required?

**No.** Every field the UI needs already exists in the read/mutation contracts:

- `set_goal_monthly_target(space, request, goal, month, amount, expected_revision)`
  is called with its declared arguments.
- `publish_allocation_month_v2(..., p_goal_targets)` accepts
  `{ goalId, groupId (nullable), amountMinor, expectedRevisionId }`, exactly
  `AllocationGoalTargetInput`.
- The one value not on a projection — the goal's monthly-target revision head —
  is derived from the existing `goal_history_page` `monthly_target` rows
  (`sourceId` + `detail.monthStart`).

No `supabase/**`, `ops/**`, `scripts/**`, `package.json`, global CSS,
`planning-shared/**`, `control-room/routes.tsx` or `app.tsx` file was edited.

## Wiring the coordinator must apply (`control-room/routes.tsx`)

`app.tsx` needs **no change**: it already builds `activeGoalsGateway` and passes
`goalsGateway` into the configured app (`ControlRoomGateways.goals`). The only
missing call site is `AllocationCurrencySection` in
`src/features/control-room/routes.tsx`:

1. Add the import:
   `import { useGoalMonthlyTargetLines } from '../goals/use-goal-monthly-targets.js';`
   (`GoalsGateway` is already imported.)
2. Add a `goalsGateway: GoalsGateway | null;` prop to `AllocationCurrencySection`
   (the props object at ~line 359) and read it plus the existing `spaceId`,
   `currency`, `month`:
   ```tsx
   const goalLines = useGoalMonthlyTargetLines(props.goalsGateway, props.spaceId, props.currency, props.month);
   ```
3. Pass it to `AllocationSetup`:
   ```tsx
   <AllocationSetup ... goalLines={goalLines} />
   ```
4. At the `AllocationCurrencySection` render site inside `PlanRoutes`
   (~line 658), pass the goals gateway (already available as `gateways.goals`):
   ```tsx
   goalsGateway={gateways.goals ?? null}
   ```

Without this wiring the Allocation editor still compiles and publishes via v1
(`goalLines` is optional), so the change is additive and safe to land in either
order.

## Remaining limitations

- **Goal monthly-target head is history-derived.** `GoalDetail` scans the first
  history page (limit 10). If the month's `monthly_target` revision is not on
  that page, the control sends `expectedRevisionId: null`; the database's own
  stale guard (`40001`) then rejects a re-set, surfaced to the user as a stale
  error. A future SQL task could return the head directly on
  `goal_page`/`goal_detail`. (Same source is used for the publish lines, with a
  limit-100 history read.)
- **Current month only.** `goal_page` returns each goal's `monthlyTargetMinor`
  for the current UTC month (the month `GoalDetail` edits), and
  `loadGoalMonthlyTargetLines` matches the same month. Publishing a *different*
  (e.g. future or past) month with goal lines is not covered.
- **Re-open default link.** `allocation_month_state` does not return goal lines,
  so an already-published goal→Future-group link is not read back; re-opening the
  editor defaults every goal to Standalone. The link is re-chosen per publish.
- **25→100 goals.** The loader asks `goal_page` for up to 100 goals (the page
  cap); C13's "only the first 25 load" still applies to the goals list itself,
  not this publish path.
- **Refund/reversal staleness** (audit C4) and the D6/D9 debt-vs-Future-group
  overlap are separate SQL packets and are untouched here.
