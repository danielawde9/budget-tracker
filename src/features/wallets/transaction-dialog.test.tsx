import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Category } from '../categories/types.js';
import type { JournalEvent } from './types.js';
import { TransactionDialog } from './transaction-dialog.js';

const categories: readonly Category[] = [
  {
    id: 'category-essentials', spaceId: 'space-1', kind: 'expense', nameEn: 'Essentials', nameAr: 'الأساسيات',
    parentCategoryId: null, createdAt: '2026-09-08T10:00:00Z', archivedAt: null,
  },
  {
    id: 'category-groceries', spaceId: 'space-1', kind: 'expense', nameEn: 'Groceries', nameAr: 'بقالة',
    parentCategoryId: 'category-essentials', createdAt: '2026-09-08T11:00:00Z', archivedAt: null,
  },
];

function renderDialog(locale: 'en' | 'ar' = 'en') {
  const onSubmit = vi.fn(async () => ({ status: 'success' as const, reconciled: false }));
  const user = userEvent.setup();
  render(<TransactionDialog
    locale={locale}
    wallets={[{ id: 'wallet-1', spaceId: 'space-1', name: 'Daily USD', currency: 'USD', archivedAt: null, balanceMinor: '0' }]}
    categories={categories}
    pending={false}
    ambiguous={false}
    onClose={vi.fn()}
    onClearAmbiguous={vi.fn()}
    onRetry={vi.fn()}
    onRefresh={vi.fn()}
    onSubmit={onSubmit}
  />);
  return { onSubmit, user };
}

describe('TransactionDialog defaults', () => {
  it('records an untouched type as an expense that takes money out of the wallet', async () => {
    const { onSubmit, user } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Add a transaction' });
    await user.type(within(dialog).getByLabelText('Amount'), '12.50');
    await user.click(within(dialog).getByRole('button', { name: 'Review transaction' }));
    await user.click(within(dialog).getByRole('button', { name: /^Record / }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'expense',
      movements: [{ walletId: 'wallet-1', amountMinor: '-1250' }],
    }));
  });

  it('submits an optional payee and note with the reviewed immutable transaction', async () => {
    const { onSubmit, user } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Add a transaction' });
    await user.type(within(dialog).getByLabelText('Payee'), 'Cedar Market');
    await user.type(within(dialog).getByLabelText('Note'), 'groceries for the week');
    await user.type(within(dialog).getByLabelText('Amount'), '12.50');
    await user.click(within(dialog).getByRole('button', { name: 'Review transaction' }));
    await user.click(within(dialog).getByRole('button', { name: /^Record / }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      payeeName: 'Cedar Market',
      note: 'groceries for the week',
    }));
  });
});

describe('TransactionDialog category hierarchy', () => {
  it('groups children beneath their root and submits the exact child with exact minor units', async () => {
    const { onSubmit, user } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Add a transaction' });
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'expense');

    const children = within(dialog).getByRole('group', { name: 'Subcategories of Essentials' });
    expect(within(children).getByText('Groceries').closest('bdi')).not.toBeNull();
    await user.click(within(children).getByRole('radio', { name: 'Groceries' }));
    await user.type(within(dialog).getByLabelText('Amount'), '12.50');
    await user.click(within(dialog).getByRole('button', { name: 'Review transaction' }));
    expect(within(dialog).getByRole('region', { name: 'Wallet effect preview' })).toHaveTextContent('Category Groceries');
    await user.click(within(dialog).getByRole('button', { name: 'Record expense' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'expense',
      movements: [{ walletId: 'wallet-1', amountMinor: '-1250' }],
      categoryId: 'category-groceries',
    }));
  });

  it('exposes equivalent Arabic hierarchy labels without changing stored names', async () => {
    const { user } = renderDialog('ar');
    const dialog = screen.getByRole('dialog', { name: 'إضافة معاملة' });
    await user.selectOptions(within(dialog).getByLabelText('النوع'), 'expense');
    const children = within(dialog).getByRole('group', { name: 'الفئات الفرعية ضمن الأساسيات' });
    expect(within(children).getByText('بقالة').closest('bdi')).not.toBeNull();
  });
});

describe('TransactionDialog Quick Entry', () => {
  it('opens a repeat-as-new draft with its remembered wallet, category, payee, and amount', () => {
    const onSubmit = vi.fn(async () => ({ status: 'success' as const, reconciled: false }));
    render(<TransactionDialog
      locale="en"
      wallets={[{ id: 'wallet-1', spaceId: 'space-1', name: 'Daily USD', currency: 'USD', archivedAt: null, balanceMinor: '0' }]}
      categories={categories}
      quickEntryDefaults={{ kind: 'expense', walletId: 'wallet-1', categoryId: 'category-groceries', payeeName: 'Cedar Market', amount: '12.50' }}
      pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onRefresh={vi.fn()} onSubmit={onSubmit}
    />);

    const dialog = screen.getByRole('dialog', { name: 'Add a transaction' });
    expect(within(dialog).getByLabelText('Amount')).toHaveValue('12.50');
    expect(within(dialog).getByLabelText('Payee')).toHaveValue('Cedar Market');
    expect(within(dialog).getByRole('radio', { name: 'Groceries' })).toBeChecked();
  });

  it('shows an overridable category suggestion only after two of the last three payee entries agree', async () => {
    const recentEvents: readonly JournalEvent[] = ['1', '2', '3'].map((id, index) => ({
      id, spaceId: 'space-1', requestId: id, kind: 'expense', effectiveDate: '2026-09-10', createdAt: `2026-09-10T0${index}:00:00Z`, reversalOf: null, reversedBy: null, loanLinked: false,
      movements: [{ walletId: 'wallet-1', walletName: 'Daily USD', currency: 'USD', amountMinor: '-1250', walletArchived: false }],
      category: { id: index === 1 ? 'category-essentials' : 'category-groceries', kind: 'expense', nameEn: 'Category', nameAr: null, archivedAt: null }, payeeName: 'Cedar Market',
    }));
    const user = userEvent.setup();
    render(<TransactionDialog locale="en" wallets={[{ id: 'wallet-1', spaceId: 'space-1', name: 'Daily USD', currency: 'USD', archivedAt: null, balanceMinor: '0' }]} categories={categories} recentEvents={recentEvents} pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onRefresh={vi.fn()} onSubmit={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Add a transaction' });
    await user.type(within(dialog).getByLabelText('Payee'), 'Cedar Market');

    expect(within(dialog).getByRole('radio', { name: 'Groceries' })).toBeChecked();
    expect(within(dialog).getByRole('status')).toHaveTextContent('Category suggested from 2 of your last 3 entries');
  });
});
