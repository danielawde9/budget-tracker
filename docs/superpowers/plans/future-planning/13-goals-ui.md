# 13 — Goals UI implementation plan

> **For agentic workers:** Use executing-plans and test-driven-development.

**Goal:** Deliver the goals human flow on verified gateways.
**Layer:** UI only. **Depends on:** [12-goals-gateway.md](12-goals-gateway.md).
**Architecture:** feature components and scoped CSS; database-derived money.
**Tech Stack:** React/TypeScript/plain CSS/Testing Library/Playwright.

## Files

Create `src/features/goals/goals-page.tsx`,
`src/features/goals/goal-detail.tsx`,
`src/features/goals/goal-editor.tsx`,
`src/features/goals/goal-milestones.tsx`,
`src/features/goals/goal-funding-dialog.tsx`,
`src/features/goals/goal-purchase-dialog.tsx`,
`src/features/goals/goals.css`, component tests next to each component,
`e2e/goals.visual.spec.ts`. Modify only current route composition and
required application tests; do not change SQL, posting gateways, auth or loan
logic. Record decisions and `docs/verification/future-planning/13.md`.

## Task 1 — Flow and fixtures

Create reserve/purchase goal with currency,target,optional deadline,contribution mode and milestones. Detail supports reserve/release/move, review underfunded claims, link an existing purchase, pause/resume/close, and inspect correction history. No direct progress editor.

Placement: Goals is a view within Plan. Existing expense creation stays in the Wallets/Record flow; after an accepted new expense, offer a separate recoverable goal link. A failed association must not repost the purchase.

Write component tests using the predecessor's in-memory gateway. Include every
state loading/empty/ready/error/saving/ambiguous/accepted-refresh-pending,
space switch while loading, and revoked membership recovery. Add these data
assertions before writing screens:

| Test | Required behavior |
| --- | --- |
| U13-01 | Cash70000 with claims60000/30000 shows60000/10000 coverage |
| U13-02 | A wallet transfer does not increase goal progress |
| U13-03 | Reserve20000 then release5000 gives15000 |
| U13-04 | Purchase40000 from 100000 earmark leaves60000 and fulfilled40000 |
| U13-05 | Reversal restores earmark and updates amount milestone |
| U13-06 | Checklist complete never changes money |

## Task 2 — Implement the screen with these acceptance properties

- Target, earmarked, cash-covered and fulfilled as separate values.
- Short/long/open horizon and next milestone.
- Monthly target versus signed net contribution.
- Cash shortage before bills and changed priority effects.
- Closed goal restored by reversal has needs-review action.

All saving flows show reviewable values before submission. Enter on a form and
clicking the primary button use one submission path. Disable double-submit
while saving; after accepted write and failed refresh show a Refresh action,
not a second Save that reposts. Preserve entered values on recoverable rejection.
Dialog Escape/backdrop behavior follows existing DialogShell; restore focus to
the trigger and provide a full-screen mobile dialog when its content needs it.

Use `formatMinorAmount` from `src/features/wallets/money.ts` and `<bdi>` for every
DB-sourced name/amount. All copy is EN/AR. Logical CSS only. No global design-token
replacement; no new chart library; no application internals in routine product copy.

## Task 3 — Bars/charts with accessible data equivalents

A bar reads checked DTO values. Use an exact integer ratio converted only after
clamping to a bounded visual coordinate; the displayed amount remains exact.
Zero targets show No target or Explicit zero based on hasPlan. Negative values
use a zero baseline with an inverse segment. Over100% retains a visible overflow
and numeric overage. Add a table equivalent and labelled drilldown buttons;
color alone never encodes financial meaning. Reduced-motion users get no animated
counting. Tooltip values also obey hide-amounts preference when that later task ships.

For a nonnegative bounded percentage coordinate, use this complete helper in
`src/features/goals/chart-ratio.ts` with unit tests:

```ts
export function chartPercent(actualMinor: string, scaleMinor: string): number {
  const actual = BigInt(actualMinor);
  const scale = BigInt(scaleMinor);
  if (scale <= 0n || actual <= 0n) return 0;
  const bounded = actual < scale ? actual : scale;
  return Number((bounded * 10000n) / scale) / 100;
}
```

This helper controls geometry only. Determine overage/sign from the original
BigInt values, never from the clamped coordinate. For signed plots, call it
with the absolute magnitude and render on the appropriate side of zero.

## Task 4 — Required human-flow evidence

```bash
pnpm exec vitest run --config vitest.ui.config.ts src/features/goals
pnpm exec playwright test e2e/goals.visual.spec.ts
pnpm typecheck
pnpm test:ui
pnpm build
pnpm test:e2e
git diff --check
```

Inspect 320/390/768/1440px, EN/AR RTL, keyboard-only,200% zoom, long mixed-script
names, zero/negative/large numbers, empty data and failure/retry. Put new evidence
in an ignored run directory rather than overwriting curated artifacts without
request. Report synthetic fixture versus authenticated UAT separately.
Commit `feat(goals): add planning interface`. Stop before another layer.
