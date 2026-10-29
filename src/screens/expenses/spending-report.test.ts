import type { Entry } from '../../api/schemas.ts';
import { fakeApi, fixtures } from '../../test/harness.tsx';
import { buildSpendingReport, loadReportActivity, matchingSpendingEntries, reportPeriod, validReportRange } from './spending-report.ts';

function record(id: string, amount: bigint, on = '2026-10-03', fields: Partial<Entry['items'][number]> = {}): Entry {
  const base = fixtures.activity.entries[0]!;
  return { ...base, entryId: id, occurredOn: on, items: [{ ...base.items[0]!, amount, ...fields }] };
}

it('uses budget calendar dates for presets, leap years, and month navigation', () => {
  expect(reportPeriod('thisMonth', '2026-10-29')).toEqual({ from: '2026-10-01', to: '2026-10-29' });
  expect(reportPeriod('lastMonth', '2024-03-01')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  expect(reportPeriod('last30Days', '2026-10-29')).toEqual({ from: '2026-09-30', to: '2026-10-29' });
  expect(reportPeriod('thisYear', '2026-01-01')).toEqual({ from: '2026-01-01', to: '2026-01-01' });
  expect(reportPeriod('month', '2026-10-29', '2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
});

it('rejects impossible, reversed, missing, and future custom dates', () => {
  for (const range of [{ from: '', to: '2026-10-29' }, { from: '2026-02-30', to: '2026-03-01' },
    { from: '2026-10-29', to: '2026-10-01' }, { from: '2026-10-29', to: '2026-10-30' }]) {
    expect(validReportRange(range, '2026-10-29')).toBe(false);
  }
  expect(validReportRange({ from: '2024-02-29', to: '2026-10-29' }, '2026-10-29')).toBe(true);
});

it('loads every page across months, deduplicates, and includes both date endpoints', async () => {
  const api = fakeApi();
  const start = record('start', -1000n, '2026-09-30');
  const end = record('end', -2000n, '2026-10-03');
  api.activity.mockImplementation(async (_space, options) => options?.filter?.['month'] === '2026-09-01'
    ? { entries: [record('outside', -9000n, '2026-09-29'), start], next: null }
    : options?.before ? { entries: [end, record('middle', -300n, '2026-10-01')], next: null }
      : { entries: [end], next: { id: 'next', occurredOn: end.occurredOn, createdAt: end.createdAt } });
  const entries = await loadReportActivity(api, 'space', { from: '2026-09-30', to: '2026-10-03' });
  expect(entries.map(entry => entry.entryId).sort()).toEqual(['end', 'middle', 'start']);
  expect(api.activity).toHaveBeenCalledTimes(3);
});

it('does not issue thousands of monthly reads for a long custom range', async () => {
  const api = fakeApi({ activity: async () => ({ entries: [record('old', -100n, '2020-02-01')], next: null }) });
  const result = await loadReportActivity(api, 'space', { from: '2000-01-01', to: '2026-10-03' });
  expect(result).toHaveLength(1);
  expect(api.activity).toHaveBeenCalledTimes(1);
  expect(api.activity.mock.calls[0]?.[1]?.filter).toEqual({});
});

it('fails the whole report on a missing month or a repeated page cursor', async () => {
  const api = fakeApi();
  api.activity.mockImplementation(async (_space, options) => {
    if (options?.filter?.['month'] === '2026-09-01') throw new Error('offline');
    return { entries: [], next: null };
  });
  await expect(loadReportActivity(api, 'space', { from: '2026-09-01', to: '2026-10-03' })).rejects.toThrow('offline');
  const cursor = { id: 'loop', occurredOn: '2026-10-03', createdAt: '2026-10-03T00:00:00Z' };
  api.activity.mockResolvedValue({ entries: [], next: cursor });
  await expect(loadReportActivity(api, 'space', { from: '2026-10-01', to: '2026-10-03' })).rejects.toThrow();
});

it('separates corrected purchases, refunds, and currencies, without allocations or principal', () => {
  const range = { from: '2026-09-30', to: '2026-10-03' };
  const entries = [record('purchase', -10000n), record('refund', 2000n, '2026-10-03', { flow: 'refund' }),
    { ...record('correction', 1000n), kind: 'reversal' as const },
    record('refund-correction', -500n, '2026-10-03', { flow: 'refund' }),
    record('fee', -200n, '2026-10-03', { flow: 'fee' }),
    record('lbp', -250000n, '2026-10-03', { currency: 'LBP' }),
    record('allocation', -90000n, '2026-10-03', { flow: 'move' }),
    record('principal', -90000n, '2026-10-03', { flow: 'principal' }),
    record('old', -90000n, '2026-09-29')];
  const report = buildSpendingReport(entries, range, 'USD');
  expect(report).toMatchObject({ purchases: 9200n, refunds: 1500n, total: 7700n, count: 5 });
  expect(report.categories[0]).toMatchObject({ total: 7700n, count: 5 });
  expect(buildSpendingReport(entries, range, 'LBP').total).toBe(250000n);
});

it('counts a purchase paid from savings once, using the purchased category', () => {
  const base = record('savings-purchase', -3000n);
  const entries = [{ ...base, items: [...base.items,
    { ...base.items[0]!, itemId: 'savings-source', amount: -3000n, flow: 'move' as const },
    { ...base.items[0]!, amount: 3000n, flow: 'move' as const }] }];
  const report = buildSpendingReport(entries, { from: '2026-10-01', to: '2026-10-03' }, 'USD');
  expect(report).toMatchObject({ total: 3000n, count: 1 });
  expect(report.categories).toHaveLength(1);
});

it('keeps fully refunded categories and preserves group history when a category moves', () => {
  const entries = [record('old-group', -5000n, '2026-09-30', { groupId: 'old', groupNameEn: 'Old group' }),
    record('new-group', -1000n, '2026-10-03', { groupId: 'new', groupNameEn: 'New group' }),
    record('refund', 6000n, '2026-10-03', { flow: 'refund', groupId: 'new', groupNameEn: 'New group' })];
  const range = { from: '2026-09-30', to: '2026-10-03' };
  const report = buildSpendingReport(entries, range, 'USD');
  expect(report.categories).toHaveLength(1);
  expect(report.categories[0]).toMatchObject({ total: 0n, count: 3 });
  expect(report.groups.map(group => group.total).sort()).toEqual([-5000n, 5000n]);
  expect(matchingSpendingEntries(entries, range, 'USD', { itemId: entries[0]!.items[0]!.itemId, groupId: 'old' })).toHaveLength(1);
});

it('includes wallet-only investment fees and signed reversals in totals and category drilldown', () => {
  const base = record('fee', 0n);
  const fee: Entry = { ...base, kind: 'invest_fee', items: [], wallets: [{ ...base.wallets[0]!, kind: 'investment', flow: 'fee', amount: -500n }] };
  const reversal: Entry = { ...fee, entryId: 'fee-reversal', kind: 'reversal', reversesEntryId: fee.entryId,
    wallets: fee.wallets.map(wallet => ({ ...wallet, amount: 200n })) };
  const lbpFee: Entry = { ...fee, entryId: 'lbp-fee', wallets: fee.wallets.map(wallet => ({ ...wallet, currency: 'LBP', amount: -250000n })) };
  const range = { from: '2026-10-01', to: '2026-10-03' };
  const report = buildSpendingReport([fee, reversal, lbpFee], range, 'USD');
  expect(report).toMatchObject({ purchases: 300n, refunds: 0n, total: 300n, count: 2 });
  expect(report.categories[0]).toMatchObject({ nameEn: 'Investment fees', total: 300n, count: 2 });
  const selected = matchingSpendingEntries([fee, reversal, lbpFee], range, 'USD', { itemId: report.categories[0]!.itemId });
  expect(selected.map(record => record.entry.entryId).sort()).toEqual(['fee', 'fee-reversal']);
  expect(buildSpendingReport([fee, reversal, lbpFee], range, 'LBP').total).toBe(250000n);
});

it('does not count wallet fee mirrors twice when a category already records the fee', () => {
  const fee = record('category-fee', -500n, '2026-10-03', { flow: 'fee' });
  const entry: Entry = { ...fee, wallets: [{ ...fee.wallets[0]!, kind: 'investment', flow: 'fee', amount: -500n }] };
  const report = buildSpendingReport([entry], { from: '2026-10-01', to: '2026-10-03' }, 'USD');
  expect(report).toMatchObject({ purchases: 500n, total: 500n, count: 1 });
  expect(report.categories).toHaveLength(1);
});
