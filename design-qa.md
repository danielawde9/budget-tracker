# Owner walkthrough implementation QA — 2026-10-03

Visual review result: passed for the sampled states. Full interaction readiness: needs fixes.

The deeper October 3–4 browser pass submitted the money forms and found five actionable issues. See [the interaction audit](docs/feedback/2026-10-04-ui-interaction-audit.md) for reproduction steps, screenshots, coverage and limits. Its findings supersede the earlier completion claim below.

## Evidence and state

Source visual truth: `docs/feedback/ui-concepts-2026-10-03/` (13 approved conceptual sheets) plus `docs/feedback/2026-10-03-owner-walkthrough.md`. Generated sample balances, names and extra navigation are illustrative. Actual application data and routes take precedence.

Implementation: `http://127.0.0.1:5173/`, local Existing money demo, October 2026, English unless filename ends `-ar`. Evidence lives in `docs/feedback/ui-implementation-2026-10-03/`.

Full-view comparison: `comparison.jpg` places Home, Record and Plan source sheets beside browser-rendered screenshots. Focused comparison: `editor-focused-comparison.jpg` isolates the source editor and implementation controls; controls and copy were also inspected at native screenshot resolution. Final editor after spacing refinement: `plan-editor-final.jpg`. Final Home: `home-final.jpg`. Other evidence: `expense-desktop.jpg`, `investment-value-desktop.jpg`, `accounts-desktop.jpg`, `activity-desktop.jpg`, `settings-desktop.jpg`, `glossary-desktop.jpg`, `tour-desktop.jpg`, `home-mobile.jpg`, `plan-mobile.jpg`, `plan-mobile-ar.jpg`, `plan-editor-mobile.jpg`.

Initial desktop CSS viewport was 1280 × 720; screenshots contain 1265 × 712 content, excluding browser framing/scrollbar. Full-page height varies (Home 1202, Plan 2444, Activity 2638). Mobile override was 390 × 844; browser screenshots contain 375 × 812 pixels. After reset, final desktop CSS viewport was 1743 × 1156 at devicePixelRatio 1. The final editor screenshot contains 1728 × 1146 content. Source Home is 1487 × 1058, Plan sheet 1642 × 958, Record sheet 1683 × 935. Sources are presentation boards with multiple panels rather than exact CSS viewports. Comparison boards scale each panel proportionally into equal display columns; no numeric pixel-match claim is made. Aspect-ratio and sample-content differences are intentional.

## Fidelity surfaces

- Typography: preserves the application's sans-serif family and Arabic fallback; bold page headings, strong amount hierarchy, readable 16px form controls and normal wrapping. The concept's generated lettering is not a reproducible font specification.
- Spacing/layout: dark left rail on desktop, bottom navigation on mobile, clear Home next action, grouped page panels, one-group editor, optional details and sticky dialog actions. Editor totals are sticky below its header. Taller real groups scroll rather than shrinking controls.
- Colors/tokens: neutral canvas, white surfaces, dark green rail, soft green explanations and primary green actions follow the concept direction. Existing semantic warning/danger colors remain.
- Assets: existing Budget mark and Lucide icon family retained consistently. No generated sample branding or decorative image assets were added to the financial UI.
- Copy/content: real account names and separate USD/LBP balances retained. Transfer versus purpose changes, investment values/losses, signed debt balances, glossary and month labels use English/Arabic product copy.

## Findings and comparison history

No actionable P0/P1/P2 findings remained in the original sampled visual states. The subsequent interaction audit found an incorrect exchange-rate display, a Home funding dead end, an investment validation/error mismatch, an invalid same-purpose preview, and silent reference-rate validation.

Resolved during review:

1. Invalid raw MoneyField drafts disappeared when changing groups; optional invalid targets could be saved from another group. Keep sections mounted/hidden and separately validate optional targets. Two new regression tests pass.
2. Activity filters searched only loaded pages without stating that limit. Labels and empty copy now explicitly say loaded activity/types and direct users to load older entries.
3. Home nested native disclosure elements inside a paragraph. Changed its label container to a div. No new console errors after the fix/reload.
4. Popup footer clipped action bottoms because its sticky inset was negative. Use zero inset. Post-fix evidence: `expense-desktop.jpg`, `plan-editor-final.jpg`, `glossary-desktop.jpg`.
5. Mobile Plan actions overflowed horizontally; percentage input overflowed its editor column. Limit header action width and allow percentage inputs to shrink. Post-fix evidence: `plan-mobile.jpg`, `plan-mobile-ar.jpg`, `plan-editor-final.jpg`. Browser measured body width 375 within the 390 CSS viewport.
6. Account action accessible labels were visible beside ellipsis icons. Use existing visually-hidden utility. Investment popup evidence shows corrected account rows behind it.
7. Glossary definitions inherited numeric nowrap/bold styling and overflowed. Override wrapping/weight. Post-fix evidence: `glossary-desktop.jpg`.
8. Editor controls occupied excessive vertical space before the item list. Put group options after items, tighten group gaps and place desktop totals beside income. Post-fix evidence: `plan-editor-final.jpg`.

Earlier comparison boards capture the review progression; final editor evidence supersedes their earlier editor layout.

## Verification

Full `pnpm check` passed: TypeScript, 165 database tests, 110 UI tests and production build. Further UI/type/build checks passed after browser fixes. Final editor order/spacing change was rechecked with plan tests and build. `git diff --check` clean.

Browser interactions: Record chooser → Expense; plan editor group switching/cancel; investment value input preview correctly showed a $971 loss without changing wallets; glossary open/close; guided tour started on Home and Next navigated to September Plan; desktop routes and mobile/Arabic layout. Forms were canceled without writing demo ledger entries. Console inspection found the repaired HTML nesting errors historically; no newer error entries remained after repair. Existing Supabase multiple-client warning is unrelated to the redesign.

Test limits: sign-in/onboarding, debt confirmation, all loan/investment operations and optional-field retention have automated component coverage. The browser pass sampled the dialogs rather than submitting every mutation; the standalone Playwright suite was not run. No deployment, production data changes or database reset occurred.

## Implementation checklist

- [x] Walkthrough items 1–21 implemented across existing pages and forms.
- [x] Independent regression review findings resolved.
- [x] Desktop/mobile and Arabic inspected.
- [x] Full checks passed and preview left running.

P3 follow-up polish: choose an exact brand typeface if a font specification is supplied; concept sheets currently use generated typography.

---

# Design QA

## Confirmation design

A successful money action shows a green check, a localized completion heading,
and the original result summary. Done is the primary action at the inline end;
Record another is secondary when available. The divider spans the content.
On narrow phones the buttons grow and wrap. Arabic mirrors the layout.

The shared pattern is documented in docs/design-guidelines.md section 18.
Audit evidence: docs/feedback/2026-10-04-ui-interaction-audit.md.

## Completed checks — 2026-10-04

- [x] Production build and TypeScript checking.
- [x] Existing UI suite: 80 tests across 14 files.
- [x] Diff whitespace check.
- [x] Isolated desktop English and phone English/Arabic layout checks using
      project CSS: no horizontal overflow, buttons at least 44px high.
- [x] Visual inspection of desktop and Arabic phone fixture screenshots.
- [x] Shared tokens, logical properties, bilingual headings, icon with text.

## Real-flow acceptance checks

- [x] Save an exchange; verify exact amounts and currencies in the result.
- [x] Confirm Done receives focus after save and closes on Enter.
- [x] Confirm focus returns to the opener after closing.
- [x] Record another reopens a fresh form without repeating the saved write.
- [ ] Confirm the status summary is announced politely once with a screen reader.
- [x] Verify Escape, close button, and backdrop behavior in the real dialog.
- [ ] Check long summaries, 200% zoom, EN/AR, and supported browsers.
- [ ] Verify error and pending states never show a success result prematurely.
- [x] Run database-backed exchange end-to-end checks on the local preview stack.

All five Chrome end-to-end tests passed on the existing local preview stack.
The new exchange tests verify keyboard completion, repeat behavior, request
counts, and all three dismissal paths. Backdrop focus return failed before the
shared Dialog fix and passed afterward. Build and 80 UI tests also passed again.
Unchecked items above remain pending. The live website has not been deployed
or audited here.

## Production release follow-up — 2026-10-04

The owner authorized clearing old app data and re-entering it in v2. The
production database and frontend are now released; four login accounts remain.
Current validation: 165 SQL tests, 110 UI tests, and 5 local browser flows
passed. The local browser tests now follow the owner's existing redesign.
Earlier dated claims of no deployment describe the pre-release checks only.
See the production release record in docs/operations for scope and limitations.
