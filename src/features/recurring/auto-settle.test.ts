import { describe, expect, it, vi } from 'vitest';

import { postgrestRejection } from '../../test/postgrest-rejection.js';
import type { Currency } from '../loans/types.js';
import type {
  LinkExistingInput, LoadOccurrencesInput, RecurringGateway, ScheduledOccurrencePage, ScheduledOccurrenceRow,
} from './types.js';
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
    ['due more than 31 days after the entry (the ceiling for future-dated candidates)', { dueDate: '2026-11-05' }],
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

  it('accepts due dates up to 31 days after the entry, and any older unpaid due date', () => {
    expect(findSettleableOccurrence(expense(), [occurrence({ dueDate: '2026-08-28' })], flat).kind).toBe('match');
    expect(findSettleableOccurrence(expense(), [occurrence({ dueDate: '2026-10-29' })], flat).kind).toBe('match');
    // Final review I4: the window's lower bound is gone -- an overdue
    // occurrence of any age (served by the overdue list) is a candidate.
    expect(findSettleableOccurrence(expense(), [occurrence({ dueDate: '2026-05-01', overdue: true })], flat).kind).toBe('match');
  });

  it('never settles a newer occurrence while an older one of the same schedule is unpaid (final review I4)', () => {
    // September is partly paid ($20 left); October is due in full. A $60
    // entry matches October's remaining amount, but settling it would leave
    // September unpaid behind a settled newer bill.
    const rows = [
      occurrence({ id: 'sep', dueDate: '2026-09-01', state: 'partial', settledMinor: '4000', remainingMinor: '2000', overdue: true }),
      occurrence({ id: 'oct', dueDate: '2026-10-01' }),
    ];
    expect(findSettleableOccurrence(expense({ effectiveDate: '2026-09-26' }), rows, flat)).toEqual({ kind: 'none' });
  });

  it('still counts a schedule whose only matching occurrence is newer as a look-alike, so it cannot turn ambiguity into a guess', () => {
    const rows = [
      occurrence({ id: 'music', scheduleId: 'sch-music', dueDate: '2026-09-20' }),
      occurrence({ id: 'video-sep', scheduleId: 'sch-video', dueDate: '2026-09-05', state: 'partial', settledMinor: '1000', remainingMinor: '5000' }),
      occurrence({ id: 'video-oct', scheduleId: 'sch-video', dueDate: '2026-10-05' }),
    ];
    expect(findSettleableOccurrence(expense({ effectiveDate: '2026-09-26' }), rows, flat)).toEqual({ kind: 'ambiguous', scheduleCount: 2 });
  });

  it('matches a recorded income only against an income schedule, never an expense one', () => {
    const incomeBill = occurrence({ kind: 'income' });
    expect(findSettleableOccurrence(expense({ eventKind: 'income' }), [incomeBill], flat).kind).toBe('match');
    expect(findSettleableOccurrence(expense({ eventKind: 'expense' }), [incomeBill], flat).kind).toBe('none');
  });
});

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

describe('autoSettleRecordedEvent', () => {
  it('loads the overdue list and a window around the expense date, and links the unique match', async () => {
    const { gateway, link } = fakeGateway([occurrence()]);
    const settled = await autoSettleRecordedEvent(gateway, 'space-1', expense(), flat);
    expect(settled).toEqual({ status: 'settled', occurrenceId: 'occ-1', nameEn: 'Internet', nameAr: null });
    const load = gateway.loadOccurrences as ReturnType<typeof vi.fn>;
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'space-1', fromDate: '2026-08-28', toDate: '2026-10-29', limit: 100 }));
    expect(gateway.loadOverdue).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'space-1', afterDueDate: null, afterId: null, limit: 100 }));
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
    expect(await autoSettleRecordedEvent(gateway, 'space-1', expense(), flat))
      .toEqual({ status: 'ambiguous', reason: 'look_alike', scheduleCount: 2 });
    expect(link).not.toHaveBeenCalled();
  });

  it('dedupes an occurrence served by both the overdue list and the window', async () => {
    const overdue = occurrence({ dueDate: '2026-09-10', overdue: true });
    const { gateway, link } = fakeGateway([overdue], undefined, [overdue]);
    expect(await autoSettleRecordedEvent(gateway, 'space-1', expense(), flat))
      .toEqual({ status: 'settled', occurrenceId: 'occ-1', nameEn: 'Internet', nameAr: null });
    expect(link).toHaveBeenCalledOnce();
  });

  // Both reject with the plain `{ code, message }` object the real gateway
  // rethrows (postgrest-js 2.116.0), never `new Error(...)` -- final review I1.
  it('reports a read failure instead of swallowing it, classified', async () => {
    const failing: Pick<RecurringGateway, 'loadOccurrences' | 'loadOverdue' | 'linkExisting'> = {
      loadOccurrences: vi.fn(async () => { throw postgrestRejection('57014', 'canceling statement due to statement timeout'); }),
      loadOverdue: vi.fn(async () => page([])),
      linkExisting: vi.fn(async () => ({ occurrenceId: 'occ-1', occurrenceEventId: 'oe-1', financialEventId: 'event-9' })),
    };
    const outcome = await autoSettleRecordedEvent(failing as RecurringGateway, 'space-1', expense(), flat);
    expect(outcome).toEqual({ status: 'failed', error: expect.objectContaining({ code: 'timeout' }) });
    expect(JSON.stringify(outcome)).not.toContain('[object Object]');
  });

  it('reports a link failure instead of swallowing it, classified', async () => {
    const { gateway } = fakeGateway([occurrence()], vi.fn(async (_input: LinkExistingInput) => {
      throw postgrestRejection('P0001', 'a payment cannot be linked before its effective date has occurred');
    }));
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

/** A monthly $60 Internet bill as the server serves it on 2026-09-26:
 * Aug 1 and Sep 1 unpaid (so on the overdue list), Oct 1 upcoming. The
 * window route returns every state inside its date range; the overdue route
 * returns only unpaid, unskipped rows due before "today"; a link settles the
 * row, which then leaves the overdue list -- the way the real RPCs behave. */
function internetBillServer() {
  const TODAY = '2026-09-26';
  const rows = new Map<string, ScheduledOccurrenceRow>([
    ['aug', occurrence({ id: 'aug', dueDate: '2026-08-01', overdue: true, asOf: TODAY })],
    ['sep', occurrence({ id: 'sep', dueDate: '2026-09-01', overdue: true, asOf: TODAY })],
    ['oct', occurrence({ id: 'oct', dueDate: '2026-10-01', asOf: TODAY })],
  ]);
  const unpaid = (row: ScheduledOccurrenceRow) => row.state === 'pending' || row.state === 'partial';
  const link = vi.fn(async (input: LinkExistingInput) => {
    const row = rows.get(input.occurrenceId);
    if (!row) throw new Error(`no occurrence ${input.occurrenceId}`);
    rows.set(row.id, { ...row, state: 'settled', settledMinor: row.expectedMinor, remainingMinor: '0', overdue: false });
    return { occurrenceId: row.id, occurrenceEventId: 'oe-1', financialEventId: input.eventId };
  });
  const gateway: Pick<RecurringGateway, 'loadOccurrences' | 'loadOverdue' | 'linkExisting'> = {
    loadOccurrences: vi.fn(async (input: LoadOccurrencesInput) =>
      page([...rows.values()].filter((row) => row.dueDate >= input.fromDate && row.dueDate <= input.toDate))),
    loadOverdue: vi.fn(async () => page([...rows.values()].filter((row) => row.dueDate < TODAY && unpaid(row)))),
    linkExisting: link,
  };
  return { gateway: gateway as RecurringGateway, link, rows };
}

describe('autoSettleRecordedEvent settles the oldest unpaid occurrence (final review I4)', () => {
  it('links Aug 1 first, then Sep 1, and never Oct 1 while an older occurrence is unpaid', async () => {
    const { gateway, link, rows } = internetBillServer();
    const payment = (eventId: string) => expense({ eventId, effectiveDate: '2026-09-26' });

    expect(await autoSettleRecordedEvent(gateway, 'space-1', payment('event-1'), flat))
      .toEqual({ status: 'settled', occurrenceId: 'aug', nameEn: 'Internet', nameAr: null });
    expect(await autoSettleRecordedEvent(gateway, 'space-1', payment('event-2'), flat))
      .toEqual({ status: 'settled', occurrenceId: 'sep', nameEn: 'Internet', nameAr: null });

    expect(link.mock.calls.map((call) => call[0].occurrenceId)).toEqual(['aug', 'sep']);
    expect(rows.get('oct')?.state).toBe('pending');
  });
});

describe('autoSettleRecordedEvent refuses to decide on an incomplete list (final review M2)', () => {
  /** A list that always has another page: the shared pager stops at its cap
   * of 10 pages and reports the list as truncated. */
  function endlessPages(firstRows: ScheduledOccurrenceRow[]) {
    let calls = 0;
    return vi.fn(async () => {
      calls += 1;
      return page(calls === 1 ? firstRows : [], { dueDate: '2026-09-01', id: `cursor-${calls}` });
    });
  }

  it('returns ambiguous (truncated) without linking when the overdue list is cut off', async () => {
    const { gateway, link } = fakeGateway([occurrence()]);
    gateway.loadOverdue = endlessPages([]);
    expect(await autoSettleRecordedEvent(gateway, 'space-1', expense(), flat)).toEqual({ status: 'ambiguous', reason: 'truncated' });
    expect(gateway.loadOverdue).toHaveBeenCalledTimes(10);
    expect(link).not.toHaveBeenCalled();
  });

  it('returns ambiguous (truncated) without linking when the window is cut off, even with a match on its first page', async () => {
    const { gateway, link } = fakeGateway([]);
    gateway.loadOccurrences = endlessPages([occurrence()]);
    expect(await autoSettleRecordedEvent(gateway, 'space-1', expense(), flat)).toEqual({ status: 'ambiguous', reason: 'truncated' });
    expect(gateway.loadOccurrences).toHaveBeenCalledTimes(10);
    expect(link).not.toHaveBeenCalled();
  });
});
