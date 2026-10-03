import { act, fireEvent, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BudgetError } from '../api/budget-api.ts';
import { fakeApi, fixtures, itemId, renderWithWorkspace } from '../test/harness.tsx';
import { ExpenseForm } from './forms-everyday.tsx';

const catalog = { plan: fixtures.plan, accounts: fixtures.accounts, ready: { USD: 132000n, LBP: 0n } };

async function fill(amount: string, item: string) {
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: /Amount/ }), amount);
  await user.selectOptions(screen.getByRole('combobox', { name: 'What was it for?' }), itemId(item));
  return user;
}

describe('ExpenseForm and the overspending rule', () => {
  it('says where a shortfall will come from and sends the chosen cover', async () => {
    const api = fakeApi({ recordExpense: async () => ({ entryId: 'e1', covered: 3000n }) });
    const onDone = vi.fn();
    renderWithWorkspace(<ExpenseForm catalog={catalog} onDone={onDone} onCancel={vi.fn()} />, api);
    const user = await fill('150', 'Eating out');
    expect(screen.getByText('Eating out has $120.00. The other $30.00 will come from:')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Cover the difference from' }), itemId('Fun'));
    await user.click(screen.getByRole('button', { name: 'Record expense' }));
    expect(api.recordExpense).toHaveBeenCalledWith(expect.objectContaining({ itemId: itemId('Eating out'), amount: 15000n, coverFrom: itemId('Fun') }));
    expect(onDone).toHaveBeenCalledWith('Recorded $150.00 from Eating out. $30.00 was covered from another item or Ready to assign.');
  });

  it('warns before over-assigning when Ready to assign cannot cover it', async () => {
    renderWithWorkspace(<ExpenseForm catalog={catalog} onDone={vi.fn()} onCancel={vi.fn()} />, fakeApi());
    await fill('2000', 'Eating out');
    expect(screen.getByText(/you will be over-assigned by \$560\.00/)).toBeInTheDocument();
  });

  it('sends one request for a double click and reuses its id after a lost response', async () => {
    let calls = 0;
    const ids: string[] = [];
    const api = fakeApi({
      recordExpense: async (input: { requestId: string }) => {
        calls += 1;
        ids.push(input.requestId);
        if (calls === 1) throw new BudgetError('NETWORK');
        return { entryId: 'e1', covered: 0n };
      },
    });
    renderWithWorkspace(<ExpenseForm catalog={catalog} onDone={vi.fn()} onCancel={vi.fn()} />, api);
    const user = await fill('12', 'Groceries');
    const submit = screen.getByRole('button', { name: 'Record expense' });
    // Two submits in one React batch, before the button can re-render as
    // disabled: only the in-flight guard can drop the second one.
    const form = submit.closest('form');
    if (!form) throw new Error('no form');
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(await screen.findByText(/The server could not be reached/)).toBeInTheDocument();
    expect(calls).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Record expense' }));
    expect(calls).toBe(2);
    expect(ids[1]).toBe(ids[0]);
  });
});
