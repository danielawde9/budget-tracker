import { fireEvent, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BudgetError } from '../api/budget-api.ts';
import { fakeApi, fixtures, itemId, renderWithWorkspace, space } from '../test/harness.tsx';
import { RecordDialog } from './record-dialog.tsx';

const bank = fixtures.accounts.wallets.find(wallet => wallet.name === 'Bank')!;
const savingsId = itemId('General savings');
const save = () => userEvent.click(screen.getByRole('button', { name: 'Save opening balance' }));
const confirm = () => userEvent.click(screen.getByRole('checkbox'));

it('uses the desired account total and adds only confirmed missing money without recording income', async () => {
  const api = fakeApi({ recordWalletOpening: async () => ({ entryId: 'opening' }) });
  renderWithWorkspace(<RecordDialog intent={{ kind: 'opening', walletId: bank.id }} onClose={vi.fn()} />, api);
  await userEvent.type(await screen.findByRole('textbox', { name: 'Total account balance' }), '8744.60');
  expect(screen.getByText(/Current recorded balance/)).toHaveTextContent('$8,444.60');
  expect(screen.getByRole('region', { name: 'Preview' })).toHaveTextContent('Missing money to add: $300.00');
  await save();
  expect(api.recordWalletOpening).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('Confirm');
  await confirm(); await save();
  await waitFor(() => expect(api.recordWalletOpening).toHaveBeenCalledWith(expect.objectContaining({ walletId: bank.id, amount: 30000n, expectedBalance: bank.balance, on: space().today })));
  expect(api.recordIncome).not.toHaveBeenCalled(); expect(api.assignMoney).not.toHaveBeenCalled();
});

it('uses the category total and assigns only the difference from money already in accounts', async () => {
  const api = fakeApi({ assignMoney: async () => ({ entryId: 'opening' }) });
  renderWithWorkspace(<RecordDialog intent={{ kind: 'opening', target: 'category', itemId: savingsId }} onClose={vi.fn()} />, api);
  await userEvent.type(await screen.findByRole('textbox', { name: 'Total category balance' }), '3972');
  expect(screen.getByRole('region', { name: 'Preview' })).toHaveTextContent('Unassigned money: $1,320.00 → $1,020.00');
  await save(); expect(api.assignMoney).not.toHaveBeenCalled();
  await confirm(); await save();
  await waitFor(() => expect(api.assignMoney).toHaveBeenCalledWith(expect.objectContaining({ opening: true, moves: [{ from: null, to: savingsId, currency: 'USD', amount: 30000n, expectedBalance: 367200n }] })));
  expect(api.recordWalletOpening).not.toHaveBeenCalled(); expect(api.recordIncome).not.toHaveBeenCalled();
});

it.each(['account', 'category'] as const)('does not record a repeated %s total', async target => {
  const api = fakeApi();
  renderWithWorkspace(<RecordDialog intent={{ kind: 'opening', target, walletId: bank.id, itemId: savingsId }} onClose={vi.fn()} />, api);
  await userEvent.type(await screen.findByRole('textbox', { name: target === 'account' ? 'Total account balance' : 'Total category balance' }), target === 'account' ? '8444.60' : '3672');
  expect(screen.getByText('This total is already recorded. Nothing will be added.')).toHaveAttribute('role', 'status');
  expect(screen.getByRole('button', { name: 'Save opening balance' })).toBeDisabled();
  await confirm(); await save();
  expect(api.assignMoney).not.toHaveBeenCalled(); expect(api.recordWalletOpening).not.toHaveBeenCalled();
});

it.each(['account', 'category'] as const)('blocks a lower %s target and explains how to correct it', async target => {
  const api = fakeApi();
  renderWithWorkspace(<RecordDialog intent={{ kind: 'opening', target, walletId: bank.id, itemId: savingsId }} onClose={vi.fn()} />, api);
  await userEvent.type(await screen.findByRole('textbox', { name: target === 'account' ? 'Total account balance' : 'Total category balance' }), '300');
  expect(screen.getByText(/An opening balance can only add/)).toHaveTextContent(target === 'account' ? 'Activity' : 'Move money');
  expect(screen.getByRole('button', { name: 'Save opening balance' })).toBeDisabled();
  await confirm(); await save();
  expect(api.assignMoney).not.toHaveBeenCalled(); expect(api.recordWalletOpening).not.toHaveBeenCalled();
});

it.each([132000n, -50000n])('blocks unaffordable category openings when ready is %s without assuming account money is missing', async ready => {
  const api = fakeApi({ overview: async () => ({ ...fixtures.overview, currencies: fixtures.overview.currencies.map(view => view.currency === 'USD' ? { ...view, ready } : view) }) });
  renderWithWorkspace(<RecordDialog intent={{ kind: 'opening', target: 'category', itemId: savingsId }} onClose={vi.fn()} />, api);
  await userEvent.type(await screen.findByRole('textbox', { name: 'Total category balance' }), '6000');
  expect(screen.getByText(/There is not enough unassigned money/)).toHaveTextContent('Move money');
  expect(screen.getByText(/Only if money is missing/)).toHaveTextContent('Accounts');
  expect(screen.getByRole('button', { name: 'Save opening balance' })).toBeDisabled();
  await confirm(); await save(); expect(api.assignMoney).not.toHaveBeenCalled();
});

it('uses positive total outstanding debt for a loan owed while sending its signed balance snapshot', async () => {
  const loan = fixtures.accounts.wallets.find(wallet => wallet.loanDirection === 'i_owe')!;
  const api = fakeApi({ recordWalletOpening: async () => ({ entryId: 'opening' }) });
  renderWithWorkspace(<RecordDialog intent={{ kind: 'opening', walletId: loan.id }} onClose={vi.fn()} />, api);
  await userEvent.type(await screen.findByRole('textbox', { name: 'Total outstanding debt' }), '5958');
  expect(screen.getByRole('region', { name: 'Preview' })).toHaveTextContent('Outstanding debt: $5,658.00 → $5,958.00');
  await confirm(); await save();
  await waitFor(() => expect(api.recordWalletOpening).toHaveBeenCalledWith(expect.objectContaining({ walletId: loan.id, amount: 30000n, expectedBalance: -565800n })));
});

it('requires reviewing freshly loaded balances after a stale response before adding the new difference', async () => {
  let balance = bank.balance;
  const api = fakeApi({ accounts: async () => ({ wallets: fixtures.accounts.wallets.map(wallet => wallet.id === bank.id ? { ...wallet, balance } : wallet) }), recordWalletOpening: async () => { balance = 854460n; throw new BudgetError('BUDGET_BALANCE_CHANGED'); } });
  renderWithWorkspace(<RecordDialog intent={{ kind: 'opening', walletId: bank.id }} onClose={vi.fn()} />, api);
  await userEvent.type(await screen.findByRole('textbox', { name: 'Total account balance' }), '8744.60');
  await confirm(); await save();
  expect(await screen.findByRole('alert')).toHaveTextContent('balance changed');
  expect(screen.getByRole('button', { name: 'Save opening balance' })).toBeDisabled();
  await save(); expect(api.recordWalletOpening).toHaveBeenCalledTimes(1);
  api.recordWalletOpening.mockResolvedValue({ entryId: 'opening' });
  await userEvent.click(screen.getByRole('button', { name: 'Reload balances' }));
  await waitFor(() => expect(screen.getByText(/Current recorded balance/)).toHaveTextContent('$8,544.60'));
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  await userEvent.type(screen.getByRole('textbox', { name: 'Total account balance' }), '8744.60');
  await confirm(); await save();
  await waitFor(() => expect(api.recordWalletOpening).toHaveBeenCalledTimes(2));
  expect(api.recordWalletOpening.mock.calls[1]![0]).toMatchObject({ amount: 20000n, expectedBalance: 854460n });
  expect(api.recordWalletOpening.mock.calls[1]![0].requestId).not.toBe(api.recordWalletOpening.mock.calls[0]![0].requestId);
});

it('retries a lost response with the same request and balance snapshot', async () => {
  const api = fakeApi({ recordWalletOpening: async () => { throw new BudgetError('NETWORK'); } });
  renderWithWorkspace(<RecordDialog intent={{ kind: 'opening', walletId: bank.id }} onClose={vi.fn()} />, api);
  await userEvent.type(await screen.findByRole('textbox', { name: 'Total account balance' }), '8744.60');
  await confirm(); await save();
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  api.recordWalletOpening.mockResolvedValue({ entryId: 'opening' });
  await save();
  await waitFor(() => expect(api.recordWalletOpening).toHaveBeenCalledTimes(2));
  expect(api.recordWalletOpening.mock.calls[1]![0]).toEqual(api.recordWalletOpening.mock.calls[0]![0]);
});

it('does not send invalid dates or fractional lira and accepts Arabic whole lira totals', async () => {
  const api = fakeApi({ recordWalletOpening: async () => ({ entryId: 'opening' }) });
  const wallet = fixtures.accounts.wallets.find(w => w.kind === 'cash' && w.currency === 'LBP')!;
  renderWithWorkspace(<RecordDialog intent={{ kind: 'opening', walletId: wallet.id }} onClose={vi.fn()} />, api, 'ar');
  const input = await screen.findByRole('textbox', { name: 'إجمالي رصيد الحساب' });
  await userEvent.type(input, '٢٦٨٦٥٠٠٫٥'); await confirm();
  await userEvent.click(screen.getByRole('button', { name: 'حفظ الرصيد الافتتاحي' }));
  expect(api.recordWalletOpening).not.toHaveBeenCalled();
  await userEvent.clear(input); await userEvent.type(input, '٢٦٨٦٥٠٠');
  fireEvent.change(screen.getByLabelText('تاريخ الرصيد'), { target: { value: '2099-01-01' } });
  await userEvent.click(screen.getByRole('button', { name: 'حفظ الرصيد الافتتاحي' }));
  expect(api.recordWalletOpening).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('تاريخ الرصيد'), { target: { value: space().today } });
  await userEvent.click(screen.getByRole('button', { name: 'حفظ الرصيد الافتتاحي' }));
  await waitFor(() => expect(api.recordWalletOpening).toHaveBeenCalledWith(expect.objectContaining({ amount: 1500n, walletId: wallet.id, expectedBalance: wallet.balance })));
});


it.each(['account', 'category'] as const)('does not add the same %s total again after saving and reopening', async target => {
  let recorded = false;
  const api = fakeApi({
    accounts: async () => ({ wallets: fixtures.accounts.wallets.map(wallet => recorded && wallet.id === bank.id ? { ...wallet, balance: 874460n } : wallet) }),
    planMonth: async () => ({ ...fixtures.plan, groups: fixtures.plan.groups.map(group => ({ ...group, flex: recorded && group.flex?.itemId === savingsId ? { ...group.flex, balances: { ...group.flex.balances, USD: 397200n } } : group.flex })) }),
    recordWalletOpening: async () => { recorded = true; return { entryId: 'opening' }; },
    assignMoney: async () => { recorded = true; return { entryId: 'opening' }; },
  });
  const dialog = () => <RecordDialog intent={{ kind: 'opening', target, walletId: bank.id, itemId: savingsId }} onClose={vi.fn()} />;
  const view = renderWithWorkspace(dialog(), api);
  const label = target === 'account' ? 'Total account balance' : 'Total category balance';
  const total = target === 'account' ? '8744.60' : '3972';
  await userEvent.type(await screen.findByRole('textbox', { name: label }), total);
  await confirm(); await save();
  await screen.findByRole('button', { name: 'Done' });
  view.unmount();
  renderWithWorkspace(dialog(), api);
  await userEvent.type(await screen.findByRole('textbox', { name: label }), total);
  expect(screen.getByText('This total is already recorded. Nothing will be added.')).toBeInTheDocument();
  await confirm(); await save();
  expect(target === 'account' ? api.recordWalletOpening : api.assignMoney).toHaveBeenCalledTimes(1);
});

it('requires reviewing the category balance after a stale opening assignment', async () => {
  const api = fakeApi({ assignMoney: async () => { throw new BudgetError('BUDGET_BALANCE_CHANGED'); } });
  renderWithWorkspace(<RecordDialog intent={{ kind: 'opening', target: 'category', itemId: savingsId }} onClose={vi.fn()} />, api);
  await userEvent.type(await screen.findByRole('textbox', { name: 'Total category balance' }), '3972');
  await confirm(); await save();
  expect(await screen.findByRole('alert')).toHaveTextContent('balance changed');
  await save(); expect(api.assignMoney).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Reload balances' }));
  expect(screen.getByRole('textbox', { name: 'Total category balance' })).toHaveValue('');
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(api.planMonth).toHaveBeenCalledTimes(2);
});
