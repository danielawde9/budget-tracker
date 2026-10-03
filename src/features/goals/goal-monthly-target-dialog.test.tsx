import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GoalMonthlyTargetDialog } from './goal-monthly-target-dialog.js';

function props() {
  return { locale: 'en' as const, currency: 'USD' as const, goalName: 'Emergency fund', currentAmountMinor: '50000',
    expectedRevisionId: '20', pending: false, ambiguous: false, onClose: vi.fn(), onClearAmbiguous: vi.fn(),
    onRetry: vi.fn().mockResolvedValue({ status: 'refresh-required', reconciled: true }),
    onSet: vi.fn().mockResolvedValue({ status: 'success', reconciled: false }) };
}

describe('GoalMonthlyTargetDialog', () => {
  it('clears a target with zero and uses the selected month revision head', async () => {
    const input = props();
    render(<GoalMonthlyTargetDialog {...input} />);
    await userEvent.clear(screen.getByRole('textbox', { name: 'Monthly target' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Monthly target' }), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(input.onSet).toHaveBeenCalledWith({ amountMinor: '0', expectedRevisionId: '20' }));
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });
  it('locks uncertain inputs and displays accepted recovery after an unchanged retry', async () => {
    const input = props();
    render(<GoalMonthlyTargetDialog {...input} ambiguous />);
    expect(screen.getByRole('textbox', { name: 'Monthly target' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Retry unchanged request' }));
    await screen.findByRole('button', { name: 'Done' });
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(input.onRetry).toHaveBeenCalledTimes(1);
    expect(input.onSet).not.toHaveBeenCalled();
  });
});
