import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase, disposeDisposableDatabase,
  migrationFiles, replayMigrations, withAuthenticatedTransaction, type DisposableDatabase,
} from './disposable-database.js';

let database: DisposableDatabase | undefined;
const actor = randomUUID();
function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_reversaldate');
  await bootstrapCompatibilityObjects(db().client);
  await replayMigrations(db().client, migrationFiles());
  await db().client.query(`insert into auth.users(id, email, email_confirmed_at) values ($1,'owner@budget.invalid', now())`, [actor]);
}, 120_000);

afterAll(async () => { if (database) await disposeDisposableDatabase(database); }, 30_000);

async function fixture(): Promise<{ spaceId: string; walletId: string }> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const space = await db().client.query<{ id: string }>("select id from public.create_space($1, 'personal') limit 2", [`Reversal ${randomUUID()}`]);
    const spaceId = space.rows[0]!.id;
    const wallet = await db().client.query<{ id: string }>("select id from public.create_wallet($1, 'Cash', 'USD') limit 2", [spaceId]);
    return { spaceId, walletId: wallet.rows[0]!.id };
  });
}

async function recordExpense(spaceId: string, walletId: string, date: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const event = await db().client.query<{ id: string }>(
      `select id from public.record_financial_event($1,$2,'expense',$3::date,$4::jsonb) limit 2`,
      [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor: '-5000' }])],
    );
    return event.rows[0]!.id;
  });
}

async function reverse(spaceId: string, eventId: string, date: string): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () =>
    db().client.query('select * from public.reverse_financial_event($1,$2,$3,$4::date) limit 2', [spaceId, randomUUID(), eventId, date]));
}

describe('reversal date guard', () => {
  it('refuses a reversal dated before the entry it reverses', async () => {
    const { spaceId, walletId } = await fixture();
    const eventId = await recordExpense(spaceId, walletId, '2026-09-10');
    await expect(reverse(spaceId, eventId, '2026-09-09'))
      .rejects.toMatchObject({ code: '23514', message: 'a reversal cannot be dated before the entry it reverses' });
  });

  it('accepts a reversal on the original date or later', async () => {
    const { spaceId, walletId } = await fixture();
    const sameDay = await recordExpense(spaceId, walletId, '2026-09-10');
    const later = await recordExpense(spaceId, walletId, '2026-09-10');
    await expect(reverse(spaceId, sameDay, '2026-09-10')).resolves.toBeUndefined();
    await expect(reverse(spaceId, later, '2026-09-20')).resolves.toBeUndefined();
  });
});
