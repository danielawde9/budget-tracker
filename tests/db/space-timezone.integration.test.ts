import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction,
  type DisposableDatabase,
} from './disposable-database.js';

// W4a-1: one app clock + a per-space timezone (audit 2026-09-25 rank 11,
// E1/E2a/A7/D12). Proves the space-zone date across an offset boundary for
// `Asia/Beirut` just after midnight UTC, and that the client-visible cash read
// accepts the space-zone date instead of UTC today at the same instant.
let database: DisposableDatabase | undefined;
const actor = randomUUID();
const outsider = randomUUID();

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_spacetz');
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

async function createSpace(name: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const space = await db().client.query<{ id: string }>(
      "select id from public.create_space($1, 'personal') limit 2", [name],
    );
    return space.rows[0]!.id;
  });
}

async function freshSpace(name: string, timezone: string): Promise<string> {
  const id = await createSpace(name);
  await db().client.query('update public.spaces set timezone = $2 where id = $1', [id, timezone]);
  return id;
}

async function timezoneOf(spaceId: string): Promise<string> {
  const rows = await db().client.query<{ timezone: string }>(
    'select timezone from public.spaces where id = $1 limit 2', [spaceId],
  );
  return rows.rows[0]!.timezone;
}

/** `private.space_date` with a pinned instant: the testable core of the clock. */
async function spaceDateAt(spaceId: string, instant: string): Promise<string> {
  const rows = await db().client.query<{ at: string }>(
    'select private.space_date($1, $2::timestamptz)::text as at', [spaceId, instant],
  );
  return rows.rows[0]!.at;
}

async function serverUtcToday(): Promise<string> {
  const rows = await db().client.query<{ today: string }>(
    "select (now() at time zone 'UTC')::date::text as today",
  );
  return rows.rows[0]!.today;
}

describe('per-space timezone (W4a-1)', () => {
  it('defaults a new space to UTC', async () => {
    const id = await createSpace('Default zone');
    expect(await timezoneOf(id)).toBe('UTC');
  });

  it('rejects an unknown time zone name', async () => {
    const id = await createSpace('Bad zone');
    await expect(
      db().client.query("update public.spaces set timezone = 'Mars/Olympus' where id = $1", [id]),
    ).rejects.toMatchObject({ code: '23514' });
    expect(await timezoneOf(id)).toBe('UTC');
  });

  it('resolves the space-zone calendar date across the Beirut offset boundary', async () => {
    const beirut = await freshSpace('Beirut', 'Asia/Beirut');
    const utc = await freshSpace('UTC', 'UTC');

    // 2026-09-30 21:30 UTC is 2026-10-01 00:30 in Beirut: October locally,
    // still September in UTC. This is the audit's "Beirut 00:00-03:00" window.
    expect(await spaceDateAt(beirut, '2026-09-30T21:30:00Z')).toBe('2026-10-01');
    // One minute earlier is still 30 September in Beirut.
    expect(await spaceDateAt(beirut, '2026-09-30T20:59:00Z')).toBe('2026-09-30');
    // The same instant stays 30 September in a UTC space.
    expect(await spaceDateAt(utc, '2026-09-30T21:30:00Z')).toBe('2026-09-30');
  });

  it('exposes today and the current month on public.space_clock', async () => {
    const beirut = await freshSpace('Beirut clock', 'Asia/Beirut');
    const result = await withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query<{ clock: { timezone: string; today: string; currentMonth: string } }>(
        'select public.space_clock($1) as clock', [beirut],
      ));
    const clock = result.rows[0]!.clock;
    const expectedToday = await db().client
      .query<{ today: string }>("select (now() at time zone 'Asia/Beirut')::date::text as today")
      .then((rows) => rows.rows[0]!.today);
    expect(clock.timezone).toBe('Asia/Beirut');
    expect(clock.today).toBe(expectedToday);
    expect(clock.currentMonth).toBe(`${expectedToday.slice(0, 7)}-01`);
  });

  it('always disagrees across the widest zones and makes the cash read follow the space zone', async () => {
    // UTC+14 and UTC-12 are 26 hours apart, so their calendar dates can never
    // be equal -- a deterministic boundary fixture with no wall-clock dependence.
    const east = await freshSpace('Far east', 'Pacific/Kiritimati');
    const west = await freshSpace('Far west', 'Etc/GMT+12');
    const eastToday = await spaceDateAt(east, '2026-09-30T00:00:00Z');
    const westToday = await spaceDateAt(west, '2026-09-30T00:00:00Z');
    expect(eastToday > westToday).toBe(true);

    const utcToday = await serverUtcToday();
    const [eastNow, westNow] = await Promise.all([spaceTodayNow(east), spaceTodayNow(west)]);
    // At least one of the pair always differs from UTC today.
    const far = eastNow !== utcToday ? east : west;
    const farToday = far === east ? eastNow : westNow;
    expect(farToday).not.toBe(utcToday);

    // The old UTC guard rejected this client (the space-zone date is not UTC
    // today); the forward-fixed read accepts the space-zone date and refuses
    // the UTC one, exactly the disagreement E1 described.
    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query("select public.available_cash_summary($1, 'USD', $2::date)", [far, utcToday])))
      .rejects.toMatchObject({ code: '22023' });

    const summary = await withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query<{ summary: { state: string; asOf: string } }>(
        "select public.available_cash_summary($1, 'USD', $2::date) as summary", [far, farToday],
      ));
    expect(summary.rows[0]!.summary.state).toBe('unplanned');
    expect(summary.rows[0]!.summary.asOf).toBe(farToday);
  });

  it('denies the clock to outsiders and anon', async () => {
    const space = await freshSpace('Private', 'Asia/Beirut');
    await expect(withAuthenticatedTransaction(db().client, outsider, () =>
      db().client.query('select public.space_clock($1)', [space])))
      .rejects.toMatchObject({ code: '42501' });
    await expect(withAuthenticatedTransaction(db().client, outsider, () =>
      db().client.query('select public.space_today($1)', [space])))
      .rejects.toMatchObject({ code: '42501' });
    await db().client.query('begin');
    await db().client.query('set local role anon');
    await expect(db().client.query('select public.space_clock($1)', [space]))
      .rejects.toMatchObject({ code: '42501' });
    await db().client.query('rollback');
  });
});

async function spaceTodayNow(spaceId: string): Promise<string> {
  const rows = await db().client.query<{ today: string }>(
    'select private.space_today($1)::text as today', [spaceId],
  );
  return rows.rows[0]!.today;
}
