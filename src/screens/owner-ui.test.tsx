import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, fixtures, renderWithWorkspace } from '../test/harness.tsx';
import { HomeScreen } from './home/home.tsx';
import { AccountsScreen } from './accounts/accounts.tsx';
import { ActivityScreen } from './activity/activity.tsx';

describe('owner walkthrough simplification', () => {
  it('starts with funding the current month and keeps the money breakdown on request', async () => {
    const onRecord = vi.fn();
    const user = userEvent.setup();
    renderWithWorkspace(<HomeScreen onRecord={onRecord} />, fakeApi());
    await user.click(await screen.findByRole('button', { name: 'Fund my plan' }));
    expect(onRecord).toHaveBeenCalledWith({ kind: 'fund', month: fixtures.overview.month });
    const summary = screen.getByText('Money breakdown').closest('details');
    expect(summary).not.toHaveAttribute('open');
    await user.click(screen.getByText('Money breakdown'));
    expect(summary).toHaveAttribute('open');
  });

  it('keeps wallet actions in a contextual menu', async () => {
    const user = userEvent.setup();
    const onRecord = vi.fn();
    renderWithWorkspace(<AccountsScreen onRecord={onRecord} />, fakeApi());
    const menu = (await screen.findAllByText('Account actions'))[0];
    if (!menu) throw new Error('missing menu');
    const details = menu.closest('details');
    expect(details).not.toHaveAttribute('open');
    await user.click(menu);
    const region = menu.closest('li');
    if (!region) throw new Error('missing wallet');
    await user.click(within(region).getByRole('button', { name: 'Expense' }));
    expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({ kind: 'expense', walletId: expect.any(String) }));
  });

  it('searches loaded activity without hiding the original entries after clearing', async () => {
    const user = userEvent.setup();
    renderWithWorkspace(<ActivityScreen onRecord={vi.fn()} />, fakeApi());
    const search = await screen.findByRole('searchbox', { name: 'Search loaded activity' });
    await screen.findByRole('button', { name: /Rent/ });
    await user.type(search, 'no-matching-record');
    expect(screen.queryByRole('button', { name: /Rent/ })).not.toBeInTheDocument();
    expect(screen.getByText('No loaded records match. Load more to search older activity.')).toBeInTheDocument();
    await user.clear(search);
    expect(screen.getByRole('button', { name: /Rent/ })).toBeInTheDocument();
  });
});
