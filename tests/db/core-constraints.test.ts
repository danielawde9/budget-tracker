import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, type TestDatabase } from './support/database.ts';
import { inTransaction, insertEntry, rawSpace, type RawSpace } from './support/raw.ts';

let db: TestDatabase;
let s: RawSpace;

beforeAll(async () => {
  db = await freshDatabase();
  s = await rawSpace(db.pool);
});

afterAll(async () => {
  await db.close();
});

async function fund(amount: number): Promise<string> {
  let id = '';
  await inTransaction(db.pool, async (c) => {
    id = await insertEntry(c, s, 'income', [
      { wallet: s.cashUsd, currency: 'USD', amount, flow: 'income' },
      { item: s.readyId, currency: 'USD', amount, flow: 'income' },
    ]);
  });
  return id;
}

describe('the two sides of an entry must agree', () => {
  it('commits a balanced cash entry', async () => {
    await expect(fund(10_000)).resolves.toBeTypeOf('string');
  });

  it('rejects a cash movement with no purpose line', async () => {
    await expect(
      inTransaction(db.pool, async (c) => {
        await insertEntry(c, s, 'income', [{ wallet: s.cashUsd, currency: 'USD', amount: 100, flow: 'income' }]);
      }),
    ).rejects.toMatchObject({ message: 'BUDGET_UNBALANCED_ENTRY' });
  });

  it('rejects sides that agree in total but not per currency', async () => {
    await expect(
      inTransaction(db.pool, async (c) => {
        await insertEntry(c, s, 'income', [
          { wallet: s.cashUsd, currency: 'USD', amount: 100, flow: 'income' },
          { item: s.readyId, currency: 'LBP', amount: 100, flow: 'income' },
        ]);
      }),
    ).rejects.toMatchObject({ message: 'BUDGET_UNBALANCED_ENTRY' });
  });

  it('allows an investment-only entry, which is outside spendable cash', async () => {
    await expect(
      inTransaction(db.pool, async (c) => {
        await insertEntry(c, s, 'invest_value', [{ wallet: s.investment, currency: 'USD', amount: 500, flow: 'value' }]);
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects an entry with no lines at all', async () => {
    await expect(
      inTransaction(db.pool, async (c) => {
        await insertEntry(c, s, 'income', []);
      }),
    ).rejects.toMatchObject({ message: 'BUDGET_EMPTY_ENTRY' });
  });

  it('rejects a wallet line whose currency differs from its wallet', async () => {
    await expect(
      inTransaction(db.pool, async (c) => {
        await insertEntry(c, s, 'income', [
          { wallet: s.cashUsd, currency: 'LBP', amount: 100, flow: 'income' },
          { item: s.readyId, currency: 'LBP', amount: 100, flow: 'income' },
        ]);
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

describe('balances stay within their bounds', () => {
  it('rejects a plan item going below zero', async () => {
    await expect(
      inTransaction(db.pool, async (c) => {
        await insertEntry(c, s, 'expense', [
          { wallet: s.cashUsd, currency: 'USD', amount: -50, flow: 'spend' },
          { item: s.spendingId, currency: 'USD', amount: -50, flow: 'spend' },
        ]);
      }),
    ).rejects.toMatchObject({ message: 'BUDGET_ITEM_NEGATIVE' });
  });

  it('lets Ready to assign go below zero (over-assigned is a state, not an error)', async () => {
    await expect(
      inTransaction(db.pool, async (c) => {
        await insertEntry(c, s, 'expense', [
          { wallet: s.cashLbp, currency: 'LBP', amount: -5_000, flow: 'spend' },
          { item: s.readyId, currency: 'LBP', amount: -5_000, flow: 'spend' },
        ]);
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects an investment account below zero', async () => {
    await expect(
      inTransaction(db.pool, async (c) => {
        await insertEntry(c, s, 'invest_fee', [{ wallet: s.investment, currency: 'USD', amount: -100_000, flow: 'fee' }]);
      }),
    ).rejects.toMatchObject({ message: 'BUDGET_WALLET_BOUNDS' });
  });

  it('rejects a debt I owe turning into money owed to me', async () => {
    await expect(
      inTransaction(db.pool, async (c) => {
        await insertEntry(c, s, 'loan_opening', [{ wallet: s.iOwe, currency: 'USD', amount: 100, flow: 'opening' }]);
      }),
    ).rejects.toMatchObject({ message: 'BUDGET_WALLET_BOUNDS' });
  });

  it('rejects money owed to me going below zero', async () => {
    await expect(
      inTransaction(db.pool, async (c) => {
        await insertEntry(c, s, 'loan_opening', [{ wallet: s.owedToMe, currency: 'USD', amount: -100, flow: 'opening' }]);
      }),
    ).rejects.toMatchObject({ message: 'BUDGET_WALLET_BOUNDS' });
  });
});

describe('history is append-only', () => {
  const tables = ['budget.entries', 'budget.wallet_lines', 'budget.item_lines', 'budget.bill_payment_links', 'budget.bill_payment_loan_identities'];

  for (const table of tables) {
    it(`rejects UPDATE on ${table}`, async () => {
      await fund(1);
      await expect(db.pool.query(`update ${table} set space_id = space_id`)).rejects.toMatchObject({ message: 'BUDGET_APPEND_ONLY' });
    });

    it(`rejects DELETE on ${table}, even when no row matches`, async () => {
      await expect(db.pool.query(`delete from ${table} where false`)).rejects.toMatchObject({ message: 'BUDGET_APPEND_ONLY' });
    });

    it(`rejects TRUNCATE on ${table}`, async () => {
      await expect(db.pool.query(`truncate ${table} cascade`)).rejects.toMatchObject({ message: 'BUDGET_APPEND_ONLY' });
    });
  }
});

describe('a reversal must mirror its original exactly', () => {
  it('accepts the exact negation', async () => {
    const original = await fund(700);
    await expect(
      inTransaction(db.pool, async (c) => {
        await insertEntry(
          c,
          s,
          'reversal',
          [
            { wallet: s.cashUsd, currency: 'USD', amount: -700, flow: 'income' },
            { item: s.readyId, currency: 'USD', amount: -700, flow: 'income' },
          ],
          { reverses: original },
        );
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects a reversal with a different amount', async () => {
    const original = await fund(800);
    await expect(
      inTransaction(db.pool, async (c) => {
        await insertEntry(
          c,
          s,
          'reversal',
          [
            { wallet: s.cashUsd, currency: 'USD', amount: -700, flow: 'income' },
            { item: s.readyId, currency: 'USD', amount: -700, flow: 'income' },
          ],
          { reverses: original },
        );
      }),
    ).rejects.toMatchObject({ message: 'BUDGET_BAD_REVERSAL' });
  });
});

describe('plan versions', () => {
  async function version(): Promise<string> {
    const id = randomUUID();
    await db.pool.query(
      "insert into budget.plan_versions (id, space_id, effective_month, expected_income_minor, updated_by) values ($1, $2, date_trunc('month', current_date)::date - (floor(random() * 1000)::int * interval '1 month'), 411000, $3)",
      [id, s.spaceId, s.userId],
    );
    return id;
  }

  it('rejects group percentages above 100%', async () => {
    const versionId = await version();
    const second = randomUUID();
    await db.pool.query("insert into budget.plan_groups (id, space_id, name_en) values ($1, $2, 'Second')", [second, s.spaceId]);
    await expect(
      inTransaction(db.pool, async (c) => {
        await c.query('insert into budget.plan_version_groups (version_id, space_id, group_id, percent_bps, position) values ($1, $2, $3, 6001, 0)', [versionId, s.spaceId, s.groupId]);
        await c.query('insert into budget.plan_version_groups (version_id, space_id, group_id, percent_bps, position) values ($1, $2, $3, 4000, 1)', [versionId, s.spaceId, second]);
      }),
    ).rejects.toMatchObject({ message: 'BUDGET_PLAN_OVER_100' });
  });

  it('rejects a flexible item stored as a planned line (its amount is derived)', async () => {
    const versionId = await version();
    await expect(
      inTransaction(db.pool, async (c) => {
        await c.query('insert into budget.plan_version_groups (version_id, space_id, group_id, percent_bps, position) values ($1, $2, $3, 6000, 0)', [versionId, s.spaceId, s.groupId]);
        await c.query('insert into budget.plan_version_items (version_id, space_id, item_id, group_id, monthly_minor, position) values ($1, $2, $3, $4, 100, 0)', [versionId, s.spaceId, s.flexId, s.groupId]);
      }),
    ).rejects.toMatchObject({ message: 'BUDGET_PLAN_ITEM_INVALID' });
  });
});

describe('exact percentage split', () => {
  async function split(total: string, bps: number[]): Promise<string[]> {
    const result = await db.pool.query<{ r: string[] }>('select budget.split_by_bps($1::bigint, $2::int[])::text[] as r', [total, bps]);
    return result.rows[0]?.r ?? [];
  }

  it('splits $4,110 into the five default groups exactly', async () => {
    expect(await split('411000', [6000, 500, 1500, 1000, 1000])).toEqual(['246600', '20550', '61650', '41100', '41100']);
  });

  it('gives leftover cents by largest remainder, ties in group order', async () => {
    expect(await split('100', [3333, 3333, 3334])).toEqual(['33', '33', '34']);
    expect(await split('100', [3334, 3333, 3333])).toEqual(['34', '33', '33']);
    expect(await split('1', [5000, 5000])).toEqual(['1', '0']);
  });

  it('splits only the planned share when groups total under 100%', async () => {
    expect(await split('100', [5000])).toEqual(['50']);
    expect(await split('101', [5000, 4000])).toEqual(['50', '40']);
  });

  it('always sums to the total when groups total 100%', async () => {
    for (let i = 0; i < 200; i += 1) {
      const a = Math.floor(Math.random() * 10_001);
      const b = Math.floor(Math.random() * (10_001 - a));
      const parts = [a, b, 10_000 - a - b];
      const total = BigInt(Math.floor(Math.random() * 1_000_000_000));
      const result = await split(total.toString(), parts);
      expect(result.reduce((sum, part) => sum + BigInt(part), 0n)).toBe(total);
    }
  });
});

describe('one clock per space', () => {
  it('rejects an unknown timezone', async () => {
    await expect(
      db.pool.query("insert into budget.spaces (name, timezone, created_by, request_id) values ('Bad', 'Mars/Olympus', $1, $2)", [s.userId, randomUUID()]),
    ).rejects.toMatchObject({ message: 'BUDGET_INVALID_TIMEZONE' });
  });

  it('dates a moment in the space timezone, not UTC', async () => {
    const result = await db.pool.query<{ d: string }>(
      "select budget.space_date_at($1, timestamptz '2026-09-30 22:30:00+00')::text as d",
      [s.spaceId],
    );
    expect(result.rows[0]?.d).toBe('2026-10-01');
  });
});
