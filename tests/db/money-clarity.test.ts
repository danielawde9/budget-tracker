import { afterAll, beforeAll, expect, it } from 'vitest';
import { setupSpace } from './support/budget.ts';
import { freshDatabase, type TestDatabase } from './support/database.ts';
import { currentPlan, monthOf } from './support/plan.ts';

let db: TestDatabase;
beforeAll(async () => { db = await freshDatabase(); });
afterAll(async () => { await db.close(); });
type Plan = { stillToFund: string; groups: { nameEn: string; purpose: string; items: { stillToFund: string }[]; flex: { stillToFund: string; available: string; broughtForward: string; funded: string } }[] };

it('persists group purpose independently of its name and preserves it for older clients', async () => {
  const h = await setupSpace(db.pool);
  const month = monthOf(h.today);
  let plan = await h.call<Plan>('plan_month', { p_space: h.spaceId, p_month: month });
  expect(plan.groups.map(g => g.purpose)).toEqual(['spending', 'spending', 'saving', 'saving', 'investment']);
  const { revision, payload } = await currentPlan(db.pool, h.spaceId, month);
  payload.groups.find(g => g.nameEn === 'Savings')!.nameEn = 'My future';
  await h.command('save_plan', { p_month: month, p_expected_revision: revision, p_plan: payload });
  plan = await h.call<Plan>('plan_month', { p_space: h.spaceId, p_month: month });
  expect(plan.groups.find(g => g.nameEn === 'My future')!.purpose).toBe('saving');
});

it('keeps an underfunded item visible despite excess funding elsewhere, and carries savings forward', async () => {
  const h = await setupSpace(db.pool, { income: 100000n });
  await h.wallet('Cash', 'cash', 'USD', 200000n);
  await h.command('assign_money', { p_on: h.today, p_moves: [
    { from: null, to: await h.item('Other essentials'), currency: 'USD', amountMinor: '100000' },
    { from: null, to: await h.item('General savings'), currency: 'USD', amountMinor: '3000' },
  ] });
  const plan = await h.call<Plan>('plan_month', { p_space: h.spaceId, p_month: monthOf(h.today) });
  // Other overfunded groups cannot cancel the savings contribution shortfall.
  expect(plan.groups.find(g => g.nameEn === 'Savings')!.flex.stillToFund).toBe('7000');
  expect(BigInt(plan.stillToFund)).toBe(plan.groups.reduce((n, g) => n + [...g.items, g.flex].reduce((s, i) => s + BigInt(i.stillToFund), 0n), 0n));
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
  group.purpose = 'saving';
  const count = await h.entryCount();
  await h.command('save_plan', { p_month: month, p_expected_revision: revision, p_plan: payload });
  const plan = await h.call<Plan>('plan_month', { p_space: h.spaceId, p_month: month });
  expect(plan.groups[0]!.purpose).toBe('saving');
  expect(await h.entryCount()).toBe(count);
});
