import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, inTransaction, migrationFiles, replayMigrations,
  withAuthenticatedTransaction,
  type DisposableDatabase,
} from './disposable-database.js';

let database: DisposableDatabase | undefined;
const actor = randomUUID();

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_earmarkchk');
  await bootstrapCompatibilityObjects(db().client);
  await replayMigrations(db().client, migrationFiles());
  await db().client.query(
    `insert into auth.users(id, email, email_confirmed_at)
     values ($1, 'owner@budget.invalid', now())`,
    [actor],
  );
}, 120_000);

afterAll(async () => {
  if (database) await disposeDisposableDatabase(database);
}, 30_000);

// Harness and helpers copied verbatim from tests/db/goal-funding.integration.test.ts
// (freshSpace, wallet setup, createGoal, reserve, linkPurchase, reverseEarmark),
// except TODAY/headFor, per this task's controller ruling: this file uses real
// UTC "today" instead of the fixture-fixed 2026-09-14, so the reproducer fails
// on the balance bug (23514) rather than on a stale-head mismatch (40001).
const TODAY = new Date().toISOString().slice(0, 10);

async function freshSpace(name: string, kind: 'personal' | 'household' = 'personal'): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const space = await db().client.query<{ id: string }>(
      'select id from public.create_space($1, $2) limit 2', [name, kind],
    );
    return space.rows[0]!.id;
  });
}

async function usdWallet(spaceId: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const wallet = await db().client.query<{ id: string }>(
      "select id from public.create_wallet($1, 'Cash', 'USD') limit 2", [spaceId],
    );
    return wallet.rows[0]!.id;
  });
}

async function recordIncome(spaceId: string, walletId: string, date: string, amountMinor: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ id: string }>(
      `select id from public.record_financial_event($1,$2,'income',$3::date,$4::jsonb) limit 2`,
      [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor }])],
    );
    return result.rows[0]!.id;
  });
}

async function recordExpense(spaceId: string, walletId: string, date: string, amountMinor: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ id: string }>(
      `select id from public.record_financial_event($1,$2,'expense',$3::date,$4::jsonb) limit 2`,
      [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor: `-${amountMinor}` }])],
    );
    return result.rows[0]!.id;
  });
}

function definition(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: 'reserve', currency: 'USD', nameEn: 'Goal', nameAr: null, note: null,
    targetMinor: '600000', deadline: null, contributionMode: 'manual_monthly',
    monthlyAmountMinor: '0', priority: 0,
    ...overrides,
  };
}

async function createGoal(spaceId: string, overrides: Partial<Record<string, unknown>> = {}): Promise<{ goalId: string; revisionId: string }> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ create_goal_plan: { goalId: string; revisionId: string } }>(
      'select public.create_goal_plan($1,$2,$3,$4::jsonb,$5::jsonb)',
      [spaceId, randomUUID(), randomUUID(), JSON.stringify(definition(overrides)), '[]'],
    );
    return result.rows[0]!.create_goal_plan;
  });
}

async function financingState(goalId: string, asOf: string): Promise<{ earmarkedMinor: string; fulfilledMinor: string; head: string }> {
  const result = await db().client.query<{ earmarked_minor: string; fulfilled_minor: string; head: string }>(
    'select earmarked_minor::text, fulfilled_minor::text, head from private.goal_financing_state($1,$2::date)',
    [goalId, asOf],
  );
  const row = result.rows[0]!;
  return { earmarkedMinor: row.earmarked_minor, fulfilledMinor: row.fulfilled_minor, head: row.head };
}

async function headFor(goalId: string, asOf = TODAY): Promise<string> {
  return (await financingState(goalId, asOf)).head;
}

async function reserve(spaceId: string, goalId: string, amountMinor: string, acceptUnderfunded: boolean, requestId?: string): Promise<{ eventId: string; goalId: string }> {
  const expectedHead = await headFor(goalId);
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ record_goal_earmark: { eventId: string; goalId: string } }>(
      'select public.record_goal_earmark($1,$2,$3,$4,$5,$6,$7)',
      [spaceId, requestId ?? randomUUID(), goalId, 'reserve', amountMinor, expectedHead, acceptUnderfunded],
    );
    return result.rows[0]!.record_goal_earmark;
  });
}

async function reverseEarmark(spaceId: string, eventId: string, goalIds: string[]): Promise<{ eventId: string }> {
  const heads = await Promise.all(goalIds.map(async (goalId) => ({ goalId, head: await headFor(goalId) })));
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ reverse_goal_earmark: { eventId: string } }>(
      'select public.reverse_goal_earmark($1,$2,$3,$4::jsonb)',
      [spaceId, randomUUID(), eventId, JSON.stringify(heads)],
    );
    return result.rows[0]!.reverse_goal_earmark;
  });
}

async function linkPurchase(spaceId: string, expenseEventId: string, lines: Array<{ goalId: string; amountMinor: string }>, requestId?: string): Promise<{ linkIds: string[] }> {
  const withHeads = await Promise.all(lines.map(async (line) => ({ ...line, expectedHead: await headFor(line.goalId) })));
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ link_goal_purchase: { linkIds: string[] } }>(
      'select public.link_goal_purchase($1,$2,$3,$4::jsonb)',
      [spaceId, requestId ?? randomUUID(), expenseEventId, JSON.stringify(withHeads)],
    );
    return result.rows[0]!.link_goal_purchase;
  });
}

/** A USD wallet funded with >= 1500 minor units of income (today), plus one
 * expense of the given amount (also dated today, so link_goal_purchase's
 * "not before its effective date" and "not before same-day reserve" guards
 * never fire). An amount of '0' skips recording any expense at all --
 * wallet_movements forbids a zero-amount row -- for scenarios that never link
 * a purchase. */
async function fundedSpaceWithExpense(expenseAmountMinor: string): Promise<{ spaceId: string; expenseEventId: string }> {
  const spaceId = await freshSpace('Earmark check scenario');
  const wallet = await usdWallet(spaceId);
  await recordIncome(spaceId, wallet, TODAY, '1500');
  const expenseEventId = expenseAmountMinor === '0'
    ? ''
    : await recordExpense(spaceId, wallet, TODAY, expenseAmountMinor);
  return { spaceId, expenseEventId };
}

/** Inserts a 'reserve' earmark event and its single line directly (as the
 * table owner, bypassing record_goal_earmark), using exactly the column
 * lists supabase/migrations/20260914140000_goals_schema.sql declares. Runs
 * as one transaction because private.check_goal_earmark_event is a deferred
 * constraint trigger that fires at COMMIT. Omitting effectiveDate lets
 * goal_earmark_events.effective_date take its default (UTC today); passing
 * one sets it explicitly, e.g. to a future date no RPC could ever write. */
async function insertRawReserve(spaceId: string, goalId: string, amountMinor: string, effectiveDate?: string): Promise<void> {
  const goal = await db().client.query<{ currency: 'USD' | 'LBP' }>(
    'select currency from public.goals where id = $1', [goalId],
  );
  const currency = goal.rows[0]!.currency;
  await inTransaction(db().client, async () => {
    const event = effectiveDate === undefined
      ? await db().client.query<{ id: string }>(
          `insert into public.goal_earmark_events (space_id, currency, operation, line_count, request_id, actor_id)
           values ($1,$2,'reserve',1,$3,$4) returning id`,
          [spaceId, currency, randomUUID(), actor],
        )
      : await db().client.query<{ id: string }>(
          `insert into public.goal_earmark_events (space_id, currency, operation, line_count, effective_date, request_id, actor_id)
           values ($1,$2,'reserve',1,$3::date,$4,$5) returning id`,
          [spaceId, currency, effectiveDate, randomUUID(), actor],
        );
    await db().client.query(
      `insert into public.goal_earmark_lines (event_id, goal_id, space_id, currency, amount_minor)
       values ($1,$2,$3,$4,$5)`,
      [event.rows[0]!.id, goalId, spaceId, currency, amountMinor],
    );
  });
}

describe('goal earmark balance check', () => {
  it('allows topping a goal back up after a linked purchase', async () => {
    const { spaceId, expenseEventId } = await fundedSpaceWithExpense('400');   // build from the copied helpers: USD wallet with ≥ 1500 income, one 400 USD expense
    const { goalId } = await createGoal(spaceId, { kind: 'purchase', targetMinor: '1000' });
    await reserve(spaceId, goalId, '500', false);
    await linkPurchase(spaceId, expenseEventId, [{ goalId, amountMinor: '400' }]);
    await expect(reserve(spaceId, goalId, '500', false)).resolves.toMatchObject({ goalId });
  });

  it('still refuses a reserve beyond the remaining room', async () => {
    const { spaceId, expenseEventId } = await fundedSpaceWithExpense('400');
    const { goalId } = await createGoal(spaceId, { kind: 'purchase', targetMinor: '1000' });
    await reserve(spaceId, goalId, '500', false);
    await linkPurchase(spaceId, expenseEventId, [{ goalId, amountMinor: '400' }]);
    await reserve(spaceId, goalId, '500', false);
    await expect(reserve(spaceId, goalId, '1', false)).rejects.toMatchObject({ message: expect.stringContaining('remaining room') });
  });

  it('refuses an over-target earmark written directly, bypassing the command (the trigger alone)', async () => {
    const { spaceId } = await fundedSpaceWithExpense('0');
    const { goalId } = await createGoal(spaceId, { kind: 'reserve', targetMinor: '1000' });
    await reserve(spaceId, goalId, '900', false);
    // As the table owner: copy the goal_earmark_events/goal_earmark_lines column
    // lists from supabase/migrations/20260914140000_goals_schema.sql and insert
    // one 'reserve' event of 200 for goalId in a single transaction.
    await expect(insertRawReserve(spaceId, goalId, '200')).rejects.toMatchObject({ code: '23514', message: 'goal_earmark_balance_invalid' });
  });

  // Controller ruling 4(a): a raw insert dated in the future must not be able
  // to hide its own over-target contribution from the check by outrunning
  // "today" -- this is the regression private.goal_financing_state's as_of
  // (greatest(today, the event's own effective_date)) exists to close.
  it('refuses a raw future-dated earmark that would push a goal over target', async () => {
    const { spaceId } = await fundedSpaceWithExpense('0');
    const { goalId } = await createGoal(spaceId, { kind: 'reserve', targetMinor: '1000' });
    await reserve(spaceId, goalId, '900', false);
    const future = new Date(`${TODAY}T00:00:00.000Z`);
    future.setUTCDate(future.getUTCDate() + 7);
    await expect(insertRawReserve(spaceId, goalId, '200', future.toISOString().slice(0, 10)))
      .rejects.toMatchObject({ code: '23514', message: 'goal_earmark_balance_invalid' });
  });

  // Controller ruling 4(b): the same gross, date-blind sum that double-counted
  // a linked purchase also let an API-only reverse push the net earmark below
  // zero unnoticed -- this is that hole, exercised through the real API.
  it('refuses a reverse that would push the net earmark below zero after a linked purchase', async () => {
    const { spaceId, expenseEventId } = await fundedSpaceWithExpense('400');
    const { goalId } = await createGoal(spaceId, { kind: 'purchase', targetMinor: '1000' });
    const reserved = await reserve(spaceId, goalId, '500', false);
    await linkPurchase(spaceId, expenseEventId, [{ goalId, amountMinor: '400' }]);
    await expect(reverseEarmark(spaceId, reserved.eventId, [goalId]))
      .rejects.toMatchObject({ code: '23514', message: 'goal_earmark_balance_invalid' });
  });
});
