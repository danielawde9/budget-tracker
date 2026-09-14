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
  database = await createDisposableDatabase('budget_goalmonth');
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

const TODAY = '2026-09-14';
const MONTH = '2026-09-01';

async function freshSpace(name: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const space = await db().client.query<{ id: string }>(
      "select id from public.create_space($1, 'personal') limit 2", [name],
    );
    return space.rows[0]!.id;
  });
}

function templateGroup(id: string, purpose: 'spending' | 'future', order: number, basisPoints: number) {
  return { id, purpose, nameEn: 'Group', nameAr: null, order, basisPoints };
}

async function saveTemplate(spaceId: string, groups: unknown[]): Promise<number> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ save_allocation_template: { templateRevisionId: string } }>(
      'select public.save_allocation_template($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
      [spaceId, randomUUID(), 'USD', null, JSON.stringify(groups), '[]'],
    );
    return Number(result.rows[0]!.save_allocation_template.templateRevisionId);
  });
}

function definition(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: 'reserve', currency: 'USD', nameEn: 'Goal', nameAr: null, note: null,
    targetMinor: '600000', deadline: null, contributionMode: 'manual_monthly',
    monthlyAmountMinor: '0', priority: 0,
    ...overrides,
  };
}

async function createGoal(spaceId: string, overrides: Partial<Record<string, unknown>> = {}): Promise<{ goalId: string; revisionId: string }> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ create_goal_plan: { goalId: string; revisionId: string } }>(
      'select public.create_goal_plan($1,$2,$3,$4::jsonb,$5::jsonb)',
      [spaceId, randomUUID(), randomUUID(), JSON.stringify(definition(overrides)), '[]'],
    );
    return result.rows[0]!.create_goal_plan;
  });
}

async function headFor(goalId: string, asOf = TODAY): Promise<string> {
  const result = await db().client.query<{ head: string }>(
    'select head from private.goal_financing_state($1,$2::date)', [goalId, asOf],
  );
  return result.rows[0]!.head;
}

async function reserve(spaceId: string, goalId: string, amountMinor: string): Promise<void> {
  const expectedHead = await headFor(goalId);
  await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
    'select public.record_goal_earmark($1,$2,$3,$4,$5,$6,$7)',
    [spaceId, randomUUID(), goalId, 'reserve', amountMinor, expectedHead, true],
  ));
}

function goalTarget(goalId: string, amountMinor: string, groupId: string | null = null, expectedRevisionId: string | null = null) {
  return { goalId, groupId, amountMinor, expectedRevisionId };
}

async function publishV2(input: {
  spaceId: string; requestId?: string; expectedSnapshotId?: number | null; templateRevisionId: number;
  expectedIncomeRevisionId?: number | null; incomeMinor: string; rootTargets?: unknown[]; loanGroupId?: string | null;
  goalTargets: unknown[];
}) {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ publish_allocation_month_v2: { snapshotId: string; incomeRevisionId: string } }>(
      'select public.publish_allocation_month_v2($1,$2,$3::date,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb)',
      [input.spaceId, input.requestId ?? randomUUID(), MONTH, 'USD', input.expectedSnapshotId ?? null,
        input.templateRevisionId, input.expectedIncomeRevisionId ?? null, input.incomeMinor,
        JSON.stringify(input.rootTargets ?? []), input.loanGroupId ?? null, JSON.stringify(input.goalTargets)],
    );
    return result.rows[0]!.publish_allocation_month_v2;
  });
}

async function publishV1(input: {
  spaceId: string; requestId?: string; expectedSnapshotId?: number | null; templateRevisionId: number;
  expectedIncomeRevisionId?: number | null; incomeMinor: string; rootTargets?: unknown[]; loanGroupId?: string | null;
}) {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ publish_allocation_month: { snapshotId: string; incomeRevisionId: string } }>(
      'select public.publish_allocation_month($1,$2,$3::date,$4,$5,$6,$7,$8,$9::jsonb,$10)',
      [input.spaceId, input.requestId ?? randomUUID(), MONTH, 'USD', input.expectedSnapshotId ?? null,
        input.templateRevisionId, input.expectedIncomeRevisionId ?? null, input.incomeMinor,
        JSON.stringify(input.rootTargets ?? []), input.loanGroupId ?? null],
    );
    return result.rows[0]!.publish_allocation_month;
  });
}

async function monthState(spaceId: string) {
  const result = await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
    'select public.allocation_month_state($1,$2::date,$3,null)', [spaceId, MONTH, 'USD'],
  ));
  return result.rows[0]!.allocation_month_state as {
    leftToAllocateMinor: string; groups: Array<{ groupId: string | null; rowKind: string; actualMinor: string; targetMinor: string }>;
  };
}

describe('cash coverage across the space', () => {
  it('covers 60000/10000 for two goals racing a 70000 pool, then 50000/0 once the pool drops', async () => {
    const spaceId = await freshSpace('Coverage two-goal pool math');
    await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      "select id from public.create_wallet($1, 'Cash', 'USD') limit 2", [spaceId],
    ));
    const wallet = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query<{ id: string }>(
        "select id from public.create_wallet($1, 'Cash2', 'USD') limit 2", [spaceId],
      );
      return result.rows[0]!.id;
    });
    await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      `select id from public.record_financial_event($1,$2,'income',$3::date,$4::jsonb) limit 2`,
      [spaceId, randomUUID(), TODAY, JSON.stringify([{ walletId: wallet, amountMinor: '70000' }])],
    ));
    const first = await createGoal(spaceId, { nameEn: 'First', priority: 0 });
    const second = await createGoal(spaceId, { nameEn: 'Second', priority: 1 });
    await reserve(spaceId, first.goalId, '60000');
    await reserve(spaceId, second.goalId, '30000');

    const before = await db().client.query<{ goal_id: string; covered_minor: string }>(
      'select goal_id::text, covered_minor::text from private.goal_coverage_set($1,$2,$3::date) order by priority',
      [spaceId, 'USD', TODAY],
    );
    expect(before.rows).toEqual([
      { goal_id: first.goalId, covered_minor: '60000' },
      { goal_id: second.goalId, covered_minor: '10000' },
    ]);

    await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      `select id from public.record_financial_event($1,$2,'expense',$3::date,$4::jsonb) limit 2`,
      [spaceId, randomUUID(), TODAY, JSON.stringify([{ walletId: wallet, amountMinor: '-20000' }])],
    ));
    const after = await db().client.query<{ goal_id: string; covered_minor: string }>(
      'select goal_id::text, covered_minor::text from private.goal_coverage_set($1,$2,$3::date) order by priority',
      [spaceId, 'USD', TODAY],
    );
    expect(after.rows).toEqual([
      { goal_id: first.goalId, covered_minor: '50000' },
      { goal_id: second.goalId, covered_minor: '0' },
    ]);
  });

  it('retains identical coverage for the same goal regardless of which page it lands on', async () => {
    const spaceId = await freshSpace('Coverage stable across pages');
    const wallet = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query<{ id: string }>(
        "select id from public.create_wallet($1, 'Cash', 'USD') limit 2", [spaceId],
      );
      return result.rows[0]!.id;
    });
    await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      `select id from public.record_financial_event($1,$2,'income',$3::date,$4::jsonb) limit 2`,
      [spaceId, randomUUID(), TODAY, JSON.stringify([{ walletId: wallet, amountMinor: '100000' }])],
    ));
    const goals = [] as Array<{ goalId: string }>;
    for (let index = 0; index < 5; index += 1) {
      const goal = await createGoal(spaceId, { nameEn: `Goal ${index}` });
      await reserve(spaceId, goal.goalId, '10000');
      goals.push(goal);
    }

    const fullPage = await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      'select public.goal_page($1,$2,$3,$4,$5,$6)', [spaceId, 'USD', 'all', null, null, 10],
    ));
    const full = fullPage.rows[0]!.goal_page as { rows: Array<Record<string, unknown>> };

    const page1 = await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      'select public.goal_page($1,$2,$3,$4,$5,$6)', [spaceId, 'USD', 'all', null, null, 2],
    ));
    const firstPage = page1.rows[0]!.goal_page as { rows: Array<Record<string, unknown>>; nextCursor: { createdAt: string; id: string } };
    const page2 = await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      'select public.goal_page($1,$2,$3,$4,$5,$6)', [spaceId, 'USD', 'all', firstPage.nextCursor.createdAt, firstPage.nextCursor.id, 10],
    ));
    const secondPage = page2.rows[0]!.goal_page as { rows: Array<Record<string, unknown>> };

    const paginated = [...firstPage.rows, ...secondPage.rows];
    for (const row of full.rows) {
      const match = paginated.find((r) => r.id === row.id);
      expect(match).toMatchObject({ coveredMinor: row.coveredMinor, earmarkedMinor: row.earmarkedMinor });
    }
  });
});

describe('goal monthly targets and leftToAllocate', () => {
  it('counts a group-linked goal target once, not doubled into leftToAllocate', async () => {
    const spaceId = await freshSpace('Goal target counted once');
    const futureGroup = randomUUID();
    const templateId = await saveTemplate(spaceId, [templateGroup(futureGroup, 'future', 0, 3000)]);
    const goal = await createGoal(spaceId, { nameEn: 'Linked goal' });

    await publishV2({
      spaceId, templateRevisionId: templateId, incomeMinor: '100000',
      goalTargets: [goalTarget(goal.goalId, '10000', futureGroup)],
    });

    const state = await monthState(spaceId);
    // income100000, group target 30000 (30%), unallocated(residual)=70000;
    // the 10000 goal target is inside that group's own 30000 share, so
    // leftToAllocate must stay 70000, not 60000.
    expect(state.leftToAllocateMinor).toBe('70000');
    const futureRow = state.groups.find((g) => g.groupId === futureGroup);
    expect(futureRow).toMatchObject({ targetMinor: '30000' });
  });

  it('subtracts a standalone (unlinked) goal target directly from leftToAllocate', async () => {
    const spaceId = await freshSpace('Standalone goal target subtracted');
    const templateId = await saveTemplate(spaceId, []);
    const goal = await createGoal(spaceId, { nameEn: 'Standalone goal' });

    await publishV2({
      spaceId, templateRevisionId: templateId, incomeMinor: '100000',
      goalTargets: [goalTarget(goal.goalId, '15000', null)],
    });

    const state = await monthState(spaceId);
    expect(state.leftToAllocateMinor).toBe('85000');
  });

  it('reflects a goal Future group actual from its own monthly net earmark movement', async () => {
    const spaceId = await freshSpace('Future group actual from goal movement');
    const futureGroup = randomUUID();
    const templateId = await saveTemplate(spaceId, [templateGroup(futureGroup, 'future', 0, 3000)]);
    const goal = await createGoal(spaceId, { nameEn: 'Contributing goal' });
    await publishV2({
      spaceId, templateRevisionId: templateId, incomeMinor: '100000',
      goalTargets: [goalTarget(goal.goalId, '10000', futureGroup)],
    });
    await reserve(spaceId, goal.goalId, '4000');

    const state = await monthState(spaceId);
    const futureRow = state.groups.find((g) => g.groupId === futureGroup);
    expect(futureRow).toMatchObject({ actualMinor: '4000' });
  });

  it('rejects publish_allocation_month_v2 with a stale goal target revision', async () => {
    const spaceId = await freshSpace('Stale goal target revision');
    const templateId = await saveTemplate(spaceId, []);
    const goal = await createGoal(spaceId, { nameEn: 'Stale target goal' });
    await publishV2({
      spaceId, templateRevisionId: templateId, incomeMinor: '100000',
      goalTargets: [goalTarget(goal.goalId, '5000', null)],
    });

    await expect(publishV2({
      spaceId, requestId: randomUUID(), expectedSnapshotId: 1, templateRevisionId: templateId, incomeMinor: '100000',
      goalTargets: [goalTarget(goal.goalId, '6000', null)],
    })).rejects.toThrow();
  });

  it('rejects an old-style publish that would omit an existing positive goal target', async () => {
    const spaceId = await freshSpace('Old publish omission rejected');
    const templateId = await saveTemplate(spaceId, []);
    const goal = await createGoal(spaceId, { nameEn: 'Protected goal' });
    const first = await publishV2({
      spaceId, templateRevisionId: templateId, incomeMinor: '100000',
      goalTargets: [goalTarget(goal.goalId, '5000', null)],
    });

    await expect(publishV1({
      spaceId, expectedSnapshotId: Number(first.snapshotId), templateRevisionId: templateId, incomeMinor: '100000',
    })).rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects a new positive goal target omitted from a later complete-set publication', async () => {
    const spaceId = await freshSpace('Goal complete-set omission rejected');
    const templateId = await saveTemplate(spaceId, []);
    const goalA = await createGoal(spaceId, { nameEn: 'A' });
    const goalB = await createGoal(spaceId, { nameEn: 'B' });
    const first = await publishV2({
      spaceId, templateRevisionId: templateId, incomeMinor: '100000',
      goalTargets: [goalTarget(goalA.goalId, '5000', null), goalTarget(goalB.goalId, '3000', null)],
    });

    await expect(publishV2({
      spaceId, expectedSnapshotId: Number(first.snapshotId), templateRevisionId: templateId, incomeMinor: '100000',
      goalTargets: [goalTarget(goalA.goalId, '5000', null)],
    })).rejects.toMatchObject({ code: 'P0001' });
  });

  it('replays an identical publish_allocation_month_v2 request with the same result', async () => {
    const spaceId = await freshSpace('v2 replay stable');
    const templateId = await saveTemplate(spaceId, []);
    const goal = await createGoal(spaceId, { nameEn: 'Replay goal' });
    const requestId = randomUUID();
    const first = await publishV2({
      spaceId, requestId, templateRevisionId: templateId, incomeMinor: '100000',
      goalTargets: [goalTarget(goal.goalId, '5000', null)],
    });
    const replayed = await publishV2({
      spaceId, requestId, templateRevisionId: templateId, incomeMinor: '100000',
      goalTargets: [goalTarget(goal.goalId, '5000', null)],
    });
    expect(replayed).toEqual(first);
  });

  it('rejects a goal target linking to a spending (non-Future) group', async () => {
    const spaceId = await freshSpace('Goal target wrong purpose group');
    const spendingGroup = randomUUID();
    const category = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query<{ id: string }>(
        "select id from public.create_category($1,$2,'expense','Essentials',null) limit 2", [spaceId, randomUUID()],
      );
      return result.rows[0]!.id;
    });
    const templateId = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query<{ save_allocation_template: { templateRevisionId: string } }>(
        'select public.save_allocation_template($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
        [spaceId, randomUUID(), 'USD', null, JSON.stringify([templateGroup(spendingGroup, 'spending', 0, 3000)]),
          JSON.stringify([{ categoryId: category, groupId: spendingGroup }])],
      );
      return Number(result.rows[0]!.save_allocation_template.templateRevisionId);
    });
    const goal = await createGoal(spaceId, { nameEn: 'Bad link goal' });

    await expect(publishV2({
      spaceId, templateRevisionId: templateId, incomeMinor: '100000',
      goalTargets: [goalTarget(goal.goalId, '1000', spendingGroup)],
    })).rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects goal targets summing above their linked Future group target', async () => {
    const spaceId = await freshSpace('Goal targets exceed group');
    const futureGroup = randomUUID();
    const templateId = await saveTemplate(spaceId, [templateGroup(futureGroup, 'future', 0, 1000)]);
    const goalA = await createGoal(spaceId, { nameEn: 'A' });
    const goalB = await createGoal(spaceId, { nameEn: 'B' });

    // group target = 10% of 100000 = 10000; 6000+6000 exceeds it.
    await expect(publishV2({
      spaceId, templateRevisionId: templateId, incomeMinor: '100000',
      goalTargets: [goalTarget(goalA.goalId, '6000', futureGroup), goalTarget(goalB.goalId, '6000', futureGroup)],
    })).rejects.toMatchObject({ code: 'P0001' });
  });
});
