import { afterAll, beforeAll, expect, it } from 'vitest';
import { setupSpace } from './support/budget.ts';
import { freshDatabase, type TestDatabase } from './support/database.ts';
import { currentPlan, monthOf, newItem } from './support/plan.ts';

let db: TestDatabase;
beforeAll(async () => { db = await freshDatabase(); });
afterAll(async () => { await db.close(); });

it('keeps paused savings funding and old openings out of expense funding, including reversed Ready coverage', async () => {
  const h = await setupSpace(db.pool, { income: 100000n });
  const month = monthOf(h.today), next = monthOf(h.today, 1);
  const cash = await h.wallet('Cash', 'cash', 'USD', 500000n);
  const savings = await h.item('General savings');
  await h.command('assign_money', { p_on: h.today, p_moves: [{ from: null, to: savings, currency: 'USD', amountMinor: '10000' }] });
  await h.command('assign_money', { p_on: h.today, p_opening: true, p_moves: [{ from: null, to: savings, currency: 'USD', amountMinor: '20000' }] });
  const expense = await h.command('record_expense', { p_wallet: cash, p_item: await h.item('Groceries'), p_amount: 2000n, p_on: h.today });
  await h.command('record_expense', { p_wallet: cash, p_item: await h.item('To invest'), p_amount: 3000n, p_on: h.today });
  const beforeEntries = await h.entryCount();
  const beforeCash = await h.walletBalance(cash);
  const { revision, payload } = await currentPlan(db.pool, h.spaceId, month);
  await h.command('save_plan', { p_month: next, p_expected_revision: revision, p_plan: payload });
  const paused = { ...payload, groups: payload.groups.map(g => ['Short-term goals', 'Savings', 'Investments'].includes(g.nameEn ?? '') ? { ...g, percentBps: 0, items: g.items.map(i => ({ ...i, monthlyMinor: '0' })) } : g) };
  await h.command('save_plan', { p_month: month, p_expected_revision: revision, p_plan: paused });
  expect(await h.call('plan_month', { p_space: h.spaceId, p_month: month })).toMatchObject({
    groupsTotal: '65000', assignedFunding: '0', spentFromReady: '2000', funded: '2000', stillToFund: '63000',
    assignedFundingExcluded: '10000', spentFromReadyExcluded: '3000', fundingScope: 'planned_groups',
  });
  expect(await h.call('plan_month', { p_space: h.spaceId, p_month: next })).toMatchObject({ groupsTotal: '100000', funded: '0', stillToFund: '100000' });
  const preview = await h.call<{ unfunded: string; lines: { itemId: string; amountMinor: string }[] }>('funding_preview', { p_space: h.spaceId, p_month: month, p_currency: 'USD', p_amount: 100000n });
  expect(preview.unfunded).toBe('0');
  expect(preview.lines.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n)).toBe(63000n);
  expect(preview.lines.some(line => line.itemId === savings)).toBe(false);
  expect(await h.itemBalance('General savings')).toBe(30000n);
  expect(await h.walletBalance(cash)).toBe(beforeCash);
  expect(await h.entryCount()).toBe(beforeEntries);
  await h.command('reverse_entry', { p_entry: expense.entryId, p_reason: 'Correction' });
  expect(await h.call('plan_month', { p_space: h.spaceId, p_month: month })).toMatchObject({ funded: '0', spentFromReady: '0', stillToFund: '65000', spentFromReadyExcluded: '3000' });
});

it('does not propose funding a zero-share group even when it has an explicit item target', async () => {
  const h = await setupSpace(db.pool, { income: 100000n });
  const month = monthOf(h.today);
  const { revision, payload } = await currentPlan(db.pool, h.spaceId, month);
  const savings = payload.groups.find(g => g.nameEn === 'Savings')!;
  savings.items.push(newItem('goal', 'Paused target', 1000n));
  payload.groups = [savings, ...payload.groups.filter(g => g !== savings)];
  for (const group of payload.groups) if (['Savings', 'Short-term goals', 'Investments'].includes(group.nameEn ?? '')) group.percentBps = 0;
  await h.command('save_plan', { p_month: month, p_expected_revision: revision, p_plan: payload });
  const preview = await h.call<{ lines: { itemId: string; amountMinor: string }[] }>('funding_preview', { p_space: h.spaceId, p_month: month, p_currency: 'USD', p_amount: 65000n });
  const pausedId = await h.item('Paused target');
  expect(preview.lines.some(line => line.itemId === pausedId)).toBe(false);
});
