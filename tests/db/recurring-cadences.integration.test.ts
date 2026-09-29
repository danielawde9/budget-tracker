import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction,
  type DisposableDatabase,
} from './disposable-database.js';

const cadenceMigrationVersion = '20260929130000';
const actor = randomUUID();

let database: DisposableDatabase | undefined;

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_recurcad');
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

/** Calls the bounded candidate generator directly and returns its due dates
 * as ISO strings, in the order the function emitted them. */
async function candidates(
  client: Client,
  input: {
    startsOn: string; cadence: string; intervalCount: number;
    endsOn?: string | null; fromDate: string; toDate: string;
  },
): Promise<string[]> {
  const result = await client.query<{ due_date: string }>(
    `select due_date::text as due_date
       from private.schedule_candidate_due_dates($1::date,$2,$3,$4::date,$5::date,$6::date) as t(due_date)`,
    [input.startsOn, input.cadence, input.intervalCount, input.endsOn ?? null, input.fromDate, input.toDate],
  );
  return result.rows.map((row) => row.due_date);
}

async function freshSpace(name: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const space = await db().client.query<{ id: string }>(
      "select id from public.create_space($1, 'personal') limit 2", [name],
    );
    return space.rows[0]!.id;
  });
}

function definition(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    currency: 'USD', kind: 'expense', state: 'active', nameEn: 'Rent', nameAr: null,
    expectedMinor: '50000', startsOn: '2026-01-01', endsOn: null, cadence: 'monthly', intervalCount: 1,
    categoryId: null, loanId: null, fundingGoalId: null, preferredWalletId: null,
    ...overrides,
  };
}

async function saveSchedule(cadence: string, intervalCount: number): Promise<void> {
  const spaceId = await freshSpace(`Save cadence ${cadence} ${intervalCount}`);
  await withAuthenticatedTransaction(db().client, actor, () =>
    db().client.query('select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
      [spaceId, randomUUID(), randomUUID(), null, JSON.stringify(definition({ cadence, intervalCount }))]),
  );
}

describe('schedule_candidate_due_dates: semimonthly', () => {
  it('emits the 1st then the 15th of every month, in date order', async () => {
    await expect(candidates(db().client, {
      startsOn: '2026-01-01', cadence: 'semimonthly', intervalCount: 1,
      fromDate: '2026-01-01', toDate: '2026-03-31',
    })).resolves.toEqual([
      '2026-01-01', '2026-01-15', '2026-02-01', '2026-02-15', '2026-03-01', '2026-03-15',
    ]);
  });

  it('yields both February dates in a short month', async () => {
    await expect(candidates(db().client, {
      startsOn: '2026-02-01', cadence: 'semimonthly', intervalCount: 1,
      fromDate: '2026-02-01', toDate: '2026-02-28',
    })).resolves.toEqual(['2026-02-01', '2026-02-15']);
  });

  it('skips a due date below starts_on', async () => {
    await expect(candidates(db().client, {
      startsOn: '2026-01-10', cadence: 'semimonthly', intervalCount: 1,
      fromDate: '2026-01-01', toDate: '2026-03-31',
    })).resolves.toEqual([
      '2026-01-15', '2026-02-01', '2026-02-15', '2026-03-01', '2026-03-15',
    ]);
  });

  it('skips a due date below from_date', async () => {
    await expect(candidates(db().client, {
      startsOn: '2026-01-01', cadence: 'semimonthly', intervalCount: 1,
      fromDate: '2026-01-20', toDate: '2026-03-31',
    })).resolves.toEqual(['2026-02-01', '2026-02-15', '2026-03-01', '2026-03-15']);
  });

  it('honours ends_on for both dates of a month', async () => {
    await expect(candidates(db().client, {
      startsOn: '2026-01-01', cadence: 'semimonthly', intervalCount: 1,
      endsOn: '2026-02-15', fromDate: '2026-01-01', toDate: '2026-06-30',
    })).resolves.toEqual(['2026-01-01', '2026-01-15', '2026-02-01', '2026-02-15']);
  });
});

describe('schedule_candidate_due_dates: monthly_last_business_day', () => {
  it('resolves a weekend month end to the preceding Friday', async () => {
    await expect(candidates(db().client, {
      startsOn: '2026-01-01', cadence: 'monthly_last_business_day', intervalCount: 1,
      fromDate: '2026-01-01', toDate: '2026-06-30',
    })).resolves.toEqual([
      // 2026-01-31 is a Saturday -> 2026-01-30; 2026-05-31 is a Sunday -> 2026-05-29.
      '2026-01-30', '2026-02-27', '2026-03-31', '2026-04-30', '2026-05-29', '2026-06-30',
    ]);
  });

  it('walks back exactly one day when the last day is a Sunday', async () => {
    await expect(candidates(db().client, {
      startsOn: '2026-05-01', cadence: 'monthly_last_business_day', intervalCount: 1,
      fromDate: '2026-05-01', toDate: '2026-05-31',
    })).resolves.toEqual(['2026-05-29']);
  });

  it('treats interval_count as months between occurrences, like monthly', async () => {
    await expect(candidates(db().client, {
      startsOn: '2026-01-01', cadence: 'monthly_last_business_day', intervalCount: 2,
      fromDate: '2026-01-01', toDate: '2026-06-30',
    })).resolves.toEqual(['2026-01-30', '2026-03-31', '2026-05-29']);
    await expect(candidates(db().client, {
      startsOn: '2026-01-01', cadence: 'monthly_last_business_day', intervalCount: 12,
      fromDate: '2026-01-01', toDate: '2027-12-31',
    })).resolves.toEqual(['2026-01-30', '2027-01-29']);
  });

  it('skips a month whose last business day falls before starts_on', async () => {
    await expect(candidates(db().client, {
      startsOn: '2026-01-31', cadence: 'monthly_last_business_day', intervalCount: 1,
      fromDate: '2026-01-01', toDate: '2026-03-31',
    })).resolves.toEqual(['2026-02-27', '2026-03-31']);
  });
});

describe('save_schedule cadence allowlist', () => {
  it('accepts semimonthly with interval_count 1', async () => {
    await expect(saveSchedule('semimonthly', 1)).resolves.toBeUndefined();
  });

  it('accepts monthly_last_business_day', async () => {
    await expect(saveSchedule('monthly_last_business_day', 3)).resolves.toBeUndefined();
  });

  it('rejects semimonthly with an interval_count other than 1', async () => {
    const spaceId = await freshSpace('Save semimonthly bad interval');
    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
        [spaceId, randomUUID(), randomUUID(), null, JSON.stringify(definition({ cadence: 'semimonthly', intervalCount: 2 }))]),
    )).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('still rejects an unknown cadence', async () => {
    const spaceId = await freshSpace('Save unknown cadence');
    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
        [spaceId, randomUUID(), randomUUID(), null, JSON.stringify(definition({ cadence: 'daily' }))]),
    )).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects an interval outside 1..12 for the new cadences too', async () => {
    const spaceId = await freshSpace('Save cadence bad interval');
    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query('select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
        [spaceId, randomUUID(), randomUUID(), null, JSON.stringify(definition({ cadence: 'monthly_last_business_day', intervalCount: 13 }))]),
    )).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });
});

describe('existing cadences are byte-identical across the cadence upgrade', () => {
  // weekly/monthly/yearly must be untouched by the new branches. Rather than
  // trust a single fixture, capture the generator's full output over a matrix
  // of starts/intervals/ranges before and after the new migration is applied,
  // and require exact equality.
  const baselineCases = [
    { startsOn: '2026-01-01', cadence: 'weekly', intervalCount: 1, fromDate: '2026-01-01', toDate: '2026-03-31' },
    { startsOn: '2026-01-01', cadence: 'weekly', intervalCount: 2, fromDate: '2026-01-01', toDate: '2026-02-28' },
    { startsOn: '2026-01-01', cadence: 'weekly', intervalCount: 1, fromDate: '2026-02-15', toDate: '2026-03-15' },
    { startsOn: '2026-03-10', cadence: 'weekly', intervalCount: 3, fromDate: '2026-01-01', toDate: '2026-12-31' },
    { startsOn: '2026-01-31', cadence: 'monthly', intervalCount: 1, fromDate: '2026-01-01', toDate: '2026-04-01' },
    { startsOn: '2024-02-29', cadence: 'monthly', intervalCount: 1, fromDate: '2024-01-01', toDate: '2024-06-01' },
    { startsOn: '2026-01-15', cadence: 'monthly', intervalCount: 3, fromDate: '2026-01-01', toDate: '2026-12-31' },
    { startsOn: '2026-05-31', cadence: 'monthly', intervalCount: 1, fromDate: '2026-01-01', toDate: '2026-08-31' },
    { startsOn: '2026-01-01', cadence: 'monthly', intervalCount: 1, endsOn: '2026-03-15', fromDate: '2026-01-01', toDate: '2026-12-31' },
    { startsOn: '2026-05-01', cadence: 'monthly', intervalCount: 1, fromDate: '2026-01-01', toDate: '2026-08-31' },
    { startsOn: '2024-02-29', cadence: 'yearly', intervalCount: 1, fromDate: '2024-01-01', toDate: '2028-12-31' },
    { startsOn: '2026-06-10', cadence: 'yearly', intervalCount: 2, fromDate: '2026-01-01', toDate: '2032-12-31' },
    { startsOn: '2025-12-31', cadence: 'yearly', intervalCount: 1, fromDate: '2026-01-01', toDate: '2030-12-31' },
  ] as const;

  async function capture(client: Client): Promise<Record<string, string[]>> {
    const captured: Record<string, string[]> = {};
    for (const input of baselineCases) {
      captured[`${input.cadence}/${input.intervalCount}/${input.startsOn}/${input.fromDate}..${input.toDate}`] =
        await candidates(client, input);
    }
    return captured;
  }

  it('produces the same weekly/monthly/yearly output before and after the migration', async () => {
    const migrations = migrationFiles();
    const cadenceMigration = migrations.find((migration) => migration.version === cadenceMigrationVersion);
    const priorMigrations = migrations.filter((migration) => migration.version < cadenceMigrationVersion);
    expect(cadenceMigration).toBeDefined();

    const upgradeDatabase = await createDisposableDatabase('budget_recurcadup');
    try {
      await bootstrapCompatibilityObjects(upgradeDatabase.client);
      await replayMigrations(upgradeDatabase.client, priorMigrations);
      const before = await capture(upgradeDatabase.client);
      await replayMigrations(upgradeDatabase.client, [cadenceMigration!]);
      const after = await capture(upgradeDatabase.client);
      expect(after).toEqual(before);
      // Sanity: the baseline is non-empty, so equality is not vacuous.
      expect(Object.values(before).every((dates) => dates.length > 0)).toBe(true);
    } finally {
      await disposeDisposableDatabase(upgradeDatabase);
    }
  }, 120_000);
});
