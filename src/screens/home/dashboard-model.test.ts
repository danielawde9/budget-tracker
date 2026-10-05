import { fixtures } from '../../test/harness.tsx';
import { dashboardTotals, spendingSeries, loadMonthActivity, plannedSpending } from './dashboard-model.ts';
import type { Entry } from '../../api/schemas.ts';

describe('dashboard money calculations', () => {
  it('keeps available category balances separate from spending and currencies', () => {
    const totals = dashboardTotals(fixtures.plan, 'USD');
    const items = fixtures.plan.groups.flatMap(g => [...g.items, ...(g.flex ? [g.flex] : [])]);
    expect(totals.available).toBe(items.filter(i => i.kind === 'spending' || i.kind === 'flex').reduce((n, i) => n + i.balances.USD, 0n));
    expect(totals.spent).toBe(fixtures.plan.groups.reduce((n, g) => n + g.spent, 0n));
    expect(dashboardTotals(fixtures.plan, 'LBP').spent).toBeNull();
  });

  it('nets refunds and corrections, ignores transfers and future or other-currency entries', () => {
    const base = fixtures.activity.entries[0]!;
    const entry = (on: string, amount: bigint, flow: Entry['items'][number]['flow'], currency: 'USD' | 'LBP' = 'USD'): Entry => ({ ...base, occurredOn: on, items: [{ ...base.items[0]!, amount, flow, currency }] });
    const points = spendingSeries([
      entry('2026-10-01', -10000n, 'spend'), entry('2026-10-02', 2000n, 'refund'),
      entry('2026-10-03', 10000n, 'spend'), entry('2026-10-01', -999n, 'transfer'),
      entry('2026-10-04', -50000n, 'spend'), entry('2026-10-01', -100000n, 'spend', 'LBP'),
      entry('2026-09-30', -100n, 'spend'),
    ], 'USD', '2026-10-01', '2026-10-03');
    expect(points.map(p => p.amount)).toEqual([0n, 10000n, 8000n, -2000n]);
    expect(points.at(-1)?.on).toBe('2026-10-03');
  });

  it('loads every page before reporting a monthly trend', async () => {
    const base = fixtures.activity.entries[0]!;
    let page = 0;
    const entries = await loadMonthActivity({ activity: async () => ++page === 1
      ? { entries: [base], next: { id: 'cursor', occurredOn: base.occurredOn, createdAt: base.createdAt } }
      : { entries: [{ ...base, entryId: 'second' }], next: null } }, 'space', '2026-10-01');
    expect(entries.map(e => e.entryId)).toEqual([base.entryId, 'second']);
  });
});

it('compares spending with spending allocations rather than savings goals', () => {
  const spending = fixtures.plan.groups.flatMap(g => [...g.items, ...(g.flex ? [g.flex] : [])]).filter(i => i.kind === 'spending' || i.kind === 'flex');
  expect(plannedSpending(fixtures.plan)).toBe(spending.reduce((n, i) => n + i.planned, 0n));
  expect(plannedSpending(fixtures.plan)).toBeLessThan(fixtures.plan.groupsTotal);
});
