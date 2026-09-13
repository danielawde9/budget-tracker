# 16 — Recurring UI implementation plan

> **For agentic workers:** Use executing-plans and test-driven-development.

**Goal:** Deliver the recurring human flow on verified gateways.
**Layer:** UI only. **Depends on:** [15-recurring-gateway.md](15-recurring-gateway.md).
**Architecture:** feature components and scoped CSS; database-derived money.
**Tech Stack:** React/TypeScript/plain CSS/Testing Library/Playwright.

## Files

Create `src/features/recurring/upcoming-page.tsx`,
`src/features/recurring/schedule-editor.tsx`,
`src/features/recurring/occurrence-detail.tsx`,
`src/features/recurring/confirm-payment-dialog.tsx`,
`src/features/recurring/recurring.css`, component tests next to each component,
`e2e/recurring.visual.spec.ts`. Modify only current route composition and
required application tests; do not change SQL, posting gateways, auth or loan
logic. Record decisions and `docs/verification/future-planning/16.md`.

## Task 1 — Flow and fixtures

Create a monthly/weekly schedule, materialize a bounded occurrence window on explicit refresh, show upcoming/due/partial/overdue/paid/skipped, confirm actual amount/date/wallet or link an existing event. Rendering or date rollover never posts money.

Placement: Upcoming bills is within Plan. The Record action can open a reviewed occurrence payment draft with captured request identity. Loan occurrences use their loan flow, never generic expense fields.

Write component tests using the predecessor's in-memory gateway. Include every
state loading/empty/ready/error/saving/ambiguous/accepted-refresh-pending,
space switch while loading, and revoked membership recovery. Add these data
assertions before writing screens:

| Test | Required behavior |
| --- | --- |
| U16-01 | Expected50000,paid20000 retains30000 due |
| U16-02 | January31 monthly recurrence previews February month-end |
| U16-03 | Opening the page twice creates no duplicate occurrence or payment |
| U16-04 | Confirm timeout reconciles receipt and posts at most once |
| U16-05 | Reverse a linked payment reopens remaining amount |

## Task 2 — Implement the screen with these acceptance properties

- Expected versus settled versus remaining amount.
- Due date and exact recurrence rule.
- Review before confirm or skip.
- Partial-payment and reversal reopening history.

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
`src/features/recurring/chart-ratio.ts` with unit tests:

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
pnpm exec vitest run --config vitest.ui.config.ts src/features/recurring
pnpm exec playwright test e2e/recurring.visual.spec.ts
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
Commit `feat(recurring): add planning interface`. Stop before another layer.
