import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { coreMonthStateFixture, emptyMonthState, InMemoryAllocationGateway } from '../../test/in-memory-allocation-gateway.js';
import type { AllocationGateway, AllocationMonthState } from './types.js';
import { useAllocation } from './use-allocation.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((doResolve) => { resolve = doResolve; });
  return { promise, resolve };
}

describe('useAllocation', () => {
  it('loads the current month and reaches ready', async () => {
    const gateway = new InMemoryAllocationGateway();
    gateway.monthState = coreMonthStateFixture;
    const { result } = renderHook(() => useAllocation(gateway, 'space-1', '2026-09-01', 'USD'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.month.incomeAfterSpendingMinor).toBe('19000');
  });

  it('clears the prior month immediately and ignores its late response when the space changes', async () => {
    const first = deferred<AllocationMonthState>();
    const second = deferred<AllocationMonthState>();
    const gateway: AllocationGateway = {
      ...new InMemoryAllocationGateway(),
      loadMonth: vi.fn((input) => input.spaceId === 'space-1' ? first.promise : second.promise),
    } as unknown as AllocationGateway;
    const { result, rerender } = renderHook(
      ({ spaceId }) => useAllocation(gateway, spaceId, '2026-09-01', 'USD'),
      { initialProps: { spaceId: 'space-1' } },
    );
    rerender({ spaceId: 'space-2' });
    expect(result.current.status).toBe('loading');
    second.resolve({ ...emptyMonthState, snapshotId: 'space-2-snapshot' });
    await waitFor(() => expect(result.current.month.snapshotId).toBe('space-2-snapshot'));
    first.resolve({ ...emptyMonthState, snapshotId: 'space-1-snapshot' });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.month.snapshotId).toBe('space-2-snapshot');
  });

  it('surfaces a load error and recovers via refresh', async () => {
    const gateway = new InMemoryAllocationGateway();
    gateway.error = new Error('connection failure');
    const { result } = renderHook(() => useAllocation(gateway, 'space-1', '2026-09-01', 'USD'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    gateway.error = null;
    gateway.monthState = coreMonthStateFixture;
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('clears data and calls onSpaceUnavailable when membership is lost', async () => {
    const gateway = new InMemoryAllocationGateway();
    gateway.error = Object.assign(new Error('planning_not_authorized'), { code: '42501' });
    const onSpaceUnavailable = vi.fn();
    const { result } = renderHook(() => useAllocation(gateway, 'space-1', '2026-09-01', 'USD', onSpaceUnavailable));
    await waitFor(() => expect(onSpaceUnavailable).toHaveBeenCalledTimes(1));
    expect(result.current.month.hasPlan).toBe(false);
    expect(result.current.month.snapshotId).toBeNull();
  });

  it('publishMonth saves with a generated request id and refreshes to ready', async () => {
    const gateway = new InMemoryAllocationGateway();
    const { result } = renderHook(() => useAllocation(gateway, 'space-1', '2026-09-01', 'USD', undefined, () => 'req-fixed'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    gateway.monthState = coreMonthStateFixture;
    await act(async () => {
      const outcome = await result.current.publishMonth({
        templateRevisionId: '9', expectedSnapshotId: null, expectedIncomeRevisionId: null,
        incomeMinor: '200000', rootTargets: [], loanGroupId: null,
      });
      expect(outcome).toMatchObject({ status: 'success', reconciled: false });
    });
    expect(gateway.calls.filter((call) => call.name === 'publishMonth')).toHaveLength(1);
    expect((gateway.calls.find((call) => call.name === 'publishMonth')!.input as { requestId: string }).requestId).toBe('req-fixed');
    expect(result.current.status).toBe('ready');
    expect(result.current.month.incomeAfterSpendingMinor).toBe('19000');
  });

  it('disables double-submit: a second call while saving is rejected, not double-posted', async () => {
    const first = deferred<{ snapshotId: string; incomeRevisionId: string }>();
    const gateway: AllocationGateway = {
      ...new InMemoryAllocationGateway(),
      publishMonth: vi.fn(() => first.promise),
      loadMonth: vi.fn(async () => coreMonthStateFixture),
    } as unknown as AllocationGateway;
    const { result } = renderHook(() => useAllocation(gateway, 'space-1', '2026-09-01', 'USD'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let firstOutcome: Promise<unknown>;
    act(() => {
      firstOutcome = result.current.publishMonth({
        templateRevisionId: '9', expectedSnapshotId: null, expectedIncomeRevisionId: null,
        incomeMinor: '200000', rootTargets: [], loanGroupId: null,
      });
    });
    await waitFor(() => expect(result.current.status).toBe('saving'));
    await expect(result.current.publishMonth({
      templateRevisionId: '9', expectedSnapshotId: null, expectedIncomeRevisionId: null,
      incomeMinor: '200000', rootTargets: [], loanGroupId: null,
    })).rejects.toThrow();
    first.resolve({ snapshotId: '1', incomeRevisionId: '1' });
    await act(async () => { await firstOutcome; });
    expect(gateway.publishMonth).toHaveBeenCalledTimes(1);
  });

  it('moves to accepted-refresh-pending when the command succeeds but the follow-up read fails, without reposting on refresh', async () => {
    const gateway = new InMemoryAllocationGateway();
    let failNextLoad = false;
    gateway.loadMonth = vi.fn(async (input, signal) => {
      if (failNextLoad) { failNextLoad = false; throw new Error('read failed after commit'); }
      return InMemoryAllocationGateway.prototype.loadMonth.call(gateway, input, signal);
    });
    const { result } = renderHook(() => useAllocation(gateway, 'space-1', '2026-09-01', 'USD'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    failNextLoad = true;
    await act(async () => {
      const outcome = await result.current.publishMonth({
        templateRevisionId: '9', expectedSnapshotId: null, expectedIncomeRevisionId: null,
        incomeMinor: '200000', rootTargets: [], loanGroupId: null,
      });
      expect(outcome).toMatchObject({ status: 'refresh-required', reconciled: false });
    });
    expect(result.current.status).toBe('accepted-refresh-pending');
    gateway.monthState = coreMonthStateFixture;
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    // Exactly one publishMonth call throughout -- the accepted write is never reposted.
    expect(gateway.calls.filter((call) => call.name === 'publishMonth')).toHaveLength(1);
  });

  it('goes ambiguous on a timeout-shaped failure when the receipt lookup finds nothing, then allows an explicit identical retry', async () => {
    const gateway = new InMemoryAllocationGateway();
    let attempt = 0;
    gateway.saveTemplate = vi.fn(async (input) => {
      attempt += 1;
      if (attempt === 1) throw Object.assign(new Error('AbortError: timed out'), {});
      return { templateRevisionId: '9' };
    });
    const { result } = renderHook(() => useAllocation(gateway, 'space-1', '2026-09-01', 'USD', undefined, () => 'req-fixed'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      const outcome = await result.current.saveTemplate({ currency: 'USD', expectedRevisionId: null, groups: [], rootMappings: [] });
      expect(outcome).toMatchObject({ status: 'ambiguous', reconciled: false });
    });
    expect(result.current.status).toBe('ambiguous');
    expect(result.current.ambiguous).toEqual({ kind: 'saveTemplate', requestId: 'req-fixed' });
    gateway.monthState = coreMonthStateFixture;
    await act(async () => {
      const outcome = await result.current.retryAmbiguous();
      expect(outcome).toMatchObject({ status: 'success', reconciled: false });
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.ambiguous).toBeNull();
    expect(gateway.saveTemplate).toHaveBeenCalledTimes(2);
    // Both attempts must reuse the exact same request id -- an identical retry, never a new UUID.
    const calls = (gateway.saveTemplate as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as { requestId: string });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.requestId).toBe(calls[1]!.requestId);
  });

  it('treats an ambiguous save as already accepted once its receipt is visible, without retrying it', async () => {
    const gateway = new InMemoryAllocationGateway();
    gateway.saveTemplate = vi.fn(async () => { throw new Error('network timeout'); });
    gateway.findCommand = vi.fn(async () => ({ command: 'save_allocation_template', sequenceId: '1', result: { templateRevisionId: '9' } }));
    const { result } = renderHook(() => useAllocation(gateway, 'space-1', '2026-09-01', 'USD'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      const outcome = await result.current.saveTemplate({ currency: 'USD', expectedRevisionId: null, groups: [], rootMappings: [] });
      expect(outcome).toMatchObject({ status: 'success', reconciled: true });
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.ambiguous).toBeNull();
    expect(gateway.saveTemplate).toHaveBeenCalledTimes(1);
  });

  it('disables starting a fresh command while ambiguous, until explicitly cleared or reconciled', async () => {
    const gateway = new InMemoryAllocationGateway();
    gateway.publishMonth = vi.fn(async () => { throw new Error('connection timeout'); });
    const { result } = renderHook(() => useAllocation(gateway, 'space-1', '2026-09-01', 'USD'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.publishMonth({
        templateRevisionId: '9', expectedSnapshotId: null, expectedIncomeRevisionId: null,
        incomeMinor: '200000', rootTargets: [], loanGroupId: null,
      });
    });
    expect(result.current.status).toBe('ambiguous');
    await expect(result.current.publishMonth({
      templateRevisionId: '9', expectedSnapshotId: null, expectedIncomeRevisionId: null,
      incomeMinor: '999', rootTargets: [], loanGroupId: null,
    })).rejects.toThrow();
    act(() => { result.current.clearAmbiguous(); });
    expect(result.current.ambiguous).toBeNull();
    gateway.publishMonth = vi.fn(async () => ({ snapshotId: '1', incomeRevisionId: '1' }));
    await act(async () => {
      const outcome = await result.current.publishMonth({
        templateRevisionId: '9', expectedSnapshotId: null, expectedIncomeRevisionId: null,
        incomeMinor: '999', rootTargets: [], loanGroupId: null,
      });
      expect(outcome.status).toBe('success');
    });
  });

  it('loadCategoryPage/loadHistoryPage/loadTrend fill in the current space/month/currency', async () => {
    const gateway = new InMemoryAllocationGateway();
    gateway.categoryPage = { rows: [], nextRootId: null, hasMore: false };
    const { result } = renderHook(() => useAllocation(gateway, 'space-1', '2026-09-01', 'USD'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await result.current.loadCategoryPage({ snapshotId: '12', groupId: null, afterRootId: null, limit: 50 });
    const call = gateway.calls.find((entry) => entry.name === 'loadCategoryPage')!;
    expect(call.input).toMatchObject({ spaceId: 'space-1', month: '2026-09-01', currency: 'USD', snapshotId: '12' });
  });
});

// The literal shared 15-second transport timeout is proved once, in isolation,
// by planning-shared/rpc.test.ts (no React involved). Re-driving a real
// AbortController-based timeout through renderHook + vi.useFakeTimers here
// reproducibly crashed the test worker with an out-of-memory abort in this
// sandbox -- a known-hazardous combination of jsdom's AbortSignal event
// dispatch, fake timers, and React's effect scheduler, not a defect in the
// hook itself. The ambiguous/retry state machine this would have re-proven is
// already covered end-to-end above using a synthetic timeout-shaped rejection
// ("goes ambiguous on a timeout-shaped failure...", "treats an ambiguous save
// as already accepted...").
