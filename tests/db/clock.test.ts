import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { freshDatabase, type TestDatabase } from './support/database.ts';
import { setupSpace } from './support/budget.ts';
import { asAnon, asUser } from './support/actor.ts';
import { readFile } from 'node:fs/promises';

let db: TestDatabase;
beforeAll(async () => { db = await freshDatabase(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.setClock(null); });

it('provides a private clock helper that API roles cannot execute', async () => {
  const result = await db.pool.query<{ exists: boolean; exposed: boolean }>(`
    select to_regprocedure('budget.clock_now()') is not null as exists,
      exists(select 1 from pg_proc p where p.oid = to_regprocedure('budget.clock_now()')
        and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('service_role', p.oid, 'execute'))) as exposed`);
  expect(result.rows[0]).toEqual({ exists: true, exposed: false });
});

it('rejects tomorrow before Beirut midnight and accepts it at midnight', async () => {
  await db.setClock('2026-09-30T20:59:59Z');
  const h = await setupSpace(db.pool);
  const wallet = await h.wallet('Cash', 'cash', 'USD');
  await expect(h.command('record_income', { p_wallet: wallet, p_amount: 100n, p_on: '2026-10-01' }))
    .rejects.toMatchObject({ message: 'BUDGET_FUTURE_DATE' });
  await expect(h.command('set_reference_rate', { p_currency: 'LBP', p_units_per_usd: 89500, p_effective: '2026-10-01' }))
    .rejects.toMatchObject({ message: 'BUDGET_INVALID_RATE' });
  expect(await h.call('clock_today')).toBe('2026-09-30');
  await db.setClock('2026-09-30T21:00:00Z');
  expect(await h.call('clock_today')).toBe('2026-10-01');
  await expect(h.command('record_income', { p_wallet: wallet, p_amount: 100n, p_on: '2026-10-01' })).resolves.toHaveProperty('entryId');
  await expect(h.command('set_reference_rate', { p_currency: 'LBP', p_units_per_usd: 89500, p_effective: '2026-10-01' })).resolves.toEqual({ ok: true });
});

it('switches my_spaces, overview and plan_month at Beirut month end', async () => {
  await db.setClock('2026-09-30T20:59:59Z');
  const h = await setupSpace(db.pool);
  for (const [instant, today, month] of [
    ['2026-09-30T20:59:59Z', '2026-09-30', '2026-09-01'],
    ['2026-09-30T21:00:00Z', '2026-10-01', '2026-10-01'],
  ]) {
    await db.setClock(instant!);
    const spaces = await h.call<{ id: string; today: string; currentMonth: string }[]>('my_spaces');
    expect(spaces.find((space) => space.id === h.spaceId)).toMatchObject({ today, currentMonth: month });
    expect(await h.call('space_overview', { p_space: h.spaceId })).toMatchObject({ today, month });
    expect(await h.call('plan_month', { p_space: h.spaceId, p_month: month })).toMatchObject({ today, month, isCurrent: true, isPast: false });
    expect(await h.call('plan_month', { p_space: h.spaceId, p_month: '2026-09-01' })).toMatchObject({ isCurrent: month === '2026-09-01', isPast: month === '2026-10-01' });
  }
});

it('includes a bill due on the first in coverage only once Beirut enters its month', async () => {
  await db.setClock('2026-09-30T20:59:59Z');
  const h = await setupSpace(db.pool);
  await h.wallet('Cash', 'cash', 'USD', 10000n);
  const item = await h.item('Bills');
  await h.command('assign_money', { p_on: '2026-09-30', p_moves: [{ from: null, to: item, currency: 'USD', amountMinor: '5000' }] });
  const bill = await h.command<{ billId: string }>('save_bill', { p_name: 'Internet', p_item: item, p_amount: 5000n, p_currency: 'USD', p_cadence: 'monthly', p_first_due: '2026-10-01' });
  const occurrence = async () => (await h.call<{ billId: string; coverage: string | null; dueOn: string }[]>('bills_upcoming', { p_space: h.spaceId, p_from: '2026-10-01', p_to: '2026-10-31' })).find((row) => row.billId === bill.billId);
  expect(await occurrence()).toMatchObject({ dueOn: '2026-10-01', coverage: null });
  await db.setClock('2026-09-30T21:00:00Z');
  expect(await occurrence()).toMatchObject({ dueOn: '2026-10-01', coverage: 'covered' });
});

it('uses image tzdata across the repeated Beirut hour at the October DST change', async () => {
  await db.setClock('2026-10-24T20:30:00Z');
  const h = await setupSpace(db.pool);
  for (const [instant, local, today] of [
    ['2026-10-24T20:30:00Z', '2026-10-24 23:30:00', '2026-10-24'],
    ['2026-10-24T21:30:00Z', '2026-10-24 23:30:00', '2026-10-24'],
    ['2026-10-24T22:00:00Z', '2026-10-25 00:00:00', '2026-10-25'],
  ]) {
    await db.setClock(instant!);
    const result = await db.pool.query<{ local: string; today: string }>(`select to_char(budget.clock_now() at time zone 'Asia/Beirut', 'YYYY-MM-DD HH24:MI:SS') as local, budget.space_today($1)::text as today`, [h.spaceId]);
    expect(result.rows[0], instant).toEqual({ local, today });
    expect(await h.call('clock_today'), instant).toBe(today);
    expect(await h.call('plan_month', { p_space: h.spaceId, p_month: '2026-10-01' }), instant).toMatchObject({ today, isCurrent: true });
  }
});

it('isolates pinned clocks between clones and restores transaction now by default', async () => {
  const other = await freshDatabase();
  try {
    await db.setClock('1900-01-01T00:00:00Z');
    expect((await other.pool.query('select budget.clock_now() = now() as real')).rows[0]).toEqual({ real: true });
    await other.setClock('2099-01-01T00:00:00Z');
    expect((await db.pool.query('select budget.clock_now()::text as instant')).rows[0].instant).toContain('1900-01-01');
    await db.setClock(null);
    expect((await db.pool.query('select budget.clock_now() = now() as real')).rows[0]).toEqual({ real: true });
  } finally { await other.close(); }
});

it('denies API access to the test clock and production clock always uses transaction now', async () => {
  const production = await freshDatabase();
  try {
    await production.setClock('1900-01-01T00:00:00Z');
    const migration = await readFile('supabase/migrations/20261008130000_budget_clock.sql', 'utf8');
    await production.pool.query(migration.replace('create function budget.clock_now()', 'create or replace function budget.clock_now()'));
    expect((await production.pool.query('select budget.clock_now() = now() as real')).rows[0]).toEqual({ real: true });
    const h = await setupSpace(production.pool);
    await expect(asUser(production.pool, h.userId, (client) => client.query("update budget_test.clock set instant = '1901-01-01'"))).rejects.toMatchObject({ code: '42501' });
    await expect(asAnon(production.pool, (client) => client.query('select budget.clock_now()'))).rejects.toMatchObject({ code: '42501' });
    const privileges = await production.pool.query(`select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role') and has_function_privilege(rolname, 'budget.clock_now()', 'execute')`);
    expect(privileges.rows).toEqual([]);
  } finally { await production.close(); }
});

// Examine the live catalog, so superseded migration definitions do not cause
// false positives. Timestamp-only audit statements remain permitted.
async function directDateClocks(): Promise<string[]> {
  const result = await db.pool.query<{ name: string; body: string; returns_date: boolean }>(`select p.oid::regprocedure::text as name, p.prosrc as body, p.prorettype = 'date'::regtype as returns_date
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('budget', 'public') and p.prokind = 'f'`);
  return result.rows.filter(({ body, returns_date }) => {
    const sql = body.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').toLowerCase();
    if (/\bcurrent_date\b/.test(sql)) return true;
    const clock = /\b(?:now|transaction_timestamp|statement_timestamp|clock_timestamp)\s*\(\s*\)|\bcurrent_timestamp\b/;
    if (returns_date && clock.test(sql)) return true;
    const dateVars = [...sql.matchAll(/\b([a-z_]\w*)\s+date\b/g)].map((match) => match[1]!);
    return sql.split(';').some((statement) => clock.test(statement) && (
      /::\s*date\b|\bas\s+date\b|\bat\s+time\s+zone\b|\bdate_trunc\s*\(|\bextract\s*\(\s*(?:year|month|day)|\bto_char\s*\(/.test(statement)
      || dateVars.some((name) => new RegExp(`\\b${name}\\s*(?::=|=|default)`).test(statement))
    ));
  }).map(({ name }) => name).sort();
}

it('ratchets all business-date clock conversion through the private helper', async () => {
  expect(await directDateClocks()).toEqual([]);
  await db.pool.query(`
    create function budget.clock_regression_cast() returns date language sql as $$ select now()::date $$;
    create function budget.clock_regression_current() returns date language sql as $$ select current_date $$;
    create function budget.clock_regression_trunc() returns timestamptz language sql as $$ select date_trunc('month', now()) $$;
    create function budget.clock_audit_allowed() returns timestamptz language sql as $$ select now() $$;
  `);
  try {
    expect(await directDateClocks()).toEqual(['budget.clock_regression_cast()', 'budget.clock_regression_current()', 'budget.clock_regression_trunc()']);
  } finally {
    await db.pool.query('drop function budget.clock_regression_cast(), budget.clock_regression_current(), budget.clock_regression_trunc(), budget.clock_audit_allowed()');
  }
});

it('clamps item_statement balances to the pinned space date across DST midnight', async () => {
  await db.setClock('2026-10-24T22:00:00Z');
  const h = await setupSpace(db.pool);
  const wallet = await h.wallet('Cash', 'cash', 'USD');
  const item = await h.item('Bills');
  await h.command('record_income', { p_wallet: wallet, p_amount: 5000n, p_on: '2026-10-25' });
  await h.command('assign_money', { p_on: '2026-10-25', p_moves: [{ from: null, to: item, currency: 'USD', amountMinor: '5000' }] });
  for (const [instant, balance] of [
    ['2026-10-24T21:30:00Z', '0'],
    ['2026-10-24T22:00:00Z', '5000'],
  ]) {
    await db.setClock(instant!);
    expect(await h.call('item_statement', { p_space: h.spaceId, p_item: item, p_month: '2026-10-01' })).toMatchObject({ balances: { USD: balance } });
  }
});
