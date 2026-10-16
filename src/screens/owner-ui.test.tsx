import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, fixtures, renderWithWorkspace } from '../test/harness.tsx';
import { HomeScreen } from './home/home.tsx';
import { AccountsScreen } from './accounts/accounts.tsx';
import { ActivityScreen } from './activity/activity.tsx';

describe('owner walkthrough simplification', () => {
  it('starts with funding the current month and shows the cash equation without another click', async () => {
    const onRecord = vi.fn();
    const user = userEvent.setup();
    renderWithWorkspace(<HomeScreen onRecord={onRecord} />, fakeApi());
    await user.click(await screen.findByRole('button', { name: 'Fund my plan' }));
    expect(onRecord).toHaveBeenCalledWith({ kind: 'fund', month: fixtures.overview.month });
    const summary = screen.getByText('How your cash adds up').closest('details');
    expect(summary).toHaveAttribute('open');
  });

  it('shows wallet actions on the first level', async () => {
    const user = userEvent.setup();
    const onRecord = vi.fn();
    renderWithWorkspace(<AccountsScreen onRecord={onRecord} />, fakeApi());
    const expense = (await screen.findAllByRole('button', { name: 'Expense' }))[0]!;
    const region = expense.closest('li')!;
    expect(expense).toBeVisible();
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
