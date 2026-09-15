import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction,
  type DisposableDatabase,
} from './disposable-database.js';

let database: DisposableDatabase | undefined;
const actor = randomUUID();

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_cashout');
  await bootstrapCompatibilityObjects(db().client);
  await replayMigrations(db().client, migrationFiles());
  await db().client.query(
    `insert into auth.users(id, email, email_confirmed_at) values ($1, 'owner@budget.invalid', now())`,
    [actor],
  );
}, 120_000);

afterAll(async () => {
  if (database) await disposeDisposableDatabase(database);
}, 30_000);

// cash_outlook requires p_start_date to equal the disposable Postgres
// container's real UTC today (v1: no historical reconstruction) -- computed
// once at import time, not hardcoded, for the same reason
// available-cash.integration.test.ts's own TODAY is: a fixed date string
// silently breaks every fixture the moment the real calendar moves past it.
function daysFromToday(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}
const TODAY = daysFromToday(0);
const MONTH = `${TODAY.slice(0, 7)}-01`;

async function freshSpace(name: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const space = await db().client.query<{ id: string }>(
      "select id from public.create_space($1, 'personal') limit 2", [name],
    );
    return space.rows[0]!.id;
  });
}

async function usdWallet(spaceId: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const wallet = await db().client.query<{ id: string }>(
      "select id from public.create_wallet($1,'Cash','USD') limit 2", [spaceId],
    );
    return wallet.rows[0]!.id;
  });
}

async function recordIncome(spaceId: string, walletId: string, amountMinor: string, date = TODAY): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
    `select id from public.record_financial_event($1,$2,'income',$3::date,$4::jsonb) limit 2`,
    [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor }])],
  ));
}

function scheduleDefinition(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    currency: 'USD', kind: 'expense', state: 'active', nameEn: 'Bill', nameAr: null,
    expectedMinor: '50000', startsOn: '2026-01-31', endsOn: null, cadence: 'monthly', intervalCount: 1,
    categoryId: null, loanId: null, fundingGoalId: null, preferredWalletId: null,
    ...overrides,
  };
}

async function saveSchedule(spaceId: string, overrides: Partial<Record<string, unknown>> = {}): Promise<{ scheduleId: string }> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ save_schedule: { scheduleId: string } }>(
      'select public.save_schedule($1,$2,$3,$4,$5::jsonb)',
      [spaceId, randomUUID(), randomUUID(), null, JSON.stringify(scheduleDefinition(overrides))],
    );
    return result.rows[0]!.save_schedule;
  });
}

async function materialize(spaceId: string, fromDate: string, toDate: string): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
    'select public.materialize_schedule_occurrences($1,$2,$3::date,$4::date)', [spaceId, randomUUID(), fromDate, toDate],
  ));
}

type OutlookDay = { date: string; openingCashMinor: string; expectedIncomeMinor: string; expectedOutflowMinor: string; closingCashMinor: string };
type Outlook = {
  currency: string; startDate: string; scenario: string; assumption: string;
  days: OutlookDay[]; firstNegativeDate: string | null; state: string;
  overdueCount: number; overdueMinor: string;
};

async function outlook(spaceId: string, days: number, scenario: 'expected' | 'no_future_income', startDate = TODAY): Promise<Outlook> {
  const result = await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
    'select public.cash_outlook($1,$2,$3::date,$4,$5)', [spaceId, 'USD', startDate, days, scenario],
  ));
  return result.rows[0]!.cash_outlook as Outlook;
}

describe('cash_outlook -- income never invents the monthly planned figure', () => {
  it('never projects the monthly planned income when there is no actual or scheduled salary', async () => {
    const spaceId = await freshSpace('No invented income');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '10000');
    await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      "select public.set_monthly_income_plan($1,$2,$3::date,$4,$5,$6)",
      [spaceId, randomUUID(), MONTH, 'USD', '100000', null],
    ));

    const result = await outlook(spaceId, 5, 'expected');
    expect(result.days[0]!.openingCashMinor).toBe('10000');
    for (const day of result.days) {
      expect(day.expectedIncomeMinor).toBe('0');
    }
  });
});

describe('cash_outlook -- scheduled income and bills project onto the correct day', () => {
  it('projects unpaid scheduled income on its due date and excludes it under no_future_income', async () => {
    const spaceId = await freshSpace('Scheduled income projection');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '5000');
    const incomeDay = daysFromToday(2);
    await saveSchedule(spaceId, { kind: 'income', expectedMinor: '30000', startsOn: incomeDay });
    await materialize(spaceId, TODAY, daysFromToday(30));

    const expected = await outlook(spaceId, 10, 'expected');
    const day = expected.days.find((d) => d.date.slice(0, 10) === incomeDay)!;
    expect(day.expectedIncomeMinor).toBe('30000');
    expect(day.closingCashMinor).toBe(String(5000 + 30000));

    const noFuture = await outlook(spaceId, 10, 'no_future_income');
    for (const d of noFuture.days) {
      expect(d.expectedIncomeMinor).toBe('0');
    }
  });

  it('buckets an overdue unpaid bill onto today and projects a future bill on its due date', async () => {
    const spaceId = await freshSpace('Overdue and future bills');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '100000');
    const overdueDay = daysFromToday(-5);
    const futureBillDay = daysFromToday(4);
    await saveSchedule(spaceId, { kind: 'expense', expectedMinor: '9000', startsOn: overdueDay, nameEn: 'Overdue' });
    await saveSchedule(spaceId, { kind: 'expense', expectedMinor: '4000', startsOn: futureBillDay, nameEn: 'Future' });
    await materialize(spaceId, overdueDay, daysFromToday(30));

    const result = await outlook(spaceId, 10, 'expected');
    expect(result.days[0]!.expectedOutflowMinor).toBe('9000');
    const futureDay = result.days.find((d) => d.date.slice(0, 10) === futureBillDay)!;
    expect(futureDay.expectedOutflowMinor).toBe('4000');
    const closingAtEnd = result.days[result.days.length - 1]!.closingCashMinor;
    expect(closingAtEnd).toBe(String(100000 - 9000 - 4000));
    // The overdue bill (not the future one) is what today's big outflow is
    // silently explained by -- an explicit count, via the typed
    // overdueCount/overdueMinor fields, never a raw minor-unit amount baked
    // into the free-text assumption sentence (that duplicated, unformatted,
    // un-bdi-wrapped figure was itself a final-review finding -- see
    // docs/decisions.md, "final review fix wave").
    expect(result.overdueCount).toBe(1);
    expect(result.overdueMinor).toBe('9000');
    expect(result.assumption).toContain('1 overdue unpaid bill');
    expect(result.assumption).not.toContain('9000');
  });

  it('excludes overdue unpaid income from today\'s opening cash and every day\'s inflow, never silently assuming it arrived', async () => {
    const spaceId = await freshSpace('Overdue income excluded');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '10000');
    const overdueIncomeDay = daysFromToday(-10);
    await saveSchedule(spaceId, { kind: 'income', expectedMinor: '200000', startsOn: overdueIncomeDay, nameEn: 'Overdue salary' });
    await materialize(spaceId, overdueIncomeDay, daysFromToday(30));

    const result = await outlook(spaceId, 15, 'expected');
    // The unconfirmed overdue salary must not inflate day-0's opening cash,
    // must not appear as inflow on any single day in the window (never
    // "today" and never its own -10 due date, which is outside the window
    // anyway), and must not silently prop up every later day's opening
    // balance via the running-sum carry-forward.
    expect(result.days[0]!.openingCashMinor).toBe('10000');
    for (const day of result.days) {
      expect(day.expectedIncomeMinor).toBe('0');
    }
    const closingAtEnd = result.days[result.days.length - 1]!.closingCashMinor;
    expect(closingAtEnd).toBe('10000');
  });

  it('excludes goal earmarks from the cash line entirely', async () => {
    const spaceId = await freshSpace('Earmarks excluded from cash line');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '50000');
    const goal = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query<{ create_goal_plan: { goalId: string } }>(
        'select public.create_goal_plan($1,$2,$3,$4::jsonb,$5::jsonb)',
        [spaceId, randomUUID(), randomUUID(), JSON.stringify({
          kind: 'reserve', currency: 'USD', nameEn: 'Side goal', nameAr: null, note: null,
          targetMinor: '900000', deadline: null, contributionMode: 'manual_monthly', monthlyAmountMinor: '0', priority: 0,
        }), '[]'],
      );
      return result.rows[0]!.create_goal_plan.goalId;
    });
    const headResult = await db().client.query<{ head: string }>('select head from private.goal_financing_state($1,$2::date)', [goal, TODAY]);
    await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      'select public.record_goal_earmark($1,$2,$3,$4,$5,$6,$7)',
      [spaceId, randomUUID(), goal, 'reserve', '20000', headResult.rows[0]!.head, true],
    ));

    const result = await outlook(spaceId, 3, 'expected');
    expect(result.days[0]!.openingCashMinor).toBe('50000');
  });
});

describe('cash_outlook -- bounds and rejection', () => {
  it('rejects a start date that is not the database UTC today', async () => {
    const spaceId = await freshSpace('Reject non-today start');
    await expect(outlook(spaceId, 5, 'expected', '2020-01-01')).rejects.toThrow();
  });

  it('rejects a day count outside 1..90', async () => {
    const spaceId = await freshSpace('Reject out-of-range days');
    await expect(withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      'select public.cash_outlook($1,$2,$3::date,$4,$5)', [spaceId, 'USD', TODAY, 0, 'expected'],
    ))).rejects.toThrow();
    await expect(withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      'select public.cash_outlook($1,$2,$3::date,$4,$5)', [spaceId, 'USD', TODAY, 91, 'expected'],
    ))).rejects.toThrow();
  });

  it('rejects an unrecognized scenario', async () => {
    const spaceId = await freshSpace('Reject bad scenario');
    await expect(withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      'select public.cash_outlook($1,$2,$3::date,$4,$5)', [spaceId, 'USD', TODAY, 5, 'optimistic'],
    ))).rejects.toThrow();
  });

  it('reports state=incomplete when an active schedule has not been materialized for the requested window', async () => {
    const spaceId = await freshSpace('Incomplete outlook');
    await saveSchedule(spaceId, { startsOn: TODAY });
    const result = await outlook(spaceId, 30, 'expected');
    expect(result.state).toBe('incomplete');
  });

  it('reports firstNegativeDate when closing cash goes negative, and null when it never does', async () => {
    const spaceId = await freshSpace('First negative date');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '1000');
    const billDay = daysFromToday(3);
    await saveSchedule(spaceId, { kind: 'expense', expectedMinor: '5000', startsOn: billDay });
    await materialize(spaceId, TODAY, daysFromToday(30));

    const negative = await outlook(spaceId, 10, 'expected');
    expect(negative.firstNegativeDate).not.toBeNull();
    expect(negative.firstNegativeDate?.slice(0, 10)).toBe(billDay);

    const spaceHealthy = await freshSpace('Never negative');
    const walletHealthy = await usdWallet(spaceHealthy);
    await recordIncome(spaceHealthy, walletHealthy, '1000000');
    const healthy = await outlook(spaceHealthy, 5, 'expected');
    expect(healthy.firstNegativeDate).toBeNull();
    expect(healthy.overdueCount).toBe(0);
    expect(healthy.overdueMinor).toBe('0');
    expect(healthy.assumption).not.toContain('overdue');
  });
});

describe('space/currency isolation', () => {
  it('keeps outlook cash and schedules scoped to their own space', async () => {
    const spaceA = await freshSpace('Outlook isolation A');
    const spaceB = await freshSpace('Outlook isolation B');
    const walletA = await usdWallet(spaceA);
    await recordIncome(spaceA, walletA, '42000');

    const resultA = await outlook(spaceA, 3, 'expected');
    const resultB = await outlook(spaceB, 3, 'expected');
    expect(resultA.days[0]!.openingCashMinor).toBe('42000');
    expect(resultB.days[0]!.openingCashMinor).toBe('0');
  });
});
