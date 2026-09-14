import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction, withRollback, expectSavepointRejection, inTransaction,
  type DisposableDatabase,
} from './disposable-database.js';

let database: DisposableDatabase | undefined;
const actor = randomUUID();

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_goals');
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

async function freshSpace(name: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const space = await db().client.query<{ id: string }>(
      "select id from public.create_space($1, 'personal') limit 2", [name],
    );
    return space.rows[0]!.id;
  });
}

// SET CONSTRAINTS ALL IMMEDIATE checks now, but it also switches every
// deferrable constraint's MODE to immediate for the rest of the transaction;
// re-defer immediately after so later inserts in the same block stay deferred.
async function forceDeferred(): Promise<void> {
  await db().client.query('set constraints all immediate');
  await db().client.query('set constraints all deferred');
}

async function insertGoal(spaceId: string, currency: 'USD' | 'LBP', kind: 'reserve' | 'purchase' = 'reserve'): Promise<string> {
  const id = randomUUID();
  await db().client.query(
    'insert into public.goals (id, space_id, currency, kind, actor_id) values ($1,$2,$3,$4,$5)',
    [id, spaceId, currency, kind, actor],
  );
  return id;
}

async function insertGoalRevision(input: {
  goalId: string; spaceId: string; currency: 'USD' | 'LBP'; expectedRevisionId?: number | null;
  targetMinor: string; deadline?: string | null; contributionMode?: 'manual_monthly' | 'by_deadline';
  monthlyMinor?: string | null; priority?: number; state?: 'active' | 'paused' | 'closed'; milestoneCount?: number;
}): Promise<number> {
  const contributionMode = input.contributionMode ?? 'manual_monthly';
  const monthlyMinor = input.monthlyMinor !== undefined ? input.monthlyMinor : (contributionMode === 'manual_monthly' ? '0' : null);
  const deadline = input.deadline !== undefined ? input.deadline : (contributionMode === 'by_deadline' ? '2027-01-01' : null);
  const result = await db().client.query<{ id: string }>(
    `insert into public.goal_revisions
       (goal_id, space_id, currency, expected_revision_id, name_en, target_minor, deadline,
        contribution_mode, monthly_minor, priority, state, milestone_count, request_id, actor_id)
     values ($1,$2,$3,$4,'Goal',$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
    [input.goalId, input.spaceId, input.currency, input.expectedRevisionId ?? null, input.targetMinor, deadline,
      contributionMode, monthlyMinor, input.priority ?? 0, input.state ?? 'active', input.milestoneCount ?? 0,
      randomUUID(), actor],
  );
  return Number(result.rows[0]!.id);
}

async function insertMilestone(goalId: string, spaceId: string, currency: 'USD' | 'LBP'): Promise<string> {
  const id = randomUUID();
  await db().client.query(
    'insert into public.goal_milestones (id, goal_id, space_id, currency) values ($1,$2,$3,$4)',
    [id, goalId, spaceId, currency],
  );
  return id;
}

async function insertRevisionMilestone(input: {
  revisionId: number; milestoneId: string; goalId: string; spaceId: string; currency: 'USD' | 'LBP';
  kind: 'amount' | 'checklist'; ordinal: number; thresholdMinor?: string | null; dueDate?: string | null;
}): Promise<void> {
  const thresholdMinor = input.thresholdMinor !== undefined ? input.thresholdMinor : (input.kind === 'amount' ? '100' : null);
  await db().client.query(
    `insert into public.goal_revision_milestones
       (revision_id, milestone_id, goal_id, space_id, currency, kind, label_en, threshold_minor, due_date, ordinal)
     values ($1,$2,$3,$4,$5,$6,'Milestone',$7,$8,$9)`,
    [input.revisionId, input.milestoneId, input.goalId, input.spaceId, input.currency, input.kind,
      thresholdMinor, input.dueDate ?? null, input.ordinal],
  );
}

async function insertMilestoneEvent(input: {
  milestoneId: string; goalId: string; spaceId: string; currency: 'USD' | 'LBP';
  expectedEventId?: number | null; action?: 'complete' | 'reopen';
}): Promise<number> {
  const result = await db().client.query<{ id: string }>(
    `insert into public.goal_milestone_events
       (milestone_id, goal_id, space_id, currency, expected_event_id, action, request_id, actor_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [input.milestoneId, input.goalId, input.spaceId, input.currency, input.expectedEventId ?? null,
      input.action ?? 'complete', randomUUID(), actor],
  );
  return Number(result.rows[0]!.id);
}

async function insertEarmarkEvent(input: {
  spaceId: string; currency: 'USD' | 'LBP'; operation: 'reserve' | 'release' | 'move' | 'reverse';
  reversalOf?: number | null; lineCount: number;
}): Promise<number> {
  const result = await db().client.query<{ id: string }>(
    `insert into public.goal_earmark_events (space_id, currency, operation, reversal_of, line_count, request_id, actor_id)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [input.spaceId, input.currency, input.operation, input.reversalOf ?? null, input.lineCount, randomUUID(), actor],
  );
  return Number(result.rows[0]!.id);
}

async function insertEarmarkLine(input: { eventId: number; goalId: string; spaceId: string; currency: 'USD' | 'LBP'; amountMinor: string }): Promise<void> {
  await db().client.query(
    'insert into public.goal_earmark_lines (event_id, goal_id, space_id, currency, amount_minor) values ($1,$2,$3,$4,$5)',
    [input.eventId, input.goalId, input.spaceId, input.currency, input.amountMinor],
  );
}

/** A reserve-kind goal with a minimal, valid, zero-milestone revision declaring
 * the given target. Ready for earmark-event tests. */
async function goalWithTarget(spaceId: string, currency: 'USD' | 'LBP', targetMinor: string): Promise<string> {
  const goalId = await insertGoal(spaceId, currency);
  await insertGoalRevision({ goalId, spaceId, currency, targetMinor });
  return goalId;
}

describe('goal revisions and milestones', () => {
  it('accepts a valid revision with two increasing amount milestones and a consistent deadline', async () => {
    const spaceId = await freshSpace('Goal revision valid path');
    await withRollback(db().client, async () => {
      const goalId = await insertGoal(spaceId, 'USD');
      const revisionId = await insertGoalRevision({
        goalId, spaceId, currency: 'USD', targetMinor: '100000', contributionMode: 'by_deadline',
        deadline: '2027-06-01', milestoneCount: 2,
      });
      const first = await insertMilestone(goalId, spaceId, 'USD');
      const second = await insertMilestone(goalId, spaceId, 'USD');
      await insertRevisionMilestone({ revisionId, milestoneId: first, goalId, spaceId, currency: 'USD', kind: 'amount', ordinal: 0, thresholdMinor: '25000', dueDate: '2027-01-01' });
      await insertRevisionMilestone({ revisionId, milestoneId: second, goalId, spaceId, currency: 'USD', kind: 'amount', ordinal: 1, thresholdMinor: '50000', dueDate: '2027-03-01' });
      await forceDeferred();
    });
  });

  it('rejects a revision referencing a goal from a different space/currency (FK, not the deferred check)', async () => {
    const spaceId = await freshSpace('Goal revision cross-space FK');
    const otherSpaceId = await freshSpace('Goal revision cross-space FK other');
    await withRollback(db().client, async () => {
      const goalId = await insertGoal(otherSpaceId, 'USD');
      await expectSavepointRejection(
        db().client,
        () => insertGoalRevision({ goalId, spaceId, currency: 'USD', targetMinor: '1000' }),
        { code: '23503' },
      );
    });
  });

  it('rejects a null kind discriminator on goals', async () => {
    const spaceId = await freshSpace('Goal null discriminator');
    await withRollback(db().client, () => expectSavepointRejection(
      db().client,
      () => db().client.query(
        'insert into public.goals (id, space_id, currency, kind, actor_id) values ($1,$2,$3,null,$4)',
        [randomUUID(), spaceId, 'USD', actor],
      ),
      { code: '23502' },
    ));
  });

  it('rejects a by_deadline revision with no deadline', async () => {
    const spaceId = await freshSpace('Goal by-deadline missing date');
    await withRollback(db().client, async () => {
      const goalId = await insertGoal(spaceId, 'USD');
      await expectSavepointRejection(
        db().client,
        () => insertGoalRevision({ goalId, spaceId, currency: 'USD', targetMinor: '1000', contributionMode: 'by_deadline', deadline: null }),
        { code: '23514' },
      );
    });
  });

  it('rejects a manual_monthly revision with no monthly amount', async () => {
    const spaceId = await freshSpace('Goal manual amount missing');
    await withRollback(db().client, async () => {
      const goalId = await insertGoal(spaceId, 'USD');
      await expectSavepointRejection(
        db().client,
        () => insertGoalRevision({ goalId, spaceId, currency: 'USD', targetMinor: '1000', contributionMode: 'manual_monthly', monthlyMinor: null }),
        { code: '23514' },
      );
    });
  });

  it('rejects a duplicate milestone ordinal within one revision', async () => {
    const spaceId = await freshSpace('Goal duplicate ordinal');
    await withRollback(db().client, async () => {
      const goalId = await insertGoal(spaceId, 'USD');
      const revisionId = await insertGoalRevision({ goalId, spaceId, currency: 'USD', targetMinor: '1000', milestoneCount: 2 });
      const first = await insertMilestone(goalId, spaceId, 'USD');
      const second = await insertMilestone(goalId, spaceId, 'USD');
      await insertRevisionMilestone({ revisionId, milestoneId: first, goalId, spaceId, currency: 'USD', kind: 'amount', ordinal: 0, thresholdMinor: '100' });
      await expectSavepointRejection(
        db().client,
        () => insertRevisionMilestone({ revisionId, milestoneId: second, goalId, spaceId, currency: 'USD', kind: 'amount', ordinal: 0, thresholdMinor: '200' }),
        { code: '23505' },
      );
    });
  });

  it('rejects a milestone_count of 21 up front (0..20 bound)', async () => {
    const spaceId = await freshSpace('Goal 21 milestone count');
    await withRollback(db().client, async () => {
      const goalId = await insertGoal(spaceId, 'USD');
      await expectSavepointRejection(
        db().client,
        () => insertGoalRevision({ goalId, spaceId, currency: 'USD', targetMinor: '1000', milestoneCount: 21 }),
        { code: '23514' },
      );
    });
  });

  it('rejects an amount milestone whose threshold exceeds the goal target', async () => {
    const spaceId = await freshSpace('Goal threshold over target');
    await withRollback(db().client, async () => {
      const goalId = await insertGoal(spaceId, 'USD');
      const revisionId = await insertGoalRevision({ goalId, spaceId, currency: 'USD', targetMinor: '1000', milestoneCount: 1 });
      const milestone = await insertMilestone(goalId, spaceId, 'USD');
      await insertRevisionMilestone({ revisionId, milestoneId: milestone, goalId, spaceId, currency: 'USD', kind: 'amount', ordinal: 0, thresholdMinor: '1001' });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'goal_milestone_threshold_or_due_date_invalid' });
    });
  });

  it('rejects a decreasing threshold across ordinals', async () => {
    const spaceId = await freshSpace('Goal decreasing threshold');
    await withRollback(db().client, async () => {
      const goalId = await insertGoal(spaceId, 'USD');
      const revisionId = await insertGoalRevision({ goalId, spaceId, currency: 'USD', targetMinor: '1000', milestoneCount: 2 });
      const first = await insertMilestone(goalId, spaceId, 'USD');
      const second = await insertMilestone(goalId, spaceId, 'USD');
      await insertRevisionMilestone({ revisionId, milestoneId: first, goalId, spaceId, currency: 'USD', kind: 'amount', ordinal: 0, thresholdMinor: '500' });
      await insertRevisionMilestone({ revisionId, milestoneId: second, goalId, spaceId, currency: 'USD', kind: 'amount', ordinal: 1, thresholdMinor: '400' });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'goal_milestone_threshold_or_due_date_invalid' });
    });
  });

  it('rejects a decreasing due date across ordinals', async () => {
    const spaceId = await freshSpace('Goal decreasing due date');
    await withRollback(db().client, async () => {
      const goalId = await insertGoal(spaceId, 'USD');
      const revisionId = await insertGoalRevision({ goalId, spaceId, currency: 'USD', targetMinor: '1000', milestoneCount: 2 });
      const first = await insertMilestone(goalId, spaceId, 'USD');
      const second = await insertMilestone(goalId, spaceId, 'USD');
      await insertRevisionMilestone({ revisionId, milestoneId: first, goalId, spaceId, currency: 'USD', kind: 'amount', ordinal: 0, thresholdMinor: '100', dueDate: '2027-06-01' });
      await insertRevisionMilestone({ revisionId, milestoneId: second, goalId, spaceId, currency: 'USD', kind: 'amount', ordinal: 1, thresholdMinor: '200', dueDate: '2027-01-01' });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'goal_milestone_threshold_or_due_date_invalid' });
    });
  });

  it('rejects an amount milestone due date past the goal deadline', async () => {
    const spaceId = await freshSpace('Goal due date past deadline');
    await withRollback(db().client, async () => {
      const goalId = await insertGoal(spaceId, 'USD');
      const revisionId = await insertGoalRevision({
        goalId, spaceId, currency: 'USD', targetMinor: '1000', contributionMode: 'by_deadline',
        deadline: '2027-01-01', milestoneCount: 1,
      });
      const milestone = await insertMilestone(goalId, spaceId, 'USD');
      await insertRevisionMilestone({ revisionId, milestoneId: milestone, goalId, spaceId, currency: 'USD', kind: 'amount', ordinal: 0, thresholdMinor: '100', dueDate: '2027-02-01' });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'goal_milestone_threshold_or_due_date_invalid' });
    });
  });

  it('rejects a late milestone child inserted into an already-committed revision from a separate transaction', async () => {
    const spaceId = await freshSpace('Goal late milestone child');
    const { goalId, revisionId } = await inTransaction(db().client, async () => {
      const goalId = await insertGoal(spaceId, 'USD');
      const revisionId = await insertGoalRevision({ goalId, spaceId, currency: 'USD', targetMinor: '1000', milestoneCount: 0 });
      return { goalId, revisionId };
    });
    await withRollback(db().client, async () => {
      const milestone = await insertMilestone(goalId, spaceId, 'USD');
      await insertRevisionMilestone({ revisionId, milestoneId: milestone, goalId, spaceId, currency: 'USD', kind: 'amount', ordinal: 0, thresholdMinor: '100' });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'goal_milestone_count_mismatch' });
    });
  });

  it('rejects a second initial (predecessor-null) revision for the same goal', async () => {
    const spaceId = await freshSpace('Goal second initial revision');
    await withRollback(db().client, async () => {
      const goalId = await insertGoal(spaceId, 'USD');
      await insertGoalRevision({ goalId, spaceId, currency: 'USD', targetMinor: '1000' });
      await expectSavepointRejection(
        db().client,
        () => insertGoalRevision({ goalId, spaceId, currency: 'USD', targetMinor: '2000' }),
        { code: '23505' },
      );
    });
  });

  it('rejects two successor revisions naming the same predecessor', async () => {
    const spaceId = await freshSpace('Goal fork successor revision');
    await withRollback(db().client, async () => {
      const goalId = await insertGoal(spaceId, 'USD');
      const first = await insertGoalRevision({ goalId, spaceId, currency: 'USD', targetMinor: '1000' });
      await insertGoalRevision({ goalId, spaceId, currency: 'USD', targetMinor: '2000', expectedRevisionId: first });
      await expectSavepointRejection(
        db().client,
        () => insertGoalRevision({ goalId, spaceId, currency: 'USD', targetMinor: '3000', expectedRevisionId: first }),
        { code: '23505' },
      );
    });
  });
});

describe('goal milestone checklist events', () => {
  it('accepts a valid complete action on a checklist milestone in the latest definition', async () => {
    const spaceId = await freshSpace('Checklist valid complete');
    await withRollback(db().client, async () => {
      const goalId = await insertGoal(spaceId, 'USD');
      const revisionId = await insertGoalRevision({ goalId, spaceId, currency: 'USD', targetMinor: '1000', milestoneCount: 1 });
      const milestone = await insertMilestone(goalId, spaceId, 'USD');
      await insertRevisionMilestone({ revisionId, milestoneId: milestone, goalId, spaceId, currency: 'USD', kind: 'checklist', ordinal: 0 });
      await forceDeferred();
      await insertMilestoneEvent({ milestoneId: milestone, goalId, spaceId, currency: 'USD', action: 'complete' });
      await forceDeferred();
    });
  });

  it('rejects a checklist action on a milestone absent from the latest definition', async () => {
    const spaceId = await freshSpace('Checklist absent milestone');
    await withRollback(db().client, async () => {
      const goalId = await insertGoal(spaceId, 'USD');
      const milestone = await insertMilestone(goalId, spaceId, 'USD');
      await insertGoalRevision({ goalId, spaceId, currency: 'USD', targetMinor: '1000', milestoneCount: 0 });
      await forceDeferred();
      await insertMilestoneEvent({ milestoneId: milestone, goalId, spaceId, currency: 'USD', action: 'complete' });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'goal_milestone_absent_or_not_checklist' });
    });
  });

  it('rejects a checklist action on an amount-kind milestone', async () => {
    const spaceId = await freshSpace('Checklist wrong kind');
    await withRollback(db().client, async () => {
      const goalId = await insertGoal(spaceId, 'USD');
      const revisionId = await insertGoalRevision({ goalId, spaceId, currency: 'USD', targetMinor: '1000', milestoneCount: 1 });
      const milestone = await insertMilestone(goalId, spaceId, 'USD');
      await insertRevisionMilestone({ revisionId, milestoneId: milestone, goalId, spaceId, currency: 'USD', kind: 'amount', ordinal: 0, thresholdMinor: '100' });
      await forceDeferred();
      await insertMilestoneEvent({ milestoneId: milestone, goalId, spaceId, currency: 'USD', action: 'complete' });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'goal_milestone_absent_or_not_checklist' });
    });
  });

  it('rejects two initial (predecessor-null) events for the same milestone', async () => {
    const spaceId = await freshSpace('Checklist fork initial event');
    await withRollback(db().client, async () => {
      const goalId = await insertGoal(spaceId, 'USD');
      const revisionId = await insertGoalRevision({ goalId, spaceId, currency: 'USD', targetMinor: '1000', milestoneCount: 1 });
      const milestone = await insertMilestone(goalId, spaceId, 'USD');
      await insertRevisionMilestone({ revisionId, milestoneId: milestone, goalId, spaceId, currency: 'USD', kind: 'checklist', ordinal: 0 });
      await forceDeferred();
      await insertMilestoneEvent({ milestoneId: milestone, goalId, spaceId, currency: 'USD', action: 'complete' });
      await expectSavepointRejection(
        db().client,
        () => insertMilestoneEvent({ milestoneId: milestone, goalId, spaceId, currency: 'USD', action: 'complete' }),
        { code: '23505' },
      );
    });
  });
});

describe('goal earmark events', () => {
  it('accepts a valid reserve event', async () => {
    const spaceId = await freshSpace('Earmark valid reserve');
    await withRollback(db().client, async () => {
      const goalId = await goalWithTarget(spaceId, 'USD', '1000');
      const eventId = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'reserve', lineCount: 1 });
      await insertEarmarkLine({ eventId, goalId, spaceId, currency: 'USD', amountMinor: '400' });
      await forceDeferred();
    });
  });

  it('accepts a valid release event that keeps the balance nonnegative', async () => {
    const spaceId = await freshSpace('Earmark valid release');
    await withRollback(db().client, async () => {
      const goalId = await goalWithTarget(spaceId, 'USD', '1000');
      const reserve = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'reserve', lineCount: 1 });
      await insertEarmarkLine({ eventId: reserve, goalId, spaceId, currency: 'USD', amountMinor: '400' });
      await forceDeferred();
      const release = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'release', lineCount: 1 });
      await insertEarmarkLine({ eventId: release, goalId, spaceId, currency: 'USD', amountMinor: '-100' });
      await forceDeferred();
    });
  });

  it('accepts a valid move between two goals summing to zero', async () => {
    const spaceId = await freshSpace('Earmark valid move');
    await withRollback(db().client, async () => {
      const source = await goalWithTarget(spaceId, 'USD', '1000');
      const target = await goalWithTarget(spaceId, 'USD', '1000');
      const reserve = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'reserve', lineCount: 1 });
      await insertEarmarkLine({ eventId: reserve, goalId: source, spaceId, currency: 'USD', amountMinor: '400' });
      await forceDeferred();
      const move = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'move', lineCount: 2 });
      await insertEarmarkLine({ eventId: move, goalId: source, spaceId, currency: 'USD', amountMinor: '-100' });
      await insertEarmarkLine({ eventId: move, goalId: target, spaceId, currency: 'USD', amountMinor: '100' });
      await forceDeferred();
    });
  });

  it('accepts a valid reverse of a reserve event, restoring the balance to zero', async () => {
    const spaceId = await freshSpace('Earmark valid reverse');
    await withRollback(db().client, async () => {
      const goalId = await goalWithTarget(spaceId, 'USD', '1000');
      const reserve = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'reserve', lineCount: 1 });
      await insertEarmarkLine({ eventId: reserve, goalId, spaceId, currency: 'USD', amountMinor: '400' });
      await forceDeferred();
      const reverse = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'reverse', reversalOf: reserve, lineCount: 1 });
      await insertEarmarkLine({ eventId: reverse, goalId, spaceId, currency: 'USD', amountMinor: '-400' });
      await forceDeferred();
    });
  });

  it('rejects an event with fewer earmark lines than its declared count', async () => {
    const spaceId = await freshSpace('Earmark incomplete lines');
    await withRollback(db().client, async () => {
      const source = await goalWithTarget(spaceId, 'USD', '1000');
      const move = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'move', lineCount: 2 });
      await insertEarmarkLine({ eventId: move, goalId: source, spaceId, currency: 'USD', amountMinor: '-100' });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514' });
    });
  });

  it('rejects a move whose two lines do not sum to zero', async () => {
    const spaceId = await freshSpace('Earmark unequal move');
    await withRollback(db().client, async () => {
      const source = await goalWithTarget(spaceId, 'USD', '1000');
      const target = await goalWithTarget(spaceId, 'USD', '1000');
      const reserve = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'reserve', lineCount: 1 });
      await insertEarmarkLine({ eventId: reserve, goalId: source, spaceId, currency: 'USD', amountMinor: '400' });
      await forceDeferred();
      const move = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'move', lineCount: 2 });
      await insertEarmarkLine({ eventId: move, goalId: source, spaceId, currency: 'USD', amountMinor: '-100' });
      await insertEarmarkLine({ eventId: move, goalId: target, spaceId, currency: 'USD', amountMinor: '50' });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'goal_earmark_move_shape_invalid' });
    });
  });

  it('rejects a move collapsed onto a single goal (declared two lines, only one distinct goal touched)', async () => {
    const spaceId = await freshSpace('Earmark same-goal move');
    await withRollback(db().client, async () => {
      const goalId = await goalWithTarget(spaceId, 'USD', '1000');
      const move = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'move', lineCount: 2 });
      await insertEarmarkLine({ eventId: move, goalId, spaceId, currency: 'USD', amountMinor: '100' });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514' });
    });
  });

  it('rejects a second reversal of the same original event', async () => {
    const spaceId = await freshSpace('Earmark double reversal');
    await withRollback(db().client, async () => {
      const goalId = await goalWithTarget(spaceId, 'USD', '1000');
      const reserve = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'reserve', lineCount: 1 });
      await insertEarmarkLine({ eventId: reserve, goalId, spaceId, currency: 'USD', amountMinor: '400' });
      await forceDeferred();
      const firstReverse = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'reverse', reversalOf: reserve, lineCount: 1 });
      await insertEarmarkLine({ eventId: firstReverse, goalId, spaceId, currency: 'USD', amountMinor: '-400' });
      await forceDeferred();
      await expectSavepointRejection(
        db().client,
        () => insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'reverse', reversalOf: reserve, lineCount: 1 }),
        { code: '23505' },
      );
    });
  });

  it('rejects reversing a reverse', async () => {
    const spaceId = await freshSpace('Earmark reverse of reverse');
    await withRollback(db().client, async () => {
      const goalId = await goalWithTarget(spaceId, 'USD', '1000');
      const reserve = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'reserve', lineCount: 1 });
      await insertEarmarkLine({ eventId: reserve, goalId, spaceId, currency: 'USD', amountMinor: '400' });
      await forceDeferred();
      const reverse = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'reverse', reversalOf: reserve, lineCount: 1 });
      await insertEarmarkLine({ eventId: reverse, goalId, spaceId, currency: 'USD', amountMinor: '-400' });
      await forceDeferred();
      const doubleReverse = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'reverse', reversalOf: reverse, lineCount: 1 });
      await insertEarmarkLine({ eventId: doubleReverse, goalId, spaceId, currency: 'USD', amountMinor: '400' });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'goal_earmark_reverse_target_invalid' });
    });
  });

  it('rejects a release that would drive the goal\'s effective earmark negative', async () => {
    const spaceId = await freshSpace('Earmark negative resulting balance');
    await withRollback(db().client, async () => {
      const goalId = await goalWithTarget(spaceId, 'USD', '1000');
      const reserve = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'reserve', lineCount: 1 });
      await insertEarmarkLine({ eventId: reserve, goalId, spaceId, currency: 'USD', amountMinor: '400' });
      await forceDeferred();
      const release = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'release', lineCount: 1 });
      await insertEarmarkLine({ eventId: release, goalId, spaceId, currency: 'USD', amountMinor: '-500' });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'goal_earmark_balance_invalid' });
    });
  });

  it('rejects a reserve that would exceed the goal\'s target', async () => {
    const spaceId = await freshSpace('Earmark reserve over target');
    await withRollback(db().client, async () => {
      const goalId = await goalWithTarget(spaceId, 'USD', '1000');
      const reserve = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'reserve', lineCount: 1 });
      await insertEarmarkLine({ eventId: reserve, goalId, spaceId, currency: 'USD', amountMinor: '1001' });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'goal_earmark_balance_invalid' });
    });
  });

  it('allows target reduction below existing earmark without retroactively invalidating it', async () => {
    const spaceId = await freshSpace('Earmark target reduced below existing');
    await withRollback(db().client, async () => {
      const goalId = await insertGoal(spaceId, 'USD');
      const initialRevisionId = await insertGoalRevision({ goalId, spaceId, currency: 'USD', targetMinor: '1000' });
      const reserve = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'reserve', lineCount: 1 });
      await insertEarmarkLine({ eventId: reserve, goalId, spaceId, currency: 'USD', amountMinor: '800' });
      await forceDeferred();
      // Lower the target below the existing 800 earmark -- the prior reserve
      // row must not become invalid, and a same-goal release must still work.
      await insertGoalRevision({ goalId, spaceId, currency: 'USD', targetMinor: '500', expectedRevisionId: initialRevisionId });
      await forceDeferred();
      const release = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'release', lineCount: 1 });
      await insertEarmarkLine({ eventId: release, goalId, spaceId, currency: 'USD', amountMinor: '-100' });
      await forceDeferred();
    });
  });

  it('rejects a late earmark line appended to an already-committed event from a separate transaction', async () => {
    const spaceId = await freshSpace('Earmark late line');
    const { source, target, eventId } = await inTransaction(db().client, async () => {
      const source = await goalWithTarget(spaceId, 'USD', '1000');
      const target = await goalWithTarget(spaceId, 'USD', '1000');
      const reserve = await insertEarmarkEvent({ spaceId, currency: 'USD', operation: 'reserve', lineCount: 1 });
      await insertEarmarkLine({ eventId: reserve, goalId: source, spaceId, currency: 'USD', amountMinor: '400' });
      return { source, target, eventId: reserve };
    });
    await withRollback(db().client, async () => {
      await insertEarmarkLine({ eventId, goalId: target, spaceId, currency: 'USD', amountMinor: '1' });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'goal_earmark_line_count_mismatch' });
    });
  });
});

describe('goals schema: security and grants', () => {
  it('enables RLS with no direct table/sequence privileges on all nine relations', async () => {
    const tables = [
      'goals', 'goal_revisions', 'goal_milestones', 'goal_revision_milestones', 'goal_milestone_events',
      'goal_earmark_events', 'goal_earmark_lines', 'goal_purchase_links', 'goal_monthly_target_revisions',
    ];
    const result = await db().client.query<{ table_name: string; rls_enabled: boolean; grantee_count: string }>(
      `select c.relname as table_name, c.relrowsecurity as rls_enabled,
         (select count(*) from information_schema.table_privileges tp
          where tp.table_schema = 'public' and tp.table_name = c.relname
            and tp.grantee in ('public','anon','authenticated','service_role'))::text as grantee_count
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1::text[])`,
      [tables],
    );
    expect(result.rows).toHaveLength(tables.length);
    for (const row of result.rows) {
      expect(row.rls_enabled, `${row.table_name} must have RLS enabled`).toBe(true);
      expect(row.grantee_count, `${row.table_name} must have no direct API grants`).toBe('0');
    }
  });

  it('the owner-only INSERT guard denies an authenticated insert even with a temporary grant and permissive RLS', async () => {
    const spaceId = await freshSpace('Guard probe space');
    await withRollback(db().client, async () => {
      await db().client.query('grant insert on public.goals to authenticated');
      await db().client.query(
        `create policy goals_permissive_probe on public.goals for insert to authenticated with check (true)`,
      );
      await withAuthenticatedTransaction(db().client, actor, () =>
        expect(db().client.query(
          'insert into public.goals (id, space_id, currency, kind, actor_id) values ($1,$2,$3,$4,$5)',
          [randomUUID(), spaceId, 'USD', 'reserve', actor],
        )).rejects.toMatchObject({ code: '42501', message: 'planning_command_required' }));
    });
  });

  it('rejects a zero-row DELETE on goals', async () => {
    await withRollback(db().client, () => expectSavepointRejection(
      db().client,
      () => db().client.query("delete from public.goals where id = 'ffffffff-ffff-ffff-ffff-fffffffffffe'"),
      { code: '42501', message: 'planning_history_immutable' },
    ));
  });

  it('rejects a TRUNCATE on a leaf goals table (goal_earmark_lines, referenced by nothing)', async () => {
    // TRUNCATE on a table with INCOMING foreign keys (goals, goal_revisions,
    // goal_milestones, goal_earmark_events) fails on Postgres's own FK-cascade
    // check (0A000) before any trigger runs at all -- that is even stronger
    // protection, not a gap. A leaf table proves this guard's own trigger.
    await withRollback(db().client, () => expectSavepointRejection(
      db().client,
      () => db().client.query('truncate public.goal_earmark_lines'),
      { code: '42501', message: 'planning_history_immutable' },
    ));
  });
});
