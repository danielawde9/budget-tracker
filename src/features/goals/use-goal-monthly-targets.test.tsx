import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InMemoryGoalsGateway, coreGoalPageFixture } from '../../test/in-memory-goals-gateway.js';
import { useGoalMonthlyTargetLines, useGoalMonthlyTargets } from './use-goal-monthly-targets.js';

const GOAL_ID = '00000000-0000-4000-8000-000000000101';

describe('useGoalMonthlyTargetLines', () => {
  it('blocks while refreshing and exposes new heads for a second publication', async () => {
    const gateway = new InMemoryGoalsGateway();
    gateway.page = coreGoalPageFixture;
    const head = (sourceId: string) => ({ rows: [{ createdAt: '2026-09-14T12:00:00Z', sourceKind: 'monthly_target' as const, sourceId, detail: { monthStart: '2026-09-01' } }], hasMore: false, nextCursor: null });
    gateway.historyPage = head('20');
    const { result, rerender } = renderHook(({ version }) => useGoalMonthlyTargets(gateway, 'space-1', 'USD', '2026-09-01', version), { initialProps: { version: 0 } });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.lines[0]?.expectedRevisionId).toBe('20');
    gateway.loadDelayMs = 20;
    gateway.historyPage = head('21');
    rerender({ version: 1 });
    expect(result.current.status).toBe('loading');
    expect(result.current.lines).toEqual([]);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.lines[0]?.expectedRevisionId).toBe('21');
  });
  it('exposes an error rather than ready after a target read fails', async () => {
    const gateway = new InMemoryGoalsGateway();
    gateway.error = new Error('connection failure');
    const { result } = renderHook(() => useGoalMonthlyTargets(gateway, 'space-1', 'USD', '2026-09-01'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.lines).toEqual([]);
  });
  it('reloads goal heads after publication without changing the selected month', async () => {
    const gateway = new InMemoryGoalsGateway();
    gateway.page = coreGoalPageFixture;
    const { result, rerender } = renderHook(({ version }) => useGoalMonthlyTargetLines(gateway, 'space-1', 'USD', '2026-09-01', version), { initialProps: { version: 0 } });
    await waitFor(() => expect(result.current).toHaveLength(1));
    const before = gateway.calls.filter(call => call.name === 'loadPage').length;
    rerender({ version: 1 });
    await waitFor(() => expect(gateway.calls.filter(call => call.name === 'loadPage').length).toBeGreaterThan(before));
  });
  it('loads the current month\'s goal monthly targets and their revision heads', async () => {
    const gateway = new InMemoryGoalsGateway();
    gateway.page = coreGoalPageFixture;
    gateway.historyPage = {
      rows: [{ createdAt: '2026-09-14T12:00:00Z', sourceKind: 'monthly_target', sourceId: '20', detail: { monthStart: '2026-09-01', amountMinor: '50000' } }],
      hasMore: false, nextCursor: null,
    };
    const { result } = renderHook(() => useGoalMonthlyTargetLines(gateway, 'space-1', 'USD', '2026-09-01'));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]).toEqual({ goalId: GOAL_ID, nameEn: 'Emergency fund', nameAr: null, amountMinor: '50000', expectedRevisionId: '20' });
  });

  it('returns an empty list when the goals service is unavailable', () => {
    const { result } = renderHook(() => useGoalMonthlyTargetLines(null, 'space-1', 'USD', '2026-09-01'));
    expect(result.current).toEqual([]);
  });

  it('keeps the legacy lines accessor empty when reads fail', async () => {
    const gateway = new InMemoryGoalsGateway();
    gateway.error = new Error('connection failure');
    const { result } = renderHook(() => useGoalMonthlyTargetLines(gateway, 'space-1', 'USD', '2026-09-01'));
    await waitFor(() => expect(gateway.calls.some((call) => call.name === 'loadPage')).toBe(true));
    expect(result.current).toEqual([]);
  });
});
