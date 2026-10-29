import { fireEvent, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { Entry } from '../../api/schemas.ts';
import { Routes } from '../../app/app.tsx';
import { fakeApi, fixtures, renderWithWorkspace, space } from '../../test/harness.tsx';

function entry(id: string, amount: bigint, overrides: Partial<Entry['items'][number]> = {}, on = space().today): Entry {
  const base = fixtures.activity.entries[0]!;
  return { ...base, entryId: id, occurredOn: on, items: [{ ...base.items[0]!, amount, ...overrides }] };
}

function renderExpenses(api = fakeApi(), locale: 'en' | 'ar' = 'en') {
  window.location.hash = '#/expenses';
  return renderWithWorkspace(<Routes space={space()} spaces={fixtures.spaces} onSelectSpace={vi.fn()} onToggleLocale={vi.fn()} onSignOut={vi.fn()} />, api, locale);
}

afterEach(() => { window.location.hash = ''; });

it('opens the category totals screen for the active budget month', async () => {
  const api = fakeApi({ activity: async () => ({ entries: [entry('purchase', -2500n)], next: null }) });
  renderExpenses(api);
  expect(await screen.findByRole('heading', { level: 1, name: 'Spending report' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Period' })).toHaveValue('thisMonth');
  expect(screen.getByText('Oct 1, 2026 – Oct 3, 2026')).toBeInTheDocument();
  const totals = await screen.findByRole('table', { name: 'Category totals' });
  expect(within(totals).getByRole('row', { name: /Groceries.*\$25.00.*100%/ })).toBeInTheDocument();
  expect(api.activity).toHaveBeenCalledWith(space().id, expect.objectContaining({ filter: { month: space().currentMonth } }));
});

it('includes every page, refunds, and corrections without counting allocations or other months', async () => {
  const cursor = { id: 'page-two', createdAt: '2026-10-03T10:00:00Z', occurredOn: space().today };
  const api = fakeApi();
  api.activity.mockImplementation(async (_id, options) => options?.before ? {
    entries: [entry('refund', 500n, { flow: 'refund' }), entry('reversal', 1000n)], next: null,
  } : {
    entries: [entry('purchase', -5000n), entry('allocation', -90000n, { flow: 'fund' }), entry('previous-month', -70000n, {}, '2026-09-30'), entry('future', -70000n, {}, '2026-11-01')], next: cursor,
  });
  renderExpenses(api);
  const totals = await screen.findByRole('table', { name: 'Category totals' });
  expect(within(totals).getByRole('row', { name: /Groceries.*\$35.00/ })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Total expenses' })).toHaveTextContent('$35.00');
  expect(api.activity).toHaveBeenCalledTimes(2);
});

it('keeps currencies separate and orders categories by spending', async () => {
  renderExpenses(fakeApi({ activity: async () => ({ entries: [
    entry('groceries', -2500n), entry('dining', -7500n, { itemId: 'dining', nameEn: 'Eating out', nameAr: 'الأكل خارج المنزل' }),
    entry('lbp', -250000n, { currency: 'LBP' }),
  ], next: null }) }));
  const totals = await screen.findByRole('table', { name: 'Category totals' });
  const rows = within(totals).getAllByRole('row');
  expect(rows[1]).toHaveTextContent('Eating out');
  expect(rows[1]).toHaveTextContent('$75.00');
  expect(rows[1]).toHaveTextContent('75%');
  expect(rows[2]).toHaveTextContent('25%');
  await userEvent.click(screen.getByRole('button', { name: 'LBP' }));
  expect(screen.getByRole('region', { name: 'Total expenses' })).toHaveTextContent('LBP 250,000');
  expect(within(totals).queryByText('Eating out')).not.toBeInTheDocument();
});

it('shows refund-only categories without negative shares', async () => {
  renderExpenses(fakeApi({ activity: async () => ({ entries: [entry('refund', 1500n, { flow: 'refund' })], next: null }) }));
  const totals = await screen.findByRole('table', { name: 'Category totals' });
  expect(within(totals).getByText('Net refunds')).toBeInTheDocument();
  expect(within(totals).getByText('—')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Total expenses' })).toHaveTextContent('-$15.00');
});

it('offers an expense action when the active month has no spending', async () => {
  renderExpenses(fakeApi({ activity: async () => ({ entries: [], next: null }) }));
  expect(await screen.findByText('No expenses in this period.')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Total expenses' })).toHaveTextContent('$0.00');
  expect(screen.getByRole('button', { name: 'Record an expense' })).toBeInTheDocument();
});

it('retries a failed monthly total and translates the screen into Arabic', async () => {
  const api = fakeApi();
  api.activity.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ entries: [entry('purchase', -2500n)], next: null });
  renderExpenses(api, 'ar');
  await userEvent.click(await screen.findByRole('button', { name: 'أعد المحاولة' }));
  const totals = await screen.findByRole('table', { name: 'الإجمالي حسب الفئة' });
  expect(within(totals).getByText(/١٠٠/)).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: 'تقرير الإنفاق' })).toBeInTheDocument();
  expect(screen.getAllByText('البقالة').length).toBeGreaterThan(0);
});

it('keeps both currency totals visible while switching the breakdown currency', async () => {
  renderExpenses(fakeApi({ activity: async () => ({ entries: [entry('usd', -5000n), entry('lbp', -250000n, { currency: 'LBP' })], next: null }) }));
  const total = await screen.findByRole('region', { name: 'Total expenses' });
  expect(total).toHaveTextContent('$50.00');
  expect(total).toHaveTextContent('LBP 250,000');
  await userEvent.click(screen.getByRole('button', { name: 'LBP' }));
  expect(total).toHaveTextContent('$50.00');
  expect(total).toHaveTextContent('LBP 250,000');
});

it('applies an inclusive custom range across months to totals and transaction details', async () => {
  const api = fakeApi();
  api.activity.mockImplementation(async (_space, options) => ({ entries: options?.filter?.['month'] === '2026-09-01'
    ? [entry('start', -1000n, {}, '2026-09-30'), entry('outside', -90000n, {}, '2026-09-29')]
    : [entry('end', -2000n, {}, '2026-10-03')], next: null }));
  renderExpenses(api);
  await screen.findByRole('table', { name: 'Category totals' });
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Period' }), 'custom');
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-30' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-03' } });
  await userEvent.click(screen.getByRole('button', { name: 'Apply dates' }));
  const total = await screen.findByRole('region', { name: 'Total expenses' });
  expect(total).toHaveTextContent('$30.00');
  expect(screen.getByText('Sep 30, 2026 – Oct 3, 2026')).toBeInTheDocument();
  const transactions = screen.getByRole('region', { name: 'Transactions' });
  expect(within(transactions).getAllByRole('listitem')).toHaveLength(2);
});

it('validates custom dates before changing the applied report', async () => {
  const api = fakeApi();
  renderExpenses(api);
  await screen.findByRole('table', { name: 'Category totals' });
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Period' }), 'custom');
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-03' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-01' } });
  const calls = api.activity.mock.calls.length;
  await userEvent.click(screen.getByRole('button', { name: 'Apply dates' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose valid dates, with From on or before To and no dates after today.');
  expect(api.activity).toHaveBeenCalledTimes(calls);
  expect(screen.getByText('Oct 1, 2026 – Oct 3, 2026')).toBeInTheDocument();
});

it('browses previous months and prevents advancing beyond the current month', async () => {
  const api = fakeApi();
  renderExpenses(api);
  await screen.findByRole('table', { name: 'Category totals' });
  expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
  expect(screen.getByText('Sep 1, 2026 – Sep 30, 2026')).toBeInTheDocument();
  await screen.findByText('No expenses in this period.');
  expect(api.activity).toHaveBeenCalledWith(space().id, expect.objectContaining({ filter: { month: '2026-09-01' } }));
});

it('drills into a category, opens its source entry, and restores all categories', async () => {
  renderExpenses(fakeApi({ activity: async () => ({ entries: [entry('groceries', -2500n),
    { ...entry('dining', -5000n, { itemId: 'dining', nameEn: 'Eating out' }), memo: 'Restaurant' }], next: null }) }));
  const totals = await screen.findByRole('table', { name: 'Category totals' });
  await userEvent.click(within(totals).getByRole('button', { name: 'View transactions: Groceries' }));
  const transactions = screen.getByRole('region', { name: 'Transactions' });
  expect(within(transactions).getAllByRole('listitem')).toHaveLength(1);
  expect(within(transactions).queryByText('Restaurant')).not.toBeInTheDocument();
  await userEvent.click(within(transactions).getByRole('button', { name: /Supermarket/ }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Supermarket');
  await userEvent.keyboard('{Escape}');
  await userEvent.click(screen.getByRole('button', { name: 'All categories' }));
  expect(within(transactions).getAllByRole('listitem')).toHaveLength(2);
});

it('offers groups that expand into their categories and scoped transactions', async () => {
  const group = fixtures.plan.groups[0]!;
  const item = group.items[0]!;
  renderExpenses(fakeApi({ activity: async () => ({ entries: [entry('group-purchase', -2500n, { itemId: item.itemId,
    nameEn: item.nameEn, groupId: group.groupId, groupNameEn: group.nameEn, groupNameAr: group.nameAr })], next: null }) }));
  await screen.findByRole('table', { name: 'Category totals' });
  await userEvent.selectOptions(screen.getByLabelText('View by'), 'groups');
  const summary = screen.getByText(group.nameEn!).closest('summary')!;
  await userEvent.click(summary);
  await userEvent.click(screen.getByRole('button', { name: `View transactions: ${item.nameEn}` }));
  expect(within(screen.getByRole('region', { name: 'Transactions' })).getAllByRole('listitem')).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'LBP' }));
  expect(screen.getByLabelText('View by')).toHaveValue('groups');
});

it('keeps complete totals when the transaction register displays only its first page', async () => {
  renderExpenses(fakeApi({ activity: async () => ({ entries: Array.from({ length: 35 }, (_, index) => entry(`purchase-${index}`, -100n)), next: null }) }));
  const total = await screen.findByRole('region', { name: 'Total expenses' });
  const transactions = screen.getByRole('region', { name: 'Transactions' });
  expect(total).toHaveTextContent('$35.00');
  expect(within(transactions).getAllByRole('listitem')).toHaveLength(30);
  await userEvent.click(screen.getByRole('button', { name: 'Show more transactions' }));
  expect(within(transactions).getAllByRole('listitem')).toHaveLength(35);
  expect(total).toHaveTextContent('$35.00');
});

it('shows investment fees without a plan category and opens their original records', async () => {
  const base = entry('broker-fee', 0n);
  const fee: Entry = { ...base, kind: 'invest_fee', memo: 'Broker charge', items: [], wallets: [{ ...base.wallets[0]!, kind: 'investment', flow: 'fee', amount: -350n }] };
  renderExpenses(fakeApi({ activity: async () => ({ entries: [fee], next: null }) }));
  const total = await screen.findByRole('region', { name: 'Total expenses' });
  expect(total).toHaveTextContent('$3.50');
  await userEvent.click(screen.getByRole('button', { name: 'View transactions: Investment fees' }));
  const transactions = screen.getByRole('region', { name: 'Transactions' });
  await userEvent.click(within(transactions).getByRole('button', { name: /Broker charge/ }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Broker charge');
});
