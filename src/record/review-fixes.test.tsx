import { act, renderHook, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useSpaces } from '../app/use-spaces.ts';
import type { BudgetApi } from '../api/budget-api.ts';
import { fakeApi, fixtures, itemId, renderWithWorkspace } from '../test/harness.tsx';
import { InvestForm } from './forms-accounts.tsx';
import { MoveForm } from './forms-everyday.tsx';

it('asks for a funded source when correcting negative ready money', async () => {
  const api = fakeApi({ assignMoney: async () => ({ entryId: 'correction' }) });
  const catalog = { plan: fixtures.plan, accounts: fixtures.accounts, ready: { USD: -5400n, LBP: 0n } };
  const user = userEvent.setup();
  renderWithWorkspace(<MoveForm catalog={catalog} onDone={vi.fn()} onCancel={vi.fn()} />, api);
  const source = await screen.findByRole('combobox', { name: 'From' });
  expect(within(source).queryByRole('option', { name: /Ready to assign/ })).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'To' })).toHaveValue('');
  await user.type(screen.getByRole('textbox', { name: /Amount/ }), '54');
  expect(screen.getByRole('button', { name: 'Move now' })).toBeDisabled();
  await user.selectOptions(source, itemId('Groceries'));
  await user.click(screen.getByRole('button', { name: 'Move now' }));
  expect(api.assignMoney).toHaveBeenCalledWith(expect.objectContaining({ moves: [{ from: itemId('Groceries'), to: null, currency: 'USD', amount: 5400n }] }));
});

describe('LBP waiting in Ready to assign can be given a job (review #2)', () => {
  it('moves lira out of Ready to assign into an item', async () => {
    const api = fakeApi({ assignMoney: async () => ({ entryId: 'e1' }) });
    const catalog = { plan: fixtures.plan, accounts: fixtures.accounts, ready: { USD: 132000n, LBP: 1000000n } };
    const user = userEvent.setup();
    renderWithWorkspace(<MoveForm catalog={catalog} currency="LBP" onDone={vi.fn()} onCancel={vi.fn()} />, api);
    await user.selectOptions(screen.getByRole('combobox', { name: 'To' }), itemId('Groceries'));
    await user.type(screen.getByRole('textbox', { name: /Amount/ }), '500000');
    expect(screen.getByText('Ready to assign holds LBP 1,000,000.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Move now' }));
    expect(api.assignMoney).toHaveBeenCalledWith(expect.objectContaining({ moves: [{ from: null, to: itemId('Groceries'), currency: 'LBP', amount: 500000n }] }));
  });
});

describe('investing more than To invest holds says where the rest comes from (review #5)', () => {
  it('shows the shortfall and sends the chosen cover', async () => {
    const api = fakeApi({ recordInvestment: async () => ({ entryId: 'e1', covered: 25000n }) });
    const catalog = { plan: fixtures.plan, accounts: fixtures.accounts, ready: { USD: 132000n, LBP: 0n } };
    const onDone = vi.fn();
    const user = userEvent.setup();
    renderWithWorkspace(<InvestForm catalog={catalog} onDone={onDone} onCancel={vi.fn()} />, api);
    await user.type(screen.getByRole('textbox', { name: /Amount/ }), '250');
    expect(screen.getByText('To invest has $0.00. Take the missing $250.00 from:')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Take the missing money from' }), itemId('Holiday'));
    await user.click(screen.getByRole('button', { name: 'Record' }));
    expect(api.recordInvestment).toHaveBeenCalledWith(expect.objectContaining({ action: 'contribute', amount: 25000n, coverFrom: itemId('Holiday') }));
    expect(onDone).toHaveBeenCalledWith(expect.stringContaining('$250.00 was covered from another item'));
  });
});

describe('the space clock refreshes when the app comes back (review #3)', () => {
  it('reloads the spaces (and their today) when the page becomes visible again', async () => {
    const api = fakeApi();
    renderHook(() => useSpaces(api as unknown as BudgetApi));
    await act(async () => { await Promise.resolve(); });
    const before = api.mySpaces.mock.calls.length;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); });
    expect(api.mySpaces.mock.calls.length).toBe(before + 1);
  });
});
