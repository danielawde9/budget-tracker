import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { splitByBps } from '../../src/lib/plan-math.ts';
import { freshDatabase, type TestDatabase } from './support/database.ts';

let db: TestDatabase;

beforeAll(async () => {
  db = await freshDatabase();
});

afterAll(async () => {
  await db.close();
});

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('the plan editor previews exactly what the database computes', () => {
  it('agrees with budget.split_by_bps on 2,000 random plans', async () => {
    const rand = mulberry32(20261003);
    const cases: { total: bigint; bps: number[] }[] = [];
    for (let i = 0; i < 2000; i += 1) {
      const groups = 1 + Math.floor(rand() * 8);
      let left = rand() < 0.7 ? 10000 : Math.floor(rand() * 10001);
      const bps: number[] = [];
      for (let g = 0; g < groups; g += 1) {
        const share = g === groups - 1 ? left : Math.floor(rand() * (left + 1));
        bps.push(share);
        left -= share;
      }
      cases.push({ total: BigInt(Math.floor(rand() * 10 ** (1 + Math.floor(rand() * 12)))), bps });
    }
    const result = await db.pool.query<{ i: number; parts: string[] }>(
      `select c.i, budget.split_by_bps(c.total, c.bps)::text[] as parts
         from jsonb_to_recordset($1::jsonb) as c(i int, total bigint, bps int[])
        order by c.i`,
      [JSON.stringify(cases.map((c, i) => ({ i, total: c.total.toString(), bps: c.bps })))],
    );
    for (const row of result.rows) {
      const c = cases[row.i];
      if (!c) throw new Error('missing case');
      expect(splitByBps(c.total, c.bps).map(String), JSON.stringify({ total: c.total.toString(), bps: c.bps })).toEqual(row.parts);
    }
    expect(result.rows).toHaveLength(2000);
  });
});
