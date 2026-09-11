# Wallet Lifecycle Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add protected, request-idempotent `rename_wallet`, `archive_wallet`, `restore_wallet`, and `get_wallet_command_result` database commands, an append-only wallet command log, and schema guards so archived wallets can never move money — proven on real Postgres.

**Architecture:** One forward-only migration updates `public.wallets` in place through `SECURITY DEFINER` commands and appends one row per request to `public.wallet_command_requests`. Row triggers restrict wallet updates to `name`/`archived_at`, refuse wallet deletion, keep the log append-only, and lock the target wallet `FOR SHARE` on every `wallet_movements` insert so archive and posting serialize. Real-Postgres tests run in disposable databases on the development cluster; ops manifests then pin the 33-migration release.

**Tech Stack:** Node 22.22.0, pnpm 11.17.0, PostgreSQL 17 (Supabase CLI stack, `server_version_num` 170006), plpgsql, pgcrypto (`extensions.digest`), TypeScript strict, Vitest 5, `pg` 8.23.

**Spec:** `docs/superpowers/specs/2026-09-11-wallet-rename-archive-design.md` (milestone 1: Database). The Application/UI milestone gets its own plan after this one is merged.

## Global Constraints

- **Scope:** database milestone only. Do not touch `src/`, `e2e/`, `worker/`, or UI copy. No hosted/live Supabase command, no push, no deploy, no external send.
- **Migration:** exactly one new file, `supabase/migrations/20260911100000_wallet_lifecycle_commands.sql`. It may be edited freely until Task 7 applies it to the shared development database; after that it is immutable (fix forward with a new migration).
- **Mutating commands:** `language plpgsql security definer set search_path = pg_catalog, extensions`, `returns table (id uuid)`; `REVOKE ALL … FROM public, anon, service_role`; `GRANT EXECUTE … TO authenticated`.
- **Read command:** `get_wallet_command_result` is `stable security definer set search_path = pg_catalog` with the same grants.
- **Private helpers:** `set search_path = pg_catalog`; only `private.require_active_movement_wallet()` is `security definer`; `REVOKE ALL … FROM public, anon, authenticated, service_role`.
- **Authorization:** active membership via `private.is_active_member(p_space_id)`; any active member (owner or member) may run all three commands.
- **Name rule:** stored name is `btrim(p_name)`, 1–120 characters, must differ from the current name.
- **Exact errors** (tests assert code and message):

  | Code | Message |
  | --- | --- |
  | `42501` | `an active space membership is required` |
  | `P0001` | `request ID and wallet ID are required` |
  | `P0001` | `request ID was already used with different data` |
  | `P0001` | `the wallet does not belong to the requested space` |
  | `P0001` | `the wallet is archived` |
  | `P0001` | `the wallet name must be 1 to 120 characters` |
  | `P0001` | `the wallet already has this name` |
  | `P0001` | `the wallet is already archived` |
  | `P0001` | `the wallet balance must be zero to archive` |
  | `P0001` | `the wallet is not archived` |
  | `P0001` | `every wallet movement must use an active wallet` |
  | `42501` | `protected rows may be written only by their owning command` (existing `private.require_table_owner_write()` text) |
  | `42501` | `wallets may change only their name and archive state` |
  | `42501` | `wallets are archived, never deleted` |
  | `42501` | `wallet command history is immutable` |

- **Tests:** real Postgres only (`BUDGET_TEST_DATABASE_URL`, disposable databases). Every row-returning query has a `limit`. TypeScript is strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; imports use `.js` suffixes (NodeNext).
- **Environment:** before any database command run `set -a && source ./.env.test && set +a`. Focused suite command: `pnpm exec vitest run tests/db/wallet-lifecycle.integration.test.ts --pool=forks --no-file-parallelism`.
- **Ops cap:** `pnpm check:ops` scans at most 256 tracked text files; the repo has 237 including this plan, and this milestone adds 3.
- **Git:** work on branch `claude/wallet-lifecycle-database` created from `claude/wallets-undo-expense-default` (it carries the spec and this plan). Conventional commits ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Each `docs/decisions.md` entry lands in the same commit as the change it describes. Never stage `.DS_Store`, `.claude-flow/`, `.swarm/`, `artifacts/.DS_Store`, `docs/.DS_Store`, or `supabase/.temp/`.

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260911100000_wallet_lifecycle_commands.sql` (create) | The whole database contract: log table, guards, movement trigger, helpers, four commands, grants. Built in four sections across Tasks 1–4. |
| `tests/db/disposable-database.ts` (create) | Reusable disposable-database harness: create/drop, bounded migration replay, Supabase compatibility bootstrap, authenticated transactions, rollback probes, ordered two-connection lock race. Existing suites keep their private copies (consolidation is out of scope). |
| `tests/db/wallet-lifecycle.integration.test.ts` (create) | Real-Postgres proof of the spec's verification requirements. Grows task by task. |
| `tests/db/test-database.ts` (modify) | Add `wallet_command_requests` to the shared non-writable table ratchet. |
| `tests/db/financial-boundary-coverage.integration.test.ts` (modify) | Expect the new table in both non-writable ratchets. |
| `docs/financial-command-inventory.md` (modify) | Document the lifecycle commands beside the category lifecycle commands. |
| `docs/decisions.md` (modify) | Four decision entries (Tasks 1–4). |
| `ops/budget-migrations.sha256`, `scripts/ops/apply-live-migrations.sh`, `tests/ops/migration-manifest.test.ts`, `tests/ops/live-migrations.test.ts` (modify) | Pin the reviewed 33-migration release (Task 8). |

---

### Task 1: Disposable harness, wallet command log, and wallet row guards

**Files:**
- Create: `tests/db/disposable-database.ts`
- Create: `tests/db/wallet-lifecycle.integration.test.ts`
- Create: `supabase/migrations/20260911100000_wallet_lifecycle_commands.sql`
- Modify: `docs/decisions.md` (append)

**Interfaces:**
- Consumes: existing `private.require_table_owner_write()`, `public.create_space(text, space_kind)`, `public.create_wallet(uuid, text, currency_code)`, `public.record_financial_event(uuid, uuid, financial_event_kind, date, jsonb)`.
- Produces (harness): `createDisposableDatabase(prefix: string): Promise<DisposableDatabase>`, `disposeDisposableDatabase(db)`, `migrationFiles(): MigrationFile[]`, `bootstrapCompatibilityObjects(client)`, `replayMigrations(client, files)`, `withAuthenticatedTransaction<T>(client, userId, action: () => Promise<T>)`, `withRollback<T>(client, action)`, `expectSavepointRejection(client, action, error)`, `orderedAuthenticatedRace(db, userId, first, second): Promise<PromiseSettledResult<unknown>>`, types `DisposableDatabase { admin; client; name; url }`, `MigrationFile { name; path; version }`.
- Produces (test helpers used by later tasks): `insertUsers`, `createSpace(client, ownerId, kind): Promise<string>`, `addHouseholdMember`, `createWallet(client, actorId, spaceId, name, currency?): Promise<string>`, `postEvent(client, actorId, spaceId, kind, movements, requestId?): Promise<string>`, `walletRow(client, walletId): Promise<WalletRow>`, `walletBalance(client, walletId): Promise<string>`, `archiveWalletDirectly(client, walletId)`, `logRows(client, walletId): Promise<LogRow[]>`, `functionCatalog(client, signatures)`.
- Produces (SQL): table `public.wallet_command_requests`, functions `private.reject_wallet_command_history_mutation()`, `private.guard_wallet_update()`, `private.reject_wallet_deletion()`, triggers listed in Step 4.

- [ ] **Step 1: Create the branch**

```bash
git switch -c claude/wallet-lifecycle-database
```

- [ ] **Step 2: Create the disposable-database harness**

Create `tests/db/disposable-database.ts`:

```ts
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
```

- [ ] **Step 3: Write the failing suite skeleton and guard tests**

Create `tests/db/wallet-lifecycle.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bootstrapCompatibilityObjects,
  createDisposableDatabase,
  disposeDisposableDatabase,
  expectSavepointRejection,
  migrationFiles,
  replayMigrations,
  withAuthenticatedTransaction,
  withRollback,
  type DisposableDatabase,
  type MigrationFile,
} from './disposable-database.js';

type Currency = 'USD' | 'LBP';
type GeneralEventKind = 'opening_balance' | 'income' | 'expense' | 'transfer';

interface MovementInput {
  walletId: string;
  amountMinor: string;
}

interface WalletRow {
  id: string;
  space_id: string;
  name: string;
  currency: Currency;
  archived_at: Date | null;
  created_at: Date;
}

interface LogRow {
  request_id: string;
  command_kind: string;
  wallet_id: string;
  actor_id: string;
  previous_name: string | null;
  name: string | null;
}

const lifecycleVersion = '20260911100000';
const ownerWriteError = { code: '42501', message: 'protected rows may be written only by their owning command' };
const walletShapeError = { code: '42501', message: 'wallets may change only their name and archive state' };
const walletDeleteError = { code: '42501', message: 'wallets are archived, never deleted' };
const logImmutableError = { code: '42501', message: 'wallet command history is immutable' };

async function insertUsers(client: Client, userIds: readonly string[]): Promise<void> {
  if (userIds.length < 1 || userIds.length > 8) {
    throw new Error('test user setup accepts between one and eight users');
  }
  await client.query(
    `insert into auth.users (id, email, email_confirmed_at)
     select user_id, 'wallets-' || user_id::text || '@budget.invalid', now()
     from unnest($1::uuid[]) as user_id
     limit 8`,
    [userIds],
  );
}

async function createSpace(client: Client, ownerId: string, kind: 'personal' | 'household'): Promise<string> {
  return withAuthenticatedTransaction(client, ownerId, async () => {
    const result = await client.query<{ id: string }>(
      'select * from public.create_space($1, $2) limit 2',
      [`Wallets ${randomUUID()}`, kind],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.id;
  });
}

async function addHouseholdMember(client: Client, spaceId: string, userId: string): Promise<void> {
  await client.query(
    "insert into public.space_memberships (space_id, user_id, role) values ($1, $2, 'member')",
    [spaceId, userId],
  );
}

async function createWallet(
  client: Client,
  actorId: string,
  spaceId: string,
  name: string,
  currency: Currency = 'USD',
): Promise<string> {
  return withAuthenticatedTransaction(client, actorId, async () => {
    const result = await client.query<{ id: string }>(
      'select * from public.create_wallet($1, $2, $3::public.currency_code) limit 2',
      [spaceId, name, currency],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.id;
  });
}

async function postEvent(
  client: Client,
  actorId: string,
  spaceId: string,
  kind: GeneralEventKind,
  movements: readonly MovementInput[],
  requestId: string = randomUUID(),
): Promise<string> {
  return withAuthenticatedTransaction(client, actorId, async () => {
    const result = await client.query<{ id: string }>(
      `select * from public.record_financial_event(
         $1, $2, $3::public.financial_event_kind, '2026-09-11', $4::jsonb
       ) limit 2`,
      [spaceId, requestId, kind, JSON.stringify(movements)],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.id;
  });
}

async function walletRow(client: Client, walletId: string): Promise<WalletRow> {
  const result = await client.query<WalletRow>(
    `select id, space_id, name, currency::text as currency, archived_at, created_at
     from public.wallets
     where id = $1
     limit 2`,
    [walletId],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!;
}

async function walletBalance(client: Client, walletId: string): Promise<string> {
  const result = await client.query<{ amount_minor: string }>(
    `select coalesce(sum(amount_minor), 0)::text as amount_minor
     from public.wallet_movements
     where wallet_id = $1`,
    [walletId],
  );
  return result.rows[0]?.amount_minor ?? '0';
}

async function archiveWalletDirectly(client: Client, walletId: string): Promise<void> {
  const result = await client.query(
    'update public.wallets set archived_at = now() where id = $1 and archived_at is null',
    [walletId],
  );
  expect(result.rowCount).toBe(1);
}

async function logRows(client: Client, walletId: string): Promise<LogRow[]> {
  const result = await client.query<LogRow>(
    `select request_id, command_kind, wallet_id, actor_id, previous_name, name
     from public.wallet_command_requests
     where wallet_id = $1
     order by created_at, request_id
     limit 51`,
    [walletId],
  );
  expect(result.rows.length).toBeLessThanOrEqual(50);
  return result.rows;
}

async function functionCatalog(client: Client, signatures: readonly string[]) {
  const result = await client.query<Record<string, unknown>>(
    `select procedure.oid::regprocedure::text as signature,
       pg_get_function_result(procedure.oid) as result,
       procedure.prosecdef, procedure.provolatile, procedure.proconfig,
       has_function_privilege('public', procedure.oid, 'execute') as public_exec,
       has_function_privilege('anon', procedure.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', procedure.oid, 'execute') as authenticated_exec,
       has_function_privilege('service_role', procedure.oid, 'execute') as service_exec
     from pg_proc as procedure
     where procedure.oid = any($1::regprocedure[])
     order by procedure.oid::regprocedure::text collate "C"
     limit 20`,
    [signatures],
  );
  expect(result.rows).toHaveLength(signatures.length);
  return result.rows;
}

describe('wallet lifecycle database contract', () => {
  let database: DisposableDatabase | undefined;
  let migrations: MigrationFile[] = [];
  let ownerId = '';
  let memberId = '';
  let outsiderId = '';
  let personalId = '';
  let householdId = '';

  function currentDatabase(): DisposableDatabase {
    if (!database) {
      throw new Error('disposable database is unavailable');
    }
    return database;
  }

  beforeAll(async () => {
    database = await createDisposableDatabase('budget_wallets');
    try {
      await bootstrapCompatibilityObjects(database.client);
      migrations = migrationFiles();
      await replayMigrations(database.client, migrations);
      ownerId = randomUUID();
      memberId = randomUUID();
      outsiderId = randomUUID();
      await insertUsers(database.client, [ownerId, memberId, outsiderId]);
      personalId = await createSpace(database.client, ownerId, 'personal');
      householdId = await createSpace(database.client, ownerId, 'household');
      await addHouseholdMember(database.client, householdId, memberId);
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
  }, 120_000);

  afterAll(async () => {
    if (!database) {
      return;
    }
    const completedDatabase = database;
    database = undefined;
    await disposeDisposableDatabase(completedDatabase);
  }, 60_000);

  it('replays the complete journal including the wallet lifecycle migration', async () => {
    const { client } = currentDatabase();
    const journal = await client.query<{ version: string }>(
      'select version from supabase_migrations.schema_migrations order by version limit 101',
    );
    expect(journal.rows.map(({ version }) => version)).toEqual(migrations.map(({ version }) => version));
    expect(migrations.map(({ version }) => version)).toContain(lifecycleVersion);
  });

  it('keeps the wallet command log behind row security with no raw client access', async () => {
    const { client } = currentDatabase();
    const table = await client.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where oid = 'public.wallet_command_requests'::regclass limit 2",
    );
    expect(table.rows).toEqual([{ relrowsecurity: true }]);
    const policies = await client.query(
      `select policyname from pg_policies
       where schemaname = 'public' and tablename = 'wallet_command_requests'
       limit 2`,
    );
    expect(policies.rows).toEqual([]);
    const grants = await client.query<Record<string, unknown>>(
      `select role_name,
         has_table_privilege(role_name, 'public.wallet_command_requests', 'select') as select,
         has_table_privilege(role_name, 'public.wallet_command_requests', 'insert') as insert,
         has_table_privilege(role_name, 'public.wallet_command_requests', 'update') as update,
         has_table_privilege(role_name, 'public.wallet_command_requests', 'delete') as delete,
         has_table_privilege(role_name, 'public.wallet_command_requests', 'truncate') as truncate
       from unnest(array['public', 'anon', 'authenticated', 'service_role']) as role_name
       order by role_name collate "C"
       limit 5`,
    );
    expect(grants.rows).toEqual(['anon', 'authenticated', 'public', 'service_role'].map((role_name) => ({
      role_name, select: false, insert: false, update: false, delete: false, truncate: false,
    })));
    const constraints = await client.query<{ conname: string; contype: string }>(
      `select conname, contype from pg_constraint
       where conrelid = 'public.wallet_command_requests'::regclass
         and contype in ('c', 'f', 'p', 'u')
       order by conname
       limit 10`,
    );
    expect(constraints.rows).toEqual([
      { conname: 'wallet_command_requests_actor_id_fkey', contype: 'f' },
      { conname: 'wallet_command_requests_kind_check', contype: 'c' },
      { conname: 'wallet_command_requests_names_check', contype: 'c' },
      { conname: 'wallet_command_requests_pkey', contype: 'p' },
      { conname: 'wallet_command_requests_space_id_fkey', contype: 'f' },
      { conname: 'wallet_command_requests_wallet_fkey', contype: 'f' },
    ]);
    const indexes = await client.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'wallet_command_requests'
       order by indexname collate "C"
       limit 5`,
    );
    expect(indexes.rows).toEqual([
      {
        indexname: 'wallet_command_requests_pkey',
        indexdef: 'CREATE UNIQUE INDEX wallet_command_requests_pkey ON public.wallet_command_requests USING btree (space_id, request_id)',
      },
      {
        indexname: 'wallet_command_requests_wallet_idx',
        indexdef: 'CREATE INDEX wallet_command_requests_wallet_idx ON public.wallet_command_requests USING btree (space_id, wallet_id)',
      },
    ]);
  });

  it('enforces command kinds, rename names, and same-space wallets in the command log', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, `Log ${randomUUID()}`);
    const householdWalletId = await createWallet(client, ownerId, householdId, `Log ${randomUUID()}`);
    const insert = (kind: string, targetWalletId: string, previousName: string | null, name: string | null) =>
      client.query(
        `insert into public.wallet_command_requests (
           space_id, request_id, command_kind, request_fingerprint, wallet_id, actor_id, previous_name, name
         ) values ($1, $2, $3, pg_catalog.decode('00', 'hex'), $4, $5, $6, $7)`,
        [personalId, randomUUID(), kind, targetWalletId, ownerId, previousName, name],
      );
    const kindError = { code: '23514', constraint: 'wallet_command_requests_kind_check' };
    const namesError = { code: '23514', constraint: 'wallet_command_requests_names_check' };
    await withRollback(client, async () => {
      await expectSavepointRejection(client, () => insert('delete_wallet', walletId, null, null), kindError);
      await expectSavepointRejection(client, () => insert('rename_wallet', walletId, null, null), namesError);
      await expectSavepointRejection(client, () => insert('rename_wallet', walletId, 'Old', '   '), namesError);
      await expectSavepointRejection(client, () => insert('rename_wallet', walletId, 'Old', ' Cash '), namesError);
      await expectSavepointRejection(
        client, () => insert('rename_wallet', walletId, 'Old', 'x'.repeat(121)), namesError,
      );
      await expectSavepointRejection(client, () => insert('archive_wallet', walletId, 'Old', 'New'), namesError);
      await expectSavepointRejection(client, () => insert('archive_wallet', householdWalletId, null, null), {
        code: '23503', constraint: 'wallet_command_requests_wallet_fkey',
      });
      await insert('rename_wallet', walletId, 'Old', 'x'.repeat(120));
      await insert('restore_wallet', walletId, null, null);
    });
    expect(await logRows(client, walletId)).toEqual([]);
  });

  it('rejects command log updates, deletes including zero-row deletes, and truncation', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, `Immutable ${randomUUID()}`);
    await withRollback(client, async () => {
      const requestId = randomUUID();
      await client.query(
        `insert into public.wallet_command_requests (
           space_id, request_id, command_kind, request_fingerprint, wallet_id, actor_id
         ) values ($1, $2, 'archive_wallet', pg_catalog.decode('00', 'hex'), $3, $4)`,
        [personalId, requestId, walletId, ownerId],
      );
      await expectSavepointRejection(client, () => client.query(
        "update public.wallet_command_requests set command_kind = 'restore_wallet' where request_id = $1",
        [requestId],
      ), logImmutableError);
      await expectSavepointRejection(client, () => client.query(
        'delete from public.wallet_command_requests where request_id = $1', [requestId],
      ), logImmutableError);
      await expectSavepointRejection(client, () => client.query(
        'delete from public.wallet_command_requests where false',
      ), logImmutableError);
      await expectSavepointRejection(client, () => client.query(
        'truncate public.wallet_command_requests',
      ), logImmutableError);
    });
  });

  it('keeps log and wallet guards effective after raw grants and matching policies', async () => {
    const { client } = currentDatabase();
    const name = `Granted ${randomUUID()}`;
    const walletId = await createWallet(client, ownerId, personalId, name);
    await withRollback(client, async () => {
      const existingRequestId = randomUUID();
      await client.query(
        `insert into public.wallet_command_requests (
           space_id, request_id, command_kind, request_fingerprint, wallet_id, actor_id
         ) values ($1, $2, 'archive_wallet', pg_catalog.decode('00', 'hex'), $3, $4)`,
        [personalId, existingRequestId, walletId, ownerId],
      );
      await client.query('grant select, insert, update, delete, truncate on public.wallet_command_requests to authenticated');
      await client.query(`create policy wallet_command_requests_test_all on public.wallet_command_requests
        for all to authenticated using (true) with check (true)`);
      await client.query('grant update on public.wallets to authenticated');
      await client.query(`create policy wallets_test_update on public.wallets
        for update to authenticated using (true) with check (true)`);
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [ownerId]);
      await client.query('set local role authenticated');
      await expectSavepointRejection(client, () => client.query(
        `insert into public.wallet_command_requests (
           space_id, request_id, command_kind, request_fingerprint, wallet_id, actor_id
         ) values ($1, $2, 'archive_wallet', pg_catalog.decode('00', 'hex'), $3, $4)`,
        [personalId, randomUUID(), walletId, ownerId],
      ), ownerWriteError);
      await expectSavepointRejection(client, () => client.query(
        "update public.wallet_command_requests set command_kind = 'restore_wallet' where request_id = $1",
        [existingRequestId],
      ), logImmutableError);
      await expectSavepointRejection(client, () => client.query(
        'delete from public.wallet_command_requests where request_id = $1', [existingRequestId],
      ), logImmutableError);
      await expectSavepointRejection(client, () => client.query(
        'delete from public.wallet_command_requests where false',
      ), logImmutableError);
      await expectSavepointRejection(client, () => client.query(
        'truncate public.wallet_command_requests',
      ), logImmutableError);
      await expectSavepointRejection(client, () => client.query(
        "update public.wallets set name = 'Raw rename' where id = $1", [walletId],
      ), ownerWriteError);
      await expectSavepointRejection(client, () => client.query(
        'update public.wallets set archived_at = now() where id = $1', [walletId],
      ), ownerWriteError);
    });
    expect(await walletRow(client, walletId)).toMatchObject({ name, archived_at: null });
  });

  it('lets the owning role change only a wallet name and its archive state', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, `Shape ${randomUUID()}`);
    const before = await walletRow(client, walletId);
    await withRollback(client, async () => {
      await expectSavepointRejection(client, () => client.query(
        "update public.wallets set currency = 'LBP' where id = $1", [walletId],
      ), walletShapeError);
      await expectSavepointRejection(client, () => client.query(
        'update public.wallets set space_id = $1 where id = $2', [householdId, walletId],
      ), walletShapeError);
      await expectSavepointRejection(client, () => client.query(
        "update public.wallets set created_at = created_at - interval '1 day' where id = $1", [walletId],
      ), walletShapeError);
      await expectSavepointRejection(client, () => client.query(
        'update public.wallets set id = $1 where id = $2', [randomUUID(), walletId],
      ), walletShapeError);
      await client.query("update public.wallets set name = 'Renamed by owner' where id = $1", [walletId]);
      await client.query('update public.wallets set archived_at = now() where id = $1', [walletId]);
      await expectSavepointRejection(client, () => client.query(
        "update public.wallets set archived_at = archived_at + interval '1 second' where id = $1", [walletId],
      ), walletShapeError);
      await client.query('update public.wallets set archived_at = null where id = $1', [walletId]);
    });
    expect(await walletRow(client, walletId)).toEqual(before);
  });

  it('refuses wallet deletion by row and by zero-row statement', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, `Delete ${randomUUID()}`);
    await withRollback(client, async () => {
      await expectSavepointRejection(client, () => client.query(
        'delete from public.wallets where id = $1', [walletId],
      ), walletDeleteError);
      await expectSavepointRejection(client, () => client.query(
        'delete from public.wallets where false',
      ), walletDeleteError);
    });
    expect((await walletRow(client, walletId)).id).toBe(walletId);
  });

  it('pins the wallet and command log guard triggers and their private functions', async () => {
    const { client } = currentDatabase();
    const triggers = await client.query<{ tgname: string; tgenabled: string; definition: string }>(
      `select tgname, tgenabled, pg_get_triggerdef(oid) as definition
       from pg_trigger
       where tgrelid = any(array['public.wallets'::regclass, 'public.wallet_command_requests'::regclass])
         and not tgisinternal
       order by tgname collate "C"
       limit 10`,
    );
    expect(triggers.rows).toEqual([
      {
        tgname: 'wallet_command_requests_reject_row_mutation', tgenabled: 'O',
        definition: 'CREATE TRIGGER wallet_command_requests_reject_row_mutation BEFORE DELETE OR UPDATE ON public.wallet_command_requests FOR EACH ROW EXECUTE FUNCTION private.reject_wallet_command_history_mutation()',
      },
      {
        tgname: 'wallet_command_requests_reject_statement_mutation', tgenabled: 'O',
        definition: 'CREATE TRIGGER wallet_command_requests_reject_statement_mutation BEFORE DELETE OR TRUNCATE ON public.wallet_command_requests FOR EACH STATEMENT EXECUTE FUNCTION private.reject_wallet_command_history_mutation()',
      },
      {
        tgname: 'wallet_command_requests_require_owner_insert', tgenabled: 'O',
        definition: 'CREATE TRIGGER wallet_command_requests_require_owner_insert BEFORE INSERT ON public.wallet_command_requests FOR EACH ROW EXECUTE FUNCTION private.require_table_owner_write()',
      },
      {
        tgname: 'wallets_guard_update', tgenabled: 'O',
        definition: 'CREATE TRIGGER wallets_guard_update BEFORE UPDATE ON public.wallets FOR EACH ROW EXECUTE FUNCTION private.guard_wallet_update()',
      },
      {
        tgname: 'wallets_reject_delete', tgenabled: 'O',
        definition: 'CREATE TRIGGER wallets_reject_delete BEFORE DELETE ON public.wallets FOR EACH ROW EXECUTE FUNCTION private.reject_wallet_deletion()',
      },
      {
        tgname: 'wallets_reject_delete_statement', tgenabled: 'O',
        definition: 'CREATE TRIGGER wallets_reject_delete_statement BEFORE DELETE OR TRUNCATE ON public.wallets FOR EACH STATEMENT EXECUTE FUNCTION private.reject_wallet_deletion()',
      },
    ]);
    const privateGuard = {
      result: 'trigger', prosecdef: false, provolatile: 'v', proconfig: ['search_path=pg_catalog'],
      public_exec: false, anon_exec: false, authenticated_exec: false, service_exec: false,
    };
    expect(await functionCatalog(client, [
      'private.guard_wallet_update()',
      'private.reject_wallet_command_history_mutation()',
      'private.reject_wallet_deletion()',
    ])).toEqual([
      { signature: 'private.guard_wallet_update()', ...privateGuard },
      { signature: 'private.reject_wallet_command_history_mutation()', ...privateGuard },
      { signature: 'private.reject_wallet_deletion()', ...privateGuard },
    ]);
  });
});
```

- [ ] **Step 4: Run the suite and verify it fails for the missing contract**

Run: `set -a && source ./.env.test && set +a && pnpm exec vitest run tests/db/wallet-lifecycle.integration.test.ts --pool=forks --no-file-parallelism`

Expected: FAIL. The journal test fails on `expected [...] to include '20260911100000'`; the log tests fail with `relation "public.wallet_command_requests" does not exist`; the wallet update/delete tests fail because the updates and deletes succeed (`promise resolved instead of rejecting`); the trigger pin returns `[]`.

- [ ] **Step 5: Create the migration with the log and wallet guards**

Create `supabase/migrations/20260911100000_wallet_lifecycle_commands.sql`:

```sql
-- Wallet lifecycle: protected rename, archive, and restore commands.
-- Spec: docs/superpowers/specs/2026-09-11-wallet-rename-archive-design.md

-- 1. Append-only wallet command log and wallet row guards.

create table public.wallet_command_requests (
  space_id uuid not null references public.spaces(id) on delete restrict,
  request_id uuid not null,
  command_kind text not null,
  request_fingerprint bytea not null,
  wallet_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  previous_name text,
  name text,
  created_at timestamptz not null default now(),
  primary key (space_id, request_id),
  constraint wallet_command_requests_kind_check
    check (command_kind in ('rename_wallet', 'archive_wallet', 'restore_wallet')),
  constraint wallet_command_requests_names_check check (
    case
      when command_kind = 'rename_wallet' then
        previous_name is not null
        and name is not null
        and name = btrim(name)
        and char_length(name) between 1 and 120
      else previous_name is null and name is null
    end
  ),
  constraint wallet_command_requests_wallet_fkey foreign key (wallet_id, space_id)
    references public.wallets (id, space_id) on delete restrict
);

create index wallet_command_requests_wallet_idx
  on public.wallet_command_requests (space_id, wallet_id);

alter table public.wallet_command_requests enable row level security;

create function private.reject_wallet_command_history_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'wallet command history is immutable';
end;
$$;

create function private.guard_wallet_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_owner_name name;
begin
  select pg_catalog.pg_get_userbyid(relation.relowner)
  into v_owner_name
  from pg_catalog.pg_class as relation
  where relation.oid = tg_relid;

  if current_user <> v_owner_name then
    raise exception using
      errcode = '42501',
      message = 'protected rows may be written only by their owning command';
  end if;

  if new.id is distinct from old.id
    or new.space_id is distinct from old.space_id
    or new.currency is distinct from old.currency
    or new.created_at is distinct from old.created_at
    or (old.archived_at is not null
      and new.archived_at is not null
      and new.archived_at is distinct from old.archived_at) then
    raise exception using
      errcode = '42501',
      message = 'wallets may change only their name and archive state';
  end if;

  return new;
end;
$$;

create function private.reject_wallet_deletion()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'wallets are archived, never deleted';
end;
$$;

create trigger wallet_command_requests_require_owner_insert
before insert on public.wallet_command_requests
for each row execute function private.require_table_owner_write();

create trigger wallet_command_requests_reject_row_mutation
before update or delete on public.wallet_command_requests
for each row execute function private.reject_wallet_command_history_mutation();

create trigger wallet_command_requests_reject_statement_mutation
before delete or truncate on public.wallet_command_requests
for each statement execute function private.reject_wallet_command_history_mutation();

create trigger wallets_guard_update
before update on public.wallets
for each row execute function private.guard_wallet_update();

create trigger wallets_reject_delete
before delete on public.wallets
for each row execute function private.reject_wallet_deletion();

create trigger wallets_reject_delete_statement
before delete or truncate on public.wallets
for each statement execute function private.reject_wallet_deletion();

revoke all on table public.wallet_command_requests from public, anon, authenticated, service_role;
revoke all on function private.reject_wallet_command_history_mutation() from public, anon, authenticated, service_role;
revoke all on function private.guard_wallet_update() from public, anon, authenticated, service_role;
revoke all on function private.reject_wallet_deletion() from public, anon, authenticated, service_role;
```

- [ ] **Step 6: Run the suite and verify it passes**

Run: `set -a && source ./.env.test && set +a && pnpm exec vitest run tests/db/wallet-lifecycle.integration.test.ts --pool=forks --no-file-parallelism`

Expected: PASS, 8 tests.

- [ ] **Step 7: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 8: Record the decision**

Append to `docs/decisions.md`:

```markdown

## 2026-09-11 — Wallets change in place behind an append-only command log and are never deleted

**Decision:** A wallet's name and archive state change only through protected
commands that update `public.wallets` in place and append one row per request to
`public.wallet_command_requests` (who, what, when, and a rename's previous and new
name). Triggers let only the owning role update a wallet, allow only `name` and
`archived_at` (between null and a timestamp) to change, and refuse deleting or
truncating wallets. The log is owner-insert-only and rejects update, delete
(including zero-row statements), and truncate.

**Why:** This mirrors Categories' in-place state plus request ledger, so every
existing wallet read, balance view, and posting check keeps working while the log
answers "who renamed or archived this wallet, and when". Append-only revision
tables were rejected: the same audit value for a much larger read-path change.
Deleting a wallet would orphan journal history; archive is the removal path.

**If changed:** Revision tables would require every wallet reader and
`wallet_balances` to resolve the latest revision. Allowing deletion needs proof
that no movement, loan posting, or log row references the wallet, and its own
rejection tests.
```

- [ ] **Step 9: Commit**

```bash
git add tests/db/disposable-database.ts tests/db/wallet-lifecycle.integration.test.ts \
  supabase/migrations/20260911100000_wallet_lifecycle_commands.sql docs/decisions.md
git commit -m "feat(db): add append-only wallet command log and wallet row guards" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Archived wallets accept no money movement

**Files:**
- Modify: `supabase/migrations/20260911100000_wallet_lifecycle_commands.sql` (append section 2)
- Modify: `tests/db/wallet-lifecycle.integration.test.ts`
- Modify: `docs/decisions.md` (append)

**Interfaces:**
- Consumes: Task 1 helpers `createWallet`, `postEvent`, `archiveWalletDirectly`, `walletBalance`, `functionCatalog`; existing `public.reverse_financial_event(uuid, uuid, uuid, date)`, `public.create_category(uuid, uuid, category_kind, text, text)`, `public.record_categorized_financial_event(uuid, uuid, financial_event_kind, date, jsonb, uuid)`, `public.record_cash_loan(uuid, uuid, loan_direction, text, currency_code, uuid, text, date, date, text)`, `public.record_loan_repayment(uuid, uuid, uuid, uuid, text, date)`.
- Produces (SQL): `private.require_active_movement_wallet()` and trigger `wallet_movements_require_active_wallet`.
- Produces (test helpers used later): `reverseEvent(client, actorId, spaceId, eventId): Promise<string>`, `createExpenseCategory(client, actorId, spaceId): Promise<string>`, `postCategorizedExpense(client, actorId, spaceId, walletId, categoryId, amountMinor): Promise<string>`, `recordCashLoan(client, actorId, spaceId, walletId, amountMinor): Promise<string>` (returns loan ID), `repayLoan(client, actorId, spaceId, loanId, walletId, amountMinor): Promise<string>`, constants `genericPostingError`, `loanWalletError`, `inactiveMovementError`.

- [ ] **Step 1: Add the movement helpers**

In `tests/db/wallet-lifecycle.integration.test.ts`, add directly below `const logImmutableError = …`:

```ts
const genericPostingError = {
  code: 'P0001',
  message: 'every movement must contain a unique active wallet and a bounded nonzero minor-unit amount',
};
const loanWalletError = {
  code: 'P0001',
  message: 'the wallet must be active, in the requested space, and in the loan currency',
};
const inactiveMovementError = { code: 'P0001', message: 'every wallet movement must use an active wallet' };
```

Add after the `functionCatalog` function (above `describe(`):

```ts
async function reverseEvent(client: Client, actorId: string, spaceId: string, eventId: string): Promise<string> {
  return withAuthenticatedTransaction(client, actorId, async () => {
    const result = await client.query<{ id: string }>(
      "select * from public.reverse_financial_event($1, $2, $3, '2026-09-11') limit 2",
      [spaceId, randomUUID(), eventId],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.id;
  });
}

async function createExpenseCategory(client: Client, actorId: string, spaceId: string): Promise<string> {
  return withAuthenticatedTransaction(client, actorId, async () => {
    const result = await client.query<{ id: string }>(
      "select * from public.create_category($1, $2, 'expense', $3, null) limit 2",
      [spaceId, randomUUID(), `Groceries ${randomUUID()}`],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.id;
  });
}

async function postCategorizedExpense(
  client: Client,
  actorId: string,
  spaceId: string,
  walletId: string,
  categoryId: string,
  amountMinor: string,
): Promise<string> {
  return withAuthenticatedTransaction(client, actorId, async () => {
    const result = await client.query<{ id: string }>(
      `select * from public.record_categorized_financial_event(
         $1, $2, 'expense', '2026-09-11', $3::jsonb, $4
       ) limit 2`,
      [spaceId, randomUUID(), JSON.stringify([{ walletId, amountMinor }]), categoryId],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.id;
  });
}

async function recordCashLoan(
  client: Client,
  actorId: string,
  spaceId: string,
  walletId: string,
  amountMinor: string,
): Promise<string> {
  return withAuthenticatedTransaction(client, actorId, async () => {
    const result = await client.query<{ loan_id: string }>(
      `select loan_id from public.record_cash_loan(
         $1, $2, 'they_owe_me', 'Sami', 'USD', $3, $4, '2026-09-11', null, null
       ) limit 2`,
      [spaceId, randomUUID(), walletId, amountMinor],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.loan_id;
  });
}

async function repayLoan(
  client: Client,
  actorId: string,
  spaceId: string,
  loanId: string,
  walletId: string,
  amountMinor: string,
): Promise<string> {
  return withAuthenticatedTransaction(client, actorId, async () => {
    const result = await client.query<{ event_id: string }>(
      "select event_id from public.record_loan_repayment($1, $2, $3, $4, $5, '2026-09-11') limit 2",
      [spaceId, randomUUID(), loanId, walletId, amountMinor],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.event_id;
  });
}
```

- [ ] **Step 2: Write the movement guard tests**

Add at the end of the `describe` block (before its closing `});`):

```ts
  it('refuses a reversal that would move money through an archived wallet', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Reversal USD');
    const incomeId = await postEvent(client, ownerId, personalId, 'income', [{ walletId, amountMinor: '500' }]);
    await postEvent(client, ownerId, personalId, 'expense', [{ walletId, amountMinor: '-500' }]);
    await archiveWalletDirectly(client, walletId);

    await expect(reverseEvent(client, ownerId, personalId, incomeId)).rejects.toMatchObject(inactiveMovementError);
    expect(await walletBalance(client, walletId)).toBe('0');
    const reversals = await client.query(
      'select id from public.financial_events where reversal_of = $1 limit 2', [incomeId],
    );
    expect(reversals.rows).toEqual([]);
  });

  it('refuses a raw owner movement into an archived wallet when command checks are bypassed', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Raw movement USD');
    await archiveWalletDirectly(client, walletId);
    await withRollback(client, async () => {
      const event = await client.query<{ id: string }>(
        `insert into public.financial_events (
           space_id, request_id, request_fingerprint, kind, effective_date, actor_id
         ) values ($1, $2, pg_catalog.decode('00', 'hex'), 'income', '2026-09-11', $3)
         returning id`,
        [personalId, randomUUID(), ownerId],
      );
      expect(event.rows).toHaveLength(1);
      await expectSavepointRejection(client, () => client.query(
        `insert into public.wallet_movements (event_id, space_id, wallet_id, amount_minor)
         values ($1, $2, $3, 500)`,
        [event.rows[0]!.id, personalId, walletId],
      ), inactiveMovementError);
    });
    expect(await walletBalance(client, walletId)).toBe('0');
  });

  // Characterization: these command-level refusals already existed. They stay
  // pinned so the trigger is proven to back up, not replace, the command checks.
  it('refuses every posting command into an archived wallet', async () => {
    const { client } = currentDatabase();
    const activeId = await createWallet(client, ownerId, personalId, 'Active lender USD');
    const archivedId = await createWallet(client, ownerId, personalId, 'Archived USD');
    await postEvent(client, ownerId, personalId, 'opening_balance', [{ walletId: activeId, amountMinor: '10000' }]);
    const loanId = await recordCashLoan(client, ownerId, personalId, activeId, '3000');
    const categoryId = await createExpenseCategory(client, ownerId, personalId);
    await archiveWalletDirectly(client, archivedId);

    await expect(postEvent(client, ownerId, personalId, 'income', [{ walletId: archivedId, amountMinor: '100' }]))
      .rejects.toMatchObject(genericPostingError);
    await expect(postEvent(client, ownerId, personalId, 'transfer', [
      { walletId: activeId, amountMinor: '-100' },
      { walletId: archivedId, amountMinor: '100' },
    ])).rejects.toMatchObject(genericPostingError);
    await expect(postCategorizedExpense(client, ownerId, personalId, archivedId, categoryId, '-100'))
      .rejects.toMatchObject(genericPostingError);
    await expect(recordCashLoan(client, ownerId, personalId, archivedId, '100'))
      .rejects.toMatchObject(loanWalletError);
    await expect(repayLoan(client, ownerId, personalId, loanId, archivedId, '100'))
      .rejects.toMatchObject(loanWalletError);
    expect(await walletBalance(client, archivedId)).toBe('0');
    expect(await walletBalance(client, activeId)).toBe('7000');
  });

  it('accepts movements again once an archived wallet is active', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Returning USD');
    await archiveWalletDirectly(client, walletId);
    await client.query('update public.wallets set archived_at = null where id = $1', [walletId]);
    await postEvent(client, ownerId, personalId, 'income', [{ walletId, amountMinor: '250' }]);
    expect(await walletBalance(client, walletId)).toBe('250');
  });

  it('pins the active-wallet movement trigger and its definer function', async () => {
    const { client } = currentDatabase();
    const trigger = await client.query<Record<string, unknown>>(
      `select tgname, tgenabled, pg_get_triggerdef(oid) as definition
       from pg_trigger
       where tgrelid = 'public.wallet_movements'::regclass
         and tgname = 'wallet_movements_require_active_wallet'
       limit 2`,
    );
    expect(trigger.rows).toEqual([{
      tgname: 'wallet_movements_require_active_wallet', tgenabled: 'O',
      definition: 'CREATE TRIGGER wallet_movements_require_active_wallet BEFORE INSERT ON public.wallet_movements FOR EACH ROW EXECUTE FUNCTION private.require_active_movement_wallet()',
    }]);
    expect(await functionCatalog(client, ['private.require_active_movement_wallet()'])).toEqual([{
      signature: 'private.require_active_movement_wallet()', result: 'trigger', prosecdef: true, provolatile: 'v',
      proconfig: ['search_path=pg_catalog'],
      public_exec: false, anon_exec: false, authenticated_exec: false, service_exec: false,
    }]);
  });
```

- [ ] **Step 3: Run the suite and verify the new guard tests fail**

Run: `set -a && source ./.env.test && set +a && pnpm exec vitest run tests/db/wallet-lifecycle.integration.test.ts --pool=forks --no-file-parallelism`

Expected: FAIL in exactly three tests — the reversal test (`promise resolved instead of rejecting`), the raw owner movement test (`promise resolved instead of rejecting`), and the trigger pin (`[]`). The characterization and reactivation tests PASS already.

- [ ] **Step 4: Append the movement guard to the migration**

Append to `supabase/migrations/20260911100000_wallet_lifecycle_commands.sql`:

```sql

-- 2. Archived wallets accept no money movement from any writer.

create function private.require_active_movement_wallet()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_wallet_id uuid;
begin
  -- FOR SHARE conflicts with archive_wallet's FOR UPDATE, so a movement and an
  -- archive of the same wallet serialize instead of both committing.
  select wallet.id
  into v_wallet_id
  from public.wallets as wallet
  where wallet.id = new.wallet_id
    and wallet.space_id = new.space_id
    and wallet.archived_at is null
  for share;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'every wallet movement must use an active wallet';
  end if;

  return new;
end;
$$;

create trigger wallet_movements_require_active_wallet
before insert on public.wallet_movements
for each row execute function private.require_active_movement_wallet();

revoke all on function private.require_active_movement_wallet() from public, anon, authenticated, service_role;
```

- [ ] **Step 5: Run the suite and verify it passes**

Run: `set -a && source ./.env.test && set +a && pnpm exec vitest run tests/db/wallet-lifecycle.integration.test.ts --pool=forks --no-file-parallelism`

Expected: PASS, 13 tests.

- [ ] **Step 6: Record the decision**

Append to `docs/decisions.md`:

```markdown

## 2026-09-11 — Archived wallets accept no money movement

**Decision:** A `BEFORE INSERT` trigger on `public.wallet_movements` locks the
target wallet `FOR SHARE` and refuses any movement into an archived wallet with
`every wallet movement must use an active wallet`. It covers every writer,
including `reverse_financial_event` and the loan commands.

**Why:** Posting commands already skipped archived wallets, but reversals did not
check at all, and no command locked the wallet, so a posting validated just
before an archive committed could still land in the archived wallet. The share
lock conflicts with the archive command's row lock, so exactly one of the two
wins and an archived wallet always has a zero balance.

**If changed:** Allowing corrections into archived wallets needs its own reviewed
rule for keeping their balance at zero. Removing the lock reopens the race that
`tests/db/wallet-lifecycle.integration.test.ts` proves closed.
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260911100000_wallet_lifecycle_commands.sql \
  tests/db/wallet-lifecycle.integration.test.ts docs/decisions.md
git commit -m "feat(db): refuse money movements into archived wallets" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Protected rename command and result lookup

**Files:**
- Modify: `supabase/migrations/20260911100000_wallet_lifecycle_commands.sql` (append section 3)
- Modify: `tests/db/wallet-lifecycle.integration.test.ts`
- Modify: `docs/decisions.md` (append)

**Interfaces:**
- Consumes: Task 1 helpers; `private.is_active_member(uuid)`; `extensions.digest(text, text)`.
- Produces (SQL): `private.require_wallet_command_actor(uuid, uuid, uuid) returns uuid`, `private.replay_wallet_command(uuid, uuid, text, bytea, uuid) returns boolean`, `private.lock_space_wallet(uuid, uuid) returns public.wallets`, `public.rename_wallet(p_space_id uuid, p_request_id uuid, p_wallet_id uuid, p_name text) returns table (id uuid)`, `public.get_wallet_command_result(p_space_id uuid, p_request_id uuid) returns table (command_kind text, wallet_id uuid, created_at timestamptz)`.
- Produces (test helpers used later): `interface WalletCommand { spaceId: string | null; requestId: string | null; walletId: string | null }`, `interface RenameCommand extends WalletCommand { name: string | null }`, `renameWallet(client, actorId, command: RenameCommand): Promise<string>`, `commandResult(client, actorId, spaceId, requestId): Promise<Array<{ command_kind: string; wallet_id: string }>>`, constants `membershipError`, `replayError`, `missingIdsError`, `foreignWalletError`, `archivedWalletError`, `nameLengthError`, `sameNameError`.

- [ ] **Step 1: Add the command helpers**

Add below the `inactiveMovementError` constant:

```ts
const membershipError = { code: '42501', message: 'an active space membership is required' };
const replayError = { code: 'P0001', message: 'request ID was already used with different data' };
const missingIdsError = { code: 'P0001', message: 'request ID and wallet ID are required' };
const foreignWalletError = { code: 'P0001', message: 'the wallet does not belong to the requested space' };
const archivedWalletError = { code: 'P0001', message: 'the wallet is archived' };
const nameLengthError = { code: 'P0001', message: 'the wallet name must be 1 to 120 characters' };
const sameNameError = { code: 'P0001', message: 'the wallet already has this name' };

interface WalletCommand {
  spaceId: string | null;
  requestId: string | null;
  walletId: string | null;
}

interface RenameCommand extends WalletCommand {
  name: string | null;
}
```

Add below the `repayLoan` function:

```ts
async function renameWallet(client: Client, actorId: string, command: RenameCommand): Promise<string> {
  return withAuthenticatedTransaction(client, actorId, async () => {
    const result = await client.query<{ id: string }>(
      'select * from public.rename_wallet($1, $2, $3, $4) limit 2',
      [command.spaceId, command.requestId, command.walletId, command.name],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.id;
  });
}

async function commandResult(
  client: Client,
  actorId: string,
  spaceId: string,
  requestId: string,
): Promise<Array<{ command_kind: string; wallet_id: string }>> {
  return withAuthenticatedTransaction(client, actorId, async () => {
    const result = await client.query<{ command_kind: string; wallet_id: string }>(
      'select command_kind, wallet_id from public.get_wallet_command_result($1, $2) limit 2',
      [spaceId, requestId],
    );
    return result.rows;
  });
}
```

- [ ] **Step 2: Write the rename tests**

Add at the end of the `describe` block:

```ts
  it('renames an active wallet, trims the name, and records the previous name', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Daily USD');
    const requestId = randomUUID();
    expect(await renameWallet(client, ownerId, {
      spaceId: personalId, requestId, walletId, name: '  Travel cash  ',
    })).toBe(walletId);
    expect(await walletRow(client, walletId)).toMatchObject({ name: 'Travel cash', currency: 'USD', archived_at: null });
    expect(await logRows(client, walletId)).toEqual([{
      request_id: requestId, command_kind: 'rename_wallet', wallet_id: walletId, actor_id: ownerId,
      previous_name: 'Daily USD', name: 'Travel cash',
    }]);
    expect(await commandResult(client, ownerId, personalId, requestId)).toEqual([
      { command_kind: 'rename_wallet', wallet_id: walletId },
    ]);
  });

  it('accepts a 120-character wallet name', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Short USD');
    await renameWallet(client, ownerId, {
      spaceId: personalId, requestId: randomUUID(), walletId, name: 'x'.repeat(120),
    });
    expect((await walletRow(client, walletId)).name).toHaveLength(120);
  });

  it('lets an active non-owner household member rename a household wallet', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, householdId, 'Shared cash');
    await renameWallet(client, memberId, {
      spaceId: householdId, requestId: randomUUID(), walletId, name: 'Family cash',
    });
    expect(await walletRow(client, walletId)).toMatchObject({ name: 'Family cash' });
    expect((await logRows(client, walletId)).map(({ actor_id }) => actor_id)).toEqual([memberId]);
  });

  it('replays an exact rename once and rejects changed data under the same request', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Replay USD');
    const otherWalletId = await createWallet(client, ownerId, personalId, 'Other USD');
    const command: RenameCommand = { spaceId: personalId, requestId: randomUUID(), walletId, name: 'Replayed USD' };
    await renameWallet(client, ownerId, command);

    expect(await renameWallet(client, ownerId, command)).toBe(walletId);
    expect(await renameWallet(client, ownerId, { ...command, name: '  Replayed USD ' })).toBe(walletId);
    await expect(renameWallet(client, ownerId, { ...command, name: 'Changed USD' }))
      .rejects.toMatchObject(replayError);
    await expect(renameWallet(client, ownerId, { ...command, walletId: otherWalletId }))
      .rejects.toMatchObject(replayError);
    expect(await walletRow(client, walletId)).toMatchObject({ name: 'Replayed USD' });
    expect(await walletRow(client, otherWalletId)).toMatchObject({ name: 'Other USD' });
    expect(await logRows(client, walletId)).toHaveLength(1);
  });

  it.each([
    'outsider', 'null space', 'null request', 'null wallet', 'foreign wallet', 'archived wallet',
    'blank name', 'null name', 'long name', 'unchanged name',
  ] as const)('rejects a rename with %s without partial state', async (scenario) => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Stable USD');
    const householdWalletId = await createWallet(client, ownerId, householdId, 'Household USD');
    if (scenario === 'archived wallet') {
      await archiveWalletDirectly(client, walletId);
    }
    const before = await walletRow(client, walletId);
    const command: RenameCommand = { spaceId: personalId, requestId: randomUUID(), walletId, name: 'Renamed USD' };
    let actorId = ownerId;
    let expected: { code: string; message: string } = nameLengthError;
    switch (scenario) {
      case 'outsider':
        actorId = outsiderId;
        expected = membershipError;
        break;
      case 'null space':
        command.spaceId = null;
        expected = membershipError;
        break;
      case 'null request':
        command.requestId = null;
        expected = missingIdsError;
        break;
      case 'null wallet':
        command.walletId = null;
        expected = missingIdsError;
        break;
      case 'foreign wallet':
        command.walletId = householdWalletId;
        expected = foreignWalletError;
        break;
      case 'archived wallet':
        expected = archivedWalletError;
        break;
      case 'blank name':
        command.name = '   ';
        break;
      case 'null name':
        command.name = null;
        break;
      case 'long name':
        command.name = 'x'.repeat(121);
        break;
      case 'unchanged name':
        command.name = ' Stable USD ';
        expected = sameNameError;
        break;
    }

    await expect(renameWallet(client, actorId, command)).rejects.toMatchObject(expected);
    expect(await walletRow(client, walletId)).toEqual(before);
    expect(await logRows(client, walletId)).toEqual([]);
    expect(await walletRow(client, householdWalletId)).toMatchObject({ name: 'Household USD' });
    expect(await logRows(client, householdWalletId)).toEqual([]);
  });

  it.each(['anon', 'service_role'] as const)('denies the %s role rename and result lookup', async (role) => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Role USD');
    await withRollback(client, async () => {
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [ownerId]);
      await client.query(`set local role ${role}`);
      await expectSavepointRejection(client, () => client.query(
        "select * from public.rename_wallet($1, $2, $3, 'Blocked USD')", [personalId, randomUUID(), walletId],
      ), { code: '42501' });
      await expectSavepointRejection(client, () => client.query(
        'select * from public.get_wallet_command_result($1, $2)', [personalId, randomUUID()],
      ), { code: '42501' });
    });
    expect(await walletRow(client, walletId)).toMatchObject({ name: 'Role USD' });
  });

  it('returns a wallet command result only to active members of its space', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, householdId, 'Lookup USD');
    const requestId = randomUUID();
    await renameWallet(client, ownerId, { spaceId: householdId, requestId, walletId, name: 'Looked up USD' });

    expect(await commandResult(client, memberId, householdId, requestId)).toEqual([
      { command_kind: 'rename_wallet', wallet_id: walletId },
    ]);
    expect(await commandResult(client, memberId, householdId, randomUUID())).toEqual([]);
    await expect(commandResult(client, outsiderId, householdId, requestId)).rejects.toMatchObject(membershipError);
  });

  it('pins rename, result, and helper signatures, search paths, and execute grants', async () => {
    const { client } = currentDatabase();
    const command = { public_exec: false, anon_exec: false, authenticated_exec: true, service_exec: false };
    const helper = { public_exec: false, anon_exec: false, authenticated_exec: false, service_exec: false };
    expect(await functionCatalog(client, [
      'public.get_wallet_command_result(uuid,uuid)',
      'private.lock_space_wallet(uuid,uuid)',
      'private.replay_wallet_command(uuid,uuid,text,bytea,uuid)',
      'private.require_wallet_command_actor(uuid,uuid,uuid)',
      'public.rename_wallet(uuid,uuid,uuid,text)',
    ])).toEqual([
      {
        signature: 'get_wallet_command_result(uuid,uuid)',
        result: 'TABLE(command_kind text, wallet_id uuid, created_at timestamp with time zone)',
        prosecdef: true, provolatile: 's', proconfig: ['search_path=pg_catalog'], ...command,
      },
      {
        signature: 'private.lock_space_wallet(uuid,uuid)', result: 'wallets',
        prosecdef: false, provolatile: 'v', proconfig: ['search_path=pg_catalog'], ...helper,
      },
      {
        signature: 'private.replay_wallet_command(uuid,uuid,text,bytea,uuid)', result: 'boolean',
        prosecdef: false, provolatile: 'v', proconfig: ['search_path=pg_catalog'], ...helper,
      },
      {
        signature: 'private.require_wallet_command_actor(uuid,uuid,uuid)', result: 'uuid',
        prosecdef: false, provolatile: 's', proconfig: ['search_path=pg_catalog'], ...helper,
      },
      {
        signature: 'rename_wallet(uuid,uuid,uuid,text)', result: 'TABLE(id uuid)',
        prosecdef: true, provolatile: 'v', proconfig: ['search_path=pg_catalog, extensions'], ...command,
      },
    ]);
  });
```

- [ ] **Step 3: Run the suite and verify the rename tests fail**

Run: `set -a && source ./.env.test && set +a && pnpm exec vitest run tests/db/wallet-lifecycle.integration.test.ts --pool=forks --no-file-parallelism`

Expected: FAIL in all 18 new tests because `public.rename_wallet` and `public.get_wallet_command_result` do not exist yet (PostgreSQL code `42883`, "function … does not exist"). Tasks 1–2 tests still PASS.

- [ ] **Step 4: Append the rename command section to the migration**

Append to `supabase/migrations/20260911100000_wallet_lifecycle_commands.sql`:

```sql

-- 3. Shared command preconditions, request replay, rename, and result lookup.

create function private.require_wallet_command_actor(
  p_space_id uuid,
  p_request_id uuid,
  p_wallet_id uuid
)
returns uuid
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  if p_request_id is null or p_wallet_id is null then
    raise exception using errcode = 'P0001', message = 'request ID and wallet ID are required';
  end if;

  return v_actor_id;
end;
$$;

create function private.replay_wallet_command(
  p_space_id uuid,
  p_request_id uuid,
  p_command_kind text,
  p_fingerprint bytea,
  p_wallet_id uuid
)
returns boolean
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_existing_kind text;
  v_existing_fingerprint bytea;
  v_existing_wallet_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('wallet:' || p_space_id::text || ':' || p_request_id::text, 0)
  );

  select request.command_kind, request.request_fingerprint, request.wallet_id
  into v_existing_kind, v_existing_fingerprint, v_existing_wallet_id
  from public.wallet_command_requests as request
  where request.space_id = p_space_id
    and request.request_id = p_request_id;

  if not found then
    return false;
  end if;

  if v_existing_kind <> p_command_kind
    or v_existing_fingerprint <> p_fingerprint
    or v_existing_wallet_id <> p_wallet_id then
    raise exception using errcode = 'P0001', message = 'request ID was already used with different data';
  end if;

  return true;
end;
$$;

create function private.lock_space_wallet(
  p_space_id uuid,
  p_wallet_id uuid
)
returns public.wallets
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_wallet public.wallets;
begin
  select wallet.*
  into v_wallet
  from public.wallets as wallet
  where wallet.id = p_wallet_id
    and wallet.space_id = p_space_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'the wallet does not belong to the requested space';
  end if;

  return v_wallet;
end;
$$;

create function public.rename_wallet(
  p_space_id uuid,
  p_request_id uuid,
  p_wallet_id uuid,
  p_name text
)
returns table (id uuid)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor_id uuid;
  v_name text := pg_catalog.btrim(p_name);
  v_fingerprint bytea;
  v_wallet public.wallets;
begin
  v_actor_id := private.require_wallet_command_actor(p_space_id, p_request_id, p_wallet_id);
  v_fingerprint := extensions.digest(
    pg_catalog.jsonb_build_object(
      'version', 1,
      'command', 'rename_wallet',
      'walletId', p_wallet_id,
      'name', v_name
    )::text,
    'sha256'
  );

  if private.replay_wallet_command(p_space_id, p_request_id, 'rename_wallet', v_fingerprint, p_wallet_id) then
    return query select p_wallet_id;
    return;
  end if;

  v_wallet := private.lock_space_wallet(p_space_id, p_wallet_id);

  if v_wallet.archived_at is not null then
    raise exception using errcode = 'P0001', message = 'the wallet is archived';
  end if;

  if v_name is null or pg_catalog.char_length(v_name) not between 1 and 120 then
    raise exception using errcode = 'P0001', message = 'the wallet name must be 1 to 120 characters';
  end if;

  if v_name = v_wallet.name then
    raise exception using errcode = 'P0001', message = 'the wallet already has this name';
  end if;

  update public.wallets as wallet
  set name = v_name
  where wallet.id = p_wallet_id;

  insert into public.wallet_command_requests (
    space_id, request_id, command_kind, request_fingerprint, wallet_id, actor_id, previous_name, name
  )
  values (
    p_space_id, p_request_id, 'rename_wallet', v_fingerprint, p_wallet_id, v_actor_id, v_wallet.name, v_name
  );

  return query select p_wallet_id;
end;
$$;

create function public.get_wallet_command_result(
  p_space_id uuid,
  p_request_id uuid
)
returns table (
  command_kind text,
  wallet_id uuid,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if auth.uid() is null or not private.is_active_member(p_space_id) then
    raise exception using errcode = '42501', message = 'an active space membership is required';
  end if;

  return query
  select request.command_kind, request.wallet_id, request.created_at
  from public.wallet_command_requests as request
  where request.space_id = p_space_id
    and request.request_id = p_request_id
  limit 1;
end;
$$;

revoke all on function private.require_wallet_command_actor(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.replay_wallet_command(uuid, uuid, text, bytea, uuid) from public, anon, authenticated, service_role;
revoke all on function private.lock_space_wallet(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.rename_wallet(uuid, uuid, uuid, text) from public, anon, service_role;
revoke all on function public.get_wallet_command_result(uuid, uuid) from public, anon, service_role;

grant execute on function public.rename_wallet(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.get_wallet_command_result(uuid, uuid) to authenticated;
```

- [ ] **Step 5: Run the suite and verify it passes**

Run: `set -a && source ./.env.test && set +a && pnpm exec vitest run tests/db/wallet-lifecycle.integration.test.ts --pool=forks --no-file-parallelism`

Expected: PASS, 31 tests (13 earlier + 4 rename + 10 invalid scenarios + 2 roles + 1 lookup + 1 pin).

- [ ] **Step 6: Record the decision**

Append to `docs/decisions.md`:

```markdown

## 2026-09-11 — Any active space member may rename, archive, or restore a wallet

**Decision:** `rename_wallet`, `archive_wallet`, and `restore_wallet` require only
active membership of the wallet's space, like `create_wallet` and
`archive_category`. A rename trims the name, keeps the 1–120 character rule,
refuses an unchanged name, and refuses an archived wallet. The current name is the
only name and also shows on past entries.

**Why:** Household members already create wallets and post into them; an
owner-only rule would stop the member who empties an envelope from tidying it up,
and no owner-only policy was requested.

**If changed:** Owner-only lifecycle commands need an owner check in
`private.require_wallet_command_actor`, non-owner rejection tests, and UI that
hides the actions from members. Showing the name a wallet had when an entry was
posted needs a name-at-time projection built from the command log.
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260911100000_wallet_lifecycle_commands.sql \
  tests/db/wallet-lifecycle.integration.test.ts docs/decisions.md
git commit -m "feat(db): add protected wallet rename command" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Protected archive and restore commands

**Files:**
- Modify: `supabase/migrations/20260911100000_wallet_lifecycle_commands.sql` (append section 4)
- Modify: `tests/db/wallet-lifecycle.integration.test.ts`
- Modify: `docs/decisions.md` (append)

**Interfaces:**
- Consumes: Task 3 helpers `private.require_wallet_command_actor`, `private.replay_wallet_command`, `private.lock_space_wallet`; test helpers `WalletCommand`, `renameWallet`, `commandResult`, error constants.
- Produces (SQL): `public.archive_wallet(p_space_id uuid, p_request_id uuid, p_wallet_id uuid) returns table (id uuid)`, `public.restore_wallet(p_space_id uuid, p_request_id uuid, p_wallet_id uuid) returns table (id uuid)`.
- Produces (test helpers used later): `walletLifecycleCommand(client, actorId, command: 'archive_wallet' | 'restore_wallet', input: WalletCommand): Promise<string>`, constants `alreadyArchivedError`, `nonZeroBalanceError`, `notArchivedError`.

- [ ] **Step 1: Add the archive/restore helpers**

Add below the `sameNameError` constant:

```ts
const alreadyArchivedError = { code: 'P0001', message: 'the wallet is already archived' };
const nonZeroBalanceError = { code: 'P0001', message: 'the wallet balance must be zero to archive' };
const notArchivedError = { code: 'P0001', message: 'the wallet is not archived' };
```

Add below the `commandResult` function:

```ts
async function walletLifecycleCommand(
  client: Client,
  actorId: string,
  command: 'archive_wallet' | 'restore_wallet',
  input: WalletCommand,
): Promise<string> {
  return withAuthenticatedTransaction(client, actorId, async () => {
    const result = await client.query<{ id: string }>(
      `select * from public.${command}($1, $2, $3) limit 2`,
      [input.spaceId, input.requestId, input.walletId],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.id;
  });
}
```

- [ ] **Step 2: Write the archive and restore tests**

Add at the end of the `describe` block:

```ts
  it('archives a zero-balance wallet and keeps its movement history', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Emptied USD');
    await postEvent(client, ownerId, personalId, 'income', [{ walletId, amountMinor: '900' }]);
    await postEvent(client, ownerId, personalId, 'expense', [{ walletId, amountMinor: '-900' }]);
    const requestId = randomUUID();

    expect(await walletLifecycleCommand(client, ownerId, 'archive_wallet', {
      spaceId: personalId, requestId, walletId,
    })).toBe(walletId);
    const archived = await walletRow(client, walletId);
    expect(archived.archived_at).toBeInstanceOf(Date);
    expect(archived.name).toBe('Emptied USD');
    const movements = await client.query(
      'select id from public.wallet_movements where wallet_id = $1 limit 3', [walletId],
    );
    expect(movements.rows).toHaveLength(2);
    expect(await logRows(client, walletId)).toEqual([{
      request_id: requestId, command_kind: 'archive_wallet', wallet_id: walletId, actor_id: ownerId,
      previous_name: null, name: null,
    }]);
    expect(await commandResult(client, ownerId, personalId, requestId)).toEqual([
      { command_kind: 'archive_wallet', wallet_id: walletId },
    ]);
  });

  it('archives a wallet that never had a movement', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Unused USD');
    await walletLifecycleCommand(client, ownerId, 'archive_wallet', {
      spaceId: personalId, requestId: randomUUID(), walletId,
    });
    expect((await walletRow(client, walletId)).archived_at).toBeInstanceOf(Date);
  });

  it.each([
    ['positive', 'income', '1250'],
    ['negative', 'expense', '-1250'],
  ] as const)('refuses to archive a wallet with a %s balance', async (_label, kind, amountMinor) => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, `Funded ${amountMinor}`);
    await postEvent(client, ownerId, personalId, kind, [{ walletId, amountMinor }]);

    await expect(walletLifecycleCommand(client, ownerId, 'archive_wallet', {
      spaceId: personalId, requestId: randomUUID(), walletId,
    })).rejects.toMatchObject(nonZeroBalanceError);
    expect(await walletRow(client, walletId)).toMatchObject({ archived_at: null });
    expect(await walletBalance(client, walletId)).toBe(amountMinor);
    expect(await logRows(client, walletId)).toEqual([]);
  });

  it('replays an exact archive without rewriting its timestamp or touching another wallet', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Replay archive USD');
    const otherWalletId = await createWallet(client, ownerId, personalId, 'Other archive USD');
    const command: WalletCommand = { spaceId: personalId, requestId: randomUUID(), walletId };
    await walletLifecycleCommand(client, ownerId, 'archive_wallet', command);
    const archivedAt = (await walletRow(client, walletId)).archived_at;

    expect(await walletLifecycleCommand(client, ownerId, 'archive_wallet', command)).toBe(walletId);
    expect((await walletRow(client, walletId)).archived_at).toEqual(archivedAt);
    await expect(walletLifecycleCommand(client, ownerId, 'archive_wallet', { ...command, walletId: otherWalletId }))
      .rejects.toMatchObject(replayError);
    await expect(walletLifecycleCommand(client, ownerId, 'restore_wallet', command))
      .rejects.toMatchObject(replayError);
    expect(await walletRow(client, otherWalletId)).toMatchObject({ archived_at: null });
    expect(await logRows(client, walletId)).toHaveLength(1);
  });

  it('rejects archiving an archived wallet and restoring an active wallet', async () => {
    const { client } = currentDatabase();
    const archivedId = await createWallet(client, ownerId, personalId, 'Twice archived USD');
    const activeId = await createWallet(client, ownerId, personalId, 'Never archived USD');
    await walletLifecycleCommand(client, ownerId, 'archive_wallet', {
      spaceId: personalId, requestId: randomUUID(), walletId: archivedId,
    });

    await expect(walletLifecycleCommand(client, ownerId, 'archive_wallet', {
      spaceId: personalId, requestId: randomUUID(), walletId: archivedId,
    })).rejects.toMatchObject(alreadyArchivedError);
    await expect(walletLifecycleCommand(client, ownerId, 'restore_wallet', {
      spaceId: personalId, requestId: randomUUID(), walletId: activeId,
    })).rejects.toMatchObject(notArchivedError);
    expect(await logRows(client, archivedId)).toHaveLength(1);
    expect(await logRows(client, activeId)).toEqual([]);
  });

  it('restores an archived wallet so it accepts postings and renames again', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Restored USD');
    await walletLifecycleCommand(client, ownerId, 'archive_wallet', {
      spaceId: personalId, requestId: randomUUID(), walletId,
    });
    const restoreRequestId = randomUUID();

    expect(await walletLifecycleCommand(client, ownerId, 'restore_wallet', {
      spaceId: personalId, requestId: restoreRequestId, walletId,
    })).toBe(walletId);
    expect(await walletRow(client, walletId)).toMatchObject({ archived_at: null });
    await postEvent(client, ownerId, personalId, 'income', [{ walletId, amountMinor: '300' }]);
    await renameWallet(client, ownerId, { spaceId: personalId, requestId: randomUUID(), walletId, name: 'Back USD' });
    expect(await walletBalance(client, walletId)).toBe('300');
    expect((await logRows(client, walletId)).map(({ command_kind }) => command_kind))
      .toEqual(['archive_wallet', 'restore_wallet', 'rename_wallet']);
    expect(await commandResult(client, ownerId, personalId, restoreRequestId)).toEqual([
      { command_kind: 'restore_wallet', wallet_id: walletId },
    ]);
  });

  it('replays an exact restore without re-applying it after a later archive', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Replay restore USD');
    const restore: WalletCommand = { spaceId: personalId, requestId: randomUUID(), walletId };
    await walletLifecycleCommand(client, ownerId, 'archive_wallet', {
      spaceId: personalId, requestId: randomUUID(), walletId,
    });
    await walletLifecycleCommand(client, ownerId, 'restore_wallet', restore);
    await walletLifecycleCommand(client, ownerId, 'archive_wallet', {
      spaceId: personalId, requestId: randomUUID(), walletId,
    });

    expect(await walletLifecycleCommand(client, ownerId, 'restore_wallet', restore)).toBe(walletId);
    expect((await walletRow(client, walletId)).archived_at).toBeInstanceOf(Date);
    expect(await logRows(client, walletId)).toHaveLength(3);
  });

  it('lets an active non-owner household member archive and restore a household wallet', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, householdId, 'Envelope LBP', 'LBP');
    await walletLifecycleCommand(client, memberId, 'archive_wallet', {
      spaceId: householdId, requestId: randomUUID(), walletId,
    });
    await walletLifecycleCommand(client, memberId, 'restore_wallet', {
      spaceId: householdId, requestId: randomUUID(), walletId,
    });
    expect(await walletRow(client, walletId)).toMatchObject({ archived_at: null });
    expect((await logRows(client, walletId)).map(({ actor_id }) => actor_id)).toEqual([memberId, memberId]);
  });

  it.each([
    ['archive_wallet', 'outsider'], ['archive_wallet', 'null space'], ['archive_wallet', 'null request'],
    ['archive_wallet', 'null wallet'], ['archive_wallet', 'foreign wallet'],
    ['restore_wallet', 'outsider'], ['restore_wallet', 'null space'], ['restore_wallet', 'null request'],
    ['restore_wallet', 'null wallet'], ['restore_wallet', 'foreign wallet'],
  ] as const)('rejects %s with %s without partial state', async (commandName, scenario) => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Guarded USD');
    const householdWalletId = await createWallet(client, ownerId, householdId, 'Guarded household USD');
    if (commandName === 'restore_wallet') {
      await archiveWalletDirectly(client, walletId);
      await archiveWalletDirectly(client, householdWalletId);
    }
    const before = await walletRow(client, walletId);
    const householdBefore = await walletRow(client, householdWalletId);
    const input: WalletCommand = { spaceId: personalId, requestId: randomUUID(), walletId };
    let actorId = ownerId;
    let expected: { code: string; message: string } = membershipError;
    switch (scenario) {
      case 'outsider':
        actorId = outsiderId;
        break;
      case 'null space':
        input.spaceId = null;
        break;
      case 'null request':
        input.requestId = null;
        expected = missingIdsError;
        break;
      case 'null wallet':
        input.walletId = null;
        expected = missingIdsError;
        break;
      case 'foreign wallet':
        input.walletId = householdWalletId;
        expected = foreignWalletError;
        break;
    }

    await expect(walletLifecycleCommand(client, actorId, commandName, input)).rejects.toMatchObject(expected);
    expect(await walletRow(client, walletId)).toEqual(before);
    expect(await walletRow(client, householdWalletId)).toEqual(householdBefore);
    expect(await logRows(client, walletId)).toEqual([]);
    expect(await logRows(client, householdWalletId)).toEqual([]);
  });

  it.each(['anon', 'service_role'] as const)('denies the %s role archive and restore', async (role) => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Role archive USD');
    await withRollback(client, async () => {
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [ownerId]);
      await client.query(`set local role ${role}`);
      for (const command of ['archive_wallet', 'restore_wallet'] as const) {
        await expectSavepointRejection(client, () => client.query(
          `select * from public.${command}($1, $2, $3)`, [personalId, randomUUID(), walletId],
        ), { code: '42501' });
      }
    });
    expect(await walletRow(client, walletId)).toMatchObject({ archived_at: null });
  });

  it('pins archive and restore signatures, search paths, and execute grants', async () => {
    const { client } = currentDatabase();
    const command = {
      result: 'TABLE(id uuid)', prosecdef: true, provolatile: 'v', proconfig: ['search_path=pg_catalog, extensions'],
      public_exec: false, anon_exec: false, authenticated_exec: true, service_exec: false,
    };
    expect(await functionCatalog(client, [
      'public.archive_wallet(uuid,uuid,uuid)',
      'public.restore_wallet(uuid,uuid,uuid)',
    ])).toEqual([
      { signature: 'archive_wallet(uuid,uuid,uuid)', ...command },
      { signature: 'restore_wallet(uuid,uuid,uuid)', ...command },
    ]);
  });
```

- [ ] **Step 3: Run the suite and verify the archive/restore tests fail**

Run: `set -a && source ./.env.test && set +a && pnpm exec vitest run tests/db/wallet-lifecycle.integration.test.ts --pool=forks --no-file-parallelism`

Expected: FAIL in all 22 new tests because `public.archive_wallet` and `public.restore_wallet` do not exist yet (PostgreSQL code `42883`, "function … does not exist"). Earlier tests still PASS.

- [ ] **Step 4: Append the archive/restore section to the migration**

Append to `supabase/migrations/20260911100000_wallet_lifecycle_commands.sql`:

```sql

-- 4. Archive at zero balance and restore.

create function public.archive_wallet(
  p_space_id uuid,
  p_request_id uuid,
  p_wallet_id uuid
)
returns table (id uuid)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor_id uuid;
  v_fingerprint bytea;
  v_wallet public.wallets;
  v_balance_minor numeric;
begin
  v_actor_id := private.require_wallet_command_actor(p_space_id, p_request_id, p_wallet_id);
  v_fingerprint := extensions.digest(
    pg_catalog.jsonb_build_object('version', 1, 'command', 'archive_wallet', 'walletId', p_wallet_id)::text,
    'sha256'
  );

  if private.replay_wallet_command(p_space_id, p_request_id, 'archive_wallet', v_fingerprint, p_wallet_id) then
    return query select p_wallet_id;
    return;
  end if;

  v_wallet := private.lock_space_wallet(p_space_id, p_wallet_id);

  if v_wallet.archived_at is not null then
    raise exception using errcode = 'P0001', message = 'the wallet is already archived';
  end if;

  select coalesce(sum(movement.amount_minor), 0)
  into v_balance_minor
  from public.wallet_movements as movement
  where movement.wallet_id = p_wallet_id
    and movement.space_id = p_space_id;

  if v_balance_minor <> 0 then
    raise exception using errcode = 'P0001', message = 'the wallet balance must be zero to archive';
  end if;

  update public.wallets as wallet
  set archived_at = pg_catalog.now()
  where wallet.id = p_wallet_id;

  insert into public.wallet_command_requests (
    space_id, request_id, command_kind, request_fingerprint, wallet_id, actor_id
  )
  values (p_space_id, p_request_id, 'archive_wallet', v_fingerprint, p_wallet_id, v_actor_id);

  return query select p_wallet_id;
end;
$$;

create function public.restore_wallet(
  p_space_id uuid,
  p_request_id uuid,
  p_wallet_id uuid
)
returns table (id uuid)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor_id uuid;
  v_fingerprint bytea;
  v_wallet public.wallets;
begin
  v_actor_id := private.require_wallet_command_actor(p_space_id, p_request_id, p_wallet_id);
  v_fingerprint := extensions.digest(
    pg_catalog.jsonb_build_object('version', 1, 'command', 'restore_wallet', 'walletId', p_wallet_id)::text,
    'sha256'
  );

  if private.replay_wallet_command(p_space_id, p_request_id, 'restore_wallet', v_fingerprint, p_wallet_id) then
    return query select p_wallet_id;
    return;
  end if;

  v_wallet := private.lock_space_wallet(p_space_id, p_wallet_id);

  if v_wallet.archived_at is null then
    raise exception using errcode = 'P0001', message = 'the wallet is not archived';
  end if;

  update public.wallets as wallet
  set archived_at = null
  where wallet.id = p_wallet_id;

  insert into public.wallet_command_requests (
    space_id, request_id, command_kind, request_fingerprint, wallet_id, actor_id
  )
  values (p_space_id, p_request_id, 'restore_wallet', v_fingerprint, p_wallet_id, v_actor_id);

  return query select p_wallet_id;
end;
$$;

revoke all on function public.archive_wallet(uuid, uuid, uuid) from public, anon, service_role;
revoke all on function public.restore_wallet(uuid, uuid, uuid) from public, anon, service_role;

grant execute on function public.archive_wallet(uuid, uuid, uuid) to authenticated;
grant execute on function public.restore_wallet(uuid, uuid, uuid) to authenticated;
```

- [ ] **Step 5: Run the suite and verify it passes**

Run: `set -a && source ./.env.test && set +a && pnpm exec vitest run tests/db/wallet-lifecycle.integration.test.ts --pool=forks --no-file-parallelism`

Expected: PASS, 53 tests (31 earlier + 22 archive/restore).

- [ ] **Step 6: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 7: Record the decision**

Append to `docs/decisions.md`:

```markdown

## 2026-09-11 — Wallets archive only at zero balance and can be restored

**Decision:** `archive_wallet` refuses unless the wallet's derived balance (the sum
of its movements) is exactly zero; `restore_wallet` returns an archived wallet to
active use at any time. Both are request-idempotent: an exact replay returns the
original wallet without re-applying, even if the wallet's state changed since.

**Why:** Archiving a wallet that still holds money would hide real balances from
every total. Restore makes an archive mistake recoverable and is the way to undo
an old transaction on an archived wallet.

**If changed:** Archiving non-zero wallets needs a visible archived-balance
projection or a closing-transfer design. Dropping restore makes archive permanent,
as it is for categories, and leaves old entries on archived wallets uncorrectable.
```

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260911100000_wallet_lifecycle_commands.sql \
  tests/db/wallet-lifecycle.integration.test.ts docs/decisions.md
git commit -m "feat(db): add zero-balance wallet archive and restore commands" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Prove archive and posting serialize

**Files:**
- Modify: `tests/db/wallet-lifecycle.integration.test.ts`

**Interfaces:**
- Consumes: harness `orderedAuthenticatedRace`; Task 4 `archive_wallet`; Task 2 trigger; constants `inactiveMovementError`, `nonZeroBalanceError`.
- Produces: no new interfaces.

- [ ] **Step 1: Add the race import and helpers**

Change the harness import in `tests/db/wallet-lifecycle.integration.test.ts` to include `orderedAuthenticatedRace`:

```ts
import {
  bootstrapCompatibilityObjects,
  createDisposableDatabase,
  disposeDisposableDatabase,
  expectSavepointRejection,
  migrationFiles,
  orderedAuthenticatedRace,
  replayMigrations,
  withAuthenticatedTransaction,
  withRollback,
  type DisposableDatabase,
  type MigrationFile,
} from './disposable-database.js';
```

Add below `walletLifecycleCommand`:

```ts
async function postIncomeInOpenTransaction(client: Client, spaceId: string, walletId: string, requestId: string) {
  return client.query(
    "select * from public.record_financial_event($1, $2, 'income', '2026-09-11', $3::jsonb) limit 2",
    [spaceId, requestId, JSON.stringify([{ walletId, amountMinor: '500' }])],
  );
}

async function archiveInOpenTransaction(client: Client, spaceId: string, walletId: string) {
  return client.query('select * from public.archive_wallet($1, $2, $3) limit 2', [spaceId, randomUUID(), walletId]);
}
```

- [ ] **Step 2: Write the two race tests**

Add at the end of the `describe` block:

```ts
  it('fails a posting that waits behind a committed archive of the same wallet', async () => {
    const database = currentDatabase();
    const walletId = await createWallet(database.client, ownerId, personalId, 'Race archive first');
    const postingRequestId = randomUUID();

    const outcome = await orderedAuthenticatedRace(
      database,
      ownerId,
      (client) => archiveInOpenTransaction(client, personalId, walletId),
      (client) => postIncomeInOpenTransaction(client, personalId, walletId, postingRequestId),
    );

    expect(outcome).toEqual({ status: 'rejected', reason: expect.objectContaining(inactiveMovementError) });
    expect((await walletRow(database.client, walletId)).archived_at).toBeInstanceOf(Date);
    expect(await walletBalance(database.client, walletId)).toBe('0');
    const posted = await database.client.query(
      'select id from public.financial_events where space_id = $1 and request_id = $2 limit 2',
      [personalId, postingRequestId],
    );
    expect(posted.rows).toEqual([]);
  });

  it('fails an archive that waits behind a committed posting to the same wallet', async () => {
    const database = currentDatabase();
    const walletId = await createWallet(database.client, ownerId, personalId, 'Race posting first');

    const outcome = await orderedAuthenticatedRace(
      database,
      ownerId,
      (client) => postIncomeInOpenTransaction(client, personalId, walletId, randomUUID()),
      (client) => archiveInOpenTransaction(client, personalId, walletId),
    );

    expect(outcome).toEqual({ status: 'rejected', reason: expect.objectContaining(nonZeroBalanceError) });
    expect(await walletRow(database.client, walletId)).toMatchObject({ archived_at: null });
    expect(await walletBalance(database.client, walletId)).toBe('500');
    expect(await logRows(database.client, walletId)).toEqual([]);
  });
```

- [ ] **Step 3: Run the race tests and verify they pass**

Run: `set -a && source ./.env.test && set +a && pnpm exec vitest run tests/db/wallet-lifecycle.integration.test.ts --pool=forks --no-file-parallelism -t "waits behind"`

Expected: PASS, 2 tests (53 skipped).

- [ ] **Step 4: Prove the share lock is load-bearing (mutation check — do not commit)**

In `supabase/migrations/20260911100000_wallet_lifecycle_commands.sql`, temporarily delete the line `for share;` inside `private.require_active_movement_wallet()` and put a `;` at the end of the preceding `and wallet.archived_at is null` line. Run:

`set -a && source ./.env.test && set +a && pnpm exec vitest run tests/db/wallet-lifecycle.integration.test.ts --pool=forks --no-file-parallelism -t "waits behind a committed archive"`

Expected: FAIL — `outcome` is `{ status: 'fulfilled', … }` and the archived wallet balance is `'500'`: without the share lock the posting validates against the pre-archive row, blocks only on the foreign-key check, and commits into the archived wallet.

Then restore the file exactly and confirm: `git diff --exit-code supabase/migrations/20260911100000_wallet_lifecycle_commands.sql` exits 0.

- [ ] **Step 5: Run the full suite**

Run: `set -a && source ./.env.test && set +a && pnpm exec vitest run tests/db/wallet-lifecycle.integration.test.ts --pool=forks --no-file-parallelism`

Expected: PASS, 55 tests.

- [ ] **Step 6: Commit**

```bash
git add tests/db/wallet-lifecycle.integration.test.ts
git commit -m "test(db): prove wallet archive and posting serialize" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Seeded 32-to-33 migration upgrade proof

**Files:**
- Modify: `tests/db/wallet-lifecycle.integration.test.ts`

**Interfaces:**
- Consumes: harness `createDisposableDatabase`, `bootstrapCompatibilityObjects`, `replayMigrations`, `disposeDisposableDatabase`; helpers from Tasks 1–4.
- Produces: no new interfaces.

- [ ] **Step 1: Add the upgrade snapshot and seeding helpers**

Add below `archiveInOpenTransaction`:

```ts
const upgradeRelations = [
  'public.categories',
  'public.category_command_requests',
  'public.financial_event_categories',
  'public.financial_events',
  'public.loan_balances',
  'public.loan_postings',
  'public.loans',
  'public.space_memberships',
  'public.spaces',
  'public.wallet_balances',
  'public.wallet_movements',
  'public.wallets',
] as const;

const existingCommandSignatures = [
  'archive_category(uuid,uuid,uuid)',
  'create_category(uuid,uuid,category_kind,text,text)',
  'create_space(text,space_kind)',
  'create_subcategory(uuid,uuid,uuid,text,text)',
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

async function relationSnapshot(client: Client): Promise<Record<string, string[]>> {
  const snapshot: Record<string, string[]> = {};
  for (const relation of upgradeRelations) {
    // Relation names come only from the fixed allowlist above.
    const result = await client.query<{ row: string }>(
      `select to_jsonb(source)::text as row from ${relation} as source order by row limit 101`,
    );
    expect(result.rows.length, `${relation} must fit in the snapshot`).toBeLessThanOrEqual(100);
    snapshot[relation] = result.rows.map(({ row }) => row);
  }
  return snapshot;
}

async function existingCommandSnapshot(client: Client) {
  const result = await client.query<{ signature: string; definition: string; acl: string | null }>(
    `select procedure.oid::regprocedure::text as signature,
       pg_get_functiondef(procedure.oid) as definition,
       procedure.proacl::text as acl
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.oid::regprocedure::text = any($1::text[])
     order by procedure.oid::regprocedure::text collate "C"
     limit 20`,
    [existingCommandSignatures],
  );
  expect(result.rows.map(({ signature }) => signature)).toEqual([...existingCommandSignatures]);
  return result.rows;
}

async function seedUpgradeDatabase(client: Client) {
  const seedOwnerId = randomUUID();
  const seedMemberId = randomUUID();
  await insertUsers(client, [seedOwnerId, seedMemberId]);
  const seedPersonalId = await createSpace(client, seedOwnerId, 'personal');
  const seedHouseholdId = await createSpace(client, seedOwnerId, 'household');
  await addHouseholdMember(client, seedHouseholdId, seedMemberId);
  const dailyId = await createWallet(client, seedOwnerId, seedPersonalId, 'Daily USD');
  const reserveId = await createWallet(client, seedOwnerId, seedPersonalId, 'Reserve USD');
  const unusedId = await createWallet(client, seedMemberId, seedHouseholdId, 'Unused LBP', 'LBP');
  await postEvent(client, seedOwnerId, seedPersonalId, 'opening_balance', [{ walletId: dailyId, amountMinor: '100000' }]);
  const incomeId = await postEvent(client, seedOwnerId, seedPersonalId, 'income', [{ walletId: dailyId, amountMinor: '2500' }]);
  await postEvent(client, seedOwnerId, seedPersonalId, 'transfer', [
    { walletId: dailyId, amountMinor: '-1000' },
    { walletId: reserveId, amountMinor: '1000' },
  ]);
  await reverseEvent(client, seedOwnerId, seedPersonalId, incomeId);
  const categoryId = await createExpenseCategory(client, seedOwnerId, seedPersonalId);
  await postCategorizedExpense(client, seedOwnerId, seedPersonalId, dailyId, categoryId, '-700');
  const loanId = await recordCashLoan(client, seedOwnerId, seedPersonalId, dailyId, '5000');
  await repayLoan(client, seedOwnerId, seedPersonalId, loanId, dailyId, '1000');
  return { seedOwnerId, seedMemberId, seedPersonalId, seedHouseholdId, dailyId, unusedId };
}
```

- [ ] **Step 2: Write the upgrade test**

Add at the end of the `describe` block:

```ts
  it('preserves seeded data and existing commands when upgrading 32 to 33 migrations', async () => {
    const prior = migrations.filter(({ version }) => version < lifecycleVersion);
    const lifecycle = migrations.filter(({ version }) => version === lifecycleVersion);
    expect(prior).toHaveLength(32);
    expect(lifecycle.map(({ name }) => name)).toEqual(['wallet_lifecycle_commands']);

    const upgrade = await createDisposableDatabase('budget_walletupgrade');
    try {
      await bootstrapCompatibilityObjects(upgrade.client);
      await replayMigrations(upgrade.client, prior);
      const seed = await seedUpgradeDatabase(upgrade.client);
      const relationsBefore = await relationSnapshot(upgrade.client);
      const commandsBefore = await existingCommandSnapshot(upgrade.client);

      await replayMigrations(upgrade.client, lifecycle);

      expect(await relationSnapshot(upgrade.client)).toEqual(relationsBefore);
      expect(await existingCommandSnapshot(upgrade.client)).toEqual(commandsBefore);
      const expenseId = await postEvent(upgrade.client, seed.seedOwnerId, seed.seedPersonalId, 'expense', [
        { walletId: seed.dailyId, amountMinor: '-300' },
      ]);
      await reverseEvent(upgrade.client, seed.seedOwnerId, seed.seedPersonalId, expenseId);
      await createWallet(upgrade.client, seed.seedMemberId, seed.seedHouseholdId, 'Post-upgrade LBP', 'LBP');
      await renameWallet(upgrade.client, seed.seedOwnerId, {
        spaceId: seed.seedPersonalId, requestId: randomUUID(), walletId: seed.dailyId, name: 'Upgraded daily',
      });
      await walletLifecycleCommand(upgrade.client, seed.seedMemberId, 'archive_wallet', {
        spaceId: seed.seedHouseholdId, requestId: randomUUID(), walletId: seed.unusedId,
      });
      expect(await walletRow(upgrade.client, seed.dailyId)).toMatchObject({ name: 'Upgraded daily', archived_at: null });
      expect((await walletRow(upgrade.client, seed.unusedId)).archived_at).toBeInstanceOf(Date);
      const journal = await upgrade.client.query<{ count: number }>(
        'select count(*)::int as count from supabase_migrations.schema_migrations',
      );
      expect(journal.rows).toEqual([{ count: 33 }]);
    } finally {
      await disposeDisposableDatabase(upgrade);
    }
  }, 180_000);
```

- [ ] **Step 3: Run the upgrade test**

Run: `set -a && source ./.env.test && set +a && pnpm exec vitest run tests/db/wallet-lifecycle.integration.test.ts --pool=forks --no-file-parallelism -t "upgrading 32 to 33"`

Expected: PASS, 1 test. (This proof guards the migration against data rewrites; it passes because Tasks 1–4 add objects only. If it fails, the migration changed existing rows or functions — stop and use superpowers:systematic-debugging.)

- [ ] **Step 4: Prove the snapshot detects a data rewrite (mutation check — do not commit)**

Temporarily append `update public.wallets set name = name || ' ';` to the end of the migration file. Run the Step 3 command.

Expected: FAIL on `expect(await relationSnapshot(upgrade.client)).toEqual(relationsBefore)` showing changed `public.wallets` names. Remove the line and confirm `git diff --exit-code supabase/migrations/20260911100000_wallet_lifecycle_commands.sql` exits 0.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `set -a && source ./.env.test && set +a && pnpm exec vitest run tests/db/wallet-lifecycle.integration.test.ts --pool=forks --no-file-parallelism && pnpm exec tsc --noEmit`

Expected: PASS, 56 tests; tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add tests/db/wallet-lifecycle.integration.test.ts
git commit -m "test(db): prove seeded upgrade to the wallet lifecycle migration" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Shared ratchets, command inventory, and development database

**Files:**
- Modify: `tests/db/financial-boundary-coverage.integration.test.ts`
- Modify: `tests/db/test-database.ts:190-202`
- Modify: `docs/financial-command-inventory.md`

**Interfaces:**
- Consumes: the final migration from Tasks 1–4.
- Produces: `financialTableWritePrivileges()` now also reports `wallet_command_requests`.

- [ ] **Step 1: STOP — ask the owner before touching the development database**

The shared development database (`100.76.160.91:54422`) is at 31 migrations: it is also missing the already-merged `20260910100000_subcategories_foundation.sql`. Applying pending migrations there is a remote operation. Ask in chat:

> "Task 7 needs the shared development database migrated. It will apply two pending migrations there: `20260910100000_subcategories_foundation` (already on main) and `20260911100000_wallet_lifecycle_commands`. I'll copy only those two files, not the whole `supabase/` folder (its `.temp/` links to the hosted project). OK to proceed?"

Continue only after an explicit yes. If declined, skip Steps 2–3 and 7, leave the boundary ratchet unchanged, and record "shared ratchet update deferred until the development database is migrated" in the handoff.

- [ ] **Step 2: Apply the pending migrations to the development database**

```bash
scp supabase/migrations/20260910100000_subcategories_foundation.sql \
  supabase/migrations/20260911100000_wallet_lifecycle_commands.sql \
  lelabo@100.76.160.91:/home/lelabo/budget-supabase/supabase/migrations/
ssh lelabo@100.76.160.91 "cd /home/lelabo/budget-supabase && /home/lelabo/.local/bin/supabase migration up --local"
```

Expected: the CLI reports applying `20260910100000_subcategories_foundation.sql` and `20260911100000_wallet_lifecycle_commands.sql` and finishes without error.

- [ ] **Step 3: Verify the development journal**

```bash
set -a && source ./.env.test && set +a && node -e "
const { Client } = require('pg');
const fs = require('fs');
const local = fs.readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).map((n) => n.slice(0, 14));
const c = new Client({ connectionString: process.env.BUDGET_TEST_DATABASE_URL, connectionTimeoutMillis: 8000, query_timeout: 8000 });
c.connect()
  .then(() => c.query('select version from supabase_migrations.schema_migrations order by version limit 100'))
  .then((r) => { const applied = r.rows.map((x) => x.version); console.log(JSON.stringify({ applied: applied.length, missing: local.filter((v) => !applied.includes(v)) })); return c.end(); })
  .catch((e) => { console.error(e.code || e.message); process.exit(1); });
"
```

Expected: `{"applied":33,"missing":[]}`

- [ ] **Step 4: Write the failing ratchet expectation**

In `tests/db/financial-boundary-coverage.integration.test.ts`, in BOTH `toEqual([...])` arrays of the two "non-writable" tests, insert the new row between `loans` and `wallet_movements`:

```ts
      { table_name: 'loans', writable: false },
      { table_name: 'wallet_command_requests', writable: false },
      { table_name: 'wallet_movements', writable: false },
```

- [ ] **Step 5: Run it and verify it fails**

Run: `set -a && source ./.env.test && set +a && pnpm exec vitest run tests/db/financial-boundary-coverage.integration.test.ts --pool=forks --no-file-parallelism`

Expected: FAIL in both non-writable tests — the received arrays lack `wallet_command_requests`.

- [ ] **Step 6: Add the table to the shared ratchet helper**

In `tests/db/test-database.ts`, in `financialTableWritePrivileges`, add `'wallet_command_requests',` after `'wallets',` in the table-name array:

```ts
      [
        'wallets',
        'wallet_command_requests',
        'financial_events',
        'wallet_movements',
        'loans',
        'loan_postings',
        'loan_monthly_target_revisions',
        'financial_event_categories',
        ],
```

- [ ] **Step 7: Run it and verify it passes**

Run: `set -a && source ./.env.test && set +a && pnpm exec vitest run tests/db/financial-boundary-coverage.integration.test.ts --pool=forks --no-file-parallelism`

Expected: PASS, 3 tests.

- [ ] **Step 8: Document the lifecycle commands in the inventory**

In `docs/financial-command-inventory.md`, insert this paragraph immediately before the paragraph that starts `The Loans and Wallets workspaces are the implemented financial entry paths`:

```markdown
`public.rename_wallet`, `public.archive_wallet`, and `public.restore_wallet` are
protected wallet lifecycle commands, not posting commands. They change only a
wallet's `name` or `archived_at` and append one row to
`public.wallet_command_requests`; `archive_wallet` refuses any non-zero derived
balance. `public.get_wallet_command_result` is their bounded read-only
reconciliation function. The `wallet_movements_require_active_wallet` trigger
refuses every money movement into an archived wallet, including reversals and
loan postings, so it narrows what the posting commands above can write without
adding a writer. No browser entry path calls the lifecycle commands yet.
```

- [ ] **Step 9: Run the whole database suite**

Run: `set -a && source ./.env.test && set +a && pnpm test:db`

Expected: PASS for every file. If a pre-existing suite fails, compare against `main` before assuming this milestone caused it (the shared database just gained the subcategories migration too); investigate with superpowers:systematic-debugging.

- [ ] **Step 10: Commit**

```bash
git add tests/db/financial-boundary-coverage.integration.test.ts tests/db/test-database.ts \
  docs/financial-command-inventory.md
git commit -m "test(db): ratchet wallet command log as non-writable and document lifecycle commands" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Pin the 33-migration live release

**Files:**
- Modify: `tests/ops/migration-manifest.test.ts:18,87-103`
- Modify: `tests/ops/live-migrations.test.ts:22,190-205`
- Modify: `scripts/ops/apply-live-migrations.sh:12,18-40`
- Modify: `ops/budget-migrations.sha256`

**Interfaces:**
- Consumes: the commit that last changed the migration file (the release source).
- Produces: a manifest and live runner that accept exactly 33 migrations ending at `20260911100000`.

- [ ] **Step 1: Capture the release source commit**

```bash
git log -1 --format=%H -- supabase/migrations/20260911100000_wallet_lifecycle_commands.sql
```

Expected: one 40-character SHA (the Task 4 commit unless the file changed later). Below, `<RELEASE_SHA>` means exactly that value. This release must reach `main` without squash or rebase so the SHA stays an ancestor of `main`; otherwise repeat this task after merging.

- [ ] **Step 2: Update the ops tests (failing first)**

In `tests/ops/migration-manifest.test.ts`:

```ts
const liveReleaseHead = '<RELEASE_SHA>';
```

and replace the first test's title and pins:

```ts
  it('pins the merged wallet lifecycle release as 33 immutable migrations', () => {
```

```ts
    expect(migrationRows).toHaveLength(33);
```

```ts
    expect(migrationRows.at(-1)).toMatch(
      /^20260911100000\|20260911100000_wallet_lifecycle_commands\.sql\|[a-f0-9]{64}$/,
    );
```

In `tests/ops/live-migrations.test.ts`:

```ts
const releaseHead = '<RELEASE_SHA>';
```

and replace the journal test with:

```ts
  it('verifies the exact 33-row journal and merged schema after application', () => {
    const source = readFileSync(script, 'utf8');
    const verificationSql = source.slice(
      source.indexOf('readonly LIVE_VERIFY_SQL='),
      source.indexOf('\n\nlive_fail()'),
    );

    expect(verificationSql.match(/'20[0-9]{12}'/g)).toHaveLength(33);
    expect(verificationSql).toContain("'20260908170000'");
    expect(verificationSql).toContain("'20260910100000'");
    expect(verificationSql).toContain("'20260911100000'");
    expect(verificationSql).toContain("to_regclass('public.household_invitations')");
    expect(verificationSql).toContain(
      "to_regprocedure('public.create_subcategory(uuid,uuid,uuid,text,text)')",
    );
    expect(verificationSql).toContain("to_regprocedure('public.archive_wallet(uuid,uuid,uuid)')");
    expect(verificationSql).not.toContain("to_regclass('public.subcategories')");
  });
```

- [ ] **Step 3: Run the ops tests and verify they fail**

Run: `pnpm exec vitest run tests/ops/migration-manifest.test.ts tests/ops/live-migrations.test.ts --pool=forks --no-file-parallelism`

Expected: FAIL — manifest has 32 rows and old `source_sha`; the live script still pins the old SHA and 32 versions.

- [ ] **Step 4: Update the live runner**

In `scripts/ops/apply-live-migrations.sh` set:

```bash
readonly LIVE_MANIFEST_SOURCE_SHA='<RELEASE_SHA>'
```

and replace `LIVE_VERIFY_SQL` with:

```bash
readonly LIVE_VERIFY_SQL="select case when
  to_regclass('public.spaces') is not null
  and to_regclass('public.space_memberships') is not null
  and to_regclass('public.wallets') is not null
  and to_regclass('public.financial_events') is not null
  and to_regclass('public.loans') is not null
  and to_regclass('public.categories') is not null
  and to_regclass('public.household_invitations') is not null
  and to_regprocedure('public.create_subcategory(uuid,uuid,uuid,text,text)') is not null
  and to_regprocedure('public.archive_wallet(uuid,uuid,uuid)') is not null
  and (select array_agg(version order by version) from supabase_migrations.schema_migrations)
    = array[
      '20260907100000','20260907110000','20260907120000','20260907130000',
      '20260907140000','20260907141000','20260907142000','20260907143000',
      '20260907144000','20260907145000','20260907146000','20260907147000',
      '20260907148000','20260907149000','20260908100000','20260908101000',
      '20260908102000','20260908103000','20260908170000','20260908171000',
      '20260908171100','20260908172000','20260908173000','20260908173100',
      '20260908174000','20260908175000','20260908176000','20260908177000',
      '20260908178000','20260908179000','20260908180000','20260910100000',
      '20260911100000'
    ]::text[]
  then 'budget_schema_ready'
  else 'budget_schema_incomplete'
end as result;"
```

- [ ] **Step 5: Regenerate the manifest with the release tool**

```bash
mv ops/budget-migrations.sha256 "$TMPDIR/budget-migrations.previous.sha256"
bash scripts/ops/migrate-budget.sh create-manifest "$PWD/supabase/migrations" \
  "$PWD/ops/budget-migrations.sha256" '<RELEASE_SHA>'
diff "$TMPDIR/budget-migrations.previous.sha256" ops/budget-migrations.sha256
```

Expected: `created migration manifest with 33 files`; the diff shows only the changed `source_sha=` line and one appended `20260911100000|20260911100000_wallet_lifecycle_commands.sql|<64 hex>` row.

- [ ] **Step 6: Run the ops checks**

Run: `pnpm check:ops`
Expected: ends with `Budget ops verification passed`.

- [ ] **Step 7: Commit**

```bash
git add ops/budget-migrations.sha256 scripts/ops/apply-live-migrations.sh \
  tests/ops/migration-manifest.test.ts tests/ops/live-migrations.test.ts
git commit -m "chore(db): prepare 33-migration live release" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Final gate and handoff

**Files:** none changed unless a gate fails.

- [ ] **Step 1: Run every gate fresh**

```bash
set -a && source ./.env.test && set +a
pnpm exec vitest run tests/db/wallet-lifecycle.integration.test.ts --pool=forks --no-file-parallelism
pnpm test:db
pnpm test:worker
pnpm test:ui
pnpm typecheck
pnpm check:ops
pnpm build
git diff --check
git status --short
```

Expected: wallet lifecycle suite 56 passed; every other suite passes; `typecheck` and `build` exit 0; `check:ops` prints `Budget ops verification passed`; `git diff --check` prints nothing; `git status --short` shows only the pre-existing untracked files (`.DS_Store`, `.claude-flow/`, `.swarm/`, `artifacts/.DS_Store`, `docs/.DS_Store`, `supabase/.temp/`).

- [ ] **Step 2: Spec coverage check**

Confirm each spec verification bullet maps to a passing test: success incl. non-owner member (Tasks 3–4); replay and changed payload (Tasks 3–4); rejections for non-member, `anon`, `service_role`, null IDs, cross-space, unchanged/blank/long name, archived rename, double archive, restoring active, non-zero balances (Tasks 3–4); movement guard across five commands plus raw owner insert (Task 2); wallet identity/currency, timestamp rewrite, non-owner update after raw grant, row and zero-row delete, and truncate definition pinned (Task 1); log update/delete/zero-row delete/truncate after raw grants (Task 1); two-order race (Task 5); empty replay and seeded upgrade (Tasks 1, 6); catalog pins and both shared ratchets (Tasks 1–4, 7). Wallet `TRUNCATE` is proven by trigger definition, not execution, because PostgreSQL rejects truncating a foreign-key-referenced table before truncate triggers run.

- [ ] **Step 3: Hand off**

Report the branch, commit list (`git log --oneline claude/wallets-undo-expense-default..HEAD`), and gate evidence. Do **not** merge, push, apply the live migration, or deploy. Next steps for the owner: review and merge without squash (keeps `<RELEASE_SHA>` an ancestor of `main`), then request milestone 2 (Application/UI) planning.
