import { describe, expect, it, vi } from 'vitest';
import { InMemoryGoalsGateway, coreGoalPageFixture } from '../../test/in-memory-goals-gateway.js';
import { goalMonthlyTargetLine, latestMonthlyTargetRevisionId, loadGoalMonthlyTargetLines } from './monthly-target.js';
import type { GoalHistoryRow, GoalSummary } from './types.js';

const GOAL_ID = '00000000-0000-4000-8000-000000000101';

function historyRow(overrides: Partial<GoalHistoryRow> & { sourceId: string }): GoalHistoryRow {
  return { createdAt: '2026-09-14T12:00:00Z', sourceKind: 'monthly_target', detail: {}, ...overrides };
}

function summary(overrides: Partial<GoalSummary> = {}): GoalSummary {
  return { ...coreGoalPageFixture.rows[0]!, ...overrides };
}

describe('latestMonthlyTargetRevisionId', () => {
  it('returns the newest monthly-target revision id for the requested month', () => {
    const rows: GoalHistoryRow[] = [
      historyRow({ sourceId: '20', detail: { monthStart: '2026-09-01', amountMinor: '60000' } }),
      historyRow({ sourceId: '10', detail: { monthStart: '2026-08-01', amountMinor: '50000' } }),
      historyRow({ sourceId: '7', detail: { monthStart: '2026-09-01', amountMinor: '40000' } }),
    ];
    // Newest-first: the first September row (id 20) wins over the older id 7.
    expect(latestMonthlyTargetRevisionId(rows, '2026-09-01')).toBe('20');
  });

  it('ignores non-monthly-target rows and returns null when the month has no target', () => {
    const rows: GoalHistoryRow[] = [
      historyRow({ sourceId: '5', sourceKind: 'earmark', detail: { operation: 'reserve', amountMinor: '100' } }),
      historyRow({ sourceId: '4', detail: { monthStart: '2026-08-01', amountMinor: '40000' } }),
    ];
    expect(latestMonthlyTargetRevisionId(rows, '2026-09-01')).toBeNull();
  });

  it('returns null for a target row whose detail carries no monthStart', () => {
    expect(latestMonthlyTargetRevisionId([historyRow({ sourceId: '9', detail: {} })], '2026-09-01')).toBeNull();
  });
});

describe('goalMonthlyTargetLine', () => {
  it('is null for a goal with no monthly target for the plan month', () => {
    expect(goalMonthlyTargetLine(summary({ monthlyTargetMinor: null }), '7')).toBeNull();
  });

  it('carries the amount and the expected revision head', () => {
    expect(goalMonthlyTargetLine(summary({ monthlyTargetMinor: '60000' }), '7')).toEqual({
      goalId: GOAL_ID, nameEn: 'Emergency fund', nameAr: null, amountMinor: '60000', expectedRevisionId: '7',
    });
  });
});

describe('loadGoalMonthlyTargetLines', () => {
  it('pages goal identities and history to carry buried heads for the selected month', async () => {
    const gateway = new InMemoryGoalsGateway();
    const first = summary();
    const second = summary({ id: 'second' });
    gateway.loadPage = vi.fn()
      .mockResolvedValueOnce({ rows: [first], hasMore: true, nextCursor: { createdAt: first.asOf, id: first.id } })
      .mockResolvedValueOnce({ rows: [second], hasMore: false, nextCursor: null });
    gateway.loadDetail = vi.fn(async input => ({ ...gateway.detail, summary: summary({ id: input.goalId, monthlyTargetMinor: '123' }) }));
    gateway.loadHistory = vi.fn(async input => input.beforeSourceId
      ? { rows: [historyRow({ sourceId: `head-${input.goalId}`, detail: { monthStart: '2027-01-01' } })], hasMore: false, nextCursor: null }
      : { rows: [historyRow({ sourceId: 'later', sourceKind: 'earmark' })], hasMore: true, nextCursor: { createdAt: '2027-02-01T00:00:00Z', sourceKind: 'earmark' as const, sourceId: 'later' } });
    const lines = await loadGoalMonthlyTargetLines(gateway, 'space-1', 'USD', '2027-01-01');
    expect(lines.map(line => [line.goalId, line.amountMinor, line.expectedRevisionId])).toEqual([
      [first.id, '123', `head-${first.id}`], ['second', '123', 'head-second'],
    ]);
    expect(gateway.loadPage).toHaveBeenLastCalledWith(expect.objectContaining({ afterId: first.id }), undefined);
  });
  it('uses the selected month detail amount, not the current-month list amount', async () => {
    const gateway = new InMemoryGoalsGateway();
    gateway.page = coreGoalPageFixture;
    gateway.detail = { ...gateway.detail, summary: { ...gateway.detail.summary, monthlyTargetMinor: '12345' } };
    const lines = await loadGoalMonthlyTargetLines(gateway, 'space-1', 'USD', '2027-01-01');
    expect(lines[0]?.amountMinor).toBe('12345');
    expect(gateway.calls.find(call => call.name === 'loadDetail')?.input).toEqual(expect.objectContaining({ month: '2027-01-01' }));
  });
  it('collects every goal with a monthly target and its current revision head for the month', async () => {
    const gateway = new InMemoryGoalsGateway();
    gateway.page = coreGoalPageFixture; // one goal, monthlyTargetMinor '50000'
    gateway.historyPage = {
      rows: [
        historyRow({ sourceId: '20', detail: { monthStart: '2026-09-01', amountMinor: '50000' } }),
        historyRow({ sourceId: '10', detail: { monthStart: '2026-08-01', amountMinor: '40000' } }),
      ],
      hasMore: false,
      nextCursor: null,
    };
    const lines = await loadGoalMonthlyTargetLines(gateway, 'space-1', 'USD', '2026-09-01');
    expect(lines).toEqual([{ goalId: GOAL_ID, nameEn: 'Emergency fund', nameAr: null, amountMinor: '50000', expectedRevisionId: '20' }]);
    expect(gateway.calls.filter((call) => call.name === 'loadPage')).toHaveLength(1);
    expect(gateway.calls.filter((call) => call.name === 'loadHistory')).toHaveLength(1);
  });

  it('omits goals that have no monthly target and does not spend a history call on them', async () => {
    const gateway = new InMemoryGoalsGateway();
    gateway.page = { ...coreGoalPageFixture, rows: [{ ...coreGoalPageFixture.rows[0]!, monthlyTargetMinor: null }] };
    gateway.detail = { ...gateway.detail, summary: { ...gateway.detail.summary, monthlyTargetMinor: null } };
    const lines = await loadGoalMonthlyTargetLines(gateway, 'space-1', 'USD', '2026-09-01');
    expect(lines).toEqual([]);
    expect(gateway.calls.filter((call) => call.name === 'loadHistory')).toHaveLength(0);
  });

  it('leaves the expected revision null when the month has no saved target yet', async () => {
    const gateway = new InMemoryGoalsGateway();
    gateway.page = coreGoalPageFixture;
    gateway.historyPage = { rows: [historyRow({ sourceId: '10', detail: { monthStart: '2026-08-01' } })], hasMore: false, nextCursor: null };
    const lines = await loadGoalMonthlyTargetLines(gateway, 'space-1', 'USD', '2026-09-01');
    expect(lines[0]?.expectedRevisionId).toBeNull();
  });
});
