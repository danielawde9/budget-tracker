import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { asAnon, callAs, createUser, rpc } from './support/actor.ts';
import { setupSpace, type BudgetHarness } from './support/budget.ts';
import { freshDatabase, type TestDatabase } from './support/database.ts';
import { currentPlan } from './support/plan.ts';

let db: TestDatabase;
beforeAll(async () => { db = await freshDatabase(); await db.setClock('2026-10-16T10:00:00Z'); });
afterAll(async () => { await db?.close(); });
async function fund(h: BudgetHarness, name: string, amount: string, on = h.today, currency = 'USD') {
  await h.command('assign_money', { p_on: on, p_moves: [{ from: null, to: await h.item(name), currency, amountMinor: amount }] });
}

it('covers a category from its own group before Ready, replays once and reverses all cover lines', async () => {
  const h = await setupSpace(db.pool); const bank = await h.wallet('Bank', 'cash', 'USD', 10000n);
  await fund(h, 'Other essentials', '3000'); await fund(h, 'Other guilt-free', '2000'); await fund(h, 'Groceries', '500');
  const args = { p_space: h.spaceId, p_request: randomUUID(), p_wallet: bank, p_item: await h.item('Groceries'), p_amount: 2000n, p_on: h.today };
  const result = await h.call<{ entryId: string; covered: string }>('record_expense', args);
  expect(result.covered).toBe('1500');
  expect(await h.itemBalance('Other essentials')).toBe(1500n);
  expect(await h.itemBalance('Other guilt-free')).toBe(2000n);
  expect(await h.readyBalance()).toBe(4500n);
  expect(await h.call('record_expense', args)).toEqual(result);
  await h.command('reverse_entry', { p_entry: result.entryId, p_reason: 'Wrong expense' });
  expect(await h.itemBalance('Other essentials')).toBe(3000n);
  expect(await h.itemBalance('Groceries')).toBe(500n);
  expect(await h.readyBalance()).toBe(4500n);
  expect(await h.walletBalance(bank)).toBe(10000n);
});

it('uses partial group funds and only the remainder from Ready without touching other groups', async () => {
  const h = await setupSpace(db.pool); const bank = await h.wallet('Bank', 'cash', 'USD', 10000n);
  await fund(h, 'Other essentials', '500'); await fund(h, 'General savings', '8000');
  const result = await h.command('record_expense', { p_wallet: bank, p_item: await h.item('Groceries'), p_amount: 2500n, p_on: h.today });
  expect(await h.lines(result.entryId)).toEqual([
    'i:Groceries:USD:-2500:spend', 'i:Groceries:USD:2000:cover', 'i:Groceries:USD:500:cover',
    'i:Other essentials:USD:-500:cover', 'i:Ready to assign:USD:-2000:cover', 'w:Bank:USD:-2500:spend',
  ]);
  expect(await h.readyBalance()).toBe(-500n); expect(await h.itemBalance('General savings')).toBe(8000n);
});

it('honors explicit category and Ready overrides and never self-covers the flexible item', async () => {
  const h = await setupSpace(db.pool); const bank = await h.wallet('Bank', 'cash', 'USD', 10000n);
  await fund(h, 'Other essentials', '3000'); await fund(h, 'Other guilt-free', '2000');
  await h.command('record_expense', { p_wallet: bank, p_item: await h.item('Groceries'), p_amount: 1000n, p_on: h.today, p_cover_from: await h.item('Other guilt-free') });
  expect(await h.itemBalance('Other essentials')).toBe(3000n); expect(await h.itemBalance('Other guilt-free')).toBe(1000n);
  const ready = (await db.pool.query<{ id: string }>("select id from budget.items where space_id=$1 and kind='ready'", [h.spaceId])).rows[0]!.id;
  await h.command('record_expense', { p_wallet: bank, p_item: await h.item('Groceries'), p_amount: 1000n, p_on: h.today, p_cover_from: ready });
  expect(await h.itemBalance('Other essentials')).toBe(3000n); expect(await h.readyBalance()).toBe(4000n);
  await h.command('record_expense', { p_wallet: bank, p_item: await h.item('Other essentials'), p_amount: 4000n, p_on: h.today });
  expect(await h.itemBalance('Other essentials')).toBe(0n); expect(await h.readyBalance()).toBe(3000n);
});

it('caps backdated automatic cover at the future-safe balance of the historical group', async () => {
  const h = await setupSpace(db.pool, { planMonth: '2026-09-01' });
  const bank = await h.wallet('Bank', 'cash', 'USD', 10000n, { p_opened_on: '2026-09-01' });
  await fund(h, 'Other essentials', '3000', '2026-09-01');
  await fund(h, 'Other guilt-free', '2000', '2026-09-01');
  await h.command('record_expense', { p_wallet: bank, p_item: await h.item('Other essentials'), p_amount: 2500n, p_on: '2026-10-10' });
  const plan = await currentPlan(db.pool, h.spaceId, '2026-09-01');
  const source = plan.payload.groups.find(g => g.nameEn === 'Essentials')!;
  const moved = source.items.find(i => i.nameEn === 'Groceries')!;
  source.items = source.items.filter(i => i !== moved); plan.payload.groups.find(g => g.nameEn === 'Guilt free')!.items.push(moved);
  await h.command('save_plan', { p_month: '2026-10-01', p_expected_revision: plan.revision, p_plan: plan.payload });
  await h.command('record_expense', { p_wallet: bank, p_item: await h.item('Groceries'), p_amount: 1000n, p_on: '2026-09-15' });
  expect(await h.itemBalance('Other essentials')).toBe(0n); expect(await h.itemBalance('Other guilt-free')).toBe(2000n);
  expect(await h.readyBalance()).toBe(4500n);
});

it('uses only the matching currency and does not fund past spending from later group money', async () => {
  const h = await setupSpace(db.pool, { planMonth: '2026-09-01' });
  await h.wallet('Bank', 'cash', 'USD', 10000n); const lbp = await h.wallet('Lira', 'cash', 'LBP', 10000n, { p_opened_on: '2026-09-01' });
  await fund(h, 'Other essentials', '3000'); await fund(h, 'Other essentials', '500', h.today, 'LBP');
  await h.command('record_expense', { p_wallet: lbp, p_item: await h.item('Groceries'), p_amount: 1000n, p_on: '2026-09-15' });
  expect(await h.itemBalance('Other essentials', 'LBP')).toBe(500n);
  await h.command('record_expense', { p_wallet: lbp, p_item: await h.item('Groceries'), p_amount: 1000n, p_on: h.today });
  expect(await h.itemBalance('Other essentials', 'LBP')).toBe(0n); expect(await h.itemBalance('Other essentials')).toBe(3000n);
  expect(await h.readyBalance('LBP')).toBe(8000n);
});

it('preserves investment cover semantics when no explicit source is given', async () => {
  const h = await setupSpace(db.pool); const bank = await h.wallet('Bank', 'cash', 'USD', 10000n); const investment = await h.wallet('Portfolio', 'investment', 'USD');
  await fund(h, 'Other essentials', '3000');
  await h.command('record_investment', { p_action: 'contribute', p_investment: investment, p_cash: bank, p_item: await h.item('Groceries'), p_amount: 1000n, p_on: h.today });
  expect(await h.itemBalance('Other essentials')).toBe(3000n); expect(await h.readyBalance()).toBe(6000n);
});

it('rejects stale category opening balances atomically and replays successful requests before checking', async () => {
  const h = await setupSpace(db.pool); await h.wallet('Bank', 'cash', 'USD', 10000n); const item = await h.item('General savings');
  await fund(h, 'General savings', '2000'); const count = await h.entryCount();
  const args = { p_space: h.spaceId, p_request: randomUUID(), p_on: h.today, p_opening: true, p_moves: [{ from: null, to: item, currency: 'USD', amountMinor: '1000', expectedBalanceMinor: '0' }] };
  await expect(h.call('assign_money', args)).rejects.toMatchObject({ message: 'BUDGET_BALANCE_CHANGED' });
  expect(await h.entryCount()).toBe(count); expect(await h.itemBalance('General savings')).toBe(2000n);
  args.p_moves[0]!.expectedBalanceMinor = '2000';
  const result = await h.call('assign_money', args); expect(await h.call('assign_money', args)).toEqual(result);
  expect(await h.itemBalance('General savings')).toBe(3000n);
});

it('keeps legacy opening assignments and refuses unaffordable or already-negative Ready assignments', async () => {
  const h = await setupSpace(db.pool); const bank = await h.wallet('Bank', 'cash', 'USD', 1000n); const item = await h.item('General savings');
  await h.command('assign_money', { p_on: h.today, p_opening: true, p_moves: [{ from: null, to: item, currency: 'USD', amountMinor: '500' }] });
  const move = { from: null, to: item, currency: 'USD', amountMinor: '501', expectedBalanceMinor: '500' };
  await expect(h.command('assign_money', { p_on: h.today, p_opening: true, p_moves: [move] })).rejects.toMatchObject({ message: 'BUDGET_INSUFFICIENT_READY' });
  await h.command('record_expense', { p_wallet: bank, p_item: await h.item('Groceries'), p_amount: 600n, p_on: h.today });
  move.amountMinor = '1';
  await expect(h.command('assign_money', { p_on: h.today, p_opening: true, p_moves: [move] })).rejects.toMatchObject({ message: 'BUDGET_INSUFFICIENT_READY' });
  expect(await h.readyBalance()).toBe(-100n); expect(await h.itemBalance('General savings')).toBe(500n);
});

it('checks account opening balances and replays the same request before stale validation', async () => {
  const h = await setupSpace(db.pool); const bank = await h.wallet('Bank', 'cash', 'USD', 1000n); const count = await h.entryCount();
  const args = { p_space: h.spaceId, p_request: randomUUID(), p_wallet: bank, p_amount: 500n, p_on: h.today, p_expected_balance: 0n };
  await expect(h.call('record_wallet_opening_checked', args)).rejects.toMatchObject({ message: 'BUDGET_BALANCE_CHANGED' });
  expect(await h.entryCount()).toBe(count); args.p_expected_balance = 1000n;
  const result = await h.call('record_wallet_opening_checked', args);
  expect(await h.call('record_wallet_opening_checked', args)).toEqual(result);
  expect(await h.walletBalance(bank)).toBe(1500n); expect(await h.readyBalance()).toBe(1500n);
  await expect(h.call('record_wallet_opening_checked', { ...args, p_amount: 600n })).rejects.toMatchObject({ message: 'BUDGET_REQUEST_CONFLICT' });
});

it('restricts checked account openings to members and validates wallet, amount, balance and date', async () => {
  const h = await setupSpace(db.pool); const bank = await h.wallet('Bank', 'cash', 'USD'); const other = await setupSpace(db.pool);
  const args = { p_space: h.spaceId, p_request: randomUUID(), p_wallet: bank, p_amount: 100n, p_on: h.today, p_expected_balance: 0n };
  await expect(asAnon(db.pool, c => rpc(c, 'record_wallet_opening_checked', args))).rejects.toMatchObject({ code: '42501' });
  await expect(callAs(db.pool, await createUser(db.pool), 'record_wallet_opening_checked', args)).rejects.toMatchObject({ message: 'BUDGET_NOT_MEMBER' });
  await expect(other.command('record_wallet_opening_checked', { ...args, p_space: other.spaceId })).rejects.toMatchObject({ message: 'BUDGET_WALLET_NOT_FOUND' });
  await expect(h.call('record_wallet_opening_checked', { ...args, p_amount: 0n })).rejects.toMatchObject({ message: 'BUDGET_INVALID_AMOUNT' });
  await expect(h.call('record_wallet_opening_checked', { ...args, p_expected_balance: null })).rejects.toMatchObject({ message: 'BUDGET_BALANCE_CHANGED' });
  await expect(h.call('record_wallet_opening_checked', { ...args, p_on: '2099-01-01' })).rejects.toMatchObject({ message: 'BUDGET_FUTURE_DATE' });
});

it('keeps checked loan and investment openings outside cash Ready balances', async () => {
  const h = await setupSpace(db.pool); const loan = await h.wallet('Loan', 'loan', 'USD', 1000n, { p_loan_direction: 'i_owe' }); const investment = await h.wallet('Portfolio', 'investment', 'USD', 2000n);
  await h.command('record_wallet_opening_checked', { p_wallet: loan, p_amount: 500n, p_on: h.today, p_expected_balance: -1000n });
  await h.command('record_wallet_opening_checked', { p_wallet: investment, p_amount: 500n, p_on: h.today, p_expected_balance: 2000n });
  expect(await h.walletBalance(loan)).toBe(-1500n); expect(await h.walletBalance(investment)).toBe(2500n); expect(await h.readyBalance()).toBe(0n);
});

it('serializes competing checked account openings so the stale writer cannot add money twice', async () => {
  const h = await setupSpace(db.pool); const bank = await h.wallet('Bank', 'cash', 'USD', 1000n);
  const results = await Promise.allSettled([0, 1].map(() => h.command('record_wallet_opening_checked', {
    p_wallet: bank, p_amount: 500n, p_on: h.today, p_expected_balance: 1000n,
  })));
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(r => r.status === 'rejected').map(r => r.reason.message)).toEqual(['BUDGET_BALANCE_CHANGED']);
  expect(await h.walletBalance(bank)).toBe(1500n); expect(await h.readyBalance()).toBe(1500n);
});

it('checks category openings in their own currency and serializes competing opening writers', async () => {
  const h = await setupSpace(db.pool); await h.wallet('Bank', 'cash', 'USD', 10000n); await h.wallet('Lira', 'cash', 'LBP', 10000n);
  const item = await h.item('General savings'); await fund(h, 'General savings', '2000'); await fund(h, 'General savings', '500', h.today, 'LBP');
  const results = await Promise.allSettled([0, 1].map(() => h.command('assign_money', {
    p_on: h.today, p_opening: true,
    p_moves: [{ from: null, to: item, currency: 'LBP', amountMinor: '100', expectedBalanceMinor: '500' }],
  })));
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(r => r.status === 'rejected').map(r => r.reason.message)).toEqual(['BUDGET_BALANCE_CHANGED']);
  expect(await h.itemBalance('General savings', 'LBP')).toBe(600n); expect(await h.itemBalance('General savings')).toBe(2000n);
  expect(await h.readyBalance('LBP')).toBe(9400n);
});

it('keeps the checked RPC and private cover helper unavailable to public, anon and service roles', async () => {
  const result = await db.pool.query<{ role: string; allowed: boolean }>(
    `select r as role, has_function_privilege(r, 'public.record_wallet_opening_checked(uuid,uuid,uuid,bigint,date,bigint)', 'execute') as allowed
     from unnest(array['anon','service_role','authenticated']) r`,
  );
  expect(result.rows).toEqual([{ role: 'anon', allowed: false }, { role: 'service_role', allowed: false }, { role: 'authenticated', allowed: true }]);
  const helper = await db.pool.query<{ allowed: boolean }>(
    `select has_function_privilege('authenticated', 'budget.charge_item(uuid,uuid,uuid,budget.currency,bigint,budget.flow,uuid)', 'execute') as allowed`,
  );
  expect(helper.rows).toEqual([{ allowed: false }]);
});

it('rejects privileged direct opening assignments that bypass the public command affordability guard', async () => {
  const h = await setupSpace(db.pool); await h.wallet('Bank', 'cash', 'USD', 1000n);
  const item = await h.item('General savings'); const count = await h.entryCount();
  const client = await db.pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [h.userId]);
    const entry = await client.query<{ id: string }>(
      "select budget.new_entry($1,$2,'opening_assign',$3,null) as id", [h.spaceId, randomUUID(), h.today],
    );
    await client.query("select budget.add_item_line($1,$2,budget.ready_item($2),'USD',-1500,'opening')", [entry.rows[0]!.id, h.spaceId]);
    await client.query("select budget.add_item_line($1,$2,$3,'USD',1500,'opening')", [entry.rows[0]!.id, h.spaceId, item]);
    await expect(client.query('commit')).rejects.toMatchObject({ message: 'BUDGET_INSUFFICIENT_READY' });
  } finally {
    await client.query('rollback'); client.release();
  }
  expect(await h.entryCount()).toBe(count); expect(await h.readyBalance()).toBe(1000n); expect(await h.itemBalance('General savings')).toBe(0n);
});

it('keeps funded opening assignments replayable and lets account openings repair expense over-assignment', async () => {
  const h = await setupSpace(db.pool); const bank = await h.wallet('Bank', 'cash', 'USD', 1000n);
  const args = { p_space: h.spaceId, p_request: randomUUID(), p_on: h.today, p_opening: true,
    p_moves: [{ from: null, to: await h.item('General savings'), currency: 'USD', amountMinor: '500', expectedBalanceMinor: '0' }] };
  const first = await h.call('assign_money', args); expect(await h.call('assign_money', args)).toEqual(first);
  await h.command('record_expense', { p_wallet: bank, p_item: await h.item('Groceries'), p_amount: 700n, p_on: h.today });
  expect(await h.readyBalance()).toBe(-200n);
  await h.command('record_wallet_opening_checked', { p_wallet: bank, p_amount: 300n, p_on: h.today, p_expected_balance: 300n });
  expect(await h.readyBalance()).toBe(100n); expect(await h.itemBalance('General savings')).toBe(500n);
});
