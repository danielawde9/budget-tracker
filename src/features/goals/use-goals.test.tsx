import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { coreGoalPageFixture, emptyGoalPage, InMemoryGoalsGateway } from '../../test/in-memory-goals-gateway.js';
import type { GoalPage, GoalsGateway } from './types.js';
import { useGoals } from './use-goals.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((doResolve) => { resolve = doResolve; });
  return { promise, resolve };
}

const createDraft = {
  goalId: '00000000-0000-4000-8000-000000000101',
  definition: {
    kind: 'reserve' as const, currency: 'USD' as const, nameEn: 'Emergency', nameAr: null, note: null,
    targetMinor: '600000', deadline: null, contributionMode: 'manual_monthly' as const, monthlyAmountMinor: '0', priority: 0,
  },
  milestones: [],
};

describe('useGoals', () => {
  it('loads the current page and reaches ready', async () => {
    const gateway = new InMemoryGoalsGateway();
    gateway.page = coreGoalPageFixture;
    const { result } = renderHook(() => useGoals(gateway, 'space-1', 'USD', 'all'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.page.rows).toHaveLength(1);
    expect(result.current.page.rows[0]!.coveredMinor).toBe('30000');
  });

  it('clears the prior page immediately and ignores its late response when the space changes', async () => {
    const first = deferred<GoalPage>();
    const second = deferred<GoalPage>();
    const gateway: GoalsGateway = {
      ...new InMemoryGoalsGateway(),
      loadPage: vi.fn((input) => input.spaceId === 'space-1' ? first.promise : second.promise),
    } as unknown as GoalsGateway;
    const { result, rerender } = renderHook(
      ({ spaceId }) => useGoals(gateway, spaceId, 'USD', 'all'),
      { initialProps: { spaceId: 'space-1' } },
    );
    rerender({ spaceId: 'space-2' });
    expect(result.current.status).toBe('loading');
    second.resolve({ ...emptyGoalPage, asOf: 'space-2-asof' });
    await waitFor(() => expect(result.current.page.asOf).toBe('space-2-asof'));
    first.resolve({ ...emptyGoalPage, asOf: 'space-1-asof' });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.page.asOf).toBe('space-2-asof');
  });

  it('surfaces a load error and recovers via refresh', async () => {
    const gateway = new InMemoryGoalsGateway();
    gateway.error = new Error('connection failure');
    const { result } = renderHook(() => useGoals(gateway, 'space-1', 'USD', 'all'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    gateway.error = null;
    gateway.page = coreGoalPageFixture;
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('clears data and calls onSpaceUnavailable when membership is lost', async () => {
    const gateway = new InMemoryGoalsGateway();
    gateway.error = Object.assign(new Error('planning_not_authorized'), { code: '42501' });
    const onSpaceUnavailable = vi.fn();
    const { result } = renderHook(() => useGoals(gateway, 'space-1', 'USD', 'all', onSpaceUnavailable));
    await waitFor(() => expect(onSpaceUnavailable).toHaveBeenCalledTimes(1));
    expect(result.current.page.rows).toHaveLength(0);
  });

  it('create saves with a generated request id and refreshes to ready', async () => {
    const gateway = new InMemoryGoalsGateway();
    const { result } = renderHook(() => useGoals(gateway, 'space-1', 'USD', 'all', undefined, () => 'req-fixed'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    gateway.page = coreGoalPageFixture;
    await act(async () => {
      const outcome = await result.current.create(createDraft);
      expect(outcome).toMatchObject({ status: 'success', reconciled: false });
    });
    expect(gateway.calls.filter((call) => call.name === 'create')).toHaveLength(1);
    expect((gateway.calls.find((call) => call.name === 'create')!.input as { requestId: string }).requestId).toBe('req-fixed');
    expect(result.current.status).toBe('ready');
    expect(result.current.page.rows).toHaveLength(1);
  });

  it('disables double-submit: a second call while saving is rejected, not double-posted', async () => {
    const first = deferred<{ goalId: string; revisionId: string }>();
    const gateway: GoalsGateway = {
      ...new InMemoryGoalsGateway(),
      create: vi.fn(() => first.promise),
      loadPage: vi.fn(async () => coreGoalPageFixture),
    } as unknown as GoalsGateway;
    const { result } = renderHook(() => useGoals(gateway, 'space-1', 'USD', 'all'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let firstOutcome: Promise<unknown>;
    act(() => { firstOutcome = result.current.create(createDraft); });
    await waitFor(() => expect(result.current.status).toBe('saving'));
    await expect(result.current.create(createDraft)).rejects.toThrow();
    first.resolve({ goalId: createDraft.goalId, revisionId: '1' });
    await act(async () => { await firstOutcome; });
    expect(gateway.create).toHaveBeenCalledTimes(1);
  });

  it('moves to accepted-refresh-pending when the command succeeds but the follow-up read fails, without reposting on refresh', async () => {
    const gateway = new InMemoryGoalsGateway();
    let failNextLoad = false;
    gateway.loadPage = vi.fn(async (input, signal) => {
      if (failNextLoad) { failNextLoad = false; throw new Error('read failed after commit'); }
      return InMemoryGoalsGateway.prototype.loadPage.call(gateway, input, signal);
    });
    const { result } = renderHook(() => useGoals(gateway, 'space-1', 'USD', 'all'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    failNextLoad = true;
    await act(async () => {
      const outcome = await result.current.create(createDraft);
      expect(outcome).toMatchObject({ status: 'refresh-required', reconciled: false });
    });
    expect(result.current.status).toBe('accepted-refresh-pending');
    gateway.page = coreGoalPageFixture;
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(gateway.calls.filter((call) => call.name === 'create')).toHaveLength(1);
  });

  it('goes ambiguous on a timeout-shaped failure when the receipt lookup finds nothing, then allows an explicit identical retry', async () => {
    const gateway = new InMemoryGoalsGateway();
    let attempt = 0;
    gateway.create = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw Object.assign(new Error('AbortError: timed out'), {});
      return { goalId: createDraft.goalId, revisionId: '1' };
    });
    const { result } = renderHook(() => useGoals(gateway, 'space-1', 'USD', 'all', undefined, () => 'req-fixed'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      const outcome = await result.current.create(createDraft);
      expect(outcome).toMatchObject({ status: 'ambiguous', reconciled: false });
    });
    expect(result.current.status).toBe('ambiguous');
    expect(result.current.ambiguous).toEqual({ kind: 'create', requestId: 'req-fixed' });
    gateway.page = coreGoalPageFixture;
    await act(async () => {
      const outcome = await result.current.retryAmbiguous();
      expect(outcome).toMatchObject({ status: 'success', reconciled: false });
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.ambiguous).toBeNull();
    expect(gateway.create).toHaveBeenCalledTimes(2);
    const calls = (gateway.create as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as { requestId: string });
    expect(calls[0]!.requestId).toBe(calls[1]!.requestId);
  });

  it('treats an ambiguous command as already accepted once its receipt is visible, without retrying it', async () => {
    const gateway = new InMemoryGoalsGateway();
    gateway.create = vi.fn(async () => { throw new Error('network timeout'); });
    gateway.findCommand = vi.fn(async () => ({ command: 'create_goal_plan', sequenceId: '1', result: { goalId: createDraft.goalId, revisionId: '1' } }));
    const { result } = renderHook(() => useGoals(gateway, 'space-1', 'USD', 'all'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      const outcome = await result.current.create(createDraft);
      expect(outcome).toMatchObject({ status: 'success', reconciled: true });
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.ambiguous).toBeNull();
    expect(gateway.create).toHaveBeenCalledTimes(1);
  });

  it('disables starting a fresh command while ambiguous, until explicitly cleared or reconciled', async () => {
    const gateway = new InMemoryGoalsGateway();
    gateway.create = vi.fn(async () => { throw new Error('connection timeout'); });
    const { result } = renderHook(() => useGoals(gateway, 'space-1', 'USD', 'all'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => { await result.current.create(createDraft); });
    expect(result.current.status).toBe('ambiguous');
    await expect(result.current.create(createDraft)).rejects.toThrow();
    act(() => { result.current.clearAmbiguous(); });
    expect(result.current.ambiguous).toBeNull();
    gateway.create = vi.fn(async () => ({ goalId: createDraft.goalId, revisionId: '1' }));
    await act(async () => {
      const outcome = await result.current.create(createDraft);
      expect(outcome.status).toBe('success');
    });
  });

  it('each mutation kind reaches the gateway with a freshly generated request id', async () => {
    const gateway = new InMemoryGoalsGateway();
    const { result } = renderHook(() => useGoals(gateway, 'space-1', 'USD', 'all'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => { await result.current.revise({
      goalId: createDraft.goalId, expectedRevisionId: '1', definition: createDraft.definition, milestones: [], state: 'active',
    }); });
    await act(async () => { await result.current.reserveOrRelease({
      goalId: createDraft.goalId, action: 'reserve', amountMinor: '1000', expectedHead: 'a'.repeat(64), acceptUnderfunded: true,
    }); });
    await act(async () => { await result.current.move({
      fromGoalId: createDraft.goalId, toGoalId: createDraft.goalId, amountMinor: '1000',
      expectedFromHead: 'a'.repeat(64), expectedToHead: 'b'.repeat(64), acceptUnderfunded: true,
    }); });
    await act(async () => { await result.current.reverse({ eventId: '1', expectedHeads: [{ goalId: createDraft.goalId, head: 'a'.repeat(64) }] }); });
    await act(async () => { await result.current.linkPurchase({
      expenseEventId: createDraft.goalId, lines: [{ goalId: createDraft.goalId, amountMinor: '1000', expectedHead: 'a'.repeat(64) }],
    }); });
    await act(async () => { await result.current.setMonthlyTarget({
      goalId: createDraft.goalId, month: '2026-09-01', amountMinor: '1000', expectedRevisionId: null,
    }); });
    await act(async () => { await result.current.setMilestone({
      milestoneId: createDraft.goalId, action: 'complete', expectedEventId: null,
    }); });

    const names = gateway.calls.map((call) => call.name);
    for (const expected of ['revise', 'reserveOrRelease', 'move', 'reverse', 'linkPurchase', 'setMonthlyTarget', 'setMilestone']) {
      expect(names).toContain(expected);
    }
    const requestIds = new Set(gateway.calls.map((call) => (call.input as { requestId?: string }).requestId).filter(Boolean));
    expect(requestIds.size).toBe(names.filter((name) => name !== 'loadPage').length);
  });

  it('loadDetail/loadHistory/loadMore fill in the current space (and currency/stateFilter for loadMore)', async () => {
    const gateway = new InMemoryGoalsGateway();
    const { result } = renderHook(() => useGoals(gateway, 'space-1', 'USD', 'all'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await result.current.loadDetail({ goalId: createDraft.goalId, month: '2026-09-01' });
    expect(gateway.calls.find((entry) => entry.name === 'loadDetail')!.input).toMatchObject({ spaceId: 'space-1', goalId: createDraft.goalId });
    await result.current.loadHistory({ goalId: createDraft.goalId, beforeCreatedAt: null, beforeSourceKind: null, beforeSourceId: null, limit: 25 });
    expect(gateway.calls.find((entry) => entry.name === 'loadHistory')!.input).toMatchObject({ spaceId: 'space-1', goalId: createDraft.goalId });
    await result.current.loadMore({ afterCreatedAt: '2026-09-14T00:00:00Z', afterId: createDraft.goalId });
    const moreCall = gateway.calls.filter((entry) => entry.name === 'loadPage').at(-1)!;
    expect(moreCall.input).toMatchObject({ spaceId: 'space-1', currency: 'USD', stateFilter: 'all', afterCreatedAt: '2026-09-14T00:00:00Z' });
  });
});

// The literal shared 15-second transport timeout is proved once, in isolation,
// by planning-shared/rpc.test.ts (no React involved) and re-affirmed by the
// allocation gateway's own hook suite. Re-driving a real AbortController-based
// timeout through renderHook + vi.useFakeTimers reproducibly crashed the test
// worker with an out-of-memory abort in this sandbox during task 07 -- a
// known-hazardous combination of jsdom's AbortSignal event dispatch, fake
// timers, and React's effect scheduler, not a defect in the hook itself. The
// ambiguous/retry state machine this would have re-proven is already covered
// end-to-end above using a synthetic timeout-shaped rejection.
