# Connected money model — design (checkpoint 1: conceptual model)

Date: 2026-10-03 · Status: for owner review · Path: architectural (full redesign)

This document is checkpoint 1 of three: **conceptual model** (this), then **schema and calculation
rules**, then **working preview with verification results**. Nothing is implemented until this
model is approved.

---

## 0. What you asked for, and what I assumed

**Said (owner brief, 2026-10-03):** merge Plan and Allocation into one Plan; connect Goals,
Available cash, Upcoming bills and Loans to one authoritative money model; start from expected
income split into configurable percentage groups that expand into categories, reserves, funds and
goals; support both a zero start and existing balances; only received money can fund anything;
reassignments are not income, savings or expenses; goals say *what money is for*, wallets say
*where it is*; investments separate from spendable cash; loans separate from income and spending;
exact arithmetic for USD and LBP with no implicit conversion; atomic, idempotent, isolated writes
with comprehensible corrections; tests that prove conservation; a live preview with sample data
on a separate environment. Full freedom to replace UI, code and schema; production data may be
reset later; resetting production is not a first step.

**Assumed (each one is logged in `docs/decisions.md` when implemented):** see §11.

---

## 1. Why replace instead of patch

The read-only audit of the current schema (26 migrations, 109 public RPCs) and UI (~33k lines of
source) found that the confusion you describe is structural, not cosmetic:

| Problem in today's app | Consequence |
| --- | --- |
| Plan and Allocation both write income and category targets; goal monthly amounts exist in **three** places, loan targets in three | Two screens can disagree about the same number |
| Goals are *claims* ("earmarks") against one shared cash pool, not money | Goal money is never actually set aside; availability has to subtract claims, budgets, bills, top-ups and headroom separately |
| "Available" = cash − claims − expense commitments − debt − goal top-ups − future headroom | A bill paid from a reserve goal can be counted twice; savings headroom is subtracted each month but never stored, so last month's unassigned savings "come back"; borrowed money counts as cash |
| Two availability formulas (calendar month and payday period) | They disagree whenever payday ≠ 1 |
| The plan is built on **planned** income while cash is **actual** | Before payday, "available" shows a deficit that isn't real |
| Wallet balance views include future-dated events; other reads stop at a date | Competing balances for the same wallet |

The fix is not another subtraction. It is a model where **every dollar has exactly one purpose by
construction**, so availability is a sum, not a formula.

---

## 2. The model in one picture

Every amount of money answers two independent questions:

- **Where is it?** — a **wallet** (bank account, cash, card). Investments and loans are separate
  **tracked accounts**, outside spendable cash.
- **What is it for?** — exactly one **purpose**: an item in your plan (Groceries, Insurance reserve,
  Holiday goal, General savings, To invest…) or **Ready to assign** (money with no purpose yet).

```
          WHERE (wallets)                         WHAT FOR (purposes)
  ┌──────────────────────────┐          ┌──────────────────────────────────┐
  │ Bank            8,444.60 │          │ Ready to assign          1,320.00│
  │ Cash              268.00 │    ==    │ Set aside in plan items  7,392.60│
  │                          │          │   (Groceries, Insurance, Holiday,│
  │ Cash you hold   8,712.60 │          │    General savings, …)           │
  └──────────────────────────┘          └──────────────────────────────────┘
        (per currency; LBP has its own identical equation)
```

**The one invariant:** for each currency, *cash you hold in spending wallets* = *Ready to assign* +
*the sum of all plan-item balances*. The two views show the same money and are never added
together. A goal view and a wallet view cannot double-count, because there is only one pile of
money with two labels on every unit of it.

Everything you see on screen is derived from one append-only journal. Each journal entry records
both sides at once: how wallets changed and how purposes changed. The database refuses an entry
whose two sides don't agree.

### Planning is separate from money

The **plan** (expected income, group percentages, monthly item amounts) is a set of *intentions*.
It never creates, holds or moves money. Only money actually received or already owned can be
**assigned** to purposes. The plan tells the app *how much to suggest* when you assign.

---

## 3. Vocabulary (what the screens say)

| Screen word | Meaning | Not to be confused with |
| --- | --- | --- |
| **Wallet** | Where spendable money is: bank, cash, card (a card's balance may be negative) | A goal (goals hold no wallet) |
| **Investment account** | Tracked asset; not spendable; has a value that changes | Savings (savings is a *purpose* inside your cash) |
| **Loan** | Money you owe (I owe) or are owed (owed to me); tracked balance | Income or spending |
| **Plan group** | Essentials, Guilt free, Short-term goals, Savings, Investments — a % of expected income | A budget of its own (see §4.1) |
| **Plan item** | One purpose inside a group. Kinds: **Spending** (groceries), **Reserve** (insurance, known future cost), **Goal** (holiday, target + date), **Flexible** (the group's remainder; in Savings this is *General savings*, in Investments *To invest*), **Loan payment** | — |
| **Ready to assign** | Money you have that has no purpose yet | "Available" in the old app |
| **Set aside** | Money already given a purpose (sum of item balances) | An expense |
| **Assign / Fund** | Give Ready-to-assign money a purpose | Income, expense |
| **Move** | Change the purpose of money already set aside (Savings → Holiday) | A transfer between wallets |
| **Transfer** | Move money between your wallets (Bank → Cash) | Income or expense |
| **Expense / Refund** | Money leaves / returns to a wallet, charged to one item | Setting money aside |

Accounting words (entry, line, pool, invariant) never appear in everyday screens.

---

## 4. Your proposed structure — what holds, and what I changed

Your groups, percentages and the insurance-in-Essentials rule are kept. Seven places where the
structure as written would contradict itself or mislead, with the fix:

### 4.1 Group percentages vs item amounts would be two competing budgets → one rule

**Rule:** the group percentage sets the **group total**. Items inside the group have **fixed monthly
amounts**. The difference always lands somewhere visible:

- Items total **less** than the group → the remainder goes to the group's **Flexible** item
  (Essentials: "Other essentials"; Savings: "General savings"; Investments: "To invest"). So the
  group really receives its percentage, and nothing floats unassigned by accident.
- Items total **more** than the group → the group is **over by $X**, shown in red with two fixes:
  raise the percentage, or trim items. The plan still works; it just plans more than your income,
  and the last items in priority order won't be fully funded (§4.2).
- Groups total **less than 100%** → the rest is "Not planned" and stays in Ready to assign.
  Groups may not total more than 100%.

Example: Essentials 60% of $4,110 = $2,466.00. Items: Rent 1,000 · Bills 250 · Groceries 600 ·
Transport 250 · Insurance reserve 150 · Car loan payment 200 = $2,450.00 → **Other essentials
gets $16.00**. Guilt free 5% = $205.50: Eating out 120 + Fun 85.50 → flexible gets $0.

### 4.2 A percentage of *expected* income can't fund anything → fund from received money, in order

Expected income ($4,110) only sizes the plan. When money **arrives**, "Fund my plan" proposes
assigning it to items that still need money this month, **top to bottom in your priority order**
(group order, then item order — drag to reorder), each up to its monthly amount. You can edit the
proposal before confirming.

- **Several payments** (two paychecks of $2,055): the first fills Rent → Bills → Groceries → part of
  Transport; the second continues exactly where the first stopped. Nothing is double-funded,
  because "still needs" = monthly amount − already funded this month.
- **Less than expected** ($3,800): the last $310 of the plan stays unfunded and is shown as
  "Still to fund: $310". Fixed costs are not silently scaled down to 60% of a smaller paycheck.
- **More than expected**: the extra stays in Ready to assign, with a one-tap "Split extra by my
  percentages" (into each group's Flexible item) or manual assignment.

This is why the percentages stay a *planning lens*: they are applied to expected income to size
the groups, never to each paycheck (YNAB calls assigning expected money "forecasting" and warns
against it; Actual applies percentage templates to income actually received).

### 4.3 Savings vs Short-term goals overlap → a definition, not a guess

- **Savings** = money with no named purpose yet (emergency / general). Its Flexible item is
  **General savings**, which can carry forward forever.
- **Short-term goals** = named targets with an amount and usually a date (Holiday, Laptop).
- A goal can live in any group that matches its purpose and is funded **directly from that group**;
  it never has to pass through General savings. Moving General savings into a goal later is a
  **Move** (§5.3), not new saving.

### 4.4 Investments need a waiting room

Funding Investments puts money in **To invest** (still cash in your bank, still yours to redirect).
It becomes an investment only when you record the **contribution** (Bank → Brokerage). That
contribution reduces spendable cash and increases investments, and is reported as **Invested**,
never as spending.

### 4.5 The insurance reserve belongs to Essentials — with a reporting consequence

Kept as you specified (purpose decides the group). Consequence: Essentials will usually *spend*
less than it *receives* in months without the premium. Reports therefore show **Spent** and **Kept
for later** separately per group, so "Essentials under budget" isn't misread as saving.

### 4.6 Bills and loans were missing from the split

- A **bill** (internet, insurance premium, car loan installment) is a *schedule*, not money. It
  belongs to the item it is paid from. It never reserves money of its own, so it can never reduce
  availability a second time; it only shows whether its item already holds enough.
- **Loan payments** get an item (default: in Essentials, "Car loan payment"). Paying splits into
  **principal** (reduces what you owe; not spending) and **interest/fees** (spending).

### 4.7 Overspending must not make "Ready to assign" lie

YNAB and Actual let a category go negative and subtract it from next month's Ready to Assign. That
leaves "Ready to assign" overstated for the rest of the month. **Changed:** when an expense is
larger than its item's balance, the record screen says so and covers the difference **at that
moment** — from Ready to assign by default, or from another item you pick ("Eating out has $0 left;
$15.50 will come from Fun"). Items never go below zero, and Ready to assign is always true. It can
go below zero only if you really spent or corrected more than you had assigned; it then shows
**"Over-assigned by $X — take it back from an item"**.

### 4.8 Two currencies → each keeps its own pile

USD and LBP are never added. Each currency has its own Ready to assign and its own balance in each
item (Groceries can hold $114.30 **and** LL 2,685,000). The plan is written in USD. An **Exchange**
is the only bridge: it records both amounts you actually gave and got (the rate is derived from
them, never assumed) and keeps the money's purpose ("$20 of Groceries became LL 1,790,000 of
Groceries"). A reference rate (default LBP 89,500 per USD, dated and editable; source: BdL, stable
since mid-2023) is used **only** for "≈ $" hints next to LBP figures, always labelled as
approximate, never stored into a balance. This avoids the revaluation entries a single-currency
budget would need (YNAB's own guidance is one plan per currency; Actual has no multi-currency).

*(Percentages are your configurable examples, not financial advice; this document doesn't judge
the amounts.)*

---

## 5. The rules (authoritative list)

### 5.1 What each action does

Every row is one atomic journal entry. "Where" = wallets; "What for" = purposes; RTA = Ready to
assign. Amounts are per currency.

| Action | Where (wallets) | What for (purposes) | Reported as | Net worth |
| --- | --- | --- | --- | --- |
| Opening balance (cash wallet) | wallet +X | RTA +X | Opening balance — never income | starts at X |
| Assign existing money at setup | — | RTA −X, item +X | Item's **opening balance** — never a monthly contribution | 0 |
| Income received | wallet +X | RTA +X (or straight into one item) | Income | +X |
| Fund / Release | — | RTA ↔ item | Funded / Released (net = funded) | 0 |
| Move | — | item A −X, item B +X | Moved (not funding, not spending) | 0 |
| Expense | wallet −X | item −X (+ cover if short, §4.7) | Spent in item & group | −X |
| Refund | wallet +X | item +X | Reduces spending of that item | +X |
| Transfer (same currency) | A −X, B +X | — | Transfer only | 0 |
| Exchange | A −$a, B +LL b | item −$a, same item +LL b | Exchange | ≈0 (rate) |
| Invest (contribution) | cash −X, investment +X | item (To invest) −X | **Invested**, not spending | 0 |
| Withdraw from investment | investment −X, cash +X | RTA +X | Withdrawal — not income | 0 |
| Update investment value | investment ±X | — | Gain / loss — not income, not cash | ±X |
| Investment fee inside the account | investment −X | — | **Investment costs** (an expense) | −X |
| Dividend/interest paid to cash | cash +X | RTA +X | Investment income (separate from salary) | +X |
| Borrow | cash +X, loan (I owe) +X owed | RTA +X | Borrowed — not income | 0 |
| Repay what I owe | cash −(P+I+F), owed −P | item −(P+I+F) | Principal: **debt repaid**; I+F: spending | −(I+F) |
| Lend | cash −X, owed-to-me +X | item or RTA −X | Lent — not spending | 0 |
| Get repaid | cash +X, owed-to-me −X | RTA +X | Repaid to you — not income | 0 |
| Existing loan at setup | loan opening only | — | Opening | ±X |
| Correction | negates every line of the original | negates | Shown as "Corrected" with reason; original kept | negates |

### 5.2 Balances and carry-forward

- **Wallet balance** = sum of its lines. **Item balance** (per currency) = sum of its lines.
  Nothing is stored twice; nothing is maintained by a second feature.
- **Carry-forward is automatic and positive**: an item's month starts with whatever it held at the
  end of last month. There is no month-close step and no hidden month-end move.
- **Month statement per item:** *Brought forward* + *Funded* (net of releases) + *Moved in* −
  *Moved out* − *Spent* (net of refunds) − *Invested / Debt repaid / Lent* ± *Exchanged* =
  *Carried forward*. The opening balance from setup appears once, in the month of setup, as
  *Opening*, separate from *Funded*.
- **Group statement** = sum of its items. A move between two items of the **same** group nets to
  zero for the group; a move **across** groups appears as moved out of one and into the other.
  The plan-wide *Funded this month* counts only Ready-to-assign → item, so a move can never be
  counted as new saving.
- **Goal progress** = goal balance ÷ target. The statement shows how much came from the opening
  balance, from funding, and from moves — the same money is never counted in two of them.

### 5.3 Reassignment

Moving $150 from General savings to Holiday is one **Move**: General savings −150, Holiday +150. No
wallet changes (the money stays in the same bank account), no income, no expense, no new saving.
Savings group: Funded 411, Moved out 150. Short-term goals: Moved in 150. Plan-wide funded is
unchanged.

### 5.4 What "available" means

Per currency:

- **Cash you hold** = sum of spending-wallet balances (excludes investments and loans).
- **Set aside** = sum of plan-item balances, broken down into *For this month's spending*,
  *Reserves & goals*, *Savings*, *Waiting to invest*, *Loan payments*.
- **Ready to assign** = Cash you hold − Set aside (the identity; a test proves the two sides of the
  journal agree).
- **Available to spend on X** = item X's balance.
- **Still to fund this month** = planned − funded (a plan figure, never spendable).
- **Expected income not yet received** = expected − received (a plan figure, never spendable).
- **Net worth** = cash you hold + investments + owed to you − you owe (per currency; an optional
  "≈ total in USD" uses the dated reference rate and says so).

### 5.5 Bills

- A bill has: name, item it is paid from, expected amount, currency, cadence (monthly on day N,
  yearly, once), optional end date, optional loan.
- Its upcoming dates are computed; nothing is pre-generated.
- **Coverage**: for each item, unpaid bills due this month (and overdue) are lined up by due date
  against the item's balance: *Covered*, *Short by $X*, or *Not covered*. Because the money is the
  item's balance, the bill and its reserve are the same money — never two deductions.
- **Paying** a bill records the expense (or loan repayment) against its item and marks that due date
  paid. Paying a different amount than expected is fine: the item absorbs the difference (and
  §4.7 covers a shortfall). Skipping one occurrence is allowed and recorded.

### 5.6 Exact money

- Amounts are 64-bit integers in minor units: USD in cents; LBP in whole lira (no LBP sub-units
  circulate; the ISO exponent of 2 is not used in practice — decision logged).
- Percentages are integer basis points (60% = 6000). Group amounts = expected income × bps,
  floored, with the leftover cents distributed by largest remainder in group order, so the groups
  always sum exactly to the planned total ($205.50 stays $205.50).
- Rates are stored, never used to post: exchange rates are derived from the two amounts entered;
  the reference rate is display-only and dated.

### 5.7 Writes, safety and history

- **Atomic:** each action is one database transaction that writes the whole entry or nothing.
- **Duplicate protection:** every submission carries a request id created when the form opens; a
  second identical submit returns the first result; a different payload with the same id is refused.
- **Concurrency:** all money writes in a space are serialized by a space lock; plan edits carry a
  revision number and are refused if someone saved in between.
- **Isolation:** tables are not reachable from the browser; every read and write goes through
  functions that check the caller is a member of the space. A test proves another user's space is
  invisible and unwritable.
- **Append-only history:** entries are never edited or deleted (enforced by triggers that also
  block TRUNCATE). A correction adds a reversing entry linked to the original, plus the corrected
  entry; both stay visible in Activity.
- **Dates:** one clock — the space's timezone (default Asia/Beirut). Entries may be back-dated but
  not future-dated; upcoming things are bills, not entries. Months are calendar months.

### 5.8 Plan history

A plan edit applies from the month you edit it **forward**; earlier months keep the plan they had.
So last month's report is never rewritten by today's change.

---

## 6. Worked examples (the ten demonstrations)

Sample household: expected income **$4,110**; plan as in §4.1 (Rent 1,000 · Bills 250 ·
Groceries 600 · Transport 250 · Insurance reserve 150 · Car loan payment 200 · Other essentials
16 · Eating out 120 · Fun 85.50 · Holiday 400 · Laptop 216.50 · General savings 411 · To invest
411 = $4,110.00). All figures below were recomputed in cents by script; the preview seeds exactly
this data and the tests assert these numbers.

**1 · Fresh account from zero.** Sign up → name the space → enter expected income $4,110 → accept
or edit the five default groups and their items → add a wallet with balance 0. Home shows: Cash
you hold $0, Ready to assign $0, "Plan: $4,110 still to fund when income arrives". Nothing is
"over" and nothing is fake-available.

**2 · Existing money (setup on 1 Sep).** Wallets: Bank $5,200, Cash $300, LBP cash LL 4,475,000;
Brokerage $12,000 (investment); Car loan $6,000 (I owe); Rami $300 (owed to me). "What is this money
for?": General savings $3,000, Holiday $800, Insurance reserve $480; LL 4,475,000 → Groceries.
Result: Cash you hold $5,500 = Set aside $4,280 + **Ready to assign $1,220**. These are *opening
balances*; September's report shows them as Opening, not as September contributions. Brokerage and
the loans affect net worth only.

**3 · Receive income and fund (1 Sep).** Salary $4,110 → Ready to assign $5,330. "Fund my plan"
proposes $4,110 across the items → Ready to assign back to **$1,220**. Group totals funded: 2,466 /
205.50 / 616.50 / 411 / 411. (Two paychecks: first $2,055 fills Rent, Bills, Groceries and $205 of
Transport; the second continues from Transport.)

**4 · Essentials breakdown and insurance.** Essentials $2,466 shows its seven items; Insurance
reserve: opening $480 + funded $150 = **$630** toward the $780 premium due 2 Oct (yearly bill
attached). Status: "On track — $150 to go".

**5 · Groceries and guilt-free spending (September).** Groceries: $85.40 + $210.00 + $190.30 from
Bank and LL 1,790,000 from LBP cash → **$114.30 and LL 2,685,000 left**. Eating out: $32 + $48.50 +
$55 = $135.50 against $120 → the record screen shows "Eating out has $0 left; $15.50 will come
from…" and you pick **Fun**; Fun then spends $40 → **Fun $30 left**. Spending report: Guilt free
spent $175.50 of $205.50.

**6 · Carry forward into October.** No month-close step. 1 Oct: salary $4,110, fund plan. Groceries
= $114.30 brought forward + $600 = $714.30; Insurance = $630 + $150 = **$780**; General savings =
$3,411 + $411 = $3,822; Bills $50 + $250 = $300; Fun $30 + $85.50 = $115.50. A $64.20 grocery
run on 3 Oct leaves Groceries at $650.10 (plus the LL 2,685,000 still carried).

**7 · Reassign savings to a goal (1 Oct).** Move $150 General savings → Holiday: General savings
$3,822 → **$3,672**, Holiday $1,600 → **$1,750**. Bank balance unchanged. October: Savings funded
$411, moved out $150; Short-term goals funded $616.50, moved in $150; plan-wide funded still $4,110.
Holiday progress: $1,750 of $2,500 (70%) = opening $800 + funded $800 + moved in $150.

**8 · Pay insurance from its reserve (2 Oct).** Pay the $780 premium: Bank −$780, Insurance reserve
$780 → **$0**, bill marked paid. Ready to assign is untouched ($1,220), because the money was
already set aside — one deduction, not two.

**9 · Contribute to investments.** September's To invest ($411) was contributed on 28 Sep
(Brokerage $12,000 → $12,411); the 30 Sep value update to $12,560 is a **$149 gain** — net worth
only, never income or cash. On 2 Oct, To invest again holds $411 → contribution Bank → Brokerage:
Bank −$411, Brokerage +$411, To invest → $0. Reported as Invested $411, not spending. Brokerage now
**$12,971**.

**10 · Upcoming bill and loan repayment.** Car loan installment (bill, monthly on the 1st, $200 from
"Car loan payment"): 1 Sep paid $170 principal + $30 interest ($6,000 → $5,830); 1 Oct payment = **$172 principal + $28 interest** → loan $5,830 → **$5,658**;
$172 is "debt repaid", $28 is spending; net worth falls by $28 only. Internet ($45, due 20 Oct)
is listed under Upcoming as **Covered** by Bills ($300 holds Electricity $120 + Internet $45 + Phone
$35). Rami repays $100 (2 Oct): Bank +$100, Ready to assign → **$1,320**, owed-to-me $300 → $200 —
not income.

**State on 3 Oct (preview "today"):**

| Where | | What for | |
| --- | --- | --- | --- |
| Bank | 8,444.60 | Ready to assign | 1,320.00 |
| Cash | 268.00 | Set aside (13 items) | 7,392.60 |
| **Cash you hold** | **8,712.60** | **Total** | **8,712.60** |

Net worth (USD): 8,712.60 + Brokerage 12,971 + owed to me 200 − car loan 5,658 = **$16,225.60**;
plus LL 2,685,000 shown separately (≈ $30 at the reference rate).

---

## 7. Everyday flow and screens

Four destinations plus a Record button (desktop rail / mobile tab bar, EN + AR, RTL):

1. **Home** — "Cash you hold = Set aside + Ready to assign" per currency; alerts in plain words
   (over-assigned, still to fund, bills short, item emptied); upcoming bills with coverage; recent
   activity; net worth.
2. **Plan** (Plan + Allocation merged) — month selector; expected vs received income; each group:
   % · planned · funded · spent · available, expandable into items with the same columns and a
   per-item statement; goals and reserves show progress and target date; flexible remainder and
   over-planned warnings inline; **Fund my plan**, **Move money**; *Edit plan* (income, %, items,
   order).
3. **Activity** — the journal in plain words with filters (wallet, item, type, month), corrections.
4. **Accounts** — wallets, investment accounts (contributed, value, gain), loans (owe / owed,
   balance, next installment).
5. **Record** — Expense · Income · Transfer · Move money · Exchange · Invest · Loan; bills are paid
   from Home/Upcoming or the item.

Onboarding: space → expected income → default groups & items (editable) → wallets with balances →
"What is this money for?" (optional) → Home.

---

## 8. Approaches considered

| | Approach | Verdict |
| --- | --- | --- |
| **A** | **Two-sided journal: every entry moves wallets and purposes together; items hold real assigned money (envelope model)** | **Recommended.** Invariant is structural; availability is a sum; goals, bills, available cash and plan read the same balances |
| B | Keep today's earmarks-against-a-cash-pool and fix the availability formula | Rejected: every new feature adds another subtraction that can overlap |
| C | Single budget currency (USD) converting LBP at a rate | Rejected for LBP: needs revaluation entries and silently mixes currencies |

Where the rules live: **in Postgres** (the existing Supabase stack), as the single authority —
commands are database functions that validate and write a whole entry; constraint triggers re-check
the invariants at commit; screens read derived totals from read functions. The browser only
formats and parses. The one place the UI previews math while you type (percent ↔ amount in the
plan editor) uses a TypeScript mirror that a test proves gives identical results to the database
for thousands of random inputs.

---

## 9. Build, repository and preview

- **Branch:** `redesign/connected-plan` in a git worktree. `main` and production stay on the current
  app until you decide to switch (which needs a production reset — a separate, explicit step).
- **Replaced on the branch:** `src/` features, `supabase/migrations/` (a fresh v2 baseline),
  `tests/db`, unit and e2e tests. Release tooling pinned to the current production migrations,
  the household-invitation Worker and Edge Function are retired on the branch (household sharing is
  out of scope for v2's first cut; isolation by space membership stays and is tested).
- **Kept:** the `cr-*` design tokens and shared patterns (`docs/design-guidelines.md`), Supabase
  auth, EN/AR + RTL rules, tooling.
- **Preview:** a **local Supabase stack in Docker on this Mac** (separate from production and from
  the Tailscale dev database), seeded by a script that drives the real database functions, plus the
  Vite app on `localhost`. The app refuses to start in preview mode unless its backend is local.
  Two demo sign-ins: a **fresh** account (demonstration 1) and an **existing-money** account with
  the September–October history above (demonstrations 2–10), plus an in-app "Guided tour" panel
  that links each demonstration to the screen that shows it.

---

## 10. Verification plan

- **Database (real Postgres via Testcontainers, Supabase image 17.6):**
  - every action's two-sided shape;
  - rejection tests that show each guard biting (unbalanced entry, edit/delete/TRUNCATE of
    history, moving more than an item holds, funding more than Ready to assign, cross-currency
    transfer, non-member access, request-id replay and payload mismatch, stale plan revision);
  - a randomized conservation test: thousands of random action sequences, after each one
    *cash you hold = Ready to assign + Σ items* per currency, items ≥ 0, transfers and moves never
    change income or spending totals, reservations are never deducted twice, opening balances
    never appear as monthly funding;
  - the ten demonstrations as one scripted test asserting the numbers in §6.
- **Plan math parity** (TypeScript mirror vs database).
- **UI unit tests** for money formatting/parsing and key screens.
- **End-to-end** (Playwright against the local stack): onboarding from zero, record → fund →
  spend → move → pay bill → invest, in desktop/mobile and EN/AR.
- Anything not run will be listed as unverified.

---

## 11. Decisions I made (will be logged in `docs/decisions.md`)

1. Overspending is covered at the moment of the expense (default from Ready to assign) instead of
   next month (§4.7).
2. Shortfall funding fills top to bottom in your priority order, not proportionally (§4.2).
3. LBP is budgeted inside the same items as USD, as a separate balance (§4.8).
4. Calendar months; payday-anchored months are not carried over from the current app (money that
   arrives on the 28th waits in Ready to assign until you fund the next month).
5. Every positive item balance carries forward, including spending categories; no automatic sweep.
6. Bills never hold money; they read their item's balance.
7. Loan interest is recorded when paid (no automatic accrual); credit cards are wallets that may go
   negative.
8. Household invitations and the remaining v1 features (category packs, welcome tour, CSV export,
   phone shortcut) are not in the first v2 cut.
9. LBP amounts are whole lira.

## 12. Out of scope for this cut

Production cutover/reset; household invitations; bank import; automatic interest accrual; loan
write-offs; payday-anchored months; recurring income schedules; receipts; tags.
