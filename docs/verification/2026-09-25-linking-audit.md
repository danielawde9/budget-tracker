# Cross-feature linking audit: plan, allocation, goals, bills, expenses, loans, onboarding

**Date:** 2026-09-25. **Source:** local `main` at `7fc7ec2`.

**Method:** six parallel read-only source audits:

- A: plan ↔ actuals
- B: allocation ↔ plan ↔ goals ↔ loans
- C: goals ↔ cash
- D: bills ↔ expenses ↔ loans
- E: month keying and clocks
- F: first-run and onboarding

The lead session then re-read the highest-impact claims itself.

**No tests were run to produce these findings, and nothing was changed.** A finding
from reading the code is a hypothesis until a failing test proves it. Every fix packet
starts with a red reproducer, per `superpowers:systematic-debugging` and TDD.

The audit covers source only. Whether the live database has the later migrations
(goals, recurring, available cash, month transitions, journal search) is not recorded
in the repository.

| Label | Meaning |
| --- | --- |
| **Verified** | The lead session re-read the cited code on 2026-09-25, and the behavior follows from it. |
| **Traced** | An audit agent traced it end to end in source. The lead did not re-read it. |
| **Suspected** | Plausible, but needs a reproducer. |
| **Decision** | Matches an entry in `docs/decisions.md`. Treat it as a product question, not a defect. |

Paths: `M/` = `supabase/migrations/<timestamp>_`; `F/` = `src/features/`.

## 1. Fix-now list (ranked)

These give wrong money numbers or corrupt data in ordinary use today, whatever
the payday and onboarding work decides. Each is a separate bug packet.

| Rank | ID(s) | Status | Defect | Evidence | User-visible effect |
| --- | --- | --- | --- | --- | --- |
| 1 | C2 | Verified | Goal Edit, Pause and Close divide stored amounts by 100 whatever the currency. LBP has no minor unit. | `F/goals/goal-editor.tsx:146,163,170`; `F/wallets/money.ts:12` | Saving an LBP goal cuts its target, milestones and monthly amount by 100×. USD goals lose their cents. **Data corruption.** |
| 2 | A2, E2b | Verified | Control Room Journal **Undo** reverses with `effectiveDate: todayIso()` (UTC today). It should use the original date. | `F/control-room/routes.tsx:300`; contradicts `docs/decisions.md` 2026-09-11 "Undo on the original date" | Undoing last month's mistake leaves last month overspent and credits this month. Regression of an approved decision. |
| 3 | B1, A4 | Verified | Allocation can be published only for the first month per currency. The UI sends the month snapshot's template id, which is `null` in a new month. The head check covers the whole space and currency, so it fails with `40001`. | `F/allocation/allocation-setup.tsx:127`; `M/20260916100000_month_transitions.sql:1302`; `M/20260914120000_allocation_commands.sql:404-407`; proven by `tests/db/allocation-commands.integration.test.ts:266-273` | Every month after the first fails with "changed elsewhere", and Refresh cannot fix it. Available cash says "No published plan". |
| 4 | D2 | Verified | `available_cash_summary` needs occurrences generated to today+89. The only UI refresh generates to today+60. | `M/20260914180000_available_cash_projection.sql:305,323,331`; `F/control-room/routes.tsx:389-390` | With any monthly or weekly bill, "Available after commitments" never becomes `ready`. It stays on "needs a refresh". |
| 5 | B5, A1 | Verified | The Plan category page counts spending only on the exact category. Subcategory spend is not rolled up to its root. Home and Allocation do roll it up. | `M/20260912101000_monthly_budget_planning.sql:251-272`; Home `M/20260914090000_planning_projection_contracts.sql:82-89`; ledger requires rollup (`docs/decisions.md:719-726`) | A root shows $0 of $400 while its subcategories hold the spending. Plan and Home disagree. Edit on a subcategory row always fails. |
| 6 | B4, A3, F12 | Traced (×3) | The Plan page loads one 50-row page and never asks for the next. There are 2 rows per category, subcategories included. | `F/plan/plan-client.ts:17,142-152` | Only the first 25 expense categories appear. The rest disappear silently but still count in "Left to allocate". |
| 7 | D3, D7 | Verified | Auto-settle marks a bill paid only when exactly one pending occurrence in ±31 days matches. Failures are swallowed by an empty `catch`. | `F/recurring/auto-settle.ts:28-36,71-73` | A monthly bill paid on or after its due date matches both this month's and next month's occurrence, so it stays unpaid. Weekly bills never settle. The user is never told. |
| 8 | D5 | Verified | Loan repayments never settle their `debt_payment` occurrences, because auto-settle runs only for `expense`. Live debt is `greatest(reservation left, unsettled installments)`. | `F/control-room/routes.tsx:609`; `M/20260914180000_available_cash_projection.sql:180-192` | After repaying, the instalment is still held back from Available. The outlook subtracts it again. |
| 9 | D1 | Verified | The Upcoming list loads from today onward, but projections count unpaid bills with no lower date bound. The outlook puts overdue bills on day 0. | `F/control-room/routes.tsx:389`; `M/20260914180000_available_cash_projection.sql:188,547-555`; filter list `F/recurring/upcoming-page.tsx:31` | Overdue bills vanish from the list, and the "Overdue" tab can never match. They still reduce Available and the outlook, and can't be skipped or linked. |
| 10 | C3, B6 | Verified | No UI calls `publishMonthV2` or the goals `setMonthlyTarget`. Goal monthly targets never reach the plan or the Future group. | grep across `src/`: only test fakes, gateways and hooks | "Monthly target: None set" always. Available subtracts new earmarks and the full Future headroom. Example: income 3000, Future 600, reserve 600 → Home shows −600 instead of 0. |
| 11 | E1, E2a, A7, D12 | Verified in part | Two clocks. Home's and Plan's month and the record date are browser-local; "today", confirm and auto-settle are UTC. | `F/control-room/routes.tsx:139-146` (local `currentMonthStart` next to UTC `todayIso`); `F/control-room/record-sheet.tsx:120-123`; `M/20260914170000_recurring_schedules.sql:1058-1060` | In Beirut from 00:00 to 02:00 or 03:00, Home shows October's budget while Available computes September. A bill paid then fails to link and stays reserved. |
| 12 | C1 | Traced | The goal top-up trigger checks earmark lines against target − every link, without netting purchases and including reversed links. | `M/20260914150000_goal_commands.sql:648-659` vs `:728` | Once any purchase is linked, adding money to that goal fails with `23514`. |
| 13 | E4, A8, B13 | Traced (×3) | The Plan page's "Loan commitments" card uses the Loans hook's own UTC month, not the selected month. | `F/control-room/routes.tsx:514,624`; `F/loans/use-loans.ts:19-35` | Pick August and the card still shows September. It contradicts "Left to allocate". |
| 14 | B2, B3 | Traced | The allocation editor checks income against the snapshot's revision, not the Plan's. It pre-fills targets from the snapshot. | `F/allocation/allocation-setup.tsx:41,46,136` | Publishing fails if Plan income changed. Confirm silently writes old snapshot targets back over Plan edits. |
| 15 | F1, F2, F3 | Verified | Onboarding shows only when there are zero spaces and stores no progress. "Add another space" swallows Escape and has no close. There is no starting-balance step. | `F/workspace/use-workspace.ts:43-60`; `F/workspace/onboarding-dialog.tsx:61-63,99-116` | Abandon after step 1 and you're stuck on Home with no wallet. The extra-space dialog can't be cancelled. Home shows $0.00 until a balance is added elsewhere. |

## 2. How the pieces link today

- **Plan.** `monthly_budget_plan_revisions` holds income and root targets per calendar month and currency. It is append-only and the latest revision wins. There are two writers: the Plan tab (`plan-client` → `usePlan` → `PlanPage`) and allocation publish (v1).
- **Allocation.** A per-currency template holds group %, the root → group map and the loan group. An immutable month snapshot freezes group amounts, mappings and the observed loan pool.
  - v1 publish (the only one the UI calls) also writes Plan income and targets.
  - Goal lines exist only in v2, which no UI calls.
  - Later Plan edits drift from the snapshot; the only signal is a banner.
- **Actuals.** Recomputed from the journal on every read, bucketed by the client-supplied `effective_date`.
  - A reversal counts on its own date, under the original event's kind and category.
  - Transfers, exchanges, opening balances and all loan kinds are excluded. Goal purchases count as ordinary spending.
- **Goals.** Advisory earmarks, not tied to any wallet. Cash coverage hands out each currency's cash by priority.
  - A purchase links an existing expense via a pasted ID, or a goal-funded bill's confirmation. No expense is ever created.
- **Bills.** `save_schedule` writes immutable revisions. Occurrences are generated only by the "Refresh occurrences" button, for today to today+60. Settlement is an append-only event stream, so reversing a payment reopens the bill.
  - Recording an expense tries auto-settle. Income and loan repayments never do.
- **Loans.** Two unconnected models: monthly reservations (`loan_monthly_target_revisions`) and `debt_payment` schedules. Both cover only `i_owe_them`.
- **Available after commitments** = cash − goal claims − Σ bucket[max(B, O) − goal cover] − Σ loan max(reservation, unpaid scheduled debt) − goal top-ups − Future headroom.
  - B = target + carry − spend so far this month.
  - O = unpaid bills due by month end, with no lower bound.
  - Calendar month and UTC today only.
- **60-day outlook** = cash + unpaid scheduled income − unpaid bill and debt occurrences. Overdue items go on day 0. Budgets and reservations are not included.
- **Month transitions** (task 20: close, copy, signed rollover) exist in SQL only. No UI calls them. A close is refused until the UTC calendar month has ended.

## 3. Findings by area

### 3.1 Plan ↔ actuals ↔ month transitions (A)

| ID | Sev | Status | Finding | Evidence |
| --- | --- | --- | --- | --- |
| A1 | HIGH | Verified | = B5, see §1 rank 5. v2 drops subcategory spend entirely. | `M/20260914090000_planning_projection_contracts.sql:269-293` |
| A2 | HIGH | Verified | = §1 rank 2. `reverse_financial_event` doesn't check that a reversal date is on or after the original. | `M/20260908103000_harden_reverse_financial_event.sql:27-29` |
| A3 | HIGH | Traced | = B4, see §1 rank 6. | `F/plan/plan-client.ts:17,152` |
| A4 | HIGH | Verified | = B1, see §1 rank 3. | |
| A5 | MEDIUM | Traced (MISSING) | Copy, close and rollover have no UI (tasks 21 and 22 pending), so every month starts from zero. | `docs/decisions.md:3563` |
| A6 | MEDIUM | Traced | Archived targets are hidden but still counted, and a target can't be set to 0. The allocation complete-set rule requires them, so republishing fails. | `F/plan/plan-page.tsx:74,141`; `M/20260912101000_monthly_budget_planning.sql:167`; `M/20260914160000_goal_projections.sql:785-801` |
| A7 | MEDIUM | Verified in part | = §1 rank 11. | |
| A8 | MEDIUM | Traced | = E4, see §1 rank 13. | |
| A9 | MEDIUM | Traced | The month picker only goes backward, so next month can't be planned. After going back, the current month is unreachable. | `F/control-room/home-screen.tsx:27-35,233` |
| A10 | MEDIUM | Decision | Two editors (the Plan tab and Allocation) and one frozen snapshot. Close and copy use snapshot values, so they ignore Plan-tab edits. There are two "Left to allocate" formulas. | `M/20260912101000_monthly_budget_planning.sql:207` vs `M/20260916100000_month_transitions.sql:1214`; open follow-up `docs/decisions.md:2023-2033` |
| A11 | LOW | Traced | A month with no plan shows every category in warning colour. | `F/control-room/home-screen.tsx:100-103` |
| A12 | LOW | Suspected | A goal purchase in a rollover category may carry a negative amount into next month. Test: close a rollover root with a linked purchase. | `M/20260916100000_month_transitions.sql:410-446` |

### 3.2 Allocation ↔ plan ↔ goals ↔ loans (B)

| ID | Sev | Status | Finding | Evidence |
| --- | --- | --- | --- | --- |
| B1 | HIGH | Verified | §1 rank 3. | |
| B2 | HIGH | Traced | Publish checks income against the snapshot's revision, not the Plan's. | `F/allocation/allocation-setup.tsx:136`; `M/20260914100000_planning_command_foundation.sql:214` |
| B3 | HIGH | Traced | The editor pre-fills targets from the snapshot but checks the current Plan revision. It silently reverts Plan edits. | `F/allocation/allocation-setup.tsx:41,46` |
| B4 | HIGH | Traced | §1 rank 6. | |
| B5 | HIGH | Verified | §1 rank 5. | |
| B6 | HIGH | Verified | = C3, see §1 rank 10. The goal editor's "Planned income" option uses the whole income. | `F/goals/goal-editor.tsx:255` |
| B7 | MEDIUM | Decision | The Future group's debt actual is frozen at publish. Publishing before the loan target is set gives $0 for the whole month. | `M/20260916100000_month_transitions.sql:1190,1223`; ledger ~L1924 |
| B8 | MEDIUM | Traced | Future headroom uses debt as of publish, and `needsReview` ignores loan changes. | `M/20260914180000_available_cash_projection.sql:174-192,350-379,385-387` |
| B9 | HIGH | Decision | The same "Left to allocate" label uses two formulas. Example: $2,000 split 56/24/20, $1,000 root targets, $150 loan. Plan says $850; Allocation says $0. | see A10 |
| B10 | MEDIUM | Traced | An archived root with a target blocks republishing from the UI. | `F/control-room/routes.tsx:643-644`; ledger L3538 (known v2 rule) |
| B11 | MEDIUM | Traced | Editing re-links debt to the first Future group, so a "Standalone" choice silently flips. | `F/allocation/allocation-setup.tsx:109` |
| B12 | MEDIUM | Traced | "View" on Unmapped or Uncategorized sends `groupId null`, which returns every snapshot root. | `F/allocation/allocation-setup.tsx:162-165`; `M/20260916100000_month_transitions.sql:1367` |
| B13 | LOW | Traced | = E4. | |

Tests miss B1–B4 because `src/test/in-memory-allocation-gateway.ts` never checks
revision heads, and the e2e specs use fixtures.

### 3.3 Goals ↔ wallets/journal ↔ available cash (C)

| ID | Sev | Status | Finding | Evidence |
| --- | --- | --- | --- | --- |
| C1 | HIGH | Traced | §1 rank 12. The API-only reverse can also push an earmark below zero. | |
| C2 | HIGH | Verified | §1 rank 1. | |
| C3 | HIGH | Verified | §1 rank 10. | `M/20260914160000_goal_projections.sql:106-107` (`monthly_minor` is read by nothing) |
| C4 | HIGH | Traced | Linking a purchase needs a pasted expense ID. IDs appear only on reversal cross-references and not in the CSV. The earmark outlives the purchase, so it is counted twice. | `F/goals/goal-purchase-dialog.tsx:53,83`; `F/control-room/journal-screen.tsx:318-347`; `F/wallets/journal-csv.ts:21-24` |
| C5 | MEDIUM | Traced | Editing resets priority to 0, which reorders coverage. | `F/goals/goal-detail.tsx:241` |
| C6 | MEDIUM | Traced | Paying a goal-funded bill dated before the goal's reserve fails. After auto-settle the bill stays pending, so it is counted twice. | `M/20260914170000_recurring_schedules.sql:948-966,1104-1122`; `M/20260914150000_goal_commands.sql:1049-1073` |
| C7 | MEDIUM | Traced | Closed goals disappear from list and detail. Closing lands on an error with no Back. | `M/20260914160000_goal_projections.sql:25-26,269-273`; `F/goals/goal-detail.tsx:141-157` |
| C8 | MEDIUM | Traced | A checklist milestone can't be toggled after reopening, because the milestone event IDs are never returned. | `F/goals/goal-milestones.tsx:27,35`; `M/20260914150000_goal_commands.sql:556-560` |
| C9 | MEDIUM | Decision | Paying a bill funded by a paused goal leaves the earmark untouched, although the earmark already offset the bill. | `docs/decisions.md:2476-2482` vs spec |
| C10 | MEDIUM | Decision | When a goal covering a bill is short of cash, the shortfall is counted twice. | `M/20260914180000_available_cash_projection.sql:16-37,135` |
| C11 | LOW | Traced | Reserve goals accept purchase links. | `M/20260914150000_goal_commands.sql:936-1088` |
| C12 | LOW | Traced | The bill "Funding goal" picker offers goals the database rejects. | `F/control-room/routes.tsx:392-403` |
| C13 | LOW | Traced | Only the first 25 goals load. | `F/goals/use-goals.ts:129` |
| C14 | LOW | Traced | The 200-goal cap counts closed goals. | `M/20260914150000_goal_commands.sql:224-227` |

### 3.4 Bills ↔ expenses ↔ loans ↔ outlook (D)

| ID | Sev | Status | Finding | Evidence |
| --- | --- | --- | --- | --- |
| D1 | HIGH | Verified | §1 rank 9. | |
| D2 | HIGH | Verified | §1 rank 4. | |
| D3 | HIGH | Verified | §1 rank 7. Also missed: root vs subcategory, partial and over-payments, a USD bill paid in LBP, and no `kind` filter. | |
| D4 | HIGH | Traced | The manual fallback is a dead end. "Link" needs a transaction ID no screen shows. "Record payment" posts a second expense. Debt occurrences are link-only, so they can never be settled. | `F/recurring/confirm-payment-dialog.tsx:53,97-101,152`; `F/recurring/occurrence-detail.tsx:153` |
| D5 | HIGH | Verified | §1 rank 8. | |
| D6 | HIGH | Suspected | Debt set up only as a schedule is also held in Future headroom. Test: Future/loan group 400, no loan target, debt schedule 200 → expect cash−400, get cash−600. | `M/20260914160000_goal_projections.sql:1107-1110` |
| D7 | MEDIUM | Verified | Auto-settle is silent, never retried and can't be undone. The sheet can wait 2×15 s. | `F/recurring/auto-settle.ts:71-73`; `F/planning-shared/rpc.ts:12` |
| D8 | MEDIUM | Traced | Recorded income never settles an income schedule. An early salary is counted twice in the outlook, and "received" looks the same as "not received". | `F/control-room/routes.tsx:609`; `M/20260914180000_available_cash_projection.sql:537-545` |
| D9 | MEDIUM | Decision | The outlook and Available disagree on debt. The outlook leaves out loans with only a reservation and money others owe me. | `M/20260914180000_available_cash_projection.sql:180-192` vs `546-555` |
| D10 | MEDIUM | Traced | The Upcoming list stops at 25 rows; `loadMore` is never used. | `F/recurring/use-recurring.ts:104,245` |
| D11 | MEDIUM | Traced | Paid-off loans keep producing instalments. | `M/20260914170000_recurring_schedules.sql:483-500` |
| D12 | LOW | Verified in part | = E2a. | |
| D13 | LOW | Traced | The editor allows an interval of 1–99 but SQL allows 1–12. Dropdowns aren't filtered. The "Unpaid bills" label hides budgets. | `F/recurring/schedule-editor.tsx:206`; `M/20260914170000_recurring_schedules.sql:30`; `F/cash-control/cash-control-summary.tsx:38` |

Commit `9dbf6f0`'s matching rules have no `docs/decisions.md` entry.

### 3.5 Month keying and clocks (E)

- **Keys.** `month_start` (CHECK = 1st of the month) sits on plan revisions, allocation snapshots, goal targets and closes. Carry target = source + 1 month. Composite FKs and head chains use it.
  - Loan `target_month` has no CHECK (`M/20260907145000_monthly_loan_planning.sql:7`).
  - `financial_events.effective_date` is a client-supplied `date` (`M/20260907110000_wallet_journal.sql:30`).
- **Windows.** About 16 read functions use `[p_month, p_month + 1 month)`. Reports, allocation and goals reject a month that isn't the 1st; plan and loans silently truncate it.
- **Today.** 20 SQL sites use `(now() at time zone 'UTC')::date`. The cash RPCs reject any other as-of date.
  - Spaces have **no timezone and no payday** (`M/20260907100000_spaces.sql:6-11`). Roadmap row P1 promised a per-space timezone.
- **E1 (HIGH, verified in part):** two clocks, see §1 rank 11.
- **E2 (HIGH):**
  - (a) Record posts the local date, but `link_scheduled_payment` rejects dates after UTC today, and auto-settle swallows the error.
  - (b) Reversals are dated UTC today (§1 rank 2).
- **E3 (MEDIUM, traced):** future-dated entries count in Net position (`wallet_balances`, no date filter) but not in cash or Available. The date input has no `max`.
- **E5 (MEDIUM, traced):** Home's Budget vs actual reads plan revisions only; Available uses the snapshot plus carry. Two budgets.
- **E6 (LOW, traced):** the month dropdown ends at the selected month. `created_at::date` depends on the session TimeZone (`M/20260914160000_goal_projections.sql:128,222,306`).
- **E7 (MISSING):** no test runs in a non-UTC timezone, and no ledger entry covers local vs UTC.

### 3.6 First-run and onboarding (F)

- **F1 HIGH (verified):** onboarding shows only when there are zero spaces. No progress is stored, so abandoning after the space step lands on Home with no wallet.
- **F2 HIGH (verified):** "Add another space" can't be cancelled. Escape is swallowed and there's no close control. It also forces a wallet.
- **F3 HIGH (verified):** there is no starting-balance step, so Home shows $0.00. Entering a starting balance twice double-counts.
- **F4 MEDIUM (traced):**
  - Language resets to English on every load (`src/app.tsx:228-234`).
  - Onboarding hardcodes "Budget ledger" and has English-only errors (`F/workspace/use-workspace.ts:17,92-115`).
- **F5 MEDIUM (traced):** network-failure recovery accepts any existing space or wallet with the same name (`F/workspace/use-workspace.ts:95,114`).
- **F6 MEDIUM (traced):** the copy says wallets and invitations come "in a later milestone" (`F/workspace/onboarding-dialog.tsx:20-22,31-33`). A test asserts it (`onboarding-dialog.test.tsx:40`).
- **F7 MEDIUM (traced):** there are no starter categories, and empty states that need categories don't link to Categories (`F/control-room/home-screen.tsx:53-71`).
- **F8 MEDIUM (traced):** bills can't be re-entered without duplicates. `schedule-editor.tsx:253` sends a new id every time, and no schedule-list RPC exists. Home's "needs a refresh" has no button.
- **F9 MEDIUM (traced):** Home's headline resets each calendar month and month copy has no UI, so a plan made in onboarding expires at month end.
- **F10 MEDIUM (traced):** onboarding doesn't follow the design guidelines (its own dialog, `.segmented` radios, no `cr-wizard-*`). Its RPCs have no timeout.
- **F11 LOW (traced):** creating a category from the Record sheet has no error handling; failures are silent (`F/control-room/record-sheet.tsx:615-637,714`).
- **Idempotency for a re-runnable wizard:**
  - Not safe to re-run:
    - `create_space` and `create_wallet` have no request id, and names aren't unique.
    - Opening balance is idempotent only within one request.
    - Schedules, goals and loans have no natural key and get random client ids.
  - Safe to re-run: category creation (unique active names), plan income and targets, allocation (expected ids and receipts), and invitations.

### 3.7 Release operations (O)

- **O1 MEDIUM (verified):** the release manifest is out of date.
  - `ops/budget-migrations.sha256` (49 rows, `source_sha=87e5af7`) and `LIVE_VERIFY_SQL` in `scripts/ops/apply-live-migrations.sh` (49 versions) omit `20260919100000_journal_search_page.sql`. It was added by commit `3318f00`, which did not regenerate the manifest, and no ledger entry explains why.
  - `migrate-budget.sh verify-manifest` fails closed with `unmanifested migration file` (exit 79), so the next `pnpm migrate:live` would refuse to run. That is safe, but it blocks every release until the manifest is regenerated.
  - `tests/ops/live-migrations.test.ts` passes (9/9 on `e149057`) because it checks only the script's constants and never compares the manifest with the migrations folder. That missing check is the detector the fix must add.

## 4. Missing features users would expect

- UI for month copy, close and rollover policy. Allocation history and trend.
- Schedule management: list, edit, pause, end, "new amount from date X", and skip or move one occurrence.
- A transaction picker for linking bills and goal purchases. Unlink or re-assign a payment. "This paid bill X" and a bill badge on journal rows.
- Auto-settle for income and for loan repayments. Automatic occurrence generation. Reminders.
- Paying a USD bill or goal from LBP, and funding an LBP budget from USD income.
- "Buy it" on a purchase goal: record the categorized expense, link it and close the goal. Goals on Home. An archive of closed goals. The date each milestone was reached.
- A breakdown of the Future group (loan pool vs goals vs headroom). A prompt for unmapped categories.
- Plan tab: show received income, uncategorized spending and total spending. The RPC returns them but nothing renders them.
- A per-space timezone and payday. Persisted language. Starter-category suggestions.
- Twice-a-month and last-business-day schedules. Expected repayments for money I lent.

## 5. Headline numbers

| Number | Formula | Period |
| --- | --- | --- |
| Net position | Σ non-archived wallet balances | All time, including future-dated entries |
| Available after commitments / Shortfall | cash − goal claims − expense − debt − goal top-ups − Future headroom | Cash up to UTC today. Commitments for the UTC calendar month. Ignores the month picker. |
| Spendable / Extra per day | max(available, 0); floor(spendable ÷ days left in the month) | UTC month to date |
| Budget vs actual | target − Σ expense per root, reversals netted | Selected month (browser-local) |
| Monthly trend | expense per currency | Selected and previous month. USD cents and LBP units share one bar scale (MEDIUM). |
| 60-day outlook | cash + unpaid scheduled income − unpaid bills | Rolling 60 days from UTC today |

**Payday effect today:** take a salary paid on the 25th. On Sep 26 the rent due Oct 1
is not reserved, and the daily guide divides by 5 days. The headline overstates
what is safe to spend. The formula is sound; the period is wrong.

## 6. Implications for payday periods and onboarding

- **Model:** keep `month_start` as the period key and anchor its date window on the
  space's payday. With an anchor of the 1st, periods match today's calendar months,
  so the existing suite is the regression net. Copy, rollover, composite FKs and
  append-only chains all survive.
  - Before this, add one clock: a per-space timezone and a server-supplied
    "today" and current period.
  - The alternatives both lose. Free-form periods are XL and break every FK. P9
    pay cycles inside the calendar month don't fix the payday defect.
- **Blockers the check-in depends on:** B1–B3 (republishing a month), B5 and B4
  (plan correctness), C3/B6 (goal lines), D2, D3, D5 and D8 (bills and income
  settling), A2 and E1/E2 (dates), and A5 (a close/copy UI).
- **Useful building blocks:**
  - `planning_ordinary_activity(from, to)` for any window up to 366 days
  - `cash_outlook` for any 1–90-day window
  - `scheduled_occurrence_page` for any window up to 90 days
  - `month_copy_preview` and its hash, for "same as last month"
  - `confirm_scheduled_occurrence`, which posts and settles a salary in one idempotent step
  - request-id replay
- **Onboarding needs:**
  - request ids on `create_space` and `create_wallet`
  - deterministic ids or a unique `source_key` for wizard-made schedules, goals and loans
  - a schedule read RPC and a template-head read
  - somewhere to store per-step setup progress and the language
  - a starting-balance step that can be revised
