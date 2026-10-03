import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callAs } from './support/actor.ts';
import { identity, setupSpace, type BudgetHarness } from './support/budget.ts';
import { freshDatabase, type TestDatabase } from './support/database.ts';

// Randomized sequences of real commands. Commands may refuse an action (a
// BUDGET_* error is a valid answer); after every attempt, money must still
// be conserved and every guarantee in the spec must still hold.

const SEEDS = 40;
const ACTIONS_PER_SEED = 60;

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

interface World {
  h: BudgetHarness;
  rand: () => number;
  cash: { usd: string[]; lbp: string };
  investment: string;
  iOwe: string;
  owedToMe: string;
  items: string[];
  bill: string;
}

const pick = <T,>(rand: () => number, values: readonly T[]): T => {
  const value = values[Math.floor(rand() * values.length)];
  if (value === undefined) throw new Error('pick from empty list');
  return value;
};
const amount = (rand: () => number, max = 50_000): string => String(1 + Math.floor(rand() * max));

async function totals(h: BudgetHarness): Promise<{ income: bigint; spend: bigint; funding: bigint }> {
  const result = await h.pool.query<{ income: string; spend: string; funding: string }>(
    `select
       coalesce(sum(l.amount_minor) filter (where l.flow = 'income'), 0)::text as income,
       coalesce(sum(l.amount_minor) filter (where l.flow in ('spend', 'refund', 'interest', 'fee')), 0)::text as spend,
       coalesce(sum(l.amount_minor) filter (where l.flow in ('fund', 'release') and i.kind <> 'ready'), 0)::text as funding
     from budget.item_lines l join budget.items i on i.id = l.item_id
     where l.space_id = $1`,
    [h.spaceId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('no totals');
  return { income: BigInt(row.income), spend: BigInt(row.spend), funding: BigInt(row.funding) };
}

async function balancesSnapshot(h: BudgetHarness): Promise<string> {
  const result = await h.pool.query<{ k: string; v: string }>(
    `select 'w:' || wallet_id || ':' || currency as k, sum(amount_minor)::text as v from budget.wallet_lines where space_id = $1 group by wallet_id, currency
     union all
     select 'i:' || item_id || ':' || currency, sum(amount_minor)::text from budget.item_lines where space_id = $1 group by item_id, currency
     order by 1`,
    [h.spaceId],
  );
  return result.rows.filter((row) => row.v !== '0').map((row) => `${row.k}=${row.v}`).join('|');
}

async function assertInvariants(world: World, label: string): Promise<void> {
  const { h } = world;
  for (const currency of ['USD', 'LBP'] as const) {
    const { cash, ready, items } = await identity(h.pool, h.spaceId, currency);
    expect(cash, `${label}: identity ${currency}`).toBe(ready + items);
  }
  const negative = await h.pool.query(
    `select l.item_id, l.currency, sum(l.amount_minor) as balance from budget.item_lines l join budget.items i on i.id = l.item_id
      where l.space_id = $1 and i.kind <> 'ready' group by l.item_id, l.currency having sum(l.amount_minor) < 0`,
    [h.spaceId],
  );
  expect(negative.rows, `${label}: a plan item went below zero`).toEqual([]);
  const misplacedOpening = await h.pool.query(
    `select e.kind, l.flow from budget.item_lines l join budget.entries e on e.id = l.entry_id
      where l.space_id = $1 and (
        (l.flow = 'opening' and e.kind not in ('opening_balance', 'opening_assign', 'loan_opening') and not (e.kind = 'reversal'))
        or (e.kind = 'opening_assign' and l.flow <> 'opening'))`,
    [h.spaceId],
  );
  expect(misplacedOpening.rows, `${label}: opening money counted as something else`).toEqual([]);
}

type Action = (world: World) => Promise<unknown>;

const neutralActions: Record<string, Action> = {
  fund: async ({ h, rand, items }) => h.command('assign_money', { p_on: h.today, p_moves: [{ from: null, to: pick(rand, items), currency: rand() < 0.8 ? 'USD' : 'LBP', amountMinor: amount(rand) }] }),
  release: async ({ h, rand, items }) => h.command('assign_money', { p_on: h.today, p_moves: [{ from: pick(rand, items), to: null, currency: 'USD', amountMinor: amount(rand, 5_000) }] }),
  move: async ({ h, rand, items }) => {
    const from = pick(rand, items);
    const to = pick(rand, items.filter((item) => item !== from));
    return h.command('assign_money', { p_on: h.today, p_moves: [{ from, to, currency: 'USD', amountMinor: amount(rand, 5_000) }] });
  },
  transfer: async ({ h, rand, cash }) => h.command('record_transfer', { p_from: cash.usd[0], p_to: cash.usd[1], p_amount: amount(rand), p_on: h.today, ...(rand() < 0.5 ? {} : { p_from: cash.usd[1], p_to: cash.usd[0] }) }),
  exchange: async ({ h, rand, cash, items }) => h.command('record_exchange', { p_from: pick(rand, cash.usd), p_from_amount: amount(rand, 5_000), p_to: cash.lbp, p_to_amount: amount(rand, 10_000_000), p_item: rand() < 0.5 ? null : pick(rand, items), p_on: h.today }),
};

const otherActions: Record<string, Action> = {
  income: async ({ h, rand, cash }) => h.command('record_income', { p_wallet: pick(rand, [...cash.usd, cash.lbp]), p_amount: amount(rand, 500_000), p_on: h.today }),
  expense: async ({ h, rand, cash, items }) => {
    const item = pick(rand, items);
    const cover = rand() < 0.3 ? pick(rand, items.filter((candidate) => candidate !== item)) : null;
    return h.command('record_expense', { p_wallet: pick(rand, [...cash.usd, cash.lbp]), p_item: item, p_amount: amount(rand), p_on: h.today, p_cover_from: cover });
  },
  refund: async ({ h, rand, cash, items }) => h.command('record_refund', { p_wallet: pick(rand, cash.usd), p_item: pick(rand, items), p_amount: amount(rand, 2_000), p_on: h.today }),
  contribute: async ({ h, rand, cash, items, investment }) => h.command('record_investment', { p_action: 'contribute', p_investment: investment, p_cash: cash.usd[0], p_item: pick(rand, items), p_amount: amount(rand), p_on: h.today }),
  withdraw: async ({ h, rand, cash, investment }) => h.command('record_investment', { p_action: 'withdraw', p_investment: investment, p_cash: cash.usd[0], p_amount: amount(rand), p_on: h.today }),
  value: async ({ h, rand, investment }) => h.command('record_investment', { p_action: 'value', p_investment: investment, p_amount: amount(rand, 5_000_000), p_on: h.today }),
  borrow: async ({ h, rand, cash, iOwe }) => h.command('record_loan', { p_action: 'borrow', p_loan: iOwe, p_cash: cash.usd[0], p_principal: amount(rand), p_on: h.today }),
  repay: async ({ h, rand, cash, iOwe, items }) => h.command('record_loan', { p_action: 'repay', p_loan: iOwe, p_cash: cash.usd[0], p_item: pick(rand, items), p_principal: amount(rand, 5_000), p_interest: amount(rand, 500), p_on: h.today }),
  lend: async ({ h, rand, cash, owedToMe, items }) => h.command('record_loan', { p_action: 'lend', p_loan: owedToMe, p_cash: cash.usd[0], p_item: rand() < 0.5 ? null : pick(rand, items), p_principal: amount(rand, 5_000), p_on: h.today }),
  collect: async ({ h, rand, cash, owedToMe }) => h.command('record_loan', { p_action: 'collect', p_loan: owedToMe, p_cash: cash.usd[0], p_principal: amount(rand, 5_000), p_interest: amount(rand, 200), p_on: h.today }),
  reverse: async ({ h, rand }) => {
    const entries = await h.pool.query<{ id: string }>(
      `select e.id from budget.entries e where e.space_id = $1 and e.kind <> 'reversal'
         and not exists (select 1 from budget.entries r where r.reverses_entry_id = e.id) order by e.created_at`,
      [h.spaceId],
    );
    if (entries.rows.length === 0) return null;
    return h.command('reverse_entry', { p_entry: pick(rand, entries.rows).id, p_reason: 'property test' });
  },
};

async function attempt(action: Action, world: World): Promise<boolean> {
  try {
    await action(world);
    return true;
  } catch (error) {
    const message = (error as { message?: string }).message ?? '';
    if (/^BUDGET_/.test(message)) return false;
    throw error;
  }
}

async function makeWorld(seed: number): Promise<World> {
  const h = await setupSpace(db.pool);
  const usdA = await h.wallet('Bank', 'cash', 'USD', 1_000_000n);
  const usdB = await h.wallet('Cash', 'cash', 'USD', 50_000n);
  const lbp = await h.wallet('LBP cash', 'cash', 'LBP', 20_000_000n);
  const investment = await h.wallet('Brokerage', 'investment', 'USD', 500_000n);
  const iOwe = await h.wallet('Car loan', 'loan', 'USD', 400_000n, { p_loan_direction: 'i_owe' });
  const owedToMe = await h.wallet('Friend', 'loan', 'USD', 20_000n, { p_loan_direction: 'owed_to_me' });
  const itemRows = await db.pool.query<{ id: string }>("select id from budget.items where space_id = $1 and kind <> 'ready' order by created_at", [h.spaceId]);
  const items = itemRows.rows.map((row) => row.id);
  const bill = (await h.command<{ billId: string }>('save_bill', { p_name: 'Rent bill', p_item: items[0], p_amount: 10_000n, p_currency: 'USD', p_cadence: 'monthly', p_first_due: h.today })).billId;
  return { h, rand: mulberry32(seed), cash: { usd: [usdA, usdB], lbp }, investment, iOwe, owedToMe, items, bill };
}

describe('money is conserved under random sequences of real commands', () => {
  it(`holds every invariant across ${SEEDS} seeds × ${ACTIONS_PER_SEED} actions`, async () => {
    let applied = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const world = await makeWorld(seed);
      await assertInvariants(world, `seed ${seed} start`);
      for (let step = 0; step < ACTIONS_PER_SEED; step += 1) {
        const neutral = world.rand() < 0.4;
        const pool = neutral ? neutralActions : otherActions;
        const name = pick(world.rand, Object.keys(pool));
        const action = pool[name];
        if (!action) throw new Error(`unknown action ${name}`);
        const before = neutral ? await totals(world.h) : null;
        if (await attempt(action, world)) applied += 1;
        const label = `seed ${seed} step ${step} ${name}`;
        await assertInvariants(world, label);
        if (before) {
          const after = await totals(world.h);
          expect(after.income, `${label}: ${name} changed income`).toBe(before.income);
          expect(after.spend, `${label}: ${name} changed spending`).toBe(before.spend);
          if (name !== 'fund' && name !== 'release') expect(after.funding, `${label}: ${name} counted as funding`).toBe(before.funding);
        }
      }
    }
    expect(applied).toBeGreaterThan(SEEDS * ACTIONS_PER_SEED * 0.4);
  }, 600_000);

  it('returns every balance to where it was when an entry is recorded and then reversed', async () => {
    const world = await makeWorld(4242);
    for (let step = 0; step < 80; step += 1) {
      const name = pick(world.rand, [...Object.keys(neutralActions), ...Object.keys(otherActions)].filter((candidate) => candidate !== 'reverse'));
      const action = neutralActions[name] ?? otherActions[name];
      if (!action) throw new Error(`unknown action ${name}`);
      const snapshot = await balancesSnapshot(world.h);
      const count = await world.h.entryCount();
      if (!(await attempt(action, world))) continue;
      if ((await world.h.entryCount()) === count) continue;
      const latest = await world.h.pool.query<{ id: string }>('select id from budget.entries where space_id = $1 order by created_at desc limit 1', [world.h.spaceId]);
      const reversed = await attempt(async ({ h }) => h.command('reverse_entry', { p_entry: latest.rows[0]?.id, p_reason: 'undo' }), world);
      expect(reversed, `${name}: an entry reversed right away must always be reversible`).toBe(true);
      expect(await balancesSnapshot(world.h), `${name}: reversal did not restore balances`).toBe(snapshot);
    }
  }, 300_000);

  it('deducts a bill paid from its item once, and never from Ready to assign', async () => {
    const world = await makeWorld(7);
    const { h, items, cash, bill } = world;
    const item = items[0];
    await h.command('assign_money', { p_on: h.today, p_moves: [{ from: null, to: item, currency: 'USD', amountMinor: '25000' }] });
    const readyBefore = await h.readyBalance();
    const balanceBefore = await h.pool.query<{ v: string }>('select budget.item_balance($1, $2)::text as v', [item, 'USD']);
    await h.command('record_expense', { p_wallet: cash.usd[0], p_item: item, p_amount: 10_000n, p_on: h.today, p_bill: bill, p_bill_due: h.today });
    const balanceAfter = await h.pool.query<{ v: string }>('select budget.item_balance($1, $2)::text as v', [item, 'USD']);
    expect(BigInt(balanceBefore.rows[0]?.v ?? '0') - BigInt(balanceAfter.rows[0]?.v ?? '0')).toBe(10_000n);
    expect(await h.readyBalance()).toBe(readyBefore);
  });

  it('serializes concurrent duplicate submissions into one entry', async () => {
    const h = await setupSpace(db.pool);
    const bank = await h.wallet('Bank', 'cash', 'USD');
    const request = randomUUID();
    const args = { p_space: h.spaceId, p_request: request, p_wallet: bank, p_amount: 1_000n, p_on: h.today };
    const results = await Promise.all(Array.from({ length: 6 }, () => callAs<{ entryId: string }>(db.pool, h.userId, 'record_income', args)));
    expect(new Set(results.map((result) => result.entryId)).size).toBe(1);
    expect(await h.entryCount()).toBe(1);
  });
});
