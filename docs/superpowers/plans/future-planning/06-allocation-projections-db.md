# 06 — Allocation projection implementation plan

> **For agentic workers:** Use executing-plans and test-driven-development.

**Goal:** Return complete, exact plan-versus-actual results without double counting.
**Layer:** DB. **Depends on:** 02,05. **Tech Stack:** PostgreSQL/pg/Vitest.
Create timestamped `_allocation_projections.sql` and
`tests/db/allocation-projections.integration.test.ts`; inventory/decisions/evidence.

## Task 1 — Canonical private ordinary-activity function

Add `private.planning_ordinary_activity(p_space_id uuid,p_from date,p_to date)`
`RETURNS TABLE(event_id uuid,effective_date date,currency public.currency_code,
root_id uuid,income_minor numeric,expense_minor numeric,cash_minor numeric)`.
It is not publicly executable; callers require active membership and a range
1…366 days before invoking it. This SQL body defines current event semantics:

```sql
select e.id,e.effective_date,w.currency,
  coalesce(c.parent_category_id,c.id) as root_id,
  case when coalesce(o.kind,e.kind)='income' then m.amount_minor::numeric else 0 end,
  case when coalesce(o.kind,e.kind)='expense' then -m.amount_minor::numeric else 0 end,
  m.amount_minor::numeric
from public.financial_events e
join public.wallet_movements m on m.event_id=e.id and m.space_id=e.space_id
join public.wallets w on w.id=m.wallet_id and w.space_id=e.space_id
left join public.financial_events o on o.id=e.reversal_of and o.space_id=e.space_id
left join public.financial_event_categories ec on ec.event_id=e.id and ec.space_id=e.space_id
left join public.financial_event_categories oc on oc.event_id=o.id and oc.space_id=e.space_id
left join public.categories c on c.id=coalesce(ec.category_id,oc.category_id) and c.space_id=e.space_id
where e.space_id=p_space_id and e.effective_date>=p_from and e.effective_date<p_to;
```

The helper returns one row per movement; cash across same-currency transfer legs
nets to zero at space level. Expense/income classification never uses absolute
value or a second inverse sign. Future new event types extend this helper only
in their own financial task with the enum classification ratchet and regression
fixtures. Split/refund/mixed-purchase tasks must replace any multiplying category
join with a per-event allocation projection before using their categories.

## Task 2 — Public read contracts

New functions return JSON objects with camelCase fields below. Monetary and
bigint ID values are text. Dates are ISO strings. All reads check membership,
required inputs, normalized month/currency and strict limits; `SET statement_timeout='10s'`.
Use one SQL statement snapshot per response so header/series/coverage agree.

| Function | Exact arguments | Return contract |
| --- | --- | --- |
| `allocation_month_state` | space uuid, month date, currency currency_code, snapshot_id bigint default null | `snapshotId, templateRevisionId, incomeRevisionId, hasPlan, plannedIncomeMinor, actualIncomeMinor, expenseMinor, incomeAfterSpendingMinor, ownDebtPaidMinor, remainingDebtMinor, leftToAllocateMinor, childPlanChanged, asOf, groups[]` |
| `allocation_category_page` | space uuid, month date, currency currency_code, snapshot_id bigint, group_id uuid default null, after_root_id uuid default null, limit int default50 | `rows[], nextRootId, hasMore`; row `rootId,nameEn,nameAr,targetMinor,actualMinor,varianceMinor,hasPlan,groupId` |
| `allocation_history_page` | space uuid, month date, currency currency_code, before_id bigint default null, limit int default20 | `rows[],nextId,hasMore`; row `snapshotId,createdAt,actorId,plannedIncomeMinor,templateRevisionId` |
| `allocation_trend` | space uuid, currency currency_code, first_month date, month_count int | `months[]` up to12: `month,incomeMinor,expenseMinor,ownDebtPaidMinor,hasPlan,plannedIncomeMinor` |

Each signature's SQL parameter names are its camelCase field converted to
`p_snake_case` (e.g. `p_space_id`, `p_after_root_id`, `p_month_count`). Domain errors
follow 01. Category page's null group means all categories, including standalone.
Pagination is ascending root UUID with `LIMIT limit+1`; filter before limit.
History descending snapshot ID; return cursor from last returned row only when
lookahead exists. Root mappings/names come from selected snapshot; actuals are
live according to effective date. Reject foreign snapshot IDs, even when no
rows would otherwise be returned. Income and expense totals include Unmapped
and Uncategorized; expose these as separate synthetic group rows.

Group row fields: `groupId` nullable for synthetic rows, `rowKind` one of
spending/future/unmapped/uncategorized, `nameEn,nameAr,order,targetMinor,
actualMinor,varianceMinor,basisPoints,actualShareOfIncomeBps` nullable when
income≤0, `hasPlan`. `basisPoints` is an integer0…10000; actual share is
`floor(actualMinor*10000/actualIncomeMinor)` returned as signed **text**, because
actual spending can greatly exceed a tiny income denominator. Never coerce an
unbounded ratio to a JSON/JavaScript number. Future group's actual is paid debt only before goals ship;
label it `paid/allocated`, not ordinary expense. Do not mix it into sum(expenses).

Exact equations:

```text
expense = sum(ordinary expense signed movements)
incomeAfterSpending = ordinary income - expense
spending group actual = sum(root expense actual mapped to that saved group)
variance = target - actual                       # negative means over
future excess = max(ownDebtPaid + remainingDebt - future target, 0)
leftToAllocate = snapshot unallocated
  - standalone root targets - standalone debt commitment - future excess
```

Use signed actual debt for cashflow; existing remaining loan reservations keep
their approved nonnegative/capped meaning. `childPlanChanged` is true if any
current income/root head differs from a snapshot's stored source head. Report
saved targets while flagging staleness; do not quietly mix current targets with
old parent percentages. Task 11 adds goal terms through a forward read update.

## Task 3 — Read rejection/accuracy evidence

Fixtures: 200000 planned; 180000 received; Essentials target112000 actual118000;
Lifestyle target48000 actual43000; Future target40000, debt15000. Expect expense
161000, incomeAfterSpending19000, afterDebt4000; Essentials variance−6000,
Lifestyle+5000; no currency mixing. Add root/child one-time rollup, zero/no plan,
negative correction month, 101 roots, archived historical roots, late income,
snapshot rename next month, stale child head, invalid cursors, outsider and
membership-loss failures. Aggregates must not change with page size.

For trends, seed every month including empty months; `generate_series` is
bounded by validated month_count1…12. Current partial-month comparison UI must
explicitly request/use aligned date ranges; monthly trend rows remain full
calendar-month facts and are labelled accordingly.

Run focused file, full DB gate, role probes and seeded upgrade; commit
`feat(planning): expose reconciled allocation projections`. Exit before gateway.

Category-page root cursors contain real UUIDs only. Uncategorized totals remain
in their synthetic group row; task23's uncategorizedOnly filter provides the
journal drilldown. Never fabricate a category UUID or use NULL as a partial cursor.
