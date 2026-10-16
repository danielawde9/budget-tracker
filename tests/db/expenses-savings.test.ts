import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { freshDatabase, type TestDatabase } from './support/database.ts';
import { setupSpace, identity } from './support/budget.ts';
import { currentPlan, monthOf } from './support/plan.ts';
import { asAnon, callAs, createUser, rpc } from './support/actor.ts';

let db: TestDatabase;
beforeAll(async () => { db = await freshDatabase(); });
afterAll(async () => { await db?.close(); });

it('seeds expense/savings purposes and keeps purpose changes versioned through renames and legacy saves', async () => {
  const h = await setupSpace(db.pool);
  const read = async (month: string) => h.call<{ groups: { groupId: string; nameEn: string; purpose: string }[] }>('plan_month', { p_space: h.spaceId, p_month: month });
  const initial = await read(monthOf(h.today));
  expect(initial.groups.map(g => [g.nameEn, g.purpose])).toEqual([
    ['Essentials', 'expense'], ['Guilt free', 'expense'], ['Short-term goals', 'savings'], ['Savings', 'savings'], ['Investments', 'savings'],
  ]);
  const { payload, revision } = await currentPlan(db.pool, h.spaceId, monthOf(h.today));
  const savings = payload.groups.find(g => g.nameEn === 'Savings')!;
  Object.assign(savings, { purpose: 'expense', nameEn: 'A renamed group' });
  await h.command('save_plan', { p_month: monthOf(h.today, 1), p_expected_revision: revision, p_plan: payload });
  expect((await read(monthOf(h.today))).groups.find(g => g.groupId === savings.groupId)?.purpose).toBe('savings');
  expect((await read(monthOf(h.today, 1))).groups.find(g => g.groupId === savings.groupId)?.purpose).toBe('expense');
  const legacy = await currentPlan(db.pool, h.spaceId, monthOf(h.today, 1));
  await h.command('save_plan', { p_month: monthOf(h.today, 1), p_expected_revision: legacy.revision, p_plan: legacy.payload });
  expect((await read(monthOf(h.today, 1))).groups.find(g => g.groupId === savings.groupId)?.purpose).toBe('expense');
});

it('classifies new Insurance and Mazoot groups as savings and rejects unknown purposes', async () => {
  const h = await setupSpace(db.pool);
  const { payload, revision } = await currentPlan(db.pool, h.spaceId, monthOf(h.today));
  payload.groups.push({ groupId: null, nameEn: 'Mazoot', nameAr: null, percentBps: 0, items: [] });
  payload.groups.push({ groupId: null, nameEn: 'Insurance', nameAr: null, percentBps: 0, items: [] });
  await h.command('save_plan', { p_month: monthOf(h.today), p_expected_revision: revision, p_plan: payload });
  const plan = await h.call<{ groups: { nameEn: string; purpose: string }[] }>('plan_month', { p_space: h.spaceId, p_month: monthOf(h.today) });
  expect(plan.groups.slice(-2).map(g => g.purpose)).toEqual(['savings', 'savings']);
  const next = await currentPlan(db.pool, h.spaceId, monthOf(h.today));
  Object.assign(next.payload.groups[0]!, { purpose: 'typo' });
  await expect(h.command('save_plan', { p_month: monthOf(h.today), p_expected_revision: next.revision, p_plan: next.payload })).rejects.toMatchObject({ message: 'BUDGET_INVALID_PLAN' });
});

it('adds missing account opening money exactly once and assigns it without income, funding or spending', async () => {
  const h = await setupSpace(db.pool);
  const bank = await h.wallet('Bank', 'cash', 'USD', 10000n);
  const request = randomUUID();
  const args = { p_space: h.spaceId, p_request: request, p_wallet: bank, p_amount: 30000n, p_on: h.today };
  const first = await h.call('record_wallet_opening', args);
  expect(await h.call('record_wallet_opening', args)).toEqual(first);
  const target = await h.item('Other guilt-free');
  await h.command('assign_money', { p_on: h.today, p_opening: true, p_moves: [{ from: null, to: target, currency: 'USD', amountMinor: '30000' }] });
  expect(await identity(db.pool, h.spaceId, 'USD')).toEqual({ cash: 40000n, ready: 10000n, items: 30000n });
  const plan = await h.call<{ received: string; funded: string; groups: { spent: string }[] }>('plan_month', { p_space: h.spaceId, p_month: monthOf(h.today) });
  expect(plan.received).toBe('0'); expect(plan.funded).toBe('0'); expect(plan.groups.every(g => g.spent === '0')).toBe(true);
});

it('keeps investment and loan openings out of spendable cash', async () => {
  const h = await setupSpace(db.pool);
  const investment = await h.wallet('Portfolio', 'investment', 'USD');
  const loan = await h.wallet('Loan', 'loan', 'USD', 0n, { p_loan_direction: 'i_owe' });
  await h.command('record_wallet_opening', { p_wallet: investment, p_amount: 40000n, p_on: h.today });
  await h.command('record_wallet_opening', { p_wallet: loan, p_amount: 20000n, p_on: h.today });
  expect(await h.walletBalance(investment)).toBe(40000n); expect(await h.walletBalance(loan)).toBe(-20000n);
  expect(await h.readyBalance()).toBe(0n);
});

it('refuses unauthorized, future, zero and wrong-space opening writes', async () => {
  const h = await setupSpace(db.pool); const other = await setupSpace(db.pool);
  const bank = await h.wallet('Bank', 'cash', 'USD');
  const args = { p_space: h.spaceId, p_request: randomUUID(), p_wallet: bank, p_amount: 100n, p_on: h.today };
  await expect(asAnon(db.pool, c => rpc(c, 'record_wallet_opening', args))).rejects.toMatchObject({ code: '42501' });
  await expect(callAs(db.pool, await createUser(db.pool), 'record_wallet_opening', args)).rejects.toMatchObject({ message: 'BUDGET_NOT_MEMBER' });
  await expect(other.command('record_wallet_opening', { p_wallet: bank, p_amount: 100n, p_on: other.today })).rejects.toMatchObject({ message: 'BUDGET_WALLET_NOT_FOUND' });
  await expect(h.command('record_wallet_opening', { p_wallet: bank, p_amount: 0n, p_on: h.today })).rejects.toMatchObject({ message: 'BUDGET_INVALID_AMOUNT' });
  await expect(h.command('record_wallet_opening', { p_wallet: bank, p_amount: 100n, p_on: '2099-01-01' })).rejects.toMatchObject({ message: 'BUDGET_FUTURE_DATE' });
});

it('filters Activity by group and savings purpose before pagination', async () => {
  const h = await setupSpace(db.pool); await h.wallet('Bank', 'cash', 'USD', 10000n);
  const saving = await h.item('General savings'); const expense = await h.item('Other essentials');
  await h.command('assign_money', { p_on: h.today, p_moves: [{ from: null, to: saving, currency: 'USD', amountMinor: '1000' }] });
  for (let i = 0; i < 4; i++) await h.command('assign_money', { p_on: h.today, p_moves: [{ from: null, to: expense, currency: 'USD', amountMinor: '100' }] });
  const result = await h.call<{ entries: { kind: string; items: { itemId: string }[] }[]; next: unknown }>('activity_page', { p_space: h.spaceId, p_limit: 1, p_filter: { purpose: 'savings', groupId: await h.group('Savings') } });
  expect(result.entries).toHaveLength(1); expect(result.entries[0]!.items.some(i => i.itemId === saving)).toBe(true); expect(result.next).toBeNull();
});

it('keeps past activity in its historical expense group when a later plan moves the item to savings', async () => {
  const h = await setupSpace(db.pool);
  const bank = await h.wallet('Bank', 'cash', 'USD', 10000n);
  const rent = await h.item('Rent');
  await h.command('assign_money', { p_on: h.today, p_moves: [{ from: null, to: rent, currency: 'USD', amountMinor: '1000' }] });
  const expense = await h.command('record_expense', { p_wallet: bank, p_item: rent, p_amount: 1000n, p_on: h.today });
  const current = await currentPlan(db.pool, h.spaceId, monthOf(h.today));
  const essentials = current.payload.groups.find(g => g.nameEn === 'Essentials')!;
  const item = essentials.items.find(i => i.itemId === rent)!;
  essentials.items = essentials.items.filter(i => i.itemId !== rent);
  current.payload.groups.find(g => g.nameEn === 'Savings')!.items.push(item);
  await h.command('save_plan', { p_month: monthOf(h.today, 1), p_expected_revision: current.revision, p_plan: current.payload });
  const page = await h.call<{ entries: { entryId: string; items: { itemId: string; groupId: string; purpose: string }[] }[] }>('activity_page', { p_space: h.spaceId, p_filter: { purpose: 'expense', kind: 'expense', month: monthOf(h.today) } });
  expect(page.entries.map(e => e.entryId)).toEqual([expense.entryId]);
  expect(page.entries[0]!.items.find(i => i.itemId === rent)).toMatchObject({ groupId: essentials.groupId, purpose: 'expense' });
});

it('keeps real spending classified after its fully spent group is archived in the same month', async () => {
  const h = await setupSpace(db.pool);
  const start = await currentPlan(db.pool, h.spaceId, monthOf(h.today));
  start.payload.groups.push({ groupId: null, nameEn: 'Old expenses', nameAr: null, percentBps: 0, items: [] });
  await h.command('save_plan', { p_month: monthOf(h.today), p_expected_revision: start.revision, p_plan: start.payload });
  const group = await h.group('Old expenses'); const item = await h.item('Other Old expenses');
  const bank = await h.wallet('Bank', 'cash', 'USD', 1000n);
  await h.command('assign_money', { p_on: h.today, p_moves: [{ from: null, to: item, currency: 'USD', amountMinor: '1000' }] });
  const spent = await h.command('record_expense', { p_wallet: bank, p_item: item, p_amount: 1000n, p_on: h.today });
  const latest = await currentPlan(db.pool, h.spaceId, monthOf(h.today));
  latest.payload.groups = latest.payload.groups.filter(g => g.groupId !== group); latest.payload.archiveGroupIds.push(group);
  await h.command('save_plan', { p_month: monthOf(h.today), p_expected_revision: latest.revision, p_plan: latest.payload });
  const activity = await h.call<{ entries: { entryId: string; items: { purpose: string; groupId: string }[] }[] }>('activity_page', { p_space: h.spaceId, p_filter: { purpose: 'expense', kind: 'expense' } });
  expect(activity.entries.map(e => e.entryId)).toEqual([spent.entryId]);
  expect(activity.entries[0]!.items).toEqual(expect.arrayContaining([expect.objectContaining({ groupId: group, purpose: 'expense' })]));
});

it('retains the latest month purpose when archiving a group that had a different purpose last month', async () => {
  await db.setClock('2026-10-16T10:00:00Z');
  const h = await setupSpace(db.pool, { planMonth: '2026-09-01' });
  const current = await currentPlan(db.pool, h.spaceId, '2026-10-01');
  const saving = current.payload.groups.find(g => g.nameEn === 'Savings')!;
  Object.assign(saving, { purpose: 'expense' });
  await h.command('save_plan', { p_month: '2026-10-01', p_expected_revision: current.revision, p_plan: current.payload });
  const item = await h.item('General savings'); const bank = await h.wallet('Bank', 'cash', 'USD', 1000n);
  await h.command('assign_money', { p_on: h.today, p_moves: [{ from: null, to: item, currency: 'USD', amountMinor: '1000' }] });
  const spent = await h.command('record_expense', { p_wallet: bank, p_item: item, p_amount: 1000n, p_on: h.today });
  const latest = await currentPlan(db.pool, h.spaceId, '2026-10-01');
  latest.payload.groups = latest.payload.groups.filter(g => g.groupId !== saving.groupId); latest.payload.archiveGroupIds.push(saving.groupId!);
  await h.command('save_plan', { p_month: '2026-10-01', p_expected_revision: latest.revision, p_plan: latest.payload });
  const activity = await h.call<{ entries: { entryId: string }[] }>('activity_page', { p_space: h.spaceId, p_filter: { purpose: 'expense', kind: 'expense', month: '2026-10-01' } });
  expect(activity.entries.map(e => e.entryId)).toEqual([spent.entryId]);
});


it.each([
  ['Short-term goals', null],
  [' Short term goals ', null],
  ['SHORT-TERM GOALS', null],
  [null, 'الأهداف قصيرة المدى'],
])('defaults a new short-term savings group from its name (%s / %s)', async (en, ar) => {
  const result = await db.pool.query<{ purpose: string }>(
    'select budget.default_group_purpose($1,$2) as purpose', [en, ar],
  );
  expect(result.rows).toEqual([{ purpose: 'savings' }]);
});

it('preserves an explicit short-term expense override, prior month and money through rename and legacy save', async () => {
  const h = await setupSpace(db.pool);
  await h.wallet('Bank', 'cash', 'USD', 100000n);
  await h.command('assign_money', { p_on: h.today, p_moves: [{ from: null, to: await h.item('Goals money'), currency: 'USD', amountMinor: '90000' }] });
  const month = monthOf(h.today); const nextMonth = monthOf(h.today, 1);
  const before = await identity(db.pool, h.spaceId, 'USD'); const entries = await h.entryCount();
  const current = await currentPlan(db.pool, h.spaceId, month);
  const group = current.payload.groups.find(g => g.nameEn === 'Short-term goals')!;
  Object.assign(group, { purpose: 'expense' });
  await h.command('save_plan', { p_month: nextMonth, p_expected_revision: current.revision, p_plan: current.payload });
  const renamed = await currentPlan(db.pool, h.spaceId, nextMonth);
  renamed.payload.groups.find(g => g.groupId === group.groupId)!.nameEn = 'Short term goals';
  await h.command('save_plan', { p_month: nextMonth, p_expected_revision: renamed.revision, p_plan: renamed.payload });
  const read = (on: string) => h.call<{ groups: { groupId: string; purpose: string }[] }>('plan_month', { p_space: h.spaceId, p_month: on });
  expect((await read(month)).groups.find(g => g.groupId === group.groupId)?.purpose).toBe('savings');
  expect((await read(nextMonth)).groups.find(g => g.groupId === group.groupId)?.purpose).toBe('expense');
  expect(await identity(db.pool, h.spaceId, 'USD')).toEqual(before);
  expect(await h.itemBalance('Goals money')).toBe(90000n);
  expect(await h.entryCount()).toBe(entries);
});
