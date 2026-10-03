import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { coreGoalSummaryFixture } from '../../test/in-memory-goals-gateway.js';
import { GoalStateDialog } from './goal-state-dialog.js';

function props() {
  return { locale: 'en' as const, goal: { ...coreGoalSummaryFixture, earmarkedMinor: '0' }, target: 'closed' as const,
    pending: false, ambiguous: false, onClose: vi.fn(), onManageFunding: vi.fn(),
    onSubmit: vi.fn().mockResolvedValue({ status: 'success', reconciled: false }),
    onRetry: vi.fn().mockResolvedValue({ status: 'refresh-required', reconciled: true }) };
}

describe('GoalStateDialog', () => {
  it('closes a zero-earmark goal with one confirmation', async () => {
    const input = props();
    render(<GoalStateDialog {...input} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close goal' }));
    await waitFor(() => expect(input.onSubmit).toHaveBeenCalledTimes(1));
    expect(input.onClose).toHaveBeenCalledTimes(1);
  });
  it('blocks closing while money is set aside and directs the user to free or move it', async () => {
    const input = props();
    render(<GoalStateDialog {...input} goal={{ ...input.goal, earmarkedMinor: '10000' }} />);
    expect(screen.getByRole('button', { name: 'Close goal' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Set money aside' }));
    expect(input.onManageFunding).toHaveBeenCalledTimes(1);
    expect(input.onSubmit).not.toHaveBeenCalled();
  });
  it('retries an uncertain command unchanged and accepts a reconciled result awaiting refresh', async () => {
    const input = props();
    render(<GoalStateDialog {...input} ambiguous />);
    expect(screen.getByRole('button', { name: 'Close goal' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Retry unchanged request' }));
    await waitFor(() => expect(input.onClose).toHaveBeenCalledTimes(1));
    expect(input.onRetry).toHaveBeenCalledTimes(1);
    expect(input.onSubmit).not.toHaveBeenCalled();
  });
});
