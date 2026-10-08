import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callAs, createUser } from './support/actor.ts';
import { setupSpace } from './support/budget.ts';
import { freshDatabase, type TestDatabase } from './support/database.ts';
let db: TestDatabase;
beforeAll(async () => { db = await freshDatabase(); });
afterAll(async () => { await db.close(); });
describe('wallet_balance_on', () => {
  it('includes backdated entries through end of day and nets reversals on their original date without writes', async () => {
    const h = await setupSpace(db.pool);
    const wallet = await h.wallet('Bank', 'cash', 'USD');
    const read = (on: string) => h.call<{ balance: string; on: string }>('wallet_balance_on', { p_space: h.spaceId, p_wallet: wallet, p_on: on });
    const entry = await h.command('record_income', { p_wallet: wallet, p_amount: 12345n, p_on: '2020-06-15' });
    expect((await read('2020-06-14')).balance).toBe('0');
    expect((await read('2020-06-15')).balance).toBe('12345');
    expect((await read('2020-06-16')).balance).toBe('12345');
    await h.command('reverse_entry', { p_entry: entry.entryId, p_reason: 'Wrong entry' });
    const before = await h.entryCount();
    for (const on of ['2020-06-14', '2020-06-15', '2020-06-16']) expect((await read(on)).balance).toBe('0');
    expect(await h.entryCount()).toBe(before);
  });
  it('protects membership, cash wallet ownership and valid dates', async () => {
    const h = await setupSpace(db.pool);
    const cash = await h.wallet('Cash', 'cash', 'LBP');
    const investment = await h.wallet('Shares', 'investment', 'USD');
    const other = await setupSpace(db.pool);
    const otherCash = await other.wallet('Other', 'cash', 'USD');
    const args = { p_space: h.spaceId, p_wallet: cash, p_on: h.today };
    await expect(callAs(db.pool, await createUser(db.pool), 'wallet_balance_on', args)).rejects.toMatchObject({ message: 'BUDGET_NOT_MEMBER' });
    await expect(h.call('wallet_balance_on', { ...args, p_wallet: investment })).rejects.toMatchObject({ message: 'BUDGET_WALLET_KIND' });
    await expect(h.call('wallet_balance_on', { ...args, p_wallet: otherCash })).rejects.toMatchObject({ message: 'BUDGET_WALLET_NOT_FOUND' });
    for (const on of [null, '1999-12-31', 'infinity']) await expect(h.call('wallet_balance_on', { ...args, p_on: on })).rejects.toMatchObject({ message: 'BUDGET_INVALID_DATE' });
    expect(await h.call('wallet_balance_on', args)).toMatchObject({ currency: 'LBP', balance: '0' });
  });
});
