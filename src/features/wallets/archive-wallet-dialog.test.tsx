import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { WalletProjection } from './types.js';
import { ArchiveWalletDialog } from './archive-wallet-dialog.js';

const zeroWallet: WalletProjection = { id: 'wallet-1', spaceId: 'space-1', name: 'Travel fund', currency: 'USD', archivedAt: null, balanceMinor: '0' };
const fundedWallet: WalletProjection = { id: 'wallet-2', spaceId: 'space-1', name: 'Daily USD', currency: 'USD', archivedAt: null, balanceMinor: '125050' };

describe('ArchiveWalletDialog', () => {
  it('requires deliberate confirmation at a zero balance and never offers deletion', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => ({ status: 'success' as const, reconciled: false }));
    render(<ArchiveWalletDialog locale="en" wallet={zeroWallet} pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onSubmit={onSubmit} />);
    const dialog = screen.getByRole('dialog', { name: 'Archive wallet' });
    expect(within(dialog).getByText('Travel fund').closest('bdi')).not.toBeNull();
    expect(within(dialog).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Archive wallet' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Confirm that you understand');
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Archive wallet' }));
    expect(onSubmit).toHaveBeenCalledWith({ walletId: 'wallet-1' });
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Wallet archived');
  });

  it('offers no archive action at all for a non-zero balance', () => {
    render(<ArchiveWalletDialog locale="en" wallet={fundedWallet} pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onSubmit={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Archive wallet' });
    expect(within(dialog).getByText('$1,250.50')).toBeInTheDocument();
    expect(within(dialog).getByText(/Undo or move its transactions/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Archive wallet' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('surfaces a database-confirmed non-zero-balance rejection', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => { throw { code: 'P0001', message: 'the wallet balance must be zero to archive' }; });
    render(<ArchiveWalletDialog locale="en" wallet={zeroWallet} pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onSubmit={onSubmit} />);
    const dialog = screen.getByRole('dialog', { name: 'Archive wallet' });
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Archive wallet' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This wallet still has money in it.');
  });

  it('renders the non-zero-balance explanation in Arabic', () => {
    render(<ArchiveWalletDialog locale="ar" wallet={fundedWallet} pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onSubmit={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'أرشفة المحفظة' });
    expect(within(dialog).queryByRole('button', { name: 'أرشفة المحفظة' })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/تراجع عن معاملاتها/)).toBeInTheDocument();
  });
});
