# UI interaction audit — 2026-10-04

## Scope and evidence

Review of the supplied exchange-success screenshot and the current local
`RecordDialog`, shared native `Dialog`, styles, and translations. This is a
focused confirmation-state audit, not a full audit of openbudgetracker.app.
The hosted site was not inspected or changed. The named audit files were
absent from this checkout and main; this document records the new review.

## Findings and changes

| Finding | Resolution |
| --- | --- |
| Success looked like an ordinary paragraph without a clear completion cue. | Added a check icon and localized confirmation heading; exchange says “Exchange recorded”. |
| Large empty space and a short, detached divider weakened the layout. | Grouped the icon, heading, and summary; actions and divider now span the content width. |
| Primary next action lacked keyboard focus after the form disappeared. | Done receives focus when the result mounts. |
| Status region included interactive buttons. | Only confirmation copy is in the atomic polite status region. |

The same shared confirmation layout serves all RecordDialog outcomes. Existing
transaction summaries and Record another behavior remain intact. EN/AR copy,
logical spacing, shared tokens, and the existing native modal are used.

## Verification

- `pnpm build`: passed, including TypeScript checking.
- `pnpm test:ui`: 14 files, 80 tests passed.
- `git diff --check`: passed.
- Isolated Chrome renders using the actual project CSS and representative
  confirmation markup: 1440px English, 390px English, 390px Arabic.
  No document overflow; action buttons were 44px high and inside the viewport.
  Desktop and Arabic phone screenshots were visually inspected.
- Impeccable detector: one existing warning at control-room.css line 931
  (a thick side border outside the changed confirmation styles).

## Real-flow follow-up

Reused the existing loopback Supabase stack without resetting it. Tests create
throwaway users and exchange sample funds only in their own test spaces.

`pnpm test:e2e`: all five tests passed, including two new regression checks in
`e2e/record-success.spec.ts`. Verified exact USD/LBP confirmation copy, Done
focus and Enter dismissal, opener focus return, fresh repeat fields without a
duplicate write, Escape, close-button dismissal, and backdrop dismissal.
The existing onboarding/money flows and Arabic phone navigation also passed.

Backdrop dismissal initially failed focus return: the mousedown handler closed
the dialog, then the browser default moved focus away. Preventing that default
in the shared Dialog handler fixed the failing browser test. Build and all 80
UI tests were rerun and passed after the fix.

## Remaining verification

Manual screen-reader announcement checks, zoom/long-summary coverage, other
supported browsers, and pending/error-state scenarios remain unverified.
No deployment was performed; the hosted site was not changed.
