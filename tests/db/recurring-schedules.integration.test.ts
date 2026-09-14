import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction, withRollback, expectSavepointRejection,
  type DisposableDatabase,
} from './disposable-database.js';

const recurringSchemaVersion = '20260914170000';
const ownerId = '40000000-0000-4000-8000-000000000001';

let database: DisposableDatabase | undefined;
const actor = randomUUID();
const outsider = randomUUID();

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_recurdb');
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

async function freshWallet(spaceId: string, currency: 'USD' | 'LBP'): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const wallet = await db().client.query<{ id: string }>(
      "select id from public.create_wallet($1,$2,$3) limit 2", [spaceId, 'Main', currency],
    );
    return wallet.rows[0]!.id;
  });
}

async function freshCategory(spaceId: string, kind: 'income' | 'expense', name: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const category = await db().client.query<{ id: string }>(
      'select id from public.create_category($1,$2,$3,$4,null) limit 2', [spaceId, randomUUID(), kind, name],
    );
    return category.rows[0]!.id;
  });
}

async function freshLoan(spaceId: string, direction: 'they_owe_me' | 'i_owe_them', walletId: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const loan = await db().client.query<{ loan_id: string }>(
      `select loan_id::text from public.record_cash_loan($1,$2,$3,'Counterparty','USD',$4,'10000','2026-01-01'::date)`,
      [spaceId, randomUUID(), direction, walletId],
    );
    return loan.rows[0]!.loan_id;
  });
}

async function freshPurchaseGoal(spaceId: string, currency: 'USD' | 'LBP', state: 'active' | 'paused' | 'closed' = 'active'): Promise<string> {
  const goalId = randomUUID();
  await db().client.query('insert into public.goals (id, space_id, currency, kind, actor_id) values ($1,$2,$3,$4,$5)',
    [goalId, spaceId, currency, 'purchase', actor]);
  await db().client.query(
    `insert into public.goal_revisions
       (goal_id, space_id, currency, expected_revision_id, name_en, target_minor, contribution_mode, monthly_minor,
        priority, state, milestone_count, request_id, actor_id)
     values ($1,$2,$3,null,'Purchase goal',500000,'manual_monthly',0,0,$4,0,$5,$6)`,
    [goalId, spaceId, currency, state, randomUUID(), actor],
  );
  return goalId;
}

// SET CONSTRAINTS ALL IMMEDIATE checks now, but it also switches every
// deferrable constraint's MODE to immediate for the rest of the transaction;
// re-defer immediately after so later inserts in the same block stay deferred.
async function forceDeferred(): Promise<void> {
  await db().client.query('set constraints all immediate');
  await db().client.query('set constraints all deferred');
}

function definition(overrides: Partial<{
  currency: string; kind: string; state: string; nameEn: string | null; nameAr: string | null;
  expectedMinor: string; startsOn: string; endsOn: string | null; cadence: string; intervalCount: number;
  categoryId: string | null; loanId: string | null; fundingGoalId: string | null; preferredWalletId: string | null;
}> = {}) {
  return {
    currency: 'USD', kind: 'expense', state: 'active', nameEn: 'Rent', nameAr: null,
    expectedMinor: '50000', startsOn: '2026-01-31', endsOn: null, cadence: 'monthly', intervalCount: 1,
    categoryId: null, loanId: null, fundingGoalId: null, preferredWalletId: null,
    ...overrides,
  };
}

async function saveSchedule(input: {
  spaceId: string; scheduleId?: string; expectedRevisionId?: string | null; definition?: ReturnType<typeof definition>;
}): Promise<{ scheduleId: string; revisionId: string }> {
  const scheduleId = input.scheduleId ?? randomUUID();
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ save_schedule: { scheduleId: string; revisionId: string } }>(
      'select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
      [input.spaceId, randomUUID(), scheduleId, input.expectedRevisionId ?? null, JSON.stringify(input.definition ?? definition())],
    );
    return result.rows[0]!.save_schedule;
  });
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
  expect(result.rows.every((row: { row_count: string }) => Number(row.row_count) <= 100)).toBe(true);
  return result.rows;
}

describe('recurring schedule schema migration replay and upgrade', () => {
  it('replays the complete journal into an empty database', async () => {
    const database2 = await createDisposableDatabase('budget_recurmig');
    try {
      await bootstrapCompatibilityObjects(database2.client);
      await replayMigrations(database2.client, migrationFiles());
      const tables = await database2.client.query<{ table_name: string }>(
        `select table_name from information_schema.tables
         where table_schema = 'public' and table_name in
           ('schedules','schedule_revisions','scheduled_occurrences','occurrence_events')
         order by table_name`,
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual(
        ['occurrence_events', 'schedule_revisions', 'scheduled_occurrences', 'schedules'],
      );
    } finally {
      await disposeDisposableDatabase(database2);
    }
  }, 120_000);

  it('upgrades seeded journal history (space, wallet, goal, loan, financial event) before adding the recurring schema', async () => {
    const migrations = migrationFiles();
    const recurringMigration = migrations.find((migration) => migration.version === recurringSchemaVersion);
    const priorMigrations = migrations.filter((migration) => migration.version < recurringSchemaVersion);
    expect(recurringMigration).toBeDefined();

    const database2 = await createDisposableDatabase('budget_recurupgrade');
    try {
      await bootstrapCompatibilityObjects(database2.client);
      await replayMigrations(database2.client, priorMigrations);
      await database2.client.query(
        `insert into auth.users (id, email, email_confirmed_at) values ($1, 'recur-upgrade@budget.invalid', now())`,
        [ownerId],
      );

      let spaceId = '';
      let walletId = '';
      await withAuthenticatedTransaction(database2.client, ownerId, async () => {
        const space = await database2.client.query<{ id: string }>(
          "select id from public.create_space($1, 'personal') limit 2", ['Recurring upgrade fixture'],
        );
        spaceId = space.rows[0]!.id;
        const wallet = await database2.client.query<{ id: string }>(
          "select id from public.create_wallet($1,$2,$3) limit 2", [spaceId, 'Main', 'USD'],
        );
        walletId = wallet.rows[0]!.id;
        await database2.client.query(
          "select * from public.record_financial_event($1,$2,'opening_balance','2026-01-01'::date,$3::jsonb)",
          [spaceId, randomUUID(), JSON.stringify([{ walletId, amountMinor: '500000' }])],
        );
      });

      const before = await financialDigest(database2.client, spaceId);
      await replayMigrations(database2.client, [recurringMigration!]);
      const after = await financialDigest(database2.client, spaceId);
      expect(after).toEqual(before);

      // The new tables exist and accept a valid owner-seeded row (no public
      // command has run against the fresh schema yet in this fixture).
      await withRollback(database2.client, async () => {
        const scheduleId = randomUUID();
        await database2.client.query(
          'insert into public.schedules (id, space_id, currency, kind, actor_id) values ($1,$2,$3,$4,$5)',
          [scheduleId, spaceId, 'USD', 'expense', ownerId],
        );
        const readBack = await database2.client.query('select id from public.schedules where id = $1', [scheduleId]);
        expect(readBack.rows).toEqual([{ id: scheduleId }]);
      });

      // Pre-existing wallet reads still work unchanged.
      await withAuthenticatedTransaction(database2.client, ownerId, async () => {
        const balance = await database2.client.query<{ amount_minor: string }>(
          'select amount_minor::text from public.wallet_balances where wallet_id = $1', [walletId],
        );
        expect(balance.rows).toEqual([{ amount_minor: '500000' }]);
      });
    } finally {
      await disposeDisposableDatabase(database2);
    }
  }, 120_000);
});

describe('save_schedule', () => {
  it('creates an expense schedule and returns a fresh revision', async () => {
    const spaceId = await freshSpace('Save schedule create');
    const created = await saveSchedule({ spaceId });
    expect(created.scheduleId).toEqual(expect.any(String));
    const row = await db().client.query('select kind, currency::text from public.schedules where id = $1', [created.scheduleId]);
    expect(row.rows).toEqual([{ kind: 'expense', currency: 'USD' }]);
  });

  it('edits an existing schedule using the current head and preserves kind/currency', async () => {
    const spaceId = await freshSpace('Save schedule edit');
    const created = await saveSchedule({ spaceId });
    const edited = await saveSchedule({
      spaceId, scheduleId: created.scheduleId, expectedRevisionId: created.revisionId,
      definition: definition({ expectedMinor: '60000' }),
    });
    expect(edited.scheduleId).toBe(created.scheduleId);
    expect(Number(edited.revisionId)).toBeGreaterThan(Number(created.revisionId));
  });

  it('replays an identical request and returns the same result', async () => {
    const spaceId = await freshSpace('Save schedule replay');
    const scheduleId = randomUUID();
    const requestId = randomUUID();
    const body = definition();
    const first = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query('select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
        [spaceId, requestId, scheduleId, null, JSON.stringify(body)]);
      return result.rows[0].save_schedule;
    });
    const second = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query('select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
        [spaceId, requestId, scheduleId, null, JSON.stringify(body)]);
      return result.rows[0].save_schedule;
    });
    expect(second).toEqual(first);
  });

  it('rejects a request UUID reused with a different payload', async () => {
    const spaceId = await freshSpace('Save schedule idempotency conflict payload');
    const scheduleId = randomUUID();
    const requestId = randomUUID();
    await withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
        [spaceId, requestId, scheduleId, null, JSON.stringify(definition())]));
    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
        [spaceId, requestId, randomUUID(), null, JSON.stringify(definition({ expectedMinor: '99999' }))]),
    )).rejects.toMatchObject({ code: 'P0001', message: 'planning_idempotency_conflict' });
  });

  it('rejects a request UUID reused by a different actor in the same space, without disclosing the original result', async () => {
    // A 'personal' space enforces exactly one member; use 'household' so a
    // second real, active member can be added directly (bypassing the
    // invitation flow, which is not what this test is about).
    const spaceId = await withAuthenticatedTransaction(db().client, actor, async () => {
      const space = await db().client.query<{ id: string }>(
        "select id from public.create_space($1, 'household') limit 2", ['Save schedule idempotency conflict actor'],
      );
      return space.rows[0]!.id;
    });
    const secondMember = randomUUID();
    await db().client.query(
      `insert into auth.users(id, email, email_confirmed_at) values ($1, 'second-member@budget.invalid', now())`,
      [secondMember],
    );
    await db().client.query(
      "insert into public.space_memberships(space_id, user_id, role) values ($1,$2,'member'::public.member_role)",
      [spaceId, secondMember],
    );
    const scheduleId = randomUUID();
    const requestId = randomUUID();
    await withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
        [spaceId, requestId, scheduleId, null, JSON.stringify(definition())]));
    await expect(withAuthenticatedTransaction(db().client, secondMember, () =>
      db().client.query('select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
        [spaceId, requestId, randomUUID(), null, JSON.stringify(definition())]),
    )).rejects.toMatchObject({ code: 'P0001', message: 'planning_idempotency_conflict' });
  });

  it('denies an outsider', async () => {
    const spaceId = await freshSpace('Save schedule outsider');
    await expect(withAuthenticatedTransaction(db().client, outsider, () =>
      db().client.query('select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
        [spaceId, randomUUID(), randomUUID(), null, JSON.stringify(definition())]),
    )).rejects.toMatchObject({ code: '42501', message: 'planning_not_authorized' });
  });

  it('rejects a stale expected revision id', async () => {
    const spaceId = await freshSpace('Save schedule stale');
    const created = await saveSchedule({ spaceId });
    await expect(saveSchedule({
      spaceId, scheduleId: created.scheduleId, expectedRevisionId: '999999', definition: definition({ expectedMinor: '70000' }),
    })).rejects.toMatchObject({ code: '40001' });
  });

  it('rejects changing kind on edit', async () => {
    const spaceId = await freshSpace('Save schedule kind change');
    const created = await saveSchedule({ spaceId });
    await expect(saveSchedule({
      spaceId, scheduleId: created.scheduleId, expectedRevisionId: created.revisionId, definition: definition({ kind: 'income' }),
    })).rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects changing currency on edit', async () => {
    const spaceId = await freshSpace('Save schedule currency change');
    const created = await saveSchedule({ spaceId });
    await expect(saveSchedule({
      spaceId, scheduleId: created.scheduleId, expectedRevisionId: created.revisionId, definition: definition({ currency: 'LBP' }),
    })).rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects an unknown definition key', async () => {
    const spaceId = await freshSpace('Save schedule unknown key');
    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
        [spaceId, randomUUID(), randomUUID(), null, JSON.stringify({ ...definition(), extra: true })]),
    )).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects both names blank', async () => {
    const spaceId = await freshSpace('Save schedule blank names');
    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
        [spaceId, randomUUID(), randomUUID(), null, JSON.stringify(definition({ nameEn: null, nameAr: null }))]),
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects a zero expected amount', async () => {
    const spaceId = await freshSpace('Save schedule zero amount');
    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
        [spaceId, randomUUID(), randomUUID(), null, JSON.stringify(definition({ expectedMinor: '0' }))]),
    )).rejects.toMatchObject({ code: '22023' });
  });

  it('rejects a malformed startsOn date instead of a raw cast error', async () => {
    const spaceId = await freshSpace('Save schedule bad date');
    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
        [spaceId, randomUUID(), randomUUID(), null, JSON.stringify(definition({ startsOn: 'not-a-date' }))]),
    )).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects an endsOn before startsOn (schema invariant)', async () => {
    const spaceId = await freshSpace('Save schedule ends before starts');
    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
        [spaceId, randomUUID(), randomUUID(), null, JSON.stringify(definition({ startsOn: '2026-03-01', endsOn: '2026-01-01' }))]),
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects an out-of-range interval count', async () => {
    const spaceId = await freshSpace('Save schedule bad interval');
    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
        [spaceId, randomUUID(), randomUUID(), null, JSON.stringify(definition({ intervalCount: 13 }))]),
    )).rejects.toMatchObject({ code: '22023' });
  });

  it('rejects an invalid cadence', async () => {
    const spaceId = await freshSpace('Save schedule bad cadence');
    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
        [spaceId, randomUUID(), randomUUID(), null, JSON.stringify(definition({ cadence: 'daily' }))]),
    )).rejects.toMatchObject({ code: '22023' });
  });

  it('rejects a label that defaults to the actor\'s own email', async () => {
    const spaceId = await freshSpace('Save schedule email label');
    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
        [spaceId, randomUUID(), randomUUID(), null, JSON.stringify(definition({ nameEn: 'owner@budget.invalid' }))]),
    )).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects the 201st active schedule for a space', async () => {
    const spaceId = await freshSpace('Save schedule cap');
    await db().client.query(
      `with seeded as (
         insert into public.schedules (id, space_id, currency, kind, actor_id)
         select gen_random_uuid(), $1, 'USD', 'income', $2 from generate_series(1,200)
         returning id, space_id, currency
       )
       insert into public.schedule_revisions (
         schedule_id, space_id, currency, expected_revision_id, state, name_en, expected_minor,
         starts_on, cadence, interval_count, request_id, actor_id
       )
       select id, space_id, currency, null, 'active', 'Cap fixture', 1000, '2026-01-01', 'monthly', 1, gen_random_uuid(), $2
       from seeded`,
      [spaceId, actor],
    );
    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
        [spaceId, randomUUID(), randomUUID(), null, JSON.stringify(definition({ kind: 'income', categoryId: null }))]),
    )).rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects reactivating a paused schedule once the space already has 200 active schedules (the cap bounds every transition into active, not just creation)', async () => {
    const spaceId = await freshSpace('Save schedule cap reactivation');
    await db().client.query(
      `with seeded as (
         insert into public.schedules (id, space_id, currency, kind, actor_id)
         select gen_random_uuid(), $1, 'USD', 'income', $2 from generate_series(1,200)
         returning id, space_id, currency
       )
       insert into public.schedule_revisions (
         schedule_id, space_id, currency, expected_revision_id, state, name_en, expected_minor,
         starts_on, cadence, interval_count, request_id, actor_id
       )
       select id, space_id, currency, null, 'active', 'Cap fixture', 1000, '2026-01-01', 'monthly', 1, gen_random_uuid(), $2
       from seeded`,
      [spaceId, actor],
    );
    // Created paused -- the cap does not apply to creation here, so this
    // must succeed even though the space already has 200 active schedules.
    const paused = await saveSchedule({ spaceId, definition: definition({ state: 'paused' }) });
    // Flipping it to active must now be bounded by the same 200 cap.
    await expect(saveSchedule({
      spaceId, scheduleId: paused.scheduleId, expectedRevisionId: paused.revisionId,
      definition: definition({ state: 'active' }),
    })).rejects.toMatchObject({ code: 'P0001' });
  });

  it('never changes the financial journal', async () => {
    const spaceId = await freshSpace('Save schedule digest');
    const before = await financialDigest(db().client, spaceId);
    await saveSchedule({ spaceId });
    const after = await financialDigest(db().client, spaceId);
    expect(after).toEqual(before);
  });

  describe('deferred kind-specific reference validation', () => {
    it('rejects an expense schedule carrying a loan reference', async () => {
      const spaceId = await freshSpace('Deferred expense loan');
      const walletId = await freshWallet(spaceId, 'USD');
      const loanId = await freshLoan(spaceId, 'i_owe_them', walletId);
      await withRollback(db().client, async () => {
        const scheduleId = randomUUID();
        await db().client.query('insert into public.schedules (id, space_id, currency, kind, actor_id) values ($1,$2,$3,$4,$5)',
          [scheduleId, spaceId, 'USD', 'expense', actor]);
        await db().client.query(
          `insert into public.schedule_revisions
             (schedule_id, space_id, currency, expected_revision_id, state, name_en, expected_minor,
              starts_on, cadence, interval_count, loan_id, request_id, actor_id)
           values ($1,$2,'USD',null,'active','Rent',50000,'2026-01-01','monthly',1,$3,$4,$5)`,
          [scheduleId, spaceId, loanId, randomUUID(), actor],
        );
        await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'schedule_loan_must_be_null_for_expense' });
      });
    });

    it('rejects an income schedule carrying an expense-kind category', async () => {
      const spaceId = await freshSpace('Deferred income category kind');
      const categoryId = await freshCategory(spaceId, 'expense', 'Bills');
      await withRollback(db().client, async () => {
        const scheduleId = randomUUID();
        await db().client.query('insert into public.schedules (id, space_id, currency, kind, actor_id) values ($1,$2,$3,$4,$5)',
          [scheduleId, spaceId, 'USD', 'income', actor]);
        await db().client.query(
          `insert into public.schedule_revisions
             (schedule_id, space_id, currency, expected_revision_id, state, name_en, expected_minor,
              starts_on, cadence, interval_count, category_id, request_id, actor_id)
           values ($1,$2,'USD',null,'active','Salary',50000,'2026-01-01','monthly',1,$3,$4,$5)`,
          [scheduleId, spaceId, categoryId, randomUUID(), actor],
        );
        await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'schedule_category_kind_mismatch' });
      });
    });

    it('rejects a debt_payment schedule with no loan reference', async () => {
      const spaceId = await freshSpace('Deferred debt no loan');
      await withRollback(db().client, async () => {
        const scheduleId = randomUUID();
        await db().client.query('insert into public.schedules (id, space_id, currency, kind, actor_id) values ($1,$2,$3,$4,$5)',
          [scheduleId, spaceId, 'USD', 'debt_payment', actor]);
        await db().client.query(
          `insert into public.schedule_revisions
             (schedule_id, space_id, currency, expected_revision_id, state, name_en, expected_minor,
              starts_on, cadence, interval_count, request_id, actor_id)
           values ($1,$2,'USD',null,'active','Loan payment',50000,'2026-01-01','monthly',1,$3,$4)`,
          [scheduleId, spaceId, randomUUID(), actor],
        );
        await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'schedule_loan_required_for_debt_payment' });
      });
    });

    it('rejects a debt_payment schedule referencing a they_owe_me loan', async () => {
      const spaceId = await freshSpace('Deferred debt wrong direction');
      const walletId = await freshWallet(spaceId, 'USD');
      const loanId = await freshLoan(spaceId, 'they_owe_me', walletId);
      await withRollback(db().client, async () => {
        const scheduleId = randomUUID();
        await db().client.query('insert into public.schedules (id, space_id, currency, kind, actor_id) values ($1,$2,$3,$4,$5)',
          [scheduleId, spaceId, 'USD', 'debt_payment', actor]);
        await db().client.query(
          `insert into public.schedule_revisions
             (schedule_id, space_id, currency, expected_revision_id, state, name_en, expected_minor,
              starts_on, cadence, interval_count, loan_id, request_id, actor_id)
           values ($1,$2,'USD',null,'active','Loan payment',50000,'2026-01-01','monthly',1,$3,$4,$5)`,
          [scheduleId, spaceId, loanId, randomUUID(), actor],
        );
        await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'schedule_loan_invalid' });
      });
    });

    it('rejects a funding goal that is not an active purchase goal', async () => {
      const spaceId = await freshSpace('Deferred funding goal invalid');
      await withRollback(db().client, async () => {
        const goalId = randomUUID();
        await db().client.query('insert into public.goals (id, space_id, currency, kind, actor_id) values ($1,$2,$3,$4,$5)',
          [goalId, spaceId, 'USD', 'reserve', actor]);
        await db().client.query(
          `insert into public.goal_revisions
             (goal_id, space_id, currency, expected_revision_id, name_en, target_minor, contribution_mode, monthly_minor,
              priority, state, milestone_count, request_id, actor_id)
           values ($1,$2,'USD',null,'Reserve goal',500000,'manual_monthly',0,0,'active',0,$3,$4)`,
          [goalId, spaceId, randomUUID(), actor],
        );
        const scheduleId = randomUUID();
        await db().client.query('insert into public.schedules (id, space_id, currency, kind, actor_id) values ($1,$2,$3,$4,$5)',
          [scheduleId, spaceId, 'USD', 'expense', actor]);
        await db().client.query(
          `insert into public.schedule_revisions
             (schedule_id, space_id, currency, expected_revision_id, state, name_en, expected_minor,
              starts_on, cadence, interval_count, funding_goal_id, request_id, actor_id)
           values ($1,$2,'USD',null,'active','Rent',50000,'2026-01-01','monthly',1,$3,$4,$5)`,
          [scheduleId, spaceId, goalId, randomUUID(), actor],
        );
        await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'schedule_funding_goal_invalid' });
      });
    });

    it('rejects a preferred wallet in a different currency', async () => {
      const spaceId = await freshSpace('Deferred wallet currency');
      const walletId = await freshWallet(spaceId, 'LBP');
      await withRollback(db().client, async () => {
        const scheduleId = randomUUID();
        await db().client.query('insert into public.schedules (id, space_id, currency, kind, actor_id) values ($1,$2,$3,$4,$5)',
          [scheduleId, spaceId, 'USD', 'expense', actor]);
        await db().client.query(
          `insert into public.schedule_revisions
             (schedule_id, space_id, currency, expected_revision_id, state, name_en, expected_minor,
              starts_on, cadence, interval_count, preferred_wallet_id, request_id, actor_id)
           values ($1,$2,'USD',null,'active','Rent',50000,'2026-01-01','monthly',1,$3,$4,$5)`,
          [scheduleId, spaceId, walletId, randomUUID(), actor],
        );
        await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'schedule_wallet_invalid' });
      });
    });

    it('rejects a second initial (predecessor-null) revision for the same schedule', async () => {
      const spaceId = await freshSpace('Deferred duplicate initial revision');
      await withRollback(db().client, async () => {
        const scheduleId = randomUUID();
        await db().client.query('insert into public.schedules (id, space_id, currency, kind, actor_id) values ($1,$2,$3,$4,$5)',
          [scheduleId, spaceId, 'USD', 'income', actor]);
        await db().client.query(
          `insert into public.schedule_revisions
             (schedule_id, space_id, currency, expected_revision_id, state, name_en, expected_minor,
              starts_on, cadence, interval_count, request_id, actor_id)
           values ($1,$2,'USD',null,'active','Salary',50000,'2026-01-01','monthly',1,$3,$4)`,
          [scheduleId, spaceId, randomUUID(), actor],
        );
        await expectSavepointRejection(db().client, () =>
          db().client.query(
            `insert into public.schedule_revisions
               (schedule_id, space_id, currency, expected_revision_id, state, name_en, expected_minor,
                starts_on, cadence, interval_count, request_id, actor_id)
             values ($1,$2,'USD',null,'active','Salary v2',60000,'2026-01-01','monthly',1,$3,$4)`,
            [scheduleId, spaceId, randomUUID(), actor],
          ), { code: '23505' });
      });
    });
  });
});

describe('materialize_schedule_occurrences', () => {
  it('materializing Jan31 monthly twice over 90 days creates one row per due date with stable ids', async () => {
    const spaceId = await freshSpace('Materialize jan31');
    const created = await saveSchedule({
      spaceId, definition: definition({ startsOn: '2026-01-31', cadence: 'monthly', intervalCount: 1 }),
    });
    const first = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query('select public.materialize_schedule_occurrences($1,$2,$3,$4)',
        [spaceId, randomUUID(), '2026-01-01', '2026-04-01']);
      return result.rows[0].materialize_schedule_occurrences;
    });
    expect(first.createdCount).toBe(3); // Jan31, Feb28, Mar31
    const rows1 = await db().client.query<{ id: string; due_date: string }>(
      "select id, due_date::text from public.scheduled_occurrences where schedule_id = $1 order by due_date", [created.scheduleId],
    );
    expect(rows1.rows.map((r) => r.due_date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);

    const second = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query('select public.materialize_schedule_occurrences($1,$2,$3,$4)',
        [spaceId, randomUUID(), '2026-01-01', '2026-04-01']);
      return result.rows[0].materialize_schedule_occurrences;
    });
    expect(second.createdCount).toBe(0);
    expect(second.existingCount).toBe(3);
    const rows2 = await db().client.query<{ id: string; due_date: string }>(
      "select id, due_date::text from public.scheduled_occurrences where schedule_id = $1 order by due_date", [created.scheduleId],
    );
    expect(rows2.rows).toEqual(rows1.rows);
  });

  it('a schedule edit retains an already-materialized occurrence and applies a new amount only to future dates', async () => {
    const spaceId = await freshSpace('Materialize edit');
    const created = await saveSchedule({
      spaceId, definition: definition({ startsOn: '2026-01-01', cadence: 'monthly', intervalCount: 1, expectedMinor: '50000' }),
    });
    await withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.materialize_schedule_occurrences($1,$2,$3,$4)',
        [spaceId, randomUUID(), '2026-01-01', '2026-01-31']));
    const before = await db().client.query<{ expected_minor: string }>(
      "select expected_minor::text from public.scheduled_occurrences where schedule_id = $1 and due_date = '2026-01-01'", [created.scheduleId],
    );
    expect(before.rows[0]!.expected_minor).toBe('50000');

    const edited = await saveSchedule({
      spaceId, scheduleId: created.scheduleId, expectedRevisionId: created.revisionId,
      definition: definition({ startsOn: '2026-01-01', cadence: 'monthly', intervalCount: 1, expectedMinor: '60000' }),
    });

    // Re-materializing the same range cannot insert a duplicate for the already-covered date.
    const replay = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query('select public.materialize_schedule_occurrences($1,$2,$3,$4)',
        [spaceId, randomUUID(), '2026-01-01', '2026-01-31']);
      return result.rows[0].materialize_schedule_occurrences;
    });
    expect(replay.createdCount).toBe(0);

    const afterSameDate = await db().client.query<{ expected_minor: string; source_revision_id: string }>(
      "select expected_minor::text, source_revision_id::text from public.scheduled_occurrences where schedule_id = $1 and due_date = '2026-01-01'", [created.scheduleId],
    );
    expect(afterSameDate.rows[0]!.expected_minor).toBe('50000'); // unchanged, retains original

    const future = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query('select public.materialize_schedule_occurrences($1,$2,$3,$4)',
        [spaceId, randomUUID(), '2026-02-01', '2026-02-28']);
      return result.rows[0].materialize_schedule_occurrences;
    });
    expect(future.createdCount).toBe(1);
    const febRow = await db().client.query<{ expected_minor: string; source_revision_id: string }>(
      "select expected_minor::text, source_revision_id::text from public.scheduled_occurrences where schedule_id = $1 and due_date = '2026-02-01'", [created.scheduleId],
    );
    expect(febRow.rows[0]!.expected_minor).toBe('60000');
    expect(febRow.rows[0]!.source_revision_id).toBe(edited.revisionId);
  });

  it('a yearly Feb29 schedule clamps to Feb28 in a non-leap year', async () => {
    const spaceId = await freshSpace('Materialize yearly leap clamp');
    const created = await saveSchedule({
      spaceId, definition: definition({ startsOn: '2024-02-29', cadence: 'yearly', intervalCount: 1 }),
    });
    const result = await withAuthenticatedTransaction(db().client, actor, async () => {
      const materialized = await db().client.query('select public.materialize_schedule_occurrences($1,$2,$3,$4)',
        [spaceId, randomUUID(), '2025-02-01', '2025-03-01']);
      return materialized.rows[0].materialize_schedule_occurrences;
    });
    expect(result.createdCount).toBe(1);
    const rows = await db().client.query<{ due_date: string }>(
      'select due_date::text from public.scheduled_occurrences where schedule_id = $1', [created.scheduleId],
    );
    expect(rows.rows).toEqual([{ due_date: '2025-02-28' }]);
  });

  it('a weekly interval-2 schedule lands every 14 days from its start date', async () => {
    const spaceId = await freshSpace('Materialize weekly interval two');
    const created = await saveSchedule({
      spaceId, definition: definition({ startsOn: '2026-01-01', cadence: 'weekly', intervalCount: 2 }),
    });
    const result = await withAuthenticatedTransaction(db().client, actor, async () => {
      const materialized = await db().client.query('select public.materialize_schedule_occurrences($1,$2,$3,$4)',
        [spaceId, randomUUID(), '2026-01-01', '2026-02-28']);
      return materialized.rows[0].materialize_schedule_occurrences;
    });
    expect(result.createdCount).toBe(5);
    const rows = await db().client.query<{ due_date: string }>(
      'select due_date::text from public.scheduled_occurrences where schedule_id = $1 order by due_date', [created.scheduleId],
    );
    expect(rows.rows.map((r) => r.due_date)).toEqual([
      '2026-01-01', '2026-01-15', '2026-01-29', '2026-02-12', '2026-02-26',
    ]);
  });

  it('rejects a range spanning more than 90 days', async () => {
    const spaceId = await freshSpace('Materialize range too wide');
    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.materialize_schedule_occurrences($1,$2,$3,$4)',
        [spaceId, randomUUID(), '2026-01-01', '2026-06-01']),
    )).rejects.toMatchObject({ code: '22023' });
  });

  it('rejects a materialization that would create more than 500 new occurrences', async () => {
    const spaceId = await freshSpace('Materialize overflow');
    await db().client.query(
      `with seeded as (
         insert into public.schedules (id, space_id, currency, kind, actor_id)
         select gen_random_uuid(), $1, 'USD', 'income', $2 from generate_series(1,50)
         returning id, space_id, currency
       )
       insert into public.schedule_revisions (
         schedule_id, space_id, currency, expected_revision_id, state, name_en, expected_minor,
         starts_on, cadence, interval_count, request_id, actor_id
       )
       select id, space_id, currency, null, 'active', 'Overflow fixture', 1000, '2026-01-01', 'weekly', 1, gen_random_uuid(), $2
       from seeded`,
      [spaceId, actor],
    );
    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.materialize_schedule_occurrences($1,$2,$3,$4)',
        [spaceId, randomUUID(), '2026-01-01', '2026-03-31']),
    )).rejects.toMatchObject({ code: 'P0001' });
    const count = await db().client.query('select count(*)::text as n from public.scheduled_occurrences where space_id = $1', [spaceId]);
    expect(count.rows[0]!.n).toBe('0');
  });

  it('never changes the financial journal', async () => {
    const spaceId = await freshSpace('Materialize digest');
    await saveSchedule({ spaceId, definition: definition({ startsOn: '2026-01-01' }) });
    const before = await financialDigest(db().client, spaceId);
    await withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.materialize_schedule_occurrences($1,$2,$3,$4)',
        [spaceId, randomUUID(), '2026-01-01', '2026-03-31']));
    const after = await financialDigest(db().client, spaceId);
    expect(after).toEqual(before);
  });
});

describe('recurring schema: security and grants', () => {
  it('enables RLS with no direct table/sequence privileges on all four relations', async () => {
    const tables = ['schedules', 'schedule_revisions', 'scheduled_occurrences', 'occurrence_events'];
    const result = await db().client.query<{ table_name: string; rls_enabled: boolean; grantee_count: string }>(
      `select c.relname as table_name, c.relrowsecurity as rls_enabled,
         (select count(*) from information_schema.table_privileges tp
          where tp.table_schema = 'public' and tp.table_name = c.relname
            and tp.grantee in ('public','anon','authenticated','service_role'))::text as grantee_count
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1::text[])`,
      [tables],
    );
    expect(result.rows).toHaveLength(tables.length);
    for (const row of result.rows) {
      expect(row.rls_enabled, `${row.table_name} must have RLS enabled`).toBe(true);
      expect(row.grantee_count, `${row.table_name} must have no direct API grants`).toBe('0');
    }
  });

  it('confirms EXECUTE on the six recurring commands is granted only to authenticated (PUBLIC/anon/service_role excluded)', async () => {
    const functions = [
      'save_schedule', 'materialize_schedule_occurrences', 'set_occurrence_state',
      'confirm_scheduled_occurrence', 'link_scheduled_payment', 'scheduled_occurrence_page',
    ];
    const result = await db().client.query<{
      proname: string; public_exec: boolean; anon_exec: boolean; authenticated_exec: boolean; service_exec: boolean;
    }>(
      `select p.proname,
         has_function_privilege('public', p.oid, 'execute') as public_exec,
         has_function_privilege('anon', p.oid, 'execute') as anon_exec,
         has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec,
         has_function_privilege('service_role', p.oid, 'execute') as service_exec
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any($1::text[])`,
      [functions],
    );
    expect(result.rows.map((row) => row.proname).sort()).toEqual([...functions].sort());
    for (const row of result.rows) {
      expect(row.authenticated_exec, `${row.proname} must be executable by authenticated`).toBe(true);
      expect(row.public_exec, `${row.proname} must not be directly executable by PUBLIC`).toBe(false);
      expect(row.anon_exec, `${row.proname} must not be directly executable by anon`).toBe(false);
      expect(row.service_exec, `${row.proname} must not be directly executable by service_role`).toBe(false);
    }
  });

  it('the owner-only INSERT guard denies an authenticated insert even with a temporary grant and permissive RLS', async () => {
    const spaceId = await freshSpace('Guard probe space');
    await withRollback(db().client, async () => {
      await db().client.query('grant insert on public.schedules to authenticated');
      await db().client.query(
        `create policy schedules_permissive_probe on public.schedules for insert to authenticated with check (true)`,
      );
      await withAuthenticatedTransaction(db().client, actor, () =>
        expect(db().client.query(
          'insert into public.schedules (id, space_id, currency, kind, actor_id) values ($1,$2,$3,$4,$5)',
          [randomUUID(), spaceId, 'USD', 'expense', actor],
        )).rejects.toMatchObject({ code: '42501', message: 'planning_command_required' }));
    });
  });

  it('rejects a zero-row DELETE on schedules', async () => {
    await withRollback(db().client, () => expectSavepointRejection(
      db().client,
      () => db().client.query("delete from public.schedules where id = 'ffffffff-ffff-ffff-ffff-fffffffffffe'"),
      { code: '42501', message: 'planning_history_immutable' },
    ));
  });

  it('rejects a TRUNCATE on a leaf recurring table (occurrence_events, referenced by nothing)', async () => {
    await withRollback(db().client, () => expectSavepointRejection(
      db().client,
      () => db().client.query('truncate public.occurrence_events'),
      { code: '42501', message: 'planning_history_immutable' },
    ));
  });
});
