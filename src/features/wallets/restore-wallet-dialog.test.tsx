import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { WalletProjection } from './types.js';
import { RestoreWalletDialog } from './restore-wallet-dialog.js';

const wallet: WalletProjection = { id: 'wallet-1', spaceId: 'space-1', name: 'Travel fund', currency: 'USD', archivedAt: '2026-09-10T00:00:00Z', balanceMinor: '0' };

describe('RestoreWalletDialog', () => {
  it('offers a single Restore action with no checkbox', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => ({ status: 'success' as const, reconciled: false }));
    render(<RestoreWalletDialog locale="en" wallet={wallet} pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onSubmit={onSubmit} />);
    const dialog = screen.getByRole('dialog', { name: 'Restore wallet' });
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Travel fund').closest('bdi')).not.toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect(onSubmit).toHaveBeenCalledWith({ walletId: 'wallet-1' });
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Wallet restored');
  });

  it('surfaces a not-archived rejection', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => { throw { code: 'P0001', message: 'the wallet is not archived' }; });
    render(<RestoreWalletDialog locale="en" wallet={wallet} pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onSubmit={onSubmit} />);
    const dialog = screen.getByRole('dialog', { name: 'Restore wallet' });
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This wallet is not archived.');
  });

  it('offers an explicit unchanged retry while ambiguous', async () => {
    const onSubmit = vi.fn(async () => { throw new Error('Connection timeout'); });
    const onRetry = vi.fn(async () => ({ status: 'success' as const, reconciled: false }));
    const user = userEvent.setup();
    render(<RestoreWalletDialog locale="en" wallet={wallet} pending={false} ambiguous onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={onRetry} onSubmit={onSubmit} />);
    const dialog = screen.getByRole('dialog', { name: 'Restore wallet' });
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
    await user.click(await within(dialog).findByRole('button', { name: 'Retry unchanged restore' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders in Arabic', () => {
    render(<RestoreWalletDialog locale="ar" wallet={wallet} pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onSubmit={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'استعادة المحفظة' });
    expect(within(dialog).getByRole('button', { name: 'استعادة' })).toBeInTheDocument();
  });
});
