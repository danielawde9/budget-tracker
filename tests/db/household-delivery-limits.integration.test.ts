import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCompatibilityObjects, createDisposableDatabase, disposeDisposableDatabase, migrationFiles, replayMigrations, withAuthenticatedTransaction, orderedAuthenticatedRace, type DisposableDatabase } from './disposable-database.js';

let database: DisposableDatabase;
beforeAll(async () => {
  database = await createDisposableDatabase('budget_deliverylimits');
  await bootstrapCompatibilityObjects(database.client);
  await replayMigrations(database.client, migrationFiles());
}, 120_000);
afterAll(async () => { if (database) await disposeDisposableDatabase(database); });
async function newOwner() {
  const id = randomUUID();
  await database.client.query('insert into auth.users(id, email, email_confirmed_at) values ($1, $2, now())', [id, `${id}@budget.invalid`]);
  return id;
}
async function space(owner: string, kind = 'household') {
  return withAuthenticatedTransaction(database.client, owner, async () => (await database.client.query('select id from public.create_space($1, $2::public.space_kind)', ['Delivery limits test', kind])).rows[0]!.id as string);
}
async function consume(owner: string, spaceId: string) {
  return withAuthenticatedTransaction(database.client, owner, async () => (await database.client.query('select public.consume_household_invitation_delivery_limit($1) as allowed', [spaceId])).rows[0]!.allowed as boolean);
}
describe('durable household invitation delivery limits', () => {
  it('allows three attempts per owner and household and rejects the fourth', async () => {
    const owner = await newOwner(); const household = await space(owner);
    expect(await consume(owner, household)).toBe(true);
    expect(await consume(owner, household)).toBe(true);
    expect(await consume(owner, household)).toBe(true);
    expect(await consume(owner, household)).toBe(false);
  });
  it('bounds total attempts across households to twenty per owner per minute', async () => {
    const owner = await newOwner();
    for (let index = 0; index < 10; index++) {
      const household = await space(owner);
      expect(await consume(owner, household)).toBe(true);
      expect(await consume(owner, household)).toBe(true);
    }
    expect(await consume(owner, await space(owner))).toBe(false);
  });
  it('resets counters in a new window without accumulating historical rows', async () => {
    const owner = await newOwner(); const household = await space(owner);
    for (let index = 0; index < 3; index++) await consume(owner, household);
    await database.client.query("update private.household_invitation_delivery_limits set window_start = window_start - interval '1 minute' where actor_user_id = $1", [owner]);
    expect(await consume(owner, household)).toBe(true);
    const counters = await database.client.query('select attempts from private.household_invitation_delivery_limits where actor_user_id = $1', [owner]);
    expect(counters.rows).toEqual([{ attempts: 1 }, { attempts: 1 }]);
  });
  it('denies personal spaces and users without ownership before writing counters', async () => {
    const owner = await newOwner(); const other = await newOwner(); const household = await space(owner);
    await expect(consume(other, household)).rejects.toMatchObject({ code: '42501', message: 'not_authorized' });
    await expect(consume(owner, await space(owner, 'personal'))).rejects.toMatchObject({ code: '42501', message: 'not_authorized' });
    const counters = await database.client.query('select count(*)::integer as total from private.household_invitation_delivery_limits where actor_user_id in ($1, $2)', [owner, other]);
    expect(counters.rows[0]!.total).toBe(0);
  });
  it('serializes concurrent requests for the last available attempt', async () => {
    const owner = await newOwner(); const household = await space(owner);
    await consume(owner, household); await consume(owner, household);
    const result = await orderedAuthenticatedRace(database, owner,
      async (client) => { expect((await client.query('select public.consume_household_invitation_delivery_limit($1) as allowed', [household])).rows[0]!.allowed).toBe(true); },
      async (client) => (await client.query('select public.consume_household_invitation_delivery_limit($1) as allowed', [household])).rows[0]!.allowed,
    );
    expect(result).toEqual({ status: 'fulfilled', value: false });
  });
  it('keeps counters private and grants the command only to authenticated callers', async () => {
    const result = await database.client.query(`select
      has_table_privilege('authenticated', 'private.household_invitation_delivery_limits', 'select') as readable,
      has_table_privilege('authenticated', 'private.household_invitation_delivery_limits', 'insert') as writable,
      has_function_privilege('anon', 'public.consume_household_invitation_delivery_limit(uuid)', 'execute') as anonymous,
      has_function_privilege('service_role', 'public.consume_household_invitation_delivery_limit(uuid)', 'execute') as privileged,
      has_function_privilege('authenticated', 'public.consume_household_invitation_delivery_limit(uuid)', 'execute') as authenticated`);
    expect(result.rows[0]).toEqual({ readable: false, writable: false, anonymous: false, privileged: false, authenticated: true });
  });
});
