import { randomBytes, randomUUID } from 'node:crypto';
import { closeSync, fstatSync, openSync, opendirSync, readSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface MigrationFile {
  name: string;
  path: string;
  version: string;
}

interface CategoryRow {
  id: string;
  space_id: string;
  kind: 'income' | 'expense';
  name_en: string | null;
  name_ar: string | null;
  parent_category_id: string | null;
  archived_at: Date | null;
}

interface DisposableDatabase {
  admin: Client;
  client: Client;
  name: string;
  url: string;
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

const databaseNamePattern = /^budget_subcategories_[0-9a-f]{12}$/;
const migrationNamePattern = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const maximumMigrationCount = 100;
const maximumMigrationBytes = 1_048_576;
const maximumTerminatedSessions = 20;
const databaseTimeoutMillis = 10_000;

function testDatabaseUrl(): string {
  const value = process.env.BUDGET_TEST_DATABASE_URL;

  if (!value) {
    throw new Error('BUDGET_TEST_DATABASE_URL must be set for database integration tests');
  }

  return value;
}

function assertDisposableDatabaseName(name: string): void {
  if (!databaseNamePattern.test(name)) {
    throw new Error('refusing to interpolate an invalid disposable database name');
  }
}

function createDisposableDatabaseName(): string {
  const name = `budget_subcategories_${randomBytes(6).toString('hex')}`;
  assertDisposableDatabaseName(name);
  return name;
}

function childDatabaseUrl(serverUrl: string, name: string): string {
  assertDisposableDatabaseName(name);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

function databaseClient(connectionString: string): Client {
  return new Client({
    connectionString,
    connectionTimeoutMillis: databaseTimeoutMillis,
    lock_timeout: databaseTimeoutMillis,
    query_timeout: databaseTimeoutMillis,
    statement_timeout: databaseTimeoutMillis,
  });
}

async function dropDisposableDatabase(admin: Client, name: string): Promise<void> {
  assertDisposableDatabaseName(name);
  const ownership = await admin.query<{ owned_by_current_role: boolean }>(
    `select database.datdba = role.oid as owned_by_current_role
     from pg_catalog.pg_database as database
     join pg_catalog.pg_roles as role on role.rolname = current_user
     where database.datname = $1
     limit 1`,
    [name],
  );

  if (ownership.rows[0]?.owned_by_current_role !== true) {
    throw new Error('refusing to drop a disposable database not owned by the current role');
  }

  await admin.query(
    `select pg_catalog.pg_terminate_backend(session.pid)
     from (
       select activity.pid
       from pg_catalog.pg_stat_activity as activity
       where activity.datname = $1
         and activity.usename = current_user
         and activity.pid <> pg_catalog.pg_backend_pid()
       order by activity.pid
       limit ${maximumTerminatedSessions}
     ) as session`,
    [name],
  );

  assertDisposableDatabaseName(name);
  await admin.query(`drop database ${name}`);
  const remaining = await admin.query(
    'select 1 from pg_catalog.pg_database where datname = $1 limit 1',
    [name],
  );
  if (remaining.rowCount !== 0) {
    throw new Error('disposable database cleanup did not remove the exact database');
  }
}

async function disposeDisposableDatabase(database: DisposableDatabase): Promise<void> {
  const errors: unknown[] = [];

  try {
    try {
      await database.client.end();
    } catch (error) {
      errors.push(error);
    }

    try {
      await dropDisposableDatabase(database.admin, database.name);
    } catch (error) {
      errors.push(error);
    }
  } finally {
    try {
      await database.admin.end();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, 'failed to clean up the exact disposable database');
  }
}

async function createDisposableDatabase(): Promise<DisposableDatabase> {
  const serverUrl = testDatabaseUrl();
  const admin = databaseClient(serverUrl);
  let client: Client | undefined;
  let name: string | undefined;
  let created = false;

  try {
    await admin.connect();
    name = createDisposableDatabaseName();
    const url = childDatabaseUrl(serverUrl, name);
    client = databaseClient(url);
    assertDisposableDatabaseName(name);
    await admin.query(`create database ${name} with template template0`);
    created = true;
    await client.connect();
    return { admin, client, name, url };
  } catch (error) {
    const cleanupErrors: unknown[] = [error];
    if (client) {
      try {
        await client.end();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (created && name) {
      try {
        await dropDisposableDatabase(admin, name);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    try {
      await admin.end();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    throw new AggregateError(cleanupErrors, 'failed to create the disposable database');
  }
}

function boundedMigrationNames(migrationDirectory: string): string[] {
  const directory = opendirSync(migrationDirectory);
  const files: string[] = [];

  try {
    for (let inspected = 0; inspected <= maximumMigrationCount; inspected += 1) {
      const entry = directory.readSync();
      if (!entry) {
        return files;
      }
      if (inspected === maximumMigrationCount) {
        throw new Error('migration directory exceeds 100 entries');
      }
      if (entry.isFile() && migrationNamePattern.test(entry.name)) {
        files.push(entry.name);
      }
    }
    throw new Error('migration directory scan exceeded its fixed iteration bound');
  } finally {
    directory.closeSync();
  }
}

function migrationFiles(): MigrationFile[] {
  const migrationDirectory = join(process.cwd(), 'supabase/migrations');
  const files = boundedMigrationNames(migrationDirectory)
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));

  if (files.length < 1 || files.length > maximumMigrationCount) {
    throw new Error('migration journal must contain between 1 and 100 bounded files');
  }

  return files.map((name) => {
    const match = migrationNamePattern.exec(name);
    if (!match?.[1] || !match[2]) {
      throw new Error('migration filename is outside the exact allowlist');
    }
    return {
      name: match[2],
      path: join(migrationDirectory, name),
      version: match[1],
    };
  });
}

function readBoundedMigration(path: string): string {
  const descriptor = openSync(path, 'r');

  try {
    const size = fstatSync(descriptor).size;
    if (!Number.isSafeInteger(size) || size < 1 || size > maximumMigrationBytes) {
      throw new Error('migration file must contain between 1 byte and 1 MiB');
    }

    const contents = Buffer.alloc(size);
    let offset = 0;
    for (let attempt = 0; attempt < maximumMigrationBytes && offset < size; attempt += 1) {
      const bytesRead = readSync(descriptor, contents, offset, size - offset, offset);
      if (bytesRead < 1) {
        throw new Error('migration file ended before its bounded size was read');
      }
      offset += bytesRead;
    }
    if (offset !== size) {
      throw new Error('migration file exceeded its fixed read iteration bound');
    }
    return contents.toString('utf8');
  } finally {
    closeSync(descriptor);
  }
}

async function inTransaction<T>(client: Client, action: () => Promise<T>): Promise<T> {
  await client.query('begin');
  try {
    const result = await action();
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'transaction and rollback both failed');
    }
    throw error;
  }
}

async function bootstrapCompatibilityObjects(client: Client): Promise<void> {
  await inTransaction(client, async () => {
    await client.query(`
      create schema auth;
      create table auth.users (
        id uuid primary key,
        email text,
        email_confirmed_at timestamptz
      );
      create function auth.uid()
      returns uuid
      language sql
      stable
      set search_path = pg_catalog
      as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      create schema extensions;
      create extension pgcrypto with schema extensions;
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations (
        version text primary key,
        statements text[] not null default array[]::text[],
        name text
      );
    `);
  });
}

async function replayMigrations(client: Client, migrations: MigrationFile[]): Promise<void> {
  for (const migration of migrations) {
    const statements = readBoundedMigration(migration.path);
    await inTransaction(client, async () => {
      await client.query(statements);
      await client.query(
        `insert into supabase_migrations.schema_migrations (version, statements, name)
         values ($1, $2, $3)`,
        [migration.version, [statements], migration.name],
      );
    });
  }
}

async function withAuthenticatedTransaction<T>(
  client: Client,
  userId: string,
  action: () => Promise<T>,
): Promise<T> {
  return inTransaction(client, async () => {
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query('set local role authenticated');
    return action();
  });
}

async function createSpace(client: Client, ownerId: string): Promise<{ id: string }> {
  return withAuthenticatedTransaction(client, ownerId, async () => {
    const result = await client.query<{ id: string }>(
      'select * from public.create_space($1, $2)',
      [`Subcategories ${randomUUID()}`, 'household'],
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
    database = await createDisposableDatabase();
    try {
      await bootstrapCompatibilityObjects(database.client);
      migrations = migrationFiles();
      await replayMigrations(database.client, migrations);

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
  });

  afterAll(async () => {
    if (!database) {
      return;
    }
    const completedDatabase = database;
    database = undefined;
    await disposeDisposableDatabase(completedDatabase);
  });

  it('replays all 19 migrations before testing the new contract', async () => {
    if (!database) {
      throw new Error('disposable database is unavailable');
    }
    const journal = await database.client.query<{ version: string }>(
      `select version
       from supabase_migrations.schema_migrations
       order by version
       limit 100`,
    );
    expect(migrations).toHaveLength(19);
    expect(journal.rows.map((row) => row.version)).toEqual(
      migrations.map((migration) => migration.version),
    );
  });

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
