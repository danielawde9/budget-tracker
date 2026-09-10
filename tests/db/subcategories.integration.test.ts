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
  spaceId: string;
  requestId: string;
  parentCategoryId: string;
  nameEn: string | null;
  nameAr: string | null;
}>;

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
): Promise<{ id: string }> {
  return withAuthenticatedTransaction(client, ownerId, async () => {
    const result = await client.query<{ id: string }>(
      `select * from public.create_category($1, $2, $3::public.category_kind, $4, $5)`,
      [spaceId, randomUUID(), 'expense', 'Essentials', null],
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
  return withAuthenticatedTransaction(client, ownerId, async () => {
    const result = await client.query<{ id: string }>(
      'select * from public.create_subcategory($1, $2, $3, $4, $5)',
      [
        command.spaceId,
        command.requestId,
        command.parentCategoryId,
        command.nameEn,
        command.nameAr,
      ],
    );
    const category = result.rows[0];
    if (!category) {
      throw new Error('create_subcategory returned no category');
    }
    return category;
  });
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
  let spaceId = '';
  let essentialsId = '';

  beforeAll(async () => {
    database = await createDisposableDatabase();
    try {
      await bootstrapCompatibilityObjects(database.client);
      migrations = migrationFiles();
      await replayMigrations(database.client, migrations);

      ownerId = randomUUID();
      await database.client.query(
        `insert into auth.users (id, email, email_confirmed_at)
         values ($1, $2, now())`,
        [ownerId, `subcategories-${ownerId}@budget.invalid`],
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
});
