import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction, withRollback, orderedAuthenticatedRace,
  type DisposableDatabase,
} from './disposable-database.js';

let database: DisposableDatabase | undefined;
const actor = randomUUID();
const outsider = randomUUID();

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_recurset');
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
      "select id from public.create_wallet($1,$2,$3) limit 2", [spaceId, 'Main', currency],
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

async function freshCategory(spaceId: string, kind: 'income' | 'expense', name: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const category = await db().client.query<{ id: string }>(
      'select id from public.create_category($1,$2,$3,$4,null) limit 2', [spaceId, randomUUID(), kind, name],
    );
    return category.rows[0]!.id;
  });
}

async function freshLoan(spaceId: string, walletId: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const loan = await db().client.query<{ loan_id: string }>(
      `select loan_id::text from public.record_cash_loan($1,$2,'i_owe_them','Lender','USD',$3,'200000','2026-01-01'::date)`,
      [spaceId, randomUUID(), walletId],
    );
    return loan.rows[0]!.loan_id;
  });
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

async function firstOccurrence(scheduleId: string): Promise<{ id: string; currency: string; due_date: string }> {
  const result = await db().client.query<{ id: string; currency: string; due_date: string }>(
    'select id, currency::text, due_date::text from public.scheduled_occurrences where schedule_id = $1 order by due_date limit 1',
    [scheduleId],
  );
  return result.rows[0]!;
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

async function currentEventId(occurrenceId: string): Promise<string | null> {
  const result = await db().client.query<{ id: string | null }>(
    'select max(id)::text as id from public.occurrence_events where occurrence_id = $1', [occurrenceId],
  );
  return result.rows[0]!.id;
}

async function settlement(occurrenceId: string, asOf = '2026-12-31'): Promise<{ settled_minor: string; skipped: boolean }> {
  const result = await db().client.query<{ settled_minor: string; skipped: boolean }>(
    'select settled_minor::text, skipped from private.schedule_occurrence_settlement($1,$2::date)', [occurrenceId, asOf],
  );
  return result.rows[0]!;
}

async function walletBalance(walletId: string): Promise<string> {
  const result = await db().client.query<{ amount_minor: string }>(
    'select amount_minor::text from public.wallet_balances where wallet_id = $1', [walletId],
  );
  return result.rows[0]?.amount_minor ?? '0';
}

function daysFromToday(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function financialDigest(client: DisposableDatabase['client'], spaceId: string): Promise<unknown> {
  const result = await client.query(
    `select 'events' as relation_name, count(*)::text as row_count,
      md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), '')) as digest
     from (select * from public.financial_events where space_id = $1 order by id limit 101) x
     union all
     select 'movements', count(*)::text,
       md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), ''))
     from (select * from public.wallet_movements where space_id = $1 order by id limit 101) x
     union all
     select 'loans', count(*)::text,
       md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.event_id), ''))
     from (select * from public.loan_postings where space_id = $1 order by event_id limit 101) x
     order by relation_name`,
    [spaceId],
  );
  return result.rows;
}

describe('set_occurrence_state', () => {
  it('skips a pending occurrence and reopens it', async () => {
    const spaceId = await freshSpace('Skip reopen');
    const schedule = await saveSchedule(spaceId);
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);

    const skipped = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query('select public.set_occurrence_state($1,$2,$3,$4,$5)',
        [spaceId, randomUUID(), occurrence.id, null, 'skip']);
      return result.rows[0].set_occurrence_state;
    });
    expect(skipped.occurrenceId).toBe(occurrence.id);
    let state = await settlement(occurrence.id);
    expect(state.skipped).toBe(true);

    const reopened = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query('select public.set_occurrence_state($1,$2,$3,$4,$5)',
        [spaceId, randomUUID(), occurrence.id, skipped.eventId, 'reopen']);
      return result.rows[0].set_occurrence_state;
    });
    expect(reopened.eventId).toEqual(expect.any(String));
    state = await settlement(occurrence.id);
    expect(state.skipped).toBe(false);
  });

  it('rejects skipping a partially paid occurrence', async () => {
    const spaceId = await freshSpace('Skip partial rejects');
    const walletId = await freshWallet(spaceId);
    await fundWallet(spaceId, walletId, '1000000');
    const schedule = await saveSchedule(spaceId, { expectedMinor: '50000' });
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);
    await confirm({ spaceId, occurrenceId: occurrence.id, expectedEventId: null, amountMinor: '20000', effectiveDate: '2026-01-01', walletId });
    const headEventId = await currentEventId(occurrence.id);

    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.set_occurrence_state($1,$2,$3,$4,$5)',
        [spaceId, randomUUID(), occurrence.id, headEventId, 'skip']),
    )).rejects.toMatchObject({ code: 'P0001' });
  });

  it('allows skipping after a fully reversed payment', async () => {
    const spaceId = await freshSpace('Skip after reversal');
    const walletId = await freshWallet(spaceId);
    await fundWallet(spaceId, walletId, '1000000');
    const schedule = await saveSchedule(spaceId, { expectedMinor: '50000' });
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);
    const confirmed = await confirm({ spaceId, occurrenceId: occurrence.id, expectedEventId: null, amountMinor: '50000', effectiveDate: '2026-01-01', walletId });

    await withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query("select * from public.reverse_financial_event($1,$2,$3,'2026-01-02'::date)",
        [spaceId, randomUUID(), confirmed.financialEventId]));

    const skipped = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query('select public.set_occurrence_state($1,$2,$3,$4,$5)',
        [spaceId, randomUUID(), occurrence.id, confirmed.occurrenceEventId, 'skip']);
      return result.rows[0].set_occurrence_state;
    });
    expect(skipped.occurrenceId).toBe(occurrence.id);
  });

  it('rejects a stale expected event id', async () => {
    const spaceId = await freshSpace('Skip stale head');
    const schedule = await saveSchedule(spaceId);
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);
    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.set_occurrence_state($1,$2,$3,$4,$5)',
        [spaceId, randomUUID(), occurrence.id, '999999', 'skip']),
    )).rejects.toMatchObject({ code: '40001' });
  });

  it('denies an outsider', async () => {
    const spaceId = await freshSpace('Skip outsider');
    const schedule = await saveSchedule(spaceId);
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);
    await expect(withAuthenticatedTransaction(db().client, outsider, () =>
      db().client.query('select public.set_occurrence_state($1,$2,$3,$4,$5)',
        [spaceId, randomUUID(), occurrence.id, null, 'skip']),
    )).rejects.toMatchObject({ code: '42501', message: 'planning_not_authorized' });
  });
});

describe('confirm_scheduled_occurrence', () => {
  it('confirms a partial payment then a second payment to full settlement', async () => {
    const spaceId = await freshSpace('Confirm partial then settle');
    const walletId = await freshWallet(spaceId);
    await fundWallet(spaceId, walletId, '1000000');
    const schedule = await saveSchedule(spaceId, { expectedMinor: '50000' });
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);

    const first = await confirm({ spaceId, occurrenceId: occurrence.id, expectedEventId: null, amountMinor: '20000', effectiveDate: '2026-01-01', walletId });
    let state = await settlement(occurrence.id);
    expect(state.settled_minor).toBe('20000');

    const second = await confirm({
      spaceId, occurrenceId: occurrence.id, expectedEventId: first.occurrenceEventId, amountMinor: '40000',
      effectiveDate: '2026-01-02', walletId,
    });
    state = await settlement(occurrence.id);
    expect(state.settled_minor).toBe('60000'); // allowed overpayment: settled can exceed expected

    // Reverse the second payment the next day; a prior-day snapshot must still read settled.
    await withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query("select * from public.reverse_financial_event($1,$2,$3,'2026-01-03'::date)",
        [spaceId, randomUUID(), second.financialEventId]));

    const afterReversalToday = await settlement(occurrence.id, '2026-12-31');
    expect(afterReversalToday.settled_minor).toBe('20000');

    const priorDaySnapshot = await settlement(occurrence.id, '2026-01-02');
    expect(priorDaySnapshot.settled_minor).toBe('60000'); // the reversal is effective 01-03, so 01-02 still reads settled
  });

  it('rejects a stale expected event id and posts nothing', async () => {
    const spaceId = await freshSpace('Confirm stale head');
    const walletId = await freshWallet(spaceId);
    await fundWallet(spaceId, walletId, '1000000');
    const schedule = await saveSchedule(spaceId, { expectedMinor: '50000' });
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);
    const before = await financialDigest(db().client, spaceId);
    await expect(confirm({
      spaceId, occurrenceId: occurrence.id, expectedEventId: '999999', amountMinor: '20000',
      effectiveDate: '2026-01-01', walletId,
    })).rejects.toMatchObject({ code: '40001' });
    const after = await financialDigest(db().client, spaceId);
    expect(after).toEqual(before);
  });

  it('the same request id retried after a timeout produces exactly one money event', async () => {
    const spaceId = await freshSpace('Confirm replay one event');
    const walletId = await freshWallet(spaceId);
    await fundWallet(spaceId, walletId, '1000000');
    const schedule = await saveSchedule(spaceId, { expectedMinor: '50000' });
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);
    const requestId = randomUUID();
    const first = await confirm({ spaceId, occurrenceId: occurrence.id, expectedEventId: null, amountMinor: '20000', effectiveDate: '2026-01-01', walletId, requestId });
    const second = await confirm({ spaceId, occurrenceId: occurrence.id, expectedEventId: null, amountMinor: '20000', effectiveDate: '2026-01-01', walletId, requestId });
    expect(second).toEqual(first);
    const events = await db().client.query("select count(*)::text as n from public.financial_events where space_id = $1 and kind <> 'opening_balance'", [spaceId]);
    expect(events.rows[0]!.n).toBe('1');
  });

  it('rejects confirming a skipped occurrence', async () => {
    const spaceId = await freshSpace('Confirm skipped rejects');
    const walletId = await freshWallet(spaceId);
    await fundWallet(spaceId, walletId, '1000000');
    const schedule = await saveSchedule(spaceId, { expectedMinor: '50000' });
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);
    await withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.set_occurrence_state($1,$2,$3,$4,$5)', [spaceId, randomUUID(), occurrence.id, null, 'skip']));
    await expect(confirm({
      spaceId, occurrenceId: occurrence.id, expectedEventId: await currentEventId(occurrence.id), amountMinor: '20000',
      effectiveDate: '2026-01-01', walletId,
    })).rejects.toMatchObject({ code: 'P0001' });
  });

  it('confirms a categorized expense using record_categorized_financial_event', async () => {
    const spaceId = await freshSpace('Confirm categorized');
    const walletId = await freshWallet(spaceId);
    await fundWallet(spaceId, walletId, '1000000');
    const categoryId = await freshCategory(spaceId, 'expense', 'Utilities');
    const schedule = await saveSchedule(spaceId, { expectedMinor: '30000', categoryId });
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);
    const confirmed = await confirm({ spaceId, occurrenceId: occurrence.id, expectedEventId: null, amountMinor: '30000', effectiveDate: '2026-01-01', walletId });
    const linked = await db().client.query(
      'select category_id::text from public.financial_event_categories where event_id = $1', [confirmed.financialEventId],
    );
    expect(linked.rows).toEqual([{ category_id: categoryId }]);
  });

  it('confirms a debt_payment occurrence using loan repayment accounting, not an ordinary expense', async () => {
    const spaceId = await freshSpace('Confirm debt payment');
    const walletId = await freshWallet(spaceId);
    await fundWallet(spaceId, walletId, '1000000');
    const loanId = await freshLoan(spaceId, walletId);
    const schedule = await saveSchedule(spaceId, { kind: 'debt_payment', expectedMinor: '50000', loanId });
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);
    const confirmed = await confirm({ spaceId, occurrenceId: occurrence.id, expectedEventId: null, amountMinor: '50000', effectiveDate: '2026-01-01', walletId });
    const event = await db().client.query<{ kind: string }>('select kind::text from public.financial_events where id = $1', [confirmed.financialEventId]);
    expect(event.rows[0]!.kind).toBe('loan_repay_borrowing');
    const posting = await db().client.query<{ principal_delta_minor: string }>(
      'select principal_delta_minor::text from public.loan_postings where event_id = $1', [confirmed.financialEventId],
    );
    expect(posting.rows[0]!.principal_delta_minor).toBe('-50000');
    const outstanding = await db().client.query<{ outstanding_minor: string }>(
      'select outstanding_minor::text from public.loan_balances where loan_id = $1', [loanId],
    );
    expect(outstanding.rows[0]!.outstanding_minor).toBe('150000'); // 200000 opened - 50000 repaid
  });

  it('goal-funded expense confirmation moves cash, earmark and fulfilled together and reversal restores them', async () => {
    const spaceId = await freshSpace('Confirm goal funded');
    const walletId = await freshWallet(spaceId);
    await fundWallet(spaceId, walletId, '1000000');

    const goalId = randomUUID();
    await db().client.query('insert into public.goals (id, space_id, currency, kind, actor_id) values ($1,$2,$3,$4,$5)',
      [goalId, spaceId, 'USD', 'purchase', actor]);
    await db().client.query(
      `insert into public.goal_revisions
         (goal_id, space_id, currency, expected_revision_id, name_en, target_minor, contribution_mode, monthly_minor,
          priority, state, milestone_count, request_id, actor_id)
       values ($1,$2,'USD',null,'New laptop',50000,'manual_monthly',10000,0,'active',0,$3,$4)`,
      [goalId, spaceId, randomUUID(), actor],
    );
    const earmarkHead = await db().client.query<{ head: string }>(
      "select head from private.goal_financing_state($1, (now() at time zone 'UTC')::date)", [goalId],
    );
    await withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.record_goal_earmark($1,$2,$3,$4,$5,$6,$7)',
        [spaceId, randomUUID(), goalId, 'reserve', '50000', earmarkHead.rows[0]!.head, true]));

    // The earmark reservation is dated "today" (record_goal_earmark has no
    // effective-date argument); the confirmation must not predate it, or
    // link_goal_purchase's own running-balance check would correctly see the
    // link happening before any funding existed and reject it.
    const today = daysFromToday(0);
    const tomorrow = daysFromToday(1);
    const farFuture = daysFromToday(365);
    const schedule = await saveSchedule(spaceId, { expectedMinor: '50000', fundingGoalId: goalId, startsOn: today });
    await materialize(spaceId, today, daysFromToday(30));
    const occurrence = await firstOccurrence(schedule.scheduleId);

    const walletBefore = await walletBalance(walletId);
    const confirmed = await confirm({ spaceId, occurrenceId: occurrence.id, expectedEventId: null, amountMinor: '50000', effectiveDate: today, walletId });
    const walletAfter = await walletBalance(walletId);
    expect(BigInt(walletBefore) - BigInt(walletAfter)).toBe(50000n);

    const financing = await db().client.query<{ earmarked_minor: string; fulfilled_minor: string }>(
      'select earmarked_minor::text, fulfilled_minor::text from private.goal_financing_state($1,$2::date)', [goalId, farFuture],
    );
    expect(financing.rows[0]).toEqual({ earmarked_minor: '0', fulfilled_minor: '50000' });

    const monthlyTargetsUnchanged = await db().client.query(
      'select count(*)::text as n from public.goal_monthly_target_revisions where goal_id = $1', [goalId],
    );
    expect(monthlyTargetsUnchanged.rows[0]!.n).toBe('0'); // confirm never touches monthly contribution history

    // Reverse the payment: cash and earmark restore, the bill is unpaid again.
    await withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select * from public.reverse_financial_event($1,$2,$3,$4::date)',
        [spaceId, randomUUID(), confirmed.financialEventId, tomorrow]));

    const walletRestored = await walletBalance(walletId);
    expect(walletRestored).toBe(walletBefore);
    const financingAfterReversal = await db().client.query<{ earmarked_minor: string; fulfilled_minor: string }>(
      'select earmarked_minor::text, fulfilled_minor::text from private.goal_financing_state($1,$2::date)', [goalId, farFuture],
    );
    expect(financingAfterReversal.rows[0]).toEqual({ earmarked_minor: '50000', fulfilled_minor: '0' });
    const stateAfterReversal = await settlement(occurrence.id, farFuture);
    expect(stateAfterReversal.settled_minor).toBe('0');
  });

  it('leaves a goal-funded bill paid but unfunded when the earmark is zero', async () => {
    const spaceId = await freshSpace('Confirm zero earmark unfunded');
    const walletId = await freshWallet(spaceId);
    await fundWallet(spaceId, walletId, '1000000');
    const goalId = randomUUID();
    await db().client.query('insert into public.goals (id, space_id, currency, kind, actor_id) values ($1,$2,$3,$4,$5)',
      [goalId, spaceId, 'USD', 'purchase', actor]);
    await db().client.query(
      `insert into public.goal_revisions
         (goal_id, space_id, currency, expected_revision_id, name_en, target_minor, contribution_mode, monthly_minor,
          priority, state, milestone_count, request_id, actor_id)
       values ($1,$2,'USD',null,'Unfunded goal',50000,'manual_monthly',0,0,'active',0,$3,$4)`,
      [goalId, spaceId, randomUUID(), actor],
    );
    const schedule = await saveSchedule(spaceId, { expectedMinor: '50000', fundingGoalId: goalId });
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);
    await confirm({ spaceId, occurrenceId: occurrence.id, expectedEventId: null, amountMinor: '50000', effectiveDate: '2026-01-01', walletId });

    const financing = await db().client.query<{ fulfilled_minor: string }>(
      "select fulfilled_minor::text from private.goal_financing_state($1,'2026-12-31'::date)", [goalId],
    );
    expect(financing.rows[0]!.fulfilled_minor).toBe('0'); // paid, but not goal-fulfilled

    const page = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query('select public.scheduled_occurrence_page($1,$2,$3,null,null,25)',
        [spaceId, '2026-01-01', '2026-01-31']);
      return result.rows[0].scheduled_occurrence_page;
    });
    const row = page.rows.find((r: { id: string }) => r.id === occurrence.id);
    expect(row.fundingShortfallMinor).toBe('50000');
  });

  it('two concurrent confirm commands with the same expected head yield exactly one success', async () => {
    const spaceId = await freshSpace('Confirm race same head');
    const walletId = await freshWallet(spaceId);
    await fundWallet(spaceId, walletId, '1000000');
    const schedule = await saveSchedule(spaceId, { expectedMinor: '50000' });
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);

    const outcome = await orderedAuthenticatedRace(
      db(), actor,
      (client) => client.query('select public.confirm_scheduled_occurrence($1,$2,$3,$4,$5,$6,$7)',
        [spaceId, randomUUID(), occurrence.id, null, '20000', '2026-01-01', walletId]),
      (client) => client.query('select public.confirm_scheduled_occurrence($1,$2,$3,$4,$5,$6,$7)',
        [spaceId, randomUUID(), occurrence.id, null, '25000', '2026-01-01', walletId]),
    );
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toMatchObject({ code: '40001' });
    }
    const events = await db().client.query("select count(*)::text as n from public.financial_events where space_id = $1 and kind <> 'opening_balance'", [spaceId]);
    expect(events.rows[0]!.n).toBe('1');
  });
});

describe('link_scheduled_payment', () => {
  it('rejects a second full link after the eligible amount is already spent, but a smaller remaining link passes', async () => {
    const spaceId = await freshSpace('Link double spend');
    const walletId = await freshWallet(spaceId);
    await fundWallet(spaceId, walletId, '1000000');
    const posted = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query(
        "select * from public.record_financial_event($1,$2,'expense','2026-01-01'::date,$3::jsonb)",
        [spaceId, randomUUID(), JSON.stringify([{ walletId, amountMinor: '-50000' }])],
      );
      return result.rows[0].id as string;
    });

    const scheduleA = await saveSchedule(spaceId, { expectedMinor: '30000', nameEn: 'Bill A' });
    const scheduleB = await saveSchedule(spaceId, { expectedMinor: '30000', nameEn: 'Bill B' });
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrenceA = await firstOccurrence(scheduleA.scheduleId);
    const occurrenceB = await firstOccurrence(scheduleB.scheduleId);

    await withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.link_scheduled_payment($1,$2,$3,$4,$5,$6)',
        [spaceId, randomUUID(), occurrenceA.id, posted, '30000', null]));

    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.link_scheduled_payment($1,$2,$3,$4,$5,$6)',
        [spaceId, randomUUID(), occurrenceB.id, posted, '30000', null]),
    )).rejects.toMatchObject({ code: 'P0001' });

    const linked = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query('select public.link_scheduled_payment($1,$2,$3,$4,$5,$6)',
        [spaceId, randomUUID(), occurrenceB.id, posted, '20000', null]);
      return result.rows[0].link_scheduled_payment;
    });
    expect(linked.financialEventId).toBe(posted);
  });

  it('rejects linking a skipped occurrence', async () => {
    const spaceId = await freshSpace('Link skipped rejects');
    const walletId = await freshWallet(spaceId);
    await fundWallet(spaceId, walletId, '1000000');
    const posted = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query(
        "select * from public.record_financial_event($1,$2,'expense','2026-01-01'::date,$3::jsonb)",
        [spaceId, randomUUID(), JSON.stringify([{ walletId, amountMinor: '-30000' }])],
      );
      return result.rows[0].id as string;
    });
    const schedule = await saveSchedule(spaceId, { expectedMinor: '30000' });
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);
    await withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.set_occurrence_state($1,$2,$3,$4,$5)', [spaceId, randomUUID(), occurrence.id, null, 'skip']));
    const headEventId = await currentEventId(occurrence.id);
    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.link_scheduled_payment($1,$2,$3,$4,$5,$6)',
        [spaceId, randomUUID(), occurrence.id, posted, '30000', headEventId]),
    )).rejects.toMatchObject({ code: 'P0001' });
  });

  it('reverse-first: a reversed event cannot receive a new link', async () => {
    const spaceId = await freshSpace('Link vs reverse: reverse first');
    const walletId = await freshWallet(spaceId);
    await fundWallet(spaceId, walletId, '1000000');
    const posted = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query(
        "select * from public.record_financial_event($1,$2,'expense','2026-01-01'::date,$3::jsonb)",
        [spaceId, randomUUID(), JSON.stringify([{ walletId, amountMinor: '-30000' }])],
      );
      return result.rows[0].id as string;
    });
    const schedule = await saveSchedule(spaceId, { expectedMinor: '30000' });
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);

    const outcome = await orderedAuthenticatedRace(
      db(), actor,
      (client) => client.query("select * from public.reverse_financial_event($1,$2,$3,'2026-01-02'::date)",
        [spaceId, randomUUID(), posted]),
      (client) => client.query('select public.link_scheduled_payment($1,$2,$3,$4,$5,$6)',
        [spaceId, randomUUID(), occurrence.id, posted, '30000', null]),
    );
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toMatchObject({ code: 'P0001' });
    }
  });

  it('link-first: a link commits, then a later reversal still succeeds and settlement nets back to zero', async () => {
    const spaceId = await freshSpace('Link vs reverse: link first');
    const walletId = await freshWallet(spaceId);
    await fundWallet(spaceId, walletId, '1000000');
    const posted = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query(
        "select * from public.record_financial_event($1,$2,'expense','2026-01-01'::date,$3::jsonb)",
        [spaceId, randomUUID(), JSON.stringify([{ walletId, amountMinor: '-30000' }])],
      );
      return result.rows[0].id as string;
    });
    const schedule = await saveSchedule(spaceId, { expectedMinor: '30000' });
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);

    const outcome = await orderedAuthenticatedRace(
      db(), actor,
      (client) => client.query('select public.link_scheduled_payment($1,$2,$3,$4,$5,$6)',
        [spaceId, randomUUID(), occurrence.id, posted, '30000', null]),
      (client) => client.query("select * from public.reverse_financial_event($1,$2,$3,'2026-01-02'::date)",
        [spaceId, randomUUID(), posted]),
    );
    expect(outcome.status).toBe('fulfilled');
    const finalState = await settlement(occurrence.id);
    expect(finalState.settled_minor).toBe('0');
  });

  it('denies an outsider', async () => {
    const spaceId = await freshSpace('Link outsider');
    const walletId = await freshWallet(spaceId);
    await fundWallet(spaceId, walletId, '1000000');
    const posted = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query(
        "select * from public.record_financial_event($1,$2,'expense','2026-01-01'::date,$3::jsonb)",
        [spaceId, randomUUID(), JSON.stringify([{ walletId, amountMinor: '-30000' }])],
      );
      return result.rows[0].id as string;
    });
    const schedule = await saveSchedule(spaceId, { expectedMinor: '30000' });
    await materialize(spaceId, '2026-01-01', '2026-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);
    await expect(withAuthenticatedTransaction(db().client, outsider, () =>
      db().client.query('select public.link_scheduled_payment($1,$2,$3,$4,$5,$6)',
        [spaceId, randomUUID(), occurrence.id, posted, '30000', null]),
    )).rejects.toMatchObject({ code: '42501', message: 'planning_not_authorized' });
  });
});

describe('scheduled_occurrence_page', () => {
  it('pages through occurrences with a stable (dueDate,id) cursor', async () => {
    const spaceId = await freshSpace('Page cursor');
    const schedule = await saveSchedule(spaceId, { cadence: 'weekly', intervalCount: 1, startsOn: '2026-01-01' });
    await materialize(spaceId, '2026-01-01', '2026-02-28');
    const full = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query('select public.scheduled_occurrence_page($1,$2,$3,null,null,50)',
        [spaceId, '2026-01-01', '2026-02-28']);
      return result.rows[0].scheduled_occurrence_page;
    });
    expect(full.rows.length).toBeGreaterThan(2);
    expect(full.hasMore).toBe(false);

    const firstPage = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query('select public.scheduled_occurrence_page($1,$2,$3,null,null,2)',
        [spaceId, '2026-01-01', '2026-02-28']);
      return result.rows[0].scheduled_occurrence_page;
    });
    expect(firstPage.rows).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();

    const secondPage = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query('select public.scheduled_occurrence_page($1,$2,$3,$4,$5,2)',
        [spaceId, '2026-01-01', '2026-02-28', firstPage.nextCursor.dueDate, firstPage.nextCursor.id]);
      return result.rows[0].scheduled_occurrence_page;
    });
    expect(secondPage.rows[0].id).toBe(full.rows[2].id);
    const combinedIds = [...firstPage.rows, ...secondPage.rows].map((r: { id: string }) => r.id);
    expect(combinedIds.slice(0, full.rows.length)).toEqual(full.rows.slice(0, combinedIds.length).map((r: { id: string }) => r.id));
  });

  it('rejects a range spanning more than 90 days', async () => {
    const spaceId = await freshSpace('Page range too wide');
    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.scheduled_occurrence_page($1,$2,$3,null,null,25)',
        [spaceId, '2026-01-01', '2026-06-01']),
    )).rejects.toMatchObject({ code: '22023' });
  });

  it('denies an outsider', async () => {
    const spaceId = await freshSpace('Page outsider');
    await expect(withAuthenticatedTransaction(db().client, outsider, () =>
      db().client.query('select public.scheduled_occurrence_page($1,$2,$3,null,null,25)',
        [spaceId, '2026-01-01', '2026-01-31']),
    )).rejects.toMatchObject({ code: '42501', message: 'planning_not_authorized' });
  });

  it('reports overdue only for a pending occurrence whose due date has passed', async () => {
    const spaceId = await freshSpace('Page overdue');
    const schedule = await saveSchedule(spaceId, { startsOn: '2020-01-01', expectedMinor: '10000' });
    await materialize(spaceId, '2020-01-01', '2020-01-31');
    const occurrence = await firstOccurrence(schedule.scheduleId);
    const page = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query('select public.scheduled_occurrence_page($1,$2,$3,null,null,25)',
        [spaceId, '2020-01-01', '2020-01-31']);
      return result.rows[0].scheduled_occurrence_page;
    });
    const row = page.rows.find((r: { id: string }) => r.id === occurrence.id);
    expect(row.overdue).toBe(true);
    expect(row.state).toBe('pending');
  });
});
