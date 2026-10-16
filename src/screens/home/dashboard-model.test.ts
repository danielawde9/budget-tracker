import { fixtures } from '../../test/harness.tsx';
import { dashboardTotals, expenseEntries, spendingSeries, loadMonthActivity, plannedSpending } from './dashboard-model.ts';
import type { Entry } from '../../api/schemas.ts';

describe('dashboard money calculations', () => {
  it('keeps available category balances separate from spending and currencies', () => {
    const totals = dashboardTotals(fixtures.plan, 'USD');
    expect(totals.available).toBe(372060n);
    expect(totals.spent).toBe(109220n);
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
  expect(plannedSpending(fixtures.plan)).toBe(313800n);
  expect(plannedSpending(fixtures.plan)).toBeLessThan(fixtures.plan.groupsTotal);
});

it('excludes savings flex and all saving movements from the monthly expense allowance', () => {
  const base = fixtures.plan.groups[0]!;
  const item = base.items[0]!;
  const plan = { ...fixtures.plan, groups: [
    { ...base, purpose: 'expense' as const, planned: 20000n, spent: 3000n, items: [{ ...item, planned: 10000n }], flex: { ...base.flex!, planned: 10000n } },
    { ...base, groupId: 'saving', purpose: 'savings' as const, planned: 90000n, spent: 0n, items: [], flex: { ...base.flex!, itemId: 'saving-flex', planned: 90000n, balances: { USD: 90000n, LBP: 0n } } },
  ] };
  expect(plannedSpending(plan)).toBe(20000n);
  expect(dashboardTotals(plan, 'USD').available).toBe(base.items[0]!.balances.USD + base.flex!.balances.USD);
});

it('retains spending in an archived category while excluding saving and reserve lines', () => {
  const base = fixtures.activity.entries[0]!;
  const line = base.items[0]!;
  const entries: Entry[] = [{ ...base, occurredOn: '2026-10-02', items: [
    { ...line, itemId: 'archived', kind: 'spending', purpose: 'expense', amount: -1234n, flow: 'spend' },
    { ...line, itemId: 'saving', kind: 'flex', purpose: 'savings', amount: -9999n, flow: 'spend' },
    { ...line, itemId: 'reserve', kind: 'reserve', purpose: 'expense', amount: -8888n, flow: 'spend' },
  ] }];
  expect(spendingSeries(expenseEntries(entries, fixtures.plan), 'USD', '2026-10-01', '2026-10-03').at(-1)?.amount).toBe(1234n);
});
