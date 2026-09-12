import { describe, expect, it } from 'vitest';

import type { Category } from '../categories/types.js';
import type { JournalEvent, WalletProjection } from './types.js';
import { suggestedCategoryForPayee, transactionDefaultsFromRecentEvent } from './quick-entry.js';

const wallets: readonly WalletProjection[] = [
  { id: 'daily-usd', spaceId: 'space-1', name: 'Daily USD', currency: 'USD', archivedAt: null, balanceMinor: '0' },
  { id: 'daily-lbp', spaceId: 'space-1', name: 'Daily LBP', currency: 'LBP', archivedAt: null, balanceMinor: '0' },
];

const groceries: Category = { id: 'groceries', spaceId: 'space-1', kind: 'expense', nameEn: 'Groceries', nameAr: null, parentCategoryId: null, createdAt: '2026-09-01T00:00:00Z', archivedAt: null };
const dining: Category = { id: 'dining', spaceId: 'space-1', kind: 'expense', nameEn: 'Dining', nameAr: null, parentCategoryId: null, createdAt: '2026-09-01T00:00:00Z', archivedAt: null };

function expense(id: string, categoryId: string | null, payeeName = 'Cedar Market'): JournalEvent {
  return {
    id, spaceId: 'space-1', requestId: `request-${id}`, kind: 'expense', effectiveDate: '2026-09-10', createdAt: '2026-09-10T10:00:00Z', reversalOf: null, reversedBy: null, loanLinked: false,
    movements: [{ walletId: 'daily-usd', walletName: 'Daily USD', currency: 'USD', amountMinor: '-1250', walletArchived: false }],
    category: categoryId ? { id: categoryId, kind: 'expense', nameEn: categoryId, nameAr: null, archivedAt: null } : null,
    payeeName,
  };
}

describe('Quick Entry defaults', () => {
  it('reuses the most recent eligible expense wallet, category, payee, and exact amount as a new draft', () => {
    expect(transactionDefaultsFromRecentEvent(expense('latest', 'groceries'), wallets, [groceries, dining])).toEqual({
      kind: 'expense', walletId: 'daily-usd', categoryId: 'groceries', payeeName: 'Cedar Market', amount: '12.50',
    });
  });

  it('suggests a payee category only when two of the last three matching entries agree', () => {
    const recent = [expense('newest', 'groceries'), expense('middle', 'dining'), expense('oldest', 'groceries')];

    expect(suggestedCategoryForPayee(recent, '  cedar market ', 'expense', [groceries, dining])).toBe('groceries');
  });

  it('does not suggest a category when the last three matching entries do not have a two-entry agreement', () => {
    const recent = [expense('newest', 'groceries'), expense('middle', 'dining'), expense('oldest', null)];

    expect(suggestedCategoryForPayee(recent, 'Cedar Market', 'expense', [groceries, dining])).toBeNull();
  });
});
