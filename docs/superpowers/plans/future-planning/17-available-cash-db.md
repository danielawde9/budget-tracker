# 17 — Available cash and cash outlook DB

**Layer:** read-only DB projections. **Depends on:** 11,14. **Own:** timestamped
`_available_cash_projection.sql`, `tests/db/available-cash.integration.test.ts`,
`tests/db/cash-outlook.integration.test.ts`, decisions/inventory/evidence17.
No money writer, persisted balance or mandatory reserve is introduced.

## 1. Freeze the accounting calculation

Each currency is independent. Calculate all inputs in one SQL statement snapshot.
No pagination before totals. Current-date only for available cash in v1; reject
p_as_of_date different from database UTC today (historical definitions are not
being reconstructed). Scope is all wallets in this space/currency, including
archived wallets if they retain historical movements. Cash C is signed sum of
all movements through today. It is not income. Loan openings, transfers, FX,
reversals and adjustments affect C even when excluded from ordinary income.

Use latest published monthly snapshot; no snapshot returns state unplanned with
cash/goal/bill facts but availableMinor NULL, not a reassuring guessed number.
If child plan heads changed, still calculate against saved snapshot and return
needsReview=true. If active recurring schedules have missing occurrences in the
needed90day window, return incomplete with availableMinor NULL and materialization
required; reads never create rows.

Reserved goal claims R=sum current nonnegative earmarks, even if cash coverage
is smaller. A claim can make available negative. For bill overlap, allocate
**covered** goal amount to unpaid linked occurrences sorted(due_date,id), oldest
first, across the whole horizon. Each goal dollar can cover at most one bill.
For remaining-current-month commitment only include due≤monthEnd (also overdue),
not all90 future days. Ignore skipped and settled occurrences. A purchase link
reduces cash, claim and unpaid obligation in the same snapshot.

For each expense group g:
- B_g=max(saved group target−net ordinary group spending to today,0).
- O_g=sum unpaid ordinary expense occurrences mapped through the saved root map.
- G_g=sum covered goal money assigned to those unpaid occurrences.
- Q_g=max(B_g,O_g)−min(G_g,max(B_g,O_g)).
This subtracts overlap from **both** the bill and its parent budget. Merely using
max(B_g,O_g−G_g) would double-reserve the goal-funded part of a budgeted bill.

Unmapped roots with explicit targets each form a standalone bucket with the
same formula; no-target unmapped obligations form a standalone obligation bucket.
Uncategorized expense affects total spending/C, never silently mapped to Essentials.
Its unpaid bill is a standalone obligation if it has no root. Return the amount
uncategorized and an actionable count.

For each Future group:
- D=remaining existing planned loan repayment reservation after net paid this month.
  D excludes already paid, income from lent loans, forgiven principal, and openings.
- O_debt=sum remaining debt schedule payments assigned to this currency/loan pool.
- debtCommitment=max(D,O_debt), not D+O_debt. Match by loan ID before grouping;
  residual loan-pool reservation is applied only after identified obligations.
- U=sum max(saved goal monthly target−signed net contribution this month,0).
  Negative contribution increases U; fulfilled purchases do not change contribution.
- H=max(Future group target−saved goal targets−original saved debt commitment,0).
  H is unassigned Future headroom; it does not include funded prior-month earmarks.
Future commitment=debtCommitment+U+H. Standalone goals/debt use the same components
without an extra group target. Report overcommitted groups separately.

`available = C − R − sum(Q_g/standalone Q) − debtCommitments − U − H`.
Return every component, signed availability, and `deficitMinor=max(-available,0)`.
Never clamp available to zero. `incomeMinusSpending` is another metric, not this
formula; include expected/received income and ordinary spending separately.

## 2. SQL helpers and exact RPCs

Implement private helpers with fixed typed columns (space, currency, entity ID,
amount numeric), not JSON-to-float loops:
`planning_goal_bill_coverage(space,currency,today,horizon_end)`,
`planning_cash_commitments(space,currency,today)`. Bound all date windows≤90days;
cap relevant goals200, groups12, roots200, materialized occurrences500 per90day
window; if historical overdue backlog exceeds500, return incomplete with a
specific backlog count and require narrower reconciliation, not truncation.
Build indexed CTEs over existing movement/event, snapshot, goal and schedule
relations. Mark public reads STABLE DEFINER with the 01 access contract.

`available_cash_summary(p_space_id uuid,p_currency currency_code,p_as_of_date date)`
returns JSON keys:
`currency,asOf,state,needsReview,snapshotId,cashMinor,goalClaimsMinor,
expenseCommitmentsMinor,debtCommitmentsMinor,goalTopupsMinor,futureHeadroomMinor,
availableMinor,deficitMinor,spendableMinor,dailyExtraGuideMinor,daysRemaining,receivedIncomeMinor,ordinarySpendingMinor,
incomeMinusSpendingMinor,uncategorizedMinor,unmaterializedCount,groups`.
state ready/unplanned/incomplete; snapshotId and available/deficit nullable as above.
spendableMinor=max(available,0); daysRemaining=monthEnd−today+1 (inclusive);
dailyExtraGuideMinor=floor(spendableMinor/daysRemaining). Both guide/spendable are
NULL when available is unavailable. Label this **extra unassigned cash per day**:
ordinary category budgets have already been reserved in Q, so this is not the
entire daily groceries/transport allowance. For available1001 and3 days return333,
retaining2 minor units in the remainder. Negative available shows deficit and
zero extra guide, never hides the signed negative total.
Group row≤12: `id,nameEn,nameAr,budgetRemainingMinor,unpaidBillsMinor,
goalOverlapMinor,commitmentMinor`. All money numeric→canonical signed text.

`cash_outlook(p_space_id uuid,p_currency currency_code,p_start_date date,
p_days int,p_scenario text)` returns
`{currency,startDate,scenario,assumption,days,firstNegativeDate,state}`.
Require startDate=today, days1…90; scenario expected/no_future_income.
Each day: `date,openingCashMinor,expectedIncomeMinor,expectedOutflowMinor,
closingCashMinor`; firstNegativeDate nullable. Today opening is current cash;
remaining due-today items are projected once; overdue unpaid obligations are
bucketed today with explicit overdue label/count. Income uses unpaid scheduled
income, never the whole monthly planned income. Goal earmarks/contributions are
not cash transfers and are excluded from the cash line. Ordinary spending
forecasts use scheduled items only, not guessed uniform future daily spending.
Labels explain unplanned day-to-day spending can lower the line. No guarantee.

## 3. Exact acceptance examples (minor units)

| Fixture | Expected |
| --- | --- |
| C100000,R0,B50000,O30000,G0 | Q50000,available50000 |
| C100000,R0,B30000,O50000 | Q50000,available50000 |
| C100000,R50000,B50000,O50000,G50000 | Q0,available50000, not0 |
| C100000,R30000,B50000,O50000,G30000 | Q20000,available50000 |
| C20000,R50000,B50000,O50000,G20000 | Q30000,available−60000; claims/coverage shortage visible |
| One goal30000, two bills25000 each, no budget | first covered25000, second5000; total uncovered20000 |
| Future30000, goal target20000, debt10000; contribution5000, paid4000 | U15000,D6000,H0,Future commitment21000 |
| Same loan reservation10000 and scheduled remaining8000 | debt commitment10000, not18000 |
| Monthly planned income100000, no actual/scheduled salary, C10000 | outlook never invents100000 inflow |
| Spend60000, income50000 | incomeMinusSpending−10000 even if C remains positive |

Test skipped/partial/reversed bill, goal-funded payment+inverse, unmapped root,
negative net contribution, late-created old-date payment, current-date rejection,
space/currency isolation and aggregate>bigint returned text. Assert components
sum back to available exactly for generated fixtures. Run both focused files,
full env-loaded DB check and seeded replay; record EXPLAIN on realistic90day
fixtures. Commit `feat(planning): expose available cash and bounded outlook`.
