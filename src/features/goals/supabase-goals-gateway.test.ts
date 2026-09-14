import { describe, expect, it } from 'vitest';
import type { RpcBuilder, RpcResult } from '../planning-shared/rpc.js';
import { createSupabaseGoalsGateway, type GoalsDataClient } from './supabase-goals-gateway.js';

interface RecordedCall { name: string; args: Record<string, unknown>; signal: AbortSignal | undefined }

function fakeClient(response: (call: RecordedCall) => RpcResult): { client: GoalsDataClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client: GoalsDataClient = {
    rpc(name, args) {
      let signal: AbortSignal | undefined;
      const builder: RpcBuilder = {
        abortSignal(value) {
          signal = value;
          return builder;
        },
        then(onFulfilled, onRejected) {
          const call = { name, args, signal };
          calls.push(call);
          return Promise.resolve(response(call)).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  };
  return { client, calls };
}

const HEAD_A = 'a'.repeat(64);
const HEAD_B = 'b'.repeat(64);
const GOAL_ID = '00000000-0000-4000-8000-000000000101';
const GOAL_ID_2 = '00000000-0000-4000-8000-000000000102';
const MILESTONE_ID = '00000000-0000-4000-8000-000000000201';

const summaryFixture = {
  id: GOAL_ID, revisionId: '1', currency: 'USD', kind: 'reserve', state: 'active',
  nameEn: 'Emergency fund', nameAr: null, targetMinor: '600000', earmarkedMinor: '30000',
  coveredMinor: '10000', fulfilledMinor: '0', shortageMinor: '20000',
  monthlyTargetMinor: '50000', monthlyNetContributionMinor: '10000', dueDate: null,
  horizon: 'open', needsReview: true, suggestedMonthlyMinor: null, forecastMonth: null,
  forecastState: 'insufficient_history', asOf: '2026-09-14T12:00:00Z',
};

const goalPageFixture = { rows: [summaryFixture], hasMore: false, nextCursor: null, asOf: '2026-09-14T12:00:00Z' };

const detailFixture = {
  summary: summaryFixture,
  milestones: [
    { id: MILESTONE_ID, kind: 'checklist', labelEn: 'Pick a bank', labelAr: null, thresholdMinor: null, dueDate: null, ordinal: 0, currentState: 'incomplete' },
  ],
  earmarkHead: HEAD_A, definitionHead: '1', asOf: '2026-09-14T12:00:00Z',
};

describe('createSupabaseGoalsGateway: loadPage', () => {
  it('maps camelCase input to p_snake_case args and parses a complete valid response', async () => {
    const { client, calls } = fakeClient(() => ({ data: goalPageFixture, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    const result = await gateway.loadPage({ spaceId: 'space-1', currency: 'USD', stateFilter: 'all', afterCreatedAt: null, afterId: null, limit: 25 });
    expect(calls[0]).toMatchObject({
      name: 'goal_page',
      args: { p_space_id: 'space-1', p_currency: 'USD', p_state_filter: 'all', p_after_created_at: null, p_after_id: null, p_limit: 25 },
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.coveredMinor).toBe('10000');
    expect(result.rows[0]!.shortageMinor).toBe('20000');
  });

  it('preserves a bigint identifier beyond Number.MAX_SAFE_INTEGER as text', async () => {
    const { client } = fakeClient(() => ({
      data: { ...goalPageFixture, rows: [{ ...summaryFixture, revisionId: '9007199254740993' }] }, error: null,
    }));
    const gateway = createSupabaseGoalsGateway(client);
    const result = await gateway.loadPage({ spaceId: 'space-1', currency: 'USD', stateFilter: 'all', afterCreatedAt: null, afterId: null, limit: 25 });
    expect(result.rows[0]!.revisionId).toBe('9007199254740993');
  });

  it('rejects the equivalent unsafe money number in the response', async () => {
    const { client } = fakeClient(() => ({
      data: { ...goalPageFixture, rows: [{ ...summaryFixture, earmarkedMinor: 9_007_199_254_740_993 }] }, error: null,
    }));
    const gateway = createSupabaseGoalsGateway(client);
    await expect(gateway.loadPage({ spaceId: 'space-1', currency: 'USD', stateFilter: 'all', afterCreatedAt: null, afterId: null, limit: 25 }))
      .rejects.toThrow();
  });

  it('rejects a null required string field', async () => {
    const { client } = fakeClient(() => ({
      data: { ...goalPageFixture, rows: [{ ...summaryFixture, id: null }] }, error: null,
    }));
    const gateway = createSupabaseGoalsGateway(client);
    await expect(gateway.loadPage({ spaceId: 'space-1', currency: 'USD', stateFilter: 'all', afterCreatedAt: null, afterId: null, limit: 25 }))
      .rejects.toThrow();
  });

  it('rejects an unknown state enum even though the field is typed as a string', async () => {
    const { client } = fakeClient(() => ({
      data: { ...goalPageFixture, rows: [{ ...summaryFixture, state: 'archived' }] }, error: null,
    }));
    const gateway = createSupabaseGoalsGateway(client);
    await expect(gateway.loadPage({ spaceId: 'space-1', currency: 'USD', stateFilter: 'all', afterCreatedAt: null, afterId: null, limit: 25 }))
      .rejects.toThrow();
  });

  it('rejects duplicate goal rows', async () => {
    const { client } = fakeClient(() => ({
      data: { ...goalPageFixture, rows: [summaryFixture, summaryFixture] }, error: null,
    }));
    const gateway = createSupabaseGoalsGateway(client);
    await expect(gateway.loadPage({ spaceId: 'space-1', currency: 'USD', stateFilter: 'all', afterCreatedAt: null, afterId: null, limit: 25 }))
      .rejects.toThrow();
  });

  it('rejects an out-of-range limit before ever reaching the transport', async () => {
    const { client, calls } = fakeClient(() => ({ data: goalPageFixture, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    // limit is caller-controlled; the gateway forwards it and trusts the DB's own bound.
    await gateway.loadPage({ spaceId: 'space-1', currency: 'USD', stateFilter: 'all', afterCreatedAt: null, afterId: null, limit: 25 });
    expect(calls[0]!.args['p_limit']).toBe(25);
  });

  it('rejects a partial page cursor before calling the transport', async () => {
    const { client, calls } = fakeClient(() => ({ data: goalPageFixture, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    await expect(gateway.loadPage({
      spaceId: 'space-1', currency: 'USD', stateFilter: 'all', afterCreatedAt: '2026-09-14T00:00:00Z', afterId: null, limit: 25,
    })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('parses a complete two-part cursor', async () => {
    const { client } = fakeClient(() => ({
      data: { ...goalPageFixture, hasMore: true, nextCursor: { createdAt: '2026-09-14T00:00:00Z', id: GOAL_ID_2 } }, error: null,
    }));
    const gateway = createSupabaseGoalsGateway(client);
    const result = await gateway.loadPage({ spaceId: 'space-1', currency: 'USD', stateFilter: 'all', afterCreatedAt: null, afterId: null, limit: 25 });
    expect(result.nextCursor).toEqual({ createdAt: '2026-09-14T00:00:00Z', id: GOAL_ID_2 });
  });

  it('forwards the caller AbortSignal into the transport', async () => {
    const { client, calls } = fakeClient(() => ({ data: goalPageFixture, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    const controller = new AbortController();
    await gateway.loadPage({ spaceId: 'space-1', currency: 'USD', stateFilter: 'all', afterCreatedAt: null, afterId: null, limit: 25 }, controller.signal);
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('createSupabaseGoalsGateway: loadDetail', () => {
  it('maps camelCase input, normalizes the month, and parses milestones/heads', async () => {
    const { client, calls } = fakeClient(() => ({ data: detailFixture, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    const result = await gateway.loadDetail({ spaceId: 'space-1', goalId: GOAL_ID, month: '2026-09-01' });
    expect(calls[0]).toMatchObject({ name: 'goal_detail', args: { p_space_id: 'space-1', p_goal_id: GOAL_ID, p_month: '2026-09-01' } });
    expect(result.earmarkHead).toBe(HEAD_A);
    expect(result.milestones).toHaveLength(1);
  });

  it('rejects a month that does not start on day one', async () => {
    const { client } = fakeClient(() => ({ data: detailFixture, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    await expect(gateway.loadDetail({ spaceId: 'space-1', goalId: GOAL_ID, month: '2026-09-15' })).rejects.toThrow();
  });

  it('rejects an invalid leap date', async () => {
    const { client } = fakeClient(() => ({ data: { ...detailFixture, summary: { ...summaryFixture, dueDate: '2025-02-29' } }, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    await expect(gateway.loadDetail({ spaceId: 'space-1', goalId: GOAL_ID, month: '2026-09-01' })).rejects.toThrow();
  });

  it('rejects a malformed earmark head', async () => {
    const { client } = fakeClient(() => ({ data: { ...detailFixture, earmarkHead: 'not-a-head' }, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    await expect(gateway.loadDetail({ spaceId: 'space-1', goalId: GOAL_ID, month: '2026-09-01' })).rejects.toThrow();
  });

  it('rejects more than 20 milestones', async () => {
    const many = Array.from({ length: 21 }, (_, index) => ({ ...detailFixture.milestones[0], id: `00000000-0000-4000-8000-0000000003${String(index).padStart(2, '0')}`, ordinal: index % 20 }));
    const { client } = fakeClient(() => ({ data: { ...detailFixture, milestones: many }, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    await expect(gateway.loadDetail({ spaceId: 'space-1', goalId: GOAL_ID, month: '2026-09-01' })).rejects.toThrow();
  });
});

describe('createSupabaseGoalsGateway: loadHistory', () => {
  const historyRow = { createdAt: '2026-09-14T00:00:00Z', sourceKind: 'earmark', sourceId: '5', detail: { operation: 'reserve', amountMinor: '10000' } };

  it('rejects an incomplete three-part cursor', async () => {
    const { client, calls } = fakeClient(() => ({ data: { rows: [], hasMore: false, nextCursor: null }, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    await expect(gateway.loadHistory({
      spaceId: 'space-1', goalId: GOAL_ID, beforeCreatedAt: '2026-09-14T00:00:00Z', beforeSourceKind: 'earmark', beforeSourceId: null, limit: 25,
    })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('parses a mixed-source page and its three-part cursor', async () => {
    const { client } = fakeClient(() => ({
      data: { rows: [historyRow], hasMore: true, nextCursor: { createdAt: '2026-09-13T00:00:00Z', sourceKind: 'definition', sourceId: '1' } }, error: null,
    }));
    const gateway = createSupabaseGoalsGateway(client);
    const result = await gateway.loadHistory({ spaceId: 'space-1', goalId: GOAL_ID, beforeCreatedAt: null, beforeSourceKind: null, beforeSourceId: null, limit: 25 });
    expect(result.rows[0]!.detail).toEqual({ operation: 'reserve', amountMinor: '10000' });
    expect(result.nextCursor).toEqual({ createdAt: '2026-09-13T00:00:00Z', sourceKind: 'definition', sourceId: '1' });
  });

  it('rejects an unknown history source kind', async () => {
    const { client } = fakeClient(() => ({ data: { rows: [{ ...historyRow, sourceKind: 'audit_log' }], hasMore: false, nextCursor: null }, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    await expect(gateway.loadHistory({ spaceId: 'space-1', goalId: GOAL_ID, beforeCreatedAt: null, beforeSourceKind: null, beforeSourceId: null, limit: 25 }))
      .rejects.toThrow();
  });
});

describe('createSupabaseGoalsGateway: mutations', () => {
  it('create sends the exact definition/milestone shape and parses the result', async () => {
    const { client, calls } = fakeClient(() => ({ data: { goalId: GOAL_ID, revisionId: '1' }, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    const result = await gateway.create({
      spaceId: 'space-1', requestId: 'req-1', goalId: GOAL_ID,
      definition: {
        kind: 'reserve', currency: 'USD', nameEn: 'Emergency', nameAr: null, note: null,
        targetMinor: '600000', deadline: null, contributionMode: 'manual_monthly', monthlyAmountMinor: '50000', priority: 0,
      },
      milestones: [{ id: MILESTONE_ID, kind: 'checklist', labelEn: 'Step', labelAr: null, thresholdMinor: null, dueDate: null, ordinal: 0 }],
    });
    expect(calls[0]!.name).toBe('create_goal_plan');
    expect(calls[0]!.args['p_definition']).toMatchObject({ kind: 'reserve', targetMinor: '600000', priority: 0 });
    expect(calls[0]!.args['p_milestones']).toEqual([{ id: MILESTONE_ID, kind: 'checklist', labelEn: 'Step', labelAr: null, thresholdMinor: null, dueDate: null, ordinal: 0 }]);
    expect(result).toEqual({ goalId: GOAL_ID, revisionId: '1' });
  });

  it('reserveOrRelease sends p_expected_head and p_accept_underfunded exactly', async () => {
    const { client, calls } = fakeClient(() => ({ data: { eventId: '7', goalId: GOAL_ID }, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    await gateway.reserveOrRelease({
      spaceId: 'space-1', requestId: 'req-1', goalId: GOAL_ID, action: 'reserve',
      amountMinor: '10000', expectedHead: HEAD_A, acceptUnderfunded: true,
    });
    expect(calls[0]).toMatchObject({
      name: 'record_goal_earmark',
      args: { p_goal_id: GOAL_ID, p_action: 'reserve', p_amount_minor: '10000', p_expected_head: HEAD_A, p_accept_underfunded: true },
    });
  });

  it('reserveOrRelease rejects a malformed expected head before calling the transport', async () => {
    const { client, calls } = fakeClient(() => ({ data: { eventId: '7', goalId: GOAL_ID }, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    await expect(gateway.reserveOrRelease({
      spaceId: 'space-1', requestId: 'req-1', goalId: GOAL_ID, action: 'reserve',
      amountMinor: '10000', expectedHead: 'not-a-head', acceptUnderfunded: true,
    })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('move sends both expected heads as distinct fields', async () => {
    const { client, calls } = fakeClient(() => ({ data: { eventId: '8' }, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    await gateway.move({
      spaceId: 'space-1', requestId: 'req-1', fromGoalId: GOAL_ID, toGoalId: GOAL_ID_2,
      amountMinor: '5000', expectedFromHead: HEAD_A, expectedToHead: HEAD_B, acceptUnderfunded: false,
    });
    expect(calls[0]!.args).toMatchObject({ p_expected_from_head: HEAD_A, p_expected_to_head: HEAD_B, p_accept_underfunded: false });
  });

  it('reverse sends the expected-heads array with real goal ids and head tokens', async () => {
    const { client, calls } = fakeClient(() => ({ data: { eventId: '9' }, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    await gateway.reverse({
      spaceId: 'space-1', requestId: 'req-1', eventId: '3',
      expectedHeads: [{ goalId: GOAL_ID, head: HEAD_A }, { goalId: GOAL_ID_2, head: HEAD_B }],
    });
    expect(calls[0]).toMatchObject({ name: 'reverse_goal_earmark', args: { p_event_id: 3 } });
    expect(calls[0]!.args['p_expected_heads']).toEqual([{ goalId: GOAL_ID, head: HEAD_A }, { goalId: GOAL_ID_2, head: HEAD_B }]);
  });

  it('reverse rejects zero expected heads', async () => {
    const { client } = fakeClient(() => ({ data: { eventId: '9' }, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    await expect(gateway.reverse({ spaceId: 'space-1', requestId: 'req-1', eventId: '3', expectedHeads: [] })).rejects.toThrow();
  });

  it('linkPurchase sends every line with its own expected head', async () => {
    const { client, calls } = fakeClient(() => ({ data: { linkIds: [GOAL_ID] }, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    const result = await gateway.linkPurchase({
      spaceId: 'space-1', requestId: 'req-1', expenseEventId: GOAL_ID,
      lines: [{ goalId: GOAL_ID, amountMinor: '4000', expectedHead: HEAD_A }],
    });
    expect(calls[0]!.args['p_lines']).toEqual([{ goalId: GOAL_ID, amountMinor: '4000', expectedHead: HEAD_A }]);
    expect(result.linkIds).toEqual([GOAL_ID]);
  });

  it('setMonthlyTarget normalizes the month and sends a null expected revision', async () => {
    const { client, calls } = fakeClient(() => ({ data: { revisionId: '4' }, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    await gateway.setMonthlyTarget({
      spaceId: 'space-1', requestId: 'req-1', goalId: GOAL_ID, month: '2026-09-01', amountMinor: '50000', expectedRevisionId: null,
    });
    expect(calls[0]).toMatchObject({ name: 'set_goal_monthly_target', args: { p_month: '2026-09-01', p_expected_revision_id: null } });
  });

  it('setMilestone converts a text expected event id to a safe number', async () => {
    const { client, calls } = fakeClient(() => ({ data: { eventId: '2' }, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    await gateway.setMilestone({
      spaceId: 'space-1', requestId: 'req-1', milestoneId: MILESTONE_ID, action: 'complete', expectedEventId: '1',
    });
    expect(calls[0]!.args['p_expected_event_id']).toBe(1);
  });

  it('findCommand returns null for an absent receipt', async () => {
    const { client } = fakeClient(() => ({ data: null, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    const receipt = await gateway.findCommand('space-1', 'req-1');
    expect(receipt).toBeNull();
  });

  it('findCommand parses a present receipt', async () => {
    const { client } = fakeClient(() => ({ data: { command: 'create_goal_plan', sequenceId: '1', result: { goalId: GOAL_ID } }, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    const receipt = await gateway.findCommand('space-1', 'req-1');
    expect(receipt).toEqual({ command: 'create_goal_plan', sequenceId: '1', result: { goalId: GOAL_ID } });
  });

  it('surfaces a transport error instead of swallowing it', async () => {
    const { client } = fakeClient(() => ({ data: null, error: { code: '40001', message: 'planning_stale_revision' } }));
    const gateway = createSupabaseGoalsGateway(client);
    await expect(gateway.create({
      spaceId: 'space-1', requestId: 'req-1', goalId: GOAL_ID,
      definition: {
        kind: 'reserve', currency: 'USD', nameEn: 'Emergency', nameAr: null, note: null,
        targetMinor: '600000', deadline: null, contributionMode: 'manual_monthly', monthlyAmountMinor: '0', priority: 0,
      },
      milestones: [],
    })).rejects.toMatchObject({ code: '40001' });
  });
});

describe('createSupabaseGoalsGateway: another space\'s stale response', () => {
  it('rejects a detail response whose summary belongs to a different currency shape entirely', async () => {
    const { client } = fakeClient(() => ({ data: { ...detailFixture, summary: { ...summaryFixture, currency: 'EUR' } }, error: null }));
    const gateway = createSupabaseGoalsGateway(client);
    await expect(gateway.loadDetail({ spaceId: 'space-1', goalId: GOAL_ID, month: '2026-09-01' })).rejects.toThrow();
  });
});
