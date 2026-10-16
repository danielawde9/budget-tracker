import { fixtures } from '../../test/harness.tsx';
import { dashboardTotals, plannedSpending, spendingByCategory } from './dashboard-model.ts';
import type { Entry, PlanMonth } from '../../api/schemas.ts';

// Names deliberately do not identify a purpose: a rename must not alter totals.
const plan = {
  ...fixtures.plan,
  groups: ['spending', 'saving', 'investment'].map((purpose, index) => ({
    ...fixtures.plan.groups[0]!, groupId: String(index), nameEn: 'Renamed group', purpose,
    items: [], flex: { ...fixtures.plan.groups[0]!.flex!, itemId: String(index), kind: 'flex',
      planned: 10000n, balances: { USD: [6000n, 3000n, 1000n][index]!, LBP: 0n } },
  })),
} as PlanMonth;

it('separates savings and investment earmarks from the everyday allowance and pace', () => {
  expect(dashboardTotals(plan, 'USD')).toMatchObject({ available: 6000n, savings: 3000n, investing: 1000n });
  expect(dashboardTotals(plan, 'LBP').savings).toBe(0n);
  expect(plannedSpending(plan)).toBe(10000n);
});

it('reports real spending by category including savings purchases, net refunds and reversals', () => {
  const base = fixtures.activity.entries[0]!;
  const entry = (itemId: string, amount: bigint, flow: Entry['items'][number]['flow'], on = '2026-10-02'): Entry => ({
    ...base, occurredOn: on, items: [{ ...base.items[0]!, itemId, nameEn: `Category ${itemId}`, amount, flow, currency: 'USD' }],
  });
  const rows = spendingByCategory([
    entry('food', -1000n, 'spend'), entry('food', 200n, 'refund'), entry('goal', -500n, 'spend'),
    entry('invest', -10000n, 'invest'), entry('food', -999n, 'spend', '2026-11-01'),
    entry('food', -999n, 'spend', '2026-10-12'),
  ], 'USD', '2026-10-01', '2026-10-10');
  expect(rows.map(row => [row.itemId, row.amount])).toEqual([['food', 800n], ['goal', 500n]]);
});
