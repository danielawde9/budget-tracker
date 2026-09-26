import { describe, expect, it, vi } from 'vitest';

import { postgrestRejection } from '../../test/postgrest-rejection.js';
import type { Currency } from '../loans/types.js';
import type { LinkExistingInput, RecurringGateway, ScheduledOccurrenceRow } from './types.js';
import { autoSettleRecordedEvent, findSettleableOccurrence, type RecordedEventForMatching } from './auto-settle.js';

function occurrence(overrides: Partial<ScheduledOccurrenceRow> = {}): ScheduledOccurrenceRow {
  return {
    id: 'occ-1', scheduleId: 'sch-1', sourceRevisionId: 'rev-1', currentEventId: 'evt-head-1',
    currency: 'USD', kind: 'expense', nameEn: 'Internet', nameAr: null, dueDate: '2026-09-30',
    expectedMinor: '6000', settledMinor: '0', remainingMinor: '6000', state: 'pending', overdue: false,
    categoryId: 'cat-internet', loanId: null, fundingGoalId: null, preferredWalletId: null,
    fundingShortfallMinor: null, asOf: '2026-09-20',
    ...overrides,
  };
}

function expense(overrides: Partial<RecordedEventForMatching> = {}): RecordedEventForMatching {
  return {
    eventId: 'event-9', eventKind: 'expense', categoryId: 'cat-internet', amountMinor: '6000',
    currency: 'USD' as Currency, effectiveDate: '2026-09-28',
    ...overrides,
  };
}

const flat = () => null;

describe('findSettleableOccurrence', () => {
  it('links the single pending occurrence with the exact amount, currency, category, and a close due date', () => {
    expect(findSettleableOccurrence(expense(), [occurrence()], flat))
      .toEqual({ kind: 'match', occurrence: expect.objectContaining({ id: 'occ-1' }) });
  });

  it.each([
    ['amount mismatch', { remainingMinor: '6500' }],
    ['currency mismatch', { currency: 'LBP' }],
    ['category mismatch', { categoryId: 'cat-rent' }],
    ['already settled', { state: 'settled', settledMinor: '6000', remainingMinor: '0' }],
    ['skipped', { state: 'skipped' }],
    ['partially settled', { state: 'partial', settledMinor: '2000', remainingMinor: '4000' }],
    ['due too far before', { dueDate: '2026-08-01' }],
    ['due too far after', { dueDate: '2026-11-05' }],
  ] as const)('rejects %s', (_label, overrides) => {
    expect(findSettleableOccurrence(expense(), [occurrence(overrides)], flat)).toEqual({ kind: 'none' });
  });

  it('picks the oldest unpaid occurrence of a single schedule', () => {
    const rows = [occurrence({ id: 'occ-oct', dueDate: '2026-10-30' }), occurrence({ id: 'occ-sep', dueDate: '2026-09-30' })];
    expect(findSettleableOccurrence(expense({ effectiveDate: '2026-09-30' }), rows, flat))
      .toEqual({ kind: 'match', occurrence: expect.objectContaining({ id: 'occ-sep' }) });
  });

  it('settles a weekly bill against its oldest unpaid week', () => {
    const weeks = ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'].map((dueDate, index) =>
      occurrence({ id: `w${index}`, dueDate, state: index === 0 ? 'settled' : 'pending', remainingMinor: index === 0 ? '0' : '6000' }));
    expect(findSettleableOccurrence(expense({ effectiveDate: '2026-09-15' }), weeks, flat))
      .toEqual({ kind: 'match', occurrence: expect.objectContaining({ id: 'w1' }) });
  });

  it('refuses to guess between two look-alike schedules', () => {
    const rows = [occurrence({ id: 'a', scheduleId: 'sch-music' }), occurrence({ id: 'b', scheduleId: 'sch-video' })];
    expect(findSettleableOccurrence(expense(), rows, flat)).toEqual({ kind: 'ambiguous', scheduleCount: 2 });
  });

  it('matches a subcategory entry to a bill on its parent category', () => {
    const parentOf = (id: string) => (id === 'cat-internet' ? 'cat-utilities' : null);
    const bill = occurrence({ categoryId: 'cat-utilities' });
    expect(findSettleableOccurrence(expense({ categoryId: 'cat-internet' }), [bill], parentOf).kind).toBe('match');
  });

  it('does not match sibling subcategories', () => {
    const parentOf = (id: string) => (id === 'cat-internet' || id === 'cat-power' ? 'cat-utilities' : null);
    const bill = occurrence({ categoryId: 'cat-power' });
    expect(findSettleableOccurrence(expense({ categoryId: 'cat-internet' }), [bill], parentOf).kind).toBe('none');
  });

  it('matches an uncategorized occurrence against an uncategorized expense only', () => {
    const open = occurrence({ categoryId: null });
    expect(findSettleableOccurrence(expense({ categoryId: null }), [open], flat))
      .toEqual({ kind: 'match', occurrence: expect.objectContaining({ id: 'occ-1' }) });
    expect(findSettleableOccurrence(expense({ categoryId: 'cat-other' }), [open], flat)).toEqual({ kind: 'none' });
  });

  it('settles the rest of a partly paid bill when the amount equals what remains', () => {
    const partial = occurrence({ state: 'partial', settledMinor: '2000', remainingMinor: '4000' });
    expect(findSettleableOccurrence(expense({ amountMinor: '4000' }), [partial], flat).kind).toBe('match');
  });

  it('accepts due dates up to 31 days away on either side', () => {
    expect(findSettleableOccurrence(expense(), [occurrence({ dueDate: '2026-08-28' })], flat).kind).toBe('match');
    expect(findSettleableOccurrence(expense(), [occurrence({ dueDate: '2026-10-29' })], flat).kind).toBe('match');
  });

  it('matches a recorded income only against an income schedule, never an expense one', () => {
    const incomeBill = occurrence({ kind: 'income' });
    expect(findSettleableOccurrence(expense({ eventKind: 'income' }), [incomeBill], flat).kind).toBe('match');
    expect(findSettleableOccurrence(expense({ eventKind: 'expense' }), [incomeBill], flat).kind).toBe('none');
  });
});

function fakeGateway(rows: ScheduledOccurrenceRow[], link = vi.fn(async (_input: LinkExistingInput) => ({ occurrenceId: 'occ-1', occurrenceEventId: 'oe-1', financialEventId: 'event-9' }))) {
  const gateway: Pick<RecurringGateway, 'loadOccurrences' | 'linkExisting'> = {
    loadOccurrences: vi.fn(async () => ({ rows, hasMore: false, nextCursor: null, asOf: '2026-09-20' })),
    linkExisting: link,
  };
  return { gateway: gateway as RecurringGateway, link };
}

describe('autoSettleRecordedEvent', () => {
  it('loads a window around the expense date and links the unique match', async () => {
    const { gateway, link } = fakeGateway([occurrence()]);
    const settled = await autoSettleRecordedEvent(gateway, 'space-1', expense(), flat);
    expect(settled).toEqual({ status: 'settled', occurrenceId: 'occ-1', nameEn: 'Internet', nameAr: null });
    const load = gateway.loadOccurrences as ReturnType<typeof vi.fn>;
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'space-1', fromDate: '2026-08-28', toDate: '2026-10-29', limit: 100 }));
    expect(link).toHaveBeenCalledWith(expect.objectContaining({
      spaceId: 'space-1',
      occurrenceId: 'occ-1',
      eventId: 'event-9',
      amountMinor: '6000',
      expectedEventId: 'evt-head-1',
    }));
    expect((link.mock.calls[0]?.[0])?.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns none without linking when there is no unique match', async () => {
    const { gateway, link } = fakeGateway([]);
    expect(await autoSettleRecordedEvent(gateway, 'space-1', expense(), flat)).toEqual({ status: 'none' });
    expect(link).not.toHaveBeenCalled();
  });

  it('reports ambiguity instead of guessing between look-alike schedules', async () => {
    const rows = [occurrence({ id: 'a', scheduleId: 'sch-music' }), occurrence({ id: 'b', scheduleId: 'sch-video' })];
    const { gateway, link } = fakeGateway(rows);
    expect(await autoSettleRecordedEvent(gateway, 'space-1', expense(), flat)).toEqual({ status: 'ambiguous', scheduleCount: 2 });
    expect(link).not.toHaveBeenCalled();
  });

  // Both reject with the plain `{ code, message }` object the real gateway
  // rethrows (postgrest-js 2.116.0), never `new Error(...)` -- final review I1.
  it('reports a read failure instead of swallowing it, classified', async () => {
    const failing: Pick<RecurringGateway, 'loadOccurrences' | 'linkExisting'> = {
      loadOccurrences: vi.fn(async () => { throw postgrestRejection('57014', 'canceling statement due to statement timeout'); }),
      linkExisting: vi.fn(async () => ({ occurrenceId: 'occ-1', occurrenceEventId: 'oe-1', financialEventId: 'event-9' })),
    };
    const outcome = await autoSettleRecordedEvent(failing as RecurringGateway, 'space-1', expense(), flat);
    expect(outcome).toEqual({ status: 'failed', error: expect.objectContaining({ code: 'timeout' }) });
    expect(JSON.stringify(outcome)).not.toContain('[object Object]');
  });

  it('reports a link failure instead of swallowing it, classified', async () => {
    const gateway = {
      loadOccurrences: vi.fn(async () => ({ rows: [occurrence()], nextCursor: null })),
      linkExisting: vi.fn(async (_input: LinkExistingInput) => {
        throw postgrestRejection('P0001', 'a payment cannot be linked before its effective date has occurred');
      }),
    } as unknown as RecurringGateway;
    const outcome = await autoSettleRecordedEvent(gateway, 'space-1', expense(), flat);
    expect(outcome).toEqual({
      status: 'failed',
      error: {
        code: 'effective_date_not_occurred',
        message: 'A payment can’t be recorded before its effective date has occurred.',
        recovery: 'Choose today or an earlier date.',
      },
    });
  });
});
