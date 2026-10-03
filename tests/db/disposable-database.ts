import type {Client} from 'pg';
import {expect} from 'vitest';
import {databaseClient, type DisposableDatabase} from '../support/disposable-postgres.js';
export {databaseClient, bootstrapCompatibilityObjects, createDisposableDatabase, disposeDisposableDatabase, inTransaction, migrationFiles, replayMigrations, withAuthenticatedTransaction, withRollback} from '../support/disposable-postgres.js';
export type {DisposableDatabase, MigrationFile} from '../support/disposable-postgres.js';
const lockWaitMillis = 5_000;

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
