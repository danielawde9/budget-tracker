import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GoalDetail } from './goal-detail.js';
import type { GoalDetail as GoalDetailData, GoalSummary } from './types.js';
import type { GoalsState } from './use-goals.js';

const HEAD_A = 'a'.repeat(64);
const GOAL_ID = '00000000-0000-4000-8000-000000000101';

function summary(overrides: Partial<GoalSummary> = {}): GoalSummary {
  return {
    id: GOAL_ID, revisionId: '1', currency: 'USD', kind: 'reserve', state: 'active',
    nameEn: 'Emergency fund', nameAr: null, targetMinor: '600000', earmarkedMinor: '60000',
    coveredMinor: '30000', fulfilledMinor: '0', shortageMinor: '30000', monthlyTargetMinor: '50000',
    monthlyNetContributionMinor: '10000', dueDate: null, horizon: 'open', needsReview: false,
    suggestedMonthlyMinor: null, forecastMonth: null, forecastState: 'insufficient_history', asOf: '2026-09-14T12:00:00Z',
    ...overrides,
  };
}

function detailData(overrides: Partial<GoalDetailData> = {}): GoalDetailData {
  return {
    summary: summary(), milestones: [
      { id: '00000000-0000-4000-8000-000000000201', kind: 'checklist', labelEn: 'Pick a bank', labelAr: null, thresholdMinor: null, dueDate: null, ordinal: 0, currentState: 'incomplete' },
    ],
    earmarkHead: HEAD_A, definitionHead: '1', asOf: '2026-09-14T12:00:00Z',
    ...overrides,
  };
}

function fakeGoalsState(overrides: Partial<GoalsState> = {}): GoalsState {
  return {
    status: 'ready', page: { rows: [], hasMore: false, nextCursor: null, asOf: '' }, error: null,
    pending: false, ambiguous: null,
    refresh: vi.fn(), create: vi.fn(), revise: vi.fn(), reserveOrRelease: vi.fn(), move: vi.fn(),
    reverse: vi.fn(), linkPurchase: vi.fn(), setMonthlyTarget: vi.fn(), setMilestone: vi.fn(),
    retryAmbiguous: vi.fn(), clearAmbiguous: vi.fn(),
    loadDetail: vi.fn().mockResolvedValue(detailData()),
    loadHistory: vi.fn().mockResolvedValue({ rows: [], hasMore: false, nextCursor: null }),
    loadMore: vi.fn(),
    ...overrides,
  } as unknown as GoalsState;
}

describe('GoalDetail', () => {
  it('loads and shows the target/earmarked/covered/fulfilled/shortage figures distinctly', async () => {
    const goals = fakeGoalsState();
    render(<GoalDetail locale="en" currency="USD" goals={goals} goalId={GOAL_ID} otherGoals={[]} onBack={vi.fn()} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Emergency fund')).toBeInTheDocument());
    expect(screen.getByText('$6,000.00')).toBeInTheDocument(); // target
    expect(screen.getByText('$600.00')).toBeInTheDocument(); // earmarked
    expect(screen.getAllByText('$300.00')).toHaveLength(2); // covered and shortage share this value, shown distinctly
  });

  it('recovers from a load error via retry', async () => {
    const goals = fakeGoalsState({ loadDetail: vi.fn().mockRejectedValue(new Error('connection failure')) });
    render(<GoalDetail locale="en" currency="USD" goals={goals} goalId={GOAL_ID} otherGoals={[]} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    (goals.loadDetail as ReturnType<typeof vi.fn>).mockResolvedValue(detailData());
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('Emergency fund')).toBeInTheDocument());
  });

  it('shows a needs-review banner with a reopen action for a closed goal with a restored balance', async () => {
    const goals = fakeGoalsState({
      loadDetail: vi.fn().mockResolvedValue(detailData({ summary: summary({ state: 'closed', needsReview: true }) })),
      revise: vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { goalId: GOAL_ID, revisionId: '2' } }),
    });
    render(<GoalDetail locale="en" currency="USD" goals={goals} goalId={GOAL_ID} otherGoals={[]} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Reopen goal' })).toBeInTheDocument();
  });

  it('never shows a manage-funding action for an ordinary closed goal', async () => {
    const goals = fakeGoalsState({ loadDetail: vi.fn().mockResolvedValue(detailData({ summary: summary({ state: 'closed', needsReview: false }) })) });
    render(<GoalDetail locale="en" currency="USD" goals={goals} goalId={GOAL_ID} otherGoals={[]} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Emergency fund')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Manage funding/ })).not.toBeInTheDocument();
  });

  it('opens the funding dialog and reserves against this exact goal', async () => {
    const goals = fakeGoalsState({ reserveOrRelease: vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { eventId: '1', goalId: GOAL_ID } }) });
    render(<GoalDetail locale="en" currency="USD" goals={goals} goalId={GOAL_ID} otherGoals={[]} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Emergency fund')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Manage funding/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Amount' }), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(goals.reserveOrRelease).toHaveBeenCalledWith(expect.objectContaining({ goalId: GOAL_ID, action: 'reserve', expectedHead: HEAD_A })));
  });

  it('offers other active goals (not itself, not paused/closed) as move destinations', async () => {
    const other = summary({ id: 'g2', nameEn: 'Laptop', state: 'active' });
    const pausedOther = summary({ id: 'g3', nameEn: 'Paused goal', state: 'paused' });
    const goals = fakeGoalsState();
    render(<GoalDetail locale="en" currency="USD" goals={goals} goalId={GOAL_ID} otherGoals={[summary(), other, pausedOther]} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Emergency fund')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Manage funding/ }));
    await userEvent.click(screen.getByRole('radio', { name: 'Move to another goal' }));
    expect(screen.getByRole('option', { name: 'Laptop' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Paused goal' })).not.toBeInTheDocument();
  });

  it('links a purchase against this exact goal', async () => {
    const goals = fakeGoalsState({ linkPurchase: vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { linkIds: ['1'] } }) });
    render(<GoalDetail locale="en" currency="USD" goals={goals} goalId={GOAL_ID} otherGoals={[]} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Emergency fund')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Link a purchase' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Expense reference id' }), '00000000-0000-4000-8000-000000000301');
    await userEvent.type(screen.getByRole('textbox', { name: 'Amount to link' }), '400');
    await userEvent.click(screen.getByRole('button', { name: 'Link purchase' }));
    await waitFor(() => expect(goals.linkPurchase).toHaveBeenCalledWith({
      expenseEventId: '00000000-0000-4000-8000-000000000301',
      lines: [{ goalId: GOAL_ID, amountMinor: '40000', expectedHead: HEAD_A }],
    }));
  });

  it('pauses an active goal via the editor with the state pre-selected', async () => {
    const goals = fakeGoalsState({ revise: vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { goalId: GOAL_ID, revisionId: '2' } }) });
    render(<GoalDetail locale="en" currency="USD" goals={goals} goalId={GOAL_ID} otherGoals={[]} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Emergency fund')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Pause goal' }));
    expect(screen.getByRole('radio', { name: 'Paused' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(goals.revise).toHaveBeenCalledWith(expect.objectContaining({ goalId: GOAL_ID, expectedRevisionId: '1', state: 'paused' })));
  });

  it('passes the goal\'s milestones through to GoalMilestones', async () => {
    const goals = fakeGoalsState();
    render(<GoalDetail locale="en" currency="USD" goals={goals} goalId={GOAL_ID} otherGoals={[]} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText('Pick a bank').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: 'Mark complete' })).toBeInTheDocument();
  });

  it('loads more history on demand', async () => {
    const goals = fakeGoalsState({
      loadHistory: vi.fn()
        .mockResolvedValueOnce({ rows: [{ createdAt: '2026-09-01T00:00:00Z', sourceKind: 'definition', sourceId: '1', detail: {} }], hasMore: true, nextCursor: { createdAt: '2026-09-01T00:00:00Z', sourceKind: 'definition', sourceId: '1' } })
        .mockResolvedValueOnce({ rows: [{ createdAt: '2026-08-01T00:00:00Z', sourceKind: 'earmark', sourceId: '2', detail: { operation: 'reserve', amountMinor: '10000' } }], hasMore: false, nextCursor: null }),
    });
    render(<GoalDetail locale="en" currency="USD" goals={goals} goalId={GOAL_ID} otherGoals={[]} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Definition updated', { exact: false })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Load more history' }));
    await waitFor(() => expect(screen.getByText('Earmark: reserve $100.00', { exact: false })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Load more history' })).not.toBeInTheDocument();
  });

  it('shows an over-target progress bar with the exact numeric overage, for a purchase goal counting covered+fulfilled', async () => {
    const goals = fakeGoalsState({
      loadDetail: vi.fn().mockResolvedValue(detailData({
        summary: summary({ kind: 'purchase', targetMinor: '100000', coveredMinor: '60000', fulfilledMinor: '50000' }),
      })),
    });
    render(<GoalDetail locale="en" currency="USD" goals={goals} goalId={GOAL_ID} otherGoals={[]} onBack={vi.fn()} />);
    // progress = 60000 + 50000 = 110000, over target(100000) by 10000
    await waitFor(() => expect(screen.getByText('+$100.00 over target')).toBeInTheDocument());
  });

  it('shows coverage as unavailable rather than a misleading empty bar when null', async () => {
    const goals = fakeGoalsState({ loadDetail: vi.fn().mockResolvedValue(detailData({ summary: summary({ coveredMinor: null }) })) });
    render(<GoalDetail locale="en" currency="USD" goals={goals} goalId={GOAL_ID} otherGoals={[]} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Coverage is currently unavailable.')).toBeInTheDocument());
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('calls onBack', async () => {
    const goals = fakeGoalsState();
    const onBack = vi.fn();
    render(<GoalDetail locale="en" currency="USD" goals={goals} goalId={GOAL_ID} otherGoals={[]} onBack={onBack} />);
    await waitFor(() => expect(screen.getByText('Emergency fund')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Back to goals' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
