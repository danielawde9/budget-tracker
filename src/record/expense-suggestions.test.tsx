import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BudgetError } from '../api/budget-api.ts';
import type { ExpenseSuggestions } from '../api/schemas.ts';
import { fakeApi, fixtures, itemId, renderWithWorkspace } from '../test/harness.tsx';
import { ExpenseForm } from './forms-everyday.tsx';

const catalog = { plan: fixtures.plan, accounts: fixtures.accounts, ready: { USD: 132000n, LBP: 0n } };

function walletId(name: string): string {
  const wallet = fixtures.accounts.wallets.find((candidate) => candidate.name === name);
  if (!wallet) throw new Error(`fixture has no wallet ${name}`);
  return wallet.id;
}

const supermarket: ExpenseSuggestions = {
  lastWalletId: null,
  suggestions: [{ memo: 'Supermarket', itemId: itemId('Groceries'), walletId: walletId('Cash'), amount: 6420n, currency: 'USD', lastOn: '2026-10-01' }],
};

const description = () => screen.getByRole('textbox', { name: 'Description' });
const amount = () => screen.getByRole('textbox', { name: /Amount/ });
const item = () => screen.getByRole('combobox', { name: 'What was it for?' });
const wallet = () => screen.getByRole('combobox', { name: 'Paid from' });

describe('the expense form remembers past expenses', () => {
  it('offers each past description in the list', async () => {
    renderWithWorkspace(<ExpenseForm catalog={catalog} onDone={vi.fn()} onCancel={vi.fn()} />, fakeApi({ expenseSuggestions: async () => supermarket }));
    await screen.findByText(/Start typing to reuse a past expense/);
    await userEvent.setup().click(description());
    expect(screen.getByRole('button', { name: /Supermarket/ })).toBeVisible();
    expect(description()).not.toHaveAttribute('list');
  });

  it('picking one fills the item, wallet and last amount', async () => {
    const api = fakeApi({ expenseSuggestions: async () => supermarket, recordExpense: async () => ({ entryId: 'e1', covered: 0n }) });
    const user = userEvent.setup();
    renderWithWorkspace(<ExpenseForm catalog={catalog} onDone={vi.fn()} onCancel={vi.fn()} />, api);
    await screen.findByText(/Start typing to reuse a past expense/);
    await user.type(description(), 'Supermarket');
    expect(item()).toHaveValue(itemId('Groceries'));
    expect(wallet()).toHaveValue(walletId('Cash'));
    expect(amount()).toHaveValue('64.20');
    await user.click(screen.getByRole('button', { name: 'Record expense' }));
    expect(api.recordExpense).toHaveBeenCalledWith(expect.objectContaining({
      memo: 'Supermarket', itemId: itemId('Groceries'), walletId: walletId('Cash'), amount: 6420n,
    }));
  });

  it('keeps what the person already typed or chose', async () => {
    const user = userEvent.setup();
    renderWithWorkspace(<ExpenseForm catalog={catalog} onDone={vi.fn()} onCancel={vi.fn()} />, fakeApi({ expenseSuggestions: async () => supermarket }));
    await screen.findByText(/Start typing to reuse a past expense/);
    await user.type(amount(), '12');
    await user.selectOptions(wallet(), walletId('Bank'));
    await user.type(description(), 'supermarket');
    expect(amount()).toHaveValue('12');
    expect(wallet()).toHaveValue(walletId('Bank'));
    expect(item()).toHaveValue(itemId('Groceries'));
  });

  it('starts on the wallet used last', async () => {
    renderWithWorkspace(<ExpenseForm catalog={catalog} onDone={vi.fn()} onCancel={vi.fn()} />,
      fakeApi({ expenseSuggestions: async () => ({ lastWalletId: walletId('Cash'), suggestions: [] }) }));
    await vi.waitFor(() => expect(wallet()).toHaveValue(walletId('Cash')));
  });

  it('still records when past expenses cannot be loaded', async () => {
    const api = fakeApi({ expenseSuggestions: async () => { throw new BudgetError('NETWORK'); }, recordExpense: async () => ({ entryId: 'e1', covered: 0n }) });
    const user = userEvent.setup();
    renderWithWorkspace(<ExpenseForm catalog={catalog} onDone={vi.fn()} onCancel={vi.fn()} />, api);
    expect(await screen.findByText('Past expenses could not be loaded, so there are no suggestions this time.')).toBeInTheDocument();
    await user.type(amount(), '5');
    await user.selectOptions(item(), itemId('Groceries'));
    await user.click(screen.getByRole('button', { name: 'Record expense' }));
    expect(api.recordExpense).toHaveBeenCalledTimes(1);
  });
});

describe('a single wallet is shown, not chosen', () => {
  it('shows the only wallet as text and records from it', async () => {
    const bankOnly = { ...fixtures.accounts, wallets: fixtures.accounts.wallets.filter((candidate) => candidate.kind !== 'cash' || candidate.name === 'Bank') };
    const api = fakeApi({ recordExpense: async () => ({ entryId: 'e1', covered: 0n }) });
    const user = userEvent.setup();
    renderWithWorkspace(<ExpenseForm catalog={{ ...catalog, accounts: bankOnly }} onDone={vi.fn()} onCancel={vi.fn()} />, api);
    expect(screen.queryByRole('combobox', { name: 'Paid from' })).not.toBeInTheDocument();
    expect(screen.getByText('Paid from')).toBeInTheDocument();
    expect(screen.getByText('Bank').closest('p')).toHaveTextContent(/^Bank — \$/);
    await user.type(amount(), '5');
    await user.selectOptions(item(), itemId('Groceries'));
    await user.click(screen.getByRole('button', { name: 'Record expense' }));
    expect(api.recordExpense).toHaveBeenCalledWith(expect.objectContaining({ walletId: walletId('Bank') }));
  });
});
