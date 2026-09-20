import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { formatMinorAmount } from '../wallets/money.js';
import type { JournalEvent } from '../wallets/types.js';
import { JournalScreen } from './journal-screen.js';
import type { JournalSearchView } from './journal-screen.js';

function byExactText(expected: string) {
  return (_content: string, element: Element | null) =>
    element?.textContent === expected && element.children.length === 0;
}

function event(overrides: Partial<JournalEvent> = {}): JournalEvent {
  return {
    id: 'event-1', spaceId: 'space-1', requestId: 'request-1', kind: 'income',
    effectiveDate: '2026-09-07', createdAt: '2026-09-07T10:00:00Z', reversalOf: null, reversedBy: null,
    loanLinked: false,
    movements: [{ walletId: 'wallet-1', walletName: 'Cash', currency: 'USD', amountMinor: '25000', walletArchived: false }],
    ...overrides,
  };
}

const baseProps = {
  locale: 'en' as const,
  events: [] as readonly JournalEvent[],
  nextCursor: null,
  loadingMore: false,
  onLoadMore: vi.fn(),
  onReverse: vi.fn(),
  reversePending: false,
  search: null,
  onSearchQueryChange: vi.fn(),
  onLoadMoreSearch: vi.fn(),
  onExportCsv: vi.fn(async () => ({ csv: '', rowCount: 0, totals: [], truncated: false, highWaterMark: null })),
};

function searchView(overrides: Partial<JournalSearchView> = {}): JournalSearchView {
  return { query: 'market', events: [], nextCursor: null, pending: false, loadingMore: false, error: null, ...overrides };
}

describe('JournalScreen', () => {
  it('renders events with payee labels and signed formatted amounts', () => {
    render(<JournalScreen {...baseProps} events={[
      event({ id: 'income-1', kind: 'income', payeeName: 'Employer' }),
      event({
        id: 'expense-1', kind: 'expense', payeeName: 'Groceries store',
        category: { id: 'cat-1', kind: 'expense', nameEn: 'Groceries', nameAr: 'بقالة', archivedAt: null },
        movements: [{ walletId: 'wallet-1', walletName: 'Cash', currency: 'USD', amountMinor: '-12500', walletArchived: false }],
      }),
    ]} />);
    expect(screen.getByText('Employer')).toBeInTheDocument();
    expect(screen.getByText('$250.00')).toHaveClass('cr-positive');
    expect(screen.getByText(formatMinorAmount('-12500', 'USD', 'en'))).toBeInTheDocument();
    expect(screen.getByText('Groceries store')).toBeInTheDocument();
  });

  it('prefers the category name when no payee exists', () => {
    render(<JournalScreen {...baseProps} events={[
      event({
        id: 'cat-1', kind: 'expense',
        category: { id: 'cat-1', kind: 'expense', nameEn: 'Groceries', nameAr: 'بقالة', archivedAt: null },
        movements: [{ walletId: 'wallet-1', walletName: 'Cash', currency: 'USD', amountMinor: '-12500', walletArchived: false }],
      }),
    ]} />);
    expect(screen.getByText('Groceries')).toBeInTheDocument();
  });

  it('falls back to the category name then the kind label when no payee exists', () => {
    render(<JournalScreen {...baseProps} locale="ar" events={[
      event({
        id: 'cat-1', kind: 'expense',
        category: { id: 'cat-1', kind: 'expense', nameEn: 'Groceries', nameAr: 'بقالة', archivedAt: null },
        movements: [{ walletId: 'wallet-1', walletName: 'Cash', currency: 'LBP', amountMinor: '-150000', walletArchived: false }],
      }),
      event({
        id: 'transfer-1', kind: 'transfer',
        movements: [
          { walletId: 'wallet-1', walletName: 'Cash', currency: 'USD', amountMinor: '-30000', walletArchived: false },
          { walletId: 'wallet-2', walletName: 'Bank', currency: 'USD', amountMinor: '30000', walletArchived: false },
        ],
      }),
    ]} />);
    expect(screen.getByText('بقالة')).toBeInTheDocument();
    const entries = within(screen.getByRole('region', { name: 'قيود اليومية' }));
    expect(entries.getByText('بقالة')).toBeInTheDocument();
    expect(entries.getByText('تحويل')).toBeInTheDocument();
  });

  it('filters the list client-side with the kind chips', async () => {
    const user = userEvent.setup();
    render(<JournalScreen {...baseProps} events={[
      event({ id: 'income-1', kind: 'income', payeeName: 'Employer' }),
      event({
        id: 'expense-1', kind: 'expense', payeeName: 'Shop',
        movements: [{ walletId: 'wallet-1', walletName: 'Cash', currency: 'USD', amountMinor: '-5000', walletArchived: false }],
      }),
      event({
        id: 'transfer-1', kind: 'transfer', payeeName: 'Move to bank',
        movements: [
          { walletId: 'wallet-1', walletName: 'Cash', currency: 'USD', amountMinor: '-10000', walletArchived: false },
          { walletId: 'wallet-2', walletName: 'Bank', currency: 'USD', amountMinor: '10000', walletArchived: false },
        ],
      }),
      event({
        id: 'exchange-1', kind: 'transfer', payeeName: 'USD to LBP',
        movements: [
          { walletId: 'wallet-1', walletName: 'Cash', currency: 'USD', amountMinor: '-10000', walletArchived: false },
          { walletId: 'wallet-3', walletName: 'LBP cash', currency: 'LBP', amountMinor: '890000', walletArchived: false },
        ],
      }),
      event({
        id: 'loan-1', kind: 'loan_lend', payeeName: 'Maya',
        movements: [{ walletId: 'wallet-1', walletName: 'Cash', currency: 'USD', amountMinor: '-50000', walletArchived: false }],
        loanLinked: true,
      }),
    ]} />);

    await user.click(screen.getByRole('button', { name: 'Expense' }));
    expect(screen.getByText('Shop')).toBeInTheDocument();
    expect(screen.queryByText('Employer')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Transfer' }));
    expect(screen.getByText('Move to bank')).toBeInTheDocument();
    expect(screen.queryByText('Shop')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Exchange' }));
    expect(screen.getByText('USD to LBP')).toBeInTheDocument();
    expect(screen.queryByText('Move to bank')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Loans' }));
    expect(screen.getByText('Maya')).toBeInTheDocument();
    expect(screen.queryByText('USD to LBP')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Employer')).toBeInTheDocument();
    expect(screen.getByText('Maya')).toBeInTheDocument();
  });

  it('opens the detail sheet with note and linked movements, and returns focus to the row on Escape', async () => {
    const user = userEvent.setup();
    render(<JournalScreen {...baseProps} events={[
      event({
        id: 'income-1', kind: 'income', payeeName: 'Employer', note: 'September salary',
        movements: [{ walletId: 'wallet-1', walletName: 'Cash', currency: 'USD', amountMinor: '25000', walletArchived: false }],
      }),
    ]} />);

    const row = screen.getByRole('button', { name: /Employer/ });
    await user.click(row);
    const dialog = screen.getByRole('dialog', { name: 'Employer' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent('September salary');
    expect(dialog).toHaveTextContent('Cash');
    expect(dialog).toHaveTextContent(formatMinorAmount('25000', 'USD', 'en'));

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(row).toHaveFocus();
  });

  it('closes the detail sheet on backdrop click', async () => {
    const user = userEvent.setup();
    render(<JournalScreen {...baseProps} events={[event({ payeeName: 'Employer' })]} />);
    await user.click(screen.getByRole('button', { name: /Employer/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(document.querySelector('.cr-sheet-backdrop') as Element);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onReverse for an eligible event', async () => {
    const user = userEvent.setup();
    const onReverse = vi.fn().mockResolvedValue(undefined);
    render(<JournalScreen {...baseProps} onReverse={onReverse} events={[event({ id: 'evt-1', payeeName: 'Employer' })]} />);
    await user.click(screen.getByRole('button', { name: /Employer/ }));
    await user.click(screen.getByRole('button', { name: 'Reverse' }));
    expect(onReverse).toHaveBeenCalledWith('evt-1');
  });

  it('shows an inline alert when reversing fails and clears it on retry', async () => {
    const user = userEvent.setup();
    const onReverse = vi.fn()
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValueOnce(undefined);
    render(<JournalScreen {...baseProps} onReverse={onReverse} events={[event({ id: 'evt-1', payeeName: 'Employer' })]} />);
    await user.click(screen.getByRole('button', { name: /Employer/ }));
    await user.click(screen.getByRole('button', { name: 'Reverse' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not reverse this entry.');
    expect(alert).toHaveTextContent('permission denied');

    await user.click(screen.getByRole('button', { name: 'Reverse' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('marks the sheet as modal and moves focus into it on open', async () => {
    const user = userEvent.setup();
    render(<JournalScreen {...baseProps} events={[event({ payeeName: 'Employer' })]} />);
    await user.click(screen.getByRole('button', { name: /Employer/ }));
    const dialog = screen.getByRole('dialog', { name: 'Employer' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Employer/ })).toHaveFocus();
  });

  it('shows the reversal link and disables Reverse for reversed events', async () => {
    const user = userEvent.setup();
    const onReverse = vi.fn().mockResolvedValue(undefined);
    render(<JournalScreen {...baseProps} onReverse={onReverse} events={[
      event({ id: 'orig-1', payeeName: 'Employer', reversedBy: 'rev-1' }),
      event({
        id: 'rev-1', kind: 'reversal', reversalOf: 'orig-1',
        movements: [{ walletId: 'wallet-1', walletName: 'Cash', currency: 'USD', amountMinor: '-25000', walletArchived: false }],
      }),
    ]} />);

    await user.click(screen.getByRole('button', { name: /Employer/ }));
    expect(screen.getByRole('button', { name: 'Reverse' })).toBeDisabled();
    expect(screen.getByRole('dialog')).toHaveTextContent('Reversed by reversal rev-1');

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: /Reversal of/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Reversal of orig-1');
    expect(screen.getByRole('button', { name: 'Reverse' })).toBeDisabled();
    expect(onReverse).not.toHaveBeenCalled();
  });

  it('labels reversal rows with muted danger styling and renders an Arabic reversal label', () => {
    render(<JournalScreen {...baseProps} locale="ar" events={[
      event({
        id: 'rev-1', kind: 'reversal', reversalOf: 'orig-1',
        movements: [{ walletId: 'wallet-1', walletName: 'Cash', currency: 'USD', amountMinor: '-25000', walletArchived: false }],
      }),
    ]} />);
    expect(screen.getByText(/عكس قيد/)).toBeInTheDocument();
    expect(document.querySelector('.cr-reversal-text')).not.toBeNull();
  });

  it('requests server search as the query changes and renders its results', async () => {
    const user = userEvent.setup();
    const onSearchQueryChange = vi.fn();
    const searched = [
      event({ id: 'found-1', kind: 'expense', payeeName: 'Farmer market', note: 'weekly vegetables' }),
    ];
    render(<JournalScreen {...baseProps} onSearchQueryChange={onSearchQueryChange} search={searchView({ query: 'market', events: searched })} events={[
      event({ id: 'other-1', kind: 'expense', payeeName: 'Pharmacy' }),
    ]} />);

    expect(screen.getByText('Pharmacy')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Search'), 'market');
    expect(onSearchQueryChange).toHaveBeenCalled();
    expect(screen.getByText('Farmer market')).toBeInTheDocument();
    expect(screen.queryByText('Pharmacy')).not.toBeInTheDocument();
  });

  it('combines the active server search with the kind chips', async () => {
    const user = userEvent.setup();
    const searched = [
      event({ id: 'income-1', kind: 'income', payeeName: 'Shop rent' }),
      event({
        id: 'expense-1', kind: 'expense', payeeName: 'Shop',
        movements: [{ walletId: 'wallet-1', walletName: 'Cash', currency: 'USD', amountMinor: '-5000', walletArchived: false }],
      }),
    ];
    render(<JournalScreen {...baseProps} search={searchView({ query: 'shop', events: searched })} />);
    await user.type(screen.getByLabelText('Search'), 'shop');

    expect(screen.getByText('Shop rent')).toBeInTheDocument();
    expect(screen.getByText('Shop')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expense' }));
    expect(screen.getByText('Shop')).toBeInTheDocument();
    expect(screen.queryByText('Shop rent')).not.toBeInTheDocument();
  });

  it('shows searching status, an explicit empty state, and the search error', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<JournalScreen {...baseProps} search={searchView({ query: 'shop', pending: true })} />);
    await user.type(screen.getByLabelText('Search'), 'shop');
    expect(screen.getByText('Searching…')).toBeInTheDocument();

    rerender(<JournalScreen {...baseProps} search={searchView({ query: 'shop', events: [] })} />);
    expect(screen.getByText('No journal entries match.')).toBeInTheDocument();

    rerender(<JournalScreen {...baseProps} search={searchView({ query: 'shop', events: [], error: 'broken' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The journal search was not accepted.');
  });

  it('pages the active server search through its own cursor', async () => {
    const user = userEvent.setup();
    const onLoadMoreSearch = vi.fn();
    const { rerender } = render(<JournalScreen {...baseProps} onLoadMoreSearch={onLoadMoreSearch} search={searchView({ query: 'market', nextCursor: '2026-09-08|2026-09-08T10:00:00Z|event-1' })} />);
    await user.type(screen.getByLabelText('Search'), 'market');

    const loadMore = screen.getByRole('button', { name: 'Load more' });
    await user.click(loadMore);
    expect(onLoadMoreSearch).toHaveBeenCalledOnce();

    rerender(<JournalScreen {...baseProps} search={searchView({ query: 'market', nextCursor: null })} />);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('localizes the search field, searching status, and empty state in Arabic', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<JournalScreen {...baseProps} locale="ar" search={searchView({ query: 'متجر', pending: true })} />);
    await user.type(screen.getByLabelText('بحث'), 'متجر');
    expect(screen.getByText('جارٍ البحث…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search')).not.toBeInTheDocument();

    rerender(<JournalScreen {...baseProps} locale="ar" search={searchView({ query: 'متجر', events: [] })} />);
    expect(screen.getByText('لا توجد قيود مطابقة.')).toBeInTheDocument();
  });

  it('downloads the CSV only from the explicit export action', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => 'blob:budget');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const onExportCsv = vi.fn(async () => ({
      csv: 'csv-body',
      rowCount: 1,
      totals: [{ currency: 'USD', netMinor: '100' }],
      truncated: false,
      highWaterMark: { createdAt: '2026-09-08T10:00:00Z', eventId: 'event-1' },
    }));
    render(<JournalScreen {...baseProps} onExportCsv={onExportCsv} />);

    expect(onExportCsv).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(onExportCsv).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('journal-2026-09-08-en.csv');
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it('shows export failure and truncated notes, and disables the button while pending', async () => {
    const user = userEvent.setup();
    const onExportCsv = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        csv: 'csv', rowCount: 100000, totals: [], truncated: true, highWaterMark: null,
      });
    render(<JournalScreen {...baseProps} onExportCsv={onExportCsv} />);
    const button = screen.getByRole('button', { name: 'Export CSV' });

    await user.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('The export was not created.');
    expect(button).not.toBeDisabled();

    await user.click(button);
    expect(await screen.findByText(/reached the row limit/i)).toBeInTheDocument();
  });

  it('shows a Load more button only when a cursor exists', async () => {    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    const { rerender } = render(<JournalScreen {...baseProps} onLoadMore={onLoadMore} />);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();

    rerender(<JournalScreen {...baseProps} onLoadMore={onLoadMore} nextCursor="20" />);
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalledOnce();

    rerender(<JournalScreen {...baseProps} onLoadMore={onLoadMore} nextCursor="20" loadingMore />);
    expect(screen.getByRole('button', { name: 'Load more' })).toBeDisabled();
  });

  it('renders the empty state when there are no events', () => {
    render(<JournalScreen {...baseProps} />);
    expect(screen.getByText('No journal entries yet.')).toBeInTheDocument();
  });

  it('disables Reverse while a reversal is pending', async () => {
    const user = userEvent.setup();
    render(<JournalScreen {...baseProps} reversePending events={[event({ payeeName: 'Employer' })]} />);
    await user.click(screen.getByRole('button', { name: /Employer/ }));
    expect(screen.getByRole('button', { name: 'Reverse' })).toBeDisabled();
  });

  it('localizes amounts and labels for Arabic', () => {
    render(<JournalScreen {...baseProps} locale="ar" events={[event({ payeeName: 'Employer' })]} />);
    expect(screen.getByText(byExactText(formatMinorAmount('25000', 'USD', 'ar')))).toBeInTheDocument();
  });

  it('renders Arabic chrome without leaking English labels', () => {
    render(<JournalScreen {...baseProps} locale="ar" nextCursor="20" events={[event({ payeeName: 'Employer' })]} />);
    expect(screen.getByRole('heading', { name: 'القيود' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تحميل المزيد' })).toBeInTheDocument();
    for (const chip of ['الكل', 'دخل', 'مصروف', 'تحويل', 'صرف', 'الديون']) {
      expect(screen.getByRole('button', { name: chip })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Journal' })).not.toBeInTheDocument();
  });
});
