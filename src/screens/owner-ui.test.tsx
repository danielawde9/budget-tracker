import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, fixtures, renderWithWorkspace } from '../test/harness.tsx';
import { HomeScreen } from './home/home.tsx';
import { AccountsScreen } from './accounts/accounts.tsx';
import { ActivityScreen } from './activity/activity.tsx';

describe('owner walkthrough simplification', () => {
  it('keeps Home focused on monthly expenses', async () => {
    renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, fakeApi());
    expect(await screen.findByRole('heading', { name: 'Monthly expenses' })).toBeInTheDocument();
    expect(screen.queryByText('Money breakdown')).not.toBeInTheDocument();
  });

  it('offers a visible expense action for each cash account', async () => {
    const onRecord = vi.fn();
    renderWithWorkspace(<AccountsScreen onRecord={onRecord} />, fakeApi());
    const bank = (await screen.findByText('Bank')).closest('li')!;
    await userEvent.click(within(bank).getByRole('button', { name: 'Expense' }));
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
