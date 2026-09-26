import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction,
  type DisposableDatabase,
} from './disposable-database.js';

interface OverdueRow {
  id: string;
  dueDate: string;
  state: string;
  overdue: boolean;
  remainingMinor: string;
  settledMinor: string;
  [key: string]: unknown;
}

interface OverdueCursor {
  dueDate: string;
  id: string;
}

interface OverduePage {
  rows: OverdueRow[];
  hasMore: boolean;
  nextCursor: OverdueCursor | null;
  asOf: string;
}

let database: DisposableDatabase | undefined;
const actor = randomUUID();
const outsider = randomUUID();
const member = randomUUID();

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_overdue');
  await bootstrapCompatibilityObjects(db().client);
  await replayMigrations(db().client, migrationFiles());
  await db().client.query(
    `insert into auth.users(id, email, email_confirmed_at)
     values ($1, 'owner@budget.invalid', now()), ($2, 'outsider@budget.invalid', now()),
       ($3, 'member@budget.invalid', now())`,
    [actor, outsider, member],
  );
}, 120_000);

afterAll(async () => {
  if (database) await disposeDisposableDatabase(database);
}, 30_000);

async function freshSpace(name: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const space = await db().client.query<{ id: string }>(
      "select id from public.create_space($1, 'household') limit 2", [name],
    );
    return space.rows[0]!.id;
  });
}

// Mirrors household-membership.integration.test.ts's addActiveMember, adapted
// to this file's disposable-database harness: a direct insert as the
// (table-owning, RLS-exempt) migration-replay client, status defaults 'active'.
async function addActiveMember(spaceId: string, userId: string, role: 'owner' | 'member' = 'member'): Promise<void> {
  await db().client.query(
    `insert into public.space_memberships (space_id, user_id, role)
     values ($1, $2, $3::public.member_role)`,
    [spaceId, userId, role],
  );
}

async function freshWallet(spaceId: string, currency: 'USD' | 'LBP' = 'USD'): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const wallet = await db().client.query<{ id: string }>(
      'select id from public.create_wallet($1,$2,$3) limit 2', [spaceId, 'Main', currency],
    );
    return wallet.rows[0]!.id;
  });
}

async function fundWallet(spaceId: string, walletId: string, amountMinor: string): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () =>
    db().client.query(
      "select * from public.record_financial_event($1,$2,'opening_balance','2026-01-01'::date,$3::jsonb)",
      [spaceId, randomUUID(), JSON.stringify([{ walletId, amountMinor }])],
    ));
}

function definition(overrides: Partial<{
  currency: string; kind: string; state: string; nameEn: string | null; nameAr: string | null;
  expectedMinor: string; startsOn: string; endsOn: string | null; cadence: string; intervalCount: number;
  categoryId: string | null; loanId: string | null; fundingGoalId: string | null; preferredWalletId: string | null;
}> = {}) {
  return {
    currency: 'USD', kind: 'expense', state: 'active', nameEn: 'Rent', nameAr: null,
    expectedMinor: '50000', startsOn: '2026-01-01', endsOn: null, cadence: 'monthly', intervalCount: 1,
    categoryId: null, loanId: null, fundingGoalId: null, preferredWalletId: null,
    ...overrides,
  };
}

async function saveSchedule(spaceId: string, overrides: Parameters<typeof definition>[0] = {}): Promise<{ scheduleId: string; revisionId: string }> {
  const scheduleId = randomUUID();
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query('select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
      [spaceId, randomUUID(), scheduleId, null, JSON.stringify(definition(overrides))]);
    return result.rows[0].save_schedule;
  });
}

async function materialize(spaceId: string, fromDate: string, toDate: string): Promise<{ createdCount: number; existingCount: number }> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query('select public.materialize_schedule_occurrences($1,$2,$3,$4)',
      [spaceId, randomUUID(), fromDate, toDate]);
    return result.rows[0].materialize_schedule_occurrences;
  });
}

async function occurrenceAt(scheduleId: string, dueDate: string): Promise<{ id: string; due_date: string }> {
  const result = await db().client.query<{ id: string; due_date: string }>(
    'select id, due_date::text from public.scheduled_occurrences where schedule_id = $1 and due_date = $2::date',
    [scheduleId, dueDate],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`no materialized occurrence due ${dueDate} for schedule ${scheduleId}`);
  return row;
}

async function confirm(input: {
  spaceId: string; occurrenceId: string; expectedEventId: string | null; amountMinor: string;
  effectiveDate: string; walletId: string; requestId?: string;
}): Promise<{ occurrenceId: string; occurrenceEventId: string; financialEventId: string }> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query('select public.confirm_scheduled_occurrence($1,$2,$3,$4,$5,$6,$7)',
      [input.spaceId, input.requestId ?? randomUUID(), input.occurrenceId, input.expectedEventId,
        input.amountMinor, input.effectiveDate, input.walletId]);
    return result.rows[0].confirm_scheduled_occurrence;
  });
}

async function skip(spaceId: string, occurrenceId: string): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () =>
    db().client.query('select public.set_occurrence_state($1,$2,$3,$4,$5)',
      [spaceId, randomUUID(), occurrenceId, null, 'skip']));
}

function daysFromToday(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function overduePage(
  spaceId: string,
  cursor: { dueDate: string | null; id: string | null } = { dueDate: null, id: null },
  limit = 50,
  user: string = actor,
): Promise<OverduePage> {
  return withAuthenticatedTransaction(db().client, user, async () => {
    const result = await db().client.query(
      'select public.scheduled_overdue_page($1,$2,$3,$4)',
      [spaceId, cursor.dueDate, cursor.id, limit],
    );
    return result.rows[0].scheduled_overdue_page;
  });
}

async function occurrencePageRow(
  spaceId: string, fromDate: string, toDate: string, occurrenceId: string,
): Promise<OverdueRow | undefined> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query('select public.scheduled_occurrence_page($1,$2,$3,null,null,50)',
      [spaceId, fromDate, toDate]);
    const page = result.rows[0].scheduled_occurrence_page as { rows: OverdueRow[] };
    return page.rows.find((row) => row.id === occurrenceId);
  });
}

describe('scheduled_overdue_page', () => {
  it('lists unpaid occurrences due before today, oldest first, in the scheduled_occurrence_page row shape', async () => {
    const spaceId = await freshSpace('Overdue page shape');
    const walletId = await freshWallet(spaceId);
    await fundWallet(spaceId, walletId, '10000000');

    const startsOn = daysFromToday(-28);
    const schedule = await saveSchedule(spaceId, {
      cadence: 'weekly', intervalCount: 1, startsOn, expectedMinor: '10000', nameEn: 'Weekly bill',
    });
    await materialize(spaceId, daysFromToday(-28), daysFromToday(7));

    const dueMinus28 = await occurrenceAt(schedule.scheduleId, daysFromToday(-28));
    const dueMinus21 = await occurrenceAt(schedule.scheduleId, daysFromToday(-21));
    const dueMinus14 = await occurrenceAt(schedule.scheduleId, daysFromToday(-14));
    const dueMinus7 = await occurrenceAt(schedule.scheduleId, daysFromToday(-7));
    const dueToday = await occurrenceAt(schedule.scheduleId, daysFromToday(0));
    const duePlus7 = await occurrenceAt(schedule.scheduleId, daysFromToday(7));

    // Fully settle -21, skip -14, partially settle -7. Leave -28, 0 and +7 pending.
    await confirm({
      spaceId, occurrenceId: dueMinus21.id, expectedEventId: null,
      amountMinor: '10000', effectiveDate: daysFromToday(-21), walletId,
    });
    await skip(spaceId, dueMinus14.id);
    await confirm({
      spaceId, occurrenceId: dueMinus7.id, expectedEventId: null,
      amountMinor: '4000', effectiveDate: daysFromToday(-7), walletId,
    });

    const page = await overduePage(spaceId);
    expect(page.rows.map((row) => row.id)).toEqual([dueMinus28.id, dueMinus7.id]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
    for (const row of page.rows) {
      expect(row.overdue).toBe(true);
    }

    const pendingRow = page.rows[0]!;
    expect(pendingRow.state).toBe('pending');
    expect(pendingRow.remainingMinor).toBe('10000');
    expect(pendingRow.settledMinor).toBe('0');

    const partialRow = page.rows[1]!;
    expect(partialRow.state).toBe('partial');
    expect(partialRow.remainingMinor).toBe('6000');
    expect(Number(partialRow.remainingMinor)).toBeGreaterThan(0);

    // Paid (-21) and skipped (-14) are absent; today (boundary: due_date < today
    // only) and +7 are absent even though they are still unpaid and pending.
    const returnedIds = page.rows.map((row) => row.id);
    expect(returnedIds).not.toContain(dueMinus21.id);
    expect(returnedIds).not.toContain(dueMinus14.id);
    expect(returnedIds).not.toContain(dueToday.id);
    expect(returnedIds).not.toContain(duePlus7.id);

    // Same row shape (and, since nothing but the query differs, the same
    // values) as scheduled_occurrence_page for the identical occurrence.
    const referenceRow = await occurrencePageRow(spaceId, daysFromToday(-28), daysFromToday(7), dueMinus28.id);
    expect(referenceRow).toBeDefined();
    expect(Object.keys(pendingRow).sort()).toEqual(Object.keys(referenceRow!).sort());
    expect(pendingRow).toEqual(referenceRow);

    // Paging: limit 1 returns the oldest row first with a cursor that resumes
    // at the next row; the second call drains the rest.
    const firstOfOne = await overduePage(spaceId, { dueDate: null, id: null }, 1);
    expect(firstOfOne.rows).toHaveLength(1);
    expect(firstOfOne.rows[0]!.id).toBe(dueMinus28.id);
    expect(firstOfOne.hasMore).toBe(true);
    expect(firstOfOne.nextCursor).toEqual({ dueDate: dueMinus28.due_date, id: dueMinus28.id });

    const secondOfOne = await overduePage(spaceId, firstOfOne.nextCursor!, 1);
    expect(secondOfOne.rows).toHaveLength(1);
    expect(secondOfOne.rows[0]!.id).toBe(dueMinus7.id);
    expect(secondOfOne.hasMore).toBe(false);
    expect(secondOfOne.nextCursor).toBeNull();

    // Validation: limit out of [1,100], and a half-set cursor.
    await expect(overduePage(spaceId, { dueDate: null, id: null }, 0))
      .rejects.toMatchObject({ code: '22023' });
    await expect(overduePage(spaceId, { dueDate: null, id: null }, 101))
      .rejects.toMatchObject({ code: '22023' });
    await expect(overduePage(spaceId, { dueDate: dueMinus28.due_date, id: null }, 50))
      .rejects.toMatchObject({ code: '22023' });
    await expect(overduePage(spaceId, { dueDate: null, id: dueMinus28.id }, 50))
      .rejects.toMatchObject({ code: '22023' });

    // Access: an active household member can read the page; an outsider cannot.
    await addActiveMember(spaceId, member, 'member');
    const memberPage = await overduePage(spaceId, { dueDate: null, id: null }, 50, member);
    expect(memberPage.rows.map((row) => row.id)).toEqual([dueMinus28.id, dueMinus7.id]);

    await expect(overduePage(spaceId, { dueDate: null, id: null }, 50, outsider))
      .rejects.toMatchObject({ code: '42501', message: 'planning_not_authorized' });
  });
});
