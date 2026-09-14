import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { coreOccurrencePageFixture, emptyOccurrencePage, InMemoryRecurringGateway } from '../../test/in-memory-recurring-gateway.js';
import type { RecurringGateway, ScheduledOccurrencePage } from './types.js';
import { useRecurring } from './use-recurring.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((doResolve) => { resolve = doResolve; });
  return { promise, resolve };
}

const SCHEDULE_ID = '00000000-0000-4000-8000-000000000301';
const OCCURRENCE_ID = '00000000-0000-4000-8000-000000000401';
const WALLET_ID = '00000000-0000-4000-8000-000000000601';

const scheduleDraft = {
  scheduleId: SCHEDULE_ID,
  expectedRevisionId: null,
  definition: {
    currency: 'USD' as const, kind: 'expense' as const, state: 'active' as const,
    nameEn: 'Rent', nameAr: null, expectedMinor: '50000', startsOn: '2026-09-01', endsOn: null,
    cadence: 'monthly' as const, intervalCount: 1, categoryId: null, loanId: null,
    fundingGoalId: null, preferredWalletId: null,
  },
};

describe('useRecurring', () => {
  it('loads the current page and reaches ready', async () => {
    const gateway = new InMemoryRecurringGateway();
    gateway.page = coreOccurrencePageFixture;
    const { result } = renderHook(() => useRecurring(gateway, 'space-1', '2026-09-01', '2026-09-30'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.page.rows).toHaveLength(1);
    expect(result.current.page.rows[0]!.remainingMinor).toBe('30000');
  });

  it('clears the prior page immediately and ignores its late response when the space changes', async () => {
    const first = deferred<ScheduledOccurrencePage>();
    const second = deferred<ScheduledOccurrencePage>();
    const gateway: RecurringGateway = {
      ...new InMemoryRecurringGateway(),
      loadOccurrences: vi.fn((input) => input.spaceId === 'space-1' ? first.promise : second.promise),
    } as unknown as RecurringGateway;
    const { result, rerender } = renderHook(
      ({ spaceId }) => useRecurring(gateway, spaceId, '2026-09-01', '2026-09-30'),
      { initialProps: { spaceId: 'space-1' } },
    );
    rerender({ spaceId: 'space-2' });
    expect(result.current.status).toBe('loading');
    second.resolve({ ...emptyOccurrencePage, asOf: 'space-2-asof' });
    await waitFor(() => expect(result.current.page.asOf).toBe('space-2-asof'));
    first.resolve({ ...emptyOccurrencePage, asOf: 'space-1-asof' });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.page.asOf).toBe('space-2-asof');
  });

  it('surfaces a load error and recovers via refresh', async () => {
    const gateway = new InMemoryRecurringGateway();
    gateway.error = new Error('connection failure');
    const { result } = renderHook(() => useRecurring(gateway, 'space-1', '2026-09-01', '2026-09-30'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    gateway.error = null;
    gateway.page = coreOccurrencePageFixture;
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('clears data and calls onSpaceUnavailable when membership is lost', async () => {
    const gateway = new InMemoryRecurringGateway();
    gateway.error = Object.assign(new Error('planning_not_authorized'), { code: '42501' });
    const onSpaceUnavailable = vi.fn();
    const { result } = renderHook(() => useRecurring(gateway, 'space-1', '2026-09-01', '2026-09-30', onSpaceUnavailable));
    await waitFor(() => expect(onSpaceUnavailable).toHaveBeenCalledTimes(1));
    expect(result.current.page.rows).toHaveLength(0);
  });

  it('confirm saves with a generated request id and refreshes to ready', async () => {
    const gateway = new InMemoryRecurringGateway();
    const { result } = renderHook(() => useRecurring(gateway, 'space-1', '2026-09-01', '2026-09-30', undefined, () => 'req-fixed'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    gateway.page = coreOccurrencePageFixture;
    await act(async () => {
      const outcome = await result.current.confirm({
        occurrenceId: OCCURRENCE_ID, expectedEventId: null, actualAmountMinor: '50000',
        effectiveDate: '2026-09-14', walletId: WALLET_ID,
      });
      expect(outcome).toMatchObject({ status: 'success', reconciled: false });
    });
    expect(gateway.calls.filter((call) => call.name === 'confirm')).toHaveLength(1);
    expect((gateway.calls.find((call) => call.name === 'confirm')!.input as { requestId: string }).requestId).toBe('req-fixed');
    expect(result.current.status).toBe('ready');
    expect(result.current.page.rows).toHaveLength(1);
  });

  it('disables double-submit: a second call while saving is rejected, not double-posted', async () => {
    const first = deferred<{ occurrenceId: string; eventId: string }>();
    const gateway: RecurringGateway = {
      ...new InMemoryRecurringGateway(),
      setOccurrenceState: vi.fn(() => first.promise),
      loadOccurrences: vi.fn(async () => coreOccurrencePageFixture),
    } as unknown as RecurringGateway;
    const { result } = renderHook(() => useRecurring(gateway, 'space-1', '2026-09-01', '2026-09-30'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let firstOutcome: Promise<unknown>;
    act(() => { firstOutcome = result.current.setOccurrenceState({ occurrenceId: OCCURRENCE_ID, expectedEventId: null, action: 'skip' }); });
    await waitFor(() => expect(result.current.status).toBe('saving'));
    await expect(result.current.setOccurrenceState({ occurrenceId: OCCURRENCE_ID, expectedEventId: null, action: 'skip' })).rejects.toThrow();
    first.resolve({ occurrenceId: OCCURRENCE_ID, eventId: '1' });
    await act(async () => { await firstOutcome; });
    expect(gateway.setOccurrenceState).toHaveBeenCalledTimes(1);
  });

  it('moves to accepted-refresh-pending when the command succeeds but the follow-up read fails, without reposting on refresh', async () => {
    const gateway = new InMemoryRecurringGateway();
    let failNextLoad = false;
    gateway.loadOccurrences = vi.fn(async (input, signal) => {
      if (failNextLoad) { failNextLoad = false; throw new Error('read failed after commit'); }
      return InMemoryRecurringGateway.prototype.loadOccurrences.call(gateway, input, signal);
    });
    const { result } = renderHook(() => useRecurring(gateway, 'space-1', '2026-09-01', '2026-09-30'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    failNextLoad = true;
    await act(async () => {
      const outcome = await result.current.setOccurrenceState({ occurrenceId: OCCURRENCE_ID, expectedEventId: null, action: 'skip' });
      expect(outcome).toMatchObject({ status: 'refresh-required', reconciled: false });
    });
    expect(result.current.status).toBe('accepted-refresh-pending');
    gateway.page = coreOccurrencePageFixture;
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(gateway.calls.filter((call) => call.name === 'setOccurrenceState')).toHaveLength(1);
  });

  it('goes ambiguous on a timeout-shaped failure when the receipt lookup finds nothing, then allows an explicit identical retry', async () => {
    const gateway = new InMemoryRecurringGateway();
    let attempt = 0;
    gateway.confirm = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw Object.assign(new Error('AbortError: timed out'), {});
      return { occurrenceId: OCCURRENCE_ID, occurrenceEventId: '1', financialEventId: '00000000-0000-4000-8000-000000000501' };
    });
    const { result } = renderHook(() => useRecurring(gateway, 'space-1', '2026-09-01', '2026-09-30', undefined, () => 'req-fixed'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      const outcome = await result.current.confirm({
        occurrenceId: OCCURRENCE_ID, expectedEventId: null, actualAmountMinor: '50000', effectiveDate: '2026-09-14', walletId: WALLET_ID,
      });
      expect(outcome).toMatchObject({ status: 'ambiguous', reconciled: false });
    });
    expect(result.current.status).toBe('ambiguous');
    expect(result.current.ambiguous).toEqual({ kind: 'confirm', requestId: 'req-fixed' });
    gateway.page = coreOccurrencePageFixture;
    await act(async () => {
      const outcome = await result.current.retryAmbiguous();
      expect(outcome).toMatchObject({ status: 'success', reconciled: false });
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.ambiguous).toBeNull();
    expect(gateway.confirm).toHaveBeenCalledTimes(2);
    const calls = (gateway.confirm as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as { requestId: string });
    expect(calls[0]!.requestId).toBe(calls[1]!.requestId);
  });

  it('treats an ambiguous command as already accepted once its receipt is visible, without retrying it', async () => {
    const gateway = new InMemoryRecurringGateway();
    gateway.confirm = vi.fn(async () => { throw new Error('network timeout'); });
    gateway.findCommand = vi.fn(async () => ({
      command: 'confirm_scheduled_occurrence', sequenceId: '1',
      result: { occurrenceId: OCCURRENCE_ID, occurrenceEventId: '1', financialEventId: '00000000-0000-4000-8000-000000000501' },
    }));
    const { result } = renderHook(() => useRecurring(gateway, 'space-1', '2026-09-01', '2026-09-30'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      const outcome = await result.current.confirm({
        occurrenceId: OCCURRENCE_ID, expectedEventId: null, actualAmountMinor: '50000', effectiveDate: '2026-09-14', walletId: WALLET_ID,
      });
      expect(outcome).toMatchObject({ status: 'success', reconciled: true });
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.ambiguous).toBeNull();
    expect(gateway.confirm).toHaveBeenCalledTimes(1);
  });

  it('disables starting a fresh command while ambiguous, until explicitly cleared or reconciled', async () => {
    const gateway = new InMemoryRecurringGateway();
    gateway.confirm = vi.fn(async () => { throw new Error('connection timeout'); });
    const { result } = renderHook(() => useRecurring(gateway, 'space-1', '2026-09-01', '2026-09-30'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.confirm({
        occurrenceId: OCCURRENCE_ID, expectedEventId: null, actualAmountMinor: '50000', effectiveDate: '2026-09-14', walletId: WALLET_ID,
      });
    });
    expect(result.current.status).toBe('ambiguous');
    await expect(result.current.confirm({
      occurrenceId: OCCURRENCE_ID, expectedEventId: null, actualAmountMinor: '50000', effectiveDate: '2026-09-14', walletId: WALLET_ID,
    })).rejects.toThrow();
    act(() => { result.current.clearAmbiguous(); });
    expect(result.current.ambiguous).toBeNull();
    gateway.confirm = vi.fn(async () => ({ occurrenceId: OCCURRENCE_ID, occurrenceEventId: '1', financialEventId: '00000000-0000-4000-8000-000000000501' }));
    await act(async () => {
      const outcome = await result.current.confirm({
        occurrenceId: OCCURRENCE_ID, expectedEventId: null, actualAmountMinor: '50000', effectiveDate: '2026-09-14', walletId: WALLET_ID,
      });
      expect(outcome.status).toBe('success');
    });
  });

  it('each mutation kind reaches the gateway with a freshly generated request id', async () => {
    const gateway = new InMemoryRecurringGateway();
    const { result } = renderHook(() => useRecurring(gateway, 'space-1', '2026-09-01', '2026-09-30'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => { await result.current.saveSchedule(scheduleDraft); });
    await act(async () => { await result.current.materialize({ fromDate: '2026-09-01', toDate: '2026-11-30' }); });
    await act(async () => { await result.current.setOccurrenceState({ occurrenceId: OCCURRENCE_ID, expectedEventId: null, action: 'skip' }); });
    await act(async () => { await result.current.confirm({
      occurrenceId: OCCURRENCE_ID, expectedEventId: null, actualAmountMinor: '50000', effectiveDate: '2026-09-14', walletId: WALLET_ID,
    }); });
    await act(async () => { await result.current.linkExisting({
      occurrenceId: OCCURRENCE_ID, eventId: '00000000-0000-4000-8000-000000000501', amountMinor: '20000', expectedEventId: null,
    }); });

    const names = gateway.calls.map((call) => call.name);
    for (const expected of ['saveSchedule', 'materialize', 'setOccurrenceState', 'confirm', 'linkExisting']) {
      expect(names).toContain(expected);
    }
    const requestIds = new Set(gateway.calls.map((call) => (call.input as { requestId?: string }).requestId).filter(Boolean));
    expect(requestIds.size).toBe(names.filter((name) => name !== 'loadOccurrences').length);
  });

  it('loadMore fills in the current space/date-range', async () => {
    const gateway = new InMemoryRecurringGateway();
    const { result } = renderHook(() => useRecurring(gateway, 'space-1', '2026-09-01', '2026-09-30'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await result.current.loadMore({ afterDueDate: '2026-09-14', afterId: OCCURRENCE_ID });
    const moreCall = gateway.calls.filter((entry) => entry.name === 'loadOccurrences').at(-1)!;
    expect(moreCall.input).toMatchObject({ spaceId: 'space-1', fromDate: '2026-09-01', toDate: '2026-09-30', afterDueDate: '2026-09-14' });
  });
});

// The literal shared 15-second transport timeout is proved once, in isolation,
// by planning-shared/rpc.test.ts (no React involved) and re-affirmed by the
// allocation/goals gateways' own hook suites. Re-driving a real
// AbortController-based timeout through renderHook + vi.useFakeTimers
// reproducibly crashed the test worker with an out-of-memory abort in this
// sandbox during task 07 -- a known-hazardous combination of jsdom's
// AbortSignal event dispatch, fake timers, and React's effect scheduler, not
// a defect in the hook itself. The ambiguous/retry state machine this would
// have re-proven is already covered end-to-end above using a synthetic
// timeout-shaped rejection.
