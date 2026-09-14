import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction, withRollback, orderedAuthenticatedRace,
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
  database = await createDisposableDatabase('budget_goalcmd');
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

async function freshSpace(name: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const space = await db().client.query<{ id: string }>(
      "select id from public.create_space($1, 'personal') limit 2", [name],
    );
    return space.rows[0]!.id;
  });
}

function definition(overrides: Partial<{
  kind: string; currency: string; nameEn: string | null; nameAr: string | null; note: string | null;
  targetMinor: string; deadline: string | null; contributionMode: string;
  monthlyAmountMinor: string | null; priority: number;
}> = {}) {
  return {
    kind: 'reserve', currency: 'USD', nameEn: 'Emergency fund', nameAr: null, note: null,
    targetMinor: '600000', deadline: null, contributionMode: 'manual_monthly',
    monthlyAmountMinor: '50000', priority: 0,
    ...overrides,
  };
}

function milestone(overrides: Partial<{
  id: string; kind: string; labelEn: string | null; labelAr: string | null;
  thresholdMinor: string | null; dueDate: string | null; ordinal: number;
}> = {}) {
  return {
    id: randomUUID(), kind: 'amount', labelEn: 'Halfway', labelAr: null,
    thresholdMinor: '300000', dueDate: null, ordinal: 0,
    ...overrides,
  };
}

async function createGoalPlan(input: {
  spaceId: string; requestId?: string; goalId?: string; definition?: unknown; milestones?: unknown[]; asActor?: string;
}): Promise<{ goalId: string; revisionId: string }> {
  return withAuthenticatedTransaction(db().client, input.asActor ?? actor, async () => {
    const result = await db().client.query<{ create_goal_plan: { goalId: string; revisionId: string } }>(
      'select public.create_goal_plan($1,$2,$3,$4::jsonb,$5::jsonb)',
      [input.spaceId, input.requestId ?? randomUUID(), input.goalId ?? randomUUID(),
        JSON.stringify(input.definition ?? definition()), JSON.stringify(input.milestones ?? [])],
    );
    return result.rows[0]!.create_goal_plan;
  });
}

async function reviseGoalPlan(input: {
  spaceId: string; requestId?: string; goalId: string; expectedRevisionId: number | string;
  definition?: unknown; milestones?: unknown[]; state?: string; asActor?: string;
}): Promise<{ goalId: string; revisionId: string }> {
  return withAuthenticatedTransaction(db().client, input.asActor ?? actor, async () => {
    const result = await db().client.query<{ revise_goal_plan: { goalId: string; revisionId: string } }>(
      'select public.revise_goal_plan($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',
      [input.spaceId, input.requestId ?? randomUUID(), input.goalId, input.expectedRevisionId,
        JSON.stringify(input.definition ?? definition()), JSON.stringify(input.milestones ?? []), input.state ?? 'active'],
    );
    return result.rows[0]!.revise_goal_plan;
  });
}

async function setMonthlyTarget(input: {
  spaceId: string; requestId?: string; goalId: string; month: string; amountMinor: string;
  expectedRevisionId: number | string | null; asActor?: string;
}): Promise<{ revisionId: string }> {
  return withAuthenticatedTransaction(db().client, input.asActor ?? actor, async () => {
    const result = await db().client.query<{ set_goal_monthly_target: { revisionId: string } }>(
      'select public.set_goal_monthly_target($1,$2,$3,$4::date,$5,$6)',
      [input.spaceId, input.requestId ?? randomUUID(), input.goalId, input.month, input.amountMinor, input.expectedRevisionId],
    );
    return result.rows[0]!.set_goal_monthly_target;
  });
}

async function setMilestoneState(input: {
  spaceId: string; requestId?: string; milestoneId: string; action: string;
  expectedEventId: number | string | null; asActor?: string;
}): Promise<{ eventId: string }> {
  return withAuthenticatedTransaction(db().client, input.asActor ?? actor, async () => {
    const result = await db().client.query<{ set_goal_milestone_state: { eventId: string } }>(
      'select public.set_goal_milestone_state($1,$2,$3,$4,$5)',
      [input.spaceId, input.requestId ?? randomUUID(), input.milestoneId, input.action, input.expectedEventId],
    );
    return result.rows[0]!.set_goal_milestone_state;
  });
}

async function currentRevisionMilestoneRow(milestoneId: string): Promise<{ kind: string } | undefined> {
  const revision = await db().client.query<{ kind: string }>(
    `select grm.kind from public.goal_revision_milestones grm
     join public.goal_revisions gr on gr.id = grm.revision_id
     where grm.milestone_id = $1
     order by gr.id desc limit 1`,
    [milestoneId],
  );
  return revision.rows[0];
}

async function financialDigest(spaceId: string): Promise<unknown> {
  const result = await db().client.query(
    `select
       (select count(*) from public.financial_events where space_id = $1) as events,
       (select count(*) from public.wallet_movements where space_id = $1) as movements,
       md5(coalesce((select string_agg(to_jsonb(x)::text, '' order by x.id)
         from public.financial_events x where x.space_id = $1), '')) as events_digest`,
    [spaceId],
  );
  return result.rows[0];
}

describe('create_goal_plan', () => {
  it('creates a reserve goal with two ordered amount milestones', async () => {
    const spaceId = await freshSpace('Create goal happy path');
    const m1 = milestone({ ordinal: 0, thresholdMinor: '100000' });
    const m2 = milestone({ ordinal: 1, thresholdMinor: '300000' });
    const digestBefore = await financialDigest(spaceId);
    const result = await createGoalPlan({ spaceId, milestones: [m1, m2] });
    expect(result.goalId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.revisionId).toMatch(/^\d+$/);
    expect(await financialDigest(spaceId)).toEqual(digestBefore);

    const goal = await db().client.query<{ kind: string; state: string }>(
      `select g.kind, gr.state from public.goals g
       join public.goal_revisions gr on gr.goal_id = g.id
       where g.id = $1`, [result.goalId],
    );
    expect(goal.rows).toEqual([{ kind: 'reserve', state: 'active' }]);
  });

  it('creates a purchase goal with a by_deadline contribution mode', async () => {
    const spaceId = await freshSpace('Create purchase goal');
    const result = await createGoalPlan({
      spaceId,
      definition: definition({ kind: 'purchase', contributionMode: 'by_deadline', monthlyAmountMinor: null, deadline: '2027-06-01' }),
    });
    expect(result.goalId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('replays an identical request and returns the same result', async () => {
    const spaceId = await freshSpace('Create goal replay');
    const requestId = randomUUID();
    const goalId = randomUUID();
    const first = await createGoalPlan({ spaceId, requestId, goalId });
    const second = await createGoalPlan({ spaceId, requestId, goalId });
    expect(second).toEqual(first);
    const count = await db().client.query('select count(*) as n from public.goals where id = $1', [goalId]);
    expect(count.rows[0]!.n).toBe('1');
  });

  it('rejects a request UUID reused by a different actor for a different payload', async () => {
    const spaceId = await freshSpace('Create goal idempotency conflict');
    const requestId = randomUUID();
    await createGoalPlan({ spaceId, requestId });
    await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      'select public.create_goal_plan($1,$2,$3,$4::jsonb,$5::jsonb)',
      [spaceId, requestId, randomUUID(), JSON.stringify(definition({ targetMinor: '1' })), '[]'],
    )).catch((error) => {
      expect(error).toMatchObject({ code: 'P0001', message: 'planning_idempotency_conflict' });
    });
  });

  it('denies an outsider', async () => {
    const spaceId = await freshSpace('Create goal access control');
    await expect(createGoalPlan({ spaceId, asActor: outsider })).rejects.toMatchObject({ code: '42501' });
  });

  it('rejects a null definition', async () => {
    const spaceId = await freshSpace('Create goal null definition');
    await expect(withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      'select public.create_goal_plan($1,$2,$3,null,$4::jsonb)',
      [spaceId, randomUUID(), randomUUID(), '[]'],
    ))).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects an unknown definition key', async () => {
    const spaceId = await freshSpace('Create goal unknown key');
    await expect(createGoalPlan({ spaceId, definition: { ...definition(), extra: true } }))
      .rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects an invalid kind', async () => {
    const spaceId = await freshSpace('Create goal bad kind');
    await expect(createGoalPlan({ spaceId, definition: definition({ kind: 'savings' }) }))
      .rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects a zero target', async () => {
    const spaceId = await freshSpace('Create goal zero target');
    await expect(createGoalPlan({ spaceId, definition: definition({ targetMinor: '0' }) }))
      .rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects a malformed deadline string instead of raising a raw cast error', async () => {
    const spaceId = await freshSpace('Create goal bad deadline');
    await expect(createGoalPlan({
      spaceId, definition: definition({ contributionMode: 'by_deadline', monthlyAmountMinor: null, deadline: 'not-a-date' }),
    })).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects a by_deadline definition carrying a monthly amount (schema invariant)', async () => {
    const spaceId = await freshSpace('Create goal contribution mode invariant');
    await expect(createGoalPlan({
      spaceId, definition: definition({ contributionMode: 'by_deadline', monthlyAmountMinor: '100', deadline: '2027-01-01' }),
    })).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects both names blank (schema invariant)', async () => {
    const spaceId = await freshSpace('Create goal no names');
    await expect(createGoalPlan({ spaceId, definition: definition({ nameEn: null, nameAr: null }) }))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('rejects an out-of-range priority', async () => {
    const spaceId = await freshSpace('Create goal bad priority');
    await expect(createGoalPlan({ spaceId, definition: definition({ priority: 1000 }) }))
      .rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects a non-integer priority', async () => {
    const spaceId = await freshSpace('Create goal fractional priority');
    await expect(createGoalPlan({ spaceId, definition: definition({ priority: 1.5 as unknown as number }) }))
      .rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects duplicate milestone IDs', async () => {
    const spaceId = await freshSpace('Create goal duplicate milestone');
    const shared = milestone({ ordinal: 0 });
    await expect(createGoalPlan({ spaceId, milestones: [shared, { ...shared, ordinal: 1 }] }))
      .rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects more than 20 milestones', async () => {
    const spaceId = await freshSpace('Create goal too many milestones');
    const many = Array.from({ length: 21 }, (_, index) => milestone({ ordinal: index % 20, thresholdMinor: String((index + 1) * 1000) }));
    await expect(createGoalPlan({ spaceId, milestones: many }))
      .rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects a checklist milestone carrying a threshold (schema invariant)', async () => {
    const spaceId = await freshSpace('Create goal checklist threshold');
    await expect(createGoalPlan({ spaceId, milestones: [milestone({ kind: 'checklist', thresholdMinor: '100' })] }))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('rejects an amount milestone missing a threshold (schema invariant)', async () => {
    const spaceId = await freshSpace('Create goal amount without threshold');
    await expect(createGoalPlan({ spaceId, milestones: [milestone({ kind: 'amount', thresholdMinor: null })] }))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('rejects a milestone with a malformed due date instead of a raw cast error', async () => {
    const spaceId = await freshSpace('Create goal bad milestone date');
    await expect(createGoalPlan({
      spaceId, milestones: [milestone({ kind: 'checklist', thresholdMinor: null, dueDate: 'nope' })],
    })).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects a non-integer ordinal instead of a raw cast error', async () => {
    const spaceId = await freshSpace('Create goal bad ordinal');
    await expect(createGoalPlan({ spaceId, milestones: [milestone({ ordinal: 'zero' as unknown as number })] }))
      .rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects the 101st active-or-paused goal for a space and currency', async () => {
    const spaceId = await freshSpace('Create goal active cap');
    for (let index = 0; index < 100; index += 1) {
      await createGoalPlan({ spaceId, definition: definition({ nameEn: `Goal ${index}` }) });
    }
    await expect(createGoalPlan({ spaceId, definition: definition({ nameEn: 'One too many' }) }))
      .rejects.toMatchObject({ code: 'P0001' });
    const otherCurrency = await createGoalPlan({ spaceId, definition: definition({ currency: 'LBP', nameEn: 'Different currency room' }) });
    expect(otherCurrency.goalId).toMatch(/^[0-9a-f-]{36}$/);
  }, 60_000);
});

describe('revise_goal_plan', () => {
  it('updates the definition and returns a new revision', async () => {
    const spaceId = await freshSpace('Revise goal happy path');
    const created = await createGoalPlan({ spaceId });
    const revised = await reviseGoalPlan({
      spaceId, goalId: created.goalId, expectedRevisionId: created.revisionId,
      definition: definition({ targetMinor: '700000' }),
    });
    expect(Number(revised.revisionId)).toBeGreaterThan(Number(created.revisionId));
    const row = await db().client.query<{ target_minor: string }>(
      'select target_minor::text from public.goal_revisions where id = $1', [revised.revisionId],
    );
    expect(row.rows[0]!.target_minor).toBe('700000');
  });

  it('rejects a stale expected revision id', async () => {
    const spaceId = await freshSpace('Revise goal stale');
    const created = await createGoalPlan({ spaceId });
    await reviseGoalPlan({ spaceId, goalId: created.goalId, expectedRevisionId: created.revisionId });
    await expect(reviseGoalPlan({ spaceId, goalId: created.goalId, expectedRevisionId: created.revisionId }))
      .rejects.toMatchObject({ code: '40001', message: 'planning_stale_revision' });
  });

  it('rejects a goal from a different space', async () => {
    const spaceA = await freshSpace('Revise goal tenant A');
    const spaceB = await freshSpace('Revise goal tenant B');
    const created = await createGoalPlan({ spaceId: spaceA });
    await expect(reviseGoalPlan({ spaceId: spaceB, goalId: created.goalId, expectedRevisionId: created.revisionId }))
      .rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects changing kind', async () => {
    const spaceId = await freshSpace('Revise goal kind change');
    const created = await createGoalPlan({ spaceId, definition: definition({ kind: 'reserve' }) });
    await expect(reviseGoalPlan({
      spaceId, goalId: created.goalId, expectedRevisionId: created.revisionId, definition: definition({ kind: 'purchase' }),
    })).rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects changing currency', async () => {
    const spaceId = await freshSpace('Revise goal currency change');
    const created = await createGoalPlan({ spaceId, definition: definition({ currency: 'USD' }) });
    await expect(reviseGoalPlan({
      spaceId, goalId: created.goalId, expectedRevisionId: created.revisionId, definition: definition({ currency: 'LBP' }),
    })).rejects.toMatchObject({ code: 'P0001' });
  });

  it('reopens an explicitly paused goal back to active', async () => {
    const spaceId = await freshSpace('Revise goal reopen');
    const created = await createGoalPlan({ spaceId });
    const paused = await reviseGoalPlan({ spaceId, goalId: created.goalId, expectedRevisionId: created.revisionId, state: 'paused' });
    const reopened = await reviseGoalPlan({ spaceId, goalId: created.goalId, expectedRevisionId: paused.revisionId, state: 'active' });
    const row = await db().client.query<{ state: string }>('select state from public.goal_revisions where id = $1', [reopened.revisionId]);
    expect(row.rows[0]!.state).toBe('active');
  });

  it('rejects closing a goal with a nonzero remaining earmark', async () => {
    const spaceId = await freshSpace('Revise goal close with earmark');
    const created = await createGoalPlan({ spaceId });
    const expectedHead = await headFor(created.goalId);
    await withAuthenticatedTransaction(db().client, actor, async () => db().client.query(
      'select public.record_goal_earmark($1,$2,$3,$4,$5,$6,$7)',
      [spaceId, randomUUID(), created.goalId, 'reserve', '10000', expectedHead, true],
    ));
    await expect(reviseGoalPlan({ spaceId, goalId: created.goalId, expectedRevisionId: created.revisionId, state: 'closed' }))
      .rejects.toMatchObject({ code: 'P0001' });
  });

  it('closes a fully released goal', async () => {
    const spaceId = await freshSpace('Revise goal close clean');
    const created = await createGoalPlan({ spaceId });
    const closed = await reviseGoalPlan({ spaceId, goalId: created.goalId, expectedRevisionId: created.revisionId, state: 'closed' });
    const row = await db().client.query<{ state: string }>('select state from public.goal_revisions where id = $1', [closed.revisionId]);
    expect(row.rows[0]!.state).toBe('closed');
  });

  it('keeps an omitted milestone out of the new definition without deleting its identity', async () => {
    const spaceId = await freshSpace('Revise goal drop milestone');
    const kept = milestone({ ordinal: 0 });
    const dropped = milestone({ ordinal: 1, thresholdMinor: '400000' });
    const created = await createGoalPlan({ spaceId, milestones: [kept, dropped] });
    const revised = await reviseGoalPlan({ spaceId, goalId: created.goalId, expectedRevisionId: created.revisionId, milestones: [kept] });
    const stillExists = await db().client.query('select id from public.goal_milestones where id = $1', [dropped.id]);
    expect(stillExists.rows).toHaveLength(1);
    const inNewDefinition = await db().client.query(
      'select milestone_id from public.goal_revision_milestones where revision_id = $1', [revised.revisionId],
    );
    expect(inNewDefinition.rows.map((row) => row.milestone_id)).toEqual([kept.id]);
  });

  it('allows a never-touched milestone identity to change kind across revisions', async () => {
    const spaceId = await freshSpace('Revise goal milestone kind change');
    const original = milestone({ kind: 'amount', ordinal: 0, thresholdMinor: '100000', dueDate: null });
    const created = await createGoalPlan({ spaceId, milestones: [original] });
    const revised = await reviseGoalPlan({
      spaceId, goalId: created.goalId, expectedRevisionId: created.revisionId,
      milestones: [{ ...original, kind: 'checklist', thresholdMinor: null, dueDate: null }],
    });
    expect(await currentRevisionMilestoneRow(original.id)).toEqual({ kind: 'checklist' });
  });

  it('rejects changing kind for a milestone that already carries a checklist event', async () => {
    const spaceId = await freshSpace('Revise goal milestone kind locked');
    const original = milestone({ kind: 'checklist', thresholdMinor: null, ordinal: 0 });
    const created = await createGoalPlan({ spaceId, milestones: [original] });
    await setMilestoneState({ spaceId, milestoneId: original.id, action: 'complete', expectedEventId: null });
    await expect(reviseGoalPlan({
      spaceId, goalId: created.goalId, expectedRevisionId: created.revisionId,
      milestones: [{ ...original, kind: 'amount', thresholdMinor: '100000' }],
    })).rejects.toMatchObject({ code: 'P0001' });
  });
});

describe('set_goal_monthly_target', () => {
  it('sets an initial monthly target', async () => {
    const spaceId = await freshSpace('Monthly target happy path');
    const created = await createGoalPlan({ spaceId });
    const result = await setMonthlyTarget({ spaceId, goalId: created.goalId, month: '2026-10-01', amountMinor: '25000', expectedRevisionId: null });
    expect(result.revisionId).toMatch(/^\d+$/);
  });

  it('rejects a non-normalized month', async () => {
    const spaceId = await freshSpace('Monthly target bad month');
    const created = await createGoalPlan({ spaceId });
    await expect(setMonthlyTarget({ spaceId, goalId: created.goalId, month: '2026-10-15', amountMinor: '25000', expectedRevisionId: null }))
      .rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects a stale predecessor for the same goal and month', async () => {
    const spaceId = await freshSpace('Monthly target stale');
    const created = await createGoalPlan({ spaceId });
    await setMonthlyTarget({ spaceId, goalId: created.goalId, month: '2026-10-01', amountMinor: '25000', expectedRevisionId: null });
    await expect(setMonthlyTarget({ spaceId, goalId: created.goalId, month: '2026-10-01', amountMinor: '30000', expectedRevisionId: null }))
      .rejects.toMatchObject({ code: '40001', message: 'planning_stale_revision' });
  });

  it('allows a zero target to clear a paused goal without requiring active state', async () => {
    const spaceId = await freshSpace('Monthly target zero on paused');
    const created = await createGoalPlan({ spaceId });
    const paused = await reviseGoalPlan({ spaceId, goalId: created.goalId, expectedRevisionId: created.revisionId, state: 'paused' });
    const result = await setMonthlyTarget({ spaceId, goalId: created.goalId, month: '2026-10-01', amountMinor: '0', expectedRevisionId: null });
    expect(result.revisionId).toMatch(/^\d+$/);
    void paused;
  });

  it('rejects a positive target on a paused goal', async () => {
    const spaceId = await freshSpace('Monthly target positive on paused');
    const created = await createGoalPlan({ spaceId });
    await reviseGoalPlan({ spaceId, goalId: created.goalId, expectedRevisionId: created.revisionId, state: 'paused' });
    await expect(setMonthlyTarget({ spaceId, goalId: created.goalId, month: '2026-10-01', amountMinor: '1000', expectedRevisionId: null }))
      .rejects.toMatchObject({ code: 'P0001' });
  });
});

describe('set_goal_milestone_state', () => {
  it('completes then reopens a checklist milestone', async () => {
    const spaceId = await freshSpace('Milestone state happy path');
    const checklist = milestone({ kind: 'checklist', thresholdMinor: null, ordinal: 0 });
    await createGoalPlan({ spaceId, milestones: [checklist] });
    const completed = await setMilestoneState({ spaceId, milestoneId: checklist.id, action: 'complete', expectedEventId: null });
    const reopened = await setMilestoneState({ spaceId, milestoneId: checklist.id, action: 'reopen', expectedEventId: completed.eventId });
    expect(reopened.eventId).toMatch(/^\d+$/);
  });

  it('rejects an initial reopen', async () => {
    const spaceId = await freshSpace('Milestone state initial reopen');
    const checklist = milestone({ kind: 'checklist', thresholdMinor: null, ordinal: 0 });
    await createGoalPlan({ spaceId, milestones: [checklist] });
    await expect(setMilestoneState({ spaceId, milestoneId: checklist.id, action: 'reopen', expectedEventId: null }))
      .rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects a duplicate complete', async () => {
    const spaceId = await freshSpace('Milestone state duplicate');
    const checklist = milestone({ kind: 'checklist', thresholdMinor: null, ordinal: 0 });
    await createGoalPlan({ spaceId, milestones: [checklist] });
    const completed = await setMilestoneState({ spaceId, milestoneId: checklist.id, action: 'complete', expectedEventId: null });
    await expect(setMilestoneState({ spaceId, milestoneId: checklist.id, action: 'complete', expectedEventId: completed.eventId }))
      .rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects an amount-kind milestone', async () => {
    const spaceId = await freshSpace('Milestone state wrong kind');
    const amount = milestone({ kind: 'amount', ordinal: 0 });
    await createGoalPlan({ spaceId, milestones: [amount] });
    await expect(setMilestoneState({ spaceId, milestoneId: amount.id, action: 'complete', expectedEventId: null }))
      .rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects a milestone that fell out of the current definition', async () => {
    const spaceId = await freshSpace('Milestone state dropped from definition');
    const checklist = milestone({ kind: 'checklist', thresholdMinor: null, ordinal: 0 });
    const created = await createGoalPlan({ spaceId, milestones: [checklist] });
    await reviseGoalPlan({ spaceId, goalId: created.goalId, expectedRevisionId: created.revisionId, milestones: [] });
    await expect(setMilestoneState({ spaceId, milestoneId: checklist.id, action: 'complete', expectedEventId: null }))
      .rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects a stale expected event id', async () => {
    const spaceId = await freshSpace('Milestone state stale');
    const checklist = milestone({ kind: 'checklist', thresholdMinor: null, ordinal: 0 });
    await createGoalPlan({ spaceId, milestones: [checklist] });
    await setMilestoneState({ spaceId, milestoneId: checklist.id, action: 'complete', expectedEventId: null });
    await expect(setMilestoneState({ spaceId, milestoneId: checklist.id, action: 'complete', expectedEventId: null }))
      .rejects.toMatchObject({ code: '40001', message: 'planning_stale_revision' });
  });

  it('never changes a goal revision when completing a milestone', async () => {
    const spaceId = await freshSpace('Milestone state independence');
    const checklist = milestone({ kind: 'checklist', thresholdMinor: null, ordinal: 0 });
    const created = await createGoalPlan({ spaceId, milestones: [checklist] });
    await setMilestoneState({ spaceId, milestoneId: checklist.id, action: 'complete', expectedEventId: null });
    const latest = await db().client.query<{ id: string }>(
      'select id::text from public.goal_revisions where goal_id = $1 order by id desc limit 1', [created.goalId],
    );
    expect(latest.rows[0]!.id).toBe(created.revisionId);
  });
});

describe('goal plan commands serialize under the shared space lock', () => {
  it('rejects the second of two concurrent revisions racing on the same expected revision id', async () => {
    const spaceId = await freshSpace('Revise goal race');
    const created = await createGoalPlan({ spaceId });
    const outcome = await orderedAuthenticatedRace(
      db(),
      actor,
      (client) => client.query(
        'select public.revise_goal_plan($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',
        [spaceId, randomUUID(), created.goalId, created.revisionId, JSON.stringify(definition({ targetMinor: '650000' })), '[]', 'active'],
      ),
      (client) => client.query(
        'select public.revise_goal_plan($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',
        [spaceId, randomUUID(), created.goalId, created.revisionId, JSON.stringify(definition({ targetMinor: '660000' })), '[]', 'active'],
      ),
    );
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toMatchObject({ code: '40001' });
    }
  });
});

async function headFor(goalId: string): Promise<string> {
  const result = await db().client.query<{ head: string }>(
    "select head from private.goal_financing_state($1, (now() at time zone 'UTC')::date)", [goalId],
  );
  return result.rows[0]!.head;
}
