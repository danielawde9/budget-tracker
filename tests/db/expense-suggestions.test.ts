import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callAs, createUser } from './support/actor.ts';
import { setupSpace } from './support/budget.ts';
import { freshDatabase, type TestDatabase } from './support/database.ts';

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

interface Suggestion {
  readonly memo: string;
  readonly itemId: string;
  readonly walletId: string;
  readonly amount: string;
  readonly currency: string;
  readonly lastOn: string;
}

interface Suggestions {
  readonly lastWalletId: string | null;
  readonly suggestions: Suggestion[];
}

describe('expense_suggestions', () => {
  it('lists each description once, as it was last recorded, newest first', async () => {
    const h = await setupSpace(db.pool);
    const bank = await h.wallet('Bank', 'cash', 'USD', 500000n);
    const cash = await h.wallet('Cash', 'cash', 'USD', 50000n);
    const groceries = await h.item('Groceries');
    const eatingOut = await h.item('Eating out');
    await h.command('record_expense', { p_wallet: bank, p_item: groceries, p_amount: 5000n, p_on: addDays(h.today, -3), p_memo: 'Supermarket' });
    await h.command('record_expense', { p_wallet: bank, p_item: eatingOut, p_amount: 350n, p_on: addDays(h.today, -2), p_memo: 'Coffee' });
    await h.command('record_expense', { p_wallet: cash, p_item: groceries, p_amount: 6420n, p_on: addDays(h.today, -1), p_memo: '  supermarket ' });
    await h.command('record_expense', { p_wallet: bank, p_item: groceries, p_amount: 100n, p_on: h.today });

    const result = await h.call<Suggestions>('expense_suggestions', { p_space: h.spaceId });

    expect(result.suggestions).toEqual([
      { memo: 'supermarket', itemId: groceries, walletId: cash, amount: '6420', currency: 'USD', lastOn: addDays(h.today, -1) },
      { memo: 'Coffee', itemId: eatingOut, walletId: bank, amount: '350', currency: 'USD', lastOn: addDays(h.today, -2) },
    ]);
    // The wallet of the latest expense, with or without a description.
    expect(result.lastWalletId).toBe(bank);
  });

  it('leaves out reversed expenses and bill payments', async () => {
    const h = await setupSpace(db.pool);
    const bank = await h.wallet('Bank', 'cash', 'USD', 500000n);
    const bills = await h.item('Bills');
    const typo = await h.command('record_expense', { p_wallet: bank, p_item: await h.item('Groceries'), p_amount: 900n, p_on: h.today, p_memo: 'Typo shop' });
    await h.command('reverse_entry', { p_entry: typo.entryId, p_reason: 'Wrong shop' });
    const bill = await h.command<{ billId: string }>('save_bill', { p_name: 'Internet', p_item: bills, p_amount: 4500n, p_currency: 'USD', p_cadence: 'monthly', p_first_due: h.today });
    await h.command('record_expense', { p_wallet: bank, p_item: bills, p_amount: 4500n, p_on: h.today, p_memo: 'Internet', p_bill: bill.billId, p_bill_due: h.today });

    const result = await h.call<Suggestions>('expense_suggestions', { p_space: h.spaceId });

    expect(result.suggestions).toEqual([]);
    expect(result.lastWalletId).toBe(bank);
  });

  it('is bounded by the limit and by the last year', async () => {
    const h = await setupSpace(db.pool);
    const bank = await h.wallet('Bank', 'cash', 'USD', 500000n);
    const fun = await h.item('Fun');
    await h.command('record_expense', { p_wallet: bank, p_item: fun, p_amount: 100n, p_on: addDays(h.today, -400), p_memo: 'Old cinema' });
    for (const [index, memo] of ['Books', 'Games', 'Music'].entries()) {
      await h.command('record_expense', { p_wallet: bank, p_item: fun, p_amount: 100n, p_on: addDays(h.today, -index), p_memo: memo });
    }

    const all = await h.call<Suggestions>('expense_suggestions', { p_space: h.spaceId });
    const two = await h.call<Suggestions>('expense_suggestions', { p_space: h.spaceId, p_limit: 2 });
    const huge = await h.call<Suggestions>('expense_suggestions', { p_space: h.spaceId, p_limit: 100000 });

    expect(all.suggestions.map((row) => row.memo)).toEqual(['Books', 'Games', 'Music']);
    expect(two.suggestions.map((row) => row.memo)).toEqual(['Books', 'Games']);
    expect(huge.suggestions).toHaveLength(3);
  });

  it('starts empty for a new space', async () => {
    const h = await setupSpace(db.pool);
    expect(await h.call<Suggestions>('expense_suggestions', { p_space: h.spaceId })).toEqual({ lastWalletId: null, suggestions: [] });
  });

  it('refuses someone outside the space', async () => {
    const h = await setupSpace(db.pool);
    const stranger = await createUser(db.pool);
    await expect(callAs(db.pool, stranger, 'expense_suggestions', { p_space: h.spaceId })).rejects.toMatchObject({ message: 'BUDGET_NOT_MEMBER' });
  });
});
