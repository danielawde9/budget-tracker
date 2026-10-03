import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupSpace, type BudgetHarness } from './support/budget.ts';
import { freshDatabase, type TestDatabase } from './support/database.ts';
import { inTransaction } from './support/raw.ts';
import { monthOf } from './support/plan.ts';

let db: TestDatabase;

beforeAll(async () => {
  db = await freshDatabase();
});

afterAll(async () => {
  await db.close();
});

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function funded(): Promise<BudgetHarness & { bank: string }> {
  const h = await setupSpace(db.pool);
  const bank = await h.wallet('Bank', 'cash', 'USD', 500000n, { p_opened_on: addDays(h.today, -90) });
  return Object.assign(h, { bank });
}

describe('a bill whose first due date is later than the range (review #1)', () => {
  it('does not break the overview or the upcoming list', async () => {
    const h = await funded();
    await h.command('save_bill', { p_name: 'Next year', p_item: await h.item('Bills'), p_amount: 9000n, p_currency: 'USD', p_cadence: 'monthly', p_first_due: addDays(h.today, 120) });
    await expect(h.call('space_overview', { p_space: h.spaceId })).resolves.toBeTruthy();
    const upcoming = await h.call<{ name: string }[]>('bills_upcoming', { p_space: h.spaceId, p_from: h.today, p_to: addDays(h.today, 31) });
    expect(upcoming).toEqual([]);
  });
});

describe('items never go below zero on any day, not only today (review #4)', () => {
  it('covers a back-dated expense from the balance the item had on that day', async () => {
    const h = await funded();
    await h.command('assign_money', { p_on: h.today, p_moves: [{ from: null, to: await h.item('Groceries'), currency: 'USD', amountMinor: '60000' }] });
    const lastMonth = addDays(monthOf(h.today), -3);
    const result = await h.command<{ entryId: string; covered: string }>('record_expense', {
      p_wallet: h.bank, p_item: await h.item('Groceries'), p_amount: 5000n, p_on: lastMonth,
    });
    expect(result.covered).toBe('5000');
    const past = await h.call<{ statement: { currency: string; available: string }[] }>('item_statement', { p_space: h.spaceId, p_item: await h.item('Groceries'), p_month: lastMonth });
    expect(past.statement).toEqual([expect.objectContaining({ currency: 'USD', available: '0' })]);
  });

  it('refuses reversing past funding that later spending relied on', async () => {
    const h = await funded();
    const earlier = addDays(monthOf(h.today), -20);
    const groceries = await h.item('Groceries');
    const first = await h.command('assign_money', { p_on: earlier, p_moves: [{ from: null, to: groceries, currency: 'USD', amountMinor: '60000' }] });
    await h.command('record_expense', { p_wallet: h.bank, p_item: groceries, p_amount: 50000n, p_on: addDays(earlier, 5) });
    await h.command('assign_money', { p_on: h.today, p_moves: [{ from: null, to: groceries, currency: 'USD', amountMinor: '60000' }] });
    await expect(h.command('reverse_entry', { p_entry: first.entryId, p_reason: 'test' })).rejects.toMatchObject({ message: 'BUDGET_INSUFFICIENT_ITEM' });
  });

  it('refuses a back-dated move of money the item did not hold yet', async () => {
    const h = await funded();
    await h.command('assign_money', { p_on: h.today, p_moves: [{ from: null, to: await h.item('Fun'), currency: 'USD', amountMinor: '10000' }] });
    await expect(h.command('assign_money', {
      p_on: addDays(h.today, -40),
      p_moves: [{ from: await h.item('Fun'), to: await h.item('Groceries'), currency: 'USD', amountMinor: '5000' }],
    })).rejects.toMatchObject({ message: 'BUDGET_INSUFFICIENT_ITEM' });
  });

  it('is enforced by the database even when a command is bypassed', async () => {
    const h = await funded();
    const groceries = await h.item('Groceries');
    const ready = (await db.pool.query<{ id: string }>('select budget.ready_item($1) as id', [h.spaceId])).rows[0]?.id;
    await expect(inTransaction(db.pool, async (c) => {
      const insert = async (on: string, amount: number) => {
        const entry = randomUUID();
        await c.query('insert into budget.entries (id, space_id, kind, occurred_on, request_id, created_by) values ($1, $2, $3, $4, $5, $6)', [entry, h.spaceId, 'assign', on, randomUUID(), h.userId]);
        await c.query("insert into budget.item_lines (entry_id, space_id, item_id, currency, amount_minor, flow) values ($1, $2, $3, 'USD', $4, 'fund'), ($1, $2, $5, 'USD', $6, 'fund')", [entry, h.spaceId, groceries, amount, ready, -amount]);
      };
      await insert(addDays(h.today, -10), -1000);
      await insert(h.today, 2000);
    })).rejects.toMatchObject({ message: 'BUDGET_ITEM_NEGATIVE' });
  });
});
