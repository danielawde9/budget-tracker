import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase, databaseClient,
  disposeDisposableDatabase, expectSavepointRejection, migrationFiles, orderedAuthenticatedRace,
  replayMigrations, withAuthenticatedTransaction, withRollback,
  type DisposableDatabase,
} from './disposable-database.js';

// Task 20 (month copy, close and signed rollover): the close half. Real
// PostgreSQL, real commands; owner-level inserts only where a test proves a
// schema layer independently of the commands.

let database: DisposableDatabase | undefined;
const actor = randomUUID();
const outsider = randomUUID();
const monthTransitionsVersion = '20260916100000';

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_monthclose');
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

// A close requires the UTC month to have ended, so fixtures are relative to
// the real calendar rather than hardcoded dates that silently age.
function monthStart(offset: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
}
function dayOf(month: string, day: number): string {
  return `${month.slice(0, 8)}${String(day).padStart(2, '0')}`;
}
const CLOSED_MONTH = monthStart(-3);
const LATER_MONTH = monthStart(-2);
const HEX64 = /^[0-9a-f]{64}$/;

async function rpc<T>(sql: string, params: unknown[], userId = actor): Promise<T> {
  return withAuthenticatedTransaction(db().client, userId, async () => {
    const result = await db().client.query(sql, params);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error('rpc returned no row');
    return Object.values(row)[0] as T;
  });
}

async function freshSpace(name: string, kind: 'personal' | 'household' = 'personal'): Promise<string> {
  return rpc<string>('select id from public.create_space($1, $2) limit 2', [name, kind]);
}
async function expenseRoot(spaceId: string, name: string): Promise<string> {
  return rpc<string>("select id from public.create_category($1,$2,'expense',$3,null) limit 2", [spaceId, randomUUID(), name]);
}
async function usdWallet(spaceId: string): Promise<string> {
  return rpc<string>("select id from public.create_wallet($1,'Cash','USD') limit 2", [spaceId]);
}
async function spend(spaceId: string, walletId: string, categoryId: string, date: string, amountMinor: string): Promise<string> {
  return rpc<string>(
    "select id from public.record_categorized_financial_event($1,$2,'expense',$3::date,$4::jsonb,$5) limit 2",
    [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor: `-${amountMinor}` }]), categoryId],
  );
}
async function spendUncategorized(spaceId: string, walletId: string, date: string, amountMinor: string): Promise<string> {
  return rpc<string>(
    "select id from public.record_financial_event($1,$2,'expense',$3::date,$4::jsonb) limit 2",
    [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor: `-${amountMinor}` }])],
  );
}
async function earn(spaceId: string, walletId: string, date: string, amountMinor: string): Promise<string> {
  return rpc<string>(
    "select id from public.record_financial_event($1,$2,'income',$3::date,$4::jsonb) limit 2",
    [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor }])],
  );
}
async function reverse(spaceId: string, eventId: string, date: string): Promise<string> {
  return rpc<string>('select id from public.reverse_financial_event($1,$2,$3,$4::date) limit 2', [spaceId, randomUUID(), eventId, date]);
}

interface Planned {
  spaceId: string; walletId: string; groupId: string; templateId: string;
  rootA: string; rootB: string; snapshotId: string;
}

async function publish(input: {
  spaceId: string; month: string; templateId: string; incomeMinor: string;
  roots: Array<{ categoryId: string; amountMinor: string }>; expectedSnapshotId?: string | null;
}): Promise<string> {
  const heads = await db().client.query<{ category_id: string | null; plan_kind: string; id: string }>(
    `select distinct on (plan_kind, category_id) category_id::text, plan_kind, id::text
     from public.monthly_budget_plan_revisions
     where space_id = $1 and month_start = $2::date and currency = 'USD'
     order by plan_kind, category_id, id desc`,
    [input.spaceId, input.month],
  );
  const incomeHead = heads.rows.find((row) => row.plan_kind === 'income')?.id ?? null;
  const rootTargets = input.roots.map((root) => ({
    categoryId: root.categoryId, amountMinor: root.amountMinor,
    expectedRevisionId: heads.rows.find((row) => row.category_id === root.categoryId)?.id ?? null,
  }));
  const result = await rpc<{ snapshotId: string }>(
    'select public.publish_allocation_month_v2($1,$2,$3::date,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb)',
    [input.spaceId, randomUUID(), input.month, 'USD', input.expectedSnapshotId ?? null, input.templateId,
      incomeHead, input.incomeMinor, JSON.stringify(rootTargets), null, '[]'],
  );
  return result.snapshotId;
}

async function plannedSpace(name: string, targets: { a: string; b: string } = { a: '10000', b: '10000' }): Promise<Planned> {
  const spaceId = await freshSpace(name);
  const walletId = await usdWallet(spaceId);
  const rootA = await expenseRoot(spaceId, 'Groceries');
  const rootB = await expenseRoot(spaceId, 'Transport');
  const groupId = randomUUID();
  const template = await rpc<{ templateRevisionId: string }>(
    'select public.save_allocation_template($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
    [spaceId, randomUUID(), 'USD', null,
      JSON.stringify([{ id: groupId, purpose: 'spending', nameEn: 'Living', nameAr: null, order: 0, basisPoints: 5000 }]),
      JSON.stringify([{ categoryId: rootA, groupId }, { categoryId: rootB, groupId }])],
  );
  const snapshotId = await publish({
    spaceId, month: CLOSED_MONTH, templateId: template.templateRevisionId, incomeMinor: '100000',
    roots: [{ categoryId: rootA, amountMinor: targets.a }, { categoryId: rootB, amountMinor: targets.b }],
  });
  return { spaceId, walletId, groupId, templateId: template.templateRevisionId, rootA, rootB, snapshotId };
}

async function setPolicy(spaceId: string, rootId: string, enabled: boolean, expectedRevisionId: string | null = null): Promise<string> {
  const result = await rpc<{ revisionId: string }>(
    'select public.set_rollover_policy($1,$2,$3,$4,$5,$6)', [spaceId, randomUUID(), 'USD', rootId, enabled, expectedRevisionId],
  );
  return result.revisionId;
}

interface CloseRoot {
  categoryId: string; nameEn: string | null; nameAr: string | null; groupId: string | null;
  baseMinor: string; carryMinor: string; effectiveMinor: string; actualMinor: string; outgoingCarryMinor: string;
  enabled: boolean; policyRevisionId: string | null; carrySourceCloseId: string | null;
}
interface ClosePreview {
  previewHash: string; month: string; currency: string; expectedCloseId: string | null; snapshotId: string;
  incomeMinor: string; spendingMinor: string; factCount: string; factDigest: string;
  restatementRequired: boolean; roots: CloseRoot[];
}
interface CloseResult { closeId: string; previewHash: string; restatesCloseId: string | null }

async function previewClose(spaceId: string, month = CLOSED_MONTH, expectedCloseId: string | null = null, userId = actor): Promise<ClosePreview> {
  return rpc<ClosePreview>('select public.preview_budget_month_close($1,$2,$3::date,$4)', [spaceId, 'USD', month, expectedCloseId], userId);
}
async function closeMonth(spaceId: string, preview: ClosePreview, requestId: string = randomUUID(), userId = actor): Promise<CloseResult> {
  return rpc<CloseResult>(
    'select public.close_budget_month($1,$2,$3,$4::date,$5,$6)',
    [spaceId, requestId, 'USD', preview.month, preview.expectedCloseId, preview.previewHash], userId,
  );
}

async function financialDigest(spaceId: string): Promise<unknown> {
  const result = await db().client.query<{ relation_name: string; row_count: string; digest: string }>(
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
  expect(result.rows.every((row) => Number(row.row_count) <= 100)).toBe(true);
  return result.rows;
}

const TABLES = ['rollover_policy_revisions', 'budget_month_closes', 'budget_month_close_roots', 'budget_month_carry_links'];
const PUBLIC_RPCS = ['preview_month_copy', 'copy_allocation_month', 'preview_budget_month_close', 'close_budget_month', 'set_rollover_policy'];
const PRIVATE_HELPERS = [
  'budget_month_close_facts', 'budget_month_close_preview', 'month_copy_preview', 'allocation_snapshot_carry',
  'allocation_snapshot_carry_needs_review', 'check_rollover_policy_revision', 'check_budget_month_close',
  'check_budget_month_carry_links', 'check_rollover_policy_from_row', 'check_budget_month_close_from_header',
  'check_budget_month_close_from_root', 'check_budget_month_carry_from_link',
];

describe('month close: security and catalog', () => {
  it('enables RLS with no direct API grants on the four month-transition relations', async () => {
    const result = await db().client.query<{ table_name: string; rls_enabled: boolean; grantee_count: string }>(
      `select c.relname as table_name, c.relrowsecurity as rls_enabled,
         (select count(*) from information_schema.table_privileges tp
          where tp.table_schema = 'public' and tp.table_name = c.relname
            and tp.grantee in ('PUBLIC','anon','authenticated','service_role'))::text as grantee_count
       from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1::text[])`,
      [TABLES],
    );
    expect(result.rows.map((row) => row.table_name).sort()).toEqual([...TABLES].sort());
    for (const row of result.rows) {
      expect(row.rls_enabled, `${row.table_name} RLS`).toBe(true);
      expect(row.grantee_count, `${row.table_name} grants`).toBe('0');
    }
    const sequences = await db().client.query<{ grantee_count: string }>(
      `select count(*)::text as grantee_count from information_schema.usage_privileges
       where object_schema = 'public' and object_type = 'SEQUENCE'
         and object_name in ('rollover_policy_revisions_id_seq','budget_month_closes_id_seq','budget_month_carry_links_id_seq')
         and grantee in ('PUBLIC','anon','authenticated','service_role')`,
    );
    expect(sequences.rows[0]!.grantee_count).toBe('0');
  });

  it('grants EXECUTE on the five public RPCs only to authenticated, never PUBLIC/anon/service_role', async () => {
    const result = await db().client.query<{
      proname: string; public_exec: boolean; anon_exec: boolean; authenticated_exec: boolean; service_exec: boolean;
    }>(
      `select p.proname,
         exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
                where acl.grantee = 0 and acl.privilege_type = 'EXECUTE') as public_exec,
         has_function_privilege('anon', p.oid, 'execute') as anon_exec,
         has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec,
         has_function_privilege('service_role', p.oid, 'execute') as service_exec
       from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any($1::text[])`,
      [PUBLIC_RPCS],
    );
    expect(result.rows.map((row) => row.proname).sort()).toEqual([...PUBLIC_RPCS].sort());
    for (const row of result.rows) {
      expect(row.authenticated_exec, `${row.proname} authenticated`).toBe(true);
      expect(row.public_exec, `${row.proname} PUBLIC`).toBe(false);
      expect(row.anon_exec, `${row.proname} anon`).toBe(false);
      expect(row.service_exec, `${row.proname} service_role`).toBe(false);
    }
  });

  it('keeps every new private helper unavailable to PUBLIC and all API roles', async () => {
    const result = await db().client.query<{ proname: string; any_exec: boolean }>(
      `select p.proname,
         exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
                where acl.grantee = 0 and acl.privilege_type = 'EXECUTE')
         or has_function_privilege('anon', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute')
         or has_function_privilege('service_role', p.oid, 'execute') as any_exec
       from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and p.proname = any($1::text[])`,
      [PRIVATE_HELPERS],
    );
    expect(result.rows.map((row) => row.proname).sort()).toEqual([...PRIVATE_HELPERS].sort());
    for (const row of result.rows) {
      expect(row.any_exec, `${row.proname} must not be executable by API roles`).toBe(false);
    }
  });

  it('the owner-only INSERT guard denies an authenticated insert even with a temporary grant and permissive RLS', async () => {
    const planned = await plannedSpace('Close guard probe');
    await withRollback(db().client, async () => {
      await db().client.query('grant insert on public.budget_month_closes to authenticated');
      await db().client.query('grant usage on sequence public.budget_month_closes_id_seq to authenticated');
      await db().client.query(
        'create policy budget_month_closes_permissive_probe on public.budget_month_closes for insert to authenticated with check (true)',
      );
      await db().client.query("select set_config('request.jwt.claim.sub', $1, true)", [actor]);
      await db().client.query('set local role authenticated');
      await expect(db().client.query(
        `insert into public.budget_month_closes
           (space_id, currency, month_start, source_snapshot_id, fact_digest, fact_count, root_count,
            closed_income_minor, closed_spending_minor, request_id, actor_id)
         values ($1,'USD',$2::date,$3,decode(repeat('ab',32),'hex'),0,2,0,0,$4,$5)`,
        [planned.spaceId, CLOSED_MONTH, planned.snapshotId, randomUUID(), actor],
      )).rejects.toMatchObject({ code: '42501', message: 'planning_command_required' });
    });
  });

  it('without the temporary grant, a direct authenticated insert is refused by privileges alone', async () => {
    await withRollback(db().client, async () => {
      await db().client.query("select set_config('request.jwt.claim.sub', $1, true)", [actor]);
      await db().client.query('set local role authenticated');
      await expect(db().client.query(
        'insert into public.rollover_policy_revisions (space_id) values ($1)', [randomUUID()],
      )).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('rejects UPDATE and zero-row DELETE on every relation, and TRUNCATE on the leaf carry-link table', async () => {
    for (const table of TABLES) {
      await withRollback(db().client, async () => {
        await expectSavepointRejection(db().client,
          () => db().client.query(`update public.${table} set space_id = space_id where false`),
          { code: '42501', message: 'planning_history_immutable' });
        await expectSavepointRejection(db().client,
          () => db().client.query(`delete from public.${table} where false`),
          { code: '42501', message: 'planning_history_immutable' });
      });
    }
    await withRollback(db().client, () => expectSavepointRejection(db().client,
      () => db().client.query('truncate public.budget_month_carry_links'),
      { code: '42501', message: 'planning_history_immutable' }));
  });
});

describe('month close: frozen arithmetic', () => {
  it('freezes base, actuals, income, spending and a fact digest; an absent policy carries nothing', async () => {
    const planned = await plannedSpace('Close carry 2000');
    const policyA = await setPolicy(planned.spaceId, planned.rootA, true);
    await earn(planned.spaceId, planned.walletId, dayOf(CLOSED_MONTH, 2), '50000');
    await spend(planned.spaceId, planned.walletId, planned.rootA, dayOf(CLOSED_MONTH, 5), '8000');
    await spend(planned.spaceId, planned.walletId, planned.rootB, dayOf(CLOSED_MONTH, 6), '12000');
    await spendUncategorized(planned.spaceId, planned.walletId, dayOf(CLOSED_MONTH, 7), '500');

    const preview = await previewClose(planned.spaceId);
    expect(preview.previewHash).toMatch(HEX64);
    expect(preview.factDigest).toMatch(HEX64);
    expect(preview).toMatchObject({
      month: CLOSED_MONTH, currency: 'USD', expectedCloseId: null, snapshotId: planned.snapshotId,
      incomeMinor: '50000', spendingMinor: '20500', factCount: '4', restatementRequired: false,
    });
    const byRoot = new Map(preview.roots.map((root) => [root.categoryId, root]));
    expect(byRoot.get(planned.rootA)).toEqual({
      categoryId: planned.rootA, nameEn: 'Groceries', nameAr: null, groupId: planned.groupId,
      baseMinor: '10000', carryMinor: '0', effectiveMinor: '10000', actualMinor: '8000', outgoingCarryMinor: '2000',
      enabled: true, policyRevisionId: policyA, carrySourceCloseId: null,
    });
    expect(byRoot.get(planned.rootB)).toMatchObject({
      baseMinor: '10000', actualMinor: '12000', outgoingCarryMinor: '0', enabled: false, policyRevisionId: null,
    });

    const closed = await closeMonth(planned.spaceId, preview);
    expect(closed).toEqual({ closeId: expect.stringMatching(/^\d+$/), previewHash: preview.previewHash, restatesCloseId: null });
    const stored = await db().client.query<{ root_id: string; outgoing: string; actual: string }>(
      `select root_id::text, outgoing_carry_minor::text as outgoing, actual_minor::text as actual
       from public.budget_month_close_roots where close_id = $1 order by root_id`,
      [closed.closeId],
    );
    expect(stored.rows).toHaveLength(2);
    expect(stored.rows.find((row) => row.root_id === planned.rootA)).toMatchObject({ outgoing: '2000', actual: '8000' });
    const header = await db().client.query<{ fact_count: string; digest: string }>(
      "select fact_count::text, encode(fact_digest,'hex') as digest from public.budget_month_closes where id = $1", [closed.closeId],
    );
    expect(header.rows[0]).toEqual({ fact_count: '4', digest: preview.factDigest });

    const after = await previewClose(planned.spaceId, CLOSED_MONTH, closed.closeId);
    expect(after).toMatchObject({ expectedCloseId: closed.closeId, restatementRequired: false, factDigest: preview.factDigest });
  });

  it('carries a signed negative amount when an enabled root overspends, never clamped to zero', async () => {
    const planned = await plannedSpace('Close carry minus 2000');
    await setPolicy(planned.spaceId, planned.rootA, true);
    await spend(planned.spaceId, planned.walletId, planned.rootA, dayOf(CLOSED_MONTH, 9), '12000');
    const preview = await previewClose(planned.spaceId);
    expect(preview.roots.find((root) => root.categoryId === planned.rootA)).toMatchObject({
      actualMinor: '12000', outgoingCarryMinor: '-2000', enabled: true,
    });
  });

  it('an explicitly disabled policy carries nothing even when underspent', async () => {
    const planned = await plannedSpace('Close disabled policy');
    const enabled = await setPolicy(planned.spaceId, planned.rootA, true);
    const disabled = await setPolicy(planned.spaceId, planned.rootA, false, enabled);
    await spend(planned.spaceId, planned.walletId, planned.rootA, dayOf(CLOSED_MONTH, 3), '1000');
    const preview = await previewClose(planned.spaceId);
    expect(preview.roots.find((root) => root.categoryId === planned.rootA)).toMatchObject({
      actualMinor: '1000', outgoingCarryMinor: '0', enabled: false, policyRevisionId: disabled,
    });
  });

  it('counts a refund by its own business date: the later month changes, the closed month does not', async () => {
    const planned = await plannedSpace('Close refund later month');
    await setPolicy(planned.spaceId, planned.rootA, true);
    const purchase = await spend(planned.spaceId, planned.walletId, planned.rootA, dayOf(CLOSED_MONTH, 20), '8000');
    const before = await previewClose(planned.spaceId);
    const firstClose = await closeMonth(planned.spaceId, before);
    await reverse(planned.spaceId, purchase, dayOf(LATER_MONTH, 3));

    const closedAgain = await previewClose(planned.spaceId, CLOSED_MONTH, firstClose.closeId);
    expect(closedAgain.restatementRequired).toBe(false);
    expect(closedAgain.roots.find((root) => root.categoryId === planned.rootA)).toMatchObject({ actualMinor: '8000' });
    expect(closedAgain.factDigest).toBe(before.factDigest);

    await publish({
      spaceId: planned.spaceId, month: LATER_MONTH, templateId: planned.templateId, incomeMinor: '100000',
      roots: [{ categoryId: planned.rootA, amountMinor: '10000' }, { categoryId: planned.rootB, amountMinor: '10000' }],
    });
    const later = await previewClose(planned.spaceId, LATER_MONTH);
    expect(later.spendingMinor).toBe('-8000');
    expect(later.roots.find((root) => root.categoryId === planned.rootA)).toMatchObject({ actualMinor: '-8000' });
  });

  it('refuses the current month, a future month, and a past month that has no published plan', async () => {
    const planned = await plannedSpace('Close month guards');
    for (const month of [monthStart(0), monthStart(1)]) {
      await expect(previewClose(planned.spaceId, month)).rejects.toMatchObject({ code: '22023', message: 'budget_month_not_ended' });
    }
    await expect(previewClose(planned.spaceId, monthStart(-6)))
      .rejects.toMatchObject({ code: 'P0001', message: 'budget_month_close_requires_plan' });
  });

  it('rejects SQL NULL and malformed inputs with planning_invalid_input before any history is written', async () => {
    const planned = await plannedSpace('Close null inputs');
    const preview = await previewClose(planned.spaceId);
    const cases: unknown[][] = [
      [planned.spaceId, null, 'USD', CLOSED_MONTH, null, preview.previewHash],
      [planned.spaceId, randomUUID(), null, CLOSED_MONTH, null, preview.previewHash],
      [planned.spaceId, randomUUID(), 'USD', null, null, preview.previewHash],
      [planned.spaceId, randomUUID(), 'USD', CLOSED_MONTH, null, null],
      [planned.spaceId, randomUUID(), 'USD', CLOSED_MONTH, null, preview.previewHash.toUpperCase()],
      [planned.spaceId, randomUUID(), 'USD', dayOf(CLOSED_MONTH, 2), null, preview.previewHash],
    ];
    for (const args of cases) {
      await expect(rpc('select public.close_budget_month($1,$2,$3,$4::date,$5,$6)', args))
        .rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
    }
    await expect(rpc('select public.preview_budget_month_close($1,$2,$3::date,$4)', [planned.spaceId, 'USD', dayOf(CLOSED_MONTH, 2), null]))
      .rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
    const count = await db().client.query('select count(*)::text as n from public.budget_month_closes where space_id = $1', [planned.spaceId]);
    expect(count.rows[0]!.n).toBe('0');
  });
});

describe('month close: idempotency, staleness and authorization', () => {
  it('replays the same request exactly and refuses a changed payload under the same request id', async () => {
    const planned = await plannedSpace('Close replay');
    const preview = await previewClose(planned.spaceId);
    const requestId = randomUUID();
    const first = await closeMonth(planned.spaceId, preview, requestId);
    const replay = await closeMonth(planned.spaceId, preview, requestId);
    expect(replay).toEqual(first);
    const count = await db().client.query('select count(*)::text as n from public.budget_month_closes where space_id = $1', [planned.spaceId]);
    expect(count.rows[0]!.n).toBe('1');
    await expect(rpc('select public.close_budget_month($1,$2,$3,$4::date,$5,$6)',
      [planned.spaceId, requestId, 'USD', CLOSED_MONTH, first.closeId, preview.previewHash]))
      .rejects.toMatchObject({ code: 'P0001', message: 'planning_idempotency_conflict' });
  });

  it('refuses a request id reused by a different active member', async () => {
    const spaceId = await freshSpace('Close changed actor', 'household');
    const member = randomUUID();
    await db().client.query("insert into auth.users(id, email, email_confirmed_at) values ($1, 'close-member@budget.invalid', now())", [member]);
    await db().client.query("insert into public.space_memberships(space_id, user_id, role) values ($1,$2,'member'::public.member_role)", [spaceId, member]);
    const rootA = await expenseRoot(spaceId, 'Groceries');
    const groupId = randomUUID();
    const template = await rpc<{ templateRevisionId: string }>(
      'select public.save_allocation_template($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
      [spaceId, randomUUID(), 'USD', null,
        JSON.stringify([{ id: groupId, purpose: 'spending', nameEn: 'Living', nameAr: null, order: 0, basisPoints: 5000 }]),
        JSON.stringify([{ categoryId: rootA, groupId }])],
    );
    await publish({ spaceId, month: CLOSED_MONTH, templateId: template.templateRevisionId, incomeMinor: '100000', roots: [{ categoryId: rootA, amountMinor: '1000' }] });
    const preview = await previewClose(spaceId);
    const requestId = randomUUID();
    await closeMonth(spaceId, preview, requestId);
    await expect(closeMonth(spaceId, preview, requestId, member))
      .rejects.toMatchObject({ code: 'P0001', message: 'planning_idempotency_conflict' });
  });

  it('rejects a mutated preview hash and a stale expected close with 40001, writing nothing', async () => {
    const planned = await plannedSpace('Close stale');
    const preview = await previewClose(planned.spaceId);
    const mutated = { ...preview, previewHash: `${preview.previewHash.slice(0, 63)}${preview.previewHash.endsWith('0') ? '1' : '0'}` };
    await expect(closeMonth(planned.spaceId, mutated)).rejects.toMatchObject({ code: '40001', message: 'planning_stale_revision' });
    const closed = await closeMonth(planned.spaceId, preview);
    // The same accepted preview (expected close = null) is now stale: a close exists.
    await expect(closeMonth(planned.spaceId, preview)).rejects.toMatchObject({ code: '40001', message: 'planning_stale_revision' });
    const count = await db().client.query('select count(*)::text as n from public.budget_month_closes where space_id = $1', [planned.spaceId]);
    expect(count.rows[0]!.n).toBe('1');
    expect(closed.restatesCloseId).toBeNull();
  });

  it('denies an outsider, a removed member and anonymous callers', async () => {
    const planned = await plannedSpace('Close access control');
    await expect(previewClose(planned.spaceId, CLOSED_MONTH, null, outsider)).rejects.toMatchObject({ code: '42501' });
    const preview = await previewClose(planned.spaceId);
    await expect(closeMonth(planned.spaceId, preview, randomUUID(), outsider)).rejects.toMatchObject({ code: '42501' });

    const household = await freshSpace('Close removed member', 'household');
    const removed = randomUUID();
    await db().client.query("insert into auth.users(id, email, email_confirmed_at) values ($1, 'removed-close@budget.invalid', now())", [removed]);
    await db().client.query("insert into public.space_memberships(space_id, user_id, role) values ($1,$2,'member'::public.member_role)", [household, removed]);
    await db().client.query(
      "update public.space_memberships set status = 'revoked', ended_at = now(), ended_by_user_id = $3 where space_id = $1 and user_id = $2",
      [household, removed, actor],
    );
    await expect(rpc('select public.set_rollover_policy($1,$2,$3,$4,$5,$6)', [household, randomUUID(), 'USD', randomUUID(), true, null], removed))
      .rejects.toMatchObject({ code: '42501' });

    await withRollback(db().client, async () => {
      await db().client.query('set local role anon');
      await expect(db().client.query('select public.preview_budget_month_close($1,$2,$3::date,$4)', [planned.spaceId, 'USD', CLOSED_MONTH, null]))
        .rejects.toMatchObject({ code: '42501' });
    });
  });
});

describe('month close: restatement and late commits', () => {
  it('a backdated posting after the close requires restatement, and re-close appends a successor', async () => {
    const planned = await plannedSpace('Close restatement');
    await setPolicy(planned.spaceId, planned.rootA, true);
    await spend(planned.spaceId, planned.walletId, planned.rootA, dayOf(CLOSED_MONTH, 5), '8000');
    const first = await closeMonth(planned.spaceId, await previewClose(planned.spaceId));

    await spend(planned.spaceId, planned.walletId, planned.rootA, dayOf(CLOSED_MONTH, 28), '1500');
    const stale = await previewClose(planned.spaceId, CLOSED_MONTH, first.closeId);
    expect(stale).toMatchObject({ restatementRequired: true, expectedCloseId: first.closeId, factCount: '2' });
    expect(stale.roots.find((root) => root.categoryId === planned.rootA)).toMatchObject({ actualMinor: '9500', outgoingCarryMinor: '500' });

    const second = await closeMonth(planned.spaceId, stale);
    expect(second.restatesCloseId).toBe(first.closeId);
    const firstRoots = await db().client.query<{ outgoing: string }>(
      'select outgoing_carry_minor::text as outgoing from public.budget_month_close_roots where close_id = $1 and root_id = $2',
      [first.closeId, planned.rootA],
    );
    expect(firstRoots.rows).toEqual([{ outgoing: '2000' }]);
    expect(await previewClose(planned.spaceId, CLOSED_MONTH, second.closeId)).toMatchObject({ restatementRequired: false });
  });

  it('two connections: a posting that commits while the close waits on the space lock makes the accepted preview stale', async () => {
    const planned = await plannedSpace('Close race posting');
    const preview = await previewClose(planned.spaceId);
    const outcome = await orderedAuthenticatedRace(
      db(), actor,
      (client) => client.query(
        "select id from public.record_categorized_financial_event($1,$2,'expense',$3::date,$4::jsonb,$5) limit 2",
        [planned.spaceId, randomUUID(), dayOf(CLOSED_MONTH, 11), JSON.stringify([{ walletId: planned.walletId, amountMinor: '-700' }]), planned.rootA],
      ),
      (client) => client.query(
        'select public.close_budget_month($1,$2,$3,$4::date,$5,$6)',
        [planned.spaceId, randomUUID(), 'USD', CLOSED_MONTH, null, preview.previewHash],
      ),
    );
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') expect(outcome.reason).toMatchObject({ code: '40001', message: 'planning_stale_revision' });
    expect((await previewClose(planned.spaceId)).factCount).toBe('1');
  });

  it('two connections: a transaction that began before the close but commits after it is detected, not hidden by its earlier timestamp', async () => {
    const planned = await plannedSpace('Close late commit');
    const late = databaseClient(db().url);
    await late.connect();
    try {
      await late.query('begin');
      await late.query("select set_config('request.jwt.claim.sub', $1, true)", [actor]);
      await late.query('set local role authenticated');
      await late.query('select now()');
      const closed = await closeMonth(planned.spaceId, await previewClose(planned.spaceId));
      const posted = await late.query<{ id: string }>(
        "select id from public.record_categorized_financial_event($1,$2,'expense',$3::date,$4::jsonb,$5) limit 2",
        [planned.spaceId, randomUUID(), dayOf(CLOSED_MONTH, 12), JSON.stringify([{ walletId: planned.walletId, amountMinor: '-900' }]), planned.rootA],
      );
      await late.query('commit');
      const order = await db().client.query<{ earlier: boolean }>(
        `select event.created_at < close.created_at as earlier
         from public.financial_events event, public.budget_month_closes close
         where event.id = $1 and close.id = $2`,
        [posted.rows[0]!.id, closed.closeId],
      );
      expect(order.rows[0]!.earlier).toBe(true);
      expect(await previewClose(planned.spaceId, CLOSED_MONTH, closed.closeId)).toMatchObject({ restatementRequired: true, factCount: '1' });
    } finally {
      await late.query('rollback').catch(() => undefined);
      await late.end();
    }
  });

  it('a new fact sharing an existing fact\'s exact created_at still changes the digest', async () => {
    const planned = await plannedSpace('Close equal timestamps');
    const first = await spend(planned.spaceId, planned.walletId, planned.rootA, dayOf(CLOSED_MONTH, 4), '1000');
    const closed = await closeMonth(planned.spaceId, await previewClose(planned.spaceId));
    const twin = randomUUID();
    await db().client.query('begin');
    try {
      await db().client.query(
        `insert into public.financial_events (id, space_id, request_id, request_fingerprint, kind, effective_date, actor_id, created_at)
         select $1, space_id, $2, request_fingerprint, kind, effective_date, actor_id, created_at from public.financial_events where id = $3`,
        [twin, randomUUID(), first],
      );
      await db().client.query(
        `insert into public.wallet_movements (event_id, space_id, wallet_id, amount_minor, created_at)
         select $1, space_id, wallet_id, amount_minor, created_at from public.wallet_movements where event_id = $2`,
        [twin, first],
      );
      await db().client.query(
        `insert into public.financial_event_categories (event_id, space_id, event_kind, category_id, category_kind, created_at)
         select $1, space_id, event_kind, category_id, category_kind, created_at from public.financial_event_categories where event_id = $2`,
        [twin, first],
      );
      await db().client.query('commit');
    } catch (error) {
      await db().client.query('rollback');
      throw error;
    }
    const after = await previewClose(planned.spaceId, CLOSED_MONTH, closed.closeId);
    expect(after).toMatchObject({ restatementRequired: true, factCount: '2' });
  });

  it('a statement timeout while waiting on the space lock aborts the close with nothing written', async () => {
    const planned = await plannedSpace('Close statement timeout');
    const preview = await previewClose(planned.spaceId);
    const holder = databaseClient(db().url);
    await holder.connect();
    try {
      await holder.query('begin');
      await holder.query('select 1 from public.spaces where id = $1 for update', [planned.spaceId]);
      await withRollback(db().client, async () => {
        await db().client.query("select set_config('request.jwt.claim.sub', $1, true)", [actor]);
        await db().client.query('set local role authenticated');
        await db().client.query("set local statement_timeout = '300ms'");
        await expect(db().client.query(
          'select public.close_budget_month($1,$2,$3,$4::date,$5,$6)',
          [planned.spaceId, randomUUID(), 'USD', CLOSED_MONTH, null, preview.previewHash],
        )).rejects.toMatchObject({ code: '57014' });
      });
    } finally {
      await holder.query('rollback');
      await holder.end();
    }
    const count = await db().client.query('select count(*)::text as n from public.budget_month_closes where space_id = $1', [planned.spaceId]);
    expect(count.rows[0]!.n).toBe('0');
  });
});

describe('month close: schema invariants hold without the command', () => {
  async function insertCloseHeader(input: {
    spaceId: string; snapshotId: string; month?: string; rootCount: number; expectedCloseId?: string | null;
  }): Promise<string> {
    const result = await db().client.query<{ id: string }>(
      `insert into public.budget_month_closes
         (space_id, currency, month_start, source_snapshot_id, expected_close_id, fact_digest, fact_count, root_count,
          closed_income_minor, closed_spending_minor, request_id, actor_id)
       values ($1,'USD',$2::date,$3,$4,extensions.digest('fixture','sha256'),0,$5,0,0,$6,$7) returning id::text`,
      [input.spaceId, input.month ?? CLOSED_MONTH, input.snapshotId, input.expectedCloseId ?? null, input.rootCount, randomUUID(), actor],
    );
    return result.rows[0]!.id;
  }
  async function insertCloseRoot(input: {
    closeId: string; spaceId: string; snapshotId: string; rootId: string; base?: string; incoming?: string; actual?: string;
    outgoing?: string; enabled?: boolean; policyRevisionId?: string | null; month?: string;
  }): Promise<void> {
    await db().client.query(
      `insert into public.budget_month_close_roots
         (close_id, space_id, currency, month_start, source_snapshot_id, root_id, policy_revision_id, enabled,
          base_target_minor, incoming_carry_minor, actual_minor, outgoing_carry_minor)
       values ($1,$2,'USD',$3::date,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [input.closeId, input.spaceId, input.month ?? CLOSED_MONTH, input.snapshotId, input.rootId, input.policyRevisionId ?? null,
        input.enabled ?? false, input.base ?? '10000', input.incoming ?? '0', input.actual ?? '0', input.outgoing ?? '0'],
    );
  }
  async function forceDeferred(): Promise<void> {
    await db().client.query('set constraints all immediate');
    await db().client.query('set constraints all deferred');
  }

  it('accepts a complete owner-seeded close (positive control for the probes below)', async () => {
    const planned = await plannedSpace('Invariant positive control');
    await withRollback(db().client, async () => {
      const closeId = await insertCloseHeader({ spaceId: planned.spaceId, snapshotId: planned.snapshotId, rootCount: 2 });
      await insertCloseRoot({ closeId, spaceId: planned.spaceId, snapshotId: planned.snapshotId, rootId: planned.rootA });
      await insertCloseRoot({ closeId, spaceId: planned.spaceId, snapshotId: planned.snapshotId, rootId: planned.rootB });
      await forceDeferred();
    });
  });

  it('rejects a header that declares more roots than were inserted (missing child)', async () => {
    const planned = await plannedSpace('Invariant missing child');
    await withRollback(db().client, async () => {
      const closeId = await insertCloseHeader({ spaceId: planned.spaceId, snapshotId: planned.snapshotId, rootCount: 2 });
      await insertCloseRoot({ closeId, spaceId: planned.spaceId, snapshotId: planned.snapshotId, rootId: planned.rootA });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'budget_month_close_root_count_mismatch' });
    });
  });

  it('a later transaction cannot append another root to a committed close', async () => {
    const planned = await plannedSpace('Invariant late child');
    const closed = await closeMonth(planned.spaceId, await previewClose(planned.spaceId));
    await withRollback(db().client, () => expectSavepointRejection(db().client,
      () => insertCloseRoot({ closeId: closed.closeId, spaceId: planned.spaceId, snapshotId: planned.snapshotId, rootId: planned.rootA }),
      { code: '23505' }));
  });

  it('rejects a carry formula violation, an enabled root without a policy, and a base that differs from the snapshot', async () => {
    const planned = await plannedSpace('Invariant formula');
    const probes: Array<{ root: Partial<Parameters<typeof insertCloseRoot>[0]>; code: string }> = [
      { root: { enabled: false, outgoing: '5' }, code: '23514' },
      { root: { enabled: true, actual: '8000', outgoing: '2000', policyRevisionId: null }, code: '23514' },
      { root: { base: '9999' }, code: '23503' },
    ];
    for (const probe of probes) {
      await withRollback(db().client, async () => {
        const closeId = await insertCloseHeader({ spaceId: planned.spaceId, snapshotId: planned.snapshotId, rootCount: 2 });
        await expectSavepointRejection(db().client,
          () => insertCloseRoot({ closeId, spaceId: planned.spaceId, snapshotId: planned.snapshotId, rootId: planned.rootA, ...probe.root }),
          { code: probe.code });
      });
    }
  });

  it('rejects a policy revision whose enabled flag disagrees with the close root', async () => {
    const planned = await plannedSpace('Invariant policy agreement');
    const policy = await setPolicy(planned.spaceId, planned.rootA, false);
    await withRollback(db().client, async () => {
      const closeId = await insertCloseHeader({ spaceId: planned.spaceId, snapshotId: planned.snapshotId, rootCount: 2 });
      await expectSavepointRejection(db().client,
        () => insertCloseRoot({
          closeId, spaceId: planned.spaceId, snapshotId: planned.snapshotId, rootId: planned.rootA,
          enabled: true, actual: '0', outgoing: '10000', policyRevisionId: policy,
        }),
        { code: '23503' });
    });
  });

  it('rejects a close for a month that has not ended and a cross-space snapshot reference', async () => {
    const planned = await plannedSpace('Invariant month and tenant');
    const other = await plannedSpace('Invariant other tenant');
    // An ended month that does not match the snapshot's own month: composite FK.
    await withRollback(db().client, () => expectSavepointRejection(db().client,
      () => insertCloseHeader({ spaceId: planned.spaceId, snapshotId: planned.snapshotId, rootCount: 2, month: LATER_MONTH }),
      { code: '23503' }));
    await withRollback(db().client, () => expectSavepointRejection(db().client,
      () => insertCloseHeader({ spaceId: planned.spaceId, snapshotId: other.snapshotId, rootCount: 2 }),
      { code: '23503' }));
    const currentSpace = await plannedSpace('Invariant current month header');
    const currentSnapshot = await publish({
      spaceId: currentSpace.spaceId, month: monthStart(0), templateId: currentSpace.templateId, incomeMinor: '100000',
      roots: [{ categoryId: currentSpace.rootA, amountMinor: '1' }, { categoryId: currentSpace.rootB, amountMinor: '1' }],
    });
    await withRollback(db().client, () => expectSavepointRejection(db().client,
      () => insertCloseHeader({ spaceId: currentSpace.spaceId, snapshotId: currentSnapshot, rootCount: 2, month: monthStart(0) }),
      { code: '23514' }));
  });

  it('rejects a close root that ignores the current policy head (deferred input agreement)', async () => {
    const planned = await plannedSpace('Invariant policy head');
    await setPolicy(planned.spaceId, planned.rootA, false);
    await withRollback(db().client, async () => {
      const closeId = await insertCloseHeader({ spaceId: planned.spaceId, snapshotId: planned.snapshotId, rootCount: 2 });
      await insertCloseRoot({ closeId, spaceId: planned.spaceId, snapshotId: planned.snapshotId, rootId: planned.rootA, policyRevisionId: null });
      await insertCloseRoot({ closeId, spaceId: planned.spaceId, snapshotId: planned.snapshotId, rootId: planned.rootB });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'budget_month_close_root_inputs_invalid' });
    });
  });

  it('rejects a restatement whose predecessor is not the stream head', async () => {
    const planned = await plannedSpace('Invariant predecessor head');
    const first = await closeMonth(planned.spaceId, await previewClose(planned.spaceId));
    await closeMonth(planned.spaceId, await previewClose(planned.spaceId, CLOSED_MONTH, first.closeId));
    await withRollback(db().client, async () => {
      await expectSavepointRejection(db().client,
        () => insertCloseHeader({ spaceId: planned.spaceId, snapshotId: planned.snapshotId, rootCount: 0, expectedCloseId: first.closeId }),
        { code: '23505' });
    });
  });
});

describe('month close: bounds and the money journal', () => {
  it('refuses range_too_large instead of truncating when the month exceeds the fact cap', async () => {
    const planned = await plannedSpace('Close fact cap');
    await spend(planned.spaceId, planned.walletId, planned.rootA, dayOf(CLOSED_MONTH, 3), '100');
    await spend(planned.spaceId, planned.walletId, planned.rootA, dayOf(CLOSED_MONTH, 4), '100');
    await expect(db().client.query(
      'select private.budget_month_close_facts($1,$2,$3::date,$4,$5)', [planned.spaceId, 'USD', CLOSED_MONTH, planned.snapshotId, 1],
    )).rejects.toMatchObject({ code: '54000', message: 'range_too_large' });
    const exact = await db().client.query<{ facts: { factCount: string } }>(
      'select private.budget_month_close_facts($1,$2,$3::date,$4,$5) as facts', [planned.spaceId, 'USD', CLOSED_MONTH, planned.snapshotId, 2],
    );
    expect(exact.rows[0]!.facts.factCount).toBe('2');
    const definition = await db().client.query<{ source: string }>(
      "select pg_get_functiondef('private.budget_month_close_preview(uuid,public.currency_code,date,bigint)'::regprocedure) as source",
    );
    expect(definition.rows[0]!.source).toContain('100000');
  });

  it('policy, preview and close never move money', async () => {
    const planned = await plannedSpace('Close journal digest');
    await spend(planned.spaceId, planned.walletId, planned.rootA, dayOf(CLOSED_MONTH, 3), '2500');
    const before = await financialDigest(planned.spaceId);
    await setPolicy(planned.spaceId, planned.rootA, true);
    await closeMonth(planned.spaceId, await previewClose(planned.spaceId));
    expect(await financialDigest(planned.spaceId)).toEqual(before);
  });
});

describe('month transitions migration replay and upgrade', () => {
  it('upgrades a seeded pre-transition database without changing prior rows, then closes its month', async () => {
    const migrations = migrationFiles();
    const transition = migrations.find((migration) => migration.version === monthTransitionsVersion);
    expect(transition).toBeDefined();
    const prefix = migrations.filter((migration) => migration.version < monthTransitionsVersion);
    const suffix = migrations.filter((migration) => migration.version >= monthTransitionsVersion);
    const upgrade = await createDisposableDatabase('budget_monthupgrade');
    const owner = randomUUID();
    try {
      await bootstrapCompatibilityObjects(upgrade.client);
      await replayMigrations(upgrade.client, prefix);
      await upgrade.client.query("insert into auth.users(id, email, email_confirmed_at) values ($1, 'upgrade@budget.invalid', now())", [owner]);
      const as = async <T>(sql: string, params: unknown[]): Promise<T> => withAuthenticatedTransaction(upgrade.client, owner, async () => {
        const result = await upgrade.client.query(sql, params);
        return Object.values(result.rows[0] as Record<string, unknown>)[0] as T;
      });
      const spaceId = await as<string>("select id from public.create_space($1,'personal') limit 2", ['Upgrade fixture']);
      const walletId = await as<string>("select id from public.create_wallet($1,'Cash','USD') limit 2", [spaceId]);
      const rootId = await as<string>("select id from public.create_category($1,$2,'expense','Groceries',null) limit 2", [spaceId, randomUUID()]);
      const groupId = randomUUID();
      const template = await as<{ templateRevisionId: string }>(
        'select public.save_allocation_template($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
        [spaceId, randomUUID(), 'USD', null,
          JSON.stringify([{ id: groupId, purpose: 'spending', nameEn: 'Living', nameAr: null, order: 0, basisPoints: 5000 }]),
          JSON.stringify([{ categoryId: rootId, groupId }])],
      );
      await as('select public.publish_allocation_month_v2($1,$2,$3::date,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb)',
        [spaceId, randomUUID(), CLOSED_MONTH, 'USD', null, template.templateRevisionId, null, '100000',
          JSON.stringify([{ categoryId: rootId, amountMinor: '10000', expectedRevisionId: null }]), null, '[]']);
      const purchase = await as<string>(
        "select id from public.record_categorized_financial_event($1,$2,'expense',$3::date,$4::jsonb,$5) limit 2",
        [spaceId, randomUUID(), dayOf(CLOSED_MONTH, 8), JSON.stringify([{ walletId, amountMinor: '-8000' }]), rootId],
      );
      await as('select id from public.reverse_financial_event($1,$2,$3,$4::date) limit 2', [spaceId, randomUUID(), purchase, dayOf(LATER_MONTH, 2)]);

      const digestSql = `
        select 'events' as relation_name, md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), '')) as digest
        from (select * from public.financial_events where space_id = $1 order by id limit 101) x
        union all select 'movements', md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), ''))
        from (select * from public.wallet_movements where space_id = $1 order by id limit 101) x
        union all select 'plans', md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), ''))
        from (select * from public.monthly_budget_plan_revisions where space_id = $1 order by id limit 101) x
        union all select 'snapshots', md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), ''))
        from (select * from public.allocation_month_snapshots where space_id = $1 order by id limit 101) x
        union all select 'roots', md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.snapshot_id, x.category_id), ''))
        from (select * from public.allocation_month_roots where space_id = $1 order by snapshot_id, category_id limit 101) x
        order by relation_name`;
      const before = await upgrade.client.query(digestSql, [spaceId]);
      const stateBefore = await as<{ groups: Array<{ rowKind: string; targetMinor: string | null; actualMinor: string; varianceMinor: string | null }> }>(
        'select public.allocation_month_state($1,$2::date,$3,null)', [spaceId, CLOSED_MONTH, 'USD'],
      );

      await replayMigrations(upgrade.client, suffix);

      expect((await upgrade.client.query(digestSql, [spaceId])).rows).toEqual(before.rows);
      const stateAfter = await as<{ carryNeedsReview: boolean; groups: Array<{ rowKind: string; targetMinor: string | null; actualMinor: string; varianceMinor: string | null; carryMinor: string | null }> }>(
        'select public.allocation_month_state($1,$2::date,$3,null)', [spaceId, CLOSED_MONTH, 'USD'],
      );
      expect(stateAfter.carryNeedsReview).toBe(false);
      expect(stateAfter.groups.map(({ rowKind, targetMinor, actualMinor, varianceMinor }) => ({ rowKind, targetMinor, actualMinor, varianceMinor })))
        .toEqual(stateBefore.groups.map(({ rowKind, targetMinor, actualMinor, varianceMinor }) => ({ rowKind, targetMinor, actualMinor, varianceMinor })));

      const preview = await as<ClosePreview>('select public.preview_budget_month_close($1,$2,$3::date,$4)', [spaceId, 'USD', CLOSED_MONTH, null]);
      expect(preview.roots).toEqual([expect.objectContaining({ categoryId: rootId, actualMinor: '8000', outgoingCarryMinor: '0', enabled: false })]);
      const closed = await as<CloseResult>('select public.close_budget_month($1,$2,$3,$4::date,$5,$6)',
        [spaceId, randomUUID(), 'USD', CLOSED_MONTH, null, preview.previewHash]);
      expect(closed.closeId).toMatch(/^\d+$/);
    } finally {
      await disposeDisposableDatabase(upgrade);
    }
  }, 180_000);
});
