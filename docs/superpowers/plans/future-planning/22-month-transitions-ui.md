# 22 — Month-Transitions UI implementation plan

> **For agentic workers:** Use executing-plans and test-driven-development.

**Goal:** Deliver the month-transitions human flow on verified gateways.
**Layer:** UI only. **Depends on:** [21-month-transitions-gateway.md](21-month-transitions-gateway.md).
**Architecture:** feature components and scoped CSS; database-derived money.
**Tech Stack:** React/TypeScript/plain CSS/Testing Library/Playwright.

## Files

Create `src/features/month-transitions/month-copy-dialog.tsx`,
`src/features/month-transitions/month-close-dialog.tsx`,
`src/features/month-transitions/rollover-policy-editor.tsx`,
`src/features/month-transitions/month-history.tsx`,
`src/features/month-transitions/month-transitions.css`, component tests next to each component,
`e2e/month-transitions.visual.spec.ts`. Modify only current route composition and
required application tests; do not change SQL, posting gateways, auth or loan
logic. Record decisions and `docs/verification/future-planning/22.md`.

## Task 1 — Flow and fixtures

Preview copying a saved month, review destination changes and archive omissions, then confirm using the preview hash. Opt-in rollover shows signed source carry and history. Closing/restating never creates cash entries.

Placement: Plan month controls only. No automatic rollover on navigation. A close with backdated new activity shows restatement required and a reviewable updated carry.

Write component tests using the predecessor's in-memory gateway. Include every
state loading/empty/ready/error/saving/ambiguous/accepted-refresh-pending,
space switch while loading, and revoked membership recovery. Add these data
assertions before writing screens:

| Test | Required behavior |
| --- | --- |
| U22-01 | Overspend2500 carries−2500, not0 |
| U22-02 | Changed target head between preview and confirm rejects stale preview |
| U22-03 | Copy never duplicates actual transactions |
| U22-04 | Goal earmarks are excluded from category carry |
| U22-05 | Restating previous month propagates reviewed differences once |

## Task 2 — Implement the screen with these acceptance properties

- Exact source snapshot and destination month.
- Positive and negative carry amounts.
- Explicit opt-in per root/currency.
- Unchanged historical close plus superseding close revision.

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
`src/features/month-transitions/chart-ratio.ts` with unit tests:

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
pnpm exec vitest run --config vitest.ui.config.ts src/features/month-transitions
pnpm exec playwright test e2e/month-transitions.visual.spec.ts
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
Commit `feat(month-transitions): add planning interface`. Stop before another layer.
