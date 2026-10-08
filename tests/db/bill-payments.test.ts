import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { setupSpace } from './support/budget.ts';
import { freshDatabase, type TestDatabase } from './support/database.ts';
let db: TestDatabase;
beforeAll(async () => { db = await freshDatabase(); });
afterAll(async () => { await db.close(); });

async function fixture() {
  const h = await setupSpace(db.pool);
  const item = await h.item('Bills');
  const wallet = await h.wallet('Bank', 'cash', 'USD', 20000n);
  await h.command('assign_money', { p_on: h.today, p_moves: [{ from: null, to: item, currency: 'USD', amountMinor: '10000' }] });
  const bill = (await h.command<{ billId: string }>('save_bill', { p_name: 'Water', p_item: item, p_amount: 6000n, p_currency: 'USD', p_cadence: 'once', p_first_due: h.today })).billId;
  const pay = (amount: bigint, linked = true) => h.command('record_expense', { p_wallet: wallet, p_item: item, p_amount: amount, p_on: h.today, ...(linked ? { p_bill: bill, p_bill_due: h.today } : {}) });
  const rows = () => h.call<any[]>('bills_upcoming', { p_space: h.spaceId, p_from: h.today, p_to: h.today });
  return { h, item, wallet, bill, pay, rows };
}
it('keeps partials payable, covers the remainder, and reopens reversed payments', async () => {
  const { h, bill, item, pay, rows } = await fixture();
  await h.command('assign_money', { p_on: h.today, p_moves: [{ from: item, to: null, currency: 'USD', amountMinor: '4000' }] });
  const first = await pay(2000n);
  expect((await rows())[0]).toMatchObject({ status: 'part_paid', paidAmount: '2000', remaining: '4000', overpaid: '0', paymentCount: 1, coverage: 'covered' });
  await h.command('skip_bill', { p_bill: bill, p_due: h.today });
  expect((await rows())[0].status).toBe('skipped');
  await h.command('unskip_bill', { p_bill: bill, p_due: h.today });
  expect((await rows())[0].status).toBe('part_paid');
  const latest = await pay(4500n);
  expect((await rows())[0]).toMatchObject({ status: 'paid', remaining: '0', overpaid: '500', paymentCount: 2, entryId: latest.entryId });
  await expect(h.command('move_bill_payment', { p_entry: latest.entryId, p_expected_version: 0, p_bill: bill, p_due: h.today })).resolves.toMatchObject({ linkVersion: 1 });
  await h.command('reverse_entry', { p_entry: first.entryId, p_reason: 'Wrong' });
  expect((await rows())[0]).toMatchObject({ status: 'part_paid', remaining: '1500', paidAmount: '4500', paymentCount: 1 });
});
it('relinks with events, leaves money/original links intact, and rejects stale requests', async () => {
  const { h, bill, pay, rows } = await fixture();
  const entry = await pay(2000n, false);
  const originalLines = await h.lines(entry.entryId);
  const request = randomUUID();
  const args = { p_entry: entry.entryId, p_expected_version: 0, p_bill: bill, p_due: h.today, p_request: request };
  const moved = await h.command('move_bill_payment', args);
  expect(moved).toEqual({ entryId: entry.entryId, billId: bill, dueOn: h.today, linkVersion: 1 });
  expect(await h.command('move_bill_payment', args)).toEqual(moved);
  await expect(h.command('move_bill_payment', { ...args, p_bill: null, p_due: null })).rejects.toMatchObject({ message: 'BUDGET_REQUEST_CONFLICT' });
  await expect(h.command('move_bill_payment', { ...args, p_request: randomUUID() })).rejects.toMatchObject({ message: 'BUDGET_BILL_LINK_CHANGED' });
  expect((await rows())[0]).toMatchObject({ paidAmount: '2000', paymentCount: 1 });
  await h.command('move_bill_payment', { p_entry: entry.entryId, p_expected_version: 1 });
  expect((await rows())[0]).toMatchObject({ status: 'due', paymentCount: 0 });
  expect(await h.lines(entry.entryId)).toEqual(originalLines);
  const raw = await db.pool.query('select bill_id from budget.entries where id=$1', [entry.entryId]);
  expect(raw.rows[0].bill_id).toBeNull();
  const json = await db.pool.query('select budget.entry_json($1) as value', [entry.entryId]);
  expect(json.rows[0].value).toMatchObject({ billId: null, billLinkVersion: 2, billLinkHistory: [{ billId: bill, dueOn: h.today }, { billId: null, dueOn: null }] });
  await expect(db.pool.query('update budget.bill_payment_links set bill_id=null')).rejects.toMatchObject({ message: 'BUDGET_APPEND_ONLY' });
});
it('refuses mismatched, invalid, skipped, paid, reversed and foreign corrections', async () => {
  const { h, bill, pay } = await fixture();
  const entry = await pay(2000n, false);
  const move = (extra: Record<string, unknown>) => h.command('move_bill_payment', { p_entry: entry.entryId, p_expected_version: 0, p_bill: bill, p_due: h.today, ...extra });
  const other = (await h.command<{ billId: string }>('save_bill', { p_name: 'Food', p_item: await h.item('Groceries'), p_amount: 6000n, p_currency: 'USD', p_cadence: 'once', p_first_due: h.today })).billId;
  await expect(move({ p_bill: other })).rejects.toMatchObject({ message: 'BUDGET_BILL_MISMATCH' });
  const lbpBill = (await h.command<{ billId: string }>('save_bill', { p_name: 'LBP', p_item: await h.item('Bills'), p_amount: 6000n, p_currency: 'LBP', p_cadence: 'once', p_first_due: h.today })).billId;
  await expect(move({ p_bill: lbpBill })).rejects.toMatchObject({ message: 'BUDGET_BILL_MISMATCH' });
  await expect(move({ p_due: '2000-01-01' })).rejects.toMatchObject({ message: 'BUDGET_BILL_NOT_DUE' });
  await h.command('skip_bill', { p_bill: bill, p_due: h.today });
  await expect(move({})).rejects.toMatchObject({ message: 'BUDGET_BILL_SKIPPED' });
  await h.command('unskip_bill', { p_bill: bill, p_due: h.today });
  await pay(6000n);
  await expect(move({})).rejects.toMatchObject({ message: 'BUDGET_BILL_ALREADY_PAID' });
  const stranger = await setupSpace(db.pool);
  await expect(stranger.command('move_bill_payment', { p_space: h.spaceId, p_entry: entry.entryId, p_expected_version: 0 })).rejects.toMatchObject({ message: 'BUDGET_NOT_MEMBER' });
  await h.command('reverse_entry', { p_entry: entry.entryId, p_reason: 'Wrong' });
  await expect(move({ p_bill: null, p_due: null })).rejects.toMatchObject({ message: 'BUDGET_CANNOT_REVERSE' });
});
it('totals loan principal, interest and fees and enforces the exact loan wallet', async () => {
  const { h, bill, item, wallet, rows } = await fixture();
  const loan = await h.wallet('Loan', 'loan', 'USD', 10000n, { p_loan_direction: 'i_owe' });
  await h.command('save_bill', { p_bill: bill, p_name: 'Loan bill', p_item: item, p_amount: 6000n, p_currency: 'USD', p_cadence: 'once', p_first_due: h.today, p_loan: loan });
  const entry = await h.command('record_loan', { p_action: 'repay', p_loan: loan, p_cash: wallet, p_item: item, p_on: h.today, p_principal: 1500n, p_interest: 300n, p_fee: 200n, p_bill: bill, p_bill_due: h.today });
  expect((await rows())[0]).toMatchObject({ paidAmount: '2000', remaining: '4000', status: 'part_paid' });
  const otherLoan = await h.wallet('Other loan', 'loan', 'USD', 10000n, { p_loan_direction: 'i_owe' });
  const otherBill = (await h.command<{ billId: string }>('save_bill', { p_name: 'Other', p_item: item, p_amount: 6000n, p_currency: 'USD', p_cadence: 'once', p_first_due: h.today, p_loan: otherLoan })).billId;
  await expect(h.command('move_bill_payment', { p_entry: entry.entryId, p_expected_version: 0, p_bill: otherBill, p_due: h.today })).rejects.toMatchObject({ message: 'BUDGET_BILL_MISMATCH' });
});
it('serializes concurrent corrections to the same link version', async () => {
  const { h, bill, pay } = await fixture();
  const entry = await pay(2000n, false);
  const results = await Promise.allSettled([0, 1].map(() => h.command('move_bill_payment', { p_entry: entry.entryId, p_expected_version: 0, p_bill: bill, p_due: h.today })));
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { message: 'BUDGET_BILL_LINK_CHANGED' } });
});
it('detaches and reattaches an originally linked fee-only loan payment', async () => {
  const { h, bill, item, wallet, rows } = await fixture();
  const loan = await h.wallet('Loan', 'loan', 'USD', 10000n, { p_loan_direction: 'i_owe' });
  await h.command('save_bill', { p_bill: bill, p_name: 'Loan bill', p_item: item, p_amount: 6000n, p_currency: 'USD', p_cadence: 'once', p_first_due: h.today, p_loan: loan });
  const entry = await h.command('record_loan', { p_action: 'repay', p_loan: loan, p_cash: wallet, p_item: item, p_on: h.today, p_principal: 0n, p_interest: 300n, p_fee: 200n, p_bill: bill, p_bill_due: h.today });
  await h.command('move_bill_payment', { p_entry: entry.entryId, p_expected_version: 0 });
  expect((await rows())[0].paidAmount).toBe('0');
  const json = await db.pool.query('select budget.entry_json($1) as value', [entry.entryId]);
  expect(json.rows[0].value.billPaymentLoanWalletId).toBe(loan);
  await h.command('move_bill_payment', { p_entry: entry.entryId, p_expected_version: 1, p_bill: bill, p_due: h.today });
  expect((await rows())[0]).toMatchObject({ paidAmount: '500', remaining: '5500', paymentCount: 1 });
});
it('keeps the payment item identity when another item covered its shortfall', async () => {
  const { h, bill, item, wallet } = await fixture();
  const groceries = await h.item('Groceries');
  await h.command('assign_money', { p_on: h.today, p_moves: [{ from: item, to: groceries, currency: 'USD', amountMinor: '10000' }] });
  const entry = await h.command('record_expense', { p_wallet: wallet, p_item: item, p_amount: 2000n, p_on: h.today, p_bill: bill, p_bill_due: h.today, p_cover_from: groceries });
  await h.command('move_bill_payment', { p_entry: entry.entryId, p_expected_version: 0 });
  await expect(h.command('move_bill_payment', { p_entry: entry.entryId, p_expected_version: 1, p_bill: bill, p_due: h.today })).resolves.toHaveProperty('linkVersion', 2);
});
it('shows covered overdue partials in overview with their remaining amount', async () => {
  const { h, bill, item, wallet } = await fixture();
  const yesterday = new Date(`${h.today}T12:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate()-1);
  const due = yesterday.toISOString().slice(0,10);
  await h.command('save_bill', { p_bill: bill, p_name: 'Past water', p_item: item, p_amount: 6000n, p_currency: 'USD', p_cadence: 'once', p_first_due: due });
  await h.command('record_expense', { p_wallet: wallet, p_item: item, p_amount: 2000n, p_on: h.today, p_bill: bill, p_bill_due: due });
  const overview = await h.call<{ alerts: any[] }>('space_overview', { p_space: h.spaceId });
  expect(overview.alerts).toContainEqual(expect.objectContaining({ kind: 'bill_overdue', billId: bill, amount: '4000' }));
});
it('retains fee-only loan identity after editing the original bill loan', async () => {
  const { h, bill, item, wallet } = await fixture();
  const originalLoan = await h.wallet('Original loan', 'loan', 'USD', 10000n, { p_loan_direction: 'i_owe' });
  const otherLoan = await h.wallet('Other loan', 'loan', 'USD', 10000n, { p_loan_direction: 'i_owe' });
  const save = (loan: string) => h.command('save_bill', { p_bill: bill, p_name: 'Loan bill', p_item: item, p_amount: 6000n, p_currency: 'USD', p_cadence: 'once', p_first_due: h.today, p_loan: loan });
  await save(originalLoan);
  const entry = await h.command('record_loan', { p_action: 'repay', p_loan: originalLoan, p_cash: wallet, p_item: item, p_on: h.today, p_principal: 0n, p_interest: 300n, p_fee: 200n, p_bill: bill, p_bill_due: h.today });
  await save(otherLoan);
  await h.command('move_bill_payment', { p_entry: entry.entryId, p_expected_version: 0 });
  const json = await db.pool.query('select budget.entry_json($1) as value', [entry.entryId]);
  expect(json.rows[0].value.billPaymentLoanWalletId).toBe(originalLoan);
  await expect(h.command('move_bill_payment', { p_entry: entry.entryId, p_expected_version: 1, p_bill: bill, p_due: h.today })).rejects.toMatchObject({ message: 'BUDGET_BILL_MISMATCH' });
  await save(originalLoan);
  await expect(h.command('move_bill_payment', { p_entry: entry.entryId, p_expected_version: 1, p_bill: bill, p_due: h.today })).resolves.toHaveProperty('linkVersion', 2);
});
it('completes exactly 20 plus 40 and reopens the correct balance when each payment is reversed', async () => {
  for (const reverseFirst of [true, false]) {
    const { h, pay, rows } = await fixture();
    const first = await pay(2000n);
    expect((await rows())[0]).toMatchObject({ status: 'part_paid', paidAmount: '2000', remaining: '4000', paymentCount: 1 });
    const second = await pay(4000n);
    expect((await rows())[0]).toMatchObject({ status: 'paid', paidAmount: '6000', remaining: '0', overpaid: '0', paymentCount: 2 });
    await h.command('reverse_entry', { p_entry: reverseFirst ? first.entryId : second.entryId, p_reason: 'Wrong payment' });
    expect((await rows())[0]).toMatchObject({ status: 'part_paid', paidAmount: reverseFirst ? '4000' : '2000', remaining: reverseFirst ? '2000' : '4000', paymentCount: 1 });
  }
});
it('moves a payment between occurrences and reversal reopens its effective destination', async () => {
  const { h, bill, item, pay } = await fixture();
  const date = new Date(`${h.today}T12:00:00Z`); date.setUTCFullYear(date.getUTCFullYear()+1);
  const nextDue = date.toISOString().slice(0,10);
  await h.command('save_bill', { p_bill: bill, p_name: 'Annual water', p_item: item, p_amount: 6000n, p_currency: 'USD', p_cadence: 'yearly', p_first_due: h.today });
  const first = await pay(2000n);
  const second = await pay(4000n);
  await h.command('move_bill_payment', { p_entry: first.entryId, p_expected_version: 0, p_bill: bill, p_due: nextDue });
  const rows = () => h.call<any[]>('bills_upcoming', { p_space: h.spaceId, p_from: h.today, p_to: nextDue });
  expect((await rows()).find(row => row.dueOn===h.today)).toMatchObject({ status: 'part_paid', paidAmount: '4000', remaining: '2000', paymentCount: 1, entryId: second.entryId });
  expect((await rows()).find(row => row.dueOn===nextDue)).toMatchObject({ status: 'part_paid', paidAmount: '2000', remaining: '4000', paymentCount: 1, entryId: first.entryId });
  await h.command('reverse_entry', { p_entry: first.entryId, p_reason: 'Reverse moved payment' });
  expect((await rows()).find(row => row.dueOn===h.today)).toMatchObject({ status: 'part_paid', paidAmount: '4000', remaining: '2000', paymentCount: 1 });
  expect((await rows()).find(row => row.dueOn===nextDue)).toMatchObject({ status: 'due', paidAmount: '0', remaining: '6000', paymentCount: 0, entryId: null });
});
it('keeps recurring overpayment on its occurrence without carrying credit forward', async () => {
  const { h, bill, item, pay } = await fixture();
  const date = new Date(`${h.today}T12:00:00Z`); date.setUTCFullYear(date.getUTCFullYear()+1);
  const nextDue = date.toISOString().slice(0,10);
  await h.command('save_bill', { p_bill: bill, p_name: 'Annual water', p_item: item, p_amount: 6000n, p_currency: 'USD', p_cadence: 'yearly', p_first_due: h.today });
  await pay(8000n);
  const rows = await h.call<any[]>('bills_upcoming', { p_space: h.spaceId, p_from: h.today, p_to: nextDue });
  expect(rows.find(row => row.dueOn===h.today)).toMatchObject({ status: 'paid', paidAmount: '8000', remaining: '0', overpaid: '2000', paymentCount: 1 });
  expect(rows.find(row => row.dueOn===nextDue)).toMatchObject({ status: 'due', paidAmount: '0', remaining: '6000', overpaid: '0', paymentCount: 0 });
});
