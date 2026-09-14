import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GoalMilestones } from './goal-milestones.js';
import type { GoalMilestoneRow } from './types.js';

function milestone(overrides: Partial<GoalMilestoneRow> = {}): GoalMilestoneRow {
  return {
    id: '00000000-0000-4000-8000-000000000201', kind: 'checklist', labelEn: 'Pick a bank', labelAr: 'اختر بنكًا',
    thresholdMinor: null, dueDate: null, ordinal: 0, currentState: 'incomplete',
    ...overrides,
  };
}

describe('GoalMilestones', () => {
  it('shows "No milestones yet." when the list is empty', () => {
    render(<GoalMilestones locale="en" currency="USD" milestones={[]} pending={false} onSetMilestone={vi.fn()} />);
    expect(screen.getByText('No milestones yet.')).toBeInTheDocument();
  });

  it('renders an amount milestone\'s threshold, never an action button', () => {
    render(<GoalMilestones locale="en" currency="USD" pending={false} onSetMilestone={vi.fn()}
      milestones={[milestone({ kind: 'amount', thresholdMinor: '300000', labelEn: 'Halfway', dueDate: '2027-06-01' })]} />);
    expect(screen.getByText('$3,000.00')).toBeInTheDocument();
    expect(screen.getByText(/2027-06-01/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('starts a never-touched milestone from a null expected event id, then reuses the id its own prior call returned', async () => {
    const onSetMilestone = vi.fn()
      .mockResolvedValueOnce({ status: 'success', reconciled: false, result: { eventId: '1' } })
      .mockResolvedValueOnce({ status: 'success', reconciled: false, result: { eventId: '2' } });
    render(<GoalMilestones locale="en" currency="USD" pending={false} onSetMilestone={onSetMilestone}
      milestones={[milestone({ currentState: 'incomplete' })]} />);

    const button = screen.getByRole('button', { name: 'Mark complete' });
    await userEvent.click(button);
    await waitFor(() => expect(onSetMilestone).toHaveBeenNthCalledWith(1, { milestoneId: milestone().id, action: 'complete', expectedEventId: null }));

    // The prop's own currentState never flips in this test (no parent refetch
    // simulated), so the same button is still labelled "Mark complete" -- but
    // the component's internal tracking must now use the id its own last
    // successful call returned, not null again.
    await userEvent.click(button);
    await waitFor(() => expect(onSetMilestone).toHaveBeenNthCalledWith(2, { milestoneId: milestone().id, action: 'complete', expectedEventId: '1' }));
  });

  it('sorts milestones by ordinal', () => {
    render(<GoalMilestones locale="en" currency="USD" pending={false} onSetMilestone={vi.fn()} milestones={[
      milestone({ id: 'b', ordinal: 1, labelEn: 'Second' }),
      milestone({ id: 'a', ordinal: 0, labelEn: 'First' }),
    ]} />);
    const labels = screen.getAllByText(/First|Second/).map((el) => el.textContent);
    expect(labels).toEqual(['First', 'Second']);
  });

  it('renders the Arabic label and action copy when locale is ar', () => {
    render(<GoalMilestones locale="ar" currency="USD" pending={false} onSetMilestone={vi.fn()}
      milestones={[milestone({ currentState: 'complete' })]} />);
    expect(screen.getByText('اختر بنكًا')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إعادة فتح' })).toBeInTheDocument();
  });

  it('shows a recoverable error inline without crashing when the command rejects', async () => {
    const onSetMilestone = vi.fn().mockRejectedValue(Object.assign(new Error('planning_stale_revision'), { code: '40001' }));
    render(<GoalMilestones locale="en" currency="USD" pending={false} onSetMilestone={onSetMilestone}
      milestones={[milestone()]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('disables the action button while a command is pending', () => {
    render(<GoalMilestones locale="en" currency="USD" pending milestones={[milestone()]} onSetMilestone={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Mark complete' })).toBeDisabled();
  });
});
