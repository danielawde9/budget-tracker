# UI interaction audit — October 3–4, 2026

Verdict: core money movements reconcile in the tested cases, but the interface is not ready for an unqualified “all logical” sign-off. Five actionable issues and several smaller wording problems remain.

This was a hands-on browser audit using the Product Design audit workflow. Forms were filled and submitted through the local preview at http://127.0.0.1:5173. Synthetic accounts and descriptions use “UI audit”. This audit changed demo records and a reference-rate effective date; it did not change application code, deploy anything, reset the database, or move real money.

## Issues to fix

1. **P1 — Exchange rate is displayed 100 times too small.** Giving $10 and receiving LBP 895,000 displays “895 LBP per USD”; the correct rate is 89,500. The reverse direction, LBP 89,500 for $1, produces the same wrong label. Wallet previews and saved amounts are correct. In `src/record/forms-everyday.tsx`, the computed rate already converts USD cents, then the rendered label divides it by 100 again. Remove that extra scaling and verify both directions. Evidence: [USD → LBP](ui-audit-2026-10-03/10-exchange-preview.jpg), [LBP → USD](ui-audit-2026-10-03/32-reverse-exchange.jpg).
2. **P2 — Home’s primary next step can be a dead end.** With money Ready to assign and the monthly plan fully funded, Home says “Give your money a purpose” and offers “Fund my plan”. Clicking it opens “Everything planned for this month is funded” with only Done. Offer Change purpose in this state, or a clear onward action. Evidence: [funding dead end](ui-audit-2026-10-03/02-home-funding-dead-end.jpg).
3. **P2 — An investment withdrawal above its value is previewed as valid, then produces a loan error.** With investment value $100, withdrawing $150 enables Record and previews investment value -$50. The backend rejects it, protecting the balances, but the message explains loans going past zero. Validate the available investment value and show investment-specific guidance. Evidence: [withdrawal error](ui-audit-2026-10-03/14-overwithdrawal-error.jpg).
4. **P2 — Change purpose defaults to identical source and destination.** Both fields select Ready to assign. Entering $1 produces two contradictory previews for the same balance: a decrease and an increase. Move now is disabled without explaining why. Exclude the source from destination options or use a destination placeholder; suppress the invalid preview and explain the required choice. Evidence: [same-purpose preview](ui-audit-2026-10-03/31-identical-purpose.jpg).
5. **P2 — Invalid reference rates fail silently.** Entering `abc` leaves Save enabled. Clicking Save removes the earlier saved status but gives no validation message. The persisted rate stays unchanged. `RateForm` returns early on invalid text without feedback. Show an inline validation message and keep saving unavailable until the value is valid. Evidence: [invalid rate](ui-audit-2026-10-03/26-invalid-reference-rate.jpg).

## Smaller clarity problems

- When November is selected, the Plan summary heading still says “This month”. Use the selected month. The funding button is absent outside the actual current month; future funding was therefore not submitted. [Evidence](ui-audit-2026-10-03/23-future-plan.jpg).
- Home provides one-tap help for Ready to assign, but Cash you hold and Set aside lack inline definitions in the money breakdown. Their definitions are available in the glossary. [Evidence](ui-audit-2026-10-03/01-home-expanded.jpg).
- Investment and loan success messages are generic. A $50 investment loss entered as a new value of $100 says “Recorded $100 for [investment]”; name the action and resulting value instead.
- Correction detail retains labels such as “spent” beside a positive $20 reversal. The signs and actual reversal are correct, but “expense reversed” would explain the action better. [Evidence](ui-audit-2026-10-03/25-correction.jpg).
- Change purpose closes immediately after saving, while most other mutations show a confirmation. Consistent success feedback would make completion easier to verify.
- Note disclosure repeats the “Note (optional)” label inside the expanded section. [Evidence](ui-audit-2026-10-03/05-income-preview.jpg).

## Numbered interaction checklist

“Pass” means the observed result matched the input and expected money movement in this run. “Needs work” can include a UI issue even when the stored balances are correct. Screenshot files are unedited browser captures from this audit; raw notes are [audit-notes.json](ui-audit-2026-10-03/audit-notes.json).

| Step | Actions and inputs actually exercised | Health | Evidence |
|---|---|---|---|
| 1 | Home USD/LBP switching; money breakdown, attention, upcoming bills and plan details disclosures; Ready explanation; primary funding action | Needs work: funding dead end and incomplete inline definitions | [Home](ui-audit-2026-10-03/01-home-expanded.jpg), [dialog](ui-audit-2026-10-03/02-home-funding-dead-end.jpg) |
| 2 | Add USD wallet “UI audit cash” with $500; switch have/owe controls; add “UI audit card” owing $100 | Pass: positive cash and negative debt-wallet confirmation | [Cash](ui-audit-2026-10-03/03-wallet-added.jpg), [card](ui-audit-2026-10-03/04-negative-wallet-confirmation.jpg) |
| 3 | Income $50 to audit cash and Ready with a note; Record another; income $5 directly to Rent | Pass: cash rises and only chosen purpose receives money | [Preview](ui-audit-2026-10-03/05-income-preview.jpg), [saved](ui-audit-2026-10-03/06-income-saved.jpg) |
| 4 | Expense $20 from audit cash for Rent holding $5; cover $15 from Ready; save; Record another; exact description reuse | Pass: shortfall is explicit and saved; reusing description fills amount, wallet and purpose | [Shortfall](ui-audit-2026-10-03/07-expense-shortfall.jpg) |
| 5 | Move $50 Ready → Rent; save; inspect identical-source default with $1 | Needs work: valid move reconciles, identical-purpose preview contradicts itself | [Valid move](ui-audit-2026-10-03/08-change-purpose-preview.jpg), [invalid default](ui-audit-2026-10-03/31-identical-purpose.jpg) |
| 6 | Between wallets $10 audit cash → audit card | Pass: cash decreases, card debt reduces from -$100 to -$90; total cash unchanged | [Preview](ui-audit-2026-10-03/09-transfer-preview.jpg) |
| 7 | Exchange $10 → LBP 895,000; reverse LBP 89,500 → $1; choose source/destination/purpose; save both | Needs work: correct saved amounts, wrong displayed rate in both directions | [Forward](ui-audit-2026-10-03/10-exchange-preview.jpg), [reverse](ui-audit-2026-10-03/32-reverse-exchange.jpg) |
| 8 | Refund $5 to audit cash and Rent | Pass: wallet and purpose increase, treated as refund rather than new income | [Preview](ui-audit-2026-10-03/11-refund-preview.jpg) |
| 9 | Add audit investment with existing value $100; contribute $50 from cash, cover from Ready | Pass: investment becomes $150; contribution is separate from market gain | [Contribution](ui-audit-2026-10-03/12-investment-contribution.jpg) |
| 10 | Investment value $150 → $100; withdraw $150 invalid, then $50 valid; investment fee $2 | Needs work: loss/value and valid withdrawal reconcile; invalid withdrawal gives loan error | [Loss](ui-audit-2026-10-03/13-investment-loss.jpg), [error](ui-audit-2026-10-03/14-overwithdrawal-error.jpg) |
| 11 | Investment return $5 paid to wallet; return $3 reinvested | Pass: cash return leaves investment unchanged; reinvestment increases value without changing cash | [Cash return](ui-audit-2026-10-03/15-investment-cash-return.jpg), [reinvested](ui-audit-2026-10-03/16-investment-reinvested.jpg) |
| 12 | Add debt $100 owed to Audit lender; borrow $50 into audit cash | Pass: amount owed becomes $150 and cash rises $50 | [Borrowed](ui-audit-2026-10-03/17-loan-borrow.jpg) |
| 13 | Repay $20 principal, $2 interest and $1 fee from audit cash/Rent; expand and collapse optional fields | Pass: total paid $23, debt becomes $130, purpose decreases $23; hidden fees remain included | [Repayment](ui-audit-2026-10-03/18-loan-repayment.jpg) |
| 14 | Add zero-opening receivable; lend $30 to Audit borrower; collect $10 principal plus $1 interest | Pass: cash changes -$30 then +$11; amount owed to user ends $20 | [Lend](ui-audit-2026-10-03/19-loan-lending.jpg), [collect](ui-audit-2026-10-03/20-loan-collection.jpg) |
| 15 | Plan editor expected income and group share; invalid share 101; add zero-share audit group/item; inspect Monthly/Reserve/Goal/Loan types; fill optional target/date and loan choice; reorder temporary items/groups up/down; remove draft item/group; switch every group; save and cancel | Pass: invalid plan blocks saving; ordering and draft removals work; zero-share group persists without changing existing shares | [Editor](ui-audit-2026-10-03/21-plan-editor.jpg) |
| 16 | Open Rent statement; expand full breakdown; Move money in/out and Record expense shortcuts | Pass: statement reconciles; shortcuts preselect Rent in the right field | [Statement](ui-audit-2026-10-03/22-item-statement.jpg) |
| 17 | Plan next month, previous/current navigation and This month reset | Needs work: month data changes correctly, summary heading stays “This month” | [November](ui-audit-2026-10-03/23-future-plan.jpg) |
| 18 | Add audit bill $3; fill optional end date; select Yearly/Once/Monthly; save Monthly; edit to $4; Skip, Undo skip, Pay; stop future reminders | Pass: payment changes cash/Rent by $4 and advances next due to Nov 4; stopping reminders removes the active reminder | [Paid](ui-audit-2026-10-03/24-bill-payment.jpg) |
| 19 | Activity Show more; search; type, month, wallet and purpose filters; inspect audit expense; Correct with a reason; submit reversal; inspect original/correction history | Pass with wording issue: exact $20 cash/$15 coverage reversal, original marked corrected and preserved | [Correction](ui-audit-2026-10-03/25-correction.jpg) |
| 20 | Settings save reference rate 89,500 effective Oct 4; invalid `abc` submission; glossary open/Done | Needs work: valid rate saves, invalid value gives no explanation; glossary works | [Invalid rate](ui-audit-2026-10-03/26-invalid-reference-rate.jpg) |
| 21 | Restart guided tour; Next across all ten steps; Back; Finish; restart and Skip | Pass: step changes and exit controls work | Text observations in [notes](ui-audit-2026-10-03/audit-notes.json) |
| 22 | Temporarily increase expected income $4,110 → $4,210 to expose funding fields; enter $1,800 above Ready; inspect all group suggestions; zero other groups and save $10 to Other essentials; restore expected income $4,110 | Pass: excessive total blocked with explicit available-money message; partial $10 proposal saves and reduces Ready by $10 | [Funding](ui-audit-2026-10-03/27-funding-preview.jpg) |
| 23 | English Plan at 390×844 CSS viewport; Arabic switch; Arabic Plan editor and cancel | Pass for inspected states: readable mobile layout and reachable dialog actions | [English](ui-audit-2026-10-03/28-mobile-plan.jpg), [Arabic editor](ui-audit-2026-10-03/29-mobile-arabic-editor.jpg) |
| 24 | Arabic mobile expense “UI audit mobile”; enter Arabic digit `١`; select Rent; submit; Done; restore English and desktop viewport | Pass: recorded exactly $1 with Arabic confirmation | [Saved](ui-audit-2026-10-03/30-mobile-arabic-saved.jpg) |
| 25 | Sign out; inspect Create account/Sign in states; Show/Hide password with empty field; sign into Fresh sample then Existing sample | Pass for navigation/toggle/sample sign-in; no new credentials created | DOM observations; first-time onboarding unavailable in these already-configured sample accounts |
| 26 | Open Record then press Escape; inspect restored focus; inline Ready help | Pass for this keyboard case: dialog closes and focus returns to Record | DOM focus observation; not a complete accessibility audit |
| 27 | Inspect final Home money equation and account balances | Pass: USD cash $8,043.20 = set aside $6,370.40 + Ready $1,672.80 | [Final balances](ui-audit-2026-10-03/33-final-demo-balances.jpg) |

## Final demo state and limits

Audit cash is $549, audit card -$90, audit investment $51, audit debt $130, audit receivable $20. LBP cash is LBP 3,490,500. The original $20 audit expense has a reversing correction; the $4 audit bill payment and $1 mobile expense remain. The bill’s future reminders were stopped. The zero-share audit group/item remains. Other essentials received $10 during the funding test. Expected income was restored to $4,110. Reference rate remains 89,500, now effective October 4. The browser was restored to English desktop Home in the Existing money sample account.

This covers the main unique actions and mutation workflows, not every repeated row button, every currency/date combination, or every possible invalid-input boundary. First-time onboarding was unavailable because both sample accounts already have spaces. A new real account/password was not created. No claim is made about exhaustive accessibility, cross-browser compatibility, production authentication or concurrency. The console inspection showed an existing Supabase multiple-client warning; no additional runtime error was visible in that inspection.

Application tests were not rerun for this documentation-only audit. Earlier passing automated checks do not invalidate these newly observed interaction issues. The October 3 visual QA sign-off is superseded by this interaction audit for completion/readiness claims.

---

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

## Production release follow-up — 2026-10-04

The owner authorized clearing old app data and re-entering it in v2. The
production database and frontend are now released; four login accounts remain.
Current validation: 165 SQL tests, 110 UI tests, and 5 local browser flows
passed. The local browser tests now follow the owner's existing redesign.
Earlier dated claims of no deployment describe the pre-release checks only.
See the production release record in docs/operations for scope and limitations.
