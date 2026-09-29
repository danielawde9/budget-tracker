import { describe, expect, it, vi } from 'vitest';
import { goalRevisionFromDetail, runBuyIt, type BuyItCommands, type BuyItRequest, type BuyItRequestIds } from './buy-it.js';
import type { GoalDefinitionInput, GoalMilestoneRow, GoalSummary } from './types.js';

const HEAD_A = 'a'.repeat(64);
const GOAL_ID = '00000000-0000-4000-8000-000000000101';

const definition: GoalDefinitionInput = {
  kind: 'purchase', currency: 'USD', nameEn: 'New laptop', nameAr: null, note: null,
  targetMinor: '100000', deadline: null, contributionMode: 'manual_monthly', monthlyAmountMinor: '0', priority: 0,
};

const request: BuyItRequest = {
  goalId: GOAL_ID,
  expectedHead: HEAD_A,
  expectedRevisionId: '1',
  definition,
  milestones: [],
  walletId: 'wallet-1',
  categoryId: 'cat-1',
  amountMinor: '100000',
  effectiveDate: '2026-09-14',
};

/** One fixed set of caller-owned request ids, exactly as the dialog freezes
 * them for a single purchase attempt. */
const IDS: BuyItRequestIds = { record: 'req-record', link: 'req-link', close: 'req-close' };

function timeout(): Error {
  return new Error('network timeout');
}

function fakeCommands(overrides: Partial<BuyItCommands> = {}) {
  // A tiny server: each request id maps to the event it created, so a replay
  // (or a reconcile lookup) sees the same event and never a second one.
  const events = new Map<string, string>();
  const recordCalls: string[] = [];
  const base: BuyItCommands = {
    recordCategorizedExpense: vi.fn(async (input) => {
      recordCalls.push(input.requestId);
      const existing = events.get(input.requestId);
      const eventId = existing ?? `event-${events.size + 1}`;
      events.set(input.requestId, eventId);
      return { eventId };
    }),
    findEventIdByRequestId: vi.fn(async (requestId) => events.get(requestId) ?? null),
    linkPurchase: vi.fn(async () => ({ linkIds: ['link-1'] })),
    findCommandReceipt: vi.fn(async () => null),
    revise: vi.fn(async () => ({ goalId: GOAL_ID, revisionId: '2' })),
  };
  return { commands: { ...base, ...overrides }, events, recordCalls };
}

describe('runBuyIt', () => {
  it('records, links and closes in order with the caller-owned request ids', async () => {
    const { commands } = fakeCommands();
    const outcome = await runBuyIt(commands, request, IDS);

    expect(outcome).toMatchObject({
      record: { status: 'success', reconciled: false },
      link: { status: 'success', reconciled: false },
      close: { status: 'success', reconciled: false },
      expenseEventId: 'event-1',
    });
    expect(commands.recordCategorizedExpense).toHaveBeenCalledWith({
      requestId: 'req-record', effectiveDate: '2026-09-14', walletId: 'wallet-1', amountMinor: '100000', categoryId: 'cat-1',
    });
    expect(commands.linkPurchase).toHaveBeenCalledWith({
      requestId: 'req-link', expenseEventId: 'event-1', goalId: GOAL_ID, amountMinor: '100000', expectedHead: HEAD_A,
    });
    expect(commands.revise).toHaveBeenCalledWith({
      requestId: 'req-close', goalId: GOAL_ID, expectedRevisionId: '1', definition, milestones: [], state: 'closed',
    });
  });

  it('reconciles a recorded expense after an ambiguous transport failure instead of posting again', async () => {
    const { commands, events } = fakeCommands();
    // The command committed but its response was lost: the event is already
    // stored under the request id, and the lookup finds it.
    events.set('req-record', 'event-committed');
    commands.recordCategorizedExpense = vi.fn(async () => { throw timeout(); });

    const outcome = await runBuyIt(commands, request, IDS);

    expect(outcome.record).toMatchObject({ status: 'success', reconciled: true });
    expect(outcome.expenseEventId).toBe('event-committed');
    expect(commands.linkPurchase).toHaveBeenCalledTimes(1);
    expect(commands.recordCategorizedExpense).toHaveBeenCalledTimes(1);
    expect(commands.findEventIdByRequestId).toHaveBeenCalledWith('req-record');
  });

  it('goes ambiguous on an unconfirmed record and never starts the link step', async () => {
    const { commands } = fakeCommands({ recordCategorizedExpense: vi.fn(async () => { throw timeout(); }) });

    const outcome = await runBuyIt(commands, request, IDS);

    expect(outcome.record.status).toBe('ambiguous');
    expect(outcome.link.status).toBe('not-attempted');
    expect(outcome.close.status).toBe('not-attempted');
    expect(outcome.expenseEventId).toBeNull();
    expect(commands.linkPurchase).not.toHaveBeenCalled();
    expect(commands.revise).not.toHaveBeenCalled();
  });

  it('reuses the same request ids on retry, so an unconfirmed record posts exactly once', async () => {
    const { commands, events, recordCalls } = fakeCommands();
    let attempt = 0;
    commands.recordCategorizedExpense = vi.fn(async (input) => {
      attempt += 1;
      recordCalls.push(input.requestId);
      if (attempt === 1) throw timeout();
      const eventId = 'event-after-retry';
      events.set(input.requestId, eventId);
      return { eventId };
    });

    const first = await runBuyIt(commands, request, IDS);
    expect(first.record.status).toBe('ambiguous');
    expect(first.expenseEventId).toBeNull();

    const second = await runBuyIt(commands, request, IDS);
    expect(second).toMatchObject({ record: { status: 'success' }, link: { status: 'success' }, close: { status: 'success' } });
    // The exact same record request id was sent on both attempts, and only one
    // event was ever created for it.
    expect(new Set(recordCalls)).toEqual(new Set(['req-record']));
    expect(events.size).toBe(1);
    expect(commands.linkPurchase).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-link', expenseEventId: 'event-after-retry' }));
  });

  it('stops before the link step when the record step is rejected outright', async () => {
    const { commands } = fakeCommands({
      recordCategorizedExpense: vi.fn(async () => { throw new Error('planning_invalid_input'); }),
    });

    const outcome = await runBuyIt(commands, request, IDS);

    expect(outcome.record.status).toBe('failed');
    expect(outcome.link.status).toBe('not-attempted');
    expect(outcome.close.status).toBe('not-attempted');
    expect(outcome.expenseEventId).toBeNull();
    expect(commands.linkPurchase).not.toHaveBeenCalled();
  });

  it('reconciles a linked purchase by its command receipt after an ambiguous failure', async () => {
    const { commands } = fakeCommands({
      linkPurchase: vi.fn(async () => { throw timeout(); }),
      findCommandReceipt: vi.fn(async () => ({ command: 'link_goal_purchase' })),
    });

    const outcome = await runBuyIt(commands, request, IDS);

    expect(outcome.record.status).toBe('success');
    expect(outcome.link).toMatchObject({ status: 'success', reconciled: true });
    expect(outcome.close.status).toBe('success');
    expect(commands.linkPurchase).toHaveBeenCalledTimes(1);
  });

  it('leaves the money posted and reports what remains when the link is rejected', async () => {
    const { commands } = fakeCommands({
      linkPurchase: vi.fn(async () => { throw Object.assign(new Error('planning_stale_revision'), { code: '40001' }); }),
    });

    const outcome = await runBuyIt(commands, request, IDS);

    expect(outcome.record.status).toBe('success');
    expect(outcome.link).toMatchObject({ status: 'failed', message: 'planning_stale_revision' });
    expect(outcome.close.status).toBe('not-attempted');
    expect(outcome.expenseEventId).toBe('event-1');
    expect(commands.revise).not.toHaveBeenCalled();
  });

  it('reconciles the close step by its command receipt after an ambiguous failure', async () => {
    const { commands } = fakeCommands({
      revise: vi.fn(async () => { throw timeout(); }),
      findCommandReceipt: vi.fn(async () => ({ command: 'revise_goal_plan' })),
    });

    const outcome = await runBuyIt(commands, request, IDS);

    expect(outcome.close).toMatchObject({ status: 'success', reconciled: true });
  });

  it('reports recorded and linked but not closed when the close is rejected', async () => {
    const { commands } = fakeCommands({
      revise: vi.fn(async () => { throw new Error('closing a goal requires its current earmark to be zero'); }),
    });

    const outcome = await runBuyIt(commands, request, IDS);

    expect(outcome.record.status).toBe('success');
    expect(outcome.link.status).toBe('success');
    expect(outcome.close.status).toBe('failed');
    expect(outcome.close.message).toBe('closing a goal requires its current earmark to be zero');
    expect(outcome.expenseEventId).toBe('event-1');
  });

  it('reuses both goals request ids on a close retry', async () => {
    const { commands } = fakeCommands();
    let attempt = 0;
    commands.revise = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw timeout();
      return { goalId: GOAL_ID, revisionId: '2' };
    });

    await runBuyIt(commands, request, IDS);
    await runBuyIt(commands, request, IDS);

    const reviseIds = (commands.revise as ReturnType<typeof vi.fn>).mock.calls.map((call) => (call[0] as { requestId: string }).requestId);
    expect(reviseIds).toEqual(['req-close', 'req-close']);
  });
});

describe('goalRevisionFromDetail', () => {
  const summary: GoalSummary = {
    id: GOAL_ID, revisionId: '7', currency: 'USD', kind: 'purchase', state: 'active',
    nameEn: 'New laptop', nameAr: 'كمبيوتر', targetMinor: '100000', earmarkedMinor: '100000',
    coveredMinor: '100000', fulfilledMinor: '0', shortageMinor: '0', monthlyTargetMinor: '20000',
    monthlyNetContributionMinor: '0', dueDate: null, horizon: 'open', needsReview: false,
    suggestedMonthlyMinor: null, forecastMonth: null, forecastState: 'insufficient_history', asOf: '2026-09-14T12:00:00Z',
  };
  const milestones: readonly GoalMilestoneRow[] = [{
    id: '00000000-0000-4000-8000-000000000201', kind: 'checklist', labelEn: 'Compare models', labelAr: null,
    thresholdMinor: null, dueDate: null, ordinal: 0, currentState: 'incomplete',
  }];

  it('reconstructs the full revise input from the detail snapshot', () => {
    expect(goalRevisionFromDetail(summary, milestones)).toEqual({
      expectedRevisionId: '7',
      definition: {
        kind: 'purchase', currency: 'USD', nameEn: 'New laptop', nameAr: 'كمبيوتر', note: null,
        targetMinor: '100000', deadline: null, contributionMode: 'manual_monthly', monthlyAmountMinor: '20000', priority: 0,
      },
      milestones: [{
        id: '00000000-0000-4000-8000-000000000201', kind: 'checklist', labelEn: 'Compare models', labelAr: null,
        thresholdMinor: null, dueDate: null, ordinal: 0,
      }],
    });
  });
});
