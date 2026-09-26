import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction,
  type DisposableDatabase,
} from './disposable-database.js';

let database: DisposableDatabase | undefined;
const actor = randomUUID();
const outsider = randomUUID();

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_catpage');
  await bootstrapCompatibilityObjects(db().client);
  await replayMigrations(db().client, migrationFiles());
  await db().client.query(
    `insert into auth.users(id, email, email_confirmed_at)
     values ($1, 'owner@budget.invalid', now()), ($2, 'outsider@budget.invalid', now())`,
    [actor, outsider],
  );
}, 120_000);

afterAll(async () => {
  if (database) await disposeDisposableDatabase(database);
}, 30_000);

async function freshSpace(name: string, kind: 'personal' | 'household' = 'personal'): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const space = await db().client.query<{ id: string }>(
      "select id from public.create_space($1, $2) limit 2", [name, kind],
    );
    return space.rows[0]!.id;
  });
}

async function expenseRootCategory(spaceId: string, name: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const category = await db().client.query<{ id: string }>(
      "select id from public.create_category($1,$2,'expense',$3,null) limit 2", [spaceId, randomUUID(), name],
    );
    return category.rows[0]!.id;
  });
}

async function subcategoryOf(spaceId: string, parentId: string, name: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const category = await db().client.query<{ id: string }>(
      "select id from public.create_subcategory($1,$2,$3,$4,null) limit 2", [spaceId, randomUUID(), parentId, name],
    );
    return category.rows[0]!.id;
  });
}

async function archiveCategory(spaceId: string, categoryId: string): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () =>
    db().client.query('select * from public.archive_category($1,$2,$3)', [spaceId, randomUUID(), categoryId]));
}

async function usdWallet(spaceId: string, name = 'Cash USD'): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const wallet = await db().client.query<{ id: string }>(
      "select id from public.create_wallet($1, $2, 'USD') limit 2", [spaceId, name],
    );
    return wallet.rows[0]!.id;
  });
}

async function lbpWallet(spaceId: string, name = 'Cash LBP'): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const wallet = await db().client.query<{ id: string }>(
      "select id from public.create_wallet($1, $2, 'LBP') limit 2", [spaceId, name],
    );
    return wallet.rows[0]!.id;
  });
}

async function recordExpense(
  spaceId: string, walletId: string, amountMinor: string, date: string, categoryId: string | null = null,
): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const event = categoryId === null
      ? await db().client.query<{ id: string }>(
        `select id from public.record_financial_event($1,$2,'expense',$3::date,$4::jsonb) limit 2`,
        [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor }])],
      )
      : await db().client.query<{ id: string }>(
        `select id from public.record_categorized_financial_event($1,$2,'expense',$3::date,$4::jsonb,$5) limit 2`,
        [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor }]), categoryId],
      );
    return event.rows[0]!.id;
  });
}

async function reverseEvent(spaceId: string, eventId: string, date: string): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () =>
    db().client.query("select * from public.reverse_financial_event($1,$2,$3,$4::date) limit 2", [spaceId, randomUUID(), eventId, date]));
}

async function setTarget(spaceId: string, categoryId: string, currency: 'USD' | 'LBP', amountMinor: string): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
    "select * from public.set_monthly_category_target($1,$2,$3,'2026-09-01'::date,$4::public.currency_code,$5,null) limit 2",
    [spaceId, randomUUID(), categoryId, currency, amountMinor]));
}

interface CategoryPageRow {
  category_id: string;
  category_created_at: string;
  name_en: string;
  name_ar: string | null;
  archived_at: string | null;
  target_minor: string;
  actual_spent_minor: string;
  remaining_minor: string;
  overspent_minor: string;
  target_revision_id: string | null;
  has_more: boolean;
}

async function page(
  spaceId: string,
  currency: 'USD' | 'LBP',
  after: { createdAt: string; id: string } | null = null,
  limit = 100,
  user: string = actor,
): Promise<CategoryPageRow[]> {
  return withAuthenticatedTransaction(db().client, user, async () => (await db().client.query<CategoryPageRow>(
    'select * from public.monthly_budget_category_page_v3($1, $2::date, $3::public.currency_code, $4, $5, $6)',
    [spaceId, '2026-09-01', currency, after?.createdAt ?? null, after?.id ?? null, limit],
  )).rows);
}

describe('monthly_budget_category_page_v3', () => {
  it('rolls subcategory spending up into its parent, and never lists the subcategory itself', async () => {
    const spaceId = await freshSpace('Rollup');
    const cash = await usdWallet(spaceId);
    const food = await expenseRootCategory(spaceId, 'Food');
    const groceries = await subcategoryOf(spaceId, food, 'Groceries');
    await setTarget(spaceId, food, 'USD', '40000');
    await recordExpense(spaceId, cash, '-12000', '2026-09-12', groceries);

    const rows = await page(spaceId, 'USD');
    const foodRow = rows.find((row) => row.category_id === food);
    expect(foodRow?.actual_spent_minor).toBe('12000');
    expect(rows.some((row) => row.category_id === groceries)).toBe(false);
  });

  it('lists a parent with no target and no spending yet, so it can be given one', async () => {
    const spaceId = await freshSpace('No target yet');
    await usdWallet(spaceId);
    const rent = await expenseRootCategory(spaceId, 'Rent');

    const rows = await page(spaceId, 'USD');
    const rentRow = rows.find((row) => row.category_id === rent);
    expect(rentRow).toBeDefined();
    expect(rentRow?.target_minor).toBe('0');
    expect(rentRow?.actual_spent_minor).toBe('0');
  });

  it('hides an archived parent with neither a target nor spending, but keeps one that has either', async () => {
    const spaceId = await freshSpace('Archived visibility');
    await usdWallet(spaceId);
    const bare = await expenseRootCategory(spaceId, 'Bare archived');
    const funded = await expenseRootCategory(spaceId, 'Funded archived');
    // Target must be set before archiving: set_monthly_category_target rejects
    // a positive target on an already-archived category.
    await setTarget(spaceId, funded, 'USD', '5000');
    await archiveCategory(spaceId, bare);
    await archiveCategory(spaceId, funded);

    const rows = await page(spaceId, 'USD');
    expect(rows.some((row) => row.category_id === bare)).toBe(false);
    const fundedRow = rows.find((row) => row.category_id === funded);
    expect(fundedRow).toBeDefined();
    expect(fundedRow?.archived_at).not.toBeNull();
  });

  it('keeps currency pages isolated: an LBP expense on a category does not change its USD page', async () => {
    const spaceId = await freshSpace('Currency isolation');
    const cashLbp = await lbpWallet(spaceId);
    const food = await expenseRootCategory(spaceId, 'Food');
    await setTarget(spaceId, food, 'USD', '40000');
    await recordExpense(spaceId, cashLbp, '-900000', '2026-09-05', food);

    const usdRows = await page(spaceId, 'USD');
    expect(usdRows.find((row) => row.category_id === food)?.actual_spent_minor).toBe('0');

    const lbpRows = await page(spaceId, 'LBP');
    expect(lbpRows.find((row) => row.category_id === food)?.actual_spent_minor).toBe('900000');
  });

  it('nets a same-day reversal back to zero', async () => {
    const spaceId = await freshSpace('Reversal nets out');
    const cash = await usdWallet(spaceId);
    const food = await expenseRootCategory(spaceId, 'Food');
    const event = await recordExpense(spaceId, cash, '-5000', '2026-09-08', food);
    await reverseEvent(spaceId, event, '2026-09-08');

    const rows = await page(spaceId, 'USD');
    expect(rows.find((row) => row.category_id === food)?.actual_spent_minor).toBe('0');
  });

  it('pages three parents with a limit of two, and the cursor reaches the third with no more left', async () => {
    const spaceId = await freshSpace('Paging');
    await usdWallet(spaceId);
    const first = await expenseRootCategory(spaceId, 'Alpha');
    const second = await expenseRootCategory(spaceId, 'Bravo');
    const third = await expenseRootCategory(spaceId, 'Charlie');

    const firstPage = await page(spaceId, 'USD', null, 2);
    expect(firstPage).toHaveLength(2);
    expect(firstPage.every((row) => row.has_more)).toBe(true);

    const last = firstPage.at(-1)!;
    const secondPage = await page(
      spaceId, 'USD', { createdAt: last.category_created_at, id: last.category_id }, 2,
    );
    expect(secondPage).toHaveLength(1);
    expect(secondPage[0]!.has_more).toBe(false);

    const allIds = [...firstPage, ...secondPage].map((row) => row.category_id).sort();
    expect(allIds).toEqual([first, second, third].sort());
  });

  it('allows an active household member to read, and rejects an outsider', async () => {
    const spaceId = await freshSpace('Access control', 'household');
    const member = randomUUID();
    await db().client.query(
      `insert into auth.users(id, email, email_confirmed_at) values ($1,'catpage-member@budget.invalid', now())`,
      [member],
    );
    await db().client.query(
      `insert into public.space_memberships (space_id, user_id, role, status) values ($1,$2,'member','active')`,
      [spaceId, member],
    );
    const food = await expenseRootCategory(spaceId, 'Food');
    await setTarget(spaceId, food, 'USD', '1000');

    const memberRows = await page(spaceId, 'USD', null, 100, member);
    expect(memberRows.some((row) => row.category_id === food)).toBe(true);

    await expect(page(spaceId, 'USD', null, 100, outsider)).rejects.toMatchObject({ code: '42501' });
  });
});
