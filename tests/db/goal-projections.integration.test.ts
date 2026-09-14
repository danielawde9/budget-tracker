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
const outsider = randomUUID();

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_goalproj');
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

const TODAY = '2026-09-14';

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
      "select id from public.create_wallet($1, 'Cash', 'USD') limit 2", [spaceId],
    );
    return wallet.rows[0]!.id;
  });
}

async function recordIncome(spaceId: string, walletId: string, date: string, amountMinor: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ id: string }>(
      `select id from public.record_financial_event($1,$2,'income',$3::date,$4::jsonb) limit 2`,
      [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor }])],
    );
    return result.rows[0]!.id;
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

async function createGoal(spaceId: string, overrides: Partial<Record<string, unknown>> = {}, milestones: unknown[] = []): Promise<{ goalId: string; revisionId: string }> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ create_goal_plan: { goalId: string; revisionId: string } }>(
      'select public.create_goal_plan($1,$2,$3,$4::jsonb,$5::jsonb)',
      [spaceId, randomUUID(), randomUUID(), JSON.stringify(definition(overrides)), JSON.stringify(milestones)],
    );
    return result.rows[0]!.create_goal_plan;
  });
}

async function reviseGoal(spaceId: string, goalId: string, expectedRevisionId: string, state: string, overrides: Partial<Record<string, unknown>> = {}, milestones: unknown[] = []): Promise<{ revisionId: string }> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ revise_goal_plan: { revisionId: string } }>(
      'select public.revise_goal_plan($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',
      [spaceId, randomUUID(), goalId, expectedRevisionId, JSON.stringify(definition(overrides)), JSON.stringify(milestones), state],
    );
    return result.rows[0]!.revise_goal_plan;
  });
}

async function headFor(goalId: string, asOf = TODAY): Promise<string> {
  const result = await db().client.query<{ head: string }>(
    'select head from private.goal_financing_state($1,$2::date)', [goalId, asOf],
  );
  return result.rows[0]!.head;
}

async function reserve(spaceId: string, goalId: string, amountMinor: string, acceptUnderfunded = true): Promise<{ eventId: string }> {
  const expectedHead = await headFor(goalId);
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ record_goal_earmark: { eventId: string } }>(
      'select public.record_goal_earmark($1,$2,$3,$4,$5,$6,$7)',
      [spaceId, randomUUID(), goalId, 'reserve', amountMinor, expectedHead, acceptUnderfunded],
    );
    return result.rows[0]!.record_goal_earmark;
  });
}

async function release(spaceId: string, goalId: string, amountMinor: string): Promise<{ eventId: string }> {
  const expectedHead = await headFor(goalId);
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ record_goal_earmark: { eventId: string } }>(
      'select public.record_goal_earmark($1,$2,$3,$4,$5,$6,$7)',
      [spaceId, randomUUID(), goalId, 'release', amountMinor, expectedHead, true],
    );
    return result.rows[0]!.record_goal_earmark;
  });
}

async function setMonthlyTarget(spaceId: string, goalId: string, month: string, amountMinor: string): Promise<void> {
  const current = await db().client.query<{ id: string }>(
    'select id::text from public.goal_monthly_target_revisions where goal_id=$1 and month_start=$2::date order by id desc limit 1',
    [goalId, month],
  );
  await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
    'select public.set_goal_monthly_target($1,$2,$3,$4::date,$5,$6)',
    [spaceId, randomUUID(), goalId, month, amountMinor, current.rows[0]?.id ?? null],
  ));
}

async function goalPage(spaceId: string, stateFilter: string, opts: { afterCreatedAt?: string; afterId?: string; limit?: number } = {}) {
  const result = await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
    'select public.goal_page($1,$2,$3,$4,$5,$6)',
    [spaceId, 'USD', stateFilter, opts.afterCreatedAt ?? null, opts.afterId ?? null, opts.limit ?? 25],
  ));
  return result.rows[0]!.goal_page as { rows: Array<Record<string, unknown>>; hasMore: boolean; nextCursor: { createdAt: string; id: string } | null; asOf: string };
}

async function goalDetail(spaceId: string, goalId: string, month = '2026-09-01') {
  const result = await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
    'select public.goal_detail($1,$2,$3::date)', [spaceId, goalId, month],
  ));
  return result.rows[0]!.goal_detail as {
    summary: Record<string, unknown>; milestones: Array<Record<string, unknown>>;
    earmarkHead: string; definitionHead: string; asOf: string;
  };
}

async function goalHistoryPage(spaceId: string, goalId: string, opts: { beforeCreatedAt?: string; beforeSourceKind?: string; beforeSourceId?: string; limit?: number } = {}) {
  const result = await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
    'select public.goal_history_page($1,$2,$3,$4,$5,$6)',
    [spaceId, goalId, opts.beforeCreatedAt ?? null, opts.beforeSourceKind ?? null, opts.beforeSourceId ?? null, opts.limit ?? 25],
  ));
  return result.rows[0]!.goal_history_page as { rows: Array<Record<string, unknown>>; hasMore: boolean; nextCursor: unknown };
}

describe('private.goal_coverage_set', () => {
  it('covers claims in priority order up to the cash pool, leaving the rest as shortage', async () => {
    const spaceId = await freshSpace('Coverage priority ordering');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, TODAY, '70000');
    const first = await createGoal(spaceId, { nameEn: 'First', priority: 0, targetMinor: '600000' });
    const second = await createGoal(spaceId, { nameEn: 'Second', priority: 1, targetMinor: '600000' });
    await reserve(spaceId, first.goalId, '60000');
    await reserve(spaceId, second.goalId, '30000');

    const result = await db().client.query<{ goal_id: string; covered_minor: string }>(
      'select goal_id::text, covered_minor::text from private.goal_coverage_set($1,$2,$3::date) order by priority',
      [spaceId, 'USD', TODAY],
    );
    expect(result.rows).toEqual([
      { goal_id: first.goalId, covered_minor: '60000' },
      { goal_id: second.goalId, covered_minor: '10000' },
    ]);
  });

  it('drops covered amounts when the pool shrinks, without changing earmarked totals', async () => {
    const spaceId = await freshSpace('Coverage pool drop');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, TODAY, '70000');
    const goal = await createGoal(spaceId, { targetMinor: '600000' });
    await reserve(spaceId, goal.goalId, '60000');

    const before = await db().client.query<{ covered_minor: string }>(
      'select covered_minor::text from private.goal_coverage_set($1,$2,$3::date) where goal_id=$4',
      [spaceId, 'USD', TODAY, goal.goalId],
    );
    expect(before.rows[0]!.covered_minor).toBe('60000');

    // An ordinary expense drops the cash pool to 50000 with no goal command
    // touching the earmark at all.
    await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      `select id from public.record_financial_event($1,$2,'expense',$3::date,$4::jsonb) limit 2`,
      [spaceId, randomUUID(), TODAY, JSON.stringify([{ walletId: wallet, amountMinor: '-20000' }])],
    ));

    const after = await db().client.query<{ covered_minor: string; earmarked_minor: string }>(
      'select covered_minor::text, earmarked_minor::text from private.goal_coverage_set($1,$2,$3::date) where goal_id=$4',
      [spaceId, 'USD', TODAY, goal.goalId],
    );
    expect(after.rows[0]).toEqual({ covered_minor: '50000', earmarked_minor: '60000' });
  });

  it('excludes a fully-settled closed goal but includes a closed goal with a restored earmark', async () => {
    const spaceId = await freshSpace('Coverage relevance filter');
    const settled = await createGoal(spaceId, { nameEn: 'Settled' });
    await reviseGoal(spaceId, settled.goalId, settled.revisionId, 'closed');
    const needsReview = await createGoal(spaceId, { nameEn: 'Needs review', targetMinor: '600000' });
    await reserve(spaceId, needsReview.goalId, '10000');
    const released = await release(spaceId, needsReview.goalId, '10000');
    const closedNeedsReview = await reviseGoal(spaceId, needsReview.goalId, needsReview.revisionId, 'closed');
    const expectedHead = await headFor(needsReview.goalId);
    await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      'select public.reverse_goal_earmark($1,$2,$3,$4::jsonb)',
      [spaceId, randomUUID(), released.eventId, JSON.stringify([{ goalId: needsReview.goalId, head: expectedHead }])],
    ));
    void closedNeedsReview;

    const rows = await db().client.query<{ goal_id: string }>(
      'select goal_id::text from private.goal_coverage_set($1,$2,$3::date)', [spaceId, 'USD', TODAY],
    );
    expect(rows.rows.map((r) => r.goal_id)).toEqual([needsReview.goalId]);
  });
});

describe('goal_page', () => {
  it('denies an outsider', async () => {
    const spaceId = await freshSpace('Goal page access control');
    await expect(withAuthenticatedTransaction(db().client, outsider, () => db().client.query(
      'select public.goal_page($1,$2,$3,$4,$5,$6)', [spaceId, 'USD', 'all', null, null, 25],
    ))).rejects.toMatchObject({ code: '42501' });
  });

  it('rejects an invalid state filter', async () => {
    const spaceId = await freshSpace('Goal page bad filter');
    await expect(goalPage(spaceId, 'bogus')).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects a partial cursor', async () => {
    const spaceId = await freshSpace('Goal page partial cursor');
    await expect(withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      'select public.goal_page($1,$2,$3,$4,$5,$6)', [spaceId, 'USD', 'all', new Date().toISOString(), null, 25],
    ))).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('filters by state and separates needs_review from a plain active/paused list', async () => {
    const spaceId = await freshSpace('Goal page state filters');
    const active = await createGoal(spaceId, { nameEn: 'Active' });
    const paused = await createGoal(spaceId, { nameEn: 'Paused' });
    await reviseGoal(spaceId, paused.goalId, paused.revisionId, 'paused');
    const closed = await createGoal(spaceId, { nameEn: 'Closed with earmark', targetMinor: '600000' });
    const closedReserve = await reserve(spaceId, closed.goalId, '1000');
    const closedRelease = await release(spaceId, closed.goalId, '1000');
    await reviseGoal(spaceId, closed.goalId, closed.revisionId, 'closed');
    const closedExpectedHead = await headFor(closed.goalId);
    await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      'select public.reverse_goal_earmark($1,$2,$3,$4::jsonb)',
      [spaceId, randomUUID(), closedRelease.eventId, JSON.stringify([{ goalId: closed.goalId, head: closedExpectedHead }])],
    ));
    void closedReserve;

    const activePage = await goalPage(spaceId, 'active');
    expect(activePage.rows.map((r) => r.id)).toEqual([active.goalId]);
    const pausedPage = await goalPage(spaceId, 'paused');
    expect(pausedPage.rows.map((r) => r.id)).toEqual([paused.goalId]);
    const closedPage = await goalPage(spaceId, 'closed');
    expect(closedPage.rows.map((r) => r.id)).toEqual([closed.goalId]);
    const needsReviewPage = await goalPage(spaceId, 'needs_review');
    expect(needsReviewPage.rows.map((r) => r.id)).toEqual([closed.goalId]);
    const allPage = await goalPage(spaceId, 'all');
    expect(allPage.rows).toHaveLength(3);
  });

  it('paginates by created_at/id and reports a stable nextCursor', async () => {
    const spaceId = await freshSpace('Goal page pagination');
    const first = await createGoal(spaceId, { nameEn: 'A' });
    await createGoal(spaceId, { nameEn: 'B' });
    await createGoal(spaceId, { nameEn: 'C' });

    const page1 = await goalPage(spaceId, 'all', { limit: 2 });
    expect(page1.rows).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await goalPage(spaceId, 'all', { limit: 2, afterCreatedAt: page1.nextCursor!.createdAt, afterId: page1.nextCursor!.id });
    expect(page2.rows).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
    const seenIds = new Set([...page1.rows, ...page2.rows].map((r) => r.id));
    expect(seenIds.size).toBe(3);
    expect(seenIds.has(first.goalId)).toBe(true);
  });

  it('rejects when more than 200 goals are relevant for the space and currency', async () => {
    // create_goal_plan's own 100-active/200-total caps (task 10) make this
    // state unreachable through the command surface -- prove the read-side's
    // own independent defense fires by seeding rows directly, the same way
    // this suite proves RLS/guard layers by simulating another layer's
    // failure (see CLAUDE.md "layer defenses").
    const spaceId = await freshSpace('Goal page 200 cap');
    for (let index = 0; index < 201; index += 1) {
      const goalId = randomUUID();
      await db().client.query(
        'insert into public.goals (id, space_id, currency, kind, actor_id) values ($1,$2,$3,$4,$5)',
        [goalId, spaceId, 'USD', 'reserve', actor],
      );
      await db().client.query(
        `insert into public.goal_revisions
           (goal_id, space_id, currency, expected_revision_id, name_en, target_minor, deadline,
            contribution_mode, monthly_minor, priority, state, milestone_count, request_id, actor_id)
         values ($1,$2,$3,null,$4,$5,null,'manual_monthly','0',0,'active',0,$6,$7)`,
        [goalId, spaceId, 'USD', `Goal ${index}`, '600000', randomUUID(), actor],
      );
    }
    await expect(goalPage(spaceId, 'all')).rejects.toMatchObject({ code: 'P0001' });
  }, 60_000);
});

describe('goal_detail', () => {
  it('rejects a goal from a different space', async () => {
    const spaceA = await freshSpace('Goal detail tenant A');
    const spaceB = await freshSpace('Goal detail tenant B');
    const goal = await createGoal(spaceA);
    await expect(goalDetail(spaceB, goal.goalId)).rejects.toMatchObject({ code: 'P0001' });
  });

  it('resolves amount-milestone completion from covered+fulfilled progress', async () => {
    const spaceId = await freshSpace('Goal detail amount milestone');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, TODAY, '600000');
    const milestoneId = randomUUID();
    const goal = await createGoal(spaceId, { targetMinor: '600000' }, [
      { id: milestoneId, kind: 'amount', labelEn: 'Halfway', labelAr: null, thresholdMinor: '300000', dueDate: null, ordinal: 0 },
    ]);
    const beforeDetail = await goalDetail(spaceId, goal.goalId);
    expect(beforeDetail.milestones[0]).toMatchObject({ currentState: 'incomplete' });

    await reserve(spaceId, goal.goalId, '300000');
    const afterDetail = await goalDetail(spaceId, goal.goalId);
    expect(afterDetail.milestones[0]).toMatchObject({ currentState: 'complete' });
    expect(afterDetail.earmarkHead).toMatch(/^[0-9a-f]{64}$/);
    expect(afterDetail.definitionHead).toBe(goal.revisionId);
  });

  it('resolves checklist-milestone completion from its own current event head', async () => {
    const spaceId = await freshSpace('Goal detail checklist milestone');
    const milestoneId = randomUUID();
    const goal = await createGoal(spaceId, {}, [
      { id: milestoneId, kind: 'checklist', labelEn: 'Pick a bank', labelAr: null, thresholdMinor: null, dueDate: null, ordinal: 0 },
    ]);
    const before = await goalDetail(spaceId, goal.goalId);
    expect(before.milestones[0]).toMatchObject({ currentState: 'incomplete' });

    await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      'select public.set_goal_milestone_state($1,$2,$3,$4,$5)',
      [spaceId, randomUUID(), milestoneId, 'complete', null],
    ));
    const after = await goalDetail(spaceId, goal.goalId);
    expect(after.milestones[0]).toMatchObject({ currentState: 'complete' });
  });

  it('computes a monthly target, net contribution, and needsReview flag', async () => {
    const spaceId = await freshSpace('Goal detail monthly figures');
    const goal = await createGoal(spaceId, { targetMinor: '600000' });
    await setMonthlyTarget(spaceId, goal.goalId, '2026-09-01', '50000');
    await reserve(spaceId, goal.goalId, '20000');
    await release(spaceId, goal.goalId, '5000');

    const detail = await goalDetail(spaceId, goal.goalId, '2026-09-01');
    expect(detail.summary).toMatchObject({
      monthlyTargetMinor: '50000', monthlyNetContributionMinor: '15000', needsReview: false,
    });
  });

  it('suggests a deadline-based monthly amount and reports overdue as no suggestion', async () => {
    const spaceId = await freshSpace('Goal detail suggested monthly');
    const goal = await createGoal(spaceId, {
      contributionMode: 'by_deadline', monthlyAmountMinor: null, deadline: '2026-12-01', targetMinor: '90000',
    });
    const detail = await goalDetail(spaceId, goal.goalId, '2026-09-01');
    // months = 12*0 + (12-9) + 1 = 4; remaining = 90000; ceil(90000/4) = 22500
    expect(detail.summary.suggestedMonthlyMinor).toBe('22500');

    const overdueSpace = await freshSpace('Goal detail overdue');
    const overdueGoal = await createGoal(spaceId, {
      contributionMode: 'by_deadline', monthlyAmountMinor: null, deadline: '2026-01-01', targetMinor: '90000',
    });
    void overdueSpace;
    const overdueDetail = await goalDetail(spaceId, overdueGoal.goalId, '2026-09-01');
    expect(overdueDetail.summary.suggestedMonthlyMinor).toBeNull();
  });

  it('reports insufficient_history for a goal younger than three completed months', async () => {
    const spaceId = await freshSpace('Goal detail forecast insufficient history');
    const goal = await createGoal(spaceId, { targetMinor: '600000' });
    const detail = await goalDetail(spaceId, goal.goalId);
    expect(detail.summary.forecastState).toBe('insufficient_history');
    expect(detail.summary.forecastMonth).toBeNull();
  });
});

describe('goal_history_page', () => {
  it('rejects a partial cursor', async () => {
    const spaceId = await freshSpace('Goal history partial cursor');
    const goal = await createGoal(spaceId);
    await expect(goalHistoryPage(spaceId, goal.goalId, { beforeCreatedAt: new Date().toISOString() }))
      .rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('returns definition, earmark, and checklist rows newest first', async () => {
    const spaceId = await freshSpace('Goal history mixed sources');
    const milestoneId = randomUUID();
    const goal = await createGoal(spaceId, { targetMinor: '600000' }, [
      { id: milestoneId, kind: 'checklist', labelEn: 'Step', labelAr: null, thresholdMinor: null, dueDate: null, ordinal: 0 },
    ]);
    await reserve(spaceId, goal.goalId, '10000');
    await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      'select public.set_goal_milestone_state($1,$2,$3,$4,$5)',
      [spaceId, randomUUID(), milestoneId, 'complete', null],
    ));

    const page = await goalHistoryPage(spaceId, goal.goalId, { limit: 10 });
    const kinds = page.rows.map((r) => r.sourceKind);
    expect(kinds).toContain('definition');
    expect(kinds).toContain('earmark');
    expect(kinds).toContain('checklist');
    expect(page.hasMore).toBe(false);
  });

  it('includes a financial reversal row for a reversed linked expense', async () => {
    const spaceId = await freshSpace('Goal history financial reversal');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, TODAY, '100000');
    const goal = await createGoal(spaceId, { kind: 'purchase', targetMinor: '100000' });
    await reserve(spaceId, goal.goalId, '30000');
    const expenseId = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query<{ id: string }>(
        `select id from public.record_financial_event($1,$2,'expense',$3::date,$4::jsonb) limit 2`,
        [spaceId, randomUUID(), TODAY, JSON.stringify([{ walletId: wallet, amountMinor: '-30000' }])],
      );
      return result.rows[0]!.id;
    });
    const expectedHead = await headFor(goal.goalId);
    await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      'select public.link_goal_purchase($1,$2,$3,$4::jsonb)',
      [spaceId, randomUUID(), expenseId, JSON.stringify([{ goalId: goal.goalId, amountMinor: '30000', expectedHead }])],
    ));
    await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      'select * from public.reverse_financial_event($1,$2,$3,$4::date) limit 2',
      [spaceId, randomUUID(), expenseId, TODAY],
    ));

    const page = await goalHistoryPage(spaceId, goal.goalId, { limit: 10 });
    expect(page.rows.map((r) => r.sourceKind)).toContain('financial_reversal');
  });

  it('paginates with the three-part cursor', async () => {
    const spaceId = await freshSpace('Goal history pagination');
    const goal = await createGoal(spaceId, { targetMinor: '600000' });
    await reserve(spaceId, goal.goalId, '1000');
    await release(spaceId, goal.goalId, '500');

    const page1 = await goalHistoryPage(spaceId, goal.goalId, { limit: 1 });
    expect(page1.rows).toHaveLength(1);
    expect(page1.hasMore).toBe(true);
    const cursor = page1.nextCursor as { createdAt: string; sourceKind: string; sourceId: string };
    const page2 = await goalHistoryPage(spaceId, goal.goalId, {
      limit: 10, beforeCreatedAt: cursor.createdAt, beforeSourceKind: cursor.sourceKind, beforeSourceId: cursor.sourceId,
    });
    expect(page2.hasMore).toBe(false);
    expect(page2.rows.length).toBeGreaterThan(0);
  });
});
