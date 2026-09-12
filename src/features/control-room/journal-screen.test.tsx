import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { formatMinorAmount } from '../wallets/money.js';
import type { JournalEvent } from '../wallets/types.js';
import { JournalScreen } from './journal-screen.js';

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
};

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

  it('shows a Load more button only when a cursor exists', async () => {
    const user = userEvent.setup();
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
});
