import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser } from './support/actor.ts';
import { freshDatabase, type TestDatabase } from './support/database.ts';
import { inTransaction, insertEntry, rawSpace, type RawSpace } from './support/raw.ts';

let db: TestDatabase;
let s: RawSpace;

beforeAll(async () => {
  db = await freshDatabase();
  s = await rawSpace(db.pool);
  await inTransaction(db.pool, async (c) => {
    await insertEntry(c, s, 'income', [
      { wallet: s.cashUsd, currency: 'USD', amount: 1000, flow: 'income' },
      { item: s.readyId, currency: 'USD', amount: 1000, flow: 'income' },
    ]);
  });
});

afterAll(async () => {
  await db.close();
});

const tables = ['spaces', 'space_members', 'wallets', 'plan_groups', 'items', 'plan_versions', 'entries', 'wallet_lines', 'item_lines', 'bills', 'command_receipts'];

describe('the browser roles cannot reach budget tables', () => {
  for (const table of tables) {
    it(`denies authenticated SELECT on budget.${table}`, async () => {
      await expect(asUser(db.pool, s.userId, (c) => c.query(`select * from budget.${table}`))).rejects.toMatchObject({ code: '42501' });
    });
  }

  it('denies anon SELECT on budget.entries', async () => {
    await expect(asAnon(db.pool, (c) => c.query('select * from budget.entries'))).rejects.toMatchObject({ code: '42501' });
  });

  it('still shows nothing when a grant leaks: row-level security is the second layer', async () => {
    const client = await db.pool.connect();
    try {
      await client.query('begin');
      await client.query('grant usage on schema budget to authenticated');
      await client.query('grant select on budget.entries, budget.wallet_lines to authenticated');
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [s.userId]);
      const entries = await client.query('select count(*)::int as n from budget.entries');
      const lines = await client.query('select count(*)::int as n from budget.wallet_lines');
      expect(entries.rows[0]).toEqual({ n: 0 });
      expect(lines.rows[0]).toEqual({ n: 0 });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('enables row-level security on every budget table', async () => {
    const result = await db.pool.query<{ relname: string }>(
      "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'budget' and c.relkind = 'r' and not c.relrowsecurity",
    );
    expect(result.rows).toEqual([]);
  });
});
