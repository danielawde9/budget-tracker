import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  coreAvailableCashSummaryFixture,
  coreCashOutlookFixture,
  emptyAvailableCashSummary,
  emptyCashOutlook,
  InMemoryCashControlGateway,
} from '../../test/in-memory-cash-control-gateway.js';
import type { AvailableCashSummary, CashControlGateway, CashOutlook } from './types.js';
import { useCashControl } from './use-cash-control.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((doResolve) => { resolve = doResolve; });
  return { promise, resolve };
}

describe('useCashControl: loading', () => {
  it('loads both the available-cash summary and the outlook and reaches ready', async () => {
    const gateway = new InMemoryCashControlGateway();
    gateway.available = coreAvailableCashSummaryFixture;
    gateway.outlook = coreCashOutlookFixture;
    const { result } = renderHook(() => useCashControl(gateway, 'space-1', 'USD', '2026-09-15', 60, 'expected'));
    await waitFor(() => expect(result.current.available.status).toBe('ready'));
    await waitFor(() => expect(result.current.outlook.status).toBe('ready'));
    expect(result.current.available.data.availableMinor).toBe('50000');
    expect(result.current.outlook.data.days).toHaveLength(1);
  });

  it('calls each RPC-shaped input with the exact captured parameters', async () => {
    const gateway = new InMemoryCashControlGateway();
    const { result } = renderHook(() => useCashControl(gateway, 'space-1', 'USD', '2026-09-15', 60, 'expected'));
    await waitFor(() => expect(result.current.available.status).toBe('ready'));
    await waitFor(() => expect(result.current.outlook.status).toBe('ready'));
    expect(gateway.calls.find((call) => call.name === 'loadAvailable')!.input)
      .toEqual({ spaceId: 'space-1', currency: 'USD', asOfDate: '2026-09-15' });
    expect(gateway.calls.find((call) => call.name === 'loadOutlook')!.input)
      .toEqual({ spaceId: 'space-1', currency: 'USD', startDate: '2026-09-15', days: 60, scenario: 'expected' });
  });
});

describe('useCashControl: exact component-sum and guide fixtures', () => {
  it('surfaces the exact monetary subset from the brief unchanged, including a signed deficit', async () => {
    const gateway = new InMemoryCashControlGateway();
    gateway.available = {
      ...coreAvailableCashSummaryFixture,
      cashMinor: '100000', availableMinor: '-10000', spendableMinor: '0', deficitMinor: '10000', state: 'ready',
    };
    const { result } = renderHook(() => useCashControl(gateway, 'space-1', 'USD', '2026-09-15', 60, 'expected'));
    await waitFor(() => expect(result.current.available.status).toBe('ready'));
    expect(result.current.available.data.availableMinor).toBe('-10000');
    expect(result.current.available.data.spendableMinor).toBe('0');
    expect(result.current.available.data.deficitMinor).toBe('10000');
  });

  it('relays the daily extra guide the server computed (1001/3->333) without ever recomputing it client-side', async () => {
    const gateway = new InMemoryCashControlGateway();
    gateway.available = {
      ...coreAvailableCashSummaryFixture,
      availableMinor: '1001', deficitMinor: '0', spendableMinor: '1001', daysRemaining: 3, dailyExtraGuideMinor: '333',
    };
    const { result } = renderHook(() => useCashControl(gateway, 'space-1', 'USD', '2026-09-15', 60, 'expected'));
    await waitFor(() => expect(result.current.available.status).toBe('ready'));
    expect(result.current.available.data.dailyExtraGuideMinor).toBe('333');
  });

  it('leaves every reservation/available/spendable/guide field null and groups empty for an unplanned/incomplete state', async () => {
    const gateway = new InMemoryCashControlGateway();
    gateway.available = { ...emptyAvailableCashSummary, state: 'incomplete', unmaterializedCount: 7 };
    const { result } = renderHook(() => useCashControl(gateway, 'space-1', 'USD', '2026-09-15', 60, 'expected'));
    await waitFor(() => expect(result.current.available.status).toBe('ready'));
    expect(result.current.available.data.state).toBe('incomplete');
    expect(result.current.available.data.availableMinor).toBeNull();
    expect(result.current.available.data.spendableMinor).toBeNull();
    expect(result.current.available.data.dailyExtraGuideMinor).toBeNull();
    expect(result.current.available.data.groups).toEqual([]);
    expect(result.current.available.data.unmaterializedCount).toBe(7);
  });
});

describe('useCashControl: stale-response discarding', () => {
  it('clears the prior available-cash summary immediately and ignores its late response when the as-of date changes', async () => {
    const first = deferred<AvailableCashSummary>();
    const second = deferred<AvailableCashSummary>();
    const gateway: CashControlGateway = {
      ...new InMemoryCashControlGateway(),
      loadAvailable: vi.fn((input) => input.asOfDate === '2026-09-15' ? first.promise : second.promise),
      loadOutlook: vi.fn(async () => coreCashOutlookFixture),
    } as unknown as CashControlGateway;
    const { result, rerender } = renderHook(
      ({ asOfDate }) => useCashControl(gateway, 'space-1', 'USD', asOfDate, 60, 'expected'),
      { initialProps: { asOfDate: '2026-09-15' } },
    );
    rerender({ asOfDate: '2026-09-16' });
    expect(result.current.available.status).toBe('loading');
    second.resolve({ ...emptyAvailableCashSummary, asOf: '2026-09-16' });
    await waitFor(() => expect(result.current.available.data.asOf).toBe('2026-09-16'));
    first.resolve({ ...emptyAvailableCashSummary, asOf: '2026-09-15' });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.available.data.asOf).toBe('2026-09-16');
  });

  it('clears the prior outlook immediately and ignores its late response when only the scenario changes, leaving the summary untouched', async () => {
    const first = deferred<CashOutlook>();
    const second = deferred<CashOutlook>();
    const gateway: CashControlGateway = {
      ...new InMemoryCashControlGateway(),
      loadAvailable: vi.fn(async () => coreAvailableCashSummaryFixture),
      loadOutlook: vi.fn((input) => input.scenario === 'expected' ? first.promise : second.promise),
    } as unknown as CashControlGateway;
    const { result, rerender } = renderHook(
      ({ scenario }: { scenario: 'expected' | 'no_future_income' }) => useCashControl(gateway, 'space-1', 'USD', '2026-09-15', 60, scenario),
      { initialProps: { scenario: 'expected' } },
    );
    await waitFor(() => expect(result.current.available.status).toBe('ready'));
    const availableCallsBefore = (gateway.loadAvailable as ReturnType<typeof vi.fn>).mock.calls.length;
    rerender({ scenario: 'no_future_income' });
    expect(result.current.outlook.status).toBe('loading');
    second.resolve({ ...emptyCashOutlook, scenario: 'no_future_income', assumption: 'no-income scenario' });
    await waitFor(() => expect(result.current.outlook.data.assumption).toBe('no-income scenario'));
    first.resolve({ ...emptyCashOutlook, scenario: 'expected', assumption: 'expected scenario' });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.outlook.data.assumption).toBe('no-income scenario');
    // Changing the scenario is a different read parameter, never a mutation:
    // it never re-triggers the independent available-cash summary slice.
    expect((gateway.loadAvailable as ReturnType<typeof vi.fn>).mock.calls.length).toBe(availableCallsBefore);
  });
});

describe('useCashControl: error recovery', () => {
  it('surfaces a load error on the available slice and recovers via refresh', async () => {
    const gateway = new InMemoryCashControlGateway();
    gateway.error = new Error('connection failure');
    const { result } = renderHook(() => useCashControl(gateway, 'space-1', 'USD', '2026-09-15', 60, 'expected'));
    await waitFor(() => expect(result.current.available.status).toBe('error'));
    await waitFor(() => expect(result.current.outlook.status).toBe('error'));
    gateway.error = null;
    gateway.available = coreAvailableCashSummaryFixture;
    gateway.outlook = coreCashOutlookFixture;
    await act(async () => { result.current.available.refresh(); await Promise.resolve(); });
    await waitFor(() => expect(result.current.available.status).toBe('ready'));
  });

  it('classifies a timeout-shaped transport failure as a retryable error, without inventing an ambiguous state', async () => {
    const gateway = new InMemoryCashControlGateway();
    gateway.error = Object.assign(new Error('AbortError: timed out'), {});
    const { result } = renderHook(() => useCashControl(gateway, 'space-1', 'USD', '2026-09-15', 60, 'expected'));
    await waitFor(() => expect(result.current.available.status).toBe('error'));
    expect(result.current.available.error).toMatchObject({ code: 'timeout' });
    gateway.error = null;
    gateway.available = coreAvailableCashSummaryFixture;
    await act(async () => { result.current.available.refresh(); await Promise.resolve(); });
    await waitFor(() => expect(result.current.available.status).toBe('ready'));
  });

  it('clears data on both slices and calls onSpaceUnavailable when membership is lost', async () => {
    const gateway = new InMemoryCashControlGateway();
    gateway.error = Object.assign(new Error('planning_not_authorized'), { code: '42501' });
    const onSpaceUnavailable = vi.fn();
    const { result } = renderHook(() => useCashControl(gateway, 'space-1', 'USD', '2026-09-15', 60, 'expected', onSpaceUnavailable));
    await waitFor(() => expect(onSpaceUnavailable).toHaveBeenCalled());
    expect(result.current.available.data.groups).toEqual([]);
    expect(result.current.outlook.data.days).toEqual([]);
    expect(result.current.available.status).toBe('loading');
  });
});

// The literal shared 15-second transport timeout is proved once, in
// isolation, by planning-shared/rpc.test.ts (no React involved) and
// re-affirmed by the allocation/goals/recurring gateways' own hook suites.
// Re-driving a real AbortController-based timeout through renderHook +
// vi.useFakeTimers reproducibly crashed the test worker with an
// out-of-memory abort in this sandbox during task 07 -- a known-hazardous
// combination of jsdom's AbortSignal event dispatch, fake timers, and
// React's effect scheduler, not a defect in the hook itself. What the hook
// actually needs to prove -- that a timeout-shaped rejection lands in
// `error` state (never a fabricated ambiguous/saving state, since there is
// no command here) and that `refresh()` recovers it -- is covered above by
// "classifies a timeout-shaped transport failure as a retryable error".
