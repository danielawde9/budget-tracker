import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction, withRollback, expectSavepointRejection,
  orderedAuthenticatedRace, type DisposableDatabase,
} from './disposable-database.js';

let database: DisposableDatabase | undefined;
const actor = randomUUID();
const outsider = randomUUID();
let spaceId: string;

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_command');
  await bootstrapCompatibilityObjects(db().client);
  await replayMigrations(db().client, migrationFiles());
  await db().client.query(
    `insert into auth.users(id, email, email_confirmed_at)
     values ($1, 'owner@budget.invalid', now()),
            ($2, 'outsider@budget.invalid', now())`, [actor, outsider],
  );
  spaceId = await withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ id: string }>(
      "select id from public.create_space($1, 'personal') limit 2", ['Command foundation fixture'],
    );
    return result.rows[0]!.id;
  });
}, 120_000);

afterAll(async () => {
  if (database) await disposeDisposableDatabase(database);
}, 30_000);

async function financialDigest(): Promise<unknown> {
  const result = await db().client.query(
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

describe('planning_minor', () => {
  const cases: Array<{ name: string; value: string | null; positive?: boolean; expected?: string; rejected?: boolean }> = [
    { name: 'rejects null', value: null, rejected: true },
    { name: 'rejects whitespace', value: ' 100', rejected: true },
    { name: 'rejects a leading plus sign', value: '+100', rejected: true },
    { name: 'rejects a leading minus sign', value: '-100', rejected: true },
    { name: 'rejects a decimal point', value: '100.00', rejected: true },
    { name: 'rejects exponent notation', value: '1e5', rejected: true },
    { name: 'rejects a leading zero on a multi-digit value', value: '0100', rejected: true },
    { name: 'rejects a 16-digit value', value: '1000000000000000', rejected: true },
    { name: 'accepts the maximum 15-digit value', value: '999999999999999', expected: '999999999999999' },
    { name: 'accepts zero when not required positive', value: '0', expected: '0' },
    { name: 'rejects zero when required positive', value: '0', positive: true, rejected: true },
    { name: 'accepts a positive value when required positive', value: '1', positive: true, expected: '1' },
  ];

  for (const testCase of cases) {
    it(testCase.name, async () => {
      const query = db().client.query<{ amount: string }>(
        'select private.planning_minor($1, $2)::text as amount',
        [testCase.value, testCase.positive ?? false],
      );
      if (testCase.rejected) {
        await expect(query).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
      } else {
        await expect(query).resolves.toMatchObject({ rows: [{ amount: testCase.expected }] });
      }
    });
  }
});

describe('planning_child_request', () => {
  it('matches the documented golden vector', async () => {
    const result = await db().client.query<{ id: string }>(
      "select private.planning_child_request($1, $2)::text as id",
      ['00000000-0000-0000-0000-000000000001', 'income:USD:2026-09-01'],
    );
    expect(result.rows[0]!.id).toBe('e63ea2aa-fc33-8619-a338-f3bf5a4e0e80');
  });

  it('is stable for the same parent and operation', async () => {
    const parent = randomUUID();
    const first = await db().client.query<{ id: string }>(
      'select private.planning_child_request($1, $2)::text as id', [parent, 'confirm:same'],
    );
    const second = await db().client.query<{ id: string }>(
      'select private.planning_child_request($1, $2)::text as id', [parent, 'confirm:same'],
    );
    expect(second.rows[0]!.id).toBe(first.rows[0]!.id);
  });

  it('differs for a different operation label under the same parent', async () => {
    const parent = randomUUID();
    const first = await db().client.query<{ id: string }>(
      'select private.planning_child_request($1, $2)::text as id', [parent, 'confirm:a'],
    );
    const second = await db().client.query<{ id: string }>(
      'select private.planning_child_request($1, $2)::text as id', [parent, 'confirm:b'],
    );
    expect(second.rows[0]!.id).not.toBe(first.rows[0]!.id);
  });

  it('rejects a null parent, a null operation, and an out-of-bounds operation label', async () => {
    await expect(db().client.query(
      "select private.planning_child_request(null, 'op')",
    )).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
    await expect(db().client.query(
      'select private.planning_child_request($1, null)', [randomUUID()],
    )).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
    await expect(db().client.query(
      'select private.planning_child_request($1, $2)', [randomUUID(), '']),
    ).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
    await expect(db().client.query(
      'select private.planning_child_request($1, $2)', [randomUUID(), 'x'.repeat(121)]),
    ).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });
});

describe('planning command receipts: replay and lookup', () => {
  async function seedReceipt(input: {
    spaceId?: string; requestId: string; actorId: string; command: string; payload: unknown; result: unknown;
  }): Promise<{ fingerprint: Buffer }> {
    const fingerprint = await db().client.query<{ fingerprint: Buffer }>(
      'select private.planning_fingerprint($1, $2, $3::jsonb) as fingerprint',
      [input.command, input.actorId, JSON.stringify(input.payload)],
    );
    await db().client.query(
      `insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [input.spaceId ?? spaceId, input.requestId, input.command, fingerprint.rows[0]!.fingerprint, input.actorId, JSON.stringify(input.result)],
    );
    return { fingerprint: fingerprint.rows[0]!.fingerprint };
  }

  it('planning_fingerprint is deterministic and payload-sensitive', async () => {
    const a = await db().client.query<{ fingerprint: Buffer }>(
      "select private.planning_fingerprint('cmd', $1, '{\"amount\":\"100\"}'::jsonb) as fingerprint", [actor],
    );
    const b = await db().client.query<{ fingerprint: Buffer }>(
      "select private.planning_fingerprint('cmd', $1, '{\"amount\":\"100\"}'::jsonb) as fingerprint", [actor],
    );
    const c = await db().client.query<{ fingerprint: Buffer }>(
      "select private.planning_fingerprint('cmd', $1, '{\"amount\":\"200\"}'::jsonb) as fingerprint", [actor],
    );
    expect(a.rows[0]!.fingerprint.equals(b.rows[0]!.fingerprint)).toBe(true);
    expect(a.rows[0]!.fingerprint.equals(c.rows[0]!.fingerprint)).toBe(false);
  });

  it('planning_replay returns null for an unknown request, then the stored result on exact replay, then rejects a changed payload', async () => {
    const requestId = randomUUID();
    const unknown = await db().client.query<{ result: unknown }>(
      'select private.planning_replay($1, $2, $3, $4, $5) as result',
      [spaceId, requestId, 'planning-test', actor, Buffer.alloc(32)],
    );
    expect(unknown.rows[0]!.result).toBeNull();

    const { fingerprint } = await seedReceipt({
      requestId, actorId: actor, command: 'planning-test', payload: { amount: '100' }, result: { ok: true },
    });
    const replay = await db().client.query<{ result: { ok: boolean } }>(
      'select private.planning_replay($1, $2, $3, $4, $5) as result',
      [spaceId, requestId, 'planning-test', actor, fingerprint],
    );
    expect(replay.rows[0]!.result).toEqual({ ok: true });

    await expect(db().client.query(
      'select private.planning_replay($1, $2, $3, $4, $5) as result',
      [spaceId, requestId, 'planning-test', actor, Buffer.alloc(32)],
    )).rejects.toMatchObject({ code: 'P0001', message: 'planning_idempotency_conflict' });
  });

  it('planning_replay rejects null inputs', async () => {
    await expect(db().client.query(
      'select private.planning_replay($1, $2, $3, $4, $5) as result',
      [null, randomUUID(), 'cmd', actor, Buffer.alloc(32)],
    )).rejects.toMatchObject({ code: '22023' });
  });

  it('find_planning_command returns the caller\'s own receipt but never another actor\'s', async () => {
    const member = randomUUID();
    await db().client.query(
      `insert into auth.users(id, email, email_confirmed_at) values ($1,'member@budget.invalid', now())`,
      [member],
    );
    const lookupSpace = await withAuthenticatedTransaction(db().client, actor, async () => {
      const space = await db().client.query<{ id: string }>(
        "select id from public.create_space($1, 'household') limit 2", ['Lookup fixture'],
      );
      return space.rows[0]!.id;
    });
    await db().client.query(
      `insert into public.space_memberships (space_id, user_id, role, status) values ($1,$2,'member','active')`,
      [lookupSpace, member],
    );

    const requestId = randomUUID();
    await seedReceipt({
      spaceId: lookupSpace, requestId, actorId: actor, command: 'planning-lookup', payload: { a: 1 }, result: { sequenceProbe: true },
    });

    const ownLookup = await withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query<{ find_planning_command: { command: string; sequenceId: string; result: unknown } }>(
        'select public.find_planning_command($1, $2)', [lookupSpace, requestId],
      ));
    expect(ownLookup.rows[0]!.find_planning_command).toMatchObject({ command: 'planning-lookup', result: { sequenceProbe: true } });

    const foreignLookup = await withAuthenticatedTransaction(db().client, member, () =>
      db().client.query<{ find_planning_command: unknown }>(
        'select public.find_planning_command($1, $2)', [lookupSpace, requestId],
      ));
    expect(foreignLookup.rows[0]!.find_planning_command).toBeNull();

    await expect(withAuthenticatedTransaction(db().client, outsider, () =>
      db().client.query('select public.find_planning_command($1, $2)', [lookupSpace, requestId]),
    )).rejects.toMatchObject({ code: '42501', message: 'planning_not_authorized' });

    await db().client.query(
      `update public.space_memberships set status='revoked', ended_at=now(), ended_by_user_id=$1
       where space_id=$2 and user_id=$3`,
      [actor, lookupSpace, member],
    );
    await expect(withAuthenticatedTransaction(db().client, member, () =>
      db().client.query('select public.find_planning_command($1, $2)', [lookupSpace, requestId]),
    )).rejects.toMatchObject({ code: '42501', message: 'planning_not_authorized' });

    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.find_planning_command($1, null)', [lookupSpace]),
    )).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('a receipt insert rolls back with its transaction', async () => {
    const requestId = randomUUID();
    await withRollback(db().client, () => seedReceipt({
      requestId, actorId: actor, command: 'rollback-probe', payload: {}, result: {},
    }));
    const after = await db().client.query(
      'select 1 from public.planning_command_receipts where space_id=$1 and request_id=$2', [spaceId, requestId],
    );
    expect(after.rows).toEqual([]);
  });

  it('rejects a zero-row DELETE and a TRUNCATE on planning_command_receipts', async () => {
    await withRollback(db().client, async () => {
      await expectSavepointRejection(
        db().client,
        () => db().client.query("delete from public.planning_command_receipts where request_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'"),
        { code: '42501', message: 'planning_history_immutable' },
      );
      await expectSavepointRejection(
        db().client,
        () => db().client.query('truncate public.planning_command_receipts'),
        { code: '42501', message: 'planning_history_immutable' },
      );
    });
  });

  it('the owner-only INSERT guard still denies an authenticated insert even with a temporary grant and a permissive RLS policy', async () => {
    await withRollback(db().client, async () => {
      await db().client.query('grant insert on public.planning_command_receipts to authenticated');
      await db().client.query(
        'grant usage on sequence public.planning_command_receipts_sequence_id_seq to authenticated',
      );
      await db().client.query(
        `create policy planning_receipts_permissive_probe on public.planning_command_receipts
         for insert to authenticated with check (true)`,
      );
      const fingerprint = await db().client.query<{ fingerprint: Buffer }>(
        "select private.planning_fingerprint('probe', $1, '{}'::jsonb) as fingerprint", [actor],
      );
      await withAuthenticatedTransaction(db().client, actor, () =>
        expect(db().client.query(
          `insert into public.planning_command_receipts (space_id, request_id, command, fingerprint, actor_id, result)
           values ($1, $2, 'probe', $3, $4, '{}'::jsonb)`,
          [spaceId, randomUUID(), fingerprint.rows[0]!.fingerprint, actor],
        )).rejects.toMatchObject({ code: '42501', message: 'planning_command_required' }));
    });
  });

  it('does not change the financial digest', async () => {
    const before = await financialDigest();
    const requestId = randomUUID();
    await seedReceipt({ requestId, actorId: actor, command: 'digest-probe', payload: {}, result: {} });
    const after = await financialDigest();
    expect(after).toEqual(before);
  });
});

describe('set_monthly_budget_plan takes the space lock before its advisory locks', () => {
  it('blocks a concurrent expense-category target write until an income plan write commits, though they use different advisory-lock keys', async () => {
    // An income plan write and an expense-category target write for the same
    // space hash to different existing advisory-lock keys (plan_kind and
    // category_id both differ), so before this task added the shared space
    // row lock in private.lock_planning_actor, nothing serialized them.
    const { raceSpace, categoryId } = await withAuthenticatedTransaction(db().client, actor, async () => {
      const space = await db().client.query<{ id: string }>(
        "select id from public.create_space($1, 'personal') limit 2", ['Race fixture'],
      );
      const category = await db().client.query<{ id: string }>(
        "select id from public.create_category($1,$2,'expense','Race category',null) limit 2",
        [space.rows[0]!.id, randomUUID()],
      );
      return { raceSpace: space.rows[0]!.id, categoryId: category.rows[0]!.id };
    });

    const outcome = await orderedAuthenticatedRace(
      db(),
      actor,
      (client) => client.query(
        "select * from public.set_monthly_income_plan($1, $2, '2026-09-01'::date, 'USD', '1000', null)",
        [raceSpace, randomUUID()],
      ),
      (client) => client.query(
        "select * from public.set_monthly_category_target($1, $2, $3, '2026-09-01'::date, 'USD', '500', null)",
        [raceSpace, randomUUID(), categoryId],
      ),
    );
    expect(outcome.status).toBe('fulfilled');
  });
});
