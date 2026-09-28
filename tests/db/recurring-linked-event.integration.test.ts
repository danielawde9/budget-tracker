import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction,
  type DisposableDatabase,
} from './disposable-database.js';

// Audit D7 (follow-up from W3A): the occurrence read must expose the wallet
// event a settlement actually linked (`occurrence_events.linked_event_id`),
// not just the occurrence-event head (`currentEventId`). Without it a match
// made earlier -- e.g. auto-settle on Record, or a Link from a previous visit
// -- cannot be unlinked from the bills screen, because the unlink mechanic
// reverses the linked wallet event and that id is never returned.
interface OccurrenceRow {
  id: string;
  currentEventId: string | null;
  linkedEventId?: string | null;
  state: string;
  [key: string]: unknown;
}

let database: DisposableDatabase | undefined;
const actor = randomUUID();
const outsider = randomUUID();

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_linkid');
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

async function freshSpace(name: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const space = await db().client.query<{ id: string }>(
      "select id from public.create_space($1, 'personal') limit 2", [name],
    );
    return space.rows[0]!.id;
  });
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

async function materialize(spaceId: string, fromDate: string, toDate: string): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () =>
    db().client.query('select public.materialize_schedule_occurrences($1,$2,$3,$4)',
      [spaceId, randomUUID(), fromDate, toDate]));
}

async function firstOccurrence(scheduleId: string): Promise<{ id: string; due_date: string }> {
  const result = await db().client.query<{ id: string; due_date: string }>(
    'select id, due_date::text from public.scheduled_occurrences where schedule_id = $1 order by due_date limit 1',
    [scheduleId],
  );
  return result.rows[0]!;
}

async function confirm(input: {
  spaceId: string; occurrenceId: string; expectedEventId: string | null; amountMinor: string;
  effectiveDate: string; walletId: string;
}): Promise<{ occurrenceId: string; occurrenceEventId: string; financialEventId: string }> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query('select public.confirm_scheduled_occurrence($1,$2,$3,$4,$5,$6,$7)',
      [input.spaceId, randomUUID(), input.occurrenceId, input.expectedEventId,
        input.amountMinor, input.effectiveDate, input.walletId]);
    return result.rows[0].confirm_scheduled_occurrence;
  });
}

async function postExpense(spaceId: string, walletId: string, amountMinor: string, effectiveDate = '2026-01-01'): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query(
      "select * from public.record_financial_event($1,$2,'expense',$3::date,$4::jsonb)",
      [spaceId, randomUUID(), effectiveDate, JSON.stringify([{ walletId, amountMinor }])],
    );
    return result.rows[0].id as string;
  });
}

async function linkExisting(input: {
  spaceId: string; occurrenceId: string; eventId: string; amountMinor: string; expectedEventId: string | null;
}): Promise<{ occurrenceId: string; occurrenceEventId: string; financialEventId: string }> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query('select public.link_scheduled_payment($1,$2,$3,$4,$5,$6)',
      [input.spaceId, randomUUID(), input.occurrenceId, input.eventId, input.amountMinor, input.expectedEventId]);
    return result.rows[0].link_scheduled_payment;
  });
}

async function reverseEvent(spaceId: string, eventId: string, effectiveDate: string): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () =>
    db().client.query('select * from public.reverse_financial_event($1,$2,$3,$4::date)',
      [spaceId, randomUUID(), eventId, effectiveDate]));
}

async function occurrencePage(spaceId: string, fromDate: string, toDate: string): Promise<OccurrenceRow[]> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query('select public.scheduled_occurrence_page($1,$2,$3,null,null,50)',
      [spaceId, fromDate, toDate]);
    return result.rows[0].scheduled_occurrence_page.rows as OccurrenceRow[];
  });
}

async function overduePage(spaceId: string): Promise<OccurrenceRow[]> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query('select public.scheduled_overdue_page($1,null,null,50)', [spaceId]);
    return result.rows[0].scheduled_overdue_page.rows as OccurrenceRow[];
  });
}

function rowById(rows: readonly OccurrenceRow[], id: string): OccurrenceRow {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`occurrence ${id} is not on the page`);
  return row;
}

describe('scheduled_occurrence_page linkedEventId', () => {
  it('is null for an occurrence with no settlement', async () => {
    const spaceId = await freshSpace('Linked id none');
    const schedule = await saveSchedule(spaceId);
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);

    const row = rowById(await occurrencePage(spaceId, '2026-01-01', '2026-01-31'), occurrence.id);
    expect(row).toHaveProperty('linkedEventId');
    expect(row.linkedEventId).toBeNull();
  });

  it('exposes the wallet event a confirm linked, so a Record/auto-settle match can be unlinked (D7)', async () => {
    const spaceId = await freshSpace('Linked id confirm');
    const walletId = await freshWallet(spaceId);
    await fundWallet(spaceId, walletId, '1000000');
    const schedule = await saveSchedule(spaceId, { expectedMinor: '50000' });
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);

    const confirmed = await confirm({
      spaceId, occurrenceId: occurrence.id, expectedEventId: null,
      amountMinor: '50000', effectiveDate: '2026-01-01', walletId,
    });

    const row = rowById(await occurrencePage(spaceId, '2026-01-01', '2026-01-31'), occurrence.id);
    // The occurrence-event head and the linked wallet event are different ids
    // (currentEventId is occurrence_events.id; linkedEventId is the wallet
    // financial_events.id): the whole point of D7 is that only the latter can
    // be reversed.
    expect(row.linkedEventId).toBe(confirmed.financialEventId);
    expect(row.currentEventId).not.toBe(confirmed.financialEventId);
  });

  it('exposes the wallet event an existing transaction was linked against', async () => {
    const spaceId = await freshSpace('Linked id link existing');
    const walletId = await freshWallet(spaceId);
    await fundWallet(spaceId, walletId, '1000000');
    const posted = await postExpense(spaceId, walletId, '-30000');
    const schedule = await saveSchedule(spaceId, { expectedMinor: '30000' });
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);

    const linked = await linkExisting({
      spaceId, occurrenceId: occurrence.id, eventId: posted, amountMinor: '30000', expectedEventId: null,
    });

    const row = rowById(await occurrencePage(spaceId, '2026-01-01', '2026-01-31'), occurrence.id);
    expect(row.linkedEventId).toBe(posted);
    expect(row.linkedEventId).toBe(linked.financialEventId);
  });

  it('reports the newest still-live link for a partially paid occurrence and drops links already reversed', async () => {
    const spaceId = await freshSpace('Linked id partial live');
    const walletId = await freshWallet(spaceId);
    await fundWallet(spaceId, walletId, '1000000');
    const schedule = await saveSchedule(spaceId, { expectedMinor: '50000' });
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);

    const first = await confirm({
      spaceId, occurrenceId: occurrence.id, expectedEventId: null,
      amountMinor: '20000', effectiveDate: '2026-01-01', walletId,
    });
    const second = await confirm({
      spaceId, occurrenceId: occurrence.id, expectedEventId: first.occurrenceEventId,
      amountMinor: '30000', effectiveDate: '2026-01-02', walletId,
    });

    let row = rowById(await occurrencePage(spaceId, '2026-01-01', '2026-01-31'), occurrence.id);
    expect(row.linkedEventId).toBe(second.financialEventId); // newest link

    // Unlinking reverses the newest link; the field must fall back to the
    // earlier, still-live payment rather than pointing at the now-reversed
    // event (which would leave a dead Unlink button).
    await reverseEvent(spaceId, second.financialEventId, '2026-01-03');
    row = rowById(await occurrencePage(spaceId, '2026-01-01', '2026-01-31'), occurrence.id);
    expect(row.linkedEventId).toBe(first.financialEventId);

    // Unlinking the last live payment leaves nothing to reverse.
    await reverseEvent(spaceId, first.financialEventId, '2026-01-04');
    row = rowById(await occurrencePage(spaceId, '2026-01-01', '2026-01-31'), occurrence.id);
    expect(row.linkedEventId).toBeNull();
    expect(row.state).toBe('pending');
  });
});

describe('scheduled_overdue_page linkedEventId', () => {
  it('exposes the same linked event id as the window page for an overdue occurrence', async () => {
    const spaceId = await freshSpace('Linked id overdue');
    const walletId = await freshWallet(spaceId);
    await fundWallet(spaceId, walletId, '1000000');
    // Due 2026-01-01, well before the server's UTC today.
    const schedule = await saveSchedule(spaceId, { expectedMinor: '50000', startsOn: '2026-01-01' });
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);

    const confirmed = await confirm({
      spaceId, occurrenceId: occurrence.id, expectedEventId: null,
      amountMinor: '20000', effectiveDate: '2026-01-01', walletId,
    });

    const overdue = rowById(await overduePage(spaceId), occurrence.id);
    expect(overdue.linkedEventId).toBe(confirmed.financialEventId);

    const window = rowById(await occurrencePage(spaceId, '2026-01-01', '2026-01-31'), occurrence.id);
    expect(overdue).toEqual(window); // one row shape, one set of values
  });
});
