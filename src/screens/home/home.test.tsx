import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, fixtures, renderWithWorkspace } from '../../test/harness.tsx';
import { HomeScreen } from './home.tsx';

describe('Home', () => {
  it('compares monthly expenses with their plan and omits assignment details', async () => {
    renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, fakeApi());
    const summary = await screen.findByRole('region', { name: 'Monthly expenses' });
    expect(within(summary).getByText('$3,138.00')).toBeInTheDocument();
    expect(screen.queryByText('Money breakdown')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Where your money was spent' })).toBeInTheDocument();
    const progress = screen.getByRole('region', { name: 'Expenses by category' });
    expect(within(progress).getAllByRole('progressbar')).toHaveLength(3);
    expect(within(progress).queryByText('Savings')).not.toBeInTheDocument();
  });

  it('keeps LBP expenses separate and does not invent a plan in another currency', async () => {
    const user = userEvent.setup();
    renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, fakeApi());
    await screen.findByRole('region', { name: 'Monthly expenses' });
    await user.click(screen.getByRole('button', { name: 'LBP' }));
    const summary = screen.getByRole('region', { name: 'Monthly expenses' });
    expect(within(summary).queryByText('$3,138.00')).not.toBeInTheDocument();
    expect(within(summary).getByText('Category progress is shown in your plan currency.')).toBeInTheDocument();
    expect(within(summary).getAllByText('—')).toHaveLength(2);
  });

  it('lists bills with coverage and a pay action', async () => {
    const onRecord = vi.fn();
    renderWithWorkspace(<HomeScreen onRecord={onRecord} />, fakeApi());
    const bills = await screen.findByRole('region', { name: 'Upcoming bills' });
    const internet = (await within(bills).findByText('Internet')).closest('li')!;
    expect(within(internet).getByText('Covered')).toBeInTheDocument();
    await userEvent.click(within(internet).getByRole('button', { name: 'Pay' }));
    expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({ kind: 'expense', bill: expect.objectContaining({ name: 'Internet', amount: 4500n }) }));
  });

  it('shows an empty expense state when every group is savings', async () => {
    renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, fakeApi({ planMonth: async () => ({ ...fixtures.plan, groups: fixtures.plan.groups.map(group => ({ ...group, purpose: 'savings' })) }) }));
    const summary = await screen.findByRole('region', { name: 'Monthly expenses' });
    expect(within(summary).getAllByText('$0.00')).toHaveLength(3);
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  });
});
