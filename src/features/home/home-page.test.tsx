import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { JournalEvent, WalletProjection } from '../wallets/types.js';
import { HomePage } from './home-page.js';

const wallets: readonly WalletProjection[] = [
  { id: 'wallet-usd', spaceId: 'space-1', name: 'Daily USD', currency: 'USD', archivedAt: null, balanceMinor: '125050' },
  { id: 'wallet-lbp', spaceId: 'space-1', name: 'Daily LBP', currency: 'LBP', archivedAt: null, balanceMinor: '2500000' },
];

const recentEvents: readonly JournalEvent[] = [
  { id: 'event-income', spaceId: 'space-1', requestId: 'income', kind: 'income', effectiveDate: '2026-09-10', createdAt: '2026-09-10T10:00:00Z', reversalOf: null, reversedBy: null, loanLinked: false, movements: [{ walletId: 'wallet-usd', walletName: 'Daily USD', currency: 'USD', amountMinor: '25050', walletArchived: false }] },
  { id: 'event-expense', spaceId: 'space-1', requestId: 'expense', kind: 'expense', effectiveDate: '2026-09-09', createdAt: '2026-09-09T10:00:00Z', reversalOf: null, reversedBy: null, loanLinked: false, movements: [{ walletId: 'wallet-lbp', walletName: 'Daily LBP', currency: 'LBP', amountMinor: '-50000', walletArchived: false }] },
];

describe('HomePage', () => {
  it('renders a localized financial overview and opens Wallets from its link', async () => {
    const user = userEvent.setup();
    const onOpenWallets = vi.fn();
    render(<HomePage locale="en" wallets={wallets} recentEvents={recentEvents} onOpenWallets={onOpenWallets} onRecordTransaction={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getAllByText('Daily USD')).toHaveLength(2);
    expect(screen.getByText('$1,250.50')).toBeInTheDocument();
    expect(screen.getAllByText('Daily LBP')).toHaveLength(2);
    expect(screen.getByText(/LBP\s+2,500,000/)).toBeInTheDocument();
    expect(screen.getAllByText('Income')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Expense')[0]).toBeInTheDocument();
    expect(screen.getByText('Income').compareDocumentPosition(screen.getByText('Expense')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'View wallets' }));
    expect(onOpenWallets).toHaveBeenCalledOnce();
  });

  it('localizes the Wallets link in Arabic', async () => {
    const user = userEvent.setup();
    const onOpenWallets = vi.fn();
    render(<HomePage locale="ar" wallets={wallets} recentEvents={recentEvents} onOpenWallets={onOpenWallets} onRecordTransaction={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'عرض المحافظ' }));
    expect(onOpenWallets).toHaveBeenCalledOnce();
  });

  it('shows one next step instead of empty metrics when there are no active wallets or events', () => {
    render(<HomePage locale="en" wallets={[]} recentEvents={[]} onOpenWallets={vi.fn()} onRecordTransaction={vi.fn()} />);

    expect(screen.getByText('Create your first wallet to start tracking this space.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a wallet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record transaction' })).toBeDisabled();
    expect(screen.getByText('Create an active wallet before recording a transaction.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Active balances' })).not.toBeInTheDocument();
  });
});
