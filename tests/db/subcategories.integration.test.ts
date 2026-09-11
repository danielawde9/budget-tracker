import { randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bootstrapCompatibilityObjects,
  createDisposableDatabase,
  databaseClient,
  disposeDisposableDatabase,
  expectSavepointRejection,
  inTransaction,
  migrationFiles,
  replayMigrations,
  withAuthenticatedTransaction,
  withRollback,
  type DisposableDatabase,
  type MigrationFile,
} from './disposable-database.js';

interface CategoryRow {
  id: string;
  space_id: string;
  kind: 'income' | 'expense';
  name_en: string | null;
  name_ar: string | null;
  parent_category_id: string | null;
  archived_at: Date | null;
}

type CategoryCommand = Readonly<{
  spaceId: string | null;
  requestId: string | null;
  parentCategoryId: string | null;
  nameEn: string | null;
  nameAr: string | null;
}>;

type RootCommand = Readonly<{
  requestId?: string;
  kind?: CategoryRow['kind'];
  nameEn?: string | null;
  nameAr?: string | null;
}>;

const parentError = {
  code: 'P0001',
  message: 'the parent category must be an active root in the requested space and kind',
};
const duplicateError = {
  code: 'P0001',
  message: 'an active category already uses one of the supplied normalized names',
};
const replayError = {
  code: 'P0001',
  message: 'request ID was already used with different data',
};
const archiveChildrenError = {
  code: 'P0001',
  message: 'archive active subcategories before archiving their parent',
};
const immutableError = {
  code: '42501',
  message: 'categories may only transition once from active to archived',
};

const maximumMigrationCount = 100;
const databaseTimeoutMillis = 10_000;

async function createSpace(
  client: Client,
  ownerId: string,
  kind: 'personal' | 'household' = 'household',
): Promise<{ id: string }> {
  return withAuthenticatedTransaction(client, ownerId, async () => {
    const result = await client.query<{ id: string }>(
      'select * from public.create_space($1, $2)',
      [`Subcategories ${randomUUID()}`, kind],
    );
    const space = result.rows[0];
    if (!space) {
      throw new Error('create_space returned no space');
    }
    return space;
  });
}

async function createRootCategory(
  client: Client,
  ownerId: string,
  spaceId: string,
  command: RootCommand = {},
): Promise<{ id: string }> {
  return withAuthenticatedTransaction(client, ownerId, async () => {
    const result = await client.query<{ id: string }>(
      `select * from public.create_category($1, $2, $3::public.category_kind, $4, $5)`,
      [
        spaceId,
        command.requestId ?? randomUUID(),
        command.kind ?? 'expense',
        command.nameEn === undefined ? 'Essentials' : command.nameEn,
        command.nameAr ?? null,
      ],
    );
    const category = result.rows[0];
    if (!category) {
      throw new Error('create_category returned no category');
    }
    return category;
  });
}

async function createSubcategory(
  client: Client,
  ownerId: string,
  command: CategoryCommand,
): Promise<{ id: string }> {
  return withAuthenticatedTransaction(client, ownerId, () => insertSubcategory(client, command));
}

async function insertSubcategory(client: Client, command: CategoryCommand): Promise<{ id: string }> {
  const result = await client.query<{ id: string }>(
    'select * from public.create_subcategory($1, $2, $3, $4, $5)',
    [command.spaceId, command.requestId, command.parentCategoryId, command.nameEn, command.nameAr],
  );
  const category = result.rows[0];
  if (!category) {
    throw new Error('create_subcategory returned no category');
  }
  return category;
}

async function archiveCategory(
  client: Client,
  ownerId: string,
  spaceId: string | null,
  requestId: string | null,
  categoryId: string | null,
): Promise<{ id: string }> {
  return withAuthenticatedTransaction(client, ownerId, () =>
    archiveCategoryInTransaction(client, spaceId, requestId, categoryId));
}

async function archiveCategoryInTransaction(
  client: Client,
  spaceId: string | null,
  requestId: string | null,
  categoryId: string | null,
): Promise<{ id: string }> {
  const result = await client.query<{ id: string }>(
    'select * from public.archive_category($1, $2, $3)',
    [spaceId, requestId, categoryId],
  );
  const category = result.rows[0];
  if (!category) {
    throw new Error('archive_category returned no category');
  }
  return category;
}

async function requestReceipts(client: Client, spaceId: string, requestIds: string[]) {
  if (requestIds.length < 1 || requestIds.length > 2) {
    throw new Error('receipt assertions must inspect one or two exact requests');
  }
  const result = await client.query<{
    request_id: string;
    category_id: string;
    command_kind: string;
  }>(
    `select request_id, category_id, command_kind
     from public.category_command_requests
     where space_id = $1 and request_id = any($2::uuid[])
     order by request_id
     limit 2`,
    [spaceId, requestIds],
  );
  return result.rows;
}

async function categoryIds(client: Client, spaceId: string): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    'select id from public.categories where space_id = $1 order by id limit 100',
    [spaceId],
  );
  return result.rows.map((row) => row.id);
}

function twoParticipantBarrier(): () => Promise<void> {
  let arrivals = 0;
  let release!: () => void;
  let reject!: (error: Error) => void;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const ready = new Promise<void>((resolve, fail) => {
    release = resolve;
    reject = fail;
  });

  return async () => {
    if (arrivals >= 2) {
      throw new Error('the concurrency barrier accepts exactly two participants');
    }
    arrivals += 1;
    if (arrivals === 1) {
      timeout = setTimeout(() => {
        reject(new Error('the second authenticated transaction did not reach the barrier'));
      }, databaseTimeoutMillis);
    } else {
      clearTimeout(timeout);
      release();
    }
    await ready;
  };
}

async function raceAuthenticated<T>(
  database: DisposableDatabase,
  userId: string,
  actions: readonly [(client: Client) => Promise<T>, (client: Client) => Promise<T>],
): Promise<PromiseSettledResult<T>[]> {
  const clients = [databaseClient(database.url), databaseClient(database.url)] as const;
  const errors: unknown[] = [];
  let results: PromiseSettledResult<T>[] | undefined;
  try {
    const connections = await Promise.allSettled(clients.map((client) => client.connect()));
    const failures = connections.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      throw new AggregateError(failures.map((result) => result.reason), 'race connection setup failed');
    }
    const barrier = twoParticipantBarrier();
    const run = (client: Client, action: (client: Client) => Promise<T>) =>
      withAuthenticatedTransaction(client, userId, async () => {
        await barrier();
        return action(client);
      });
    results = await Promise.allSettled([
      run(clients[0], actions[0]),
      run(clients[1], actions[1]),
    ]);
  } catch (error) {
    errors.push(error);
  } finally {
    const closed = await Promise.allSettled(clients.map((client) => client.end()));
    errors.push(...closed.filter((result) => result.status === 'rejected').map((result) => result.reason));
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'race setup or connection cleanup failed');
  }
  if (!results) {
    throw new Error('the two-participant race did not produce results');
  }
  return results;
}

async function columnNames(client: Client, tableName: string): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(
    `select column_name
     from information_schema.columns
     where table_schema = 'public' and table_name = $1
     order by ordinal_position
     limit 100`,
    [tableName],
  );
  return result.rows.map((row) => row.column_name);
}

async function waitForOwnerLock(
  blocker: Client,
  waiterPid: number,
  finished: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (let attempt = 0; attempt < 256 && Date.now() < deadline; attempt += 1) {
    if (finished()) {
      throw new Error('owner mutation completed before waiting for the parent lock');
    }
    const result = await blocker.query<{ blocked: boolean }>(
      'select pg_blocking_pids($1) = array[pg_backend_pid()] as blocked limit 1', [waiterPid],
    );
    if (result.rows[0]?.blocked === true) {
      return;
    }
  }
  throw new Error('owner mutation did not reach the parent lock within the bounded barrier');
}

async function orderedOwnerRace(
  database: DisposableDatabase,
  actions: readonly [(client: Client) => Promise<unknown>, (client: Client) => Promise<unknown>],
  expectedError: { code: string; message: string },
): Promise<void> {
  const clients = [databaseClient(database.url), databaseClient(database.url)] as const;
  const pids: number[] = [];
  const errors: unknown[] = [];
  let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
  try {
    for (const client of clients) {
      await client.connect();
      pids.push(await scalar(client, 'select pg_backend_pid() as value limit 1'));
      await client.query('begin');
    }
    expect(new Set(pids).size).toBe(2);
    await actions[0](clients[0]);
    let finished = false;
    pending = Promise.allSettled([actions[1](clients[1])]).then((results) => {
      finished = true;
      return results;
    });
    await waitForOwnerLock(clients[0], pids[1]!, () => finished);
    await clients[0].query('commit');
    expect(await pending).toEqual([{ status: 'rejected', reason: expect.objectContaining(expectedError) }]);
    await clients[1].query('rollback');
    for (const [index, client] of clients.entries()) {
      const idle = await client.query(
        `select state, xact_start from pg_stat_activity where pid = $1 limit 1`, [pids[1 - index]],
      );
      expect(idle.rows).toEqual([{ state: 'idle', xact_start: null }]);
    }
  } catch (error) {
    errors.push(error);
  } finally {
    // Release the first lock before draining a possibly blocked second query.
    const rollback = await Promise.allSettled([clients[0].query('rollback')]);
    if (pending) await pending;
    const cleanup = await Promise.allSettled([clients[1].query('rollback')]);
    const closed = await Promise.allSettled(clients.map((client) => client.end()));
    errors.push(...[...rollback, ...cleanup, ...closed]
      .filter((result) => result.status === 'rejected').map((result) => result.reason));
  }
  const remaining = await database.client.query(
    'select pid from pg_stat_activity where pid = any($1::int[]) limit 2', [pids],
  );
  expect(remaining.rows).toEqual([]);
  if (errors.length > 0) throw new AggregateError(errors, 'ordered owner race or cleanup failed');
}

async function categoryById(
  client: Client,
  ownerId: string,
  categoryId: string,
): Promise<CategoryRow | undefined> {
  return withAuthenticatedTransaction(client, ownerId, async () => {
    const result = await client.query<CategoryRow>(
      `select id, space_id, kind, name_en, name_ar, parent_category_id, archived_at
       from public.categories
       where id = $1
       limit 1`,
      [categoryId],
    );
    return result.rows[0];
  });
}

const existingRelations = [
  'auth.users',
  'public.categories',
  'public.category_command_requests',
  'public.financial_event_categories',
  'public.financial_events',
  'public.loan_balances',
  'public.loan_monthly_target_revisions',
  'public.loan_postings',
  'public.loans',
  'public.space_memberships',
  'public.spaces',
  'public.wallet_balances',
  'public.wallet_movements',
  'public.wallets',
] as const;
type ExistingRelation = typeof existingRelations[number];

const existingFunctionSignatures = [
  'archive_category(uuid,uuid,uuid)',
  'create_category(uuid,uuid,category_kind,text,text)',
  'create_space(text,space_kind)',
  'create_wallet(uuid,text,currency_code)',
  'get_category_command_result(uuid,uuid)',
  'loan_monthly_currency_summary(uuid,date)',
  'loan_monthly_plan(uuid,date)',
  'open_loan_outstanding(uuid,uuid,loan_direction,text,currency_code,text,date,date,text)',
  'record_cash_loan(uuid,uuid,loan_direction,text,currency_code,uuid,text,date,date,text)',
  'record_categorized_financial_event(uuid,uuid,financial_event_kind,date,jsonb,uuid)',
  'record_financial_event(uuid,uuid,financial_event_kind,date,jsonb)',
  'record_loan_repayment(uuid,uuid,uuid,uuid,text,date)',
  'reverse_financial_event(uuid,uuid,uuid,date)',
  'set_loan_monthly_target(uuid,uuid,uuid,date,text)',
] as const;

const upgradeCategoryInputs = [
  { kind: 'income', nameEn: 'Salary', nameAr: null, archive: false },
  { kind: 'income', nameEn: 'Past salary', nameAr: null, archive: true },
  { kind: 'income', nameEn: null, nameAr: 'دخل', archive: false },
  { kind: 'income', nameEn: null, nameAr: 'دخل سابق', archive: true },
  { kind: 'income', nameEn: 'Bonus', nameAr: 'مكافأة', archive: false },
  { kind: 'income', nameEn: 'Past bonus', nameAr: 'مكافأة سابقة', archive: true },
  { kind: 'expense', nameEn: 'Rent', nameAr: null, archive: false },
  { kind: 'expense', nameEn: 'Past rent', nameAr: null, archive: true },
  { kind: 'expense', nameEn: null, nameAr: 'طعام', archive: false },
  { kind: 'expense', nameEn: null, nameAr: 'طعام سابق', archive: true },
  { kind: 'expense', nameEn: 'Travel', nameAr: 'سفر', archive: false },
  { kind: 'expense', nameEn: 'Past travel', nameAr: 'سفر سابق', archive: true },
] as const;

async function migrationVersions(client: Client): Promise<string[]> {
  const result = await client.query<{ version: string }>(
    `select version from supabase_migrations.schema_migrations order by version limit 101`,
  );
  expect(result.rows.length).toBeLessThanOrEqual(maximumMigrationCount);
  return result.rows.map((row) => row.version);
}

async function scalar(client: Client, sql: string): Promise<number> {
  const result = await client.query<{ value: number }>(sql);
  expect(result.rows).toHaveLength(1);
  const value = result.rows[0]?.value;
  if (typeof value !== 'number') {
    throw new Error('the bounded scalar assertion did not return a number');
  }
  return value;
}

async function snapshotRelations(client: Client, relations: readonly ExistingRelation[]) {
  const snapshot: Partial<Record<ExistingRelation, string[]>> = {};
  for (const relation of relations) {
    if (!existingRelations.includes(relation)) {
      throw new Error('snapshot relation is outside the exact allowlist');
    }
    // JSON text preserves every pre-existing column, timestamp, bytea fingerprint,
    // and bigint without converting amounts through JavaScript numbers.
    const result = await client.query<{ row: string }>(
      `select (to_jsonb(source) ${relation === 'public.categories' ? "- 'parent_category_id'" : ''})::text as row
       from ${relation} as source order by row limit 101`,
    );
    expect(result.rows.length, `${relation} must fit completely in the snapshot`).toBeLessThanOrEqual(100);
    snapshot[relation] = result.rows.map(({ row }) => row);
  }
  return snapshot;
}

async function existingColumnCatalog(client: Client) {
  const result = await client.query<Record<string, unknown>>(
    `select namespace.nspname as schema, relation.relname as relation, attribute.attname as column,
       format_type(attribute.atttypid, attribute.atttypmod) as type,
       attribute.attnum, attribute.attnotnull, attribute.attgenerated,
       pg_get_expr(defaults.adbin, defaults.adrelid) as default_expression
     from pg_attribute as attribute
     join pg_class as relation on relation.oid = attribute.attrelid
     join pg_namespace as namespace on namespace.oid = relation.relnamespace
     left join pg_attrdef as defaults
       on defaults.adrelid = attribute.attrelid and defaults.adnum = attribute.attnum
     where attribute.attnum > 0 and not attribute.attisdropped
       and namespace.nspname || '.' || relation.relname = any($1::text[])
       and not (relation.oid = 'public.categories'::regclass and attribute.attname = 'parent_category_id')
     order by namespace.nspname, relation.relname, attribute.attnum limit 257`,
    [existingRelations],
  );
  expect(result.rows.length).toBeLessThanOrEqual(256);
  return result.rows;
}

async function existingFunctionCatalog(client: Client) {
  const result = await client.query<{ signature: string; [key: string]: unknown }>(
    `select procedure.oid::regprocedure::text as signature,
       pg_get_function_arguments(procedure.oid) as arguments,
       pg_get_function_result(procedure.oid) as result,
       procedure.prosecdef, procedure.provolatile, procedure.proconfig, procedure.proacl::text,
       has_function_privilege('public', procedure.oid, 'execute') as public_exec,
       has_function_privilege('anon', procedure.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', procedure.oid, 'execute') as authenticated_exec,
       has_function_privilege('service_role', procedure.oid, 'execute') as service_exec,
       case when procedure.proname <> 'archive_category'
         then pg_get_functiondef(procedure.oid) end as unchanged_definition
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.oid::regprocedure::text = any($1::text[])
       and not exists (
         select 1 from pg_depend as dependency
         where dependency.classid = 'pg_proc'::regclass and dependency.objid = procedure.oid
           and dependency.deptype = 'e' limit 1
       )
     order by signature limit 33`,
    [existingFunctionSignatures],
  );
  expect(result.rows.map(({ signature }) => signature)).toEqual(existingFunctionSignatures);
  return result.rows;
}

async function categorySecurityCatalog(client: Client) {
  const tables = await client.query<Record<string, unknown>>(
    `select relname, relrowsecurity from pg_class
     where oid = any(array['public.categories'::regclass, 'public.category_command_requests'::regclass])
     order by relname limit 3`,
  );
  const policies = await client.query<Record<string, unknown>>(
    `select tablename, policyname, permissive, roles::text[], cmd, qual, with_check
     from pg_policies where schemaname = 'public'
       and tablename = any(array['categories', 'category_command_requests'])
     order by tablename, policyname limit 17`,
  );
  const grants = await client.query<Record<string, unknown>>(
    `select role_name, table_name,
       has_table_privilege(role_name, 'public.' || table_name, 'insert') as insert,
       has_table_privilege(role_name, 'public.' || table_name, 'update') as update,
       has_table_privilege(role_name, 'public.' || table_name, 'delete') as delete,
       has_table_privilege(role_name, 'public.' || table_name, 'truncate') as truncate,
       has_any_column_privilege(role_name, 'public.' || table_name, 'insert') as column_insert,
       has_any_column_privilege(role_name, 'public.' || table_name, 'update') as column_update
     from unnest(array['public', 'anon', 'authenticated', 'service_role']) as role_name
     cross join unnest(array['categories', 'category_command_requests']) as table_name
     order by role_name, table_name limit 9`,
  );
  return { tables: tables.rows, policies: policies.rows, grants: grants.rows };
}

async function normalizerPermissions(client: Client) {
  const result = await client.query<Record<string, unknown>>(
    `select proname, proacl::text,
       has_function_privilege('authenticated', oid, 'execute') as authenticated_exec
     from pg_proc where pronamespace = 'private'::regnamespace
       and proname = any(array['arabic_category_key', 'canonical_category_name', 'english_category_key'])
     order by proname limit 4`,
  );
  expect(result.rows).toHaveLength(3);
  return result.rows;
}

async function memberSnapshot(client: Client, memberId: string, householdId: string) {
  const requests = await client.query<{ request_id: string }>(
    `select request_id from public.category_command_requests
     where space_id = $1 order by request_id limit 101`, [householdId],
  );
  expect(requests.rows).toHaveLength(18);
  return withAuthenticatedTransaction(client, memberId, async () => {
    const relations = await snapshotRelations(client, existingRelations.filter(
      (relation) => relation !== 'auth.users' && relation !== 'public.category_command_requests',
    ));
    const receipts: string[] = [];
    for (const { request_id } of requests.rows) {
      const result = await client.query<{ row: string }>(
        `select to_jsonb(receipt)::text as row
         from public.get_category_command_result($1, $2) as receipt limit 2`,
        [householdId, request_id],
      );
      expect(result.rows).toHaveLength(1);
      receipts.push(...result.rows.map(({ row }) => row));
    }
    return { relations, receipts };
  });
}

async function upgradeSnapshot(client: Client, memberId: string, householdId: string) {
  const totals = await client.query<{
    wallet_id: string; movement_count: number; amount_minor: string;
  }>(
    `select wallet_id, count(*)::int as movement_count, sum(amount_minor)::text as amount_minor
     from public.wallet_movements group by wallet_id order by wallet_id limit 101`,
  );
  expect(totals.rows).toHaveLength(2);
  return {
    columns: await existingColumnCatalog(client),
    relations: await snapshotRelations(client, existingRelations),
    functions: await existingFunctionCatalog(client),
    security: await categorySecurityCatalog(client),
    totals: totals.rows,
    member: await memberSnapshot(client, memberId, householdId),
  };
}

async function seedUpgradeWallet(client: Client, actorId: string, spaceId: string) {
  return withAuthenticatedTransaction(client, actorId, async () => {
    const wallet = await client.query<{ id: string }>(
      "select * from public.create_wallet($1, 'Upgrade wallet', 'USD') limit 2", [spaceId],
    );
    expect(wallet.rows).toHaveLength(1);
    const walletId = wallet.rows[0]!.id;
    const opening = await client.query(
      `select * from public.record_financial_event($1, $2, 'opening_balance', '2026-09-01', $3) limit 2`,
      [spaceId, randomUUID(), JSON.stringify([{ walletId, amountMinor: '100000' }])],
    );
    expect(opening.rows).toHaveLength(1);
    return walletId;
  });
}

async function seedUpgradeCategories(client: Client, actorId: string, spaceId: string) {
  const walletId = await seedUpgradeWallet(client, actorId, spaceId);
  let reversed = false;
  for (const input of upgradeCategoryInputs) {
    const category = await createRootCategory(client, actorId, spaceId, input);
    await withAuthenticatedTransaction(client, actorId, async () => {
      const event = await client.query<{ id: string }>(
        `select * from public.record_categorized_financial_event($1, $2, $3, '2026-09-02', $4, $5) limit 2`,
        [spaceId, randomUUID(), input.kind, JSON.stringify([
          { walletId, amountMinor: input.kind === 'income' ? '10000' : '-1200' },
        ]), category.id],
      );
      expect(event.rows).toHaveLength(1);
      if (!reversed && input.kind === 'expense') {
        const reversal = await client.query(
          "select * from public.reverse_financial_event($1, $2, $3, '2026-09-03') limit 2",
          [spaceId, randomUUID(), event.rows[0]!.id],
        );
        expect(reversal.rows).toHaveLength(1);
        reversed = true;
      }
    });
    if (input.archive) {
      await archiveCategory(client, actorId, spaceId, randomUUID(), category.id);
    }
  }
  expect(reversed).toBe(true);
}

async function postCompatibilityEvent(
  client: Client,
  actorId: string,
  input: { spaceId: string; walletId: string; kind: CategoryRow['kind']; categoryId: string | null },
): Promise<{ id: string; amountMinor: string }> {
  const amountMinor = input.kind === 'income' ? '2300' : '-1700';
  return withAuthenticatedTransaction(client, actorId, async () => {
    const values = [input.spaceId, randomUUID(), input.kind,
      JSON.stringify([{ walletId: input.walletId, amountMinor }])];
    const sql = input.categoryId === null
      ? "select * from public.record_financial_event($1, $2, $3, '2026-09-10', $4) limit 2"
      : "select * from public.record_categorized_financial_event($1, $2, $3, '2026-09-10', $4, $5) limit 2";
    const event = await client.query<{ id: string }>(sql,
      input.categoryId === null ? values : [...values, input.categoryId]);
    expect(event.rows).toHaveLength(1);
    return { id: event.rows[0]!.id, amountMinor };
  });
}

async function replayLegacyCategoryReceipts(client: Client, actorId: string, spaceId: string) {
  const receipts = await client.query<{
    request_id: string; category_id: string; command_kind: string;
    kind: CategoryRow['kind']; name_en: string | null; name_ar: string | null;
  }>(
    `select request.request_id, request.category_id, request.command_kind,
       category.kind, category.name_en, category.name_ar
     from public.category_command_requests as request
     join public.categories as category on category.id = request.category_id
     where request.space_id = $1 and category.name_en = 'Past salary'
     order by request.command_kind limit 3`, [spaceId],
  );
  expect(receipts.rows.map(({ command_kind }) => command_kind)).toEqual(['archive_category', 'create_category']);
  for (const receipt of receipts.rows) {
    const result = receipt.command_kind === 'archive_category'
      ? await archiveCategory(client, actorId, spaceId, receipt.request_id, receipt.category_id)
      : await createRootCategory(client, actorId, spaceId, {
        requestId: receipt.request_id, kind: receipt.kind, nameEn: receipt.name_en, nameAr: receipt.name_ar,
      });
    expect(result).toEqual({ id: receipt.category_id });
  }
}

async function seedUpgradeDatabase(client: Client) {
  const ownerId = randomUUID();
  const memberId = randomUUID();
  await client.query(
    `insert into auth.users (id, email, email_confirmed_at)
     select user_id, 'upgrade-' || user_id::text || '@budget.invalid', now()
     from unnest($1::uuid[]) as user_id limit 2`, [[ownerId, memberId]],
  );
  const personal = await createSpace(client, ownerId, 'personal');
  const household = await createSpace(client, ownerId, 'household');
  await client.query(
    "insert into public.space_memberships (space_id, user_id, role) values ($1, $2, 'member')",
    [household.id, memberId],
  );
  await seedUpgradeCategories(client, ownerId, personal.id);
  await seedUpgradeCategories(client, memberId, household.id);
  return { memberId, householdId: household.id };
}

describe('subcategories database foundation', () => {
  let database: DisposableDatabase | undefined;
  let migrations: MigrationFile[] = [];
  let ownerId = '';
  let memberId = '';
  let nonMemberId = '';
  let spaceId = '';
  let essentialsId = '';

  function currentDatabase(): DisposableDatabase {
    if (!database) {
      throw new Error('disposable database is unavailable');
    }
    return database;
  }

  async function fixture(kind: CategoryRow['kind'] = 'expense') {
    const { client } = currentDatabase();
    const space = await createSpace(client, ownerId);
    const parent = await createRootCategory(client, ownerId, space.id, { kind });
    const input: CategoryCommand = {
      spaceId: space.id,
      requestId: randomUUID(),
      parentCategoryId: parent.id,
      nameEn: 'Child',
      nameAr: null,
    };
    return { client, space, parent, input };
  }

  async function expectUnchangedSpace(
    client: Client,
    targetSpaceId: string,
    idsBefore: string[],
    requestId: string,
  ): Promise<void> {
    expect(await categoryIds(client, targetSpaceId)).toEqual(idsBefore);
    expect(await requestReceipts(client, targetSpaceId, [requestId])).toEqual([]);
  }

  beforeAll(async () => {
    database = await createDisposableDatabase('budget_subcategories');
    try {
      await bootstrapCompatibilityObjects(database.client);
      migrations = migrationFiles();
      await replayMigrations(database.client, migrations);
      expect(await scalar(database.client, 'select count(*)::int as value from public.categories')).toBe(0);
      expect(await scalar(database.client, 'select count(*)::int as value from public.category_command_requests')).toBe(0);
      expect(await scalar(database.client, 'select count(*)::int as value from public.financial_events')).toBe(0);

      ownerId = randomUUID();
      memberId = randomUUID();
      nonMemberId = randomUUID();
      await database.client.query(
        `insert into auth.users (id, email, email_confirmed_at)
         select user_id, 'subcategories-' || user_id::text || '@budget.invalid', now()
         from unnest($1::uuid[]) as user_id
         limit 3`,
        [[ownerId, memberId, nonMemberId]],
      );
      const space = await createSpace(database.client, ownerId);
      spaceId = space.id;
      const essentials = await createRootCategory(database.client, ownerId, spaceId);
      essentialsId = essentials.id;
    } catch (error) {
      const failedDatabase = database;
      database = undefined;
      try {
        await disposeDisposableDatabase(failedDatabase);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'setup and cleanup both failed');
      }
      throw error;
    }
  }, 60_000);

  afterAll(async () => {
    if (!database) {
      return;
    }
    const completedDatabase = database;
    database = undefined;
    try {
      expect(await migrationVersions(completedDatabase.client)).toEqual(
        migrations.map(({ version }) => version),
      );
    } finally {
      await disposeDisposableDatabase(completedDatabase);
    }
  });

  it('replays the complete migration journal before testing the new contract', async () => {
    if (!database) {
      throw new Error('disposable database is unavailable');
    }
    const journal = await database.client.query<{ version: string }>(
      `select version
       from supabase_migrations.schema_migrations
       order by version
       limit 100`,
    );
    expect(journal.rows.map((row) => row.version)).toEqual(
      migrations.map((migration) => migration.version),
    );
  });

  it('preserves complete seeded state and command compatibility when upgrading 18 to 19 migrations', async () => {
    const upgrade = await createDisposableDatabase('budget_subcategoriesupgrade');
    try {
      expect(upgrade.name).not.toBe(currentDatabase().name);
      await bootstrapCompatibilityObjects(upgrade.client);
      const priorMigrations = migrations.filter(({ version }) => version <= '20260908103000');
      const subcategoryMigrations = migrations.filter(({ version }) => version === '20260910100000');
      expect(priorMigrations).toHaveLength(18);
      expect(subcategoryMigrations.map(({ version, name }) => ({ version, name }))).toEqual([
        { version: '20260910100000', name: 'subcategories_foundation' },
      ]);
      const subcategoryMigration = subcategoryMigrations[0];
      if (!subcategoryMigration) {
        throw new Error('the exact subcategories foundation migration is required');
      }
      await replayMigrations(upgrade.client, priorMigrations);
      expect(await migrationVersions(upgrade.client)).toEqual(priorMigrations.map(({ version }) => version));
      const relationCatalog = await upgrade.client.query<{ relation: string }>(
        `select 'public.' || relname as relation from pg_class
         where relnamespace = 'public'::regnamespace and relkind in ('r', 'v')
         order by relation limit 33`,
      );
      expect(relationCatalog.rows.map(({ relation }) => relation)).toEqual(existingRelations.slice(1));
      const fixture = await seedUpgradeDatabase(upgrade.client);
      const beforeExistingState = await upgradeSnapshot(upgrade.client, fixture.memberId, fixture.householdId);
      expect(Object.fromEntries(Object.entries(beforeExistingState.relations).map(
        ([relation, rows]) => [relation, rows.length],
      ))).toEqual({
        'auth.users': 2, 'public.categories': 24, 'public.category_command_requests': 36,
        'public.financial_event_categories': 26, 'public.financial_events': 28,
        'public.loan_balances': 0, 'public.loan_monthly_target_revisions': 0,
        'public.loan_postings': 0, 'public.loans': 0, 'public.space_memberships': 3,
        'public.spaces': 2, 'public.wallet_balances': 2, 'public.wallet_movements': 28,
        'public.wallets': 2,
      });
      expect(beforeExistingState.totals).toEqual([
        { wallet_id: expect.any(String), movement_count: 14, amount_minor: '154000' },
        { wallet_id: expect.any(String), movement_count: 14, amount_minor: '154000' },
      ]);
      expect(Object.fromEntries(Object.entries(beforeExistingState.member.relations).map(
        ([relation, rows]) => [relation, rows.length],
      ))).toEqual({
        'public.categories': 12, 'public.financial_event_categories': 13, 'public.financial_events': 14,
        'public.loan_balances': 0, 'public.loan_monthly_target_revisions': 0,
        'public.loan_postings': 0, 'public.loans': 0, 'public.space_memberships': 1,
        'public.spaces': 1, 'public.wallet_balances': 1, 'public.wallet_movements': 14,
        'public.wallets': 1,
      });
      await replayMigrations(upgrade.client, [subcategoryMigration]);
      await replayLegacyCategoryReceipts(upgrade.client, fixture.memberId, fixture.householdId);
      const afterExistingState = await upgradeSnapshot(upgrade.client, fixture.memberId, fixture.householdId);
      expect(afterExistingState).toEqual(beforeExistingState);
      expect(await scalar(upgrade.client,
        'select count(*)::int as value from public.categories where parent_category_id is not null',
      )).toBe(0);
      expect(await migrationVersions(upgrade.client)).toHaveLength(19);
      expect(await migrationVersions(upgrade.client)).toEqual([
        ...priorMigrations.map(({ version }) => version),
        subcategoryMigration.version,
      ]);
    } finally {
      await disposeDisposableDatabase(upgrade);
    }
  });

  it.each([
    { kind: 'income', archiveBeforeReversal: false },
    { kind: 'expense', archiveBeforeReversal: false },
    { kind: 'income', archiveBeforeReversal: true },
    { kind: 'expense', archiveBeforeReversal: true },
  ] as const)('posts and reverses a child $kind event with archived=$archiveBeforeReversal under the complete journal',
    async ({ kind, archiveBeforeReversal }) => {
      const { client, space, parent, input } = await fixture(kind);
      expect(await migrationVersions(client)).toEqual(migrations.map(({ version }) => version));
      const child = await createSubcategory(client, ownerId, input);
      const walletId = await seedUpgradeWallet(client, ownerId, space.id);
      const event = await postCompatibilityEvent(client, ownerId, {
        spaceId: space.id, walletId, kind, categoryId: child.id,
      });
      if (archiveBeforeReversal) {
        await archiveCategory(client, ownerId, space.id, randomUUID(), child.id);
      }
      await withAuthenticatedTransaction(client, ownerId, async () => {
        const reversal = await client.query<{ id: string }>(
          "select * from public.reverse_financial_event($1, $2, $3, '2026-09-11') limit 2",
          [space.id, randomUUID(), event.id],
        );
        expect(reversal.rows).toHaveLength(1);
        const reversalId = reversal.rows[0]!.id;
        const categories = await client.query(
          `select event_id, category_id, category_kind, event_kind
           from public.financial_event_categories where space_id = $1 order by event_kind limit 3`, [space.id],
        );
        expect(categories.rows).toEqual([
          { event_id: event.id, category_id: child.id, category_kind: kind, event_kind: kind },
          { event_id: reversalId, category_id: child.id, category_kind: kind, event_kind: 'reversal' },
        ]);
        const movements = await client.query(
          `select event_id, wallet_id, amount_minor::text from public.wallet_movements
           where event_id = any($1::uuid[]) order by event_id limit 3`, [[event.id, reversalId]],
        );
        expect(movements.rows).toEqual([
          { event_id: event.id, wallet_id: walletId, amount_minor: event.amountMinor },
          { event_id: reversalId, wallet_id: walletId, amount_minor: kind === 'income' ? '-2300' : '1700' },
        ].sort((left, right) => left.event_id.localeCompare(right.event_id)));
      });
      expect(await categoryById(client, ownerId, child.id)).toMatchObject({
        parent_category_id: parent.id, archived_at: archiveBeforeReversal ? expect.any(Date) : null,
      });
    },
  );

  it.each([
    { kind: 'income', categorized: true }, { kind: 'expense', categorized: true },
    { kind: 'income', categorized: false }, { kind: 'expense', categorized: false },
  ] as const)('retains root/uncategorized posting for $kind with categorized=$categorized under the complete journal',
    async ({ kind, categorized }) => {
      const { client, space, parent } = await fixture(kind);
      expect(await migrationVersions(client)).toEqual(migrations.map(({ version }) => version));
      const walletId = await seedUpgradeWallet(client, ownerId, space.id);
      const event = await postCompatibilityEvent(client, ownerId, {
        spaceId: space.id, walletId, kind, categoryId: categorized ? parent.id : null,
      });
      await withAuthenticatedTransaction(client, ownerId, async () => {
        const categories = await client.query(
          'select event_id, category_id from public.financial_event_categories where space_id = $1 limit 2',
          [space.id],
        );
        expect(categories.rows).toEqual(categorized ? [{ event_id: event.id, category_id: parent.id }] : []);
        const movements = await client.query(
          `select wallet_id, amount_minor::text from public.wallet_movements where event_id = $1 limit 2`,
          [event.id],
        );
        expect(movements.rows).toEqual([{ wallet_id: walletId, amount_minor: event.amountMinor }]);
      });
      expect(await categoryById(client, ownerId, parent.id)).toMatchObject({ parent_category_id: null, archived_at: null });
    },
  );

  it('pins exact parent and request-kind constraint definitions in the live catalog', async () => {
    const { client } = currentDatabase();
    const constraints = await client.query<Record<string, unknown>>(
      `select conname, contype, convalidated, condeferrable, pg_get_constraintdef(oid) as definition
       from pg_constraint
       where (conrelid = 'public.categories'::regclass
         and conname = any(array['categories_parent_not_self_check', 'categories_parent_space_kind_fkey']))
         or (conrelid = 'public.category_command_requests'::regclass
           and conname = 'category_command_requests_command_kind_check')
       order by conname limit 4`,
    );
    expect(constraints.rows).toEqual([
      {
        conname: 'categories_parent_not_self_check', contype: 'c', convalidated: true, condeferrable: false,
        definition: 'CHECK (((parent_category_id IS NULL) OR (parent_category_id <> id)))',
      },
      {
        conname: 'categories_parent_space_kind_fkey', contype: 'f', convalidated: true, condeferrable: false,
        definition: 'FOREIGN KEY (parent_category_id, space_id, kind) REFERENCES categories(id, space_id, kind) ON DELETE RESTRICT',
      },
      {
        conname: 'category_command_requests_command_kind_check', contype: 'c', convalidated: true, condeferrable: false,
        definition: "CHECK ((command_kind = ANY (ARRAY['create_category'::text, 'create_subcategory'::text, 'archive_category'::text])))",
      },
    ]);
  });

  it('pins the exact hierarchy index columns and predicates in the live catalog', async () => {
    const { client } = currentDatabase();
    const indexes = await client.query<Record<string, unknown>>(
      `select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'categories'
         and indexname = any(array['categories_parent_fk_idx', 'categories_active_hierarchy_idx'])
       order by indexname limit 3`,
    );
    expect(indexes.rows).toEqual([
      {
        indexname: 'categories_active_hierarchy_idx',
        indexdef: 'CREATE INDEX categories_active_hierarchy_idx ON public.categories USING btree (space_id, kind, parent_category_id, created_at, id) WHERE (archived_at IS NULL)',
      },
      {
        indexname: 'categories_parent_fk_idx',
        indexdef: 'CREATE INDEX categories_parent_fk_idx ON public.categories USING btree (parent_category_id, space_id, kind) WHERE (parent_category_id IS NOT NULL)',
      },
    ]);
  });

  it('pins the enabled parent, owner-write, and archive trigger definitions in the live catalog', async () => {
    const { client } = currentDatabase();
    const triggers = await client.query<Record<string, unknown>>(
      `select tgname, tgenabled, pg_get_triggerdef(oid) as definition from pg_trigger
       where tgrelid = 'public.categories'::regclass and not tgisinternal
         and tgname = any(array['categories_guard_archive_update', 'categories_require_owner_insert', 'categories_validate_parent_insert'])
       order by tgname limit 4`,
    );
    expect(triggers.rows).toEqual([
      {
        tgname: 'categories_guard_archive_update', tgenabled: 'O',
        definition: 'CREATE TRIGGER categories_guard_archive_update BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION private.guard_category_archive_transition()',
      },
      {
        tgname: 'categories_require_owner_insert', tgenabled: 'O',
        definition: 'CREATE TRIGGER categories_require_owner_insert BEFORE INSERT ON public.categories FOR EACH ROW EXECUTE FUNCTION private.require_table_owner_write()',
      },
      {
        tgname: 'categories_validate_parent_insert', tgenabled: 'O',
        definition: 'CREATE TRIGGER categories_validate_parent_insert BEFORE INSERT ON public.categories FOR EACH ROW EXECUTE FUNCTION private.validate_category_parent()',
      },
    ]);
  });

  it('pins exact command signatures, fixed search paths, and effective execution grants', async () => {
    const { client } = currentDatabase();
    const functions = await client.query<Record<string, unknown>>(
      `select namespace.nspname as schema, procedure.proname as name,
         procedure.oid::regprocedure::text as signature, pg_get_function_result(procedure.oid) as result,
         procedure.prosecdef, procedure.proconfig,
         has_function_privilege('public', procedure.oid, 'execute') as public_exec,
         has_function_privilege('anon', procedure.oid, 'execute') as anon_exec,
         has_function_privilege('authenticated', procedure.oid, 'execute') as authenticated_exec,
         has_function_privilege('service_role', procedure.oid, 'execute') as service_exec
       from pg_proc as procedure join pg_namespace as namespace on namespace.oid = procedure.pronamespace
       where (namespace.nspname = 'public' and procedure.proname = 'create_subcategory')
         or (namespace.nspname = 'private' and procedure.proname = 'validate_category_parent')
       order by namespace.nspname, procedure.proname limit 3`,
    );
    expect(functions.rows).toEqual([
      {
        schema: 'private', name: 'validate_category_parent', signature: 'private.validate_category_parent()',
        result: 'trigger', prosecdef: true, proconfig: ['search_path=pg_catalog'],
        public_exec: false, anon_exec: false, authenticated_exec: false, service_exec: false,
      },
      {
        schema: 'public', name: 'create_subcategory', signature: 'create_subcategory(uuid,uuid,uuid,text,text)',
        result: 'TABLE(id uuid)', prosecdef: true, proconfig: ['search_path=pg_catalog, extensions'],
        public_exec: false, anon_exec: false, authenticated_exec: true, service_exec: false,
      },
    ]);
    const existing = await existingFunctionCatalog(client);
    for (const command of existing.filter(({ signature }) =>
      !['create_space(text,space_kind)', 'create_wallet(uuid,text,currency_code)'].includes(signature))) {
      expect(command).toMatchObject({
        public_exec: false, anon_exec: false, authenticated_exec: true, service_exec: false,
      });
    }
  });

  it('keeps categories and receipts behind exact RLS policies and zero raw write privileges', async () => {
    const catalog = await categorySecurityCatalog(currentDatabase().client);
    expect(catalog.tables).toEqual([
      { relname: 'categories', relrowsecurity: true },
      { relname: 'category_command_requests', relrowsecurity: true },
    ]);
    expect(catalog.policies).toEqual([
      {
        tablename: 'categories', policyname: 'categories_read_for_members', permissive: 'PERMISSIVE',
        roles: ['authenticated'], cmd: 'SELECT',
        qual: '( SELECT private.is_active_member(categories.space_id) AS is_active_member)', with_check: null,
      },
    ]);
    expect(catalog.grants).toEqual(
      ['anon', 'authenticated', 'public', 'service_role'].flatMap((role_name) =>
        ['categories', 'category_command_requests'].map((table_name) => ({
          role_name, table_name, insert: false, update: false, delete: false, truncate: false,
          column_insert: false, column_update: false,
        }))),
    );
  });

  it('keeps owner and archive guards effective after raw grants and matching policies are added', async () => {
    const { client, space, parent, input } = await fixture();
    await createSubcategory(client, ownerId, input);
    const securityBefore = await categorySecurityCatalog(client);
    const normalizersBefore = await normalizerPermissions(client);
    expect(normalizersBefore.map(({ authenticated_exec }) => authenticated_exec)).toEqual([false, false, false]);
    const idsBefore = await categoryIds(client, space.id);
    await withRollback(client, async () => {
      await client.query('grant insert, update on public.categories to authenticated');
      await client.query(`create policy subcategories_test_insert on public.categories
        for insert to authenticated with check ((select private.is_active_member(space_id)))`);
      await client.query(`create policy subcategories_test_update on public.categories
        for update to authenticated using ((select private.is_active_member(space_id)))
        with check ((select private.is_active_member(space_id)))`);
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [ownerId]);
      await client.query('set local role authenticated');
      const ownerError = { code: '42501', message: 'protected rows may be written only by their owning command' };
      await expectSavepointRejection(client, () => client.query(
        `insert into public.categories (space_id, kind, name_en, parent_category_id, created_by)
         values ($1, 'expense', 'Raw child', $2, $3)`, [space.id, parent.id, ownerId],
      ), ownerError);
      await expectSavepointRejection(client, () => client.query(
        'update public.categories set archived_at = now(), archived_by = $1 where id = $2',
        [ownerId, parent.id],
      ), { code: '42501', message: 'permission denied for function english_category_key' });
      // UPDATE also checks generated-column normalizers. Temporarily pass this
      // independent ACL layer so the probe must reach the archive trigger itself.
      await client.query('reset role');
      await client.query(`grant execute on function private.canonical_category_name(text),
        private.english_category_key(text), private.arabic_category_key(text) to authenticated`);
      await client.query('set local role authenticated');
      await expectSavepointRejection(client, () => client.query(
        'update public.categories set archived_at = now(), archived_by = $1 where id = $2',
        [ownerId, parent.id],
      ), ownerError);
      // The owning role passes the first guard, exposing the independent active-child check.
      await client.query('reset role');
      await expectSavepointRejection(client, () => client.query(
        'update public.categories set archived_at = now(), archived_by = $1 where id = $2',
        [ownerId, parent.id],
      ), archiveChildrenError);
    });
    expect(await categorySecurityCatalog(client)).toEqual(securityBefore);
    expect(await normalizerPermissions(client)).toEqual(normalizersBefore);
    expect(await categoryIds(client, space.id)).toEqual(idsBefore);
    expect(await categoryById(client, ownerId, parent.id)).toMatchObject({ archived_at: null });
  });

  it.each(['missing', 'other-space', 'other-kind', 'archived', 'child'] as const)(
    'rejects an owner insert with a %s parent through parent validation', async (invalidParent) => {
      const { client, space, parent, input } = await fixture();
      let parentId = parent.id;
      if (invalidParent === 'missing') {
        parentId = randomUUID();
      } else if (invalidParent === 'other-space') {
        parentId = (await fixture()).parent.id;
      } else if (invalidParent === 'other-kind') {
        parentId = (await createRootCategory(client, ownerId, space.id, { kind: 'income' })).id;
      } else if (invalidParent === 'archived') {
        await archiveCategory(client, ownerId, space.id, randomUUID(), parent.id);
      } else {
        parentId = (await createSubcategory(client, ownerId, input)).id;
      }
      const idsBefore = await categoryIds(client, space.id);
      await expect(withRollback(client, () => client.query(
        `insert into public.categories (space_id, kind, name_en, parent_category_id, created_by)
         values ($1, 'expense', 'Invalid owner child', $2, $3)`, [space.id, parentId, ownerId],
      ))).rejects.toMatchObject(invalidParent === 'child'
        ? { code: 'P0001', message: 'subcategory depth is limited to one level' } : parentError);
      expect(await categoryIds(client, space.id)).toEqual(idsBefore);
    },
  );

  it.each(['self', 'missing', 'other-space', 'other-kind'] as const)(
    'keeps the %s parent constraint effective with the validation trigger disabled', async (invalidParent) => {
      const { client, space, parent } = await fixture();
      const id = randomUUID();
      let parentId: string = id;
      if (invalidParent === 'missing') {
        parentId = randomUUID();
      } else if (invalidParent === 'other-space') {
        parentId = (await fixture()).parent.id;
      } else if (invalidParent === 'other-kind') {
        parentId = (await createRootCategory(client, ownerId, space.id, { kind: 'income' })).id;
      }
      const idsBefore = await categoryIds(client, space.id);
      await expect(withRollback(client, async () => {
        await client.query('alter table public.categories disable trigger categories_validate_parent_insert');
        await client.query(
          `insert into public.categories (id, space_id, kind, name_en, parent_category_id, created_by)
           values ($1, $2, 'expense', 'Constraint probe', $3, $4)`, [id, space.id, parentId, ownerId],
        );
      })).rejects.toMatchObject(invalidParent === 'self'
        ? { code: '23514', constraint: 'categories_parent_not_self_check' }
        : { code: '23503', constraint: 'categories_parent_space_kind_fkey' });
      const trigger = await client.query(
        `select tgenabled from pg_trigger where tgrelid = 'public.categories'::regclass
         and tgname = 'categories_validate_parent_insert' limit 2`,
      );
      expect(trigger.rows).toEqual([{ tgenabled: 'O' }]);
      expect(await categoryIds(client, space.id)).toEqual(idsBefore);
      expect(await categoryById(client, ownerId, parent.id)).toMatchObject({ archived_at: null });
    },
  );

  it('adds the immutable parent category identity to categories', async () => {
    if (!database) {
      throw new Error('disposable database is unavailable');
    }
    expect(await columnNames(database.client, 'categories')).toContain('parent_category_id');
  });

  it('creates a subcategory beneath an existing active root', async () => {
    if (!database) {
      throw new Error('disposable database is unavailable');
    }
    const command = createSubcategory(database.client, ownerId, {
      spaceId,
      requestId: randomUUID(),
      parentCategoryId: essentialsId,
      nameEn: 'Groceries',
      nameAr: null,
    });

    await expect(command).resolves.toMatchObject({ id: expect.any(String) });
    const created = await command;
    await expect(categoryById(database.client, ownerId, created.id)).resolves.toMatchObject({
      id: created.id,
      space_id: spaceId,
      kind: 'expense',
      name_en: 'Groceries',
      name_ar: null,
      parent_category_id: essentialsId,
      archived_at: null,
    });
  });

  it.each(['spaceId', 'requestId', 'parentCategoryId'] as const)(
    'rejects null create identifier %s without partial state', async (field) => {
      const { client, space, parent, input } = await fixture();
      const requestId = randomUUID();
      await expect(createSubcategory(client, ownerId, {
        ...input, requestId, [field]: null,
      })).rejects.toMatchObject({
        code: 'P0001', message: 'space, request ID, and parent category are required',
      });
      await expectUnchangedSpace(client, space.id, [parent.id], requestId);
    },
  );

  it('rejects a nonexistent parent without partial state', async () => {
    const { client, space, parent, input } = await fixture();
    const requestId = randomUUID();
    await expect(createSubcategory(client, ownerId, {
      ...input, requestId, parentCategoryId: randomUUID(),
    })).rejects.toMatchObject(parentError);
    await expectUnchangedSpace(client, space.id, [parent.id], requestId);
  });

  it('rejects a cross-space parent even when the actor belongs to both spaces', async () => {
    const { client, space, parent, input } = await fixture();
    const other = await fixture();
    const requestId = randomUUID();
    await expect(createSubcategory(client, ownerId, {
      ...input, requestId, parentCategoryId: other.parent.id,
    })).rejects.toMatchObject(parentError);
    await expectUnchangedSpace(client, space.id, [parent.id], requestId);
  });

  it('rejects an archived parent without partial state', async () => {
    const { client, space, parent, input } = await fixture();
    await archiveCategory(client, ownerId, space.id, randomUUID(), parent.id);
    const requestId = randomUUID();
    await expect(createSubcategory(client, ownerId, {
      ...input, requestId,
    })).rejects.toMatchObject(parentError);
    await expectUnchangedSpace(client, space.id, [parent.id], requestId);
  });

  it('rejects a child as a parent without partial state', async () => {
    const { client, space, input } = await fixture();
    const child = await createSubcategory(client, ownerId, input);
    const idsBefore = await categoryIds(client, space.id);
    const requestId = randomUUID();
    await expect(createSubcategory(client, ownerId, {
      ...input, requestId, parentCategoryId: child.id, nameEn: 'Grandchild',
    })).rejects.toMatchObject({
      code: 'P0001', message: 'subcategory depth is limited to one level',
    });
    await expectUnchangedSpace(client, space.id, idsBefore, requestId);
  });

  it.each([
    ['English only', '  Ｆｒｅｓｈ   Food  ', null, 'Fresh Food', null],
    ['Arabic only', null, '  إيجار   المنزل  ', null, 'إيجار المنزل'],
    ['bilingual', '  Groceries ', ' بقالة ', 'Groceries', 'بقالة'],
    ['120-character English', 'x'.repeat(120), null, 'x'.repeat(120), null],
    ['120-character Arabic', null, 'س'.repeat(120), null, 'س'.repeat(120)],
  ] as const)('creates canonical %s names', async (_label, nameEn, nameAr, storedEn, storedAr) => {
    const { client, space, parent, input } = await fixture();
    const child = await createSubcategory(client, ownerId, { ...input, nameEn, nameAr });
    expect(await categoryById(client, ownerId, child.id)).toMatchObject({
      name_en: storedEn, name_ar: storedAr, parent_category_id: parent.id,
      space_id: space.id, kind: 'expense', archived_at: null,
    });
  });

  it('derives income kind from the parent', async () => {
    const { client, parent, input } = await fixture('income');
    const child = await createSubcategory(client, ownerId, input);
    expect(await categoryById(client, ownerId, child.id)).toMatchObject({
      parent_category_id: parent.id, kind: 'income',
    });
  });

  it.each([
    ['absent', null, null],
    ['empty English', '', null],
    ['blank bilingual', '  \t', '\n  '],
    ['Arabic marks only', null, 'ً ٌ'],
    ['Arabic marks with valid English', 'Valid', 'ـً'],
    ['over-120 English', 'x'.repeat(121), null],
    ['over-120 Arabic', null, 'س'.repeat(121)],
  ] as const)('rejects %s names without partial state', async (_label, nameEn, nameAr) => {
    const { client, space, parent, input } = await fixture();
    const requestId = randomUUID();
    await expect(createSubcategory(client, ownerId, {
      ...input, requestId, nameEn, nameAr,
    })).rejects.toMatchObject({
      code: 'P0001', message: 'at least one bounded searchable category name is required',
    });
    await expectUnchangedSpace(client, space.id, [parent.id], requestId);
  });

  describe.each([
    ['English', '  Ｆｏｏｄ   Shop  ', null, 'food shop', null],
    ['Arabic', null, 'دخل ٌ إضافي', null, 'دخل إضافي'],
  ] as const)('%s global normalized-name uniqueness', (_label, firstEn, firstAr, nameEn, nameAr) => {
    it.each(['root/root', 'root/child', 'child/root', 'different-parent children'] as const)(
      'rejects %s conflicts with the stable duplicate error', async (shape) => {
        const { client, space, input } = await fixture();
        const other = await createRootCategory(client, ownerId, space.id, { nameEn: 'Other parent' });
        if (shape === 'root/root' || shape === 'root/child') {
          await createRootCategory(client, ownerId, space.id, { nameEn: firstEn, nameAr: firstAr });
        } else {
          await createSubcategory(client, ownerId, { ...input, nameEn: firstEn, nameAr: firstAr });
        }
        const idsBefore = await categoryIds(client, space.id);
        const requestId = randomUUID();
        const attempted = shape === 'root/root' || shape === 'child/root'
          ? createRootCategory(client, ownerId, space.id, { requestId, nameEn, nameAr })
          : createSubcategory(client, ownerId, {
            ...input, requestId, parentCategoryId: other.id, nameEn, nameAr,
          });
        await expect(attempted).rejects.toMatchObject(duplicateError);
        await expectUnchangedSpace(client, space.id, idsBefore, requestId);
      },
    );
  });

  it('allows an active non-owner household member to create and archive a child', async () => {
    const { client, space, input } = await fixture();
    await client.query(
      `insert into public.space_memberships (space_id, user_id, role) values ($1, $2, 'member')`,
      [space.id, memberId],
    );
    const child = await createSubcategory(client, memberId, input);
    expect(await categoryById(client, memberId, child.id)).toMatchObject({ id: child.id });
    expect(await archiveCategory(client, memberId, space.id, randomUUID(), child.id)).toEqual(child);
  });

  it('denies a non-member without partial state or category visibility', async () => {
    const { client, space, parent, input } = await fixture();
    const requestId = randomUUID();
    await expect(createSubcategory(client, nonMemberId, {
      ...input, requestId,
    })).rejects.toMatchObject({ code: '42501', message: 'an active space membership is required' });
    expect(await categoryById(client, nonMemberId, parent.id)).toBeUndefined();
    await expectUnchangedSpace(client, space.id, [parent.id], requestId);
  });

  it.each(['anon', 'service_role'] as const)('denies %s even with a member actor claim', async (role) => {
    const { client, space, parent, input } = await fixture();
    const requestId = randomUUID();
    await expect(inTransaction(client, async () => {
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [ownerId]);
      await client.query(role === 'anon' ? 'set local role anon' : 'set local role service_role');
      return insertSubcategory(client, { ...input, requestId });
    })).rejects.toMatchObject({ code: '42501', message: 'permission denied for function create_subcategory' });
    await expectUnchangedSpace(client, space.id, [parent.id], requestId);
  });

  it('replays the original child with one receipt after the child and parent are archived', async () => {
    const { client, space, parent, input } = await fixture();
    const requestId = randomUUID();
    const command = { ...input, requestId, nameEn: '  Ｆｏｏｄ   Shop ' };
    const child = await createSubcategory(client, ownerId, command);
    expect(await createSubcategory(client, ownerId, { ...command, nameEn: 'Food Shop' })).toEqual(child);
    await archiveCategory(client, ownerId, space.id, randomUUID(), child.id);
    await archiveCategory(client, ownerId, space.id, randomUUID(), parent.id);
    expect(await createSubcategory(client, ownerId, command)).toEqual(child);
    expect(await requestReceipts(client, space.id, [requestId])).toEqual([
      { request_id: requestId, category_id: child.id, command_kind: 'create_subcategory' },
    ]);
  });

  it.each(['parent', 'English name', 'Arabic name'] as const)(
    'rejects a changed %s on create replay and preserves the original receipt', async (changed) => {
      const { client, space, input } = await fixture();
      const other = await createRootCategory(client, ownerId, space.id, { nameEn: 'Other parent' });
      const requestId = randomUUID();
      const command = { ...input, requestId, nameAr: 'طفل' };
      const child = await createSubcategory(client, ownerId, command);
      const change = changed === 'parent' ? { parentCategoryId: other.id }
        : changed === 'English name' ? { nameEn: 'Changed' } : { nameAr: 'جديد' };
      const idsBefore = await categoryIds(client, space.id);
      await expect(createSubcategory(client, ownerId, { ...command, ...change }))
        .rejects.toMatchObject(replayError);
      expect(await categoryIds(client, space.id)).toEqual(idsBefore);
      expect(await requestReceipts(client, space.id, [requestId])).toEqual([
        { request_id: requestId, category_id: child.id, command_kind: 'create_subcategory' },
      ]);
    },
  );

  it.each([
    ['create_category', 'create_subcategory'],
    ['archive_category', 'create_subcategory'],
    ['create_subcategory', 'create_category'],
    ['create_subcategory', 'archive_category'],
    ['create_category', 'archive_category'],
    ['archive_category', 'create_category'],
  ] as const)('rejects %s request reuse by %s', async (firstKind, nextKind) => {
    const { client, space, input } = await fixture();
    const requestId = randomUUID();
    const archiveTarget = await createRootCategory(client, ownerId, space.id, { nameEn: 'Archive target' });
    const call = (kind: typeof firstKind) => {
      if (kind === 'create_category') {
        return createRootCategory(client, ownerId, space.id, { requestId, nameEn: 'Created root' });
      }
      if (kind === 'create_subcategory') {
        return createSubcategory(client, ownerId, { ...input, requestId });
      }
      return archiveCategory(client, ownerId, space.id, requestId, archiveTarget.id);
    };
    const original = await call(firstKind);
    const idsBefore = await categoryIds(client, space.id);
    await expect(call(nextKind)).rejects.toMatchObject(replayError);
    expect(await categoryIds(client, space.id)).toEqual(idsBefore);
    expect(await requestReceipts(client, space.id, [requestId])).toEqual([
      { request_id: requestId, category_id: original.id, command_kind: firstKind },
    ]);
  });

  it.each(['space', 'request', 'category'] as const)(
    'rejects a null %s archive identifier before any state mutation', async (field) => {
      const { client, space, parent } = await fixture();
      const requestId = randomUUID();
      await expect(archiveCategory(
        client, ownerId, field === 'space' ? null : space.id,
        field === 'request' ? null : requestId, field === 'category' ? null : parent.id,
      )).rejects.toMatchObject({
        code: 'P0001', message: 'space, request ID, and category are required',
      });
      expect(await categoryById(client, ownerId, parent.id)).toMatchObject({ archived_at: null });
      await expectUnchangedSpace(client, space.id, [parent.id], requestId);
    },
  );

  it('rejects a null category on archive replay while retaining its receipt', async () => {
    const { client, space, parent } = await fixture();
    const requestId = randomUUID();
    await archiveCategory(client, ownerId, space.id, requestId, parent.id);
    await expect(archiveCategory(client, ownerId, space.id, requestId, null)).rejects.toMatchObject({
      code: 'P0001', message: 'space, request ID, and category are required',
    });
    expect(await requestReceipts(client, space.id, [requestId])).toEqual([
      { request_id: requestId, category_id: parent.id, command_kind: 'archive_category' },
    ]);
  });

  it.each(['parent update alone', 'parent update combined with archive'] as const)(
    'rejects a direct owner %s', async (attempt) => {
      const { client, space, input } = await fixture();
      const child = await createSubcategory(client, ownerId, input);
      const other = await createRootCategory(client, ownerId, space.id, { nameEn: 'Other parent' });
      const before = await categoryById(client, ownerId, child.id);
      const sql = attempt === 'parent update alone'
        ? 'update public.categories set parent_category_id = $2 where id = $1'
        : `update public.categories
           set parent_category_id = $2, archived_by = $3, archived_at = now()
           where id = $1`;
      const values = attempt === 'parent update alone'
        ? [child.id, other.id] : [child.id, other.id, ownerId];
      await expect(inTransaction(client, () => client.query(sql, values))).rejects.toMatchObject(immutableError);
      expect(await categoryById(client, ownerId, child.id)).toEqual(before);
    },
  );

  it('rejects parent archival through the command while an active child exists', async () => {
    const { client, space, parent, input } = await fixture();
    const child = await createSubcategory(client, ownerId, input);
    const requestId = randomUUID();
    await expect(archiveCategory(client, ownerId, space.id, requestId, parent.id))
      .rejects.toMatchObject(archiveChildrenError);
    expect(await categoryById(client, ownerId, parent.id)).toMatchObject({ archived_at: null });
    expect(await categoryById(client, ownerId, child.id)).toMatchObject({ archived_at: null });
    expect(await requestReceipts(client, space.id, [requestId])).toEqual([]);
  });

  it('independently rejects a direct owner archive of a root with an active child', async () => {
    const { client, parent, input } = await fixture();
    await createSubcategory(client, ownerId, input);
    await expect(inTransaction(client, () => client.query(
      'update public.categories set archived_by = $2, archived_at = now() where id = $1',
      [parent.id, ownerId],
    ))).rejects.toMatchObject(archiveChildrenError);
    expect(await categoryById(client, ownerId, parent.id)).toMatchObject({ archived_at: null });
  });

  it.each(['child first', 'archive first'] as const)(
    'serializes two direct owner mutations with %s and no receipt side effects', async (order) => {
      const { client, space, parent } = await fixture();
      const childId = randomUUID();
      const receiptsBefore = await client.query(
        'select * from public.category_command_requests where space_id = $1 order by request_id limit 3',
        [space.id],
      );
      expect(receiptsBefore.rows).toHaveLength(1);
      const insert = (participant: Client) => participant.query(
        `insert into public.categories (id, space_id, kind, name_en, parent_category_id, created_by)
         values ($1, $2, 'expense', 'Owner race child', $3, $4)`,
        [childId, space.id, parent.id, ownerId],
      );
      const archive = (participant: Client) => participant.query(
        'update public.categories set archived_by = $2, archived_at = now() where id = $1',
        [parent.id, ownerId],
      );
      await orderedOwnerRace(currentDatabase(), order === 'child first' ? [insert, archive] : [archive, insert],
        order === 'child first' ? archiveChildrenError : parentError);
      expect(await categoryIds(client, space.id)).toEqual(
        (order === 'child first' ? [parent.id, childId] : [parent.id]).sort(),
      );
      expect(await categoryById(client, ownerId, parent.id)).toMatchObject({
        parent_category_id: null, archived_at: order === 'child first' ? null : expect.any(Date),
      });
      const child = await categoryById(client, ownerId, childId);
      if (order === 'child first') {
        expect(child).toMatchObject({ parent_category_id: parent.id, archived_at: null });
      } else {
        expect(child).toBeUndefined();
      }
      const receiptsAfter = await client.query(
        'select * from public.category_command_requests where space_id = $1 order by request_id limit 3',
        [space.id],
      );
      expect(receiptsAfter.rows).toEqual(receiptsBefore.rows);
    },
  );

  it('retains the command archive guard when the trigger is disabled inside a rolled-back transaction', async () => {
    const { client, space, parent, input } = await fixture();
    await createSubcategory(client, ownerId, input);
    const requestId = randomUUID();
    await expect(inTransaction(client, async () => {
      await client.query('alter table public.categories disable trigger categories_guard_archive_update');
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [ownerId]);
      await client.query('set local role authenticated');
      await archiveCategoryInTransaction(client, space.id, requestId, parent.id);
      throw new Error('archive unexpectedly succeeded without the trigger; roll back its disabled state');
    })).rejects.toMatchObject(archiveChildrenError);
    expect(await categoryById(client, ownerId, parent.id)).toMatchObject({ archived_at: null });
    expect(await requestReceipts(client, space.id, [requestId])).toEqual([]);
  });

  it('archives a child and then its parent while retaining both historical labels', async () => {
    const { client, space, parent, input } = await fixture();
    const child = await createSubcategory(client, ownerId, { ...input, nameAr: 'طفل' });
    expect(await archiveCategory(client, ownerId, space.id, randomUUID(), child.id)).toEqual(child);
    expect(await archiveCategory(client, ownerId, space.id, randomUUID(), parent.id)).toEqual(parent);
    expect(await categoryById(client, ownerId, child.id)).toMatchObject({
      id: child.id, name_en: 'Child', name_ar: 'طفل',
      parent_category_id: parent.id, archived_at: expect.any(Date),
    });
    expect(await categoryById(client, ownerId, parent.id)).toMatchObject({
      id: parent.id, name_en: 'Essentials', parent_category_id: null, archived_at: expect.any(Date),
    });
  });

  it('replays archive exactly without rewriting its timestamp and rejects a different target', async () => {
    const { client, space, parent } = await fixture();
    const requestId = randomUUID();
    expect(await archiveCategory(client, ownerId, space.id, requestId, parent.id)).toEqual(parent);
    const archived = await categoryById(client, ownerId, parent.id);
    expect(await archiveCategory(client, ownerId, space.id, requestId, parent.id)).toEqual(parent);
    expect(await categoryById(client, ownerId, parent.id)).toEqual(archived);
    await expect(archiveCategory(client, ownerId, space.id, requestId, randomUUID()))
      .rejects.toMatchObject(replayError);
    const freshRequestId = randomUUID();
    await expect(archiveCategory(client, ownerId, space.id, freshRequestId, parent.id))
      .rejects.toMatchObject({ code: 'P0001', message: 'the category is already archived' });
    expect(await requestReceipts(client, space.id, [requestId, freshRequestId])).toEqual([
      { request_id: requestId, category_id: parent.id, command_kind: 'archive_category' },
    ]);
    await expect(inTransaction(client, () => client.query(
      'update public.categories set archived_at = null, archived_by = null where id = $1',
      [parent.id],
    ))).rejects.toMatchObject(immutableError);
  });

  it('serializes exactly two child-create and parent-archive transactions into one valid final state', async () => {
    const { client, space, parent, input } = await fixture();
    const createRequestId = randomUUID();
    const archiveRequestId = randomUUID();
    const results = await raceAuthenticated(currentDatabase(), ownerId, [
      (participant) => insertSubcategory(participant, { ...input, requestId: createRequestId }),
      (participant) => archiveCategoryInTransaction(participant, space.id, archiveRequestId, parent.id),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const parentRow = await categoryById(client, ownerId, parent.id);
    expect(parentRow).toBeDefined();
    const children = await client.query<{ id: string }>(
      `select id from public.categories
       where parent_category_id = $1 and space_id = $2 and kind = 'expense' and archived_at is null
       order by id limit 2`,
      [parent.id, space.id],
    );
    const finalState = {
      parentArchived: parentRow?.archived_at !== null,
      activeChildren: children.rowCount,
    };
    expect([
      { parentArchived: false, activeChildren: 1 },
      { parentArchived: true, activeChildren: 0 },
    ]).toContainEqual(finalState);
    const creationWon = results[0]?.status === 'fulfilled';
    expect(rejected[0]?.reason).toMatchObject(creationWon ? archiveChildrenError : parentError);
    expect(finalState.parentArchived).toBe(!creationWon);
    expect(await categoryIds(client, space.id)).toHaveLength(creationWon ? 2 : 1);
    if (creationWon) {
      expect(children.rows).toEqual([fulfilled[0]?.value]);
    }
    expect(await requestReceipts(client, space.id, [createRequestId, archiveRequestId])).toEqual([
      {
        request_id: creationWon ? createRequestId : archiveRequestId,
        category_id: fulfilled[0]?.value.id,
        command_kind: creationWon ? 'create_subcategory' : 'archive_category',
      },
    ]);
  });

  it('serializes two exact create requests to the same child with one receipt', async () => {
    const { client, space, input } = await fixture();
    const requestId = randomUUID();
    const command = { ...input, requestId };
    const results = await raceAuthenticated(currentDatabase(), ownerId, [
      (participant) => insertSubcategory(participant, command),
      (participant) => insertSubcategory(participant, command),
    ]);
    expect(results.filter((result) => result.status === 'rejected')).toEqual([]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    expect(fulfilled).toHaveLength(2);
    expect(fulfilled[0]?.value).toEqual(fulfilled[1]?.value);
    expect(fulfilled[0]?.value).toMatchObject({ id: expect.any(String) });
    expect(await categoryIds(client, space.id)).toHaveLength(2);
    expect(await requestReceipts(client, space.id, [requestId])).toEqual([
      { request_id: requestId, category_id: fulfilled[0]?.value.id, command_kind: 'create_subcategory' },
    ]);
  });

  it.each([
    ['English', '  Ｆｏｏｄ   Shop ', null, 'food shop', null],
    ['Arabic', null, 'دخل ٌ إضافي', null, 'دخل إضافي'],
  ] as const)('serializes %s duplicate creates under different parents with one stable rejection', async (
    _label, firstEn, firstAr, secondEn, secondAr,
  ) => {
    const { client, space, parent, input } = await fixture();
    const other = await createRootCategory(client, ownerId, space.id, { nameEn: 'Other parent' });
    const firstRequestId = randomUUID();
    const secondRequestId = randomUUID();
    const results = await raceAuthenticated(currentDatabase(), ownerId, [
      (participant) => insertSubcategory(participant, {
        ...input, requestId: firstRequestId, nameEn: firstEn, nameAr: firstAr,
      }),
      (participant) => insertSubcategory(participant, {
        ...input, requestId: secondRequestId, parentCategoryId: other.id, nameEn: secondEn, nameAr: secondAr,
      }),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject(duplicateError);
    expect(await categoryIds(client, space.id)).toHaveLength(3);
    const winner = fulfilled[0]?.value;
    if (!winner) {
      throw new Error('the duplicate-name race returned no successful child');
    }
    const firstWon = results[0]?.status === 'fulfilled';
    expect(await categoryById(client, ownerId, winner.id)).toMatchObject({
      parent_category_id: firstWon ? parent.id : other.id, archived_at: null,
    });
    expect(await requestReceipts(client, space.id, [firstRequestId, secondRequestId])).toEqual([
      {
        request_id: firstWon ? firstRequestId : secondRequestId,
        category_id: winner.id, command_kind: 'create_subcategory',
      },
    ]);
  });
});
