import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction, orderedAuthenticatedRace,
  type DisposableDatabase,
} from './disposable-database.js';

let database: DisposableDatabase | undefined;
const actor = randomUUID();
const otherMember = randomUUID();

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_goalfund');
  await bootstrapCompatibilityObjects(db().client);
  await replayMigrations(db().client, migrationFiles());
  await db().client.query(
    `insert into auth.users(id, email, email_confirmed_at)
     values ($1, 'owner@budget.invalid', now()), ($2, 'member@budget.invalid', now())`,
    [actor, otherMember],
  );
}, 120_000);

afterAll(async () => {
  if (database) await disposeDisposableDatabase(database);
}, 30_000);

async function freshSpace(name: string, kind: 'personal' | 'household' = 'personal'): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const space = await db().client.query<{ id: string }>(
      'select id from public.create_space($1, $2) limit 2', [name, kind],
    );
    return space.rows[0]!.id;
  });
}

async function freshSpaceWithMember(name: string): Promise<string> {
  const spaceId = await freshSpace(name, 'household');
  await db().client.query(
    `insert into public.space_memberships (space_id, user_id, role)
     values ($1, $2, 'member'::public.member_role)`,
    [spaceId, otherMember],
  );
  return spaceId;
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

async function recordExpense(spaceId: string, walletId: string, date: string, amountMinor: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ id: string }>(
      `select id from public.record_financial_event($1,$2,'expense',$3::date,$4::jsonb) limit 2`,
      [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor: `-${amountMinor}` }])],
    );
    return result.rows[0]!.id;
  });
}

async function reverseEvent(spaceId: string, eventId: string, date: string): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () => db().client.query(
    'select * from public.reverse_financial_event($1,$2,$3,$4::date) limit 2',
    [spaceId, randomUUID(), eventId, date],
  ));
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

async function reviseGoal(spaceId: string, goalId: string, expectedRevisionId: string, state: string, overrides: Partial<Record<string, unknown>> = {}): Promise<{ revisionId: string }> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ revise_goal_plan: { revisionId: string } }>(
      'select public.revise_goal_plan($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',
      [spaceId, randomUUID(), goalId, expectedRevisionId, JSON.stringify(definition(overrides)), '[]', state],
    );
    return result.rows[0]!.revise_goal_plan;
  });
}

async function financingState(goalId: string, asOf: string): Promise<{ earmarkedMinor: string; fulfilledMinor: string; head: string }> {
  const result = await db().client.query<{ earmarked_minor: string; fulfilled_minor: string; head: string }>(
    'select earmarked_minor::text, fulfilled_minor::text, head from private.goal_financing_state($1,$2::date)',
    [goalId, asOf],
  );
  const row = result.rows[0]!;
  return { earmarkedMinor: row.earmarked_minor, fulfilledMinor: row.fulfilled_minor, head: row.head };
}

async function headFor(goalId: string, asOf = '2026-09-14'): Promise<string> {
  return (await financingState(goalId, asOf)).head;
}

async function cashPool(spaceId: string, currency: 'USD' | 'LBP', asOf: string): Promise<string> {
  const result = await db().client.query<{ pool: string }>(
    'select private.goal_cash_pool($1,$2,$3::date)::text as pool', [spaceId, currency, asOf],
  );
  return result.rows[0]!.pool;
}

async function reserve(spaceId: string, goalId: string, amountMinor: string, acceptUnderfunded: boolean, requestId?: string): Promise<{ eventId: string; goalId: string }> {
  const expectedHead = await headFor(goalId);
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ record_goal_earmark: { eventId: string; goalId: string } }>(
      'select public.record_goal_earmark($1,$2,$3,$4,$5,$6,$7)',
      [spaceId, requestId ?? randomUUID(), goalId, 'reserve', amountMinor, expectedHead, acceptUnderfunded],
    );
    return result.rows[0]!.record_goal_earmark;
  });
}

async function release(spaceId: string, goalId: string, amountMinor: string, expectedHead: string, requestId?: string, asActor = actor): Promise<{ eventId: string; goalId: string }> {
  return withAuthenticatedTransaction(db().client, asActor, async () => {
    const result = await db().client.query<{ record_goal_earmark: { eventId: string; goalId: string } }>(
      'select public.record_goal_earmark($1,$2,$3,$4,$5,$6,$7)',
      [spaceId, requestId ?? randomUUID(), goalId, 'release', amountMinor, expectedHead, true],
    );
    return result.rows[0]!.record_goal_earmark;
  });
}

async function move(spaceId: string, fromGoalId: string, toGoalId: string, amountMinor: string, acceptUnderfunded = true): Promise<{ eventId: string }> {
  const expectedFromHead = await headFor(fromGoalId);
  const expectedToHead = await headFor(toGoalId);
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ move_goal_earmark: { eventId: string } }>(
      'select public.move_goal_earmark($1,$2,$3,$4,$5,$6,$7,$8)',
      [spaceId, randomUUID(), fromGoalId, toGoalId, amountMinor, expectedFromHead, expectedToHead, acceptUnderfunded],
    );
    return result.rows[0]!.move_goal_earmark;
  });
}

async function reverseEarmark(spaceId: string, eventId: string, goalIds: string[]): Promise<{ eventId: string }> {
  const heads = await Promise.all(goalIds.map(async (goalId) => ({ goalId, head: await headFor(goalId) })));
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ reverse_goal_earmark: { eventId: string } }>(
      'select public.reverse_goal_earmark($1,$2,$3,$4::jsonb)',
      [spaceId, randomUUID(), eventId, JSON.stringify(heads)],
    );
    return result.rows[0]!.reverse_goal_earmark;
  });
}

async function linkPurchase(spaceId: string, expenseEventId: string, lines: Array<{ goalId: string; amountMinor: string }>, requestId?: string): Promise<{ linkIds: string[] }> {
  const withHeads = await Promise.all(lines.map(async (line) => ({ ...line, expectedHead: await headFor(line.goalId) })));
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ link_goal_purchase: { linkIds: string[] } }>(
      'select public.link_goal_purchase($1,$2,$3,$4::jsonb)',
      [spaceId, requestId ?? randomUUID(), expenseEventId, JSON.stringify(withHeads)],
    );
    return result.rows[0]!.link_goal_purchase;
  });
}

async function financialDigest(spaceId: string): Promise<unknown> {
  const result = await db().client.query(
    `select
       (select count(*) from public.financial_events where space_id = $1) as events,
       (select count(*) from public.wallet_movements where space_id = $1) as movements`,
    [spaceId],
  );
  return result.rows[0];
}

const TODAY = '2026-09-14';

describe('private.goal_financing_state and private.goal_cash_pool', () => {
  it('reflects an empty goal as zero with a stable head', async () => {
    const spaceId = await freshSpace('Financing state empty goal');
    const goal = await createGoal(spaceId);
    const state = await financingState(goal.goalId, TODAY);
    expect(state).toMatchObject({ earmarkedMinor: '0', fulfilledMinor: '0' });
    expect(state.head).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sums signed wallet movements for the cash pool, ignoring other currencies', async () => {
    const spaceId = await freshSpace('Cash pool sum');
    const usd = await usdWallet(spaceId);
    await recordIncome(spaceId, usd, TODAY, '70000');
    await recordExpense(spaceId, usd, TODAY, '10000');
    expect(await cashPool(spaceId, 'USD', TODAY)).toBe('60000');
    expect(await cashPool(spaceId, 'LBP', TODAY)).toBe('0');
  });
});

describe('funding scenarios (task 10 Task 5 numeric table)', () => {
  it('cash70000; reserving 60000 then 30000 needs acknowledgement once the space total would exceed cash', async () => {
    const spaceId = await freshSpace('Scenario reserve two goals need ack');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, TODAY, '70000');
    const emergency = await createGoal(spaceId, { nameEn: 'Emergency' });
    const laptop = await createGoal(spaceId, { nameEn: 'Laptop', targetMinor: '300000' });

    await reserve(spaceId, emergency.goalId, '60000', false);
    await expect(reserve(spaceId, laptop.goalId, '30000', false))
      .rejects.toMatchObject({ code: '22023', message: 'goal_underfunded_confirmation_required' });
    await reserve(spaceId, laptop.goalId, '30000', true);

    expect((await financingState(emergency.goalId, TODAY)).earmarkedMinor).toBe('60000');
    expect((await financingState(laptop.goalId, TODAY)).earmarkedMinor).toBe('30000');
    expect(await cashPool(spaceId, 'USD', TODAY)).toBe('70000');
  });

  it('reserve20000; release5000 leaves earmarked15000', async () => {
    const spaceId = await freshSpace('Scenario reserve then release');
    const goal = await createGoal(spaceId);
    await reserve(spaceId, goal.goalId, '20000', true);
    await release(spaceId, goal.goalId, '5000', await headFor(goal.goalId));
    expect((await financingState(goal.goalId, TODAY)).earmarkedMinor).toBe('15000');
  });

  it('move5000 shifts source down and destination up leaving combined claims unchanged', async () => {
    const spaceId = await freshSpace('Scenario move');
    const source = await createGoal(spaceId, { nameEn: 'Source' });
    const destination = await createGoal(spaceId, { nameEn: 'Destination', targetMinor: '300000' });
    await reserve(spaceId, source.goalId, '20000', true);
    const before = BigInt((await financingState(source.goalId, TODAY)).earmarkedMinor)
      + BigInt((await financingState(destination.goalId, TODAY)).earmarkedMinor);
    await move(spaceId, source.goalId, destination.goalId, '5000');
    expect((await financingState(source.goalId, TODAY)).earmarkedMinor).toBe('15000');
    expect((await financingState(destination.goalId, TODAY)).earmarkedMinor).toBe('5000');
    const after = BigInt((await financingState(source.goalId, TODAY)).earmarkedMinor)
      + BigInt((await financingState(destination.goalId, TODAY)).earmarkedMinor);
    expect(after).toBe(before);
  });

  it('purchase reserve100000; link expense40000 leaves earmark60000 fulfilled40000 with no new cash rows', async () => {
    const spaceId = await freshSpace('Scenario link purchase');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, TODAY, '200000');
    const goal = await createGoal(spaceId, { kind: 'purchase', targetMinor: '150000' });
    await reserve(spaceId, goal.goalId, '100000', true);
    const expenseId = await recordExpense(spaceId, wallet, TODAY, '40000');

    const digestBefore = await financialDigest(spaceId);
    await linkPurchase(spaceId, expenseId, [{ goalId: goal.goalId, amountMinor: '40000' }]);
    expect(await financialDigest(spaceId)).toEqual(digestBefore);

    const state = await financingState(goal.goalId, TODAY);
    expect(state).toMatchObject({ earmarkedMinor: '60000', fulfilledMinor: '40000' });
  });

  it('reversing the linked expense restores earmark100000 fulfilled0 as of the reversal date', async () => {
    const spaceId = await freshSpace('Scenario reverse linked expense');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, TODAY, '200000');
    const goal = await createGoal(spaceId, { kind: 'purchase', targetMinor: '150000' });
    await reserve(spaceId, goal.goalId, '100000', true);
    const expenseId = await recordExpense(spaceId, wallet, TODAY, '40000');
    await linkPurchase(spaceId, expenseId, [{ goalId: goal.goalId, amountMinor: '40000' }]);
    await reverseEvent(spaceId, expenseId, TODAY);

    const state = await financingState(goal.goalId, TODAY);
    expect(state).toMatchObject({ earmarkedMinor: '100000', fulfilledMinor: '0' });
  });

  it('linking 40000 twice against a 50000 expense rejects the second link with no partial state', async () => {
    const spaceId = await freshSpace('Scenario over-link rejected');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, TODAY, '200000');
    const goalA = await createGoal(spaceId, { kind: 'purchase', nameEn: 'A', targetMinor: '150000' });
    const goalB = await createGoal(spaceId, { kind: 'purchase', nameEn: 'B', targetMinor: '150000' });
    await reserve(spaceId, goalA.goalId, '40000', true);
    await reserve(spaceId, goalB.goalId, '40000', true);
    const expenseId = await recordExpense(spaceId, wallet, TODAY, '50000');

    await linkPurchase(spaceId, expenseId, [{ goalId: goalA.goalId, amountMinor: '40000' }]);
    const linksBefore = await db().client.query('select count(*) as n from public.goal_purchase_links where expense_event_id = $1', [expenseId]);
    const receiptsBefore = await db().client.query('select count(*) as n from public.planning_command_receipts where space_id = $1', [spaceId]);

    await expect(linkPurchase(spaceId, expenseId, [{ goalId: goalB.goalId, amountMinor: '40000' }]))
      .rejects.toMatchObject({ code: 'P0001' });

    const linksAfter = await db().client.query('select count(*) as n from public.goal_purchase_links where expense_event_id = $1', [expenseId]);
    const receiptsAfter = await db().client.query('select count(*) as n from public.planning_command_receipts where space_id = $1', [spaceId]);
    expect(linksAfter.rows[0]!.n).toBe(linksBefore.rows[0]!.n);
    expect(receiptsAfter.rows[0]!.n).toBe(receiptsBefore.rows[0]!.n);
  });

  it('releasing the same 60000 twice concurrently lets the first succeed and rejects the second as stale, never negative', async () => {
    const spaceId = await freshSpace('Scenario concurrent release');
    const goal = await createGoal(spaceId);
    await reserve(spaceId, goal.goalId, '60000', true);
    const expectedHead = await headFor(goal.goalId);

    const outcome = await orderedAuthenticatedRace(
      db(),
      actor,
      (client) => client.query(
        'select public.record_goal_earmark($1,$2,$3,$4,$5,$6,$7)',
        [spaceId, randomUUID(), goal.goalId, 'release', '60000', expectedHead, true],
      ),
      (client) => client.query(
        'select public.record_goal_earmark($1,$2,$3,$4,$5,$6,$7)',
        [spaceId, randomUUID(), goal.goalId, 'release', '60000', expectedHead, true],
      ),
    );
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toMatchObject({ code: '40001', message: 'planning_stale_revision' });
    }
    const state = await financingState(goal.goalId, TODAY);
    expect(BigInt(state.earmarkedMinor)).toBeGreaterThanOrEqual(0n);
    expect(state.earmarkedMinor).toBe('0');
  });

  it('closing after full fulfillment then reversing the expense retains the closed definition but exposes the restored earmark', async () => {
    const spaceId = await freshSpace('Scenario close then reverse');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, TODAY, '200000');
    const goal = await createGoal(spaceId, { kind: 'purchase', targetMinor: '50000' });
    await reserve(spaceId, goal.goalId, '50000', true);
    const expenseId = await recordExpense(spaceId, wallet, TODAY, '50000');
    await linkPurchase(spaceId, expenseId, [{ goalId: goal.goalId, amountMinor: '50000' }]);
    expect((await financingState(goal.goalId, TODAY)).earmarkedMinor).toBe('0');

    const closed = await reviseGoal(spaceId, goal.goalId, goal.revisionId, 'closed', { kind: 'purchase', targetMinor: '50000' });
    await reverseEvent(spaceId, expenseId, TODAY);

    const definitionRow = await db().client.query<{ state: string }>(
      'select state from public.goal_revisions where id = $1', [closed.revisionId],
    );
    expect(definitionRow.rows[0]!.state).toBe('closed');
    const state = await financingState(goal.goalId, TODAY);
    expect(state.earmarkedMinor).toBe('50000');
  });

  it('replays an identical request after the goal changed, returning the original result untouched', async () => {
    const spaceId = await freshSpace('Scenario replay after change');
    const goal = await createGoal(spaceId);
    const requestId = randomUUID();
    const expectedHead = await headFor(goal.goalId);
    const first = await reserve(spaceId, goal.goalId, '10000', true, requestId);
    await reserve(spaceId, goal.goalId, '5000', true);

    const replayed = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query<{ record_goal_earmark: { eventId: string; goalId: string } }>(
        'select public.record_goal_earmark($1,$2,$3,$4,$5,$6,$7)',
        [spaceId, requestId, goal.goalId, 'reserve', '10000', expectedHead, true],
      );
      return result.rows[0]!.record_goal_earmark;
    });
    expect(replayed).toEqual(first);
  });

  it('rejects a different actor reusing a request UUID without disclosing the original result', async () => {
    const spaceId = await freshSpaceWithMember('Scenario idempotency conflict cross actor');
    const goal = await createGoal(spaceId);
    const requestId = randomUUID();
    await reserve(spaceId, goal.goalId, '10000', true, requestId);
    await expect(release(spaceId, goal.goalId, '10000', await headFor(goal.goalId), requestId, otherMember))
      .rejects.toMatchObject({ code: 'P0001', message: 'planning_idempotency_conflict' });
  });
});

describe('additional funding edge cases', () => {
  it('does not require acknowledgement for an ordinary later cash drop below the earmark total', async () => {
    const spaceId = await freshSpace('Underfunded advisory only');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, TODAY, '60000');
    const goal = await createGoal(spaceId);
    await reserve(spaceId, goal.goalId, '60000', false);
    await recordExpense(spaceId, wallet, TODAY, '50000');
    expect(await cashPool(spaceId, 'USD', TODAY)).toBe('10000');
    expect((await financingState(goal.goalId, TODAY)).earmarkedMinor).toBe('60000');
  });

  it('rejects linking an old expense to funds that were reserved only afterward', async () => {
    const spaceId = await freshSpace('Late reservation backdated link rejected');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, '2026-01-01', '100000');
    const goal = await createGoal(spaceId, { kind: 'purchase', targetMinor: '100000' });
    const expenseId = await recordExpense(spaceId, wallet, '2026-01-01', '30000');
    await reserve(spaceId, goal.goalId, '30000', true);

    await expect(linkPurchase(spaceId, expenseId, [{ goalId: goal.goalId, amountMinor: '30000' }]))
      .rejects.toMatchObject({ code: 'P0001' });
  });

  it('nets out correctly by today even when a reversal is dated before its original expense', async () => {
    const spaceId = await freshSpace('Reversal dated before original');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, TODAY, '100000');
    const goal = await createGoal(spaceId, { kind: 'purchase', targetMinor: '100000' });
    await reserve(spaceId, goal.goalId, '50000', true);
    const expenseId = await recordExpense(spaceId, wallet, TODAY, '50000');
    await linkPurchase(spaceId, expenseId, [{ goalId: goal.goalId, amountMinor: '50000' }]);
    // The reversal's own business date precedes the expense it reverses --
    // goal_financing_state must still net both flags true by today rather
    // than assuming reversal date >= original date.
    await reverseEvent(spaceId, expenseId, '2026-08-01');

    const state = await financingState(goal.goalId, TODAY);
    expect(state).toMatchObject({ earmarkedMinor: '50000', fulfilledMinor: '0' });
  });

  it('retains earmarked history after a target reduction and blocks further reserves past the new ceiling', async () => {
    const spaceId = await freshSpace('Target reduction retains history');
    const goal = await createGoal(spaceId, { targetMinor: '100000' });
    await reserve(spaceId, goal.goalId, '80000', true);
    const reduced = await reviseGoal(spaceId, goal.goalId, goal.revisionId, 'active', { targetMinor: '50000' });
    expect((await financingState(goal.goalId, TODAY)).earmarkedMinor).toBe('80000');
    await expect(reserve(spaceId, goal.goalId, '1', true)).rejects.toMatchObject({ code: 'P0001' });
    void reduced;
  });

  it('allows a reversal to exceed a since-reduced target because it restores history rather than expressing new intent', async () => {
    const spaceId = await freshSpace('Reverse exceeds reduced target');
    const goal = await createGoal(spaceId, { targetMinor: '100000' });
    await reserve(spaceId, goal.goalId, '90000', true);
    const released = await release(spaceId, goal.goalId, '90000', await headFor(goal.goalId));
    await reviseGoal(spaceId, goal.goalId, goal.revisionId, 'active', { targetMinor: '20000' });

    await reverseEarmark(spaceId, released.eventId, [goal.goalId]);
    expect((await financingState(goal.goalId, TODAY)).earmarkedMinor).toBe('90000');
  });

  it('two connections replaying the identical request both receive the same committed result', async () => {
    const spaceId = await freshSpace('Same request two connections');
    const goal = await createGoal(spaceId);
    const requestId = randomUUID();
    const expectedHead = await headFor(goal.goalId);

    const outcome = await orderedAuthenticatedRace(
      db(),
      actor,
      (client) => client.query(
        'select public.record_goal_earmark($1,$2,$3,$4,$5,$6,$7)',
        [spaceId, requestId, goal.goalId, 'reserve', '10000', expectedHead, true],
      ),
      (client) => client.query(
        'select public.record_goal_earmark($1,$2,$3,$4,$5,$6,$7)',
        [spaceId, requestId, goal.goalId, 'reserve', '10000', expectedHead, true],
      ),
    );
    expect(outcome.status).toBe('fulfilled');
    const count = await db().client.query('select count(*) as n from public.goal_earmark_events where request_id = $1', [requestId]);
    expect(count.rows[0]!.n).toBe('1');
  });

  it('rejects a zero-row TRUNCATE on a leaf earmark-line table exactly like task 09', async () => {
    const spaceId = await freshSpace('Zero row truncate leaf table');
    await createGoal(spaceId);
    await withAuthenticatedTransaction(db().client, actor, async () => {
      await expect(db().client.query('truncate public.goal_earmark_lines'))
        .rejects.toMatchObject({ code: '42501' });
    });
  });

  it('rejects a reverse of an event that already has a reversal', async () => {
    const spaceId = await freshSpace('Double reverse rejected');
    const goal = await createGoal(spaceId);
    const reserved = await reserve(spaceId, goal.goalId, '10000', true);
    await reverseEarmark(spaceId, reserved.eventId, [goal.goalId]);
    await expect(reverseEarmark(spaceId, reserved.eventId, [goal.goalId]))
      .rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects a release that exceeds the current earmark', async () => {
    const spaceId = await freshSpace('Over-release rejected');
    const goal = await createGoal(spaceId);
    await reserve(spaceId, goal.goalId, '10000', true);
    await expect(release(spaceId, goal.goalId, '10001', await headFor(goal.goalId)))
      .rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects a reserve into a paused goal', async () => {
    const spaceId = await freshSpace('Reserve into paused goal rejected');
    const goal = await createGoal(spaceId);
    await reviseGoal(spaceId, goal.goalId, goal.revisionId, 'paused');
    await expect(reserve(spaceId, goal.goalId, '1000', true)).rejects.toMatchObject({ code: 'P0001' });
  });

  it('allows a release out of a paused goal', async () => {
    const spaceId = await freshSpace('Release from paused goal allowed');
    const goal = await createGoal(spaceId);
    await reserve(spaceId, goal.goalId, '10000', true);
    const paused = await reviseGoal(spaceId, goal.goalId, goal.revisionId, 'paused');
    const result = await release(spaceId, goal.goalId, '10000', await headFor(goal.goalId));
    expect(result.eventId).toMatch(/^\d+$/);
    void paused;
  });

  it('rejects a stale head on record_goal_earmark', async () => {
    const spaceId = await freshSpace('Stale head reserve');
    const goal = await createGoal(spaceId);
    await reserve(spaceId, goal.goalId, '1000', true);
    await expect(withAuthenticatedTransaction(db().client, actor, () => db().client.query(
      'select public.record_goal_earmark($1,$2,$3,$4,$5,$6,$7)',
      [spaceId, randomUUID(), goal.goalId, 'reserve', '1000', 'a'.repeat(64), true],
    ))).rejects.toMatchObject({ code: '40001', message: 'planning_stale_revision' });
  });

  it('rejects a link against an already-reversed expense', async () => {
    const spaceId = await freshSpace('Link against reversed expense rejected');
    const wallet = await usdWallet(spaceId);
    await recordIncome(spaceId, wallet, TODAY, '100000');
    const goal = await createGoal(spaceId, { kind: 'purchase' });
    await reserve(spaceId, goal.goalId, '30000', true);
    const expenseId = await recordExpense(spaceId, wallet, TODAY, '30000');
    await reverseEvent(spaceId, expenseId, TODAY);
    await expect(linkPurchase(spaceId, expenseId, [{ goalId: goal.goalId, amountMinor: '30000' }]))
      .rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects a loan-linked event from being linked to a goal', async () => {
    const spaceId = await freshSpace('Loan event cannot link to goal');
    const goal = await createGoal(spaceId, { kind: 'purchase' });
    const opening = await withAuthenticatedTransaction(db().client, actor, async () => {
      const result = await db().client.query<{ event_id: string }>(
        "select event_id from public.open_loan_outstanding($1,$2,'they_owe_me','Lender','USD','100000','2026-09-01') limit 2",
        [spaceId, randomUUID()],
      );
      return result.rows[0]!.event_id;
    });
    await expect(linkPurchase(spaceId, opening, [{ goalId: goal.goalId, amountMinor: '1000' }]))
      .rejects.toMatchObject({ code: 'P0001' });
  });
});
