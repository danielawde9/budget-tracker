import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InMemoryGoalsGateway, coreGoalPageFixture } from '../../test/in-memory-goals-gateway.js';
import { useGoalMonthlyTargetLines } from './use-goal-monthly-targets.js';

const GOAL_ID = '00000000-0000-4000-8000-000000000101';

describe('useGoalMonthlyTargetLines', () => {
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

  it('falls back to an empty list when the read fails, so the publish stays on v1', async () => {
    const gateway = new InMemoryGoalsGateway();
    gateway.error = new Error('connection failure');
    const { result } = renderHook(() => useGoalMonthlyTargetLines(gateway, 'space-1', 'USD', '2026-09-01'));
    await waitFor(() => expect(gateway.calls.some((call) => call.name === 'loadPage')).toBe(true));
    expect(result.current).toEqual([]);
  });
});
