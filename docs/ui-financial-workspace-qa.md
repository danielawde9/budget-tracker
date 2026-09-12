# Financial workspace redesign QA — 2026-09-12

Status: **FAIL — redesign acceptance remains open.** Task 6 adds fixture-backed browser coverage and updates the older route/selectors. It does not change production behavior to satisfy tests. Verified source baseline: `3239f7d`.

## Boundary and method

All browser evidence uses local Vite at `127.0.0.1:4173`, a local-storage session injected by Playwright, and intercepted HTTP responses backed by in-memory fixtures at `127.0.0.1:55432`. No live Supabase authentication, PostgreSQL mutation, RLS, hosted deployment, or production operation is proved. Synthetic fixture values and identities appear in screenshots. The fixture audit explicitly reports `simulated-local-http`, `injected-local-storage-session`, and `in-memory-fixture-state`.

Desktop is Chrome at 1440 × 1000 CSS pixels. Mobile is Chrome with Pixel 7 emulation at 390 × 844 CSS pixels, plus the existing 320 × 568 auth check. Mobile screenshot pixels include device scaling. Both English/LTR and Arabic/RTL are checked. This is browser emulation, not physical-device, Safari, or screen-reader proof.

The containment helper checks document width and the bounding boxes of the main content's controls, or the open dialog's controls. The primary navigation intentionally scrolls inside its own bounded container; controls clipped inside that scroller are not classified as page overflow. These assertions do not establish text contrast, prevent all overlapping text, or replace screenshot inspection.

## Commands and results

| Command | Status | Evidence |
| --- | --- | --- |
| Baseline `pnpm test:e2e -- e2e/application.visual.spec.ts e2e/wallets.visual.spec.ts e2e/categories.visual.spec.ts` | FAIL | 29 passed, 5 failed, 34 project skips, exit 1. All five failures were old default-Loans/person expectations. |
| New contract run including `e2e/loans.visual.spec.ts` | FAIL | 48 passed, 13 failed, 41 project skips. Found Home mobile overflow/action interception and nested loan focus defects; also exposed two incorrect new test assumptions, corrected to scope dialog controls and use category tabs only on mobile. |
| Wallets/Categories/Household follow-up | PASS | 43 passed, 33 project skips, exit 0; includes create, subcategory, archive, restore, undo, invitation, role, removal, cancellation, and leave-dialog focus checks. |
| `pnpm typecheck` | PASS | Generated worker types current; app and worker TypeScript checks exited 0. |
| `pnpm test:ui` | PASS | 36 files, 432 tests, exit 0. |
| `pnpm build` | PASS with warning | Exit 0, 1,965 modules. Vite reports the main minified chunk at 506.13 kB, above its 500 kB warning threshold. This is not a zero-warning build. |
| `pnpm test:e2e` | FAIL / runner interrupted | All 134 results emitted: 73 passed, 10 failed, 51 project skips. One worker stalled while finalizing a failure trace; SIGINT ended the owned process with exit 130 after 3 minutes. The tenth failure was the old private-UAT journal `listitem` selector, now migrated to `row`. |
| `pnpm test:e2e --trace=off --workers=4` | FAIL | Full matrix after final selector migration: 74 passed, 9 failed, 51 project skips, 1.5 minutes, exit 1. Only tracing and worker count differ from the default command. All remaining failures are the retained Home mobile and nested loan focus regressions. |

The skipped instances are explicit desktop/mobile project exclusions in existing tests; they are not extra passes. The runner also emitted Node's `DEP0205` warning. No dependency or bundling configuration was changed for this QA task.

## Primary-path matrix

PASS below applies to the named assertion only. It does not override visual failures listed afterward.

| Path / assertion | Desktop EN | Desktop AR | Mobile EN | Mobile AR |
| --- | --- | --- | --- | --- |
| Home selected by default, active wallet projection, bounded journal request | PASS | PASS | PASS | PASS |
| Home controls within page width | PASS | PASS | FAIL | FAIL |
| Home “View wallets” opens Wallets | PASS | PASS | BLOCKED by prior overflow assertion | BLOCKED by prior overflow assertion |
| Home “Record transaction” opens the real Wallets dialog | PASS | Not separately exercised | FAIL: pointer intercepted | Not separately exercised |
| No Reports or disabled primary navigation | PASS | PASS | PASS | PASS |
| Wallets/Loans/Categories routes and main-control containment | PASS | PASS | PASS | PASS |
| Household register, invitation containment and focus return | PASS | PASS | PASS | PASS |
| Wallet create/transaction/rename/archive/undo/restore focus return | PASS | Not separately exercised | PASS | Not separately exercised |
| Category/subcategory/archive focus return | PASS | Not separately exercised | PASS | Not separately exercised |
| Loan creation/detail focus return | PASS | Not separately exercised | PASS | Not separately exercised |
| Loan repayment/target/correction focus return | FAIL | Not separately exercised | FAIL | Not separately exercised |
| Household promote/demote/remove/cancel/leave focus return | PASS | Not separately exercised | PASS | Not separately exercised |
| Signed-out privacy and sign-in recovery to Home | PASS | Not separately exercised | 320px containment PASS | 320px containment PASS |
| Required onboarding and initial-wallet flow | PASS | Not separately exercised | PASS: full-screen/Escape guard | Not separately exercised |
| Offline protected-mutation/reload rehearsal | PASS | Not separately exercised | Not separately exercised | PASS |

Home checks verify the initial journal request has offset `0` and limit `21` (the existing 20-item page plus lookahead), and that the seeded response produces exactly three active wallets and seven journal rows. This does not assert live query performance or full-history completeness. The fixture does not model database ordering, authentication, privileges, or concurrency. The required setup dialog has no close action; invitation acceptance opens from a URL fragment and has no button opener, so neither is claimed as opener-return proof. Focus after Home's cross-route transaction launch is not separately proved.

## Unresolved findings

1. **FAIL — Home mobile layout.** At 390 CSS pixels, the English document measures 642px wide and Arabic measures 562px. The Home header places its actions beyond the content width. The English Record transaction click times out after 30 seconds: `View wallets` and occasionally the account summary intercept pointer events. Preserved evidence: [English](../artifacts/financial-workspace-qa/home-en-mobile.png), [Arabic](../artifacts/financial-workspace-qa/home-ar-mobile.png).
2. **FAIL — nested loan focus return.** Open Karim → Record repayment / Change monthly target / Correct borrowing entry → Escape. The detail dialog returns, but the original action is inactive instead of focused. Each of the three assertions fails on desktop and mobile. The detail panel unmounts while the subdialog is open, so the existing captured DOM opener no longer represents the restored action. Reproduction tests are retained without skipping or weakening them.
3. **FAIL — Home journal readability, screenshot review.** Event labels touch their dates and wallet names touch monetary values; rows lack clear separation in English and Arabic. [Desktop Arabic](../artifacts/financial-workspace-qa/home-ar-desktop.png) and the mobile screenshots demonstrate the issue.
4. **FAIL — desktop wallet balance/name separation, screenshot review.** `Home LBP` and `LBP 2,500,000` collide in the narrow balance folio. [Desktop English Wallets](../artifacts/financial-workspace-qa/wallets-en-desktop.png).
5. **FAIL — global rail action legibility, screenshot review.** “Add another space” uses dark green text against the dark green rail, making the available action difficult to read in both languages. No numerical contrast audit is claimed. [Arabic Household](../artifacts/financial-workspace-qa/household-ar-desktop.png).
6. **BLOCKED — live and hosted acceptance.** No live authenticated Supabase session, real PostgreSQL execution, physical mobile browser, hosted deployment, or owner UAT was run in this task. Fixtures must not be presented as evidence of any of those boundaries.

## Handoff and artifacts

Fresh screenshots for Home, Wallets, Loans, Categories, and Household in both languages and viewport projects are preserved in `artifacts/financial-workspace-qa/`. They include failed layouts, not just successful screens. Screenshot inspection covered Home EN/mobile and AR/desktop/mobile; Wallets EN/desktop/mobile; Categories AR/mobile; Loans AR/mobile; Household AR/desktop. Other saved captures are evidence available for review, not claimed as individually visually reviewed.

Test-only migrations scope Wallets navigation to its navigation landmark with an exact name, replace old default-Loans assertions with Home's real wallet/journal content, explicitly navigate to Loans in its suite, and use journal rows in the private-UAT reload assertion. No production hook, fake branch, gateway, SQL, or financial calculation changed.

Production fixes and a fresh full verification run remain required. The Task 6 report and raw local command logs are under the ignored `.superpowers/sdd/2026-09-11-financial-workspace-redesign/` handoff directory.
