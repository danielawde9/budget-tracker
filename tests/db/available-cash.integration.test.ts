import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction, inTransaction, withRollback,
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
  database = await createDisposableDatabase('budget_availcash');
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

// available_cash_summary/cash_outlook require p_as_of_date/p_start_date to
// equal the disposable Postgres container's real UTC today (v1: no
// historical reconstruction). A fixed hardcoded TODAY string, like task 11's
// goal-month-integration suite originally used, silently breaks every ready-
// state fixture the day the real calendar moves past it -- reproduced
// directly during this fix round when the wall clock crossed into the next
// day mid-task. Computed once at import time instead (recurring-settlement.
// integration.test.ts's own daysFromToday helper is the established pattern
// for date-relative fixtures in this repo; TODAY/MONTH/HORIZON_END below are
// just that helper's offset-0/month-start/offset-89 special cases).
function daysFromToday(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}
function firstOfMonth(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}
const TODAY = daysFromToday(0);
const MONTH = firstOfMonth(TODAY);
// available_cash_summary's incomplete-state check scans the full 90-day
// window from today for missing materialization, independent of how far out
// any individual fixture's bills actually fall -- every "ready" fixture
// below must materialize through this same horizon or it lands on
// state=incomplete instead, exactly as intended (that path has its own
// dedicated test in the "state machine" describe block).
const HORIZON_END = daysFromToday(89);
// A date guaranteed to fall in the calendar month immediately before MONTH
// (never the current month), for fixtures that need income/earmarks outside
// this-month-to-date without caring which specific prior month it lands in.
function priorMonthAnchor(): string {
  const date = new Date(`${MONTH}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  date.setUTCDate(1);
  return date.toISOString().slice(0, 10);
}

async function freshSpace(name: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const space = await db().client.query<{ id: string }>(
      "select id from public.create_space($1, 'personal') limit 2", [name],
    );
    return space.rows[0]!.id;
  });
}

async function usdWallet(spaceId: string, name = 'Cash'): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const wallet = await db().client.query<{ id: string }>(
      'select id from public.create_wallet($1,$2,$3) limit 2', [spaceId, name, 'USD'],
    );
    return wallet.rows[0]!.id;
  });
}

async function expenseCategory(spaceId: string, name: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ id: string }>(
      "select id from public.create_category($1,$2,'expense',$3,null) limit 2", [spaceId, randomUUID(), name],
    );
    return result.rows[0]!.id;
  });
}

async function recordIncome(spaceId: string, walletId: string, amountMinor: string, date = TODAY): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
    `select id from public.record_financial_event($1,$2,'income',$3::date,$4::jsonb) limit 2`,
    [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor }])],
  ));
}

async function recordExpense(spaceId: string, walletId: string, amountMinor: string, date = TODAY, categoryId: string | null = null): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const negative = `-${amountMinor}`;
    if (categoryId) {
      const result = await db().client.query<{ id: string }>(
        `select id from public.record_categorized_financial_event($1,$2,'expense',$3::date,$4::jsonb,$5) limit 2`,
        [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor: negative }]), categoryId],
      );
      return result.rows[0]!.id;
    }
    const result = await db().client.query<{ id: string }>(
      `select id from public.record_financial_event($1,$2,'expense',$3::date,$4::jsonb) limit 2`,
      [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor: negative }])],
    );
    return result.rows[0]!.id;
  });
}

function templateGroup(id: string, purpose: 'spending' | 'future', order: number, basisPoints: number) {
  return { id, purpose, nameEn: `Group ${order}`, nameAr: null, order, basisPoints };
}

async function saveTemplate(spaceId: string, groups: unknown[], roots: unknown[] = []): Promise<number> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ save_allocation_template: { templateRevisionId: string } }>(
      'select public.save_allocation_template($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
      [spaceId, randomUUID(), 'USD', null, JSON.stringify(groups), JSON.stringify(roots)],
    );
    return Number(result.rows[0]!.save_allocation_template.templateRevisionId);
  });
}

function rootTarget(categoryId: string, amountMinor: string) {
  return { categoryId, amountMinor, expectedRevisionId: null };
}

function goalTarget(goalId: string, amountMinor: string, groupId: string | null = null) {
  return { goalId, groupId, amountMinor, expectedRevisionId: null };
}

async function publishV1(input: {
  spaceId: string; templateRevisionId: number; incomeMinor: string; rootTargets?: unknown[]; loanGroupId?: string | null;
}) {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ publish_allocation_month: { snapshotId: string; incomeRevisionId: string } }>(
      'select public.publish_allocation_month($1,$2,$3::date,$4,$5,$6,$7,$8,$9::jsonb,$10)',
      [input.spaceId, randomUUID(), MONTH, 'USD', null, input.templateRevisionId, null, input.incomeMinor,
        JSON.stringify(input.rootTargets ?? []), input.loanGroupId ?? null],
    );
    return result.rows[0]!.publish_allocation_month;
  });
}

async function publishV2(input: {
  spaceId: string; templateRevisionId: number; incomeMinor: string; rootTargets?: unknown[];
  loanGroupId?: string | null; goalTargets: unknown[];
}) {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ publish_allocation_month_v2: { snapshotId: string; incomeRevisionId: string } }>(
      'select public.publish_allocation_month_v2($1,$2,$3::date,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb)',
      [input.spaceId, randomUUID(), MONTH, 'USD', null, input.templateRevisionId, null, input.incomeMinor,
        JSON.stringify(input.rootTargets ?? []), input.loanGroupId ?? null, JSON.stringify(input.goalTargets)],
    );
    return result.rows[0]!.publish_allocation_month_v2;
  });
}

function goalDefinition(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: 'reserve', currency: 'USD', nameEn: 'Goal', nameAr: null, note: null,
    targetMinor: '900000', deadline: null, contributionMode: 'manual_monthly',
    monthlyAmountMinor: '0', priority: 0,
    ...overrides,
  };
}

async function createGoal(spaceId: string, overrides: Partial<Record<string, unknown>> = {}): Promise<{ goalId: string; revisionId: string }> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ create_goal_plan: { goalId: string; revisionId: string } }>(
      'select public.create_goal_plan($1,$2,$3,$4::jsonb,$5::jsonb)',
      [spaceId, randomUUID(), randomUUID(), JSON.stringify(goalDefinition(overrides)), '[]'],
    );
    return result.rows[0]!.create_goal_plan;
  });
}

async function goalHead(goalId: string, asOf = TODAY): Promise<string> {
  const result = await db().client.query<{ head: string }>(
    'select head from private.goal_financing_state($1,$2::date)', [goalId, asOf],
  );
  return result.rows[0]!.head;
}

async function reserve(spaceId: string, goalId: string, amountMinor: string, acceptUnderfunded = true): Promise<void> {
  const expectedHead = await goalHead(goalId);
  await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
    'select public.record_goal_earmark($1,$2,$3,$4,$5,$6,$7)',
    [spaceId, randomUUID(), goalId, 'reserve', amountMinor, expectedHead, acceptUnderfunded],
  ));
}

async function release(spaceId: string, goalId: string, amountMinor: string): Promise<void> {
  const expectedHead = await goalHead(goalId);
  await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
    'select public.record_goal_earmark($1,$2,$3,$4,$5,$6,$7)',
    [spaceId, randomUUID(), goalId, 'release', amountMinor, expectedHead, true],
  ));
}

async function setGoalMonthlyTarget(spaceId: string, goalId: string, amountMinor: string): Promise<void> {
  const current = await db().client.query<{ id: string }>(
    'select id::text from public.goal_monthly_target_revisions where goal_id=$1 and month_start=$2::date order by id desc limit 1',
    [goalId, MONTH],
  );
  await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
    'select public.set_goal_monthly_target($1,$2,$3,$4::date,$5,$6)',
    [spaceId, randomUUID(), goalId, MONTH, amountMinor, current.rows[0]?.id ?? null],
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

async function saveSchedule(spaceId: string, overrides: Partial<Record<string, unknown>> = {}): Promise<{ scheduleId: string; revisionId: string }> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ save_schedule: { scheduleId: string; revisionId: string } }>(
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

async function occurrencesFor(scheduleId: string): Promise<Array<{ id: string; due_date: string }>> {
  const result = await db().client.query<{ id: string; due_date: string }>(
    'select id::text, due_date::text from public.scheduled_occurrences where schedule_id=$1 order by due_date, id', [scheduleId],
  );
  return result.rows;
}

async function confirmOccurrence(
  spaceId: string, occurrenceId: string, amountMinor: string, walletId: string, date = TODAY,
): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
    'select public.confirm_scheduled_occurrence($1,$2,$3,$4,$5,$6,$7)',
    [spaceId, randomUUID(), occurrenceId, null, amountMinor, date, walletId],
  ));
}

async function skipOccurrence(spaceId: string, occurrenceId: string): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
    "select public.set_occurrence_state($1,$2,$3,$4,'skip')", [spaceId, randomUUID(), occurrenceId, null],
  ));
}

async function freshLoan(spaceId: string, walletId: string, amountMinor = '10000'): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const loan = await db().client.query<{ loan_id: string }>(
      `select loan_id::text from public.record_cash_loan($1,$2,'i_owe_them','Lender','USD',$3,$4,'2026-01-01'::date)`,
      [spaceId, randomUUID(), walletId, amountMinor],
    );
    return loan.rows[0]!.loan_id;
  });
}

async function setLoanMonthlyTarget(spaceId: string, loanId: string, amountMinor: string): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
    'select public.set_loan_monthly_target($1,$2,$3,$4::date,$5)', [spaceId, randomUUID(), loanId, MONTH, amountMinor],
  ));
}

async function repayLoan(spaceId: string, loanId: string, walletId: string, amountMinor: string, date = TODAY): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
    'select public.record_loan_repayment($1,$2,$3,$4,$5,$6::date)', [spaceId, randomUUID(), loanId, walletId, amountMinor, date],
  ));
}

type Summary = {
  currency: string; asOf: string; state: string; needsReview: boolean; snapshotId: string | null;
  cashMinor: string; goalClaimsMinor: string;
  expenseCommitmentsMinor: string | null; debtCommitmentsMinor: string | null;
  goalTopupsMinor: string | null; futureHeadroomMinor: string | null;
  availableMinor: string | null; deficitMinor: string | null; spendableMinor: string | null;
  dailyExtraGuideMinor: string | null; daysRemaining: number;
  receivedIncomeMinor: string; ordinarySpendingMinor: string; incomeMinusSpendingMinor: string;
  uncategorizedMinor: string; unmaterializedCount: number;
  groups: Array<{
    id: string; nameEn: string | null; nameAr: string | null;
    budgetRemainingMinor: string; unpaidBillsMinor: string | null; goalOverlapMinor: string | null; commitmentMinor: string;
  }>;
};

// private.planning_cash_commitments is revoked from `authenticated` by
// design (it is an internal helper, never a public surface); calling it
// directly for a test assertion needs auth.uid() to resolve (so the
// loan_monthly_plan it calls internally can pass its own membership check)
// WITHOUT actually switching role to `authenticated`, which would lose
// EXECUTE. Setting only the JWT-claim GUC, and staying on the powerful
// connecting role, satisfies both at once.
async function queryPrivateAsActor<T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<{ rows: T[] }> {
  return inTransaction(db().client, async () => {
    await db().client.query("select set_config('request.jwt.claim.sub', $1, true)", [actor]);
    return db().client.query<T>(sql, params);
  });
}

async function summary(spaceId: string, asOfDate = TODAY, currency: 'USD' | 'LBP' = 'USD'): Promise<Summary> {
  const result = await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
    'select public.available_cash_summary($1,$2,$3::date)', [spaceId, currency, asOfDate],
  ));
  return result.rows[0]!.available_cash_summary as Summary;
}

describe('available_cash_summary -- single spending group formula (acceptance table)', () => {
  // cashMinor is the real wallet balance (C); planIncomeMinor is the
  // separate figure the allocation snapshot's group target is a basis-point
  // share of (B). They are independent inputs -- a group's saved target
  // can legitimately exceed actual cash on hand, and the bps allocation
  // model itself caps any one group at <=100% of planIncomeMinor, so a
  // fixture wanting B > cashMinor must plan against a larger income while
  // only actually depositing cashMinor into the wallet.
  async function fixture(
    cashMinor: string, planIncomeMinor: string, groupBasisPoints: number, billMinor: string,
  ): Promise<{ spaceId: string; groupId: string; categoryId: string }> {
    const spaceId = await freshSpace(`Fixture ${randomUUID()}`);
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, cashMinor);
    const category = await expenseCategory(spaceId, 'Rent');
    const groupId = randomUUID();
    const templateId = await saveTemplate(spaceId, [templateGroup(groupId, 'spending', 0, groupBasisPoints)],
      [{ categoryId: category, groupId }]);
    await publishV1({ spaceId, templateRevisionId: templateId, incomeMinor: planIncomeMinor, rootTargets: [rootTarget(category, '0')] });
    if (billMinor !== '0') {
      await saveSchedule(spaceId, { categoryId: category, expectedMinor: billMinor, startsOn: TODAY });
    }
    await materialize(spaceId, TODAY, HORIZON_END);
    return { spaceId, groupId, categoryId: category };
  }

  it('C100000,R0,B50000,O30000,G0 -> Q50000,available50000', async () => {
    const { spaceId } = await fixture('100000', '100000', 5000, '30000');
    const result = await summary(spaceId);
    expect(result.state).toBe('ready');
    expect(result.groups[0]).toMatchObject({ budgetRemainingMinor: '50000', unpaidBillsMinor: '30000', goalOverlapMinor: '0', commitmentMinor: '50000' });
    expect(result.expenseCommitmentsMinor).toBe('50000');
    expect(result.availableMinor).toBe('50000');
    // A healthy monthly bill fully materialized through the 90-day horizon
    // (this fixture's own materialize call) produces ~3 ordinary unpaid
    // occurrences -- unmaterializedCount must stay 0 in the ready state, not
    // report that ordinary backlog as if materialization were needed.
    expect(result.unmaterializedCount).toBe(0);
  });

  it('C100000,R0,B30000,O50000 -> Q50000,available50000', async () => {
    const { spaceId } = await fixture('100000', '100000', 3000, '50000');
    const result = await summary(spaceId);
    expect(result.groups[0]).toMatchObject({ budgetRemainingMinor: '30000', unpaidBillsMinor: '50000', commitmentMinor: '50000' });
    expect(result.availableMinor).toBe('50000');
  });

  it('C100000,R50000,B50000,O50000,G50000 -> Q0,available50000 (not 0)', async () => {
    const { spaceId, categoryId } = await fixture('100000', '100000', 5000, '0');
    const goal = await createGoal(spaceId, { kind: 'purchase', nameEn: 'Funded bill' });
    await reserve(spaceId, goal.goalId, '50000');
    const schedule = await saveSchedule(spaceId, { categoryId, expectedMinor: '50000', startsOn: TODAY, fundingGoalId: goal.goalId });
    await materialize(spaceId, TODAY, HORIZON_END);

    const result = await summary(spaceId);
    expect(result.goalClaimsMinor).toBe('50000');
    expect(result.groups[0]).toMatchObject({ budgetRemainingMinor: '50000', unpaidBillsMinor: '50000', goalOverlapMinor: '50000', commitmentMinor: '0' });
    expect(result.expenseCommitmentsMinor).toBe('0');
    expect(result.availableMinor).toBe('50000');
  });

  it('C100000,R30000,B50000,O50000,G30000 -> Q20000,available50000', async () => {
    const { spaceId, categoryId } = await fixture('100000', '100000', 5000, '0');
    const goal = await createGoal(spaceId, { kind: 'purchase', nameEn: 'Partly funded bill' });
    await reserve(spaceId, goal.goalId, '30000');
    await saveSchedule(spaceId, { categoryId, expectedMinor: '50000', startsOn: TODAY, fundingGoalId: goal.goalId });
    await materialize(spaceId, TODAY, HORIZON_END);

    const result = await summary(spaceId);
    expect(result.groups[0]).toMatchObject({ budgetRemainingMinor: '50000', unpaidBillsMinor: '50000', goalOverlapMinor: '30000', commitmentMinor: '20000' });
    expect(result.availableMinor).toBe('50000');
  });

  it('C20000,R50000,B50000,O50000,G20000 -> Q30000,available-60000 (claim/coverage shortage visible)', async () => {
    const { spaceId, categoryId } = await fixture('20000', '200000', 2500, '0');
    const goal = await createGoal(spaceId, { kind: 'purchase', nameEn: 'Underfunded bill' });
    await reserve(spaceId, goal.goalId, '50000', true);
    await saveSchedule(spaceId, { categoryId, expectedMinor: '50000', startsOn: TODAY, fundingGoalId: goal.goalId });
    await materialize(spaceId, TODAY, HORIZON_END);

    const result = await summary(spaceId);
    expect(result.cashMinor).toBe('20000');
    expect(result.goalClaimsMinor).toBe('50000');
    expect(result.groups[0]).toMatchObject({ budgetRemainingMinor: '50000', unpaidBillsMinor: '50000', goalOverlapMinor: '20000', commitmentMinor: '30000' });
    expect(result.availableMinor).toBe('-60000');
    expect(result.deficitMinor).toBe('60000');
    expect(result.spendableMinor).toBe('0');
    expect(result.dailyExtraGuideMinor).toBe('0');
  });
});

describe('dailyExtraGuideMinor is floor(spendable/daysRemaining), remainder retained not rounded up', () => {
  // The brief's own literal fixture ("available 1001, 3 days -> 333, not
  // 334") pins daysRemaining to a specific day-of-month this suite's dynamic
  // TODAY cannot reproduce on demand. Proved generically instead: probe the
  // real daysRemaining for an empty "ready" plan, then construct cash equal
  // to (daysRemaining * 100) + 1 so spendableMinor/daysRemaining never
  // divides evenly (unless today is the month's last day, when daysRemaining
  // is 1 and every integer divides evenly by definition -- guarded below).
  // The floor identity guide*days <= spendable < (guide+1)*days holds
  // unconditionally and is what actually distinguishes floor from round.
  async function emptyReadyPlan(name: string): Promise<{ spaceId: string; daysRemaining: number }> {
    const spaceId = await freshSpace(name);
    const templateId = await saveTemplate(spaceId, []);
    await publishV1({ spaceId, templateRevisionId: templateId, incomeMinor: '0' });
    const probe = await summary(spaceId);
    return { spaceId, daysRemaining: probe.daysRemaining };
  }

  it('retains a nonzero remainder instead of rounding the guide up', async () => {
    const { spaceId, daysRemaining } = await emptyReadyPlan('Floor division probe');
    const perDay = 100;
    const remainder = daysRemaining > 1 ? 1 : 0;
    const availableMinor = daysRemaining * perDay + remainder;
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, String(availableMinor));

    const result = await summary(spaceId);
    expect(result.daysRemaining).toBe(daysRemaining);
    expect(result.availableMinor).toBe(String(availableMinor));
    expect(result.spendableMinor).toBe(String(availableMinor));
    const guide = Number(result.dailyExtraGuideMinor);
    // The floor identity itself -- true for ANY daysRemaining, proving
    // "floor" rather than "round" regardless of which day of the month ran
    // this test.
    expect(guide * daysRemaining).toBeLessThanOrEqual(availableMinor);
    expect((guide + 1) * daysRemaining).toBeGreaterThan(availableMinor);
    if (daysRemaining > 1) {
      // On every day except a month's last, the constructed remainder is
      // genuinely retained in `available`, not folded into the guide.
      expect(guide).toBe(perDay);
      expect(availableMinor - guide * daysRemaining).toBe(remainder);
    }
  });
});

describe('goal-bill coverage: one goal funding two bills', () => {
  it('covers the older bill in full and the newer bill with the remainder', async () => {
    const spaceId = await freshSpace('Two bills one goal');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '30000');
    const category = await expenseCategory(spaceId, 'Utilities');
    const goal = await createGoal(spaceId, { kind: 'purchase', nameEn: 'Utilities fund' });
    await reserve(spaceId, goal.goalId, '30000');

    const scheduleA = await saveSchedule(spaceId, { categoryId: category, expectedMinor: '25000', startsOn: daysFromToday(5), fundingGoalId: goal.goalId, nameEn: 'A' });
    const scheduleB = await saveSchedule(spaceId, { categoryId: category, expectedMinor: '25000', startsOn: daysFromToday(20), fundingGoalId: goal.goalId, nameEn: 'B' });
    await materialize(spaceId, TODAY, HORIZON_END);

    const coverage = await db().client.query<{ occurrence_id: string; applied_minor: string }>(
      'select occurrence_id::text, applied_minor::text from private.planning_goal_bill_coverage($1,$2,$3::date,$4::date) order by occurrence_id',
      [spaceId, 'USD', TODAY, HORIZON_END],
    );
    const occA = (await occurrencesFor(scheduleA.scheduleId))[0]!;
    const occB = (await occurrencesFor(scheduleB.scheduleId))[0]!;
    const appliedA = coverage.rows.find((r) => r.occurrence_id === occA.id)!.applied_minor;
    const appliedB = coverage.rows.find((r) => r.occurrence_id === occB.id)!.applied_minor;
    expect(appliedA).toBe('25000');
    expect(appliedB).toBe('5000');
    const totalUncovered = (25000 - Number(appliedA)) + (25000 - Number(appliedB));
    expect(totalUncovered).toBe(20000);
  });
});

describe('Future group commitment formula', () => {
  it('Future30000, goal target20000, debt10000; contribution5000, paid4000 -> U15000,H0,Future commitment21000', async () => {
    const spaceId = await freshSpace('Future group formula');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '100000');
    const futureGroup = randomUUID();
    const templateId = await saveTemplate(spaceId, [templateGroup(futureGroup, 'future', 0, 3000)]);
    const goal = await createGoal(spaceId, { kind: 'reserve', nameEn: 'Future topup' });
    const loan = await freshLoan(spaceId, wallet, '10000');
    await setLoanMonthlyTarget(spaceId, loan, '10000');

    await publishV2({
      spaceId, templateRevisionId: templateId, incomeMinor: '100000',
      goalTargets: [goalTarget(goal.goalId, '20000', futureGroup)], loanGroupId: futureGroup,
    });

    // Live drift after publish: a payment is made and a contribution posted.
    await repayLoan(spaceId, loan, wallet, '4000');
    await setGoalMonthlyTarget(spaceId, goal.goalId, '20000');
    await reserve(spaceId, goal.goalId, '5000');

    const commitments = await queryPrivateAsActor<{
      group_id: string; group_target_minor: string; debt_commitment_minor: string; goal_topups_minor: string;
      saved_goal_targets_minor: string; original_debt_commitment_minor: string;
    }>(
      'select group_id::text, group_target_minor::text, debt_commitment_minor::text, goal_topups_minor::text, saved_goal_targets_minor::text, original_debt_commitment_minor::text from private.planning_cash_commitments($1,$2,$3::date) where group_id=$4',
      [spaceId, 'USD', TODAY, futureGroup],
    );
    const row = commitments.rows[0]!;
    expect(row.debt_commitment_minor).toBe('6000');
    expect(row.goal_topups_minor).toBe('15000');
    expect(row.original_debt_commitment_minor).toBe('10000');
    const headroom = Math.max(Number(row.group_target_minor) - Number(row.saved_goal_targets_minor) - Number(row.original_debt_commitment_minor), 0);
    expect(headroom).toBe(0);
    expect(Number(row.debt_commitment_minor) + Number(row.goal_topups_minor) + headroom).toBe(21000);

    const result = await summary(spaceId);
    const futureRow = result.groups.find((g) => g.id === futureGroup)!;
    expect(futureRow.commitmentMinor).toBe('21000');
  });

  it('debt commitment is max(reservation, scheduled remaining), never their sum', async () => {
    const spaceId = await freshSpace('Debt commitment max not sum');
    const wallet = await usdWallet(spaceId);
    const loan = await freshLoan(spaceId, wallet, '10000');
    await setLoanMonthlyTarget(spaceId, loan, '10000');
    await saveSchedule(spaceId, { kind: 'debt_payment', loanId: loan, categoryId: null, expectedMinor: '8000', startsOn: TODAY });
    await materialize(spaceId, TODAY, TODAY);

    const commitments = await queryPrivateAsActor<{ group_id: string | null; debt_commitment_minor: string }>(
      'select group_id::text, debt_commitment_minor::text from private.planning_cash_commitments($1,$2,$3::date) where group_id is null',
      [spaceId, 'USD', TODAY],
    );
    expect(commitments.rows[0]!.debt_commitment_minor).toBe('10000');
  });
});

describe('income vs. spending is a separate metric from available', () => {
  it('spend60000, income50000 -> incomeMinusSpending -10000 even if cash remains positive', async () => {
    const spaceId = await freshSpace('Income minus spending');
    const wallet = await usdWallet(spaceId);
    // Prior-month income keeps cash positive without counting toward this
    // month's receivedIncomeMinor, which is month-to-date by definition.
    await recordIncome(spaceId, wallet, '1000000', priorMonthAnchor());
    await recordIncome(spaceId, wallet, '50000');
    await recordExpense(spaceId, wallet, '60000');

    const result = await summary(spaceId);
    expect(result.receivedIncomeMinor).toBe('50000');
    expect(result.ordinarySpendingMinor).toBe('60000');
    expect(result.incomeMinusSpendingMinor).toBe('-10000');
    expect(Number(result.cashMinor)).toBeGreaterThan(0);
  });
});

describe('state machine', () => {
  it('returns state=unplanned with availableMinor null and no group rows when no snapshot exists', async () => {
    const spaceId = await freshSpace('Unplanned state');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '10000');

    const result = await summary(spaceId);
    expect(result.state).toBe('unplanned');
    expect(result.snapshotId).toBeNull();
    expect(result.availableMinor).toBeNull();
    expect(result.deficitMinor).toBeNull();
    expect(result.spendableMinor).toBeNull();
    expect(result.dailyExtraGuideMinor).toBeNull();
    expect(result.expenseCommitmentsMinor).toBeNull();
    expect(result.debtCommitmentsMinor).toBeNull();
    expect(result.groups).toEqual([]);
    expect(result.cashMinor).toBe('10000');
  });

  it('returns state=incomplete with availableMinor null when an active schedule has an unmaterialized occurrence in the needed window', async () => {
    const spaceId = await freshSpace('Incomplete state');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '10000');
    const templateId = await saveTemplate(spaceId, []);
    await publishV1({ spaceId, templateRevisionId: templateId, incomeMinor: '10000' });
    // An active schedule exists but nothing has ever been materialized for it.
    await saveSchedule(spaceId, { startsOn: TODAY });

    const result = await summary(spaceId);
    expect(result.state).toBe('incomplete');
    expect(result.availableMinor).toBeNull();
    expect(result.unmaterializedCount).toBeGreaterThan(0);
  });

  it('stays ready and flags needsReview when the live income target has changed since the saved snapshot', async () => {
    const spaceId = await freshSpace('Needs review');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '10000');
    const templateId = await saveTemplate(spaceId, []);
    const published = await publishV1({ spaceId, templateRevisionId: templateId, incomeMinor: '10000' });
    // Change the income plan directly (a later revision) without republishing.
    await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      'select public.set_monthly_income_plan($1,$2,$3::date,$4,$5,$6)',
      [spaceId, randomUUID(), MONTH, 'USD', '20000', Number(published.incomeRevisionId)],
    ));

    const result = await summary(spaceId);
    expect(result.state).toBe('ready');
    expect(result.needsReview).toBe(true);
    expect(result.availableMinor).not.toBeNull();
  });
});

describe('current-date rejection', () => {
  it('rejects an as-of date that is not the database UTC today', async () => {
    const spaceId = await freshSpace('Reject historical as-of');
    await expect(summary(spaceId, '2020-01-01')).rejects.toThrow();
  });
});

describe('space/currency isolation', () => {
  it('never mixes cash or commitments across spaces or currencies', async () => {
    const spaceA = await freshSpace('Isolation A');
    const spaceB = await freshSpace('Isolation B');
    const walletA = await usdWallet(spaceA);
    await recordIncome(spaceA, walletA, '77000');

    const resultA = await summary(spaceA);
    const resultB = await summary(spaceB);
    expect(resultA.cashMinor).toBe('77000');
    expect(resultB.cashMinor).toBe('0');

    const walletLbp = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query<{ id: string }>(
        "select id from public.create_wallet($1,'LBP cash','LBP') limit 2", [spaceA],
      );
      return result.rows[0]!.id;
    });
    await recordIncome(spaceA, walletLbp, '5000000');
    const resultLbp = await summary(spaceA, TODAY, 'LBP');
    expect(resultLbp.cashMinor).toBe('5000000');
    const resultUsdAgain = await summary(spaceA);
    expect(resultUsdAgain.cashMinor).toBe('77000');
  });
});

describe('skipped, partial and reversed bills', () => {
  it('excludes a skipped occurrence from unpaid bills entirely', async () => {
    const spaceId = await freshSpace('Skipped bill excluded');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '100000');
    const category = await expenseCategory(spaceId, 'Subscriptions');
    const groupId = randomUUID();
    const templateId = await saveTemplate(spaceId, [templateGroup(groupId, 'spending', 0, 5000)], [{ categoryId: category, groupId }]);
    await publishV1({ spaceId, templateRevisionId: templateId, incomeMinor: '100000', rootTargets: [rootTarget(category, '0')] });
    const schedule = await saveSchedule(spaceId, { categoryId: category, expectedMinor: '20000', startsOn: TODAY });
    await materialize(spaceId, TODAY, HORIZON_END);
    const [occurrence] = await occurrencesFor(schedule.scheduleId);
    await skipOccurrence(spaceId, occurrence!.id);

    const result = await summary(spaceId);
    expect(result.groups[0]).toMatchObject({ unpaidBillsMinor: '0', commitmentMinor: '50000' });
  });

  it('reduces unpaid bills by a partial payment and restores it after the payment is reversed', async () => {
    const spaceId = await freshSpace('Partial then reversed bill');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '100000');
    const category = await expenseCategory(spaceId, 'Insurance');
    const groupId = randomUUID();
    const templateId = await saveTemplate(spaceId, [templateGroup(groupId, 'spending', 0, 5000)], [{ categoryId: category, groupId }]);
    await publishV1({ spaceId, templateRevisionId: templateId, incomeMinor: '100000', rootTargets: [rootTarget(category, '0')] });
    const schedule = await saveSchedule(spaceId, { categoryId: category, expectedMinor: '20000', startsOn: TODAY });
    await materialize(spaceId, TODAY, HORIZON_END);
    const [occurrence] = await occurrencesFor(schedule.scheduleId);
    await confirmOccurrence(spaceId, occurrence!.id, '8000', wallet);

    const partial = await summary(spaceId);
    expect(partial.groups[0]!.unpaidBillsMinor).toBe('12000');

    const linked = await db().client.query<{ linked_event_id: string }>(
      "select linked_event_id::text from public.occurrence_events where occurrence_id=$1 and action='confirm'", [occurrence!.id],
    );
    await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      'select public.reverse_financial_event($1,$2,$3,$4::date)',
      [spaceId, randomUUID(), linked.rows[0]!.linked_event_id, TODAY],
    ));

    const afterReversal = await summary(spaceId);
    expect(afterReversal.groups[0]!.unpaidBillsMinor).toBe('20000');
  });
});

describe('goal-funded payment and its inverse', () => {
  it('reduces cash, claim and unpaid obligation together, then restores all three on reversal', async () => {
    const spaceId = await freshSpace('Goal funded payment inverse');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '100000');
    const category = await expenseCategory(spaceId, 'Gadget');
    const goal = await createGoal(spaceId, { kind: 'purchase', nameEn: 'Gadget fund' });
    await reserve(spaceId, goal.goalId, '30000');
    const schedule = await saveSchedule(spaceId, { categoryId: category, expectedMinor: '30000', startsOn: TODAY, fundingGoalId: goal.goalId });
    await materialize(spaceId, TODAY, HORIZON_END);
    const [occurrence] = await occurrencesFor(schedule.scheduleId);

    const before = await summary(spaceId);
    expect(before.cashMinor).toBe('100000');
    expect(before.goalClaimsMinor).toBe('30000');

    await confirmOccurrence(spaceId, occurrence!.id, '30000', wallet);
    const after = await summary(spaceId);
    expect(after.cashMinor).toBe('70000');
    expect(after.goalClaimsMinor).toBe('0');

    const linked = await db().client.query<{ linked_event_id: string }>(
      "select linked_event_id::text from public.occurrence_events where occurrence_id=$1 and action='confirm'", [occurrence!.id],
    );
    await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      'select public.reverse_financial_event($1,$2,$3,$4::date)',
      [spaceId, randomUUID(), linked.rows[0]!.linked_event_id, TODAY],
    ));
    const reversed = await summary(spaceId);
    expect(reversed.cashMinor).toBe('100000');
    expect(reversed.goalClaimsMinor).toBe('30000');
  });
});

describe('unmapped root and negative contribution', () => {
  it('forms its own standalone Q bucket for a root that has a target but no group', async () => {
    const spaceId = await freshSpace('Unmapped root standalone bucket');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '100000');
    const category = await expenseCategory(spaceId, 'Unmapped');
    const templateId = await saveTemplate(spaceId, []);
    await publishV1({ spaceId, templateRevisionId: templateId, incomeMinor: '100000', rootTargets: [rootTarget(category, '15000')] });
    await saveSchedule(spaceId, { categoryId: category, expectedMinor: '5000', startsOn: TODAY });
    await materialize(spaceId, TODAY, HORIZON_END);

    const result = await summary(spaceId);
    expect(result.groups).toEqual([]); // an unmapped root has no group row to display
    // B=15000 (unspent target), O=5000, G=0 -> Q=max(15000,5000)-0=15000.
    expect(result.expenseCommitmentsMinor).toBe('15000');
    expect(result.availableMinor).toBe(String(100000 - 15000));
  });

  it('increases the monthly topup when the net contribution is negative', async () => {
    const spaceId = await freshSpace('Negative contribution increases U');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '100000');
    const goal = await createGoal(spaceId, { kind: 'reserve', nameEn: 'Withdrawn from' });
    // record_goal_earmark always posts at today's date, so a genuinely
    // negative NET contribution THIS MONTH requires funding to already
    // exist from a prior month -- seeded directly (bypassing the command,
    // same pattern recurring-schedules.integration.test.ts's
    // freshPurchaseGoal uses) since there is no backdating command.
    await inTransaction(db().client, async () => {
      const priorEvent = await db().client.query<{ id: string }>(
        `insert into public.goal_earmark_events (space_id, currency, operation, line_count, effective_date, request_id, actor_id)
         values ($1,'USD','reserve',1,$2::date,$3,$4) returning id::text`,
        [spaceId, priorMonthAnchor(), randomUUID(), actor],
      );
      await db().client.query(
        `insert into public.goal_earmark_lines (event_id, goal_id, space_id, currency, amount_minor) values ($1,$2,$3,'USD',20000)`,
        [priorEvent.rows[0]!.id, goal.goalId, spaceId],
      );
    });
    await setGoalMonthlyTarget(spaceId, goal.goalId, '0');
    await release(spaceId, goal.goalId, '3000');

    const commitments = await queryPrivateAsActor<{ group_id: string | null; goal_topups_minor: string }>(
      'select group_id::text, goal_topups_minor::text from private.planning_cash_commitments($1,$2,$3::date) where group_id is null',
      [spaceId, 'USD', TODAY],
    );
    // saved target 0, net contribution -3000 -> U=max(0-(-3000),0)=3000.
    expect(commitments.rows[0]!.goal_topups_minor).toBe('3000');
  });
});

describe('late-created old-date payment', () => {
  it('still reduces cash through effective_date, not created_at', async () => {
    const spaceId = await freshSpace('Late created old date payment');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '100000', '2026-01-05');
    await recordExpense(spaceId, wallet, '15000', '2026-01-10');

    const result = await summary(spaceId);
    expect(result.cashMinor).toBe('85000');
  });
});

describe('numeric bounds', () => {
  it('returns an aggregate exceeding the JS-safe integer range as exact text', async () => {
    const spaceId = await freshSpace('JS unsafe integer text');
    const wallet = await usdWallet(spaceId);
    // Individual amounts are capped at 999999999999999 (01-sql-contract); the
    // AGGREGATE must still exceed Number.MAX_SAFE_INTEGER (9007199254740991)
    // and come back as exact text, not a float-rounded aggregate. Ten
    // postings at the per-transaction cap comfortably clears it.
    const perPosting = '999999999999999';
    for (let i = 0; i < 10; i += 1) {
      await recordIncome(spaceId, wallet, perPosting, TODAY);
    }
    const expected = (BigInt(perPosting) * 10n).toString();
    expect(Number(expected)).toBeGreaterThan(Number.MAX_SAFE_INTEGER);

    const result = await summary(spaceId);
    expect(result.cashMinor).toBe(expected);
  });
});

describe('components sum back to available exactly', () => {
  it('reconstructs available from its reported components for a multi-component fixture', async () => {
    const spaceId = await freshSpace('Components sum back');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '500000');
    const category = await expenseCategory(spaceId, 'Groceries');
    const spendingGroup = randomUUID();
    const futureGroup = randomUUID();
    const templateId = await saveTemplate(spaceId, [
      templateGroup(spendingGroup, 'spending', 0, 2000),
      templateGroup(futureGroup, 'future', 1, 1000),
    ], [{ categoryId: category, groupId: spendingGroup }]);
    const goal = await createGoal(spaceId, { kind: 'reserve', nameEn: 'Future goal' });
    await reserve(spaceId, goal.goalId, '10000');
    const loan = await freshLoan(spaceId, wallet, '8000');
    await setLoanMonthlyTarget(spaceId, loan, '8000');

    await publishV2({
      spaceId, templateRevisionId: templateId, incomeMinor: '500000',
      rootTargets: [rootTarget(category, '40000')],
      goalTargets: [goalTarget(goal.goalId, '15000', futureGroup)], loanGroupId: futureGroup,
    });
    await saveSchedule(spaceId, { categoryId: category, expectedMinor: '25000', startsOn: TODAY });
    await materialize(spaceId, TODAY, HORIZON_END);

    const result = await summary(spaceId);
    const reconstructed = Number(result.cashMinor) - Number(result.goalClaimsMinor)
      - Number(result.expenseCommitmentsMinor) - Number(result.debtCommitmentsMinor)
      - Number(result.goalTopupsMinor) - Number(result.futureHeadroomMinor);
    expect(String(reconstructed)).toBe(result.availableMinor);
  });
});

describe('outsider access', () => {
  it('rejects a caller who is not an active member of the space', async () => {
    const spaceId = await freshSpace('Outsider denied availability');
    await expect(withAuthenticatedTransaction(db().client, outsider, () => db().client.query(
      'select public.available_cash_summary($1,$2,$3::date)', [spaceId, 'USD', TODAY],
    ))).rejects.toThrow();
  });
});

async function financialDigest(spaceId: string): Promise<unknown> {
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
  for (const row of result.rows as Array<{ row_count: string }>) {
    expect(Number(row.row_count)).toBeLessThanOrEqual(100);
  }
  return result.rows;
}

describe('read-only: never moves money', () => {
  it('leaves the financial journal digest unchanged across repeated calls to both projections', async () => {
    const spaceId = await freshSpace('Digest unchanged');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '50000');
    const loan = await freshLoan(spaceId, wallet, '5000');
    await setLoanMonthlyTarget(spaceId, loan, '5000');
    const templateId = await saveTemplate(spaceId, []);
    await publishV1({ spaceId, templateRevisionId: templateId, incomeMinor: '50000' });
    await saveSchedule(spaceId, { startsOn: TODAY });
    await materialize(spaceId, TODAY, HORIZON_END);

    const before = await financialDigest(spaceId);
    await summary(spaceId);
    await summary(spaceId);
    await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      'select public.cash_outlook($1,$2,$3::date,$4,$5)', [spaceId, 'USD', TODAY, 30, 'expected'],
    ));
    const after = await financialDigest(spaceId);
    expect(after).toEqual(before);
  });
});

describe('SQL privilege matrix', () => {
  it('grants EXECUTE on the two public RPCs only to authenticated (PUBLIC/anon/service_role excluded)', async () => {
    const functions = ['available_cash_summary', 'cash_outlook'];
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

  it('grants EXECUTE on none of the five new private helpers to any of PUBLIC/anon/authenticated/service_role', async () => {
    const functions = [
      'planning_goal_bill_coverage', 'planning_expense_buckets', 'planning_cash_commitments',
      'planning_materialization_gap', 'planning_unpaid_backlog_count',
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
       where n.nspname = 'private' and p.proname = any($1::text[])`,
      [functions],
    );
    expect(result.rows.map((row) => row.proname).sort()).toEqual([...functions].sort());
    for (const row of result.rows) {
      expect(row.public_exec, `${row.proname} must not be executable by PUBLIC`).toBe(false);
      expect(row.anon_exec, `${row.proname} must not be executable by anon`).toBe(false);
      expect(row.authenticated_exec, `${row.proname} must not be directly executable by authenticated`).toBe(false);
      expect(row.service_exec, `${row.proname} must not be executable by service_role`).toBe(false);
    }
  });

  it('rejects anon and service_role calling the public RPCs directly', async () => {
    const spaceId = await freshSpace('Role rejection probe');
    await withRollback(db().client, async () => {
      await db().client.query('set local role anon');
      await expect(db().client.query(
        'select public.available_cash_summary($1,$2,$3::date)', [spaceId, 'USD', TODAY],
      )).rejects.toMatchObject({ code: '42501' });
    });
    await withRollback(db().client, async () => {
      await db().client.query('set local role service_role');
      await expect(db().client.query(
        'select public.cash_outlook($1,$2,$3::date,$4,$5)', [spaceId, 'USD', TODAY, 5, 'expected'],
      )).rejects.toMatchObject({ code: '42501' });
    });
  });
});

describe('EXPLAIN on a realistic 90-day fixture', () => {
  it('records the query plan for available_cash_summary over a full plan with multiple groups, goals and bills', async () => {
    const spaceId = await freshSpace('Explain fixture');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '2000000');
    // Sequential, not Promise.all: the harness shares one pg client per
    // test, which cannot run overlapping queries concurrently.
    const categories: string[] = [];
    for (const name of ['Rent', 'Groceries', 'Utilities', 'Transport']) {
      categories.push(await expenseCategory(spaceId, name));
    }
    const groupA = randomUUID();
    const groupB = randomUUID();
    const futureGroup = randomUUID();
    const templateId = await saveTemplate(spaceId, [
      templateGroup(groupA, 'spending', 0, 3000),
      templateGroup(groupB, 'spending', 1, 2000),
      templateGroup(futureGroup, 'future', 2, 1500),
    ], [
      { categoryId: categories[0], groupId: groupA },
      { categoryId: categories[1], groupId: groupA },
      { categoryId: categories[2], groupId: groupB },
      { categoryId: categories[3], groupId: groupB },
    ]);
    const goals = [
      await createGoal(spaceId, { kind: 'purchase', nameEn: 'Bill fund' }),
      await createGoal(spaceId, { kind: 'reserve', nameEn: 'Future topup' }),
    ];
    await reserve(spaceId, goals[0]!.goalId, '30000');
    await reserve(spaceId, goals[1]!.goalId, '20000');
    const loan = await freshLoan(spaceId, wallet, '15000');
    await setLoanMonthlyTarget(spaceId, loan, '15000');

    await publishV2({
      spaceId, templateRevisionId: templateId, incomeMinor: '2000000',
      rootTargets: categories.map((c) => rootTarget(c, '20000')),
      goalTargets: [goalTarget(goals[1]!.goalId, '10000', futureGroup)], loanGroupId: futureGroup,
    });

    // Spread ~20 bills (weekly/monthly, across four categories) over the
    // full 90-day window, some already overdue, some funded by the goal.
    for (let i = 0; i < 20; i += 1) {
      const category = categories[i % categories.length]!;
      const dayOffset = i * 4 - 10; // runs from 10 days overdue to ~70 days out
      const date = new Date(`${TODAY}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + dayOffset);
      await saveSchedule(spaceId, {
        categoryId: category, expectedMinor: String(5000 + i * 100), startsOn: date.toISOString().slice(0, 10),
        cadence: 'monthly', fundingGoalId: i % 5 === 0 ? goals[0]!.goalId : null, nameEn: `Bill ${i}`,
      });
    }
    await materialize(spaceId, TODAY, HORIZON_END);

    const plan = await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      "explain (analyze, buffers, format text) select public.available_cash_summary($1,$2,$3::date)",
      [spaceId, 'USD', TODAY],
    ));
    const planText = plan.rows.map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log('EXPLAIN available_cash_summary (90-day, multi-group fixture):\n', planText);
    expect(planText).toContain('Execution Time');

    // The outer EXPLAIN above is necessarily opaque (SECURITY DEFINER
    // functions are never inlined by the planner, by design -- inlining
    // would silently change the effective privilege of the inner queries),
    // so it shows only a single Result node's total latency. To also show
    // index usage on the actual hot path, EXPLAIN the same-shaped queries
    // planning_expense_buckets and planning_goal_bill_coverage run
    // internally, directly, against the same fixture data.
    // scheduled_occurrences/wallet_movements are revoked from `authenticated`
    // entirely (read access is only through a SECURITY DEFINER function), so
    // this supplementary raw-table EXPLAIN runs on the powerful connecting
    // role -- the same access level the migration owner's DEFINER functions
    // themselves use internally, not a broadened application grant.
    const billScanPlan = await db().client.query(
      `explain (analyze, buffers, format text)
       select so.id, so.due_date, so.expected_minor
       from public.scheduled_occurrences so
       join public.schedules sch on sch.id = so.schedule_id and sch.space_id = so.space_id and sch.kind = 'expense'
       where so.space_id = $1 and so.currency = 'USD' and so.due_date <= $2::date`,
      [spaceId, HORIZON_END],
    );
    const billScanText = billScanPlan.rows.map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log('EXPLAIN unpaid-bill scan (scheduled_occurrences_page_idx path):\n', billScanText);
    expect(billScanText).toMatch(/Index Scan|Bitmap/);

    const cashScanPlan = await db().client.query(
      `explain (analyze, buffers, format text)
       select sum(m.amount_minor) from public.wallet_movements m
       join public.wallets w on w.id = m.wallet_id and w.space_id = m.space_id
       join public.financial_events e on e.id = m.event_id and e.space_id = m.space_id
       where m.space_id = $1 and w.currency = 'USD' and e.effective_date <= $2::date`,
      [spaceId, TODAY],
    );
    const cashScanText = cashScanPlan.rows.map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log('EXPLAIN cash-pool scan (financial_events_space_date_idx path):\n', cashScanText);
    expect(cashScanText).toContain('Execution Time');
  });

  it('records the query plan for cash_outlook over the same 90-day fixture shape', async () => {
    const spaceId = await freshSpace('Explain outlook fixture');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '500000');
    for (let i = 0; i < 15; i += 1) {
      const date = new Date(`${TODAY}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + i * 5);
      await saveSchedule(spaceId, { kind: i % 4 === 0 ? 'income' : 'expense', expectedMinor: String(3000 + i * 50), startsOn: date.toISOString().slice(0, 10), nameEn: `Item ${i}` });
    }
    await materialize(spaceId, TODAY, HORIZON_END);

    const plan = await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      "explain (analyze, buffers, format text) select public.cash_outlook($1,$2,$3::date,$4,$5)",
      [spaceId, 'USD', TODAY, 90, 'expected'],
    ));
    const planText = plan.rows.map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log('EXPLAIN cash_outlook (90-day fixture):\n', planText);
    expect(planText).toContain('Execution Time');
  });
});
