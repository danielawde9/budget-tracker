import { randomBytes } from 'node:crypto';
import { closeSync, fstatSync, openSync, opendirSync, readSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';
import { expect } from 'vitest';

export interface MigrationFile {
  name: string;
  path: string;
  version: string;
}

export interface DisposableDatabase {
  admin: Client;
  client: Client;
  name: string;
  url: string;
}

const prefixPattern = /^budget_[a-z]{1,24}$/;
const databaseNamePattern = /^budget_[a-z]{1,24}_[0-9a-f]{12}$/;
const migrationNamePattern = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const maximumMigrationCount = 100;
const maximumMigrationBytes = 1_048_576;
const maximumTerminatedSessions = 20;
const databaseTimeoutMillis = 10_000;
const lockWaitMillis = 5_000;

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

function childDatabaseUrl(serverUrl: string, name: string): string {
  assertDisposableDatabaseName(name);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

export function databaseClient(connectionString: string): Client {
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
  const remaining = await admin.query('select 1 from pg_catalog.pg_database where datname = $1 limit 1', [name]);
  if (remaining.rowCount !== 0) {
    throw new Error('disposable database cleanup did not remove the exact database');
  }
}

export async function disposeDisposableDatabase(database: DisposableDatabase): Promise<void> {
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

export async function createDisposableDatabase(prefix: string): Promise<DisposableDatabase> {
  if (!prefixPattern.test(prefix)) {
    throw new Error('disposable database prefix must match budget_[a-z]{1,24}');
  }
  const serverUrl = testDatabaseUrl();
  const admin = databaseClient(serverUrl);
  const name = `${prefix}_${randomBytes(6).toString('hex')}`;
  assertDisposableDatabaseName(name);
  const url = childDatabaseUrl(serverUrl, name);
  const client = databaseClient(url);
  let created = false;
  try {
    await admin.connect();
    await admin.query(`create database ${name} with template template0`);
    created = true;
    await client.connect();
    return { admin, client, name, url };
  } catch (error) {
    const cleanupErrors: unknown[] = [error];
    try {
      await client.end();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (created) {
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

export function migrationFiles(): MigrationFile[] {
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
    return { name: match[2], path: join(migrationDirectory, name), version: match[1] };
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

export async function inTransaction<T>(client: Client, action: () => Promise<T>): Promise<T> {
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

export async function bootstrapCompatibilityObjects(client: Client): Promise<void> {
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

export async function replayMigrations(client: Client, migrations: readonly MigrationFile[]): Promise<void> {
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

export async function withAuthenticatedTransaction<T>(
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

export async function withRollback<T>(client: Client, action: () => Promise<T>): Promise<T> {
  await client.query('begin');
  try {
    return await action();
  } finally {
    await client.query('rollback');
  }
}

export async function expectSavepointRejection(
  client: Client,
  action: () => Promise<unknown>,
  error: { code: string; message?: string; constraint?: string },
): Promise<void> {
  await client.query('savepoint rejection_probe');
  try {
    await expect(action()).rejects.toMatchObject(error);
  } finally {
    await client.query('rollback to savepoint rejection_probe');
    await client.query('release savepoint rejection_probe');
  }
}

async function waitUntilBlocked(
  observer: Client,
  waiterPid: number,
  holderPid: number,
  finished: () => boolean,
): Promise<void> {
  const deadline = Date.now() + lockWaitMillis;
  for (let attempt = 0; attempt < 256 && Date.now() < deadline; attempt += 1) {
    if (finished()) {
      throw new Error('the second transaction finished before waiting on the first transaction');
    }
    const result = await observer.query<{ blocked: boolean }>(
      'select $2::integer = any(pg_catalog.pg_blocking_pids($1::integer)) as blocked limit 1',
      [waiterPid, holderPid],
    );
    if (result.rows[0]?.blocked === true) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('the second transaction did not block on the first transaction in time');
}

/**
 * Runs `first` in an open authenticated transaction, starts `second` in another,
 * proves `second` is blocked by `first`, commits `first`, and returns how `second`
 * settled (committed on success, rolled back on failure).
 */
export async function orderedAuthenticatedRace(
  database: DisposableDatabase,
  userId: string,
  first: (client: Client) => Promise<unknown>,
  second: (client: Client) => Promise<unknown>,
): Promise<PromiseSettledResult<unknown>> {
  const clients = [databaseClient(database.url), databaseClient(database.url)] as const;
  const pids: number[] = [];
  const errors: unknown[] = [];
  let pending: Promise<PromiseSettledResult<unknown>> | undefined;
  let outcome: PromiseSettledResult<unknown> | undefined;
  try {
    for (const client of clients) {
      await client.connect();
      const pid = await client.query<{ pid: number }>('select pg_catalog.pg_backend_pid() as pid limit 1');
      const value = pid.rows[0]?.pid;
      if (typeof value !== 'number') {
        throw new Error('race participant has no backend pid');
      }
      pids.push(value);
      await client.query('begin');
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
      await client.query('set local role authenticated');
    }
    const [holderPid, waiterPid] = pids;
    if (holderPid === undefined || waiterPid === undefined) {
      throw new Error('race participants are missing');
    }
    await first(clients[0]);
    let finished = false;
    pending = second(clients[1]).then(
      (value): PromiseSettledResult<unknown> => {
        finished = true;
        return { status: 'fulfilled', value };
      },
      (reason: unknown): PromiseSettledResult<unknown> => {
        finished = true;
        return { status: 'rejected', reason };
      },
    );
    await waitUntilBlocked(database.client, waiterPid, holderPid, () => finished);
    await clients[0].query('commit');
    outcome = await pending;
    await clients[1].query(outcome.status === 'fulfilled' ? 'commit' : 'rollback');
  } catch (error) {
    errors.push(error);
  } finally {
    // Release the holder before draining a possibly blocked waiter.
    const holderRollback = await Promise.allSettled([clients[0].query('rollback')]);
    if (pending) {
      await pending;
    }
    const waiterRollback = await Promise.allSettled([clients[1].query('rollback')]);
    const closed = await Promise.allSettled(clients.map((client) => client.end()));
    errors.push(...[...holderRollback, ...waiterRollback, ...closed]
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason));
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'ordered race or its cleanup failed');
  }
  if (!outcome) {
    throw new Error('the ordered race produced no outcome');
  }
  return outcome;
}
