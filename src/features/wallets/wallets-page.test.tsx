import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryWalletsGateway } from '../../test/in-memory-wallets-gateway.js';
import type { RecordEventInput } from './types.js';
import { WalletsPage } from './wallets-page.js';

async function renderPage(gateway = new InMemoryWalletsGateway(), locale: 'en' | 'ar' = 'en') {
  const user = userEvent.setup();
  render(<WalletsPage gateway={gateway} spaceId="personal-space" locale={locale} onSpaceUnavailable={vi.fn()} onOpenLoans={vi.fn()} />);
  await screen.findByRole('heading', { name: locale === 'ar' ? 'المحافظ' : 'Wallets' });
  await waitFor(() => expect(screen.queryByRole('status', { name: /loading/i })).not.toBeInTheDocument());
  return { gateway, user };
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
