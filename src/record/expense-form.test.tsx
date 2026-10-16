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
  it('says where a shortfall from and sends the chosen cover', async () => {
    const api = fakeApi({ recordExpense: async () => ({ entryId: 'e1', covered: 3000n }) });
    const onDone = vi.fn();
    renderWithWorkspace(<ExpenseForm catalog={catalog} onDone={onDone} onCancel={vi.fn()} />, api);
    const user = await fill('150', 'Eating out');
    expect(screen.getByText('Eating out has $120.00. Take the missing $30.00 from:')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Take the missing money from' }), itemId('Fun'));
    await user.click(screen.getByRole('button', { name: 'Record expense' }));
    expect(api.recordExpense).toHaveBeenCalledWith(expect.objectContaining({ itemId: itemId('Eating out'), amount: 15000n, coverFrom: itemId('Fun') }));
    expect(onDone).toHaveBeenCalledWith('Recorded $150.00 from Eating out. $30.00 was covered from another item or Ready to assign.');
  });

  it('warns before over-assigning when Ready to assign cannot cover it', async () => {
    renderWithWorkspace(<ExpenseForm catalog={catalog} onDone={vi.fn()} onCancel={vi.fn()} />, fakeApi());
    await fill('2000', 'Eating out');
    expect(screen.getByText(/this adds \$560\.00/)).toBeInTheDocument();
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


describe('automatic expense cover from its group', () => {
  function groupCatalog(groupMoney: bigint, ready: bigint) {
    const plan = structuredClone(fixtures.plan);
    const group = plan.groups.find(g => g.nameEn === 'Guilt free')!;
    group.flex!.balances.USD = groupMoney;
    return { ...catalog, plan, ready: { USD: ready, LBP: 0n } };
  }

  it('shows the group as the default source and avoids a false over-assignment warning', async () => {
    const api = fakeApi({ recordExpense: async () => ({ entryId: 'e', covered: 3000n }) });
    renderWithWorkspace(<ExpenseForm catalog={groupCatalog(3000n, 0n)} onDone={vi.fn()} onCancel={vi.fn()} />, api);
    const user = await fill('150', 'Eating out');
    expect((screen.getByRole('option', { name: 'This group, then unassigned' }) as HTMLOptionElement).selected).toBe(true);
    expect(screen.getByText(/Up to \$30.00 from Other guilt-free/)).toBeInTheDocument();
    expect(screen.queryByText(/this adds/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Record expense' }));
    expect(api.recordExpense).toHaveBeenCalledWith(expect.objectContaining({ coverFrom: null }));
  });

  it('warns only for the residual shortfall after group money and unassigned money', async () => {
    renderWithWorkspace(<ExpenseForm catalog={groupCatalog(2000n, 500n)} onDone={vi.fn()} onCancel={vi.fn()} />, fakeApi());
    await fill('150', 'Eating out');
    expect(screen.getByText(/this adds \$5.00/)).toBeInTheDocument();
    expect(screen.getByText(/Up to \$20.00 from Other guilt-free/)).toBeInTheDocument();
  });

  it('keeps an explicit alternative cover separate from the automatic group source', async () => {
    renderWithWorkspace(<ExpenseForm catalog={groupCatalog(3000n, 0n)} onDone={vi.fn()} onCancel={vi.fn()} />, fakeApi());
    const user = await fill('150', 'Eating out');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Take the missing money from' }), itemId('Fun'));
    expect(screen.queryByText(/Up to/)).not.toBeInTheDocument();
    expect(screen.queryByText(/this adds/)).not.toBeInTheDocument();
  });

  it('does not count a group flexible balance twice when that same item is charged', async () => {
    renderWithWorkspace(<ExpenseForm catalog={{ ...catalog, ready: { USD: 0n, LBP: 0n } }} onDone={vi.fn()} onCancel={vi.fn()} />, fakeApi());
    await fill('50', 'Other essentials');
    expect(screen.getByText(/this adds \$18.00/)).toBeInTheDocument();
  });
});
