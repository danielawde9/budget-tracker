import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction, withRollback,
  type DisposableDatabase,
} from './disposable-database.js';

let database: DisposableDatabase | undefined;
const actor = randomUUID();
const outsider = randomUUID();

interface SearchParams {
  from?: string | null;
  to?: string | null;
  walletId?: string | null;
  rootCategoryId?: string | null;
  payeeId?: string | null;
  minAmountMinor?: string | null;
  maxAmountMinor?: string | null;
  query?: string | null;
  cursor?: string | null;
  limit?: number | null;
}

interface EventRow {
  id: string;
  kind: string;
  effective_date: string;
  created_at: string;
}

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_jsearch');
  await bootstrapCompatibilityObjects(db().client);
  await replayMigrations(db().client, migrationFiles());
  await db().client.query(
    `insert into auth.users(id, email, email_confirmed_at)
     values ($1, 'owner@budget.invalid', now()), ($2, 'outsider@budget.invalid', now())`,
    [actor, outsider],
  );
}, 300_000);

afterAll(async () => {
  if (database) await disposeDisposableDatabase(database);
}, 30_000);

async function freshSpace(name: string, kind: 'personal' | 'household' = 'personal'): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const space = await db().client.query<{ id: string }>(
      'select id from public.create_space($1, $2) limit 2', [name, kind],
    );
    return space.rows[0]!.id;
  });
}

async function createWallet(spaceId: string, name: string, currency: 'USD' | 'LBP' = 'USD'): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const wallet = await db().client.query<{ id: string }>(
      'select id from public.create_wallet($1, $2, $3) limit 2', [spaceId, name, currency],
    );
    return wallet.rows[0]!.id;
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

function recordEvent(
  spaceId: string, kind: 'income' | 'expense', walletId: string, amountMinor: string, date: string,
): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const event = await db().client.query<{ id: string }>(
      `select id from public.record_financial_event($1,$2,$3,$4::date,$5::jsonb) limit 2`,
      [spaceId, randomUUID(), kind, date, JSON.stringify([{ walletId, amountMinor }])],
    );
    return event.rows[0]!.id;
  });
}

function recordCategorizedEvent(
  spaceId: string, walletId: string, amountMinor: string, date: string, categoryId: string,
): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const event = await db().client.query<{ id: string }>(
      `select id from public.record_categorized_financial_event($1,$2,'expense',$3::date,$4::jsonb,$5) limit 2`,
      [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor }]), categoryId],
    );
    return event.rows[0]!.id;
  });
}

async function recordEventBatch(
  spaceId: string, kind: 'income' | 'expense', walletId: string, date: string, count: number,
): Promise<string[]> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const event = await db().client.query<{ id: string }>(
        `select id from public.record_financial_event($1,$2,$3,$4::date,$5::jsonb) limit 2`,
        [spaceId, randomUUID(), kind, date, JSON.stringify([{ walletId, amountMinor: String(1000 + index) }])],
      );
      ids.push(event.rows[0]!.id);
    }
    return ids;
  });
}

async function describeEvent(
  spaceId: string, eventId: string, payeeName: string | null, note: string | null,
): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () =>
    db().client.query('select * from public.describe_financial_event($1,$2,$3,$4,$5) limit 2', [spaceId, randomUUID(), eventId, payeeName, note]));
}

async function payeeIdByName(spaceId: string, name: string): Promise<string> {
  const result = await db().client.query<{ id: string }>(
    'select id from public.payees where space_id = $1 and name = $2', [spaceId, name],
  );
  return result.rows[0]!.id;
}

async function searchEvents(spaceId: string, params: SearchParams, asActor: string = actor): Promise<EventRow[]> {
  return withAuthenticatedTransaction(db().client, asActor, async () => {
    const result = await db().client.query<EventRow>(
      `select id, kind, effective_date, created_at
       from public.journal_search_page(
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
       )`,
      [
        spaceId,
        params.from ?? null,
        params.to ?? null,
        params.walletId ?? null,
        params.rootCategoryId ?? null,
        params.payeeId ?? null,
        params.minAmountMinor ?? null,
        params.maxAmountMinor ?? null,
        params.query ?? null,
        params.cursor ?? null,
        params.limit ?? null,
      ],
    );
    return result.rows;
  });
}

async function searchPage(spaceId: string, params: SearchParams): Promise<{ events: EventRow[]; nextCursor: string | null }> {
  const limit = params.limit ?? 50;
  const rows = await searchEvents(spaceId, { ...params, limit: limit + 1 });
  const events = rows.slice(0, limit);
  const last = events.at(-1);
  const lastDate = new Date(last?.effective_date ?? '');
  const dateText = `${lastDate.getFullYear()}-${String(lastDate.getMonth() + 1).padStart(2, '0')}-${String(lastDate.getDate()).padStart(2, '0')}`;
  const nextCursor = rows.length > limit && last
    ? `${dateText}|${new Date(last.created_at).toISOString()}|${last.id}`
    : null;
  return { events, nextCursor };
}

describe('journal_search_page', () => {
  it('matches note, payee, wallet, and category names case-insensitively, including apostrophes and Arabic', async () => {
    const space = await freshSpace('search text');
    const wallet = await createWallet(space, 'Checking');
    const otherWallet = await createWallet(space, 'Savings');
    const root = await expenseRootCategory(space, 'Groceries');
    const child = await subcategoryOf(space, root, "Farmer's Market");

    const noted = await recordEvent(space, 'expense', wallet, '-5000', '2026-09-01');
    await describeEvent(space, noted, null, "O'Brien birthday gift");
    const payee = await recordEvent(space, 'expense', wallet, '-6000', '2026-09-02');
    await describeEvent(space, payee, 'Landlord', 'rent');
    const walletNamed = await recordEvent(space, 'expense', otherWallet, '-7000', '2026-09-03');
    const categorized = await recordCategorizedEvent(space, wallet, '-8000', '2026-09-04', child);
    await recordEvent(space, 'income', wallet, '9000', '2026-09-05');

    expect((await searchEvents(space, { query: "o'brIEN" })).map((row) => row.id)).toEqual([noted]);
    expect((await searchEvents(space, { query: 'landlord' })).map((row) => row.id)).toEqual([payee]);
    expect((await searchEvents(space, { query: 'savings' })).map((row) => row.id)).toEqual([walletNamed]);
    expect((await searchEvents(space, { query: "farmer's market" })).map((row) => row.id)).toEqual([categorized]);
    // Root name also matches its children.
    expect((await searchEvents(space, { query: 'groceries' })).map((row) => row.id)).toEqual([categorized]);
    expect(await searchEvents(space, { query: 'absent-term' })).toEqual([]);
  });

  it('matches Arabic text as authored', async () => {
    const space = await freshSpace('arabic search');
    const wallet = await createWallet(space, 'Cash');
    const noted = await recordEvent(space, 'expense', wallet, '-5000', '2026-09-01');
    await describeEvent(space, noted, null, 'مصروف المدرسة');
    await recordEvent(space, 'income', wallet, '5000', '2026-09-02');

    expect((await searchEvents(space, { query: 'المدرسة' })).map((row) => row.id)).toEqual([noted]);
  });

  it('treats percent and underscore in the query literally', async () => {
    const space = await freshSpace('literal query');
    const wallet = await createWallet(space, 'Cash');
    const noted = await recordEvent(space, 'expense', wallet, '-5000', '2026-09-01');
    await describeEvent(space, noted, null, 'rate is 5% of total');
    const underscored = await recordEvent(space, 'expense', wallet, '-6000', '2026-09-02');
    await describeEvent(space, underscored, null, 'snake_case note');

    expect((await searchEvents(space, { query: '5% of' })).map((row) => row.id)).toEqual([noted]);
    expect((await searchEvents(space, { query: 'snake_case' })).map((row) => row.id)).toEqual([underscored]);
    // A bare wildcard matches only a literal occurrence, never everything.
    expect((await searchEvents(space, { query: '%' })).map((row) => row.id)).toEqual([noted]);
    expect(await searchEvents(space, { query: 'zzz-no-hit' })).toEqual([]);
  });

  it('applies inclusive date bounds and rejects inverted or overlong windows', async () => {
    const space = await freshSpace('date bounds');
    const wallet = await createWallet(space, 'Cash');
    const early = await recordEvent(space, 'income', wallet, '1000', '2026-01-10');
    const middle = await recordEvent(space, 'income', wallet, '1000', '2026-01-15');
    const late = await recordEvent(space, 'income', wallet, '1000', '2026-02-20');

    const rows = await searchEvents(space, { from: '2026-01-10', to: '2026-02-20' });
    expect(rows.map((row) => row.id).sort()).toEqual([early, middle, late].sort());
    // Inclusive edges: starting after the middle event drops it; ending at it keeps it.
    expect((await searchEvents(space, { from: '2026-01-16', to: '2026-02-20' })).map((row) => row.id)).toEqual([late]);
    expect((await searchEvents(space, { to: '2026-01-15' })).map((row) => row.id).sort())
      .toEqual([early, middle].sort());

    await expect(searchEvents(space, { from: '2026-02-20', to: '2026-01-10' })).rejects.toThrow(/invalid_input/);
    await expect(searchEvents(space, { from: '2026-01-01', to: '2027-01-03' })).rejects.toThrow(/invalid_input/);
    await expect(searchEvents(space, { query: 'x'.repeat(121) })).rejects.toThrow(/invalid_input/);
    await expect(searchEvents(space, { cursor: 'not-a-cursor' })).rejects.toThrow(/invalid_input/);
  });

  it('pages with a strict keyset across same-timestamp ties and ends with no cursor', async () => {
    const space = await freshSpace('keyset ties');
    const wallet = await createWallet(space, 'Cash');
    // One transaction gives every event the same created_at, forcing the id tiebreak.
    const ids = await recordEventBatch(space, 'income', wallet, '2026-09-10', 3);

    const first = await searchPage(space, { limit: 2 });
    expect(first.events).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const remaining = ids.filter((id) => !first.events.some((row) => row.id === id));

    const second = await searchPage(space, { limit: 2, cursor: first.nextCursor });
    expect(second.events.map((row) => row.id)).toEqual(remaining);
    expect(second.nextCursor).toBeNull();
  });

  it('rejects out-of-range limits', async () => {
    const space = await freshSpace('limit bounds');
    await expect(searchEvents(space, { limit: 0 })).rejects.toThrow(/invalid_input/);
    await expect(searchEvents(space, { limit: 101 })).rejects.toThrow(/invalid_input/);
  });

  it('composes wallet, root-category, payee, and amount filters', async () => {
    const space = await freshSpace('filter composition');
    const walletA = await createWallet(space, 'Cash');
    const walletB = await createWallet(space, 'Bank');
    const root = await expenseRootCategory(space, 'Utilities');
    const child = await subcategoryOf(space, root, 'Electricity');

    const onA = await recordEvent(space, 'expense', walletA, '-5000', '2026-09-01');
    const smallB = await recordCategorizedEvent(space, walletB, '-3000', '2026-09-02', child);
    const largeB = await recordCategorizedEvent(space, walletB, '-25000', '2026-09-03', child);
    const payee = await recordEvent(space, 'expense', walletA, '-9000', '2026-09-04');
    await describeEvent(space, payee, 'Electric Company', 'monthly bill');

    expect((await searchEvents(space, { walletId: walletB })).map((row) => row.id).sort())
      .toEqual([smallB, largeB].sort());
    expect((await searchEvents(space, { rootCategoryId: root })).map((row) => row.id).sort())
      .toEqual([smallB, largeB].sort());
    expect((await searchEvents(space, { payeeId: await payeeIdByName(space, 'Electric Company') }))
      .map((row) => row.id)).toEqual([payee]);
    expect((await searchEvents(space, { minAmountMinor: '-20000', maxAmountMinor: '-4000' })).map((row) => row.id).sort())
      .toEqual([onA, payee].sort());
    // Everything at once.
    expect((await searchEvents(space, {
      walletId: walletB, rootCategoryId: root, minAmountMinor: '-30000', maxAmountMinor: '-20000', query: 'electricity',
    })).map((row) => row.id)).toEqual([largeB]);
  });

  it('returns nothing for non-members and never crosses spaces', async () => {
    const space = await freshSpace('isolation a');
    const otherSpace = await freshSpace('isolation b');
    const wallet = await createWallet(space, 'Cash');
    const otherWallet = await createWallet(otherSpace, 'Cash');
    const home = await recordEvent(space, 'income', wallet, '1000', '2026-09-01');
    const away = await recordEvent(otherSpace, 'income', otherWallet, '1000', '2026-09-01');

    expect(await searchEvents(space, {}, outsider)).toEqual([]);
    expect((await searchEvents(space, {})).map((row) => row.id)).toEqual([home]);
    expect((await searchEvents(otherSpace, {})).map((row) => row.id)).toEqual([away]);
  });

  it('rejects anon and service_role calling the search directly', async () => {
    const space = await freshSpace('grants');
    const wallet = await createWallet(space, 'Cash');
    await recordEvent(space, 'income', wallet, '1000', '2026-09-01');

    await withRollback(db().client, async () => {
      await db().client.query('set local role anon');
      await expect(db().client.query(
        'select id from public.journal_search_page($1) limit 1', [space],
      )).rejects.toMatchObject({ code: '42501' });
    });
    await withRollback(db().client, async () => {
      await db().client.query('set local role service_role');
      await expect(db().client.query(
        'select id from public.journal_search_page($1) limit 1', [space],
      )).rejects.toMatchObject({ code: '42501' });
    });
  });
});
