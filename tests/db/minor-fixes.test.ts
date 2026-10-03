import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callAs, createUser } from './support/actor.ts';
import { setupSpace } from './support/budget.ts';
import { freshDatabase, type TestDatabase } from './support/database.ts';
import { currentPlan, monthOf } from './support/plan.ts';

let db: TestDatabase;

beforeAll(async () => {
  db = await freshDatabase();
});

afterAll(async () => {
  await db.close();
});

function addMonths(day: string, months: number): string {
  const date = new Date(`${day.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe('overdue bills stay visible for a year, not 92 days', () => {
  it('lists every unpaid occurrence of the last five months', async () => {
    const h = await setupSpace(db.pool);
    const first = addMonths(h.today, -5);
    await h.command('save_bill', { p_name: 'Gym', p_item: await h.item('Fun'), p_amount: 3000n, p_currency: 'USD', p_cadence: 'monthly', p_first_due: first });
    const rows = await h.call<{ status: string; dueOn: string }[]>('bills_upcoming', { p_space: h.spaceId, p_from: h.today, p_to: addDays(h.today, 31) });
    const expected = Array.from({ length: 6 }, (_, index) => addMonths(first, index)).filter((due) => due < h.today).length;
    expect(rows.filter((row) => row.status === 'overdue')).toHaveLength(expected);
  });
});

describe('create_space replays safely', () => {
  it('returns one space for concurrent identical requests', async () => {
    const userId = await createUser(db.pool);
    const request = randomUUID();
    const results = await Promise.all(Array.from({ length: 4 }, () => callAs<{ spaceId: string }>(db.pool, userId, 'create_space', { p_request: request, p_name: 'Twice' })));
    expect(new Set(results.map((result) => result.spaceId)).size).toBe(1);
  });

  it('refuses a reused request id with a different name', async () => {
    const userId = await createUser(db.pool);
    const request = randomUUID();
    await callAs(db.pool, userId, 'create_space', { p_request: request, p_name: 'First' });
    await expect(callAs(db.pool, userId, 'create_space', { p_request: request, p_name: 'Second' })).rejects.toMatchObject({ message: 'BUDGET_REQUEST_CONFLICT' });
  });
});

describe('months before the first plan', () => {
  it('still show the groups (with nothing planned) and the ready balance at month end', async () => {
    const h = await setupSpace(db.pool);
    const bank = await h.wallet('Bank', 'cash', 'USD', 10000n, { p_opened_on: addMonths(h.today, -1) });
    void bank;
    const past = await h.call<{ expectedIncome: string; groups: { nameEn: string; planned: string }[]; readyAtMonthEnd: string }>('plan_month', { p_space: h.spaceId, p_month: addMonths(h.today, -1) });
    expect(past.groups.map((group) => group.nameEn)).toEqual(['Essentials', 'Guilt free', 'Short-term goals', 'Savings', 'Investments']);
    expect(past.groups.every((group) => group.planned === '0')).toBe(true);
    expect(past.expectedIncome).toBe('0');
    expect(past.readyAtMonthEnd).toBe('10000');
  });
});

describe('a skipped bill can be un-skipped', () => {
  it('makes the occurrence payable again', async () => {
    const h = await setupSpace(db.pool);
    const bank = await h.wallet('Bank', 'cash', 'USD', 10000n);
    const bill = (await h.command<{ billId: string }>('save_bill', { p_name: 'Water', p_item: await h.item('Bills'), p_amount: 1000n, p_currency: 'USD', p_cadence: 'monthly', p_first_due: h.today })).billId;
    await h.command('skip_bill', { p_bill: bill, p_due: h.today });
    await h.command('unskip_bill', { p_bill: bill, p_due: h.today });
    const rows = await h.call<{ billId: string; status: string }[]>('bills_upcoming', { p_space: h.spaceId, p_from: h.today, p_to: h.today });
    expect(rows.find((row) => row.billId === bill)?.status).toBe('due');
    await expect(h.command('record_expense', { p_wallet: bank, p_item: await h.item('Bills'), p_amount: 1000n, p_on: h.today, p_bill: bill, p_bill_due: h.today })).resolves.toHaveProperty('entryId');
    await expect(h.command('unskip_bill', { p_bill: bill, p_due: h.today })).rejects.toMatchObject({ message: 'BUDGET_BILL_NOT_SKIPPED' });
  });
});

describe('plan revisions never repeat within a space', () => {
  it('refuses a second editor still holding the earlier month’s revision', async () => {
    const h = await setupSpace(db.pool);
    const next = monthOf(h.today, 1);
    const seen = await currentPlan(db.pool, h.spaceId, next);
    await h.command('save_plan', { p_month: next, p_expected_revision: seen.revision, p_plan: seen.payload });
    await expect(h.command('save_plan', { p_month: next, p_expected_revision: seen.revision, p_plan: seen.payload })).rejects.toMatchObject({ message: 'BUDGET_STALE_PLAN' });
  });
});

describe('ratchet: only signed-in users can execute public functions', () => {
  const exposed = `
    select p.oid::regprocedure::text as fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('service_role', p.oid, 'execute')
        or not has_function_privilege('authenticated', p.oid, 'execute'))`;

  it('finds no public function executable by anon or service_role', async () => {
    const result = await db.pool.query<{ fn: string }>(exposed);
    expect(result.rows).toEqual([]);
  });

  it('would catch a new function that forgets its revoke', async () => {
    const client = await db.pool.connect();
    try {
      await client.query('begin');
      await client.query('create function public.forgot_revoke() returns int language sql as $$ select 1 $$');
      const result = await client.query<{ fn: string }>(exposed);
      expect(result.rows.map((row) => row.fn)).toContain('forgot_revoke()');
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
