import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, fixtures, renderWithWorkspace, space } from '../test/harness.tsx';
import { HomeScreen } from './home/home.tsx';
import { PlanScreen } from './plan/plan.tsx';
import { AccountsScreen } from './accounts/accounts.tsx';

it('offers correction instead of funding when the current plan is over-assigned', async () => {
  const onRecord = vi.fn();
  const user = userEvent.setup();
  const plan = { ...fixtures.plan, month: space().currentMonth, ready: -5400n, isPast: false, isCurrent: true };
  renderWithWorkspace(<PlanScreen month={plan.month} onRecord={onRecord} />, fakeApi({ planMonth: async () => plan }));
  await user.click(await screen.findByRole('button', { name: 'Fix over-assignment' }));
  expect(onRecord).toHaveBeenCalledWith({ kind: 'move', currency: plan.planCurrency });
  expect(screen.queryByRole('button', { name: 'Fund my plan' })).not.toBeInTheDocument();
  expect(screen.getByText('How funding works').closest('details')).not.toHaveAttribute('open');
});

it('distinguishes wallet cash from category assignments when Home is over-assigned', async () => {
  const onRecord = vi.fn();
  const user = userEvent.setup();
  const overview = { ...fixtures.overview, currencies: fixtures.overview.currencies.map(c => ({ ...c, ready: -5400n })) };
  renderWithWorkspace(<HomeScreen onRecord={onRecord} />, fakeApi({ overview: async () => overview }));
  await user.click(await screen.findByRole('button', { name: 'Fix over-assignment' }));
  expect(onRecord).toHaveBeenCalledWith({ kind: 'move', currency: overview.planCurrency });
  const label = await screen.findByText('In your wallets');
  expect(label.closest('article')).toHaveTextContent('$8,712.60');
  expect(screen.queryByText('Available to spend')).not.toBeInTheDocument();
  expect(screen.getByText('Assigned to spending')).toBeInTheDocument();
});

it('summarizes active cash wallets separately by currency without investments or archived balances', async () => {
  const cash = fixtures.accounts.wallets.find(w => w.kind === 'cash')!;
  const accounts = { wallets: [...fixtures.accounts.wallets, { ...cash, id: 'archived', balance: 99999999n, archived: true }] };
  renderWithWorkspace(<AccountsScreen onRecord={vi.fn()} />, fakeApi({ accounts: async () => accounts }));
  const summary = await screen.findByRole('region', { name: 'Wallet balance' });
  expect(within(summary).getByText('$8,712.60')).toBeInTheDocument();
  expect(within(summary).getByText('LBP 2,685,000')).toBeInTheDocument();
  expect(within(summary).queryByText('$12,971.00')).not.toBeInTheDocument();
});
