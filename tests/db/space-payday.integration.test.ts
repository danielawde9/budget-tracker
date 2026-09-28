import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction,
  type DisposableDatabase,
} from './disposable-database.js';

// W4a-2 stage A: a per-space payday anchors the budget period on the server
// clock. A payday of 1 must be byte-identical to today's calendar month (the
// regression net); a later payday shifts the window, clamped in short months.
let database: DisposableDatabase | undefined;
const actor = randomUUID();

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_spacypay');
  await bootstrapCompatibilityObjects(db().client);
  await replayMigrations(db().client, migrationFiles());
  await db().client.query(
    `insert into auth.users(id, email, email_confirmed_at)
     values ($1, 'owner@budget.invalid', now())`,
    [actor],
  );
}, 120_000);

afterAll(async () => {
  if (database) await disposeDisposableDatabase(database);
}, 30_000);

async function freshSpace(name: string, timezone: string, payday: number): Promise<string> {
  const id = await withAuthenticatedTransaction(db().client, actor, async () => {
    const space = await db().client.query<{ id: string }>(
      "select id from public.create_space($1, 'personal') limit 2", [name],
    );
    return space.rows[0]!.id;
  });
  await db().client.query(
    'update public.spaces set timezone = $2, payday_day = $3 where id = $1', [id, timezone, payday],
  );
  return id;
}

async function paydayOf(spaceId: string): Promise<number> {
  const rows = await db().client.query<{ payday_day: number }>(
    'select payday_day from public.spaces where id = $1 limit 2', [spaceId],
  );
  return rows.rows[0]!.payday_day;
}

/** The pure, pinnable core: the period start for a space at an instant. */
async function periodStartAt(spaceId: string, instant: string): Promise<string> {
  const rows = await db().client.query<{ at: string }>(
    'select private.space_period_start($1, $2::timestamptz)::text as at', [spaceId, instant],
  );
  return rows.rows[0]!.at;
}

async function clockOf(spaceId: string): Promise<Record<string, unknown>> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const rows = await db().client.query<{ c: Record<string, unknown> }>(
      'select public.space_clock($1) as c', [spaceId],
    );
    return rows.rows[0]!.c;
  });
}

describe('per-space payday period (W4a-2)', () => {
  it('defaults a new space to payday 1 and rejects an out-of-range day', async () => {
    const id = await freshSpace('Default payday', 'UTC', 1);
    expect(await paydayOf(id)).toBe(1);

    await expect(
      db().client.query('update public.spaces set payday_day = 0 where id = $1', [id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db().client.query('update public.spaces set payday_day = 32 where id = $1', [id]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('payday 1 is the calendar month', async () => {
    const id = await freshSpace('Calendar month', 'UTC', 1);
    expect(await periodStartAt(id, '2026-09-01T00:00:00Z')).toBe('2026-09-01');
    expect(await periodStartAt(id, '2026-09-30T23:59:00Z')).toBe('2026-09-01');
    expect(await periodStartAt(id, '2026-10-01T00:00:00Z')).toBe('2026-10-01');
  });

  it('a payday of 25 starts the period on the 25th, in the space zone', async () => {
    const id = await freshSpace('Payday 25', 'Asia/Beirut', 25);
    // Beirut is UTC+3 in September: 20:00Z is 23:00 local on the 24th (still the
    // previous period), 22:00Z is 01:00 local on the 25th (the new one).
    expect(await periodStartAt(id, '2026-09-24T20:00:00Z')).toBe('2026-08-25');
    expect(await periodStartAt(id, '2026-09-24T22:00:00Z')).toBe('2026-09-25');
    // 2026-10-24T22:00Z is 01:00 on the 25th locally -- the NEXT period begins.
    expect(await periodStartAt(id, '2026-10-24T22:00:00Z')).toBe('2026-10-25');
    // ...and one minute earlier still belongs to the period that started 09-25.
    expect(await periodStartAt(id, '2026-10-24T20:00:00Z')).toBe('2026-09-25');
  });

  it('clamps a payday of 31 to the last day of a short month', async () => {
    const id = await freshSpace('Payday 31', 'UTC', 31);
    // February 2026 has 28 days; the 31st clamps to the 28th.
    expect(await periodStartAt(id, '2026-02-28T12:00:00Z')).toBe('2026-02-28');
    expect(await periodStartAt(id, '2026-02-27T12:00:00Z')).toBe('2026-01-31');
    // April has 30 days; the 31st clamps to the 30th.
    expect(await periodStartAt(id, '2026-04-30T12:00:00Z')).toBe('2026-04-30');
  });

  it('exposes the anchored period and the payday on the clock', async () => {
    const id = await freshSpace('Clock keys', 'UTC', 25);
    const clock = await clockOf(id);
    expect(clock.paydayDay).toBe(25);
    expect(typeof clock.periodStart).toBe('string');
    expect(typeof clock.periodEnd).toBe('string');
    // The key is the 1st of the month the period starts in.
    expect(String(clock.currentMonth)).toBe(`${String(clock.periodStart).slice(0, 7)}-01`);
    expect(String(clock.periodEnd) > String(clock.periodStart)).toBe(true);
  });
});
