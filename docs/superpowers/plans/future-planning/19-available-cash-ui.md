# 19 — Cash-Control UI implementation plan

> **For agentic workers:** Use executing-plans and test-driven-development.

**Goal:** Deliver the cash-control human flow on verified gateways.
**Layer:** UI only. **Depends on:** [18-available-cash-gateway.md](18-available-cash-gateway.md).
**Architecture:** feature components and scoped CSS; database-derived money.
**Tech Stack:** React/TypeScript/plain CSS/Testing Library/Playwright.

## Files

Create `src/features/cash-control/cash-control-summary.tsx`,
`src/features/cash-control/cash-outlook-chart.tsx`,
`src/features/cash-control/commitment-breakdown.tsx`,
`src/features/cash-control/cash-control.css`, component tests next to each component,
`e2e/cash-control.visual.spec.ts`. Modify only current route composition and
required application tests; do not change SQL, posting gateways, auth or loan
logic. Record decisions and `docs/verification/future-planning/19.md`.

## Task 1 — Flow and fixtures

Load authoritative available-cash summary, inspect every reservation component, change forecast scenario and drill down to the originating bill/goal/category. This is a read-only screen: adjustments open the relevant existing editor.

Placement: Home compact summary plus Plan detail. The label is Available after commitments. Forecast is visibly Expected outlook and never replaces the actual wallet-balance figure.

Write component tests using the predecessor's in-memory gateway. Include every
state loading/empty/ready/error,
space switch while loading, and revoked membership recovery. Add these data
assertions before writing screens:

| Test | Required behavior |
| --- | --- |
| U19-01 | Cash100000 minus commitments110000 shows shortfall10000 |
| U19-02 | Goal30000 funding bill50000 reserves50000 once, not80000 |
| U19-03 | Paid bill leaves forecast exactly once |
| U19-04 | Unconfirmed salary never increases current available cash |
| U19-05 | Partial month uses inclusive remaining days for estimate |

## Task 2 — Implement the screen with these acceptance properties

- Actual cash and expected income never combined as one balance.
- Signed available amount, zero spendable floor and separate shortfall.
- Bills/goals/loan commitments deduplicated.
- 60-day conservative versus expected-income scenario.
- No allowance when source coverage is incomplete.

This view has no Save or posting action. Links open the existing bill/goal/category
editor for an explicit adjustment. Label the guide “Extra unassigned cash per day”
and explain category budgets are already reserved; show inclusive remaining days
and the signed deficit alongside the zero extra-spending floor.

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
`src/features/cash-control/chart-ratio.ts` with unit tests:

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
pnpm exec vitest run --config vitest.ui.config.ts src/features/cash-control
pnpm exec playwright test e2e/cash-control.visual.spec.ts
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
Commit `feat(cash-control): add planning interface`. Stop before another layer.
