import { describe, expect, it } from 'vitest';

import type { JournalEvent } from './types.js';
import { buildJournalCsv } from './journal-csv.js';

function event(overrides: Partial<JournalEvent> = {}): JournalEvent {
  return {
    id: 'event-1', spaceId: 'space-1', requestId: 'request-1', kind: 'expense',
    effectiveDate: '2026-09-07', createdAt: '2026-09-07T10:00:00Z', reversalOf: null, reversedBy: null, loanLinked: false,
    movements: [{ walletId: 'wallet-1', walletName: 'Cash', currency: 'USD', amountMinor: '-12500', walletArchived: false }],
    ...overrides,
  };
}

const label = (value: JournalEvent) => `label:${value.id}`;

describe('buildJournalCsv', () => {
  it('writes bilingual headers, one row per movement, and the snapshot high-water', () => {
    const result = buildJournalCsv([event({ id: 'a', payeeName: 'Market' }), event({
      id: 'b', kind: 'transfer', createdAt: '2026-09-08T09:00:00Z',
      movements: [
        { walletId: 'w1', walletName: 'Cash', currency: 'USD', amountMinor: '-30000', walletArchived: false },
        { walletId: 'w2', walletName: 'Bank', currency: 'USD', amountMinor: '30000', walletArchived: false },
      ],
    })], 'en', (value) => value.payeeName ?? value.id);

    expect(result.csv).toContain('# snapshot: 2026-09-08T09:00:00Z | b');
    expect(result.csv).toContain('Date,Kind,Label,Note,Wallet,Currency,Amount (minor)');
    expect(result.csv).toContain('2026-09-07,expense,Market,,Cash,USD,-12500');
    expect(result.csv).toContain('2026-09-07,transfer,b,,Bank,USD,30000');
    expect(result.rowCount).toBe(3);
    expect(result.highWaterMark).toEqual({ createdAt: '2026-09-08T09:00:00Z', eventId: 'b' });
    expect(result.truncated).toBe(false);
  });

  it('localizes the headers and totals footer in Arabic', () => {
    const result = buildJournalCsv([event()], 'ar', label);
    expect(result.csv).toContain('التاريخ,النوع,البيان,ملاحظة,المحفظة,العملة,المبلغ (وحدات صغرى)');
    expect(result.csv).toContain('# الإجمالي USD: -12500');
    expect(result.csv).not.toContain('Date,Kind');
  });

  it('neutralizes spreadsheet formula injection and quotes special cells', () => {
    const result = buildJournalCsv([event({
      id: 'evil', payeeName: '=1+1', note: 'said "hi", then left',
      movements: [{ walletId: 'w', walletName: '+wallet', currency: 'USD', amountMinor: '5000', walletArchived: false }],
    })], 'en', (value) => value.payeeName ?? '');

    const lines = result.csv.split('\n');
    const row = lines.find((line) => line.startsWith('2026-09-07')) ?? '';
    expect(row).toContain("'=1+1");
    expect(row).toContain("'+wallet");
    expect(row).toContain('"said ""hi"", then left"');
  });

  it('keeps exact minor totals per currency and reconciles them to the rows', () => {
    const result = buildJournalCsv([event(), event({
      id: 'lbp', kind: 'expense',
      movements: [{ walletId: 'w', walletName: 'Cash', currency: 'LBP', amountMinor: '-250000', walletArchived: false }],
    }), event({
      id: 'more-usd', kind: 'income',
      movements: [{ walletId: 'w', walletName: 'Cash', currency: 'USD', amountMinor: '40000', walletArchived: false }],
    })], 'en', label);

    expect(result.totals).toEqual([
      { currency: 'LBP', netMinor: '-250000' },
      { currency: 'USD', netMinor: '27500' },
    ]);
  });

  it('marks truncation at the row cap without exceeding it', () => {
    const many = Array.from({ length: 5 }, (_, index) => event({ id: `e${index}` }));
    const result = buildJournalCsv(many, 'en', label, { maxRows: 3 });
    expect(result.rowCount).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.csv).toContain('# truncated: true');
  });

  it('marks truncation at the byte cap', () => {
    const many = Array.from({ length: 50 }, (_, index) => event({ id: `e${index}` }));
    const result = buildJournalCsv(many, 'en', label, { maxBytes: 400 });
    expect(result.truncated).toBe(true);
    expect(result.csv.length).toBeLessThanOrEqual(400);
  });

  it('reports a null high-water and zero totals for an empty export', () => {
    const result = buildJournalCsv([], 'en', label);
    expect(result.highWaterMark).toBeNull();
    expect(result.totals).toEqual([]);
    expect(result.rowCount).toBe(0);
  });
});
