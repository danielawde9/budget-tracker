import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import {
  asUser,
  closeDatabase,
  databaseQuery,
  queryAsRole,
  queryAsUser,
  type CategoryKind,
} from './test-database.js';

const ownerId = '00000000-0000-4000-8000-000000000001';
const otherUserId = '00000000-0000-4000-8000-000000000002';

afterAll(async () => {
  await closeDatabase();
});

async function createCategory(
  spaceId: string,
  kind: CategoryKind,
  nameEn?: string | null,
  nameAr?: string | null,
): Promise<{ id: string }> {
  return asUser(ownerId).createCategory({
    spaceId,
    requestId: randomUUID(),
    kind,
    nameEn: nameEn ?? null,
    nameAr: nameAr ?? null,
  });
}

async function categoryRow(categoryId: string) {
  const rows = await queryAsUser<{
    id: string;
    space_id: string;
    kind: CategoryKind;
    name_en: string | null;
    name_ar: string | null;
    name_en_key: string | null;
    name_ar_key: string | null;
    archived_at: Date | null;
  }>(
    ownerId,
    `select id, space_id, kind, name_en, name_ar, name_en_key, name_ar_key, archived_at
     from public.categories where id = $1`,
    [categoryId],
  );
  return rows[0];
}

describe('categories foundation', () => {
  it.each([
    ['both absent', null, null],
    ['empty English', '', null],
    ['whitespace only', '   ', '\t\n'],
    ['overlong English', 'x'.repeat(121), null],
    ['overlong Arabic', null, 'س'.repeat(121)],
  ] as const)('rejects %s names without partial request state', async (_label, nameEn, nameAr) => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace(`Category validation ${randomUUID()}`, 'personal');
    const requestId = randomUUID();
    await expect(
      owner.createCategory({ spaceId: space.id, requestId, kind: 'expense', nameEn, nameAr }),
    ).rejects.toMatchObject({ code: 'P0001' });
    await expect(owner.categoryCommandResult(space.id, requestId)).resolves.toBeUndefined();
  });

  it('stores canonical EN-only, AR-only, and bilingual names without filling a missing language', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace(`Category canonical ${randomUUID()}`, 'personal');
    const english = await createCategory(space.id, 'income', '  Ｓａｌａｒｙ   Bonus  ', null);
    const arabic = await createCategory(space.id, 'expense', null, '  إيجار   المنزل  ');
    const bilingual = await createCategory(space.id, 'expense', '  Groceries  ', '  بقالة  ');

    await expect(categoryRow(english.id)).resolves.toMatchObject({
      name_en: 'Salary Bonus',
      name_ar: null,
      name_en_key: 'salary bonus',
      name_ar_key: null,
    });
    await expect(categoryRow(arabic.id)).resolves.toMatchObject({
      name_en: null,
      name_ar: 'إيجار المنزل',
      name_en_key: null,
      name_ar_key: 'ايجار المنزل',
    });
    await expect(categoryRow(bilingual.id)).resolves.toMatchObject({
      name_en: 'Groceries',
      name_ar: 'بقالة',
    });
  });

  it('enforces English NFKC, case, and whitespace uniqueness when either supplied key conflicts', async () => {
    const space = await asUser(ownerId).createSpace(`Category EN uniqueness ${randomUUID()}`, 'personal');
    await createCategory(space.id, 'income', 'Ｆｒｅｅｌａｎｃｅ  Work', 'عمل حر');

    await expect(createCategory(space.id, 'income', 'freelance work', 'دخل إضافي')).rejects.toMatchObject({
      code: 'P0001',
      message: 'an active category already uses one of the supplied normalized names',
    });
    await expect(createCategory(space.id, 'income', 'Other income', 'عمل حر')).rejects.toMatchObject({
      code: 'P0001',
      message: 'an active category already uses one of the supplied normalized names',
    });
  });

  it('pins Lucene-style Arabic normalization without stemming or transliteration', async () => {
    const space = await asUser(ownerId).createSpace(`Category AR normalization ${randomUUID()}`, 'personal');
    const collisionPairs = [
      ['أمل', 'امل'],
      ['هدى', 'هدي'],
      ['مدرسة', 'مدرسه'],
      ['إيجــارٌ', 'ايجار'],
    ] as const;

    for (const [first, duplicate] of collisionPairs) {
      await createCategory(space.id, 'expense', null, first);
      await expect(createCategory(space.id, 'expense', null, duplicate)).rejects.toMatchObject({
        code: 'P0001',
      });
    }

    const distinct = await Promise.all([
      createCategory(space.id, 'expense', null, 'كتاب'),
      createCategory(space.id, 'expense', null, 'كاتب'),
      createCategory(space.id, 'expense', 'rent', null),
      createCategory(space.id, 'expense', null, 'رنت'),
    ]);
    expect(new Set(distinct.map((row) => row.id))).toHaveLength(4);
  });

  it('scopes active uniqueness by space and kind and allows reuse after archive', async () => {
    const owner = asUser(ownerId);
    const firstSpace = await owner.createSpace(`Category first ${randomUUID()}`, 'personal');
    const secondSpace = await owner.createSpace(`Category second ${randomUUID()}`, 'personal');
    const original = await createCategory(firstSpace.id, 'expense', 'Travel', 'سفر');
    const otherKind = await createCategory(firstSpace.id, 'income', 'Travel', 'سفر');
    const otherSpace = await createCategory(secondSpace.id, 'expense', 'Travel', 'سفر');

    await owner.archiveCategory(firstSpace.id, randomUUID(), original.id);
    const replacement = await createCategory(firstSpace.id, 'expense', 'travel', 'سفر');

    expect(new Set([original.id, otherKind.id, otherSpace.id, replacement.id])).toHaveLength(4);
    await expect(categoryRow(original.id)).resolves.toMatchObject({ archived_at: expect.any(Date) });
    await expect(categoryRow(replacement.id)).resolves.toMatchObject({ archived_at: null });
  });

  it('replays create and archive idempotently and rejects changed command payloads', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace(`Category replay ${randomUUID()}`, 'personal');
    const createRequestId = randomUUID();
    const input = {
      spaceId: space.id,
      requestId: createRequestId,
      kind: 'expense' as const,
      nameEn: 'Utilities',
      nameAr: 'خدمات',
    };
    const first = await owner.createCategory(input);

    await expect(owner.createCategory({ ...input, nameEn: '  Utilities  ' })).resolves.toEqual(first);
    await expect(owner.createCategory({ ...input, kind: 'income' })).rejects.toMatchObject({ code: 'P0001' });
    await expect(owner.archiveCategory(space.id, createRequestId, first.id)).rejects.toMatchObject({ code: 'P0001' });

    const archiveRequestId = randomUUID();
    const archived = await owner.archiveCategory(space.id, archiveRequestId, first.id);
    await expect(owner.archiveCategory(space.id, archiveRequestId, first.id)).resolves.toEqual(archived);
    await expect(owner.archiveCategory(space.id, randomUUID(), first.id)).rejects.toMatchObject({ code: 'P0001' });
    await expect(owner.createCategory({ ...input, requestId: archiveRequestId })).rejects.toMatchObject({ code: 'P0001' });
  });

  it('serializes identical and normalized-name competing category creates', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace(`Category concurrency ${randomUUID()}`, 'personal');
    const requestId = randomUUID();
    const input = { spaceId: space.id, requestId, kind: 'income' as const, nameEn: 'Commission' };
    const identical = await Promise.all([owner.createCategory(input), owner.createCategory(input)]);
    expect(identical[0]).toEqual(identical[1]);

    const competing = await Promise.allSettled([
      owner.createCategory({ ...input, requestId: randomUUID(), nameEn: 'Consulting' }),
      owner.createCategory({ ...input, requestId: randomUUID(), nameEn: '  CONSULTING  ' }),
    ]);
    expect(competing.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(competing.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('keeps category reads and lifecycle commands tenant scoped', async () => {
    const owner = asUser(ownerId);
    const other = asUser(otherUserId);
    const space = await owner.createSpace(`Category tenant ${randomUUID()}`, 'personal');
    const requestId = randomUUID();
    const category = await owner.createCategory({
      spaceId: space.id,
      requestId,
      kind: 'expense',
      nameEn: 'Private label',
    });

    await expect(
      queryAsUser(otherUserId, 'select id from public.categories where id = $1', [category.id]),
    ).resolves.toEqual([]);
    await expect(other.categoryCommandResult(space.id, requestId)).rejects.toMatchObject({ code: '42501' });
    await expect(other.createCategory({
      spaceId: space.id,
      requestId: randomUUID(),
      kind: 'expense',
      nameEn: 'Blocked',
    })).rejects.toMatchObject({ code: '42501' });
    await expect(other.archiveCategory(space.id, randomUUID(), category.id)).rejects.toMatchObject({ code: '42501' });
    await expect(queryAsRole('anon', 'select id from public.categories')).rejects.toMatchObject({ code: '42501' });
    await expect(queryAsRole('anon', `select * from public.create_category('${space.id}', '${randomUUID()}', 'expense', 'Blocked', null)`)).rejects.toMatchObject({ code: '42501' });
    await expect(queryAsUser(ownerId, 'select * from public.category_command_requests')).rejects.toMatchObject({ code: '42501' });
  });

  it('allows an active non-owner member to manage categories', async () => {
    const owner = asUser(ownerId);
    const member = asUser(otherUserId);
    const space = await owner.createSpace(`Category member ${randomUUID()}`, 'household');
    await databaseQuery(
      `insert into public.space_memberships (space_id, user_id, role)
       values ($1, $2, 'member')`,
      [space.id, otherUserId],
    );
    const category = await member.createCategory({
      spaceId: space.id,
      requestId: randomUUID(),
      kind: 'expense',
      nameEn: 'Member managed',
    });

    await expect(member.archiveCategory(space.id, randomUUID(), category.id)).resolves.toEqual(category);
  });

  it('creates categorized income and expense with one immutable association', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace(`Categorized posting ${randomUUID()}`, 'personal');
    const wallet = await owner.createWallet(space.id, 'USD', 'USD');
    const incomeCategory = await createCategory(space.id, 'income', 'Salary');
    const expenseCategory = await createCategory(space.id, 'expense', 'Food');
    const income = await owner.recordCategorizedEvent({
      spaceId: space.id,
      requestId: randomUUID(),
      kind: 'income',
      effectiveDate: '2026-09-08',
      movements: [{ walletId: wallet.id, amountMinor: '10000' }],
      categoryId: incomeCategory.id,
    });
    const expense = await owner.recordCategorizedEvent({
      spaceId: space.id,
      requestId: randomUUID(),
      kind: 'expense',
      effectiveDate: '2026-09-08',
      movements: [{ walletId: wallet.id, amountMinor: '-2500' }],
      categoryId: expenseCategory.id,
    });

    await expect(owner.walletBalance(wallet.id)).resolves.toEqual('7500');
    await expect(queryAsUser(ownerId, 'select event_id, category_id from public.financial_event_categories where event_id = any($1::uuid[])', [[income.id, expense.id]])).resolves.toEqual(
      expect.arrayContaining([
        { event_id: income.id, category_id: incomeCategory.id },
        { event_id: expense.id, category_id: expenseCategory.id },
      ]),
    );
  });

  it('rejects ineligible, wrong-kind, archived, missing, and cross-space categories atomically', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace(`Categorized rejection ${randomUUID()}`, 'personal');
    const otherSpace = await owner.createSpace(`Categorized other ${randomUUID()}`, 'personal');
    const wallet = await owner.createWallet(space.id, 'USD', 'USD');
    const incomeCategory = await createCategory(space.id, 'income', 'Income category');
    const expenseCategory = await createCategory(space.id, 'expense', 'Expense category');
    const archived = await createCategory(space.id, 'income', 'Archived category');
    const crossSpace = await createCategory(otherSpace.id, 'income', 'Other category');
    await owner.archiveCategory(space.id, randomUUID(), archived.id);

    const cases = [
      { kind: 'opening_balance' as const, categoryId: incomeCategory.id, amountMinor: '1' },
      { kind: 'transfer' as const, categoryId: expenseCategory.id, amountMinor: '1' },
      { kind: 'income' as const, categoryId: expenseCategory.id, amountMinor: '1' },
      { kind: 'income' as const, categoryId: archived.id, amountMinor: '1' },
      { kind: 'income' as const, categoryId: randomUUID(), amountMinor: '1' },
      { kind: 'income' as const, categoryId: crossSpace.id, amountMinor: '1' },
    ];

    for (const item of cases) {
      const requestId = randomUUID();
      await expect(owner.recordCategorizedEvent({
        spaceId: space.id,
        requestId,
        kind: item.kind,
        effectiveDate: '2026-09-08',
        movements: [{ walletId: wallet.id, amountMinor: item.amountMinor }],
        categoryId: item.categoryId,
      })).rejects.toMatchObject({ code: 'P0001' });
      await expect(databaseQuery('select id from public.financial_events where space_id = $1 and request_id = $2', [space.id, requestId])).resolves.toEqual([]);
    }

    for (const kind of ['reversal', 'loan_opening', 'loan_lend', 'loan_borrow', 'loan_receive_repayment', 'loan_repay_borrowing']) {
      const requestId = randomUUID();
      await expect(queryAsUser(
        ownerId,
        `select * from public.record_categorized_financial_event(
           $1, $2, $3::public.financial_event_kind, $4::date, $5::jsonb, $6
         )`,
        [space.id, requestId, kind, '2026-09-08', JSON.stringify([{ walletId: wallet.id, amountMinor: '1' }]), incomeCategory.id],
      )).rejects.toMatchObject({ code: 'P0001' });
      await expect(databaseQuery('select id from public.financial_events where space_id = $1 and request_id = $2', [space.id, requestId])).resolves.toEqual([]);
    }
  });

  it('makes categorized requests replay-safe across categorized and uncategorized callers', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace(`Categorized replay ${randomUUID()}`, 'personal');
    const wallet = await owner.createWallet(space.id, 'USD', 'USD');
    const firstCategory = await createCategory(space.id, 'income', 'Primary');
    const secondCategory = await createCategory(space.id, 'income', 'Secondary');
    const requestId = randomUUID();
    const input = {
      spaceId: space.id,
      requestId,
      kind: 'income' as const,
      effectiveDate: '2026-09-08',
      movements: [{ walletId: wallet.id, amountMinor: '50' }],
      categoryId: firstCategory.id,
    };
    const event = await owner.recordCategorizedEvent(input);

    await expect(owner.recordCategorizedEvent(input)).resolves.toEqual(event);
    await expect(owner.recordCategorizedEvent({ ...input, categoryId: secondCategory.id })).rejects.toMatchObject({ code: 'P0001' });
    await expect(owner.recordCategorizedEvent({ ...input, effectiveDate: '2026-09-09' })).rejects.toMatchObject({ code: 'P0001' });
    await expect(owner.recordEvent(input)).rejects.toMatchObject({ code: 'P0001' });

    const uncategorized = { ...input, requestId: randomUUID() };
    await owner.recordEvent(uncategorized);
    await expect(owner.recordCategorizedEvent(uncategorized)).rejects.toMatchObject({ code: 'P0001' });
    await expect(owner.walletBalance(wallet.id)).resolves.toEqual('100');
  });

  it('serializes identical categorized requests', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace(`Categorized concurrency ${randomUUID()}`, 'personal');
    const wallet = await owner.createWallet(space.id, 'USD', 'USD');
    const category = await createCategory(space.id, 'income', 'Concurrent');
    const input = {
      spaceId: space.id,
      requestId: randomUUID(),
      kind: 'income' as const,
      effectiveDate: '2026-09-08',
      movements: [{ walletId: wallet.id, amountMinor: '7' }],
      categoryId: category.id,
    };

    const results = await Promise.all([owner.recordCategorizedEvent(input), owner.recordCategorizedEvent(input)]);
    expect(results[0]).toEqual(results[1]);
    await expect(owner.walletBalance(wallet.id)).resolves.toEqual('7');
  });

  it('copies categories to reversals even after archive and leaves uncategorized reversals uncategorized', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace(`Category reversal ${randomUUID()}`, 'personal');
    const wallet = await owner.createWallet(space.id, 'USD', 'USD');
    const category = await createCategory(space.id, 'expense', 'Archived history');
    const original = await owner.recordCategorizedEvent({
      spaceId: space.id,
      requestId: randomUUID(),
      kind: 'expense',
      effectiveDate: '2026-09-08',
      movements: [{ walletId: wallet.id, amountMinor: '-90' }],
      categoryId: category.id,
    });
    await owner.archiveCategory(space.id, randomUUID(), category.id);
    const reversal = await owner.reverseEvent(space.id, randomUUID(), original.id, '2026-09-09');
    const uncategorized = await owner.recordEvent({
      spaceId: space.id,
      requestId: randomUUID(),
      kind: 'income',
      effectiveDate: '2026-09-09',
      movements: [{ walletId: wallet.id, amountMinor: '10' }],
    });
    const uncategorizedReversal = await owner.reverseEvent(space.id, randomUUID(), uncategorized.id, '2026-09-09');

    await expect(queryAsUser(ownerId, 'select event_id, category_id from public.financial_event_categories where event_id = any($1::uuid[]) order by event_id', [[original.id, reversal.id]])).resolves.toEqual(
      expect.arrayContaining([
        { event_id: original.id, category_id: category.id },
        { event_id: reversal.id, category_id: category.id },
      ]),
    );
    await expect(queryAsUser(ownerId, 'select event_id from public.financial_event_categories where event_id = $1', [uncategorizedReversal.id])).resolves.toEqual([]);
    await expect(owner.walletBalance(wallet.id)).resolves.toEqual('0');
  });

  it('records one transaction-stable archive timestamp and actor without deleting history', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace(`Category archive evidence ${randomUUID()}`, 'personal');
    const category = await createCategory(space.id, 'expense', 'Retained');
    const requestId = randomUUID();
    await owner.archiveCategory(space.id, requestId, category.id);
    const rows = await databaseQuery<{
      archived_by: string;
      archived_at: Date;
      request_created_at: Date;
      request_count: string;
    }>(
      `select category.archived_by, category.archived_at,
         min(request.created_at) as request_created_at,
         count(request.*)::text as request_count
       from public.categories as category
       join public.category_command_requests as request
         on request.category_id = category.id
        and request.space_id = category.space_id
        and request.command_kind = 'archive_category'
       where category.id = $1
       group by category.archived_by, category.archived_at`,
      [category.id],
    );
    expect(rows[0]).toMatchObject({ archived_by: ownerId, request_count: '1' });
    expect(rows[0]?.archived_at.getTime()).toBe(rows[0]?.request_created_at.getTime());
  });

  it('revokes direct writes and enforces ownership and immutable-history guards if grants drift', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace(`Category guards ${randomUUID()}`, 'personal');
    const category = await createCategory(space.id, 'expense', 'Guarded');
    const privileges = await databaseQuery<{ role_name: string; table_name: string; writable: boolean }>(
      `select role_name, table_name,
         has_table_privilege(role_name, format('public.%I', table_name), 'insert,update,delete,truncate') as writable
       from unnest(array['authenticated','service_role']) as role_name
       cross join unnest(array['categories','category_command_requests','financial_event_categories']) as table_name
       order by role_name, table_name`,
    );
    expect(privileges.every((row) => !row.writable)).toBe(true);

    await databaseQuery('grant insert, update, delete, truncate on public.categories to authenticated');
    try {
      await databaseQuery('alter table public.categories disable trigger categories_require_owner_insert');
      await databaseQuery('grant execute on function private.canonical_category_name(text), private.english_category_key(text), private.arabic_category_key(text) to authenticated');
      try {
        await expect(queryAsUser(ownerId, `insert into public.categories (space_id, kind, name_en, created_by) values ($1, 'expense', 'RLS blocked', $2)`, [space.id, ownerId])).rejects.toMatchObject({
          code: '42501',
          message: expect.stringContaining('row-level security'),
        });
      } finally {
        await databaseQuery('revoke execute on function private.canonical_category_name(text), private.english_category_key(text), private.arabic_category_key(text) from authenticated');
        await databaseQuery('alter table public.categories enable trigger categories_require_owner_insert');
      }
      await databaseQuery('create policy categories_test_write on public.categories for all to authenticated using (true) with check (true)');
      await expect(queryAsUser(ownerId, `insert into public.categories (space_id, kind, name_en, created_by) values ($1, 'expense', 'Bypass', $2)`, [space.id, ownerId])).rejects.toMatchObject({ code: '42501' });
      await expect(queryAsUser(ownerId, 'update public.categories set name_en = $2 where id = $1', [category.id, 'Relabeled'])).rejects.toMatchObject({ code: '42501' });
      await expect(queryAsUser(ownerId, 'delete from public.categories where id = $1', [category.id])).rejects.toMatchObject({ code: '42501' });
      await expect(queryAsUser(ownerId, 'truncate public.categories cascade')).rejects.toMatchObject({ code: '42501' });
    } finally {
      await databaseQuery('drop policy if exists categories_test_write on public.categories');
      await databaseQuery('revoke insert, update, delete, truncate on public.categories from authenticated');
    }
  });

  it('rejects direct association and request-history mutations even when grants drift', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace(`Category association guards ${randomUUID()}`, 'personal');
    const wallet = await owner.createWallet(space.id, 'USD', 'USD');
    const category = await createCategory(space.id, 'income', 'Protected association');
    const requestId = randomUUID();
    const event = await owner.recordCategorizedEvent({
      spaceId: space.id,
      requestId,
      kind: 'income',
      effectiveDate: '2026-09-08',
      movements: [{ walletId: wallet.id, amountMinor: '1' }],
      categoryId: category.id,
    });

    await databaseQuery('grant insert, update, delete, truncate on public.financial_event_categories, public.category_command_requests to authenticated');
    await databaseQuery('create policy financial_event_categories_test_write on public.financial_event_categories for all to authenticated using (true) with check (true)');
    await databaseQuery('create policy category_command_requests_test_write on public.category_command_requests for all to authenticated using (true) with check (true)');
    try {
      await expect(queryAsUser(ownerId, `insert into public.financial_event_categories (event_id, space_id, event_kind, category_id, category_kind) values ($1, $2, 'income', $3, 'income')`, [randomUUID(), space.id, category.id])).rejects.toMatchObject({ code: '42501' });
      await expect(queryAsUser(ownerId, 'update public.financial_event_categories set category_id = category_id where event_id = $1', [event.id])).rejects.toMatchObject({ code: '42501' });
      await expect(queryAsUser(ownerId, 'delete from public.category_command_requests where space_id = $1 and request_id = $2', [space.id, requestId])).rejects.toMatchObject({ code: '42501' });
      await expect(queryAsUser(ownerId, 'truncate public.financial_event_categories, public.category_command_requests cascade')).rejects.toMatchObject({ code: '42501' });
    } finally {
      await databaseQuery('drop policy if exists financial_event_categories_test_write on public.financial_event_categories');
      await databaseQuery('drop policy if exists category_command_requests_test_write on public.category_command_requests');
      await databaseQuery('revoke insert, update, delete, truncate on public.financial_event_categories, public.category_command_requests from authenticated');
    }
  });

  it('keeps public functions, RLS, policies, and indexes fail closed', async () => {
    const functions = await databaseQuery<{
      name: string;
      search_path: string;
      public_exec: boolean;
      anon_exec: boolean;
      authenticated_exec: boolean;
      service_exec: boolean;
    }>(
      `select p.proname as name,
         coalesce(array_to_string(p.proconfig, ','), '') as search_path,
         has_function_privilege('public', p.oid, 'execute') as public_exec,
         has_function_privilege('anon', p.oid, 'execute') as anon_exec,
         has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec,
         has_function_privilege('service_role', p.oid, 'execute') as service_exec
       from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = any(array['create_category','archive_category','get_category_command_result','record_categorized_financial_event'])
       order by p.proname`,
    );
    expect(functions).toHaveLength(4);
    expect(functions.every((row) =>
      row.search_path.includes('search_path=pg_catalog')
      && !row.public_exec
      && !row.anon_exec
      && row.authenticated_exec
      && !row.service_exec,
    )).toBe(true);

    const tables = await databaseQuery<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where oid = any(array['public.categories'::regclass,'public.category_command_requests'::regclass,'public.financial_event_categories'::regclass])
       order by relname`,
    );
    expect(tables).toEqual([
      { relname: 'categories', relrowsecurity: true },
      { relname: 'category_command_requests', relrowsecurity: true },
      { relname: 'financial_event_categories', relrowsecurity: true },
    ]);

    const indexes = await databaseQuery<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public'
       and indexname = any(array[
         'categories_active_name_en_idx','categories_active_name_ar_idx',
         'financial_event_categories_space_event_idx','financial_event_categories_space_category_event_idx'
       ]) order by indexname`,
    );
    expect(indexes).toHaveLength(4);

    const normalizers = await databaseQuery<{ proname: string; provolatile: string; prosecdef: boolean }>(
      `select p.proname, p.provolatile, p.prosecdef
       from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
       where n.nspname = 'private'
         and p.proname = any(array['canonical_category_name','english_category_key','arabic_category_key'])
       order by p.proname`,
    );
    expect(normalizers).toHaveLength(3);
    expect(normalizers.every((row) => row.provolatile === 'i' && !row.prosecdef)).toBe(true);
  });

  it('returns at most one reconciliation row and seeds no categories', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace(`Category bounded ${randomUUID()}`, 'personal');
    const before = await databaseQuery<{ count: string }>('select count(*)::text as count from public.categories where space_id = $1', [space.id]);
    expect(before[0]?.count).toBe('0');
    const requestId = randomUUID();
    const category = await owner.createCategory({ spaceId: space.id, requestId, kind: 'income', nameEn: 'Bounded' });
    await expect(owner.categoryCommandResult(space.id, requestId)).resolves.toMatchObject({
      command_kind: 'create_category',
      category_id: category.id,
    });
    await expect(owner.categoryCommandResult(space.id, randomUUID())).resolves.toBeUndefined();
  });

  it('uses the active-page and normalized-name indexes under representative data', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace(`Category index plan ${randomUUID()}`, 'personal');
    const prefix = randomUUID();
    await databaseQuery(
      `insert into public.categories (space_id, kind, name_en, created_by)
       select $1, 'expense', $2 || ' ' || series::text, $3
       from generate_series(1, 2_000) as series`,
      [space.id, prefix, ownerId],
    );
    await databaseQuery('vacuum analyze public.categories');

    const pagePlan = await databaseQuery<Record<string, unknown>>(
      `explain (format json)
       select id from public.categories
       where space_id = $1 and kind = 'expense' and archived_at is null
       order by created_at, id
       limit 50`,
      [space.id],
    );
    const namePlan = await databaseQuery<Record<string, unknown>>(
      `explain (format json)
       select id from public.categories
       where space_id = $1 and kind = 'expense'
         and name_en_key = $2 and archived_at is null`,
      [space.id, `${prefix} 1999`],
    );

    expect(JSON.stringify(pagePlan)).toContain('categories_active_page_idx');
    expect(JSON.stringify(namePlan)).toContain('categories_active_name_en_idx');
  });
});
