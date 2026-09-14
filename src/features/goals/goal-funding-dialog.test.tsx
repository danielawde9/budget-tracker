import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GoalFundingDialog } from './goal-funding-dialog.js';
import type { GoalSummary } from './types.js';

const HEAD_A = 'a'.repeat(64);
const HEAD_B = 'b'.repeat(64);

function goal(overrides: Partial<GoalSummary> = {}): GoalSummary {
  return {
    id: '00000000-0000-4000-8000-000000000101', revisionId: '1', currency: 'USD', kind: 'reserve', state: 'active',
    nameEn: 'Emergency fund', nameAr: null, targetMinor: '600000', earmarkedMinor: '30000',
    coveredMinor: '10000', fulfilledMinor: '0', shortageMinor: '20000', monthlyTargetMinor: null,
    monthlyNetContributionMinor: '0', dueDate: null, horizon: 'open', needsReview: false,
    suggestedMonthlyMinor: null, forecastMonth: null, forecastState: 'insufficient_history', asOf: '2026-09-14T12:00:00Z',
    ...overrides,
  };
}

function baseProps() {
  return {
    locale: 'en' as const, currency: 'USD' as const, goal: goal(), goalHead: HEAD_A, moveTargets: [],
    pending: false, ambiguous: false, onClose: vi.fn(), onClearAmbiguous: vi.fn(),
    onRetry: vi.fn(), onReserveOrRelease: vi.fn(), onMove: vi.fn(), onLoadToHead: vi.fn().mockResolvedValue(HEAD_B),
  };
}

describe('GoalFundingDialog', () => {
  it('reserves an amount by default and shows the success screen', async () => {
    const onReserveOrRelease = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { eventId: '1' } });
    render(<GoalFundingDialog {...baseProps()} onReserveOrRelease={onReserveOrRelease} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Amount' }), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onReserveOrRelease).toHaveBeenCalledWith({
      action: 'reserve', amountMinor: '10000', expectedHead: HEAD_A, acceptUnderfunded: false,
    }));
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('switches to release mode and submits with that action', async () => {
    const onReserveOrRelease = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { eventId: '1' } });
    render(<GoalFundingDialog {...baseProps()} onReserveOrRelease={onReserveOrRelease} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Release' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Amount' }), '50');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onReserveOrRelease).toHaveBeenCalledWith(expect.objectContaining({ action: 'release' })));
  });

  it('hides the move option when there are no candidate targets', () => {
    render(<GoalFundingDialog {...baseProps()} />);
    expect(screen.queryByRole('radio', { name: 'Move to another goal' })).not.toBeInTheDocument();
  });

  it('offers move when candidate targets exist, fetches the destination head fresh, and submits both expected heads', async () => {
    const onMove = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { eventId: '1' } });
    const onLoadToHead = vi.fn().mockResolvedValue(HEAD_B);
    render(<GoalFundingDialog {...baseProps()} onMove={onMove} onLoadToHead={onLoadToHead}
      moveTargets={[{ id: 'g2', nameEn: 'Laptop', nameAr: null }]} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Move to another goal' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Amount' }), '25');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onMove).toHaveBeenCalledWith({
      toGoalId: 'g2', amountMinor: '2500', expectedFromHead: HEAD_A, expectedToHead: HEAD_B, acceptUnderfunded: false,
    }));
  });

  it('offers to reserve anyway when underfunded, then resubmits with acceptUnderfunded true', async () => {
    const onReserveOrRelease = vi.fn()
      .mockRejectedValueOnce(new Error('goal_underfunded_confirmation_required'))
      .mockResolvedValueOnce({ status: 'success', reconciled: false, result: { eventId: '1' } });
    render(<GoalFundingDialog {...baseProps()} onReserveOrRelease={onReserveOrRelease} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Amount' }), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('button', { name: 'Reserve anyway' });
    await userEvent.click(screen.getByRole('button', { name: 'Reserve anyway' }));
    await waitFor(() => expect(onReserveOrRelease).toHaveBeenNthCalledWith(2, {
      action: 'reserve', amountMinor: '10000', expectedHead: HEAD_A, acceptUnderfunded: true,
    }));
  });

  it('rejects a blank amount before calling the gateway', async () => {
    const onReserveOrRelease = vi.fn();
    render(<GoalFundingDialog {...baseProps()} onReserveOrRelease={onReserveOrRelease} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid positive amount.');
    expect(onReserveOrRelease).not.toHaveBeenCalled();
  });

  it('offers an unchanged retry when ambiguous', async () => {
    const onRetry = vi.fn().mockResolvedValue({ status: 'success', reconciled: true, result: { eventId: '1' } });
    const onReserveOrRelease = vi.fn().mockRejectedValue(new Error('network timeout'));
    render(<GoalFundingDialog {...baseProps()} ambiguous onRetry={onRetry} onReserveOrRelease={onReserveOrRelease} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Amount' }), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry unchanged request' }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
  });

  it('disables the form while pending', () => {
    render(<GoalFundingDialog {...baseProps()} pending />);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
