# Open Budget Tracker: money clarity review

Reviewed October 10, 2026, using the logged-in desktop UI at openbudgetracker.app and the local source. This is a review and proposed design, not an implemented UI redesign. Amounts below are USD and reflect the records visible during the review.

## Main finding

The app needs to distinguish **where money is held**, **what it is reserved for**, and **what was actually spent**. These are different views of the same dollars. Savings earmarked inside Cash must not be added to Cash again, and setting money aside must not be reported as an expense.

Home currently treats the default Savings and Short-term goals balances as spending money. This is a classification issue, not just confusing wording. The starting balances and recorded expenses reconcile, but the funding summary needs investigation.

## What was changed

Removed the unused **Rent** and **Insurance reserve** items from the active plan, as requested. Both had zero planned, funded, spent, and available amounts. The app archives removed items; journal history is retained. Verified that both disappeared from the saved plan and that the monetary totals stayed unchanged. No expense, income, savings contribution, investment, or balance correction was recorded. Product source files were not changed.

## Your recorded money

| Measure | Amount | Time basis / meaning |
|---|---:|---|
| Starting money recorded October 2 | $4,110.00 | Opening balance, not income |
| Income recorded in October | $0.00 | Excludes opening balances |
| Actual October spending | $1,768.50 | Net expenses recorded this month |
| Money still lent out | $80.00 | Receivable, not spendable cash |
| Cash now | $2,261.50 | Cumulative balance across recorded history |
| Tracked cash plus receivables | $2,341.50 | Includes money owed to you; not a claim about unrecorded assets |

The reconciliation is $4,110.00 − $1,768.50 − $80.00 = **$2,261.50**. The zero Received value therefore has a legitimate explanation: starting money was entered as an opening balance. Do not add $4,110 as income again merely to make that label look right.

The current earmarks are Essentials $2,008.50, Guilt-free $205.50, Short-term goals $116.50, and Savings $282.00. They total **$2,612.50**, which is **$351 more than actual cash**. The warning is meaningful. Earmarks need reducing by $351, or an actually missing record needs correcting after checking its source. No allocation was changed during this review.

For illustration, retaining Savings and Goals at $398.50 combined and reducing everyday earmarks by $351 would leave $1,863.00 for everyday spending. This is a possible resolution, not a change already made or a recommendation about which personal priority to reduce.

Actual October spending is Essentials $915.50, Guilt-free $353.00, and purchases recorded under Short-term goals $500.00. Essentials comprises Bills $532.00, Groceries $112.00, Transport $31.00, and Other essentials $240.50. Contributions to savings are excluded from spending.

## Reviewed flow

1. **Home — needs correction.** The cash total and actual spending are useful. “Assigned to spending” includes savings and goals; “Set aside” showed $0 before the empty reserve was removed. The daily chart looks clear, but its planned pace includes savings and investment targets. The allocation chart needs a separate actual-spending chart. The large warning is repeated lower down, and the bottom wallet list duplicates Accounts. The Record plus icon sits above the text.
2. **October Plan — mixed.** Group percentages and item statements are useful. Other essentials is an implicit remainder, not an extra bill. The summary says Still to fund $0 while Other essentials needs $217 and General savings needs $129. The summary and rows must reconcile before the UI can reliably say funding is complete.
3. **Savings and November rollover — working, poorly explained.** November General savings shows $282 carried in, $0 funded, $0 spent, and $282 available. The $411 plan is a new contribution target, not money automatically created. Balances carry forward through the journal, including deficits that have not been covered.
4. **Accounts and Activity — broadly coherent.** Cash, investments, and loans have distinct roles, and the recorded opening balance explains the cash total. Investment contributions are kept separate from gains/losses. Home needs to borrow this clarity instead of repeating the whole account list.

## Proposed structure and wording

Keep five purposes in the monthly money plan, but give them explicit roles:

- **Everyday spending:** Essentials and Guilt-free. Category expenses reduce these spending pools.
- **Savings and goals:** cumulative saved balances, with separate amounts brought forward, added this month, used this month, and left now.
- **Investing:** money planned for investment, contributions actually made this month, and investment account value. A contribution reduces cash and increases an investment asset; it is not household consumption spending.

For Essentials, prefer a **pooled budget**: the group holds the spending allowance while Bills, Groceries, and Transport describe actual expenses. Hide the technical remainder row. The current mixture of a funded Other essentials row and $0 Bills/Groceries targets is hard to interpret. If explicit item budgets are desired instead, fund those items and make movements between them clear; do not show both models as if they were the same thing.

| Current label | Proposed label / treatment |
|---|---|
| In your wallets | **Cash and bank balance**; subtitle “Across all recorded months” |
| Spent this month | **Spent in October** |
| Assigned to spending | **Everyday spending left**; only after fixing classification and the shortfall |
| Set aside | **Savings and goals balance**; includes saved balances across months |
| Over-assigned | **Your earmarks exceed your cash by $351**; action “Adjust earmarks” |
| Ready to assign | **Cash not yet earmarked**; negative state uses the shortfall wording |
| View this month’s plan | One compact **Manage monthly plan** link; remove repeated full-width links |
| Money breakdown (balance disclosure) | **How your cash is earmarked** |
| Money breakdown (daily chart disclosure) | **Daily spending totals** |
| Where your money is assigned | **What your remaining cash is for** |
| New chart | **Where October spending went**; actual expenses by category |
| Expected income | **Income expected this month** |
| Received | **Income recorded this month**; opening balances shown separately |
| Funded | **Assigned this month**; net assignments, not income |
| Still to fund | **Monthly targets left to fund**; must equal the relevant row amounts |
| Available | **Balance left**; subtitle “Includes money carried forward” |
| Change purpose | **Move between budgets and savings**; explain that accounts do not change |
| Other essentials | Hide under the proposed **Essentials pool**, or name **Essentials pool** if visible |

Suggested Home order: cash balance and actual monthly spending; one compact shortfall notice when needed; everyday spending left and savings/goals balance; daily spending trend; remaining-money allocation beside actual spending categories; upcoming bills; recent activity. Keep the full account list in Accounts. On savings, show “Added in October” and “Total saved now” together so the month and cumulative balance cannot be confused.

## Savings and investment answers

**Adding forgotten savings from a previous month:** first determine whether that money is already included in the existing Cash balance. If it is, use Plan → Change purpose, or General savings → Move money in, to earmark existing cash. Use the historical date when reconstructing the history. Do not create income again. If an account balance was never recorded at all, add the missing opening balance/account correctly. If genuine historical income was omitted, record that income once on its real date and then allocate it, avoiding overlap with an opening balance.

**Spending saved money:** General savings currently offers Record an expense, which reduces its balance. A clearer design would record the purchase category and the savings/goal used to fund it separately. A purchase counts as an expense once; moving money between purposes alone does not. Unused savings remain saved next month. The verified $282 carries into November without a new contribution.

**Recording an investment:** use an investment account and the investment record flow. Contributions should reduce the paying account and increase the investment asset, with fees and market changes distinguished. Keep investment contributions visible in the monthly money plan but outside everyday expense comparisons.

## Implementation evidence and priorities

1. **Fix purpose classification first.** `dashboardTotals` and `plannedSpending` classify all `flex` items as spending. Default General savings, Goals money, and To invest are created as flex items. Renaming these rows alone will not fix the numbers. Add a reliable purpose role or migrate the classification while preserving item IDs, journal history, balances, and rollovers. Evidence: [dashboard-model.ts](/Users/daniel/Desktop/Daniel/budget-tracking/src/screens/home/dashboard-model.ts:6), [default plan creation](/Users/daniel/Desktop/Daniel/budget-tracking/supabase/migrations/20261003120200_budget_commands.sql:447).
2. **Reconcile funding summaries.** The live summary says $0 still to fund while visible rows total at least $346 needed. Local SQL intends to sum item-level deficits. Investigate the deployed read path and item/group funding treatment; the precise root cause was not established by this audit. Evidence: [plan totals](/Users/daniel/Desktop/Daniel/budget-tracking/supabase/migrations/20261003120300_budget_reads.sql:126), [item-level deficits](/Users/daniel/Desktop/Daniel/budget-tracking/supabase/migrations/20261003120300_budget_reads.sql:465).
3. **Separate month activity from cumulative balances.** Preserve the rollover journal logic and label both time bases explicitly. Show savings contribution progress against its contribution target, not expense progress against a savings target.
4. **Add actual spending categories and simplify Home.** Keep the daily trend; its planned comparison should use consumption spending budgets only. Show loans and investment contributions separately from expense totals.
5. **Polish the controls and labels.** The Record button uses `gap` without a flex layout. Use an inline flex row with centered icon/text and a deliberate gap. Preserve its existing touch target. Evidence: [shell.tsx](/Users/daniel/Desktop/Daniel/budget-tracking/src/app/shell.tsx), [control-room.css](/Users/daniel/Desktop/Daniel/budget-tracking/src/control-room.css:1127), [owner-redesign.css](/Users/daniel/Desktop/Daniel/budget-tracking/src/owner-redesign.css:88).

The existing desktop layout, restrained palette, navigation, and chart style provide a useful base. Review scope did not establish full accessibility or responsive compliance. Before implementation sign-off, check keyboard/focus behavior, chart data alternatives, 200% zoom, mobile layout, and Arabic/RTL states. Repeated generic disclosure/button names also need clearer accessible labels.

## Screenshots inspected

These are direct screenshots of the live app. The pre-removal Home and Plan captures intentionally retain the original Set aside and Insurance reserve evidence. All saved captures were inspected for relevance and rendering.

### Home overview after removing the unused items

![Home showing the Record icon alignment, $351 shortfall, cash, spending, and the mislabeled spending allocation](/Users/daniel/Desktop/Daniel/budget-tracking/docs/feedback/money-clarity-2026-10-10/00-home-overview.png)

### Original Home classification and charts

![Home showing Set aside at zero while Savings has $282 in the allocation chart](/Users/daniel/Desktop/Daniel/budget-tracking/docs/feedback/money-clarity-2026-10-10/01-home.png)

### October item-level funding

![October plan showing Other essentials needs $217 and General savings needs $129](/Users/daniel/Desktop/Daniel/budget-tracking/docs/feedback/money-clarity-2026-10-10/02-plan.png)

### October summary after removing the unused items

![October summary showing $4,411 funded and zero still to fund](/Users/daniel/Desktop/Daniel/budget-tracking/docs/feedback/money-clarity-2026-10-10/07-plan-summary.png)

### Verified November savings rollover

![November savings statement showing $282 available despite zero new funding and zero spending, with $282 carried in in the plan behind it](/Users/daniel/Desktop/Daniel/budget-tracking/docs/feedback/money-clarity-2026-10-10/03-november-carryover.png)

### Moving existing money between purposes

![Change purpose explains that earmarking does not change wallet balances or create new saving or spending](/Users/daniel/Desktop/Daniel/budget-tracking/docs/feedback/money-clarity-2026-10-10/04-change-purpose.png)

### Accounts

![Accounts separates cash, investments, and amounts lent to people](/Users/daniel/Desktop/Daniel/budget-tracking/docs/feedback/money-clarity-2026-10-10/05-accounts.png)

### Activity

![Activity distinguishes expenses from money assignments](/Users/daniel/Desktop/Daniel/budget-tracking/docs/feedback/money-clarity-2026-10-10/06-activity.png)
