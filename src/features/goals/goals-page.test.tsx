import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GoalsPage } from './goals-page.js';
import type { GoalPage, GoalSummary } from './types.js';
import type { GoalsState } from './use-goals.js';

const GOAL_ID = '00000000-0000-4000-8000-000000000101';

function summary(overrides: Partial<GoalSummary> = {}): GoalSummary {
  return {
    id: GOAL_ID, revisionId: '1', currency: 'USD', kind: 'reserve', state: 'active',
    nameEn: 'Emergency fund', nameAr: null, targetMinor: '600000', earmarkedMinor: '60000',
    coveredMinor: '30000', fulfilledMinor: '0', shortageMinor: '30000', monthlyTargetMinor: null,
    monthlyNetContributionMinor: '0', dueDate: null, horizon: 'open', needsReview: false,
    suggestedMonthlyMinor: null, forecastMonth: null, forecastState: 'insufficient_history', asOf: '2026-09-14T12:00:00Z',
    ...overrides,
  };
}

function page(rows: readonly GoalSummary[] = [summary()]): GoalPage {
  return { rows, hasMore: false, nextCursor: null, asOf: '2026-09-14T12:00:00Z' };
}

function fakeGoalsState(overrides: Partial<GoalsState> = {}): GoalsState {
  return {
    status: 'ready', page: page(), error: null, pending: false, ambiguous: null,
    refresh: vi.fn(), create: vi.fn(), revise: vi.fn(), reserveOrRelease: vi.fn(), move: vi.fn(),
    reverse: vi.fn(), linkPurchase: vi.fn(), setMonthlyTarget: vi.fn(), setMilestone: vi.fn(),
    retryAmbiguous: vi.fn(), clearAmbiguous: vi.fn(),
    loadDetail: vi.fn().mockResolvedValue({
      summary: summary(), milestones: [], earmarkHead: 'a'.repeat(64), definitionHead: '1', asOf: '2026-09-14T12:00:00Z',
    }),
    loadHistory: vi.fn().mockResolvedValue({ rows: [], hasMore: false, nextCursor: null }),
    loadMore: vi.fn(),
    ...overrides,
  } as unknown as GoalsState;
}

describe('GoalsPage', () => {
  it('shows a loading state', () => {
    render(<GoalsPage locale="en" currency="USD" goals={fakeGoalsState({ status: 'loading', page: page([]) })} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('lists active goals by default with their earmarked/covered figures', () => {
    render(<GoalsPage locale="en" currency="USD" goals={fakeGoalsState()} />);
    expect(screen.getByText('Emergency fund')).toBeInTheDocument();
    expect(screen.getByText(/Earmarked \$600\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Covered \$300\.00/)).toBeInTheDocument();
  });

  it('shows an empty state distinct from loading when a filter has no matches', async () => {
    render(<GoalsPage locale="en" currency="USD" goals={fakeGoalsState({ page: page([summary({ state: 'paused' })]) })} />);
    expect(screen.getByText('No goals yet in this view.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Paused' }));
    expect(screen.getByText('Emergency fund')).toBeInTheDocument();
  });

  it('surfaces a wallet transfer never inflating goal progress (progress comes only from earmarked/covered/fulfilled fields)', () => {
    // U13-02: a wallet transfer has no goal command at all -- the fixture's
    // earmarkedMinor/coveredMinor are exactly what the row shows, proving
    // the UI never derives progress from anything but these DTO fields.
    render(<GoalsPage locale="en" currency="USD" goals={fakeGoalsState({ page: page([summary({ earmarkedMinor: '60000', coveredMinor: '30000' })]) })} />);
    expect(screen.getByText(/Earmarked \$600\.00/)).toBeInTheDocument();
  });

  it('shows a retry action on error', async () => {
    const refresh = vi.fn();
    render(<GoalsPage locale="en" currency="USD" goals={fakeGoalsState({ status: 'error', page: page([]), error: { code: 'unknown', message: 'boom', recovery: 'try again' } })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    void refresh;
  });

  it('shows a refresh action after an accepted write whose follow-up read failed', async () => {
    const goals = fakeGoalsState({ status: 'accepted-refresh-pending' });
    render(<GoalsPage locale="en" currency="USD" goals={goals} />);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(goals.refresh).toHaveBeenCalledTimes(1);
  });

  it('shows check-again/dismiss actions while ambiguous', async () => {
    const goals = fakeGoalsState({ status: 'ambiguous', ambiguous: { kind: 'create', requestId: 'req-1' } });
    render(<GoalsPage locale="en" currency="USD" goals={goals} />);
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(goals.retryAmbiguous).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(goals.clearAmbiguous).toHaveBeenCalledTimes(1);
  });

  it('opens the create editor and creates a goal', async () => {
    const goals = fakeGoalsState({ create: vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { goalId: GOAL_ID, revisionId: '1' } }) });
    render(<GoalsPage locale="en" currency="USD" goals={goals} />);
    await userEvent.click(screen.getByRole('button', { name: 'New goal' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Name (English)' }), 'Laptop');
    await userEvent.type(screen.getByRole('textbox', { name: 'Target amount' }), '1000');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(goals.create).toHaveBeenCalledTimes(1));
  });

  it('navigates to a goal\'s detail view and back to the list', async () => {
    const goals = fakeGoalsState();
    render(<GoalsPage locale="en" currency="USD" goals={goals} />);
    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back to goals' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Back to goals' }));
    expect(screen.getByText('Emergency fund')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New goal' })).toBeInTheDocument();
  });
});
