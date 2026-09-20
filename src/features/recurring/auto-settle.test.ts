import { describe, expect, it, vi } from 'vitest';

import type { Currency } from '../loans/types.js';
import type { LinkExistingInput, RecurringGateway, ScheduledOccurrenceRow } from './types.js';
import { autoSettleExpense, findSettleableOccurrence, type ExpenseForMatching } from './auto-settle.js';

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

function expense(overrides: Partial<ExpenseForMatching> = {}): ExpenseForMatching {
  return {
    eventId: 'event-9', categoryId: 'cat-internet', amountMinor: '6000',
    currency: 'USD' as Currency, effectiveDate: '2026-09-28',
    ...overrides,
  };
}

describe('findSettleableOccurrence', () => {
  it('links the single pending occurrence with the exact amount, currency, category, and a close due date', () => {
    expect(findSettleableOccurrence(expense(), [occurrence()])?.id).toBe('occ-1');
  });

  it.each([
    ['amount mismatch', { expectedMinor: '6500' }],
    ['currency mismatch', { currency: 'LBP' }],
    ['category mismatch', { categoryId: 'cat-rent' }],
    ['already settled', { state: 'settled', settledMinor: '6000', remainingMinor: '0' }],
    ['skipped', { state: 'skipped' }],
    ['partially settled', { state: 'partial', settledMinor: '2000', remainingMinor: '4000' }],
    ['due too far before', { dueDate: '2026-08-01' }],
    ['due too far after', { dueDate: '2026-11-05' }],
  ] as const)('rejects %s', (_label, overrides) => {
    expect(findSettleableOccurrence(expense(), [occurrence(overrides)])).toBeNull();
  });

  it('refuses to guess when several occurrences match', () => {
    const rows = [occurrence(), occurrence({ id: 'occ-2', dueDate: '2026-10-05' })];
    expect(findSettleableOccurrence(expense(), rows)).toBeNull();
  });

  it('matches an uncategorized occurrence against an uncategorized expense only', () => {
    const open = occurrence({ categoryId: null });
    expect(findSettleableOccurrence(expense({ categoryId: null }), [open])?.id).toBe('occ-1');
    expect(findSettleableOccurrence(expense({ categoryId: 'cat-other' }), [open])).toBeNull();
  });

  it('accepts due dates up to 31 days away on either side', () => {
    expect(findSettleableOccurrence(expense(), [occurrence({ dueDate: '2026-08-28' })])).not.toBeNull();
    expect(findSettleableOccurrence(expense(), [occurrence({ dueDate: '2026-10-29' })])).not.toBeNull();
  });
});

function fakeGateway(rows: ScheduledOccurrenceRow[], link = vi.fn(async (_input: LinkExistingInput) => ({ occurrenceId: 'occ-1', occurrenceEventId: 'oe-1', financialEventId: 'event-9' }))) {
  const gateway: Pick<RecurringGateway, 'loadOccurrences' | 'linkExisting'> = {
    loadOccurrences: vi.fn(async () => ({ rows, hasMore: false, nextCursor: null, asOf: '2026-09-20' })),
    linkExisting: link,
  };
  return { gateway: gateway as RecurringGateway, link };
}

describe('autoSettleExpense', () => {
  it('loads a window around the expense date and links the unique match', async () => {
    const { gateway, link } = fakeGateway([occurrence()]);
    const settled = await autoSettleExpense(gateway, 'space-1', expense());
    expect(settled).toBe('occ-1');
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

  it('returns null without linking when there is no unique match', async () => {
    const { gateway, link } = fakeGateway([]);
    expect(await autoSettleExpense(gateway, 'space-1', expense())).toBeNull();
    expect(link).not.toHaveBeenCalled();
  });

  it('never throws when the recurring read or link fails', async () => {
    const failing: Pick<RecurringGateway, 'loadOccurrences' | 'linkExisting'> = {
      loadOccurrences: vi.fn(async () => { throw new Error('network down'); }),
      linkExisting: vi.fn(async () => ({ occurrenceId: 'occ-1', occurrenceEventId: 'oe-1', financialEventId: 'event-9' })),
    };
    expect(await autoSettleExpense(failing as RecurringGateway, 'space-1', expense())).toBeNull();
  });
});
