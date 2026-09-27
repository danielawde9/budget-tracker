# Design QA — approved desktop and mobile concepts

Date: 2026-09-27. Scope: all 16 screens in the approved [desktop v2 gallery](artifacts/desktop-concepts-v2/README.md) and [mobile gallery](artifacts/mobile-concepts/README.md), including Loans under Plan. The implementation is the local UI worktree served at `http://127.0.0.1:5175/`; browser captures use the existing offline app fixtures so the same routes and interactions can be checked without changing an account's records.

## Comparison setup

- Desktop source and implementation: 1586 × 992 pixels, 1586 × 992 CSS viewport, device scale factor 1.
- Mobile source: 853 × 1844 pixels. Implementation: 852 × 1844 pixels from a 426 × 922 CSS viewport at device scale factor 2. The single extra source pixel is cropped from the right edge in the comparison sheets; content is compared at the same 426 CSS pixel width.
- State: English, light theme, September 2026 where the concept depicts a month. The fixture supplies its own entries, categories, loans, wallets, and balances. A generated amount or person in the source is an illustration, not a value to seed into the product.
- The full-view comparison sheets are in `artifacts/visual-qa-2026-09-27/comparisons/`. Each sheet places the source on the left and the rendered implementation on the right after the size normalization above. Raw implementation captures are in `artifacts/visual-qa-2026-09-27/`.

For each row below, the source truth is `artifacts/desktop-concepts-v2/<screen>.png` or `artifacts/mobile-concepts/<screen>.png`. The raw implementation screenshots are `entry/<screen>-{desktop,mobile}.png` for 01, 02, and 16 (16 desktop uses `entry/16-record-expense-desktop.png` to match selected Expense); `desktop-home.png`/`mobile-home.png` and `desktop-journal.png`/`mobile-journal.png` for 03 and 04; `desktop/<screen>-viewport.png`/`mobile/<screen>-viewport.png` for 05–09 and 13; and `<name>-{desktop,mobile}.png` for 10–12, 14, and 15, all under `artifacts/visual-qa-2026-09-27/`.

| Screen | Desktop source and implementation | Mobile source and implementation |
| --- | --- | --- |
| 01 Sign in | [pair](artifacts/visual-qa-2026-09-27/comparisons/01-sign-in-desktop.png) | [pair](artifacts/visual-qa-2026-09-27/comparisons/01-sign-in-mobile.png) |
| 02 First space | [pair](artifacts/visual-qa-2026-09-27/comparisons/02-first-space-desktop.png) | [pair](artifacts/visual-qa-2026-09-27/comparisons/02-first-space-mobile.png) |
| 03 Home | [pair](artifacts/visual-qa-2026-09-27/comparisons/03-home-desktop.png) | [pair](artifacts/visual-qa-2026-09-27/comparisons/03-home-mobile.png) |
| 04 Journal | [pair](artifacts/visual-qa-2026-09-27/comparisons/04-journal-desktop.png) | [pair](artifacts/visual-qa-2026-09-27/comparisons/04-journal-mobile.png) |
| 05 Plan | [pair](artifacts/visual-qa-2026-09-27/comparisons/05-plan-desktop.png) | [pair](artifacts/visual-qa-2026-09-27/comparisons/05-plan-mobile.png) |
| 06 Allocation | [pair](artifacts/visual-qa-2026-09-27/comparisons/06-allocation-desktop.png) | [pair](artifacts/visual-qa-2026-09-27/comparisons/06-allocation-mobile.png) |
| 07 Goals | [pair](artifacts/visual-qa-2026-09-27/comparisons/07-goals-desktop.png) | [pair](artifacts/visual-qa-2026-09-27/comparisons/07-goals-mobile.png) |
| 08 Available cash | [pair](artifacts/visual-qa-2026-09-27/comparisons/08-available-cash-desktop.png) | [pair](artifacts/visual-qa-2026-09-27/comparisons/08-available-cash-mobile.png) |
| 09 Upcoming bills | [pair](artifacts/visual-qa-2026-09-27/comparisons/09-upcoming-bills-desktop.png) | [pair](artifacts/visual-qa-2026-09-27/comparisons/09-upcoming-bills-mobile.png) |
| 10 Manage | [pair](artifacts/visual-qa-2026-09-27/comparisons/10-manage-desktop.png) | [pair](artifacts/visual-qa-2026-09-27/comparisons/10-manage-mobile.png) |
| 11 Wallets | [pair](artifacts/visual-qa-2026-09-27/comparisons/11-wallets-desktop.png) | [pair](artifacts/visual-qa-2026-09-27/comparisons/11-wallets-mobile.png) |
| 12 Categories | [pair](artifacts/visual-qa-2026-09-27/comparisons/12-categories-desktop.png) | [pair](artifacts/visual-qa-2026-09-27/comparisons/12-categories-mobile.png) |
| 13 Loans | [pair](artifacts/visual-qa-2026-09-27/comparisons/13-loans-desktop.png) | [pair](artifacts/visual-qa-2026-09-27/comparisons/13-loans-mobile.png) |
| 14 Household | [pair](artifacts/visual-qa-2026-09-27/comparisons/14-household-desktop.png) | [pair](artifacts/visual-qa-2026-09-27/comparisons/14-household-mobile.png) |
| 15 Add from Phone | [pair](artifacts/visual-qa-2026-09-27/comparisons/15-add-from-phone-desktop.png) | [pair](artifacts/visual-qa-2026-09-27/comparisons/15-add-from-phone-mobile.png) |
| 16 Record overlay | [pair](artifacts/visual-qa-2026-09-27/comparisons/16-record-overlay-desktop.png) | [pair](artifacts/visual-qa-2026-09-27/comparisons/16-record-overlay-mobile.png) |

Focused side-by-side regions were inspected for the [Plan registers](artifacts/visual-qa-2026-09-27/focus/05-plan-register-desktop.png), [Wallet transaction history](artifacts/visual-qa-2026-09-27/focus/11-wallet-history-desktop.png), [shortcut-preview artwork](artifacts/visual-qa-2026-09-27/focus/15-phone-preview-desktop.png), and [Record mobile fields](artifacts/visual-qa-2026-09-27/focus/16-record-form-mobile.png). These crops check legible typography, table columns, controls, and asset details that are too small in the full-view sheets. Other screens' full-view pairs have readable section hierarchy and no additional critical image detail.

## Findings and comparison history

1. **[P1, corrected] Shared frame and primary actions.** Initial implementation used a 244px rail, narrow desktop content, a tall outlined mobile space selector, and an inherited button reset that removed the filled primary action. The source uses a 282px rail, fuller content width, compact mobile name, and green primary buttons. The shared CSS now matches these proportions; the button style has a browser regression test. Post-fix evidence: 03, 05, 10, and 11 pairs above.
2. **[P1, corrected] Desktop Home, Plan, and Wallets information density.** The first pass left Home's recent activity below the fold, Plan's category/loan registers as sparse stacked rows, and Wallet history as very tall rows with raw IDs. Home now fits six cards and five recent items, the Plan registers use compact columns, and Wallet history is a table-like register with readable labels. Post-fix evidence: 03, 05, and 11 desktop pairs above.
3. **[P1, corrected] Reference illustrations.** Initial sign-in replaced the ledger illustration with CSS shapes and Add from Phone omitted the shortcut-preview panel. Raster illustrations now fill those visible roles. First-space desktop backdrop is also a raster scene behind the modal. Post-fix evidence: 01, 02, and 15 desktop pairs above.
4. **[P1, corrected] Entry interaction states.** Desktop Record initially advanced immediately after tile selection, so the source's selected Expense + Continue state could not be rendered. Desktop now holds the selection until Continue. Mobile Record initially rendered only a type chooser; it now exposes a real amount/wallet/category/date/note form for Expense and Income and submits through the existing command. Mobile first-space setup now includes the first wallet in the initial form; a failed wallet creation recovers on the existing wallet step without creating a duplicate space. Post-fix evidence: 02 and 16 pairs above, plus the Record field crop.
5. **[P2, corrected] Mobile viewport rhythm.** The initial Plan, Home, and Journal captures placed headings and cards too low or high after shell changes; Upcoming bills placed its large summary before the first bill. Scoped header spacing, compact Plan group cards, and a compact Upcoming summary restore the concept's first-fold order. Wallets, Household, and phone setup also now expose their key sections above the bottom bar. Post-fix evidence: 03, 04, 05, 06, 09, 11, 14, and 15 mobile pairs above.

### Five required fidelity surfaces

- **Fonts and typography:** The app uses its bilingual system sans stack and tabular numerals. Heading weight and size, small labels, wrapping, and amount hierarchy were checked in full views and the Plan/Wallet focused regions. Remaining browser font rendering differences are P3.
- **Spacing and layout rhythm:** Rail width, page insets, card placement, table density, mobile topbar and bottom navigation were measured at matched CSS viewports. Section cards follow the source's general grid and stacking order. Real data can make a card shorter than the illustrative source.
- **Colors and tokens:** Forest rail, warm canvas, white cards, green primary/positive, red overage/danger, borders and contrast follow the source palette through shared tokens. Minor tonal differences are P3.
- **Image quality:** Visible decorative scenes use generated raster assets with the source's ledger/plant and shortcut-preview art direction. Existing product icons use Lucide; a few concept icons have different filled treatments (P3). No generic image placeholders remain in the compared scenes.
- **Copy and content:** App labels, EN/AR controls, and helper text were checked. Amounts, member names, schedules, and transaction counts come from real gateways or the browser fixture; the generated concepts' sample data is not copied into app state.

### Source and data limits

- The mobile 01 source depicts onboarding, whereas desktop 01 depicts sign-in. They cannot both be the same route and state; mobile sign-in is compared for visual language and mobile onboarding is compared directly with 02.
- The fixture has one active goal, one upcoming bill, one parent category per kind, no published Home plan, and two report months; the sources depict more illustrative records. The UI does not manufacture them. The live household API masks member display names/invitation email, so raw source names and a copy-link action are unavailable; this is not a CSS drift.
- The concept's 60-day curve and breakdown rows illustrate more forecast data than the fixture has. The app displays its supported cash projection and detailed accessible table with actual data rather than interpolating invented days.
- The local quick-add URL naturally shows `127.0.0.1`, rather than the image's example domain.

## Live account migration and browser check

The in-app browser on `http://127.0.0.1:5175/` originally reported: `Could not find the function public.monthly_budget_category_page_v3(...) in the schema cache`. The preview's `.env.local` points to hosted Supabase project `hqblhzqitrbvpyoxtmew`. A read-only audit found 50 of 55 committed migrations in its journal and confirmed the five dated 2026-09-25 were absent. After Daniel authorized the hosted update, the guarded `pnpm migrate:live` workflow ran from `main`: it verified the 55-file manifest, saved a private schema and data backup, dry-ran exactly those five missing files, applied them, then reported no pending migrations and `budget_schema_ready`. In the signed-in 5175 browser, Plan now loads September 2026 USD planned income, category targets, and loan commitments; LBP also loads, and Loans opens under Plan. No account records were changed by UI QA.

## Verification and final result

The final 32 matched viewport pairs and four focused regions above were captured and inspected after the visual corrections. `pnpm check:ui` passed: TypeScript checks, 104 UI test files with 1,348 passing tests, and a production Vite build. The complete Playwright desktop/mobile suite passed with 163 tests and 53 expected project-specific skips. `git diff --check` passed. The hosted Plan browser check passed after the migrations; the image pairs remain fixture-backed visual evidence with the data limits above.

final result: passed
