import { BudgetError } from '../api/budget-api.ts';
import { ActivityScreen, EntryDetail } from './activity/activity.tsx';
import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, fixtures, renderWithWorkspace } from '../test/harness.tsx';
import { BillsSection } from './plan/bills-section.tsx';
import { HomeScreen } from './home/home.tsx';

const occurrence = { ...fixtures.bills[0]!, status: 'part_paid' as const, expected: 6000n, paidAmount: 2000n, remaining: 4000n, overpaid: 0n, paymentCount: 1 };
const bill = { billId: occurrence.billId, name: occurrence.name, itemId: occurrence.itemId, amount: 6000n, currency: occurrence.currency, cadence: occurrence.cadence, firstDueOn: occurrence.dueOn, endOn: null, loanWalletId: occurrence.loanWalletId };

it.each(['home', 'plan'])('%s keeps a partial bill payable for only its remaining amount', async (view) => {
  const record = vi.fn();
  const api = fakeApi({ billsUpcoming: async () => [occurrence], billsList: async () => [bill] });
  renderWithWorkspace(view === 'home' ? <HomeScreen onRecord={record} /> : <BillsSection onRecord={record} />, api);
  const row = (await screen.findByText(occurrence.name)).closest('li')!;
  expect(within(row).getByText(/Part paid/)).toBeInTheDocument();
  expect(row).toHaveTextContent('$20.00');
  expect(row).toHaveTextContent('$40.00');
  await userEvent.setup().click(within(row).getByRole('button', { name: 'Pay' }));
  expect(record).toHaveBeenCalledWith(expect.objectContaining({ bill: expect.objectContaining({ amount: 4000n }) }));
});


const payment = { ...fixtures.activity.entries[0]!, billId: occurrence.billId, billName: occurrence.name, billDueOn: occurrence.dueOn, billLinkVersion: 3, billLinkHistory: [], items: [{ ...fixtures.activity.entries[0]!.items[0]!, itemId: occurrence.itemId, currency: occurrence.currency }] };
const target = { ...occurrence, billId: 'target-bill', name: 'Other bill', paidAmount: 0n, status: 'due' as const };

it('moves a payment using its current link version, then refreshes and closes', async () => {
  const done = vi.fn();
  const api = fakeApi({ billsUpcoming: async () => [target, { ...target, billId: 'wrong', name: 'Wrong purpose', itemId: 'other-item' }], moveBillPayment: async () => ({ entryId: payment.entryId, billId: target.billId, dueOn: target.dueOn, linkVersion: 4 }) });
  renderWithWorkspace(<EntryDetail entry={payment} onClose={done} onCorrect={vi.fn()} canCorrect />, api);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Move bill payment' }));
  const select = await screen.findByRole('combobox', { name: 'Move to bill' });
  expect(within(select).queryByRole('option', { name: /Wrong purpose/ })).not.toBeInTheDocument();
  await user.selectOptions(select, 'target-bill');
  await user.click(screen.getByRole('button', { name: 'Move bill payment' }));
  expect(api.moveBillPayment).toHaveBeenCalledWith(expect.objectContaining({ entryId: payment.entryId, expectedVersion: 3, billId: target.billId, due: target.dueOn }));
  expect(done).toHaveBeenCalled();
});

it('detaches a bill payment without correcting the money entry', async () => {
  const api = fakeApi({ moveBillPayment: async () => ({ entryId: payment.entryId, billId: null, dueOn: null, linkVersion: 4 }) });
  renderWithWorkspace(<EntryDetail entry={payment} onClose={vi.fn()} onCorrect={vi.fn()} canCorrect />, api);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Move bill payment' }));
  await user.click(screen.getByRole('button', { name: 'Detach from bill' }));
  expect(api.moveBillPayment).toHaveBeenCalledWith(expect.objectContaining({ billId: null, due: null, expectedVersion: 3 }));
  expect(api.reverseEntry).not.toHaveBeenCalled();
});

it.each(['en', 'ar'] as const)('shows payment history with isolated amounts in %s', async (locale) => {
  const entry = { ...payment, billId: null, billName: null, billDueOn: null, billLinkHistory: [{ billId: target.billId, billName: target.name, dueOn: target.dueOn, createdAt: '2026-10-08T08:00:00Z' }, { billId: null, billName: null, dueOn: null, createdAt: '2026-10-08T09:00:00Z' }] };
  renderWithWorkspace(<EntryDetail entry={entry} onClose={vi.fn()} onCorrect={vi.fn()} canCorrect />, fakeApi(), locale);
  const history = screen.getByRole('region', { name: locale === 'en' ? 'Bill payment history' : 'سجل دفعة الفاتورة' });
  expect(history).toHaveTextContent(target.name);
  expect(history).toHaveTextContent(locale === 'en' ? 'Detached from bill' : 'مفصولة عن الفاتورة');
  expect(screen.getByRole('dialog').querySelectorAll('bdi.cr-amount[dir="ltr"]').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: locale === 'en' ? 'Move bill payment' : 'نقل دفعة الفاتورة' })).toBeEnabled();
});

it('never offers bill-link changes for a reversed payment', () => {
  renderWithWorkspace(<EntryDetail entry={{ ...payment, reversedByEntryId: 'reversal' }} onClose={vi.fn()} onCorrect={vi.fn()} canCorrect={false} />, fakeApi());
  expect(screen.queryByRole('button', { name: 'Move bill payment' })).not.toBeInTheDocument();
});

it('keeps dialog dismissal disabled while detaching', async () => {
  let finish!: () => void;
  const close = vi.fn();
  const api = fakeApi({ moveBillPayment: async () => { await new Promise<void>((resolve) => { finish = resolve; }); return { entryId: payment.entryId, billId: null, dueOn: null, linkVersion: 4 }; } });
  renderWithWorkspace(<EntryDetail entry={payment} onClose={close} onCorrect={vi.fn()} canCorrect />, api);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Move bill payment' }));
  await user.click(screen.getByRole('button', { name: 'Detach from bill' }));
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  finish();
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
});

it('shows excess for a paid recurring occurrence even when the next is unpaid', async () => {
  const paid = { ...occurrence, status: 'paid' as const, paidAmount: 7000n, remaining: 0n, overpaid: 1000n };
  const next = { ...target, billId: bill.billId, name: bill.name, dueOn: '2026-11-20', expected: 6000n, remaining: 6000n };
  renderWithWorkspace(<BillsSection onRecord={vi.fn()} />, fakeApi({ billsList: async () => [bill], billsUpcoming: async () => [paid, next] }));
  const row = (await screen.findByText(bill.name)).closest('li')!;
  expect(row).toHaveTextContent('Excess payment $10.00');
  expect(row).toHaveTextContent('$60.00');
});

it.each(['en', 'ar'] as const)('isolates partial paid and remaining amounts in %s', async (locale) => {
  renderWithWorkspace(<BillsSection onRecord={vi.fn()} />, fakeApi({ billsList: async () => [bill], billsUpcoming: async () => [occurrence] }), locale);
  const row = (await screen.findByText(bill.name)).closest('li')!;
  expect(row).toHaveTextContent(locale === 'en' ? 'Part paid' : 'مدفوعة جزئيًا');
  expect(row.querySelectorAll('bdi.cr-amount[dir="ltr"]').length).toBe(3);
});

it('offers only the original loan for fee-only bill payments after detach', async () => {
  const entry = { ...payment, kind: 'loan_repay' as const, billId: null, billDueOn: null, billPaymentLoanWalletId: 'loan-a', items: [{ ...payment.items[0]!, flow: 'fee' as const }] };
  renderWithWorkspace(<EntryDetail entry={entry} onClose={vi.fn()} onCorrect={vi.fn()} canCorrect />, fakeApi({ billsUpcoming: async () => [{ ...target, dueOn: fixtures.spaces[0]!.today, loanWalletId: 'loan-a' }, { ...target, billId: 'b', name: 'Wrong loan', dueOn: fixtures.spaces[0]!.today, loanWalletId: 'loan-b' }] }));
  await userEvent.setup().click(screen.getByRole('button', { name: 'Move bill payment' }));
  const select = await screen.findByRole('combobox', { name: 'Move to bill' });
  await screen.findByRole('option', { name: /Other bill/ });
  expect(within(select).queryByRole('option', { name: /Wrong loan/ })).not.toBeInTheDocument();
});

it.each(['BUDGET_BILL_LINK_CHANGED', 'NETWORK'])('reopening after %s uses the current link version', async (code) => {
  let current = payment;
  let calls = 0;
  const api = fakeApi({
    activity: async () => ({ entries: [current], next: null }),
    moveBillPayment: async () => {
      if (calls++ === 0) { current = { ...payment, billLinkVersion: 4 }; throw new BudgetError(code); }
      return { entryId: payment.entryId, billId: null, dueOn: null, linkVersion: 5 };
    },
  });
  renderWithWorkspace(<ActivityScreen onRecord={vi.fn()} />, api);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: new RegExp(payment.billName!) }));
  await user.click(screen.getByRole('button', { name: 'Move bill payment' }));
  await user.click(screen.getByRole('button', { name: 'Detach from bill' }));
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: 'Close' }));
  await vi.waitFor(() => expect(api.activity.mock.calls.length).toBeGreaterThan(1));
  await user.click(await screen.findByRole('button', { name: new RegExp(payment.billName!) }));
  await user.click(screen.getByRole('button', { name: 'Move bill payment' }));
  await user.click(screen.getByRole('button', { name: 'Detach from bill' }));
  expect(api.moveBillPayment.mock.calls[1]?.[0]).toMatchObject({ expectedVersion: 4 });
});
