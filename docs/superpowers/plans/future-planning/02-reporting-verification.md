# 02 — Reporting foundation verification implementation plan

> **For agentic workers:** Use superpowers:executing-plans and systematic-debugging.

**Goal:** Prove reversal signs, category rollup, privileges and bounded reads
before new budgets depend on the reports. **Layer:** database only.
**Architecture:** real-engine regression tests first; minimal forward fixes only
when a failure is reproduced. **Tech Stack:** existing PostgreSQL/pg/Vitest.

## Files and prerequisites

Read [01-sql-contract.md](01-sql-contract.md), [test recipes](01-test-recipes.md),
`supabase/migrations/20260912102000_reporting_read_models.sql`,
`20260912101000_monthly_budget_planning.sql`,
`20260910100000_subcategories_foundation.sql`,
`20260908103000_harden_reverse_financial_event.sql` and
`tests/db/monthly-budgeting.integration.test.ts`.

Create `tests/db/planning-projections.integration.test.ts`; if needed create a
fresh timestamped `_planning_projection_contracts.sql`. Do not edit old SQL.
Update only command inventory, decisions and `docs/verification/future-planning/02.md`.

## Task 1 — Prove the suspicious paths rather than assuming a defect

- [ ] Copy the complete disposable setup from test recipes; then add this test.
- [ ] Run the focused command; the desired red failure is a wrong report result
  or permission error, not an unavailable test database.

```ts
it('nets an ordinary expense and its inverse once', async () => {
  await withAuthenticatedTransaction(db().client, actor, async () => {
    const wallet = await db().client.query<{ id: string }>(
      "select id from public.create_wallet($1, 'Cash', 'USD') limit 2", [spaceId],
    );
    const event = await db().client.query<{ id: string }>(
      `select id from public.record_financial_event(
        $1, $2, 'expense', '2026-09-10', $3::jsonb) limit 2`,
      [spaceId, randomUUID(), JSON.stringify([
        { walletId: wallet.rows[0]!.id, amountMinor: '-5000' },
      ])],
    );
    await db().client.query(
      "select * from public.reverse_financial_event($1,$2,$3,'2026-09-10') limit 2",
      [spaceId, randomUUID(), event.rows[0]!.id],
    );
    const report = await db().client.query<{ expense: string; delta: string }>(
      `select expense_net_minor::text expense, wallet_delta_net_minor::text delta
       from public.report_monthly_cash_summary($1,'2026-09-01')
       where period_role='current' and currency='USD' limit 2`, [spaceId],
    );
    expect(report.rows).toEqual([{ expense: '0', delta: '0' }]);
  });
});
```

Add independent fixtures, not reused accumulating money, for:

| ID | Inputs | Exact assertion |
| --- | --- | --- |
| V01 | USD income 10000 + same-date inverse | income 0, wallet delta 0 |
| V02 | August expense −5000, September inverse +5000 | August expense 5000; September expense −5000 |
| V03 | root Essentials target 10000, child Food expense −3000 | root actual 3000, remaining 7000, overall actual 3000 |
| V04 | child target 100 | rejected according to root-only decision; preserve any already-stored child history for migration review |
| V05 | authorized category-v-budget RPC after target exists | succeeds without raw plan SELECT grant |
| V06 | outsider, removed member, null month and null page limit | denied; no unrestricted or unlimited read |
| V07 | 101 categories, limit 50; identical timestamp ties | 50,50,1 rows with usable complete cursors, no duplicates |
| V08 | opening/transfer/exchange/borrow/repay/loan-opening | ordinary income and expense stay 0 |

## Task 2 — Trace and make only the confirmed forward change

Source observations to investigate: report SQL negates inverse movements again;
category actuals currently group the associated category rather than its root;
category report uses invoker access while plan-table SELECT is revoked; one
page takes a created_at cursor but does not return that timestamp. These are
source hypotheses, not a claim they were reproduced in this planning session.

- [ ] For a reproduced sign failure, preserve movement sign and classify by
  `coalesce(original.kind,event.kind)`. Use the correction's effective date.
- [ ] For a reproduced rollup gap, use exactly one root per association:

```sql
select category.id,coalesce(category.parent_category_id,category.id) as root_id
from public.categories category
where category.space_id=$1
order by category.id
limit 100;
```

Do not join both parent and child into the money summation. Categorized event
reversals already copy their association in the inspected source; join by the
event first, original as fallback, and choose one association.

- [ ] For a reproduced privilege gap, convert the specific aggregate read to
  a fixed-path DEFINER function with membership checks and explicit role grants.
  Do not grant SELECT on every plan-history row to repair one report.
- [ ] Keep existing public return types/order unless the type itself lacks a
  cursor field. For that case add `monthly_budget_category_page_v2` with fields
  `category_id, category_created_at, currency, name_en, name_ar, archived_at,
  target_minor text, actual_spent_minor text, remaining_minor text,
  overspent_minor text, target_revision_id text, has_more boolean`; retain old
  function for existing consumers. New clients use v2 only.
- [ ] New root-only validation belongs before insertion in the protected setter
  and in a constraint trigger. If historic child targets exist in the isolated
  seeded-upgrade fixture, reject or explicitly migrate with a reviewed rule;
  never silently move amounts or discard history to make the constraint fit.

## Task 3 — Required closure

Run:

```bash
bash -c 'set -euo pipefail; set -a; source ./.env.test; set +a; pnpm exec vitest run tests/db/planning-projections.integration.test.ts --pool=forks --no-file-parallelism'
bash -c 'set -euo pipefail; set -a; source ./.env.test; set +a; pnpm check'
git diff --check
```

- [ ] Record each hypothesis as Pass/confirmed-and-fixed/Blocked with actual
  results; replay empty and seeded migrations for any forward change.
- [ ] Add a bounded event-kind classification ratchet to the test: every value
  from `pg_enum` for `public.financial_event_kind` must be in a literal mapping
  of ordinary income, ordinary expense, transfer, exchange, loan, opening or
  reversal. New kinds fail until classified.
- [ ] Commit `test(planning): verify reporting foundation` or the specific
  verified fix. Exit before task 03; no UI changes.
