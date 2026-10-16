import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { setupSpace } from './support/budget.ts';
import { asAnon, callAs, createUser, rpc } from './support/actor.ts';
import { freshDatabase, type TestDatabase } from './support/database.ts';
import { currentPlan, monthOf } from './support/plan.ts';

let db: TestDatabase;
beforeAll(async () => { db = await freshDatabase(); });
afterAll(async () => { await db.close(); });
type Plan = { stillToFund: string; categoryShortfall: string; groups: { nameEn: string; purpose: string; items: { stillToFund: string }[]; flex: { stillToFund: string; available: string; broughtForward: string; funded: string } }[] };

it('persists group purpose independently of its name and preserves it for older clients', async () => {
  const h = await setupSpace(db.pool);
  const month = monthOf(h.today);
  let plan = await h.call<Plan>('plan_month', { p_space: h.spaceId, p_month: month });
  expect(plan.groups.map(g => g.purpose)).toEqual(['expense', 'expense', 'savings', 'savings', 'savings']);
  const { revision, payload } = await currentPlan(db.pool, h.spaceId, month);
  payload.groups.find(g => g.nameEn === 'Savings')!.nameEn = 'My future';
  await h.command('save_plan', { p_month: month, p_expected_revision: revision, p_plan: payload });
  plan = await h.call<Plan>('plan_month', { p_space: h.spaceId, p_month: month });
  expect(plan.groups.find(g => g.nameEn === 'My future')!.purpose).toBe('savings');
});

it('keeps an underfunded item visible despite excess funding elsewhere, and carries savings forward', async () => {
  const h = await setupSpace(db.pool, { income: 100000n });
  await h.wallet('Cash', 'cash', 'USD', 200000n);
  await h.command('assign_money', { p_on: h.today, p_moves: [
    { from: null, to: await h.item('Other essentials'), currency: 'USD', amountMinor: '100000' },
    { from: null, to: await h.item('General savings'), currency: 'USD', amountMinor: '3000' },
  ] });
  const plan = await h.call<Plan>('plan_month', { p_space: h.spaceId, p_month: monthOf(h.today) });
  // Monthly progress and individual category targets answer different questions.
  expect(plan.groups.find(g => g.nameEn === 'Savings')!.flex.stillToFund).toBe('7000');
  expect(plan.stillToFund).toBe('0');
  expect(BigInt(plan.categoryShortfall)).toBe(plan.groups.reduce((n, g) => n + [...g.items, g.flex].reduce((s, i) => s + BigInt(i.stillToFund), 0n), 0n));
  const next = await h.call<Plan>('plan_month', { p_space: h.spaceId, p_month: monthOf(h.today, 1) });
  expect(next.groups.find(g => g.nameEn === 'Savings')!.flex).toMatchObject({ broughtForward: '3000', funded: '0', available: '3000' });
});

it('pays entirely from savings while recording the purchase category, atomically and reversibly', async () => {
  const h = await setupSpace(db.pool);
  const wallet = await h.wallet('Cash', 'cash', 'USD', 10000n);
  const savings = await h.item('General savings');
  const groceries = await h.item('Groceries');
  await h.command('assign_money', { p_on: h.today, p_moves: [
    { from: null, to: savings, currency: 'USD', amountMinor: '3000' },
    { from: null, to: groceries, currency: 'USD', amountMinor: '1000' },
  ] });
  const result = await h.command<{ entryId: string }>('record_expense_from', { p_wallet: wallet, p_item: groceries,
    p_source: savings, p_amount: '2000', p_on: h.today, p_memo: 'Food from savings' });
  expect(await h.itemBalance('General savings')).toBe(1000n);
  expect(await h.itemBalance('Groceries')).toBe(1000n);
  expect(await h.walletBalance(wallet)).toBe(8000n);
  const statement = await h.call<{ statement: { spent: string }[] }>('item_statement', { p_space: h.spaceId, p_item: groceries, p_month: monthOf(h.today) });
  expect(statement.statement[0]!.spent).toBe('2000');
  const count = await h.entryCount();
  await expect(h.command('record_expense_from', { p_wallet: wallet, p_item: groceries, p_source: savings,
    p_amount: '5000', p_on: h.today })).rejects.toThrow('BUDGET_INSUFFICIENT_ITEM');
  expect(await h.entryCount()).toBe(count);
  await h.command('reverse_entry', { p_entry: result.entryId, p_reason: 'Correction' });
  expect(await h.itemBalance('General savings')).toBe(3000n);
  expect(await h.itemBalance('Groceries')).toBe(1000n);
  expect(await h.walletBalance(wallet)).toBe(10000n);
});

it('rejects invalid purposes and persists a changed purpose without moving money', async () => {
  const h = await setupSpace(db.pool);
  const month = monthOf(h.today);
  const { revision, payload } = await currentPlan(db.pool, h.spaceId, month);
  const group = payload.groups[0]! as typeof payload.groups[number] & { purpose: string };
  group.purpose = 'unknown';
  await expect(h.command('save_plan', { p_month: month, p_expected_revision: revision, p_plan: payload })).rejects.toThrow('BUDGET_INVALID_PLAN');
  group.purpose = 'savings';
  const count = await h.entryCount();
  await h.command('save_plan', { p_month: month, p_expected_revision: revision, p_plan: payload });
  const plan = await h.call<Plan>('plan_month', { p_space: h.spaceId, p_month: month });
  expect(plan.groups[0]!.purpose).toBe('savings');
  expect(await h.entryCount()).toBe(count);
});


it('replays an explicit-source payment exactly once and rejects a changed request payload', async () => {
  const h = await setupSpace(db.pool);
  const wallet = await h.wallet('Cash', 'cash', 'USD', 5000n);
  const source = await h.item('General savings');
  await h.command('assign_money', { p_on: h.today, p_moves: [{ from: null, to: source, currency: 'USD', amountMinor: '5000' }] });
  const args = { p_space: h.spaceId, p_request: randomUUID(), p_wallet: wallet, p_item: await h.item('Groceries'), p_source: source, p_amount: 2000n, p_on: h.today };
  const first = await h.call('record_expense_from', args);
  const count = await h.entryCount();
  expect(await h.call('record_expense_from', args)).toEqual(first);
  expect(await h.entryCount()).toBe(count);
  await expect(h.call('record_expense_from', { ...args, p_amount: 1000n })).rejects.toMatchObject({ message: 'BUDGET_REQUEST_CONFLICT' });
  expect(await h.itemBalance('General savings')).toBe(3000n);
});

it('charges a source category directly without redundant cover lines', async () => {
  const h = await setupSpace(db.pool);
  const wallet = await h.wallet('Cash', 'cash', 'USD', 5000n);
  const item = await h.item('Groceries');
  await h.command('assign_money', { p_on: h.today, p_moves: [{ from: null, to: item, currency: 'USD', amountMinor: '5000' }] });
  const paid = await h.command<{ entryId: string; covered: string }>('record_expense_from', { p_wallet: wallet, p_item: item, p_source: item, p_amount: 2000n, p_on: h.today });
  expect(paid.covered).toBe('0');
  expect(await h.lines(paid.entryId)).toEqual(['i:Groceries:USD:-2000:spend', 'w:Cash:USD:-2000:spend']);
});

it('rejects anonymous, nonmember and cross-space payment sources without writing an entry', async () => {
  const h = await setupSpace(db.pool), other = await setupSpace(db.pool);
  const wallet = await h.wallet('Cash', 'cash', 'USD', 5000n);
  const args = { p_space: h.spaceId, p_request: randomUUID(), p_wallet: wallet, p_item: await h.item('Groceries'), p_source: await h.item('General savings'), p_amount: 100n, p_on: h.today };
  const count = await h.entryCount();
  await expect(asAnon(db.pool, client => rpc(client, 'record_expense_from', args))).rejects.toMatchObject({ code: '42501' });
  await expect(callAs(db.pool, await createUser(db.pool), 'record_expense_from', args)).rejects.toMatchObject({ message: 'BUDGET_NOT_MEMBER' });
  await expect(h.call('record_expense_from', { ...args, p_source: await other.item('General savings') })).rejects.toMatchObject({ message: 'BUDGET_ITEM_NOT_FOUND' });
  expect(await h.entryCount()).toBe(count);
});
