import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction,
  type DisposableDatabase,
} from './disposable-database.js';

// W4a-2 stage B slice 1: the reporting reads scan the payday-anchored period.
// Payday 1 must be byte-identical to the calendar month; a payday of 25 must move
// a mid-month expense into the period that started on the 25th of the PRIOR month.
let database: DisposableDatabase | undefined;
const actor = randomUUID();

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_spacereport');
  await bootstrapCompatibilityObjects(db().client);
  await replayMigrations(db().client, migrationFiles());
  await db().client.query(
    `insert into auth.users(id, email, email_confirmed_at)
     values ($1, 'owner@budget.invalid', now())`, [actor],
  );
}, 120_000);

afterAll(async () => {
  if (database) await disposeDisposableDatabase(database);
}, 30_000);

async function freshSpace(name: string, payday: number): Promise<string> {
  const id = await withAuthenticatedTransaction(db().client, actor, async () => {
    const space = await db().client.query<{ id: string }>(
      "select id from public.create_space($1, 'personal') limit 2", [name],
    );
    return space.rows[0]!.id;
  });
  await db().client.query('update public.spaces set payday_day = $2 where id = $1', [id, payday]);
  return id;
}

async function usdWallet(spaceId: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const wallet = await db().client.query<{ id: string }>(
      "select id from public.create_wallet($1, 'Cash', 'USD') limit 2", [spaceId],
    );
    return wallet.rows[0]!.id;
  });
}

async function recordExpense(spaceId: string, walletId: string, date: string, amountMinor: string): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, async () => {
    await db().client.query(
      `select id from public.record_financial_event($1, $2, 'expense', $3::date, $4::jsonb) limit 2`,
      [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor }])],
    );
  });
}

async function recordCategorizedExpense(spaceId: string, walletId: string, date: string, amountMinor: string, categoryId: string): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, async () => {
    await db().client.query(
      `select id from public.record_categorized_financial_event($1, $2, 'expense', $3::date, $4::jsonb, $5) limit 2`,
      [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor }]), categoryId],
    );
  });
}

async function currentExpense(spaceId: string, anchorMonth: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const rows = await db().client.query<{ expense: string }>(
      `select expense_net_minor::text as expense from public.report_monthly_cash_summary($1, $2::date)
       where period_role = 'current' and currency = 'USD' limit 2`,
      [spaceId, anchorMonth],
    );
    return rows.rows[0]!.expense;
  });
}

describe('anchored reporting reads (W4a-2 stage B slice 1)', () => {
  it('payday 1 keeps a mid-month expense in its calendar month', async () => {
    const id = await freshSpace('Report calendar', 1);
    const wallet = await usdWallet(id);
    await recordExpense(id, wallet, '2026-09-10', '-5000');
    expect(await currentExpense(id, '2026-09-01')).toBe('5000');
    expect(await currentExpense(id, '2026-08-01')).toBe('0');
  });

  it('a payday of 25 moves the same expense into the prior month\'s period', async () => {
    const id = await freshSpace('Report payday 25', 25);
    const wallet = await usdWallet(id);
    // 2026-09-10 falls in the period [2026-08-25, 2026-09-25), keyed 2026-08-01.
    await recordExpense(id, wallet, '2026-09-10', '-5000');
    expect(await currentExpense(id, '2026-08-01')).toBe('5000');
    expect(await currentExpense(id, '2026-09-01')).toBe('0');
    // ...and an expense ON the 25th belongs to the new period.
    await recordExpense(id, wallet, '2026-09-25', '-3000');
    expect(await currentExpense(id, '2026-09-01')).toBe('3000');
    expect(await currentExpense(id, '2026-08-01')).toBe('5000');
  });

  it('the category report honors the anchored window too', async () => {
    const id = await freshSpace('Category report payday 25', 25);
    const wallet = await usdWallet(id);
    const category = await withAuthenticatedTransaction(db().client, actor, async () => {
      const rows = await db().client.query<{ id: string }>(
        "select id from public.create_category($1, $2, 'expense', 'Groceries', null) limit 2",
        [id, randomUUID()],
      );
      return rows.rows[0]!.id;
    });
    await recordCategorizedExpense(id, wallet, '2026-09-10', '-7000', category);

    async function actualRows(anchorMonth: string): Promise<readonly { category_key: string; actual: string }[]> {
      return withAuthenticatedTransaction(db().client, actor, async () => {
        const rows = await db().client.query<{ category_key: string; actual: string }>(
          `select category_key, actual_net_minor::text as actual
             from public.report_category_actual_vs_budget($1, $2::date) order by category_key limit 100`,
          [id, anchorMonth],
        );
        return rows.rows;
      });
    }

    expect(await actualRows('2026-08-01')).toEqual([{ category_key: category, actual: '7000' }]);
    expect(await actualRows('2026-09-01')).toEqual([]);
  });
});
