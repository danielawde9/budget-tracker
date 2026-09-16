import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase, disposeDisposableDatabase,
  expectSavepointRejection, migrationFiles, orderedAuthenticatedRace, replayMigrations,
  withAuthenticatedTransaction, withRollback,
  type DisposableDatabase,
} from './disposable-database.js';

// Task 20: explicit "copy a month" -- a preview whose exact hash the command
// re-derives under the space lock, published through
// publish_allocation_month_v2, plus immutable carry links in the same
// transaction.

let database: DisposableDatabase | undefined;
const actor = randomUUID();
const outsider = randomUUID();

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_monthcopy');
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
const SOURCE_MONTH = monthStart(-3);
const TARGET_MONTH = monthStart(-2);
const HEX64 = /^[0-9a-f]{64}$/;

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
async function expenseRoot(spaceId: string, name: string): Promise<string> {
  return rpc<string>("select id from public.create_category($1,$2,'expense',$3,null) limit 2", [spaceId, randomUUID(), name]);
}
async function archive(spaceId: string, categoryId: string): Promise<void> {
  await rpc('select id from public.archive_category($1,$2,$3) limit 2', [spaceId, randomUUID(), categoryId]);
}
async function spend(spaceId: string, walletId: string, categoryId: string, date: string, amountMinor: string): Promise<string> {
  return rpc<string>(
    "select id from public.record_categorized_financial_event($1,$2,'expense',$3::date,$4::jsonb,$5) limit 2",
    [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor: `-${amountMinor}` }]), categoryId],
  );
}
async function goal(spaceId: string, name: string): Promise<{ goalId: string; revisionId: string }> {
  return rpc('select public.create_goal_plan($1,$2,$3,$4::jsonb,$5::jsonb)', [spaceId, randomUUID(), randomUUID(), JSON.stringify({
    kind: 'reserve', currency: 'USD', nameEn: name, nameAr: null, note: null, targetMinor: '600000', deadline: null,
    contributionMode: 'manual_monthly', monthlyAmountMinor: '0', priority: 0,
  }), '[]']);
}
async function setGoalState(spaceId: string, created: { goalId: string; revisionId: string }, name: string, state: 'paused' | 'closed'): Promise<void> {
  await rpc('select public.revise_goal_plan($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)', [spaceId, randomUUID(), created.goalId, created.revisionId, JSON.stringify({
    kind: 'reserve', currency: 'USD', nameEn: name, nameAr: null, note: null, targetMinor: '600000', deadline: null,
    contributionMode: 'manual_monthly', monthlyAmountMinor: '0', priority: 0,
  }), '[]', state]);
}

interface Fixture {
  spaceId: string; walletId: string; spendingGroup: string; futureGroup: string; templateId: string;
  rootA: string; rootB: string; standalone: string; snapshotId: string;
}

async function heads(spaceId: string, month: string): Promise<{ income: string | null; roots: Map<string, string>; goals: Map<string, string>; snapshot: string | null }> {
  const plans = await db().client.query<{ category_id: string | null; plan_kind: string; id: string }>(
    `select distinct on (plan_kind, category_id) category_id::text, plan_kind, id::text from public.monthly_budget_plan_revisions
     where space_id = $1 and month_start = $2::date and currency = 'USD' order by plan_kind, category_id, id desc`, [spaceId, month],
  );
  const goals = await db().client.query<{ goal_id: string; id: string }>(
    `select distinct on (goal_id) goal_id::text, id::text from public.goal_monthly_target_revisions
     where space_id = $1 and month_start = $2::date order by goal_id, id desc`, [spaceId, month],
  );
  const snapshot = await db().client.query<{ id: string }>(
    "select id::text from public.allocation_month_snapshots where space_id = $1 and month_start = $2::date and currency = 'USD' order by id desc limit 1",
    [spaceId, month],
  );
  return {
    income: plans.rows.find((row) => row.plan_kind === 'income')?.id ?? null,
    roots: new Map(plans.rows.filter((row) => row.category_id).map((row) => [row.category_id!, row.id])),
    goals: new Map(goals.rows.map((row) => [row.goal_id, row.id])),
    snapshot: snapshot.rows[0]?.id ?? null,
  };
}

async function publish(f: Pick<Fixture, 'spaceId' | 'templateId'>, month: string, roots: Array<{ categoryId: string; amountMinor: string }>,
  goals: Array<{ goalId: string; groupId: string | null; amountMinor: string }> = []): Promise<string> {
  const current = await heads(f.spaceId, month);
  const result = await rpc<{ snapshotId: string }>(
    'select public.publish_allocation_month_v2($1,$2,$3::date,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb)',
    [f.spaceId, randomUUID(), month, 'USD', current.snapshot, f.templateId, current.income, '100000',
      JSON.stringify(roots.map((root) => ({ ...root, expectedRevisionId: current.roots.get(root.categoryId) ?? null }))), null,
      JSON.stringify(goals.map((line) => ({ ...line, expectedRevisionId: current.goals.get(line.goalId) ?? null })))],
  );
  return result.snapshotId;
}

async function fixture(name: string, goals: Array<{ goalId: string; groupId: string | null; amountMinor: string }> | ((f: Omit<Fixture, 'snapshotId'>) => Promise<Array<{ goalId: string; groupId: string | null; amountMinor: string }>>) = []): Promise<Fixture> {
  const spaceId = await freshSpace(name);
  const walletId = await rpc<string>("select id from public.create_wallet($1,'Cash','USD') limit 2", [spaceId]);
  const rootA = await expenseRoot(spaceId, 'Groceries');
  const rootB = await expenseRoot(spaceId, 'Transport');
  const standalone = await expenseRoot(spaceId, 'Gifts');
  const spendingGroup = randomUUID();
  const futureGroup = randomUUID();
  const template = await rpc<{ templateRevisionId: string }>(
    'select public.save_allocation_template($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
    [spaceId, randomUUID(), 'USD', null, JSON.stringify([
      { id: spendingGroup, purpose: 'spending', nameEn: 'Living', nameAr: 'المعيشة', order: 0, basisPoints: 5000 },
      { id: futureGroup, purpose: 'future', nameEn: 'Future', nameAr: null, order: 1, basisPoints: 2000 },
    ]), JSON.stringify([{ categoryId: rootA, groupId: spendingGroup }, { categoryId: rootB, groupId: spendingGroup }])],
  );
  const base = { spaceId, walletId, spendingGroup, futureGroup, templateId: template.templateRevisionId, rootA, rootB, standalone };
  const goalLines = typeof goals === 'function' ? await goals(base) : goals;
  const snapshotId = await publish(base, SOURCE_MONTH, [
    { categoryId: rootA, amountMinor: '10000' }, { categoryId: rootB, amountMinor: '12000' }, { categoryId: standalone, amountMinor: '5000' },
  ], goalLines);
  return { ...base, snapshotId };
}

interface CopyPreview {
  previewHash: string; sourceSnapshotId: string; sourceMonth: string; targetMonth: string; currency: string;
  expectedTargetSnapshotId: string | null; templateRevisionId: string; expectedIncomeRevisionId: string | null;
  incomeMinor: string; loanGroupId: string | null; carryCloseId: string | null;
  groups: Array<{ groupId: string; nameEn: string | null; nameAr: string | null; purpose: string; order: number; basisPoints: number; targetMinor: string; carryMinor: string; effectiveMinor: string }>;
  roots: Array<{ categoryId: string; nameEn: string | null; nameAr: string | null; groupId: string | null; baseMinor: string; carryMinor: string; effectiveMinor: string; actualMinor: null; outgoingCarryMinor: null; expectedRevisionId: string | null }>;
  goals: Array<{ goalId: string; groupId: string | null; targetMinor: string; expectedRevisionId: string | null }>;
  omissions: Array<{ entityId: string; kind: string; reason: string }>;
  carrySources: Array<{ rootId: string; sourceCloseId: string; carryMinor: string }>;
}
interface CopyResult { snapshotId: string; sourceSnapshotId: string; previewHash: string }

async function previewCopy(spaceId: string, sourceSnapshotId: string, targetMonth = TARGET_MONTH, userId = actor, currency = 'USD'): Promise<CopyPreview> {
  return rpc<CopyPreview>('select public.preview_month_copy($1,$2,$3,$4::date)', [spaceId, currency, sourceSnapshotId, targetMonth], userId);
}
async function copyMonth(spaceId: string, preview: CopyPreview, requestId: string = randomUUID(), userId = actor): Promise<CopyResult> {
  return rpc<CopyResult>('select public.copy_allocation_month($1,$2,$3,$4,$5::date,$6,$7)',
    [spaceId, requestId, 'USD', preview.sourceSnapshotId, preview.targetMonth, preview.expectedTargetSnapshotId, preview.previewHash], userId);
}
async function closeMonth(spaceId: string, month = SOURCE_MONTH): Promise<string> {
  const head = await db().client.query<{ id: string }>(
    "select id::text from public.budget_month_closes where space_id = $1 and month_start = $2::date order by id desc limit 1", [spaceId, month],
  );
  const preview = await rpc<{ previewHash: string; expectedCloseId: string | null }>(
    'select public.preview_budget_month_close($1,$2,$3::date,$4)', [spaceId, 'USD', month, head.rows[0]?.id ?? null],
  );
  const closed = await rpc<{ closeId: string }>('select public.close_budget_month($1,$2,$3,$4::date,$5,$6)',
    [spaceId, randomUUID(), 'USD', month, preview.expectedCloseId, preview.previewHash]);
  return closed.closeId;
}
async function setPolicy(spaceId: string, rootId: string, enabled: boolean): Promise<void> {
  await rpc('select public.set_rollover_policy($1,$2,$3,$4,$5,$6)', [spaceId, randomUUID(), 'USD', rootId, enabled, null]);
}

async function financialDigest(spaceId: string): Promise<unknown> {
  const result = await db().client.query<{ row_count: string }>(
    `select 'events' as relation_name, count(*)::text as row_count,
      md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), '')) as digest
     from (select * from public.financial_events where space_id = $1 order by id limit 101) x
     union all
     select 'movements', count(*)::text, md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), ''))
     from (select * from public.wallet_movements where space_id = $1 order by id limit 101) x
     union all
     select 'loans', count(*)::text, md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.event_id), ''))
     from (select * from public.loan_postings where space_id = $1 order by event_id limit 101) x
     order by relation_name`,
    [spaceId],
  );
  expect(result.rows.every((row) => Number(row.row_count) <= 100)).toBe(true);
  return result.rows;
}

describe('preview_month_copy', () => {
  it('copies template percentages and base expected income -- not actual salary, spending or earmarks', async () => {
    const created: Array<{ goalId: string; revisionId: string }> = [];
    const f = await fixture('Copy preview basics', async (base) => {
      const saving = await goal(base.spaceId, 'Emergency fund');
      created.push(saving);
      return [{ goalId: saving.goalId, groupId: base.futureGroup, amountMinor: '3000' }];
    });
    await rpc("select id from public.record_financial_event($1,$2,'income',$3::date,$4::jsonb) limit 2",
      [f.spaceId, randomUUID(), dayOf(SOURCE_MONTH, 1), JSON.stringify([{ walletId: f.walletId, amountMinor: '250000' }])]);
    await spend(f.spaceId, f.walletId, f.rootA, dayOf(SOURCE_MONTH, 9), '9000');

    const preview = await previewCopy(f.spaceId, f.snapshotId);
    expect(preview.previewHash).toMatch(HEX64);
    expect(preview).toMatchObject({
      sourceSnapshotId: f.snapshotId, sourceMonth: SOURCE_MONTH, targetMonth: TARGET_MONTH, currency: 'USD',
      expectedTargetSnapshotId: null, templateRevisionId: f.templateId, expectedIncomeRevisionId: null,
      incomeMinor: '100000', loanGroupId: null, carryCloseId: null, omissions: [], carrySources: [],
    });
    expect(preview.groups).toEqual([
      { groupId: f.spendingGroup, nameEn: 'Living', nameAr: 'المعيشة', purpose: 'spending', order: 0, basisPoints: 5000, targetMinor: '50000', carryMinor: '0', effectiveMinor: '50000' },
      { groupId: f.futureGroup, nameEn: 'Future', nameAr: null, purpose: 'future', order: 1, basisPoints: 2000, targetMinor: '20000', carryMinor: '0', effectiveMinor: '20000' },
    ]);
    const roots = new Map(preview.roots.map((root) => [root.categoryId, root]));
    expect(roots.get(f.rootA)).toEqual({
      categoryId: f.rootA, nameEn: 'Groceries', nameAr: null, groupId: f.spendingGroup, baseMinor: '10000',
      carryMinor: '0', effectiveMinor: '10000', actualMinor: null, outgoingCarryMinor: null, expectedRevisionId: null,
    });
    expect(roots.get(f.standalone)).toMatchObject({ groupId: null, baseMinor: '5000' });
    expect(preview.goals).toEqual([{ goalId: created[0]!.goalId, groupId: f.futureGroup, targetMinor: '3000', expectedRevisionId: null }]);
    expect(await previewCopy(f.spaceId, f.snapshotId)).toEqual(preview);
  });

  it('reports archived roots and non-active goals as omissions and zero-clears positive destination targets', async () => {
    const goals: Record<string, { goalId: string; revisionId: string }> = {};
    const f = await fixture('Copy omissions', async (base) => {
      goals.active = await goal(base.spaceId, 'Active goal');
      goals.paused = await goal(base.spaceId, 'Paused goal');
      goals.destination = await goal(base.spaceId, 'Destination goal');
      return [
        { goalId: goals.active.goalId, groupId: null, amountMinor: '3000' },
        { goalId: goals.paused.goalId, groupId: base.futureGroup, amountMinor: '2000' },
      ];
    });
    await archive(f.spaceId, f.standalone);
    await archive(f.spaceId, f.rootB);
    await setGoalState(f.spaceId, goals.paused!, 'Paused goal', 'paused');
    const destinationOnly = await expenseRoot(f.spaceId, 'Holiday');
    await rpc("select * from public.set_monthly_category_target($1,$2,$3,$4::date,'USD','7000',null)", [f.spaceId, randomUUID(), destinationOnly, TARGET_MONTH]);
    await rpc('select public.set_goal_monthly_target($1,$2,$3,$4::date,$5,$6)', [f.spaceId, randomUUID(), goals.destination!.goalId, TARGET_MONTH, '4000', null]);

    const preview = await previewCopy(f.spaceId, f.snapshotId);
    const roots = new Map(preview.roots.map((root) => [root.categoryId, root]));
    expect(roots.has(f.standalone)).toBe(false);
    expect(roots.get(f.rootB)).toMatchObject({ baseMinor: '0', groupId: f.spendingGroup });
    expect(roots.get(destinationOnly)).toMatchObject({ baseMinor: '0', groupId: null, expectedRevisionId: expect.stringMatching(/^\d+$/) });
    expect(roots.get(f.rootA)).toMatchObject({ baseMinor: '10000' });
    const goalLines = new Map(preview.goals.map((line) => [line.goalId, line]));
    expect(goalLines.get(goals.active!.goalId)).toMatchObject({ targetMinor: '3000', groupId: null });
    expect(goalLines.has(goals.paused!.goalId)).toBe(false);
    expect(goalLines.get(goals.destination!.goalId)).toMatchObject({ targetMinor: '0', groupId: null, expectedRevisionId: expect.stringMatching(/^\d+$/) });
    expect(preview.omissions).toEqual([
      { entityId: goals.paused!.goalId, kind: 'goal', reason: 'paused' },
      ...[{ entityId: f.rootB, kind: 'root', reason: 'archived' }, { entityId: f.standalone, kind: 'root', reason: 'archived' }]
        .sort((left, right) => left.entityId.localeCompare(right.entityId)),
    ]);

    const copied = await copyMonth(f.spaceId, preview);
    const saved = await db().client.query<{ category_id: string; target: string }>(
      'select category_id::text, target_minor::text as target from public.allocation_month_roots where snapshot_id = $1 order by category_id', [copied.snapshotId],
    );
    expect(new Map(saved.rows.map((row) => [row.category_id, row.target]))).toEqual(new Map([
      [f.rootA, '10000'], [f.rootB, '0'], [destinationOnly, '0'],
    ]));
  });

  it('rejects the same month, a non-normalized month, a target more than 24 months away, and a foreign or other-currency source', async () => {
    const f = await fixture('Copy input guards');
    const other = await fixture('Copy input guards other');
    for (const target of [SOURCE_MONTH, dayOf(TARGET_MONTH, 2), monthStart(22), monthStart(-28)]) {
      await expect(previewCopy(f.spaceId, f.snapshotId, target)).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
    }
    expect((await previewCopy(f.spaceId, f.snapshotId, monthStart(21))).targetMonth).toBe(monthStart(21));
    await expect(previewCopy(f.spaceId, other.snapshotId)).rejects.toMatchObject({ code: 'P0001', message: 'month_copy_source_not_found' });
    await expect(previewCopy(f.spaceId, f.snapshotId, TARGET_MONTH, actor, 'LBP')).rejects.toMatchObject({ code: 'P0001', message: 'month_copy_source_not_found' });
    await expect(previewCopy(f.spaceId, f.snapshotId, TARGET_MONTH, outsider)).rejects.toMatchObject({ code: '42501' });
    for (const args of [[null, 'USD', f.snapshotId, TARGET_MONTH], [f.spaceId, null, f.snapshotId, TARGET_MONTH], [f.spaceId, 'USD', null, TARGET_MONTH], [f.spaceId, 'USD', f.snapshotId, null]]) {
      await expect(rpc('select public.preview_month_copy($1,$2,$3,$4::date)', args)).rejects.toMatchObject({ code: expect.stringMatching(/^(22023|42501)$/) });
    }
  });
});

describe('copy_allocation_month', () => {
  it('publishes exactly the accepted preview through publish_allocation_month_v2 and records both receipts', async () => {
    const f = await fixture('Copy publishes');
    const preview = await previewCopy(f.spaceId, f.snapshotId);
    const requestId = randomUUID();
    const copied = await copyMonth(f.spaceId, preview, requestId);
    expect(copied).toEqual({ snapshotId: expect.stringMatching(/^\d+$/), sourceSnapshotId: f.snapshotId, previewHash: preview.previewHash });

    const snapshot = await db().client.query<{ month: string; template: string; income: string; roots: string }>(
      `select to_char(month_start,'YYYY-MM-DD') as month, template_revision_id::text as template, base_income_minor::text as income, root_count::text as roots
       from public.allocation_month_snapshots where id = $1`, [copied.snapshotId],
    );
    expect(snapshot.rows[0]).toEqual({ month: TARGET_MONTH, template: f.templateId, income: '100000', roots: '3' });
    const receipts = await db().client.query<{ command: string }>(
      'select command from public.planning_command_receipts where space_id = $1 order by sequence_id desc limit 2', [f.spaceId],
    );
    expect(receipts.rows.map((row) => row.command)).toEqual(['copy_allocation_month', 'publish_allocation_month_v2']);
    const found = await rpc<{ command: string; result: CopyResult }>('select public.find_planning_command($1,$2)', [f.spaceId, requestId]);
    expect(found).toMatchObject({ command: 'copy_allocation_month', result: copied });
  });

  it('replays the same request and refuses a changed payload under the same request id', async () => {
    const f = await fixture('Copy replay');
    const preview = await previewCopy(f.spaceId, f.snapshotId);
    const requestId = randomUUID();
    const first = await copyMonth(f.spaceId, preview, requestId);
    expect(await copyMonth(f.spaceId, preview, requestId)).toEqual(first);
    const count = await db().client.query('select count(*)::text as n from public.allocation_month_snapshots where space_id = $1 and month_start = $2::date', [f.spaceId, TARGET_MONTH]);
    expect(count.rows[0]!.n).toBe('1');
    await expect(copyMonth(f.spaceId, { ...preview, expectedTargetSnapshotId: first.snapshotId }, requestId))
      .rejects.toMatchObject({ code: 'P0001', message: 'planning_idempotency_conflict' });
  });

  it('rejects a mutated preview hash and a destination that changed after the preview with 40001', async () => {
    const f = await fixture('Copy stale');
    const preview = await previewCopy(f.spaceId, f.snapshotId);
    await expect(copyMonth(f.spaceId, { ...preview, previewHash: 'f'.repeat(64) })).rejects.toMatchObject({ code: '40001', message: 'planning_stale_revision' });
    await rpc("select * from public.set_monthly_category_target($1,$2,$3,$4::date,'USD','1',null)", [f.spaceId, randomUUID(), f.rootA, TARGET_MONTH]);
    await expect(copyMonth(f.spaceId, preview)).rejects.toMatchObject({ code: '40001', message: 'planning_stale_revision' });
    await expect(copyMonth(f.spaceId, { ...preview, expectedTargetSnapshotId: '999999999' })).rejects.toMatchObject({ code: '40001' });
    const count = await db().client.query('select count(*)::text as n from public.allocation_month_snapshots where space_id = $1 and month_start = $2::date', [f.spaceId, TARGET_MONTH]);
    expect(count.rows[0]!.n).toBe('0');
  });

  it('two connections copying onto the same expected target head: exactly one succeeds', async () => {
    const f = await fixture('Copy race');
    const preview = await previewCopy(f.spaceId, f.snapshotId);
    const call = (client: import('pg').Client) => client.query('select public.copy_allocation_month($1,$2,$3,$4,$5::date,$6,$7)',
      [f.spaceId, randomUUID(), 'USD', f.snapshotId, TARGET_MONTH, null, preview.previewHash]);
    const outcome = await orderedAuthenticatedRace(db(), actor, call, call);
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') expect(outcome.reason).toMatchObject({ code: '40001', message: 'planning_stale_revision' });
    const count = await db().client.query('select count(*)::text as n from public.allocation_month_snapshots where space_id = $1 and month_start = $2::date', [f.spaceId, TARGET_MONTH]);
    expect(count.rows[0]!.n).toBe('1');
  });

  it('never duplicates recurring occurrences, re-observes loan commitments for the target month, and never moves money', async () => {
    const f = await fixture('Copy side effects');
    await rpc('select public.save_schedule($1,$2,$3,$4,$5::jsonb)', [f.spaceId, randomUUID(), randomUUID(), null, JSON.stringify({
      currency: 'USD', kind: 'expense', state: 'active', nameEn: 'Rent', nameAr: null, expectedMinor: '50000',
      startsOn: dayOf(SOURCE_MONTH, 5), endsOn: null, cadence: 'monthly', intervalCount: 1,
      categoryId: null, loanId: null, fundingGoalId: null, preferredWalletId: null,
    })]);
    await rpc('select public.materialize_schedule_occurrences($1,$2,$3::date,$4::date)', [f.spaceId, randomUUID(), SOURCE_MONTH, dayOf(TARGET_MONTH, 28)]);
    const loanId = await rpc<string>(
      "select loan_id::text from public.record_cash_loan($1,$2,'i_owe_them','Lender','USD',$3,'90000',$4::date)",
      [f.spaceId, randomUUID(), f.walletId, dayOf(SOURCE_MONTH, 1)],
    );
    await rpc('select public.set_loan_monthly_target($1,$2,$3,$4::date,$5)', [f.spaceId, randomUUID(), loanId, TARGET_MONTH, '15000']);

    const occurrencesBefore = await db().client.query('select count(*)::text as n from public.scheduled_occurrences where space_id = $1', [f.spaceId]);
    const moneyBefore = await financialDigest(f.spaceId);
    const copied = await copyMonth(f.spaceId, await previewCopy(f.spaceId, f.snapshotId));
    const occurrencesAfter = await db().client.query('select count(*)::text as n from public.scheduled_occurrences where space_id = $1', [f.spaceId]);
    expect(occurrencesAfter.rows[0]!.n).toBe(occurrencesBefore.rows[0]!.n);
    expect(await financialDigest(f.spaceId)).toEqual(moneyBefore);

    const observed = await db().client.query<{ remaining: string }>(
      'select observed_remaining_minor::text as remaining from public.allocation_month_commitments where snapshot_id = $1', [copied.snapshotId],
    );
    const summary = await rpc<string>(
      "select coalesce((select remaining_reservation_minor::text from public.loan_monthly_currency_summary($1,$2::date) where currency = 'USD'), '0')",
      [f.spaceId, TARGET_MONTH],
    );
    expect(observed.rows[0]!.remaining).toBe(summary);
    expect(summary).toBe('15000');
  });
});

describe('carry links', () => {
  async function carryFixture(name: string): Promise<Fixture & { closeId: string }> {
    const f = await fixture(name);
    await setPolicy(f.spaceId, f.rootA, true);
    await setPolicy(f.spaceId, f.rootB, true);
    await spend(f.spaceId, f.walletId, f.rootA, dayOf(SOURCE_MONTH, 10), '8000');
    await spend(f.spaceId, f.walletId, f.rootB, dayOf(SOURCE_MONTH, 11), '13000');
    const closeId = await closeMonth(f.spaceId);
    return { ...f, closeId };
  }

  it('records one immutable link per enabled, active root in the same transaction as the copied snapshot', async () => {
    const f = await carryFixture('Carry links recorded');
    const preview = await previewCopy(f.spaceId, f.snapshotId);
    expect(preview.carryCloseId).toBe(f.closeId);
    expect(preview.carrySources).toEqual([
      { rootId: f.rootA, sourceCloseId: f.closeId, carryMinor: '2000' },
      { rootId: f.rootB, sourceCloseId: f.closeId, carryMinor: '-1000' },
    ].sort((left, right) => left.rootId.localeCompare(right.rootId)));
    expect(preview.groups[0]).toMatchObject({ targetMinor: '50000', carryMinor: '1000', effectiveMinor: '51000' });
    const copied = await copyMonth(f.spaceId, preview);
    const links = await db().client.query<{ root_id: string; carry: string; same_tx: boolean }>(
      `select link.root_id::text, link.carry_minor::text as carry, link.created_at = snapshot.created_at as same_tx
       from public.budget_month_carry_links link join public.allocation_month_snapshots snapshot on snapshot.id = link.target_snapshot_id
       where link.target_snapshot_id = $1 order by link.root_id`, [copied.snapshotId],
    );
    expect(links.rows).toEqual([
      { root_id: f.rootA, carry: '2000', same_tx: true }, { root_id: f.rootB, carry: '-1000', same_tx: true },
    ].sort((left, right) => left.root_id.localeCompare(right.root_id)));
  });

  it('omits carry for an archived root and never adds a zero-carry absent root', async () => {
    const f = await carryFixture('Carry archived root');
    await archive(f.spaceId, f.rootB);
    const preview = await previewCopy(f.spaceId, f.snapshotId);
    expect(preview.carrySources).toEqual([{ rootId: f.rootA, sourceCloseId: f.closeId, carryMinor: '2000' }]);
    expect(preview.omissions).toEqual([
      { entityId: f.rootB, kind: 'carry', reason: 'archived' }, { entityId: f.rootB, kind: 'root', reason: 'archived' },
    ]);
    await copyMonth(f.spaceId, preview);
  });

  it('a link appended to the snapshot in a later transaction is rejected', async () => {
    const f = await carryFixture('Carry late append');
    await archive(f.spaceId, f.rootB);
    const copied = await copyMonth(f.spaceId, await previewCopy(f.spaceId, f.snapshotId));
    await withRollback(db().client, async () => {
      await db().client.query(
        `insert into public.budget_month_carry_links
           (space_id, currency, source_close_id, source_month_start, target_snapshot_id, target_month_start, root_id, carry_minor, actor_id)
         values ($1,'USD',$2,$3::date,$4,$5::date,$6,'-1000',$7)`,
        [f.spaceId, f.closeId, SOURCE_MONTH, copied.snapshotId, TARGET_MONTH, f.rootB, actor],
      );
      await expectSavepointRejection(db().client, async () => {
        await db().client.query('set constraints all immediate');
      }, { code: '23514', message: 'budget_month_carry_link_late' });
    });
  });

  it('rejects a carry amount that disagrees with the close, a cross-tenant close, and a non-adjacent month (structural)', async () => {
    const f = await carryFixture('Carry structural');
    const other = await carryFixture('Carry structural other');
    // rootB (carry -1000) is archived before the copy, so the copied snapshot
    // holds it at base 0 with no link: a probe on it reaches the foreign keys
    // instead of the (target_snapshot_id, root_id) unique index.
    await archive(f.spaceId, f.rootB);
    const copied = await copyMonth(f.spaceId, await previewCopy(f.spaceId, f.snapshotId));
    const insert = (values: { closeId?: string; sourceMonth?: string; carry?: string; spaceId?: string }) => db().client.query(
      `insert into public.budget_month_carry_links
         (space_id, currency, source_close_id, source_month_start, target_snapshot_id, target_month_start, root_id, carry_minor, actor_id)
       values ($1,'USD',$2,$3::date,$4,$5::date,$6,$7,$8)`,
      [values.spaceId ?? f.spaceId, values.closeId ?? f.closeId, values.sourceMonth ?? SOURCE_MONTH, copied.snapshotId, TARGET_MONTH,
        f.rootB, values.carry ?? '-1000', actor],
    );
    for (const [probe, code] of [
      [{ carry: '-999' }, '23503'], [{ closeId: other.closeId }, '23503'], [{ sourceMonth: monthStart(-4) }, '23514'],
    ] as const) {
      await withRollback(db().client, () => expectSavepointRejection(db().client, () => insert(probe), { code }));
    }
  });

  it('rejects links sourced from a restated (non-head) close, and links mixing two closes', async () => {
    const f = await carryFixture('Carry source head');
    const restated = await closeMonth(f.spaceId);
    expect(restated).not.toBe(f.closeId);
    const probes: Array<{ closes: [string, string]; message: string }> = [
      { closes: [f.closeId, f.closeId], message: 'budget_month_carry_link_source_not_head' },
      { closes: [f.closeId, restated], message: 'budget_month_carry_links_mixed_sources' },
    ];
    for (const probe of probes) {
      await withRollback(db().client, async () => {
        await db().client.query("select set_config('request.jwt.claim.sub', $1, true)", [actor]);
        await db().client.query('set local role authenticated');
        const published = await db().client.query<{ result: { snapshotId: string } }>(
          'select public.publish_allocation_month_v2($1,$2,$3::date,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb) as result',
          [f.spaceId, randomUUID(), TARGET_MONTH, 'USD', null, f.templateId, null, '100000', JSON.stringify([
            { categoryId: f.rootA, amountMinor: '10000', expectedRevisionId: null },
            { categoryId: f.rootB, amountMinor: '12000', expectedRevisionId: null },
          ]), null, '[]'],
        );
        await db().client.query('reset role');
        const snapshotId = published.rows[0]!.result.snapshotId;
        for (const [index, [rootId, carry]] of ([[f.rootA, '2000'], [f.rootB, '-1000']] as const).entries()) {
          await db().client.query(
            `insert into public.budget_month_carry_links
               (space_id, currency, source_close_id, source_month_start, target_snapshot_id, target_month_start, root_id, carry_minor, actor_id)
             values ($1,'USD',$2,$3::date,$4,$5::date,$6,$7,$8)`,
            [f.spaceId, probe.closes[index], SOURCE_MONTH, snapshotId, TARGET_MONTH, rootId, carry, actor],
          );
        }
        await expectSavepointRejection(db().client, async () => {
          await db().client.query('set constraints all immediate');
        }, { code: '23514', message: probe.message });
      });
    }
  });

  it('an incomplete link set published in one transaction is rejected at commit (missing child)', async () => {
    const f = await carryFixture('Carry missing child');
    await withRollback(db().client, async () => {
      await db().client.query("select set_config('request.jwt.claim.sub', $1, true)", [actor]);
      await db().client.query('set local role authenticated');
      const published = await db().client.query<{ result: { snapshotId: string } }>(
        'select public.publish_allocation_month_v2($1,$2,$3::date,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb) as result',
        [f.spaceId, randomUUID(), TARGET_MONTH, 'USD', null, f.templateId, null, '100000', JSON.stringify([
          { categoryId: f.rootA, amountMinor: '10000', expectedRevisionId: null },
          { categoryId: f.rootB, amountMinor: '12000', expectedRevisionId: null },
        ]), null, '[]'],
      );
      await db().client.query('reset role');
      await db().client.query(
        `insert into public.budget_month_carry_links
           (space_id, currency, source_close_id, source_month_start, target_snapshot_id, target_month_start, root_id, carry_minor, actor_id)
         values ($1,'USD',$2,$3::date,$4,$5::date,$6,'2000',$7)`,
        [f.spaceId, f.closeId, SOURCE_MONTH, published.rows[0]!.result.snapshotId, TARGET_MONTH, f.rootA, actor],
      );
      await expectSavepointRejection(db().client, async () => {
        await db().client.query('set constraints all immediate');
      }, { code: '23514', message: 'budget_month_carry_links_incomplete' });
    });
  });
});
