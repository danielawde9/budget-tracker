import { fireEvent, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, fixtures, renderWithWorkspace } from '../../test/harness.tsx';
import { HomeScreen } from './home.tsx';

describe('Home', () => {
  it('lets users scrub daily expenses and read exact spending against that day’s planned pace', async () => {
    renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, fakeApi());
    const chart = await screen.findByRole('region', { name: 'Actual vs. planned expenses' });
    const slider = within(chart).getByRole('slider', { name: 'Explore spending by day' });
    fireEvent.change(slider, { target: { value: '1' } });
    expect(slider).toHaveValue('1');
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringContaining('Oct 1'));
    expect(within(chart).getByText('Spending through Oct 1')).toBeInTheDocument();
    await userEvent.click(within(chart).getByRole('button', { name: 'Latest day' }));
    expect(slider).toHaveValue(String(Number(fixtures.overview.today.slice(-2))));
  });

  it('compares monthly expenses with their plan and omits assignment details', async () => {
    renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, fakeApi());
    const summary = await screen.findByRole('region', { name: 'Monthly expenses' });
    expect(within(summary).getByText('$2,521.50')).toBeInTheDocument();
    expect(screen.queryByText('Money breakdown')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Where your money was spent' })).toBeInTheDocument();
    const progress = screen.getByRole('region', { name: 'Expenses by category' });
    expect(within(progress).getAllByRole('progressbar')).toHaveLength(2);
    expect(within(progress).queryByText('Savings')).not.toBeInTheDocument();
    expect(within(progress).queryByText('Short-term goals')).not.toBeInTheDocument();
  });

  it('keeps LBP expenses separate and does not invent a plan in another currency', async () => {
    const user = userEvent.setup();
    renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, fakeApi());
    await screen.findByRole('region', { name: 'Monthly expenses' });
    await user.click(screen.getByRole('button', { name: 'LBP' }));
    const summary = screen.getByRole('region', { name: 'Monthly expenses' });
    expect(within(summary).queryByText('$2,521.50')).not.toBeInTheDocument();
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


it('shows remaining planned expenses by category under the monthly total, including negative overspending', async () => {
  const base = fixtures.plan.groups[0]!;
  const item = base.items[0]!;
  const plan = { ...fixtures.plan, groups: [
    { ...base, groupId: 'essential', nameEn: 'Essentials', purpose: 'expense' as const, items: [{ ...item, itemId: 'essential-item', planned: 10000n, balances: { USD: 999999n, LBP: 0n } }], flex: null },
    { ...base, groupId: 'guilt', nameEn: 'Guilt free', purpose: 'expense' as const, items: [{ ...item, itemId: 'guilt-item', planned: 5000n }], flex: null },
    { ...base, groupId: 'goals', nameEn: 'Short-term goals', purpose: 'savings' as const, items: [{ ...item, itemId: 'goal-item', planned: 90000n }], flex: null },
  ] };
  const entry = fixtures.activity.entries[0]!;
  const line = entry.items[0]!;
  const entries = [{ ...entry, occurredOn: '2026-10-02', items: [
    { ...line, itemId: 'essential-item', groupId: 'essential', purpose: 'expense' as const, amount: -4000n, flow: 'spend' as const },
    { ...line, itemId: 'essential-item', groupId: 'essential', purpose: 'expense' as const, amount: 500n, flow: 'refund' as const },
    { ...line, itemId: 'guilt-item', groupId: 'guilt', purpose: 'expense' as const, amount: -6000n, flow: 'spend' as const },
    { ...line, itemId: 'goal-item', groupId: 'goals', purpose: 'savings' as const, amount: -9000n, flow: 'spend' as const },
    { ...line, itemId: 'old-item', groupId: 'old-group', groupNameEn: 'Archived category', purpose: 'expense' as const, amount: -700n, flow: 'spend' as const },
  ] }];
  renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, fakeApi({ planMonth: async () => plan, activity: async () => ({ entries, next: null }) }));
  const summary = await screen.findByRole('region', { name: 'Monthly expenses' });
  expect(within(summary).getByText('$150.00')).toBeInTheDocument();
  expect(within(summary).getByText('$102.00')).toBeInTheDocument();
  expect(within(summary).getByText('$48.00')).toBeInTheDocument();
  const breakdown = within(summary).getByRole('region', { name: 'Remaining by expense category' });
  expect(within(breakdown).getByText(/Planned minus net spending/)).toHaveTextContent('cash available');
  expect(within(breakdown).getByText('Essentials').closest('div')).toHaveTextContent('$65.00');
  expect(within(breakdown).getByText('Guilt free').closest('div')).toHaveTextContent('-$10.00');
  expect(within(breakdown).getByText('Archived category').closest('div')).toHaveTextContent('-$7.00');
  expect(within(summary).queryByText('Short-term goals')).not.toBeInTheDocument();
  expect(within(summary).queryByText('$9,999.99')).not.toBeInTheDocument();
  const progress = screen.getByRole('region', { name: 'Expenses by category' });
  expect(within(progress).getByText('Essentials').closest('li')).toHaveTextContent('Remaining: $65.00');
  expect(within(progress).getByText('Guilt free').closest('li')).toHaveTextContent('Remaining: -$10.00');
});

it('uses Arabic labels for remaining expense categories and keeps them in plan currency', async () => {
  const user = userEvent.setup();
  renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, fakeApi(), 'ar');
  const summary = await screen.findByRole('region', { name: 'المصروفات الشهرية' });
  const breakdown = within(summary).getByRole('region', { name: 'المتبقي حسب فئة المصروفات' });
  expect(within(breakdown).getByText('الأساسيات')).toBeInTheDocument();
  expect(within(breakdown).getByText('الإنفاق الحر')).toBeInTheDocument();
  expect(within(breakdown).queryByText('الأهداف قصيرة المدى')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'LBP' }));
  expect(within(summary).queryByRole('region', { name: 'المتبقي حسب فئة المصروفات' })).not.toBeInTheDocument();
});
