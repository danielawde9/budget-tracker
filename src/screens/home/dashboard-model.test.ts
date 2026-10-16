import { fixtures } from '../../test/harness.tsx';
import { dashboardTotals, expenseEntries, spendingSeries, loadMonthActivity, plannedSpending, expenseGroupRows } from './dashboard-model.ts';
import type { Entry } from '../../api/schemas.ts';

describe('dashboard money calculations', () => {
  it('keeps available category balances separate from spending and currencies', () => {
    const totals = dashboardTotals(fixtures.plan, 'USD');
    expect(totals.available).toBe(153760n);
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
  expect(plannedSpending(fixtures.plan)).toBe(252150n);
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


it('keeps historical expense categories exclusive when items move and reconciles net remaining totals', () => {
  const base = fixtures.plan.groups[0]!;
  const item = base.items[0]!;
  const plan = { ...fixtures.plan, groups: [
    { ...base, groupId: 'first', nameEn: 'First', purpose: 'expense' as const, items: [{ ...item, itemId: 'first-item', planned: 10000n }], flex: null },
    { ...base, groupId: 'second', nameEn: 'Second', purpose: 'expense' as const, items: [{ ...item, itemId: 'moved-item', planned: 5000n }], flex: null },
    { ...base, groupId: 'goals', purpose: 'savings' as const, items: [{ ...item, itemId: 'goal-item', planned: 90000n }], flex: null },
  ] };
  const entry = fixtures.activity.entries[0]!;
  const line = entry.items[0]!;
  const spend = (itemId: string, groupId: string | null, amount: bigint, flow: 'spend' | 'refund' = 'spend') => ({ ...line, itemId, groupId, amount, flow, purpose: 'expense' as const });
  const entries: Entry[] = [
    { ...entry, occurredOn: '2026-10-02', items: [spend('moved-item', 'first', -4000n), spend('moved-item', 'first', 500n, 'refund'), spend('first-item', null, 1000n), spend('moved-item', 'second', -6000n), { ...spend('old-item', 'archived', -700n), groupNameEn: 'Archived' }, { ...spend('goal-item', 'goals', -9000n), purpose: 'savings' }, { ...spend('first-item', 'first', -999n), currency: 'LBP' }] },
    { ...entry, occurredOn: '2026-10-04', items: [spend('future-item', 'future-group', -999n)] },
    { ...entry, occurredOn: '2026-09-30', items: [spend('past-item', 'past-group', -999n)] },
  ];
  const rows = expenseGroupRows(plan, entries, 'USD', '2026-10-01', '2026-10-03');
  expect(rows.map(({ groupId, planned, spent, remaining }) => ({ groupId, planned, spent, remaining }))).toEqual([
    { groupId: 'first', planned: 10000n, spent: 2500n, remaining: 7500n },
    { groupId: 'second', planned: 5000n, spent: 6000n, remaining: -1000n },
    { groupId: 'archived', planned: 0n, spent: 700n, remaining: -700n },
  ]);
  expect(rows.reduce((sum, row) => sum + (row.remaining ?? 0n), 0n)).toBe(plannedSpending(plan) - (spendingSeries(expenseEntries(entries, plan), 'USD', '2026-10-01', '2026-10-03').at(-1)?.amount ?? 0n));
  const lira = expenseGroupRows(plan, entries, 'LBP', '2026-10-01', '2026-10-03');
  expect(lira.find(row => row.groupId === 'first')?.spent).toBe(999n);
  expect(lira.every(row => row.remaining === null)).toBe(true);
});
