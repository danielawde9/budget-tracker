import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryCategoriesGateway } from '../../test/in-memory-categories-gateway.js';
import { InMemoryWalletsGateway } from '../../test/in-memory-wallets-gateway.js';
import type { CategoriesGateway } from '../categories/types.js';
import type { RecordEventInput } from './types.js';
import { WalletsPage } from './wallets-page.js';

async function renderPage(
  gateway = new InMemoryWalletsGateway(),
  locale: 'en' | 'ar' = 'en',
  categoriesGateway?: CategoriesGateway,
) {
  const user = userEvent.setup();
  render(<WalletsPage gateway={gateway} {...(categoriesGateway ? { categoriesGateway } : {})} spaceId="personal-space" locale={locale} onSpaceUnavailable={vi.fn()} onOpenLoans={vi.fn()} />);
  await screen.findByRole('heading', { name: locale === 'ar' ? 'المحافظ' : 'Wallets' });
  await waitFor(() => expect(screen.queryByRole('status', { name: /loading/i })).not.toBeInTheDocument());
  return { gateway, user };
}

async function openArabicCategorizedIncome(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'إضافة معاملة' }));
  const dialog = screen.getByRole('dialog', { name: 'إضافة معاملة' });
  await user.click(within(dialog).getByRole('radio', { name: 'راتب' }));
  await user.type(within(dialog).getByLabelText('المبلغ'), '12.50');
  await user.click(within(dialog).getByRole('button', { name: 'مراجعة المعاملة' }));
  return dialog;
}

describe('WalletsPage', () => {
  it('renders active wallet balances and immutable history with sourced names isolated', async () => {
    await renderPage();
    expect(screen.getAllByText('Daily USD').every((element) => element.closest('bdi') !== null)).toBe(true);
    expect(screen.getByText('$1,250.50').closest('bdi')).not.toBeNull();
    expect(screen.getByText('Daily LBP').closest('bdi')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Transaction history' })).toBeInTheDocument();
    expect(screen.getByText('Loan payment')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /archive|delete/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Correct income' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Correct loan payment' })).not.toBeInTheDocument();
  });

  it('keeps wallet form values after a database rejection', async () => {
    const gateway = new InMemoryWalletsGateway();
    const { user } = await renderPage(gateway);
    await user.click(screen.getByRole('button', { name: 'New wallet' }));
    const dialog = screen.getByRole('dialog', { name: 'Create a wallet' });
    await user.type(within(dialog).getByLabelText('Wallet name'), 'Travel cash');
    await user.selectOptions(within(dialog).getByLabelText('Currency'), 'LBP');
    gateway.error = new Error('wallet creation rejected');
    await user.click(within(dialog).getByRole('button', { name: 'Create wallet' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('wallet creation rejected');
    expect(within(dialog).getByDisplayValue('Travel cash')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('LBP')).toBeInTheDocument();
  });

  it('previews and records exact minor-unit movement signs for every general event kind', async () => {
    const { gateway, user } = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));
    let dialog = screen.getByRole('dialog', { name: 'Add a transaction' });
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'opening_balance');
    await user.type(within(dialog).getByLabelText('Amount'), '20');
    await user.click(within(dialog).getByRole('button', { name: 'Review transaction' }));
    await user.click(within(dialog).getByRole('button', { name: 'Record opening balance' }));
    await within(dialog).findByText('Transaction recorded');
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));

    await user.click(screen.getByRole('button', { name: 'Add transaction' }));
    dialog = screen.getByRole('dialog', { name: 'Add a transaction' });
    await user.type(within(dialog).getByLabelText('Amount'), '12.50');
    await user.click(within(dialog).getByRole('button', { name: 'Review transaction' }));
    expect(within(dialog).getByRole('region', { name: 'Wallet effect preview' })).toHaveTextContent('Daily USD receives $12.50');
    await user.click(within(dialog).getByRole('button', { name: 'Record income' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Transaction recorded');
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));

    await user.click(screen.getByRole('button', { name: 'Add transaction' }));
    dialog = screen.getByRole('dialog', { name: 'Add a transaction' });
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'expense');
    await user.type(within(dialog).getByLabelText('Amount'), '3');
    await user.click(within(dialog).getByRole('button', { name: 'Review transaction' }));
    await user.click(within(dialog).getByRole('button', { name: 'Record expense' }));
    await within(dialog).findByText('Transaction recorded');
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));

    await user.click(screen.getByRole('button', { name: 'Add transaction' }));
    dialog = screen.getByRole('dialog', { name: 'Add a transaction' });
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'transfer');
    await user.type(within(dialog).getByLabelText('Amount'), '10');
    await user.click(within(dialog).getByRole('button', { name: 'Review transaction' }));
    expect(within(dialog).getByRole('region', { name: 'Wallet effect preview' })).toHaveTextContent('Daily USD sends $10.00');
    expect(within(dialog).getByRole('region', { name: 'Wallet effect preview' })).toHaveTextContent('Reserve USD receives $10.00');
    await user.click(within(dialog).getByRole('button', { name: 'Record transfer' }));
    await within(dialog).findByText('Transaction recorded');

    const inputs = gateway.calls.filter((call) => call.name === 'recordEvent').map((call) => call.input as RecordEventInput);
    expect(inputs[0]?.movements).toEqual([{ walletId: 'wallet-usd-1', amountMinor: '2000' }]);
    expect(inputs[1]?.movements).toEqual([{ walletId: 'wallet-usd-1', amountMinor: '1250' }]);
    expect(inputs[2]?.movements).toEqual([{ walletId: 'wallet-usd-1', amountMinor: '-300' }]);
    expect(inputs[3]?.movements).toEqual([
      { walletId: 'wallet-usd-1', amountMinor: '-1000' },
      { walletId: 'wallet-usd-2', amountMinor: '1000' },
    ]);
  });

  it('preserves safe transaction values after a database rejection', async () => {
    const gateway = new InMemoryWalletsGateway();
    const { user } = await renderPage(gateway);
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a transaction' });
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'expense');
    await user.type(within(dialog).getByLabelText('Amount'), '18.75');
    await user.click(within(dialog).getByRole('button', { name: 'Review transaction' }));
    gateway.error = new Error('transaction rejected by database');
    await user.click(within(dialog).getByRole('button', { name: 'Record expense' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('transaction rejected by database');
    expect(within(dialog).getByDisplayValue('18.75')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Type')).toHaveValue('expense');
  });

  it('offers active categories only for income and expense and records the selected exact category', async () => {
    const walletGateway = new InMemoryWalletsGateway();
    const categoriesGateway = new InMemoryCategoriesGateway();
    categoriesGateway.categories = categoriesGateway.categories.map((category) => ({ ...category, spaceId: 'personal-space' }));
    const { user } = await renderPage(walletGateway, 'en', categoriesGateway);

    await user.click(screen.getByRole('button', { name: 'Add transaction' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a transaction' });
    const picker = within(dialog).getByRole('group', { name: 'Category' });
    expect(within(picker).getByText('Salary').closest('bdi')).not.toBeNull();
    expect(within(picker).getByRole('radio', { name: 'Uncategorized' })).toBeChecked();
    await user.click(within(picker).getByRole('radio', { name: 'Salary' }));
    await user.type(within(dialog).getByLabelText('Amount'), '12.50');
    await user.click(within(dialog).getByRole('button', { name: 'Review transaction' }));
    expect(within(dialog).getByRole('region', { name: 'Wallet effect preview' })).toHaveTextContent('Category Salary');
    await user.click(within(dialog).getByRole('button', { name: 'Record income' }));
    await within(dialog).findByText('Transaction recorded');

    expect(categoriesGateway.calls).toContainEqual({
      name: 'recordCategorizedEvent',
      input: {
        spaceId: 'personal-space',
        requestId: expect.any(String),
        kind: 'income',
        effectiveDate: expect.any(String),
        movements: [{ walletId: 'wallet-usd-1', amountMinor: '1250' }],
        categoryId: 'category-salary',
      },
    });
    expect(walletGateway.calls.some((call) => call.name === 'recordEvent')).toBe(false);
  });

  it('loads later bounded category pages into the eligible transaction picker', async () => {
    const categoriesGateway: CategoriesGateway = new InMemoryCategoriesGateway();
    const incomeCategories = Array.from({ length: 51 }, (_, index) => ({
      id: `category-${index + 1}`,
      spaceId: 'personal-space',
      kind: 'income' as const,
      nameEn: `Income ${String(index + 1).padStart(2, '0')}`,
      nameAr: null,
      createdAt: `2026-09-08T10:${String(index).padStart(2, '0')}:00Z`,
      archivedAt: null,
    }));
    const reads: Array<{ kind: string; cursor?: string }> = [];
    categoriesGateway.listCategories = vi.fn(async (_spaceId, kind, cursor) => {
      reads.push({ kind, ...(cursor ? { cursor } : {}) });
      if (kind === 'expense') return { categories: [], nextCursor: null };
      return cursor
        ? { categories: incomeCategories.slice(50), nextCursor: null }
        : { categories: incomeCategories.slice(0, 50), nextCursor: 'income-page-2' };
    });
    const { user } = await renderPage(new InMemoryWalletsGateway(), 'en', categoriesGateway);

    await user.click(screen.getByRole('button', { name: 'Add transaction' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a transaction' });
    expect(within(dialog).queryByRole('radio', { name: 'Income 51' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Load more income categories' }));

    expect(await within(dialog).findByRole('radio', { name: 'Income 51' })).toBeInTheDocument();
    expect(reads).toContainEqual({ kind: 'income', cursor: 'income-page-2' });
  });

  it('keeps picker rows and retries a failed later category page without closing the transaction', async () => {
    const categoriesGateway: CategoriesGateway = new InMemoryCategoriesGateway();
    let pageFails = true;
    categoriesGateway.listCategories = vi.fn(async (_spaceId, kind, cursor) => {
      if (kind === 'expense') return { categories: [], nextCursor: null };
      if (!cursor) return {
        categories: [{
          id: 'category-income', spaceId: 'personal-space', kind: 'income' as const, nameEn: 'Salary', nameAr: 'راتب',
          createdAt: '2026-09-08T10:00:00Z', archivedAt: null,
        }],
        nextCursor: 'income-page-2',
      };
      if (pageFails) throw new Error('Network unavailable');
      return {
        categories: [{
          id: 'category-bonus', spaceId: 'personal-space', kind: 'income' as const, nameEn: 'Bonus', nameAr: 'مكافأة',
          createdAt: '2026-09-08T11:00:00Z', archivedAt: null,
        }],
        nextCursor: null,
      };
    });
    const { user } = await renderPage(new InMemoryWalletsGateway(), 'en', categoriesGateway);
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a transaction' });

    await user.click(within(dialog).getByRole('button', { name: 'Load more income categories' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('category request was not accepted');
    expect(within(dialog).getByRole('radio', { name: 'Salary' })).toBeInTheDocument();

    pageFails = false;
    await user.click(within(dialog).getByRole('button', { name: 'Retry loading income categories' }));
    expect(await within(dialog).findByRole('radio', { name: 'Bonus' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('removes category controls and stale selection when the event kind becomes ineligible', async () => {
    const categoriesGateway = new InMemoryCategoriesGateway();
    categoriesGateway.categories = categoriesGateway.categories.map((category) => ({ ...category, spaceId: 'personal-space' }));
    const { user } = await renderPage(new InMemoryWalletsGateway(), 'en', categoriesGateway);

    await user.click(screen.getByRole('button', { name: 'Add transaction' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a transaction' });
    await user.click(within(dialog).getByRole('radio', { name: 'Salary' }));
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'opening_balance');
    expect(within(dialog).queryByRole('group', { name: 'Category' })).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'income');
    expect(within(dialog).getByRole('radio', { name: 'Uncategorized' })).toBeChecked();
  });

  it('preserves the category choice after a categorized database rejection', async () => {
    const categoriesGateway = new InMemoryCategoriesGateway();
    categoriesGateway.categories = categoriesGateway.categories.map((category) => ({ ...category, spaceId: 'personal-space' }));
    const { user } = await renderPage(new InMemoryWalletsGateway(), 'en', categoriesGateway);

    await user.click(screen.getByRole('button', { name: 'Add transaction' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a transaction' });
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'expense');
    await user.click(within(dialog).getByRole('radio', { name: 'Groceries' }));
    await user.type(within(dialog).getByLabelText('Amount'), '18.75');
    await user.click(within(dialog).getByRole('button', { name: 'Review transaction' }));
    categoriesGateway.error = new Error('categorized transaction rejected');
    await user.click(within(dialog).getByRole('button', { name: 'Record expense' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('The category request was not accepted');
    expect(alert).not.toHaveTextContent('categorized transaction rejected');
    expect(within(dialog).getByDisplayValue('18.75')).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'Groceries' })).toBeChecked();
  });

  it('does not claim categorized success until a failed wallet refresh recovers', async () => {
    const walletGateway = new InMemoryWalletsGateway();
    const loadSnapshot = walletGateway.loadSnapshot.bind(walletGateway);
    let failRefresh = false;
    walletGateway.loadSnapshot = vi.fn(async (spaceId) => {
      if (failRefresh) throw new Error('Refresh failed');
      return loadSnapshot(spaceId);
    });
    const categoriesGateway = new InMemoryCategoriesGateway();
    categoriesGateway.categories = categoriesGateway.categories.map((category) => ({ ...category, spaceId: 'personal-space' }));
    categoriesGateway.recordCategorizedEvent = vi.fn(async () => {
      failRefresh = true;
      return { eventId: 'event-new' };
    });
    const { user } = await renderPage(walletGateway, 'en', categoriesGateway);
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a transaction' });
    await user.click(within(dialog).getByRole('radio', { name: 'Salary' }));
    await user.type(within(dialog).getByLabelText('Amount'), '12.50');
    await user.click(within(dialog).getByRole('button', { name: 'Review transaction' }));
    await user.click(within(dialog).getByRole('button', { name: 'Record income' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('recorded, but balances and history could not be refreshed');
    expect(within(dialog).queryByText('Transaction recorded')).not.toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('12.50')).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'Salary' })).toBeChecked();

    failRefresh = false;
    await user.click(within(dialog).getByRole('button', { name: 'Refresh wallets' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Transaction recorded');
    expect(categoriesGateway.recordCategorizedEvent).toHaveBeenCalledOnce();
  });

  it('localizes category load failures in the Arabic wallet workspace', async () => {
    const categoriesGateway = new InMemoryCategoriesGateway();
    categoriesGateway.error = new Error('an active space membership is required');
    await renderPage(new InMemoryWalletsGateway(), 'ar', categoriesGateway);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('لم يعد لديك وصول إلى هذه المساحة');
    expect(alert).not.toHaveTextContent('You no longer have access');
  });

  it('localizes category history membership failures in the Arabic wallet workspace', async () => {
    const categoriesGateway = new InMemoryCategoriesGateway();
    categoriesGateway.categories = categoriesGateway.categories.map((category) => ({ ...category, spaceId: 'personal-space' }));
    categoriesGateway.resolveEventCategories = vi.fn(async () => {
      throw new Error('an active space membership is required for category history');
    });
    await renderPage(new InMemoryWalletsGateway(), 'ar', categoriesGateway);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('لم يعد لديك وصول إلى هذه المساحة');
    expect(alert).not.toHaveTextContent('active space membership');
  });

  it('preserves loaded rows and offers localized retry when older category history fails', async () => {
    const walletGateway = new InMemoryWalletsGateway();
    const currentEvent = walletGateway.events[0]!;
    const olderEvent = {
      ...currentEvent,
      id: 'event-older',
      requestId: 'request-older',
      effectiveDate: '2026-08-31',
      createdAt: '2026-08-31T10:00:00Z',
    };
    walletGateway.loadSnapshot = vi.fn(async () => ({
      wallets: walletGateway.wallets,
      history: { events: [currentEvent], nextCursor: 'older-page' },
    }));
    walletGateway.loadHistoryPage = vi.fn(async () => ({ events: [olderEvent], nextCursor: null }));
    const categoriesGateway = new InMemoryCategoriesGateway();
    categoriesGateway.categories = categoriesGateway.categories.map((category) => ({ ...category, spaceId: 'personal-space' }));
    categoriesGateway.resolveEventCategories = vi.fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('raw category history failure'))
      .mockResolvedValueOnce([{
        eventId: olderEvent.id,
        categoryId: 'category-salary',
        categoryKind: 'income' as const,
        nameEn: 'Salary',
        nameAr: 'راتب',
        archivedAt: null,
      }]);
    const { user } = await renderPage(walletGateway, 'ar', categoriesGateway);

    expect(screen.getByText(currentEvent.effectiveDate)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'تحميل قيود أقدم' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('تعذّر تحميل القيود الأقدم');
    expect(alert).toHaveTextContent('لم يتم قبول طلب الفئة');
    expect(alert).not.toHaveTextContent('raw category history failure');
    expect(screen.getByText(currentEvent.effectiveDate)).toBeInTheDocument();

    await user.click(within(alert).getByRole('button', { name: 'إعادة تحميل القيود الأقدم' }));

    expect(await screen.findByText(olderEvent.effectiveDate)).toBeInTheDocument();
    expect(screen.getByText('راتب').closest('bdi')).not.toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(walletGateway.calls.some((call) => call.name === 'recordEvent')).toBe(false);
    expect(categoriesGateway.calls.some((call) => call.name === 'recordCategorizedEvent')).toBe(false);
  });

  it('localizes a categorized submit rejection without exposing its cause in Arabic', async () => {
    const categoriesGateway = new InMemoryCategoriesGateway();
    categoriesGateway.categories = categoriesGateway.categories.map((category) => ({ ...category, spaceId: 'personal-space' }));
    categoriesGateway.recordCategorizedEvent = vi.fn(async () => {
      throw new Error('the category must be active, in the requested space, and match the event kind');
    });
    const { user } = await renderPage(new InMemoryWalletsGateway(), 'ar', categoriesGateway);
    const dialog = await openArabicCategorizedIncome(user);
    await user.click(within(dialog).getByRole('button', { name: 'تسجيل دخل' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('لم تعد هذه الفئة متاحة لهذا القيد');
    expect(alert).not.toHaveTextContent('must be active');
  });

  it('localizes a categorized explicit retry rejection without exposing its cause in Arabic', async () => {
    const categoriesGateway = new InMemoryCategoriesGateway();
    categoriesGateway.categories = categoriesGateway.categories.map((category) => ({ ...category, spaceId: 'personal-space' }));
    categoriesGateway.recordCategorizedEvent = vi.fn()
      .mockRejectedValueOnce(new Error('Connection timeout'))
      .mockRejectedValueOnce(new Error('the category must be active, in the requested space, and match the event kind'));
    categoriesGateway.findCategorizedEventByRequestId = vi.fn(async () => null);
    const { user } = await renderPage(new InMemoryWalletsGateway(), 'ar', categoriesGateway);
    const dialog = await openArabicCategorizedIncome(user);
    await user.click(within(dialog).getByRole('button', { name: 'تسجيل دخل' }));
    await user.click(await within(dialog).findByRole('button', { name: 'إعادة المعاملة دون تغيير' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('لم تعد هذه الفئة متاحة لهذا القيد');
    expect(alert).not.toHaveTextContent('must be active');
  });

  it('localizes a categorized reconciliation failure without exposing its cause in Arabic', async () => {
    const categoriesGateway = new InMemoryCategoriesGateway();
    categoriesGateway.categories = categoriesGateway.categories.map((category) => ({ ...category, spaceId: 'personal-space' }));
    categoriesGateway.recordCategorizedEvent = vi.fn(async () => { throw new Error('Connection timeout'); });
    categoriesGateway.findCategorizedEventByRequestId = vi.fn(async () => {
      throw new Error('English reconciliation read exploded');
    });
    const { user } = await renderPage(new InMemoryWalletsGateway(), 'ar', categoriesGateway);
    const dialog = await openArabicCategorizedIncome(user);
    await user.click(within(dialog).getByRole('button', { name: 'تسجيل دخل' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('لم يتم قبول طلب الفئة');
    expect(alert).not.toHaveTextContent('English reconciliation');
  });

  it('renders an archived historical category label without exposing it in the active picker', async () => {
    const categoriesGateway = new InMemoryCategoriesGateway();
    categoriesGateway.categories = categoriesGateway.categories.map((category) => ({ ...category, spaceId: 'personal-space' }));
    categoriesGateway.associations = [{
      eventId: 'event-income', categoryId: 'category-archived', categoryKind: 'income',
      nameEn: 'Former salary', nameAr: 'راتب سابق', archivedAt: '2026-09-08T10:00:00Z',
    }];
    const { user } = await renderPage(new InMemoryWalletsGateway(), 'en', categoriesGateway);

    const label = screen.getByText('Former salary');
    expect(label.closest('bdi')).not.toBeNull();
    expect(label.closest('.journal-category')).toHaveTextContent('Archived');
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));
    expect(within(screen.getByRole('dialog')).queryByRole('radio', { name: 'Former salary' })).not.toBeInTheDocument();
  });

  it('renders a category association inherited by a reversal as read-only history', async () => {
    const walletGateway = new InMemoryWalletsGateway();
    walletGateway.events = [{
      id: 'event-reversal', spaceId: 'personal-space', requestId: 'request-reversal', kind: 'reversal',
      effectiveDate: '2026-09-08', createdAt: '2026-09-08T12:00:00Z', reversalOf: 'event-income',
      reversedBy: null, loanLinked: false, movements: [],
    }, ...walletGateway.events];
    const categoriesGateway = new InMemoryCategoriesGateway();
    categoriesGateway.categories = categoriesGateway.categories.map((category) => ({ ...category, spaceId: 'personal-space' }));
    categoriesGateway.associations = [{
      eventId: 'event-reversal', categoryId: 'category-salary', categoryKind: 'income',
      nameEn: 'Salary', nameAr: 'راتب', archivedAt: null,
    }];

    await renderPage(walletGateway, 'en', categoriesGateway);

    const reversal = screen.getByText('Linked reversal').closest('li');
    expect(reversal).not.toBeNull();
    expect(within(reversal!).getByText('Salary').closest('bdi')).not.toBeNull();
    expect(within(reversal!).queryByRole('button', { name: /category/i })).not.toBeInTheDocument();
  });

  it('refuses same-wallet and cross-currency transfers before submission', async () => {
    const { gateway, user } = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a transaction' });
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'transfer');
    await user.type(within(dialog).getByLabelText('Amount'), '10');
    await user.selectOptions(within(dialog).getByLabelText('To wallet'), 'wallet-usd-1');
    await user.click(within(dialog).getByRole('button', { name: 'Review transaction' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Choose two different wallets');
    await user.selectOptions(within(dialog).getByLabelText('To wallet'), 'wallet-lbp-1');
    await user.click(within(dialog).getByRole('button', { name: 'Review transaction' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('same currency');
    expect(gateway.calls.some((call) => call.name === 'recordEvent')).toBe(false);
  });

  it('requires a valid correction date and deliberate linked-reversal confirmation', async () => {
    const { gateway, user } = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Correct income' }));
    const dialog = screen.getByRole('dialog', { name: 'Correct this transaction' });
    await user.clear(within(dialog).getByLabelText('Correction date'));
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Add linked reversal' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Enter a valid correction date');
    expect(gateway.calls.some((call) => call.name === 'reverseEvent')).toBe(false);
  });

  it('renders an already-reversed event without another correction action', async () => {
    const gateway = new InMemoryWalletsGateway();
    gateway.events = gateway.events.map((event) => event.id === 'event-income'
      ? { ...event, reversedBy: 'reversal-income' }
      : event);
    await renderPage(gateway);
    expect(screen.getByText('Reversed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Correct income' })).not.toBeInTheDocument();
  });

  it('offers a manager-friendly load retry and recovers from a network error', async () => {
    const gateway = new InMemoryWalletsGateway();
    gateway.error = new Error('Network unavailable');
    const user = userEvent.setup();
    render(<WalletsPage gateway={gateway} spaceId="personal-space" locale="en" onSpaceUnavailable={vi.fn()} onOpenLoans={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
    gateway.error = null;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('$1,250.50')).toBeInTheDocument();
  });

  it('supports Arabic labels, RTL-safe history, focus trapping, Escape, and restoration', async () => {
    const { user } = await renderPage(new InMemoryWalletsGateway(), 'ar');
    const opener = screen.getByRole('button', { name: 'محفظة جديدة' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'إنشاء محفظة' });
    expect(within(dialog).getByLabelText('اسم المحفظة')).toHaveFocus();
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(dialog).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
