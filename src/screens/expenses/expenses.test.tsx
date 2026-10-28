import { screen, within } from '@testing-library/react';
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
  expect(await screen.findByRole('heading', { level: 1, name: 'Expenses by category' })).toBeInTheDocument();
  expect(screen.getByText('Active month · October 2026')).toBeInTheDocument();
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
  expect(await screen.findByText('No expenses recorded for this month.')).toBeInTheDocument();
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
  expect(screen.getByRole('heading', { level: 1, name: 'المصروفات حسب الفئة' })).toBeInTheDocument();
  expect(screen.getByText('البقالة')).toBeInTheDocument();
});
