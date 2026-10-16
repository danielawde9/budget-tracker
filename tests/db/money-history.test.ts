import { beforeAll, afterAll, expect, it } from 'vitest';
import { setupSpace } from './support/budget.ts';
import { createUser, callAs, asAnon } from './support/actor.ts';
import { freshDatabase, type TestDatabase } from './support/database.ts';
import { currentPlan } from './support/plan.ts';

type Totals = { USD: string; LBP: string };
type History = { today: string; months: { month: string; through: string; income: Totals; spent: Totals; savings: Totals }[] };
let db: TestDatabase;
beforeAll(async () => { db = await freshDatabase(); await db.setClock('2026-10-10T10:00:00Z'); });
afterAll(async () => { await db.close(); });

it('shows six recorded months, net flows and cumulative savings without mixing currencies or future records', async () => {
  const h = await setupSpace(db.pool, { planMonth: '2026-03-01' });
  const cash = await h.wallet('Cash', 'cash', 'USD', 1000000n, { p_opened_on: '2026-03-01' });
  const lbp = await h.wallet('Lira', 'cash', 'LBP', 1000000n, { p_opened_on: '2026-03-01' });
  const bank = await h.wallet('Bank', 'cash', 'USD');
  const invest = await h.wallet('Brokerage', 'investment', 'USD');
  const savings = await h.item('General savings'), goal = await h.item('Goals money'), food = await h.item('Groceries');
  await h.command('assign_money', { p_on: '2026-03-01', p_moves: [
    { from: null, to: savings, currency: 'USD', amountMinor: '30000' },
    { from: null, to: goal, currency: 'USD', amountMinor: '20000' },
    { from: null, to: savings, currency: 'LBP', amountMinor: '700000' },
  ] });
  await h.command('record_income', { p_wallet: cash, p_amount: 50000n, p_on: '2026-09-15' });
  await h.command('assign_money', { p_on: '2026-09-15', p_moves: [{ from: null, to: savings, currency: 'USD', amountMinor: '20000' }] });
  const corrected = await h.command('record_income', { p_wallet: cash, p_amount: 7000n, p_on: '2026-09-16' });
  await h.command('reverse_entry', { p_entry: corrected.entryId, p_reason: 'Wrong income' });
  await h.command('record_income', { p_wallet: cash, p_item: savings, p_amount: 12000n, p_on: h.today });
  await h.command('record_income', { p_wallet: lbp, p_amount: 250000n, p_on: h.today });
  await h.command('record_expense_from', { p_wallet: cash, p_item: food, p_source: savings, p_amount: 10000n, p_on: h.today });
  await h.command('record_refund', { p_wallet: cash, p_item: food, p_amount: 2000n, p_on: h.today });
  await h.command('record_expense', { p_wallet: lbp, p_item: food, p_amount: 100000n, p_on: h.today });
  await h.command('record_transfer', { p_from: cash, p_to: bank, p_amount: 2500n, p_on: h.today });
  await h.command('record_investment', { p_action: 'contribute', p_investment: invest, p_cash: cash, p_item: await h.item('To invest'), p_amount: 5000n, p_on: h.today });
  await h.command('record_investment', { p_action: 'fee', p_investment: invest, p_amount: 500n, p_on: h.today });
  await db.setClock('2026-10-20T10:00:00Z');
  try { await h.command('record_income', { p_wallet: cash, p_amount: 999999n, p_on: '2026-10-20', p_item: savings }); }
  finally { await db.setClock('2026-10-10T10:00:00Z'); }
  const history = await h.call<History>('money_history', { p_space: h.spaceId });
  expect(history.today).toBe('2026-10-10');
  expect(history.months.map(row => row.month)).toEqual(['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01']);
  expect(history.months[0]).toMatchObject({ through: '2026-05-31', income: { USD: '0', LBP: '0' }, spent: { USD: '0', LBP: '0' }, savings: { USD: '50000', LBP: '700000' } });
  expect(history.months[4]).toMatchObject({ income: { USD: '50000', LBP: '0' }, savings: { USD: '70000', LBP: '700000' } });
  expect(history.months[5]).toMatchObject({ through: '2026-10-10', income: { USD: '12000', LBP: '250000' }, spent: { USD: '8000', LBP: '100000' }, savings: { USD: '72000', LBP: '700000' } });
});

it('keeps refunds signed and does not invent history for a new space', async () => {
  const h = await setupSpace(db.pool);
  expect((await h.call<History>('money_history', { p_space: h.spaceId })).months).toEqual([]);
  const cash = await h.wallet('Cash', 'cash', 'USD', 1000n);
  await h.command('record_refund', { p_wallet: cash, p_item: await h.item('Groceries'), p_amount: 500n, p_on: h.today });
  const history = await h.call<History>('money_history', { p_space: h.spaceId });
  expect(history.months).toEqual([{ month: '2026-10-01', through: '2026-10-10', income: { USD: '0', LBP: '0' }, spent: { USD: '-500', LBP: '0' }, savings: { USD: '0', LBP: '0' } }]);
});

it('keeps history private to space members and denies anonymous calls', async () => {
  const h = await setupSpace(db.pool), outsider = await createUser(db.pool);
  await expect(callAs(db.pool, outsider, 'money_history', { p_space: h.spaceId })).rejects.toMatchObject({ message: 'BUDGET_NOT_MEMBER' });
  await expect(asAnon(db.pool, client => client.query('select public.money_history($1)', [h.spaceId]))).rejects.toMatchObject({ code: '42501' });
});


it('keeps earlier savings snapshots when a later monthly plan changes the group purpose', async () => {
  const h = await setupSpace(db.pool, { planMonth: '2026-09-01' });
  await h.wallet('Cash', 'cash', 'USD', 10000n, { p_opened_on: '2026-09-01' });
  await h.wallet('Lira', 'cash', 'LBP', 1000000n, { p_opened_on: '2026-09-01' });
  const savings = await h.item('General savings');
  await h.command('assign_money', { p_on: '2026-09-01', p_moves: [
    { from: null, to: savings, currency: 'USD', amountMinor: '3000' },
    { from: null, to: savings, currency: 'LBP', amountMinor: '700000' },
  ] });
  const current = await currentPlan(db.pool, h.spaceId, '2026-10-01');
  Object.assign(current.payload.groups.find(g => g.nameEn === 'Savings')!, { purpose: 'expense', nameEn: 'Current expenses' });
  await h.command('save_plan', { p_month: '2026-10-01', p_expected_revision: current.revision, p_plan: current.payload });
  const history = await h.call<History>('money_history', { p_space: h.spaceId });
  expect(history.months.map(row => row.savings)).toEqual([{ USD: '3000', LBP: '700000' }, { USD: '0', LBP: '0' }]);
  expect(await h.itemBalance('General savings')).toBe(3000n);
});

it('classifies a retained item balance by its membership in each month rather than its latest group', async () => {
  const h = await setupSpace(db.pool, { planMonth: '2026-09-01' });
  await h.wallet('Cash', 'cash', 'USD', 10000n, { p_opened_on: '2026-09-01' });
  const rent = await h.item('Rent');
  await h.command('assign_money', { p_on: '2026-09-01', p_moves: [{ from: null, to: rent, currency: 'USD', amountMinor: '3000' }] });
  const current = await currentPlan(db.pool, h.spaceId, '2026-10-01');
  const essentials = current.payload.groups.find(g => g.nameEn === 'Essentials')!;
  const item = essentials.items.find(i => i.itemId === rent)!;
  essentials.items = essentials.items.filter(i => i.itemId !== rent);
  current.payload.groups.find(g => g.nameEn === 'Savings')!.items.push(item);
  await h.command('save_plan', { p_month: '2026-10-01', p_expected_revision: current.revision, p_plan: current.payload });
  const history = await h.call<History>('money_history', { p_space: h.spaceId });
  expect(history.months.map(row => row.savings)).toEqual([{ USD: '0', LBP: '0' }, { USD: '3000', LBP: '0' }]);
});

it('keeps past savings and real purchases after an emptied savings group is archived', async () => {
  const h = await setupSpace(db.pool, { planMonth: '2026-09-01' });
  const cash = await h.wallet('Cash', 'cash', 'USD', 10000n, { p_opened_on: '2026-09-01' });
  const savings = await h.item('General savings');
  await h.command('assign_money', { p_on: '2026-09-01', p_moves: [{ from: null, to: savings, currency: 'USD', amountMinor: '3000' }] });
  await h.command('record_expense_from', { p_wallet: cash, p_item: savings, p_source: savings, p_amount: 3000n, p_on: h.today });
  const current = await currentPlan(db.pool, h.spaceId, '2026-10-01');
  const group = current.payload.groups.find(g => g.nameEn === 'Savings')!;
  current.payload.groups = current.payload.groups.filter(g => g.groupId !== group.groupId);
  current.payload.archiveGroupIds.push(group.groupId!);
  await h.command('save_plan', { p_month: '2026-10-01', p_expected_revision: current.revision, p_plan: current.payload });
  const history = await h.call<History>('money_history', { p_space: h.spaceId });
  expect(history.months).toMatchObject([
    { savings: { USD: '3000', LBP: '0' }, spent: { USD: '0', LBP: '0' } },
    { savings: { USD: '0', LBP: '0' }, spent: { USD: '3000', LBP: '0' } },
  ]);
});
