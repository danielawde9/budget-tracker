import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { createUser } from './actor.ts';

/**
 * Direct-insert fixtures that bypass the public commands, so a test can prove
 * a database guard bites on its own (the commands are not the only defense).
 */
export interface RawSpace {
  readonly userId: string;
  readonly spaceId: string;
  readonly readyId: string;
  readonly groupId: string;
  readonly spendingId: string;
  readonly flexId: string;
  readonly cashUsd: string;
  readonly cashLbp: string;
  readonly investment: string;
  readonly iOwe: string;
  readonly owedToMe: string;
}

export async function inTransaction(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await fn(client);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function rawSpace(pool: pg.Pool): Promise<RawSpace> {
  const userId = await createUser(pool);
  const spaceId = randomUUID();
  const groupId = randomUUID();
  const ids = {
    readyId: randomUUID(),
    spendingId: randomUUID(),
    flexId: randomUUID(),
    cashUsd: randomUUID(),
    cashLbp: randomUUID(),
    investment: randomUUID(),
    iOwe: randomUUID(),
    owedToMe: randomUUID(),
  };
  await inTransaction(pool, async (c) => {
    await c.query('insert into budget.spaces (id, name, created_by, request_id) values ($1, $2, $3, $4)', [spaceId, 'Raw', userId, randomUUID()]);
    await c.query("insert into budget.space_members (space_id, user_id, role) values ($1, $2, 'owner')", [spaceId, userId]);
    await c.query("insert into budget.plan_groups (id, space_id, name_en) values ($1, $2, 'Essentials')", [groupId, spaceId]);
    await c.query("insert into budget.items (id, space_id, group_id, kind, name_en) values ($1, $2, null, 'ready', 'Ready to assign')", [ids.readyId, spaceId]);
    await c.query("insert into budget.items (id, space_id, group_id, kind, name_en) values ($1, $2, $3, 'spending', 'Groceries')", [ids.spendingId, spaceId, groupId]);
    await c.query("insert into budget.items (id, space_id, group_id, kind, name_en) values ($1, $2, $3, 'flex', 'Other')", [ids.flexId, spaceId, groupId]);
    await c.query("insert into budget.wallets (id, space_id, name, kind, currency) values ($1, $2, 'Bank', 'cash', 'USD')", [ids.cashUsd, spaceId]);
    await c.query("insert into budget.wallets (id, space_id, name, kind, currency) values ($1, $2, 'LBP cash', 'cash', 'LBP')", [ids.cashLbp, spaceId]);
    await c.query("insert into budget.wallets (id, space_id, name, kind, currency) values ($1, $2, 'Brokerage', 'investment', 'USD')", [ids.investment, spaceId]);
    await c.query("insert into budget.wallets (id, space_id, name, kind, currency, loan_direction) values ($1, $2, 'Car loan', 'loan', 'USD', 'i_owe')", [ids.iOwe, spaceId]);
    await c.query("insert into budget.wallets (id, space_id, name, kind, currency, loan_direction) values ($1, $2, 'Rami', 'loan', 'USD', 'owed_to_me')", [ids.owedToMe, spaceId]);
  });
  return { userId, spaceId, groupId, ...ids };
}

export interface RawLine {
  readonly wallet?: string;
  readonly item?: string;
  readonly currency: 'USD' | 'LBP';
  readonly amount: number;
  readonly flow: string;
}

/** Inserts one entry and its lines inside the caller's transaction. */
export async function insertEntry(
  client: pg.ClientBase,
  space: RawSpace,
  kind: string,
  lines: readonly RawLine[],
  extra: { readonly reverses?: string } = {},
): Promise<string> {
  const entryId = randomUUID();
  await client.query(
    'insert into budget.entries (id, space_id, kind, occurred_on, request_id, reverses_entry_id, created_by) values ($1, $2, $3, current_date, $4, $5, $6)',
    [entryId, space.spaceId, kind, randomUUID(), extra.reverses ?? null, space.userId],
  );
  for (const line of lines) {
    if (line.wallet) {
      await client.query(
        'insert into budget.wallet_lines (entry_id, space_id, wallet_id, currency, amount_minor, flow) values ($1, $2, $3, $4, $5, $6)',
        [entryId, space.spaceId, line.wallet, line.currency, line.amount, line.flow],
      );
    } else if (line.item) {
      await client.query(
        'insert into budget.item_lines (entry_id, space_id, item_id, currency, amount_minor, flow) values ($1, $2, $3, $4, $5, $6)',
        [entryId, space.spaceId, line.item, line.currency, line.amount, line.flow],
      );
    } else {
      throw new Error('A raw line needs a wallet or an item');
    }
  }
  return entryId;
}
