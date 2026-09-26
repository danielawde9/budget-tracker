import { describe, expect, it, vi } from 'vitest';

import { postgrestRejection } from '../../test/postgrest-rejection.js';
import type { Currency } from '../loans/types.js';
import type {
  LinkExistingInput, LinkExistingResult, RecurringGateway, ScheduledOccurrencePage, ScheduledOccurrenceRow,
} from './types.js';
import { settleLoanRepayment, type RecordedRepayment } from './settle-loan-repayment.js';

function occurrence(overrides: Partial<ScheduledOccurrenceRow> = {}): ScheduledOccurrenceRow {
  return {
    id: 'occ-1', scheduleId: 'sch-1', sourceRevisionId: 'rev-1', currentEventId: 'evt-head-1',
    currency: 'USD', kind: 'debt_payment', nameEn: 'Karim', nameAr: null, dueDate: '2026-09-01',
    expectedMinor: '50000', settledMinor: '0', remainingMinor: '50000', state: 'pending', overdue: false,
    categoryId: null, loanId: 'loan-1', fundingGoalId: null, preferredWalletId: null,
    fundingShortfallMinor: null, asOf: '2026-09-20',
    ...overrides,
  };
}

function repayment(overrides: Partial<RecordedRepayment> = {}): RecordedRepayment {
  return {
    eventId: 'event-9', loanId: 'loan-1', amountMinor: '50000',
    currency: 'USD' as Currency, effectiveDate: '2026-09-15',
    ...overrides,
  };
}

function page(rows: readonly ScheduledOccurrenceRow[], nextCursor: ScheduledOccurrencePage['nextCursor'] = null): ScheduledOccurrencePage {
  return { rows, hasMore: nextCursor !== null, nextCursor, asOf: '2026-09-20' };
}

function fakeGateway(
  rows: ScheduledOccurrenceRow[],
  link = vi.fn(async (_input: LinkExistingInput) => ({ occurrenceId: 'occ-1', occurrenceEventId: 'oe-1', financialEventId: 'event-9' })),
  overdueRows: ScheduledOccurrenceRow[] = [],
) {
  const gateway: Pick<RecurringGateway, 'loadOccurrences' | 'loadOverdue' | 'linkExisting'> = {
    loadOccurrences: vi.fn(async () => page(rows)),
    loadOverdue: vi.fn(async () => page(overdueRows)),
    linkExisting: link,
  };
  return { gateway: gateway as RecurringGateway, link };
}

const LINK_REFUSED = postgrestRejection('P0001', 'a payment cannot be linked before its effective date has occurred');

function dueDateForIndex(index: number): string {
  return `2026-01-${String(index + 1).padStart(2, '0')}`;
}

describe('settleLoanRepayment', () => {
  it('links one instalment in full when the repayment exactly covers it', async () => {
    const { gateway, link } = fakeGateway([occurrence()]);
    const outcome = await settleLoanRepayment(gateway, 'space-1', repayment());
    expect(outcome).toEqual({ status: 'settled', occurrenceId: 'occ-1', nameEn: 'Karim', nameAr: null, remainsDue: false });
    expect(link).toHaveBeenCalledOnce();
    expect(link).toHaveBeenCalledWith(expect.objectContaining({
      spaceId: 'space-1', occurrenceId: 'occ-1', eventId: 'event-9', amountMinor: '50000', expectedEventId: 'evt-head-1',
    }));
    expect((link.mock.calls[0]?.[0])?.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('links two instalments oldest first when the repayment covers both months', async () => {
    const sep = occurrence({ id: 'occ-sep', dueDate: '2026-09-01' });
    const oct = occurrence({ id: 'occ-oct', dueDate: '2026-10-01' });
    const { gateway, link } = fakeGateway([oct, sep]); // deliberately out of order
    const outcome = await settleLoanRepayment(gateway, 'space-1', repayment({ amountMinor: '100000', effectiveDate: '2026-10-05' }));
    expect(outcome).toEqual({ status: 'settled', occurrenceId: 'occ-sep', nameEn: 'Karim', nameAr: null, remainsDue: false });
    expect(link).toHaveBeenCalledTimes(2);
    expect(link.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ occurrenceId: 'occ-sep', amountMinor: '50000' }));
    expect(link.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ occurrenceId: 'occ-oct', amountMinor: '50000' }));
  });

  it('links a partial amount when the repayment is smaller than the instalment, and says part of it is still due', async () => {
    const { gateway, link } = fakeGateway([occurrence()]);
    const outcome = await settleLoanRepayment(gateway, 'space-1', repayment({ amountMinor: '20000' }));
    // Final review M3: 20000 of a 50000 instalment is not "paid".
    expect(outcome).toEqual({ status: 'settled', occurrenceId: 'occ-1', nameEn: 'Karim', nameAr: null, remainsDue: true });
    expect(link).toHaveBeenCalledOnce();
    expect(link).toHaveBeenCalledWith(expect.objectContaining({ occurrenceId: 'occ-1', amountMinor: '20000' }));
  });

  it('links only the remaining amount and leaves the rest unlinked on an overpayment', async () => {
    const { gateway, link } = fakeGateway([occurrence()]);
    const outcome = await settleLoanRepayment(gateway, 'space-1', repayment({ amountMinor: '70000' }));
    expect(outcome).toEqual({ status: 'settled', occurrenceId: 'occ-1', nameEn: 'Karim', nameAr: null, remainsDue: false });
    expect(link).toHaveBeenCalledOnce();
    expect(link).toHaveBeenCalledWith(expect.objectContaining({ occurrenceId: 'occ-1', amountMinor: '50000' }));
  });

  it('says part of it is still due when the repayment covers one instalment and only part of the next', async () => {
    const sep = occurrence({ id: 'occ-sep', dueDate: '2026-09-01' });
    const oct = occurrence({ id: 'occ-oct', dueDate: '2026-10-01' });
    const { gateway, link } = fakeGateway([sep, oct]);
    const outcome = await settleLoanRepayment(gateway, 'space-1', repayment({ amountMinor: '70000', effectiveDate: '2026-10-05' }));
    expect(outcome).toEqual({ status: 'settled', occurrenceId: 'occ-sep', nameEn: 'Karim', nameAr: null, remainsDue: true });
    expect(link.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ occurrenceId: 'occ-oct', amountMinor: '20000' }));
  });

  it("ignores another loan's instalments", async () => {
    const { gateway, link } = fakeGateway([occurrence({ loanId: 'loan-2' })]);
    const outcome = await settleLoanRepayment(gateway, 'space-1', repayment());
    expect(outcome).toEqual({ status: 'none' });
    expect(link).not.toHaveBeenCalled();
  });

  it('links at most 12 instalments even when the repayment covers all 30 pending ones', async () => {
    const rows = Array.from({ length: 30 }, (_unused, index) =>
      occurrence({ id: `occ-${index}`, dueDate: dueDateForIndex(index) }));
    const { gateway, link } = fakeGateway(rows);
    const outcome = await settleLoanRepayment(gateway, 'space-1', repayment({ amountMinor: '1500000', effectiveDate: '2026-02-01' }));
    expect(outcome).toEqual({ status: 'settled', occurrenceId: 'occ-0', nameEn: 'Karim', nameAr: null, remainsDue: false });
    expect(link).toHaveBeenCalledTimes(12);
    expect(link.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ occurrenceId: 'occ-0' }));
    expect(link.mock.calls[11]?.[0]).toEqual(expect.objectContaining({ occurrenceId: 'occ-11' }));
  });

  // Rejections use the plain `{ code, message }` object the real gateway
  // rethrows (postgrest-js 2.116.0), never `new Error(...)` -- final review I1.
  it('reports a link failure instead of swallowing it, classified', async () => {
    const { gateway } = fakeGateway([occurrence()], vi.fn(async (_input: LinkExistingInput): Promise<LinkExistingResult> => { throw LINK_REFUSED; }));
    await expect(settleLoanRepayment(gateway, 'space-1', repayment()))
      .resolves.toEqual({ status: 'failed', error: expect.objectContaining({ code: 'effective_date_not_occurred' }) });
  });

  it('reports a partial settlement when a later link fails after an earlier one already succeeded', async () => {
    const sep = occurrence({ id: 'occ-sep', dueDate: '2026-09-01' });
    const oct = occurrence({ id: 'occ-oct', dueDate: '2026-10-01' });
    const link = vi.fn(async (_input: LinkExistingInput): Promise<LinkExistingResult> => ({
      occurrenceId: 'occ-1', occurrenceEventId: 'oe-1', financialEventId: 'event-9',
    }));
    link.mockResolvedValueOnce({ occurrenceId: 'occ-sep', occurrenceEventId: 'oe-1', financialEventId: 'event-9' });
    link.mockRejectedValueOnce(LINK_REFUSED);
    const { gateway } = fakeGateway([oct, sep], link);
    const outcome = await settleLoanRepayment(gateway, 'space-1', repayment({ amountMinor: '100000', effectiveDate: '2026-10-05' }));
    expect(outcome).toEqual({
      status: 'partial', occurrenceId: 'occ-sep', nameEn: 'Karim', nameAr: null,
      linkedCount: 1, error: expect.objectContaining({ code: 'effective_date_not_occurred' }),
    });
    expect(link).toHaveBeenCalledTimes(2);
  });
});

describe('settleLoanRepayment reads the overdue list too (final review I4, M2)', () => {
  it('settles the oldest overdue instalment first, even one older than its own 59-day look-back', async () => {
    // Repayment dated 2026-09-26: the window starts 2026-07-29, so the June
    // instalment is only on the overdue list.
    const june = occurrence({ id: 'occ-jun', dueDate: '2026-06-01', overdue: true });
    const sep = occurrence({ id: 'occ-sep', dueDate: '2026-09-01', overdue: true });
    const { gateway, link } = fakeGateway([sep], undefined, [june, sep]);
    const outcome = await settleLoanRepayment(gateway, 'space-1', repayment({ effectiveDate: '2026-09-26' }));
    expect(outcome).toEqual({ status: 'settled', occurrenceId: 'occ-jun', nameEn: 'Karim', nameAr: null, remainsDue: false });
    expect(link).toHaveBeenCalledOnce();
    expect(link).toHaveBeenCalledWith(expect.objectContaining({ occurrenceId: 'occ-jun', amountMinor: '50000' }));
    expect(gateway.loadOccurrences).toHaveBeenCalledWith(expect.objectContaining({ fromDate: '2026-07-29', toDate: '2026-10-26', limit: 100 }));
    expect(gateway.loadOverdue).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  });

  it('links an instalment served by both lists once', async () => {
    const sep = occurrence({ id: 'occ-sep', dueDate: '2026-09-01', overdue: true });
    const { gateway, link } = fakeGateway([sep], undefined, [sep]);
    await settleLoanRepayment(gateway, 'space-1', repayment({ amountMinor: '100000', effectiveDate: '2026-09-26' }));
    expect(link).toHaveBeenCalledOnce();
  });

  it('returns ambiguous (truncated) without linking when a candidate list is cut off', async () => {
    let calls = 0;
    const { gateway, link } = fakeGateway([]);
    gateway.loadOccurrences = vi.fn(async () => {
      calls += 1;
      return page(calls === 1 ? [occurrence()] : [], { dueDate: '2026-09-01', id: `cursor-${calls}` });
    });
    expect(await settleLoanRepayment(gateway, 'space-1', repayment())).toEqual({ status: 'ambiguous', reason: 'truncated' });
    expect(gateway.loadOccurrences).toHaveBeenCalledTimes(10);
    expect(link).not.toHaveBeenCalled();
  });
});
