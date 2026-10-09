# Shared app design QA — October 9, 2026

final result: passed

Scope: approved compact emerald design direction applied to the existing application, including the shared shell used by Home, Plan, Activity, Accounts and Settings. This is an adaptation to the application's real currency and category model, not a pixel-for-pixel replacement with generated sample data.

## Source and comparison evidence

- Source visual truth: `home-concept.png`, `plan-concept.png`, `accounts-concept.png`, generated using built-in Imagegen from the user's three screenshots. Exact prompts are in `generation-prompts.json`.
- Sources: 853 × 1844 pixels, representing a requested 390 × 844 mobile viewport. For comparison, sources were proportionally downsampled to 390 × 843; no device chrome was included.
- Implementation: `home-mobile.png`, `plan-mobile.png`, `accounts-mobile.png`, each 390 × 844 pixels at a 390 × 844 CSS viewport, device pixel ratio 1.
- Full-view comparisons: `home-comparison.png`, `plan-comparison.png`, `accounts-comparison.png` place the source and browser capture together. Every pair was opened and inspected after the final revisions.
- Focused surfaces: warning heading/action, summary amounts, account row alignment, and bottom-bar labels were inspected in the browser at native resolution. The full comparison sheets also preserve readable 390px panels; separate enlarged crops were unnecessary.
- Additional evidence: `plan-mobile-ar.png`, plus `home-desktop.png`, `plan-desktop.png`, `accounts-desktop.png`. Desktop captures precede the final shorter warning copy and Home secondary-tile reorder; the final mobile captures show those revisions.

State: English, October 2026, a $54 negative-ready sample scenario, with existing USD/LBP fixture wallets and categories. The preview uses the actual application components and fixture-backed reads; it does not connect to a database or save financial records. Sample balances differ from generated concepts. The data model, live groups, loans and actions remain available rather than being replaced by invented mock content.

## Findings and iteration history

1. The initial Home warning included a separate currency row and footer actions, making the card too tall. The currency controls now share the heading row and secondary plan/breakdown actions follow the summary. Final evidence: `home-mobile.png`.
2. Configured reserve/savings tiles pushed the main plan link below the useful first-screen area. They now follow the primary wallet/spending summary, assignment total and plan links. At 390 × 844, the money footer ends at y=704 and the bottom bar begins at y=763. Final evidence: `home-mobile.png` and `home-comparison.png`.
3. The generic correction form initially selected negative ready money as its source. It now requires choosing an item and starts with Ready to assign as the destination. It cannot submit until a valid, sufficiently funded source is chosen. This is covered by a regression test that submits the correction to the fake API and verifies its exact currency, source, target and amount.
4. Long Plan explanations consumed the summary. Forecast and allocation explanations now live in How funding works, leaving the current warning and edit/change-purpose actions visible. Final evidence: `plan-mobile.png`.

No actionable P0/P1/P2 findings remain in this scoped review. Independent code review also found no actionable issues.

## Fidelity surfaces

- Typography: shared system sans-serif, 28px mobile / 32px desktop headings, 19px section headings, tabular amounts and readable helper text. Existing Arabic fallback is retained and tested for wrapping.
- Spacing/layout: one-row mobile header, shared gutters, compact cards/registers, equal five-column bottom bar, 44px Record button fully inside the bar, safe-area padding. Real category details remain directly usable beneath the Plan summary rather than adding an extra navigation-only panel.
- Colors/tokens: existing emerald, neutral and semantic danger tokens; Home and Plan use the same warning component. Green positive states and red shortfalls remain distinct.
- Assets: existing Lucide icons and native UI text; no decorative raster assets are needed. Generated concepts are reference material, not screenshots used as the UI.
- Copy/content: English and Arabic changes ship together. Wallet totals exclude investments, loans and archived accounts and keep currencies separate. Funded remains the API's monthly funded amount; the generated phrase Assigned to plan was not used to mislabel that field. Expected income remains explicitly explained as a forecast.

## Verification and limits

- `pnpm test:ui`: 33 files, 168 tests passed.
- `pnpm build`: TypeScript and production build passed.
- `git diff --check`: passed.
- Browser: all five main screens checked at 320 × 568 English/Arabic and 1440 × 1000 English; no document horizontal overflow. Shared navigation labels remained inside their columns and the viewport.
- Browser actions: Home/Plan correction opens the move dialog; source selection requires an item when ready is negative; Add an account opens the real dialog; account menus and funding explanations expand; locale and route navigation work.
- A concurrent public-site edit temporarily caused Vite hot-reload errors for a brand export. The export was restored by that work, the preview was reloaded, and there were no later warning/error log entries during the final capture.
- The local database was not running, so authenticated database-backed end-to-end saving was not tested. Existing API calculations were not changed. Browser checks used sample data and did not execute real financial changes.

Remaining P3 polish: generated examples use slightly different wording and proportions; actual multi-currency summaries and configured categories take the space their data requires. These differences preserve product behavior and are intentional.

## Implementation checklist

- [x] Shared header, typography, spacing and bottom navigation.
- [x] Shared correction state and clearer wallet/assignment distinction.
- [x] Compact account register with separate currency totals.
- [x] English/Arabic and narrow/desktop visual checks.
- [x] Regression tests, build and independent review.
- [x] Saved generated concepts, prompts, final browser captures and comparison sheets.
