# 08 — Allocation UI implementation plan

> **For agentic workers:** Use executing-plans and test-driven-development.

**Goal:** Deliver the allocation human flow on verified gateways.
**Layer:** UI only. **Depends on:** [07-allocation-gateway.md](07-allocation-gateway.md).
**Architecture:** feature components and scoped CSS; database-derived money.
**Tech Stack:** React/TypeScript/plain CSS/Testing Library/Playwright.

## Files

Create `src/features/allocation/allocation-setup.tsx`,
`src/features/allocation/allocation-month-editor.tsx`,
`src/features/allocation/allocation-overview.tsx`,
`src/features/allocation/allocation-bars.tsx`,
`src/features/allocation/allocation.css`, component tests next to each component,
`e2e/allocation.visual.spec.ts`. Modify only current route composition and
required application tests; do not change SQL, posting gateways, auth or loan
logic. Record decisions and `docs/verification/future-planning/08.md`.

## Task 1 — Flow and fixtures

Setup in active space/currency; choose manual or percentage mode; edit groups/weights; map existing expense roots; preview every integer allocation and leftover; confirm once. Editing an existing plan loads its saved snapshot and expected heads. Show stale-dependency review, not an automatic rebase.

Placement: Plan owns configuration. Home may show a compact summary linking to Plan. Reuse the current approved shell; if Control Room has landed, integrate its Plan/Home composition. Otherwise add one scoped Plan route using the existing shell pattern, without redesigning shared navigation.

Write component tests using the predecessor's in-memory gateway. Include every
state loading/empty/ready/error/saving/ambiguous/accepted-refresh-pending,
space switch while loading, and revoked membership recovery. Add these data
assertions before writing screens:

| Test | Required behavior |
| --- | --- |
| U08-01 | 200000 planned,180000 received,161000 spent shows19000 after spending |
| U08-02 | 56/24/20 of101 minor units shows57/24/20 |
| U08-03 | Zero target with spend distinguishes unplanned versus explicit zero |
| U08-04 | Salary entry changes actuals without changing saved target |
| U08-05 | Concurrent editor shows reload/review and preserves unsent draft |

## Task 2 — Implement the screen with these acceptance properties

- Planned income and received income separately.
- Essentials56%, Lifestyle24%, Future20% example.
- Signed remaining/overspent amount and target marker.
- Future allocated/paid separate from expense totals.
- Unmapped and Uncategorized included in totals and drilldowns.

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
`src/features/allocation/chart-ratio.ts` with unit tests:

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
pnpm exec vitest run --config vitest.ui.config.ts src/features/allocation
pnpm exec playwright test e2e/allocation.visual.spec.ts
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
Commit `feat(allocation): add planning interface`. Stop before another layer.

## Mode persistence without another source of truth

Manual mode publishes a zero-group/zero-mapping template with income and explicit
standalone root targets through the same atomic publication RPC. Percentage mode
uses at least one group. Derive mode from that saved template, not a conflicting
local preference. Switching mode previews all existing positive targets and
requires explicit zero clears for removals; old history stays intact. No starter
categories are seeded. Existing account/wallet setup remains in current onboarding.
