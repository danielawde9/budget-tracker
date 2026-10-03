import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { callAs, createUser } from './actor.ts';

export type Currency = 'USD' | 'LBP';

export interface BudgetHarness {
  readonly pool: pg.Pool;
  readonly userId: string;
  readonly spaceId: string;
  readonly today: string;
  call<T = Record<string, unknown>>(name: string, args?: Record<string, unknown>): Promise<T>;
  /** Calls a command for this space with a fresh request id. */
  command<T = { entryId: string }>(name: string, args?: Record<string, unknown>): Promise<T>;
  item(nameEn: string): Promise<string>;
  group(nameEn: string): Promise<string>;
  wallet(name: string, kind: 'cash' | 'investment' | 'loan', currency: Currency, opening?: bigint, extra?: Record<string, unknown>): Promise<string>;
  itemBalance(nameEn: string, currency?: Currency): Promise<bigint>;
  readyBalance(currency?: Currency): Promise<bigint>;
  walletBalance(walletId: string): Promise<bigint>;
  lines(entryId: string): Promise<string[]>;
  entryCount(): Promise<number>;
}

export async function setupSpace(pool: pg.Pool, options: { readonly income?: bigint; readonly withDefaults?: boolean; readonly planMonth?: string } = {}): Promise<BudgetHarness> {
  const userId = await createUser(pool);
  const created = await callAs<{ spaceId: string }>(pool, userId, 'create_space', {
    p_request: randomUUID(),
    p_name: 'Household',
    p_expected_income_minor: options.income ?? 411000n,
    p_with_defaults: options.withDefaults ?? true,
    p_plan_month: options.planMonth ?? null,
  });
  const spaceId = created.spaceId;
  const todayRow = await pool.query<{ d: string }>('select budget.space_today($1)::text as d', [spaceId]);
  const today = todayRow.rows[0]?.d ?? '';

  const scalar = async (sql: string, params: unknown[]): Promise<string> => {
    const result = await pool.query<{ v: string }>(sql, params);
    const value = result.rows[0]?.v;
    if (value === undefined || value === null) throw new Error(`No value for ${sql} ${JSON.stringify(params)}`);
    return value;
  };

  const harness: BudgetHarness = {
    pool,
    userId,
    spaceId,
    today,
    call: (name, args = {}) => callAs(pool, userId, name, args),
    command: (name, args = {}) => callAs(pool, userId, name, { p_space: spaceId, p_request: randomUUID(), ...args }),
    item: (nameEn) => scalar('select id::text as v from budget.items where space_id = $1 and name_en = $2 and archived_at is null', [spaceId, nameEn]),
    group: (nameEn) => scalar('select id::text as v from budget.plan_groups where space_id = $1 and name_en = $2', [spaceId, nameEn]),
    async wallet(name, kind, currency, opening = 0n, extra = {}) {
      const result = await callAs<{ walletId: string }>(pool, userId, 'create_wallet', {
        p_space: spaceId,
        p_request: randomUUID(),
        p_name: name,
        p_kind: kind,
        p_currency: currency,
        p_opening_minor: opening,
        ...extra,
      });
      return result.walletId;
    },
    async itemBalance(nameEn, currency = 'USD') {
      const id = await harness.item(nameEn);
      return BigInt(await scalar('select budget.item_balance($1, $2)::text as v', [id, currency]));
    },
    async readyBalance(currency = 'USD') {
      return BigInt(await scalar('select budget.item_balance(budget.ready_item($1), $2)::text as v', [spaceId, currency]));
    },
    async walletBalance(walletId) {
      return BigInt(await scalar('select budget.wallet_balance($1)::text as v', [walletId]));
    },
    async lines(entryId) {
      const result = await pool.query<{ line: string }>(
        `select 'w:' || w.name || ':' || l.currency || ':' || l.amount_minor || ':' || l.flow as line
           from budget.wallet_lines l join budget.wallets w on w.id = l.wallet_id where l.entry_id = $1
         union all
         select 'i:' || coalesce(i.name_en, i.name_ar) || ':' || l.currency || ':' || l.amount_minor || ':' || l.flow
           from budget.item_lines l join budget.items i on i.id = l.item_id where l.entry_id = $1`,
        [entryId],
      );
      return result.rows.map((row) => row.line).sort();
    },
    async entryCount() {
      return Number(await scalar('select count(*)::text as v from budget.entries where space_id = $1', [spaceId]));
    },
  };
  return harness;
}

/** Cash held, Ready to assign and Σ items for one currency, straight from the lines. */
export async function identity(pool: pg.Pool, spaceId: string, currency: Currency): Promise<{ cash: bigint; ready: bigint; items: bigint }> {
  const result = await pool.query<{ cash: string; ready: string; items: string }>(
    `select
       (select coalesce(sum(l.amount_minor), 0) from budget.wallet_lines l join budget.wallets w on w.id = l.wallet_id
         where w.space_id = $1 and w.kind = 'cash' and l.currency = $2)::text as cash,
       (select coalesce(sum(l.amount_minor), 0) from budget.item_lines l join budget.items i on i.id = l.item_id
         where i.space_id = $1 and i.kind = 'ready' and l.currency = $2)::text as ready,
       (select coalesce(sum(l.amount_minor), 0) from budget.item_lines l join budget.items i on i.id = l.item_id
         where i.space_id = $1 and i.kind <> 'ready' and l.currency = $2)::text as items`,
    [spaceId, currency],
  );
  const row = result.rows[0];
  if (!row) throw new Error('identity query returned nothing');
  return { cash: BigInt(row.cash), ready: BigInt(row.ready), items: BigInt(row.items) };
}
