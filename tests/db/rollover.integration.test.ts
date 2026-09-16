import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase, disposeDisposableDatabase,
  expectSavepointRejection, migrationFiles, replayMigrations, withAuthenticatedTransaction, withRollback,
  type DisposableDatabase,
} from './disposable-database.js';

// Task 20: explicit rollover policy and signed carry. Carry is a distinct
// adjustment on top of the percentage plan -- it never becomes income and
// never re-apportions group percentages.

let database: DisposableDatabase | undefined;
const actor = randomUUID();
const outsider = randomUUID();

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_rollover');
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

function monthStart(offset: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
}
function dayOf(month: string, day: number): string {
  return `${month.slice(0, 8)}${String(day).padStart(2, '0')}`;
}
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
const CLOSED_MONTH = monthStart(-3);
const NEXT_MONTH = monthStart(-2);

async function rpc<T>(sql: string, params: unknown[], userId = actor): Promise<T> {
  return withAuthenticatedTransaction(db().client, userId, async () => {
    const result = await db().client.query(sql, params);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error('rpc returned no row');
    return Object.values(row)[0] as T;
  });
}

async function freshSpace(name: string): Promise<string> {
  return rpc<string>("select id from public.create_space($1, 'personal') limit 2", [name]);
}
async function category(spaceId: string, kind: 'income' | 'expense', name: string): Promise<string> {
  return rpc<string>('select id from public.create_category($1,$2,$3,$4,null) limit 2', [spaceId, randomUUID(), kind, name]);
}
async function spend(spaceId: string, walletId: string, categoryId: string, date: string, amountMinor: string): Promise<string> {
  return rpc<string>(
    "select id from public.record_categorized_financial_event($1,$2,'expense',$3::date,$4::jsonb,$5) limit 2",
    [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor: `-${amountMinor}` }]), categoryId],
  );
}

interface Fixture {
  spaceId: string; walletId: string; groupId: string; templateId: string;
  rootA: string; rootB: string; standalone: string; snapshotId: string;
}

async function planHeads(spaceId: string, month: string): Promise<{ income: string | null; roots: Map<string, string> }> {
  const heads = await db().client.query<{ category_id: string | null; plan_kind: string; id: string }>(
    `select distinct on (plan_kind, category_id) category_id::text, plan_kind, id::text
     from public.monthly_budget_plan_revisions where space_id = $1 and month_start = $2::date and currency = 'USD'
     order by plan_kind, category_id, id desc`,
    [spaceId, month],
  );
  return {
    income: heads.rows.find((row) => row.plan_kind === 'income')?.id ?? null,
    roots: new Map(heads.rows.filter((row) => row.category_id).map((row) => [row.category_id!, row.id])),
  };
}

async function publish(fixture: Pick<Fixture, 'spaceId' | 'templateId'>, month: string, roots: Array<{ categoryId: string; amountMinor: string }>): Promise<string> {
  const heads = await planHeads(fixture.spaceId, month);
  const current = await db().client.query<{ id: string }>(
    "select id::text from public.allocation_month_snapshots where space_id = $1 and month_start = $2::date and currency = 'USD' order by id desc limit 1",
    [fixture.spaceId, month],
  );
  const result = await rpc<{ snapshotId: string }>(
    'select public.publish_allocation_month_v2($1,$2,$3::date,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb)',
    [fixture.spaceId, randomUUID(), month, 'USD', current.rows[0]?.id ?? null, fixture.templateId, heads.income, '100000',
      JSON.stringify(roots.map((root) => ({ ...root, expectedRevisionId: heads.roots.get(root.categoryId) ?? null }))), null, '[]'],
  );
  return result.snapshotId;
}

async function fixture(name: string, month = CLOSED_MONTH, targets = { a: '10000', b: '10000', standalone: '5000' }): Promise<Fixture> {
  const spaceId = await freshSpace(name);
  const walletId = await rpc<string>("select id from public.create_wallet($1,'Cash','USD') limit 2", [spaceId]);
  const rootA = await category(spaceId, 'expense', 'Groceries');
  const rootB = await category(spaceId, 'expense', 'Transport');
  const standalone = await category(spaceId, 'expense', 'Gifts');
  const groupId = randomUUID();
  const template = await rpc<{ templateRevisionId: string }>(
    'select public.save_allocation_template($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
    [spaceId, randomUUID(), 'USD', null,
      JSON.stringify([{ id: groupId, purpose: 'spending', nameEn: 'Living', nameAr: null, order: 0, basisPoints: 5000 }]),
      JSON.stringify([{ categoryId: rootA, groupId }, { categoryId: rootB, groupId }])],
  );
  const snapshotId = await publish({ spaceId, templateId: template.templateRevisionId }, month, [
    { categoryId: rootA, amountMinor: targets.a }, { categoryId: rootB, amountMinor: targets.b },
    { categoryId: standalone, amountMinor: targets.standalone },
  ]);
  return { spaceId, walletId, groupId, templateId: template.templateRevisionId, rootA, rootB, standalone, snapshotId };
}

async function setPolicy(spaceId: string, rootId: string, enabled: boolean, expectedRevisionId: string | null = null, requestId = randomUUID(), userId = actor): Promise<string> {
  const result = await rpc<{ revisionId: string }>(
    'select public.set_rollover_policy($1,$2,$3,$4,$5,$6)', [spaceId, requestId, 'USD', rootId, enabled, expectedRevisionId], userId,
  );
  return result.revisionId;
}

interface ClosePreview { previewHash: string; month: string; expectedCloseId: string | null; roots: Array<Record<string, unknown> & { categoryId: string }> }
async function close(spaceId: string, month = CLOSED_MONTH): Promise<{ closeId: string }> {
  const head = await db().client.query<{ id: string }>(
    "select id::text from public.budget_month_closes where space_id = $1 and month_start = $2::date and currency = 'USD' order by id desc limit 1",
    [spaceId, month],
  );
  const preview = await rpc<ClosePreview>('select public.preview_budget_month_close($1,$2,$3::date,$4)', [spaceId, 'USD', month, head.rows[0]?.id ?? null]);
  return rpc<{ closeId: string }>('select public.close_budget_month($1,$2,$3,$4::date,$5,$6)',
    [spaceId, randomUUID(), 'USD', month, preview.expectedCloseId, preview.previewHash]);
}

interface CopyPreview {
  previewHash: string; expectedTargetSnapshotId: string | null; carryCloseId: string | null; incomeMinor: string;
  groups: Array<{ groupId: string; targetMinor: string; carryMinor: string; effectiveMinor: string }>;
  roots: Array<{ categoryId: string; baseMinor: string; carryMinor: string; effectiveMinor: string }>;
  carrySources: Array<{ rootId: string; sourceCloseId: string; carryMinor: string }>;
}
async function previewCopy(spaceId: string, sourceSnapshotId: string, targetMonth = NEXT_MONTH): Promise<CopyPreview> {
  return rpc<CopyPreview>('select public.preview_month_copy($1,$2,$3,$4::date)', [spaceId, 'USD', sourceSnapshotId, targetMonth]);
}
async function copy(spaceId: string, sourceSnapshotId: string, targetMonth = NEXT_MONTH): Promise<{ snapshotId: string; preview: CopyPreview }> {
  const preview = await previewCopy(spaceId, sourceSnapshotId, targetMonth);
  const result = await rpc<{ snapshotId: string }>('select public.copy_allocation_month($1,$2,$3,$4,$5::date,$6,$7)',
    [spaceId, randomUUID(), 'USD', sourceSnapshotId, targetMonth, preview.expectedTargetSnapshotId, preview.previewHash]);
  return { snapshotId: result.snapshotId, preview };
}

interface StateGroup { groupId: string | null; rowKind: string; targetMinor: string | null; actualMinor: string; varianceMinor: string | null; carryMinor: string | null; effectiveTargetMinor: string | null }
interface MonthState { plannedIncomeMinor: string; leftToAllocateMinor: string; carryMinor: string; carryNeedsReview: boolean; groups: StateGroup[] }
async function monthState(spaceId: string, month: string): Promise<MonthState> {
  return rpc<MonthState>('select public.allocation_month_state($1,$2::date,$3,null)', [spaceId, month, 'USD']);
}
async function categoryPage(spaceId: string, month: string, snapshotId: string): Promise<Array<{ rootId: string; targetMinor: string; carryMinor: string; effectiveTargetMinor: string; actualMinor: string; varianceMinor: string }>> {
  const page = await rpc<{ rows: Array<{ rootId: string; targetMinor: string; carryMinor: string; effectiveTargetMinor: string; actualMinor: string; varianceMinor: string }> }>(
    'select public.allocation_category_page($1,$2::date,$3,$4,null,null,100)', [spaceId, month, 'USD', snapshotId],
  );
  return page.rows;
}

describe('set_rollover_policy', () => {
  it('appends a head chain, replays an identical request, and refuses stale heads and changed payloads', async () => {
    const spaceId = await freshSpace('Policy chain');
    const rootId = await category(spaceId, 'expense', 'Groceries');
    const requestId = randomUUID();
    const first = await setPolicy(spaceId, rootId, true, null, requestId);
    expect(await setPolicy(spaceId, rootId, true, null, requestId)).toBe(first);
    await expect(setPolicy(spaceId, rootId, false, null, requestId)).rejects.toMatchObject({ code: 'P0001', message: 'planning_idempotency_conflict' });
    await expect(setPolicy(spaceId, rootId, false, null)).rejects.toMatchObject({ code: '40001', message: 'planning_stale_revision' });
    const second = await setPolicy(spaceId, rootId, false, first);
    expect(BigInt(second)).toBeGreaterThan(BigInt(first));
    const rows = await db().client.query<{ enabled: boolean; expected: string | null }>(
      'select enabled, expected_revision_id::text as expected from public.rollover_policy_revisions where root_id = $1 order by id', [rootId],
    );
    expect(rows.rows).toEqual([{ enabled: true, expected: null }, { enabled: false, expected: first }]);
  });

  it('requires an expense root category in this space; an archived root may be disabled but not enabled', async () => {
    const spaceId = await freshSpace('Policy scope');
    const otherSpace = await freshSpace('Policy scope other');
    const root = await category(spaceId, 'expense', 'Housing');
    const child = await rpc<string>('select id from public.create_subcategory($1,$2,$3,$4,null) limit 2', [spaceId, randomUUID(), root, 'Rent']);
    const income = await category(spaceId, 'income', 'Salary');
    const foreign = await category(otherSpace, 'expense', 'Housing');
    for (const rootId of [child, income, foreign, randomUUID()]) {
      await expect(setPolicy(spaceId, rootId, true)).rejects.toMatchObject({ code: 'P0001', message: 'rollover_policy_requires_expense_root' });
    }
    const archived = await category(spaceId, 'expense', 'Old hobby');
    await rpc('select id from public.archive_category($1,$2,$3) limit 2', [spaceId, randomUUID(), archived]);
    await expect(setPolicy(spaceId, archived, true)).rejects.toMatchObject({ code: 'P0001', message: 'rollover_policy_archived_root' });
    expect(await setPolicy(spaceId, archived, false)).toMatch(/^\d+$/);
  });

  it('rejects NULL inputs and denies an outsider', async () => {
    const spaceId = await freshSpace('Policy inputs');
    const rootId = await category(spaceId, 'expense', 'Groceries');
    for (const args of [
      [spaceId, null, 'USD', rootId, true, null], [spaceId, randomUUID(), null, rootId, true, null],
      [spaceId, randomUUID(), 'USD', null, true, null], [spaceId, randomUUID(), 'USD', rootId, null, null],
    ]) {
      await expect(rpc('select public.set_rollover_policy($1,$2,$3,$4,$5,$6)', args)).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
    }
    await expect(setPolicy(spaceId, rootId, true, null, randomUUID(), outsider)).rejects.toMatchObject({ code: '42501' });
  });

  it('the deferred scope check rejects an owner-seeded policy on a subcategory, and a non-older predecessor', async () => {
    const spaceId = await freshSpace('Policy schema');
    const root = await category(spaceId, 'expense', 'Housing');
    const child = await rpc<string>('select id from public.create_subcategory($1,$2,$3,$4,null) limit 2', [spaceId, randomUUID(), root, 'Rent']);
    const insert = (rootId: string, expected: string | null) => db().client.query<{ id: string }>(
      `insert into public.rollover_policy_revisions (space_id, currency, root_id, enabled, expected_revision_id, request_id, actor_id)
       values ($1,'USD',$2,true,$3,$4,$5) returning id::text`,
      [spaceId, rootId, expected, randomUUID(), actor],
    );
    const forceDeferred = async () => {
      await db().client.query('set constraints all immediate');
      await db().client.query('set constraints all deferred');
    };
    await withRollback(db().client, async () => {
      await insert(child, null);
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'rollover_policy_scope_invalid' });
    });
    await withRollback(db().client, async () => {
      const next = await db().client.query<{ id: string }>("select nextval('public.rollover_policy_revisions_id_seq')::text as id");
      // The row's own id is next+1, so this predecessor is not older than it:
      // the row CHECK fires before any foreign key is consulted.
      await expectSavepointRejection(db().client, () => insert(root, String(BigInt(next.rows[0]!.id) + 1n)), { code: '23514' });
    });
  });
});

describe('signed rollover into the next month', () => {
  it('base 10000 with actual 8000 carries +2000: next month root effective 12000, income and percentages unchanged', async () => {
    const f = await fixture('Rollover plus');
    await setPolicy(f.spaceId, f.rootA, true);
    await spend(f.spaceId, f.walletId, f.rootA, dayOf(CLOSED_MONTH, 10), '8000');
    const closed = await close(f.spaceId);
    const baseline = await monthState(f.spaceId, CLOSED_MONTH);

    const copied = await copy(f.spaceId, f.snapshotId);
    expect(copied.preview.carrySources).toEqual([{ rootId: f.rootA, sourceCloseId: closed.closeId, carryMinor: '2000' }]);
    expect(copied.preview.roots.find((root) => root.categoryId === f.rootA)).toMatchObject({ baseMinor: '10000', carryMinor: '2000', effectiveMinor: '12000' });

    const state = await monthState(f.spaceId, NEXT_MONTH);
    expect(state).toMatchObject({ plannedIncomeMinor: '100000', leftToAllocateMinor: baseline.leftToAllocateMinor, carryMinor: '2000', carryNeedsReview: false });
    expect(state.groups.find((group) => group.groupId === f.groupId)).toMatchObject({
      targetMinor: '50000', carryMinor: '2000', effectiveTargetMinor: '52000', actualMinor: '0', varianceMinor: '52000',
    });
    const rows = await categoryPage(f.spaceId, NEXT_MONTH, copied.snapshotId);
    expect(rows.find((row) => row.rootId === f.rootA)).toMatchObject({ targetMinor: '10000', carryMinor: '2000', effectiveTargetMinor: '12000', varianceMinor: '12000' });
    expect(rows.find((row) => row.rootId === f.rootB)).toMatchObject({ carryMinor: '0', effectiveTargetMinor: '10000' });
  });

  it('base 10000 with actual 12000 carries -2000: next month effective 8000; a disabled root carries 0', async () => {
    const f = await fixture('Rollover minus');
    await setPolicy(f.spaceId, f.rootA, true);
    await setPolicy(f.spaceId, f.rootB, false);
    await spend(f.spaceId, f.walletId, f.rootA, dayOf(CLOSED_MONTH, 10), '12000');
    await spend(f.spaceId, f.walletId, f.rootB, dayOf(CLOSED_MONTH, 11), '3000');
    await close(f.spaceId);
    const copied = await copy(f.spaceId, f.snapshotId);
    const rows = await categoryPage(f.spaceId, NEXT_MONTH, copied.snapshotId);
    expect(rows.find((row) => row.rootId === f.rootA)).toMatchObject({ targetMinor: '10000', carryMinor: '-2000', effectiveTargetMinor: '8000' });
    expect(rows.find((row) => row.rootId === f.rootB)).toMatchObject({ targetMinor: '10000', carryMinor: '0', effectiveTargetMinor: '10000' });
    expect((await monthState(f.spaceId, NEXT_MONTH)).plannedIncomeMinor).toBe('100000');
  });

  it('a root overspend can outweigh its group; roots, group and standalone carry reconcile separately', async () => {
    const f = await fixture('Rollover reconciliation');
    await setPolicy(f.spaceId, f.rootA, true);
    await setPolicy(f.spaceId, f.standalone, true);
    await spend(f.spaceId, f.walletId, f.rootA, dayOf(CLOSED_MONTH, 10), '70000');
    await spend(f.spaceId, f.walletId, f.standalone, dayOf(CLOSED_MONTH, 12), '1000');
    await close(f.spaceId);
    const plainNext = await publish(f, monthStart(-4), [
      { categoryId: f.rootA, amountMinor: '10000' }, { categoryId: f.rootB, amountMinor: '10000' }, { categoryId: f.standalone, amountMinor: '5000' },
    ]);
    expect(plainNext).toMatch(/^\d+$/);
    const noCarry = await monthState(f.spaceId, monthStart(-4));

    const copied = await copy(f.spaceId, f.snapshotId);
    const state = await monthState(f.spaceId, NEXT_MONTH);
    const group = state.groups.find((row) => row.groupId === f.groupId)!;
    expect(group).toMatchObject({ targetMinor: '50000', carryMinor: '-60000', effectiveTargetMinor: '-10000', varianceMinor: '-10000' });
    expect(state.groups.find((row) => row.rowKind === 'unmapped')).toMatchObject({ targetMinor: '5000', carryMinor: '4000', effectiveTargetMinor: '9000' });
    expect(state.carryMinor).toBe('-56000');
    expect(state.leftToAllocateMinor).toBe(noCarry.leftToAllocateMinor);

    const rows = await categoryPage(f.spaceId, NEXT_MONTH, copied.snapshotId);
    const grouped = rows.filter((row) => row.rootId !== f.standalone);
    const sum = (values: string[]) => values.reduce((total, value) => total + BigInt(value), 0n);
    expect(sum(grouped.map((row) => row.effectiveTargetMinor))).toBe(sum(grouped.map((row) => row.targetMinor)) + sum(grouped.map((row) => row.carryMinor)));
    expect(sum(grouped.map((row) => row.carryMinor))).toBe(BigInt(group.carryMinor!));
  });

  it('carry comes from the accepted close; a refund dated in the next month changes only that month', async () => {
    const f = await fixture('Rollover incoming chain');
    await setPolicy(f.spaceId, f.rootA, true);
    const purchase = await spend(f.spaceId, f.walletId, f.rootA, dayOf(CLOSED_MONTH, 20), '8000');
    const first = await close(f.spaceId);
    await copy(f.spaceId, f.snapshotId);
    await rpc('select id from public.reverse_financial_event($1,$2,$3,$4::date) limit 2', [f.spaceId, randomUUID(), purchase, dayOf(NEXT_MONTH, 2)]);

    const next = await rpc<ClosePreview>('select public.preview_budget_month_close($1,$2,$3::date,$4)', [f.spaceId, 'USD', NEXT_MONTH, null]);
    expect(next.roots.find((root) => root.categoryId === f.rootA)).toMatchObject({
      baseMinor: '10000', carryMinor: '2000', effectiveMinor: '12000', actualMinor: '-8000', outgoingCarryMinor: '20000',
      carrySourceCloseId: first.closeId,
    });
    const closedAgain = await rpc<ClosePreview & { restatementRequired: boolean }>(
      'select public.preview_budget_month_close($1,$2,$3::date,$4)', [f.spaceId, 'USD', CLOSED_MONTH, first.closeId],
    );
    expect(closedAgain.restatementRequired).toBe(false);
  });

  it('restating the closed month flags the next month for review and never rewrites its accepted carry link', async () => {
    const f = await fixture('Rollover restatement review');
    await setPolicy(f.spaceId, f.rootA, true);
    await spend(f.spaceId, f.walletId, f.rootA, dayOf(CLOSED_MONTH, 10), '8000');
    const first = await close(f.spaceId);
    const copied = await copy(f.spaceId, f.snapshotId);
    expect((await monthState(f.spaceId, NEXT_MONTH)).carryNeedsReview).toBe(false);

    await spend(f.spaceId, f.walletId, f.rootA, dayOf(CLOSED_MONTH, 27), '500');
    expect((await monthState(f.spaceId, NEXT_MONTH)).carryNeedsReview).toBe(false);
    const restated = await close(f.spaceId);
    expect(restated.closeId).not.toBe(first.closeId);

    const state = await monthState(f.spaceId, NEXT_MONTH);
    expect(state).toMatchObject({ carryNeedsReview: true, carryMinor: '2000' });
    const link = await db().client.query<{ close_id: string; carry: string }>(
      'select source_close_id::text as close_id, carry_minor::text as carry from public.budget_month_carry_links where target_snapshot_id = $1 and root_id = $2',
      [copied.snapshotId, f.rootA],
    );
    expect(link.rows).toEqual([{ close_id: first.closeId, carry: '2000' }]);

    const recopy = await copy(f.spaceId, f.snapshotId);
    expect(recopy.preview.carrySources).toEqual([{ rootId: f.rootA, sourceCloseId: restated.closeId, carryMinor: '1500' }]);
    expect(await monthState(f.spaceId, NEXT_MONTH)).toMatchObject({ carryNeedsReview: false, carryMinor: '1500' });
  });

  it('a snapshot republished without carry is flagged when the prior close still has non-zero carry', async () => {
    const f = await fixture('Rollover manual republish');
    await setPolicy(f.spaceId, f.rootA, true);
    await spend(f.spaceId, f.walletId, f.rootA, dayOf(CLOSED_MONTH, 10), '8000');
    await close(f.spaceId);
    await copy(f.spaceId, f.snapshotId);
    await publish(f, NEXT_MONTH, [
      { categoryId: f.rootA, amountMinor: '10000' }, { categoryId: f.rootB, amountMinor: '10000' }, { categoryId: f.standalone, amountMinor: '5000' },
    ]);
    expect(await monthState(f.spaceId, NEXT_MONTH)).toMatchObject({ carryNeedsReview: true, carryMinor: '0' });
  });

  it('available cash (task 17) reserves the effective capacity of a group that received carry', async () => {
    const previous = monthStart(-1);
    const current = monthStart(0);
    const f = await fixture('Rollover available cash', previous);
    await setPolicy(f.spaceId, f.rootA, true);
    await spend(f.spaceId, f.walletId, f.rootA, dayOf(previous, 3), '8000');
    await close(f.spaceId, previous);
    await copy(f.spaceId, f.snapshotId, current);
    const summary = await rpc<{ state: string; groups: Array<{ id: string; budgetRemainingMinor: string }> }>(
      'select public.available_cash_summary($1,$2,$3::date)', [f.spaceId, 'USD', todayUtc()],
    );
    expect(summary.state).toBe('ready');
    expect(summary.groups.find((group) => group.id === f.groupId)).toMatchObject({ budgetRemainingMinor: '52000' });
  });
});
