import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, fixtures, renderWithWorkspace } from '../test/harness.tsx';
import { HomeScreen } from './home/home.tsx';
import { PlanScreen } from './plan/plan.tsx';
import { AccountsScreen } from './accounts/accounts.tsx';
import { RecordDialog } from '../record/record-dialog.tsx';
import { ActivityScreen } from './activity/activity.tsx';

it('keeps savings off Home and compares only expense groups', async () => {
  const groups = fixtures.plan.groups.map(g => ({ ...g, purpose: ['Savings', 'Investments', 'Short-term goals'].includes(g.nameEn ?? '') ? 'savings' as const : 'expense' as const }));
  renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, fakeApi({ planMonth: async () => ({ ...fixtures.plan, groups }), activity: async () => ({ ...fixtures.activity, next: null }) }));
  const progress = await screen.findByRole('region', { name: 'Expenses by category' });
  expect(within(progress).getAllByRole('progressbar')).toHaveLength(2);
  expect(within(progress).queryByText('Savings')).not.toBeInTheDocument();
  expect(within(progress).queryByText('Short-term goals')).not.toBeInTheDocument();
  expect(screen.queryByText('Where your money is assigned')).not.toBeInTheDocument();
  expect(screen.queryByText('Money breakdown')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'View this month’s plan' })).not.toBeInTheDocument();
});

it('offers direct account actions and an opening balance action without a hidden menu', async () => {
  const onRecord = vi.fn(); const user = userEvent.setup();
  const { container } = renderWithWorkspace(<AccountsScreen onRecord={onRecord} />, fakeApi());
  const wallet = await screen.findByText('Bank');
  const row = wallet.closest('li')!;
  await user.click(within(row).getByRole('button', { name: 'Add opening balance' }));
  expect(onRecord).toHaveBeenCalledWith({ kind: 'opening', walletId: fixtures.accounts.wallets.find(w => w.name === 'Bank')!.id });
  expect(container.querySelector('.cr-account-menu')).toBeNull();
  expect(within(row).getByRole('button', { name: 'Expense' })).toBeVisible();
});

it('exposes opening balances in Plan and splits expense and savings groups', async () => {
  const onRecord = vi.fn();
  renderWithWorkspace(<PlanScreen month={fixtures.plan.month} onRecord={onRecord} />, fakeApi());
  expect(await screen.findByRole('heading', { name: 'Expenses' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Savings', level: 2 })).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: 'Add opening balance' })[0]!);
  expect(onRecord).toHaveBeenCalledWith({ kind: 'opening', target: 'category' });
});

it('shows category badges and sends purpose and group filters to the database', async () => {
  const api = fakeApi();
  renderWithWorkspace(<ActivityScreen onRecord={vi.fn()} />, api);
  await screen.findByLabelText('Group');
  await userEvent.selectOptions(screen.getByLabelText('Expenses or savings'), 'savings');
  await userEvent.selectOptions(screen.getByLabelText('Group'), fixtures.plan.groups[0]!.groupId);
  await waitFor(() => expect(api.activity).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ filter: { purpose: 'savings', groupId: fixtures.plan.groups[0]!.groupId } })));
});

it('discards an obsolete next page even if filters return to the same value', async () => {
  const first = fixtures.activity.entries[0]!;
  let finishPage!: (page: typeof fixtures.activity) => void;
  const cursor = { id: 'old-cursor', occurredOn: first.occurredOn, createdAt: first.createdAt };
  const api = fakeApi({ activity: async (_space: unknown, options: { before?: unknown }) => options.before
    ? new Promise(resolve => { finishPage = resolve; })
    : { entries: [first], next: cursor } });
  renderWithWorkspace(<ActivityScreen onRecord={vi.fn()} />, api);
  await userEvent.click(await screen.findByRole('button', { name: 'Show more' }));
  await userEvent.selectOptions(screen.getByLabelText('Expenses or savings'), 'savings');
  await userEvent.selectOptions(screen.getByLabelText('Expenses or savings'), '');
  await screen.findByRole('button', { name: /Groceries/ });
  finishPage({ entries: [{ ...first, entryId: 'obsolete', memo: 'obsolete response' }], next: null });
  await waitFor(() => expect(screen.queryByRole('button', { name: /obsolete response/ })).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
});
