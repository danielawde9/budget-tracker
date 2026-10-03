import { describe, expect, it, vi } from 'vitest';

import type { JournalEvent, WalletsGateway } from '../wallets/types.js';
import { linkableEventKind, loadLinkableEvents } from './linkable-events.js';

function event(overrides: Partial<JournalEvent> = {}): JournalEvent {
  return {
    id: 'event-1', spaceId: 'space-1', requestId: 'req-1', kind: 'expense',
    effectiveDate: '2026-09-20', createdAt: '2026-09-20T10:00:00Z',
    reversalOf: null, reversedBy: null, loanLinked: false,
    movements: [{ walletId: 'w1', walletName: 'Daily USD', currency: 'USD', amountMinor: '-4500', walletArchived: false }],
    ...overrides,
  };
}

function wallets(events: readonly JournalEvent[]) {
  const gateway: Pick<WalletsGateway, 'searchJournal'> = {
    searchJournal: vi.fn(async () => ({ events, nextCursor: null })),
  };
  return { gateway: gateway as WalletsGateway, search: gateway.searchJournal as ReturnType<typeof vi.fn> };
}

describe('linkableEventKind', () => {
  it('maps each occurrence kind to the wallet event that settles it', () => {
    expect(linkableEventKind('expense')).toBe('expense');
    expect(linkableEventKind('income')).toBe('income');
    expect(linkableEventKind('debt_payment')).toBe('loan_repay_borrowing');
  });
});

describe('loadLinkableEvents (D4)', () => {
  it('offers eligible expenses beyond the first journal page', async () => {
    const searchJournal = vi.fn()
      .mockResolvedValueOnce({ events: [event({ kind: 'income' })], nextCursor: 'older' })
      .mockResolvedValueOnce({ events: [event({ id: 'older-expense' })], nextCursor: null });
    const options = await loadLinkableEvents({ searchJournal }, 'space-1', { kind: 'expense', currency: 'USD' });
    expect(options.map(option => option.id)).toEqual(['older-expense']);
    expect(searchJournal).toHaveBeenLastCalledWith('space-1', { limit: 50, cursor: 'older' });
  });

  it('offers an expense event with its positive eligible amount', async () => {
    const { gateway } = wallets([event()]);
    await expect(loadLinkableEvents(gateway, 'space-1', { kind: 'expense', currency: 'USD' })).resolves.toEqual([
      { id: 'event-1', kind: 'expense', effectiveDate: '2026-09-20', amountMinor: '4500', currency: 'USD', label: 'Daily USD' },
    ]);
  });

  it('drops events of the wrong kind, reversed events, reversals, and other currencies', async () => {
    const { gateway } = wallets([
      event({ id: 'income', kind: 'income', movements: [{ walletId: 'w1', walletName: 'Daily USD', currency: 'USD', amountMinor: '9000', walletArchived: false }] }),
      event({ id: 'reversed', reversedBy: 'reversal-1' }),
      event({ id: 'reversal', reversalOf: 'event-1', kind: 'reversal' }),
      event({ id: 'lbp', movements: [{ walletId: 'w2', walletName: 'Daily LBP', currency: 'LBP', amountMinor: '-9000000', walletArchived: false }] }),
      event({ id: 'multi', movements: [
        { walletId: 'w1', walletName: 'Daily USD', currency: 'USD', amountMinor: '-1000', walletArchived: false },
        { walletId: 'w2', walletName: 'Daily LBP', currency: 'LBP', amountMinor: '-9000000', walletArchived: false },
      ] }),
      event({ id: 'keep' }),
    ]);
    const options = await loadLinkableEvents(gateway, 'space-1', { kind: 'expense', currency: 'USD' });
    expect(options.map((option) => option.id)).toEqual(['keep']);
  });

  it('offers a loan repayment for a debt-payment occurrence', async () => {
    const repayment = event({ id: 'repay', kind: 'loan_repay_borrowing', payeeName: 'Karim',
      movements: [{ walletId: 'w1', walletName: 'Daily USD', currency: 'USD', amountMinor: '-50000', walletArchived: false }] });
    const { gateway } = wallets([repayment]);
    await expect(loadLinkableEvents(gateway, 'space-1', { kind: 'debt_payment', currency: 'USD' })).resolves.toEqual([
      expect.objectContaining({ id: 'repay', kind: 'loan_repay_borrowing', amountMinor: '50000', label: 'Karim' }),
    ]);
  });
});
