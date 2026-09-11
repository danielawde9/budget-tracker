import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { WalletProjection } from './types.js';
import { RenameWalletDialog } from './rename-wallet-dialog.js';

const wallet: WalletProjection = { id: 'wallet-1', spaceId: 'space-1', name: 'Daily USD', currency: 'USD', archivedAt: null, balanceMinor: '1250' };

function renderDialog(locale: 'en' | 'ar' = 'en', onSubmit = vi.fn(async () => ({ status: 'success' as const, reconciled: false }))) {
  const user = userEvent.setup();
  render(<RenameWalletDialog locale={locale} wallet={wallet} pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onSubmit={onSubmit} />);
  return { onSubmit, user };
}

describe('RenameWalletDialog', () => {
  it('pre-fills the current name and disables Save until it changes', async () => {
    const { user } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Rename wallet' });
    const input = within(dialog).getByLabelText('Wallet name');
    expect(input).toHaveValue('Daily USD');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.clear(input);
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.type(input, 'Travel cash');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('submits the trimmed name and shows a confirmation', async () => {
    const { onSubmit, user } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Rename wallet' });
    const input = within(dialog).getByLabelText('Wallet name');
    await user.clear(input);
    await user.type(input, '  Travel cash  ');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledWith({ walletId: 'wallet-1', name: 'Travel cash' });
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Wallet renamed');
  });

  it('surfaces a classified rejection without exposing database text', async () => {
    const onSubmit = vi.fn(async () => { throw { code: 'P0001', message: 'the wallet already has this name' }; });
    const { user } = renderDialog('en', onSubmit);
    const dialog = screen.getByRole('dialog', { name: 'Rename wallet' });
    const input = within(dialog).getByLabelText('Wallet name');
    await user.clear(input);
    await user.type(input, 'Reserve USD');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('This wallet already has this name.');
    expect(alert).not.toHaveTextContent(/wallet_command_requests/);
  });

  it('offers an explicit unchanged retry while ambiguous', async () => {
    const onSubmit = vi.fn(async () => { throw new Error('Connection timeout'); });
    const onRetry = vi.fn(async () => ({ status: 'success' as const, reconciled: false }));
    const user = userEvent.setup();
    render(<RenameWalletDialog locale="en" wallet={wallet} pending={false} ambiguous onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={onRetry} onSubmit={onSubmit} />);
    const dialog = screen.getByRole('dialog', { name: 'Rename wallet' });
    const input = within(dialog).getByLabelText('Wallet name');
    await user.clear(input);
    await user.type(input, 'Reserve USD');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await user.click(await within(dialog).findByRole('button', { name: 'Retry unchanged rename' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders in Arabic with the wallet name isolated', async () => {
    renderDialog('ar');
    const dialog = screen.getByRole('dialog', { name: 'إعادة تسمية المحفظة' });
    expect(within(dialog).getByLabelText('اسم المحفظة')).toHaveValue('Daily USD');
    expect(within(dialog).getByRole('button', { name: 'حفظ' })).toBeDisabled();
  });
});
