import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GoalPurchaseDialog } from './goal-purchase-dialog.js';
import type { GoalSummary } from './types.js';

const HEAD_A = 'a'.repeat(64);
const EXPENSE_ID = '00000000-0000-4000-8000-000000000301';

function goal(overrides: Partial<GoalSummary> = {}): GoalSummary {
  return {
    id: '00000000-0000-4000-8000-000000000101', revisionId: '1', currency: 'USD', kind: 'purchase', state: 'active',
    nameEn: 'New laptop', nameAr: null, targetMinor: '600000', earmarkedMinor: '600000',
    coveredMinor: '600000', fulfilledMinor: '0', shortageMinor: '0', monthlyTargetMinor: null,
    monthlyNetContributionMinor: '0', dueDate: null, horizon: 'open', needsReview: false,
    suggestedMonthlyMinor: null, forecastMonth: null, forecastState: 'insufficient_history', asOf: '2026-09-14T12:00:00Z',
    ...overrides,
  };
}

function baseProps() {
  return {
    locale: 'en' as const, currency: 'USD' as const, goal: goal(), goalHead: HEAD_A,
    pending: false, ambiguous: false, onClose: vi.fn(), onClearAmbiguous: vi.fn(),
    onRetry: vi.fn(), onSubmit: vi.fn(),
  };
}

describe('GoalPurchaseDialog', () => {
  it('links a purchase with the exact expense id, amount, and current head', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { linkIds: ['1'] } });
    render(<GoalPurchaseDialog {...baseProps()} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Expense reference id' }), EXPENSE_ID);
    await userEvent.type(screen.getByRole('textbox', { name: 'Amount to link' }), '400');
    await userEvent.click(screen.getByRole('button', { name: 'Link purchase' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ expenseEventId: EXPENSE_ID, amountMinor: '40000', expectedHead: HEAD_A }));
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('rejects a malformed expense id before calling the gateway', async () => {
    const onSubmit = vi.fn();
    render(<GoalPurchaseDialog {...baseProps()} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Expense reference id' }), 'not-a-uuid');
    await userEvent.type(screen.getByRole('textbox', { name: 'Amount to link' }), '400');
    await userEvent.click(screen.getByRole('button', { name: 'Link purchase' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects a blank amount before calling the gateway', async () => {
    const onSubmit = vi.fn();
    render(<GoalPurchaseDialog {...baseProps()} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Expense reference id' }), EXPENSE_ID);
    await userEvent.click(screen.getByRole('button', { name: 'Link purchase' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid positive amount.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the already-fulfilled amount for context', () => {
    render(<GoalPurchaseDialog {...baseProps()} goal={goal({ fulfilledMinor: '40000' })} />);
    expect(screen.getByText('$400.00')).toBeInTheDocument();
  });

  it('offers an unchanged retry when ambiguous', async () => {
    const onRetry = vi.fn().mockResolvedValue({ status: 'success', reconciled: true, result: { linkIds: ['1'] } });
    const onSubmit = vi.fn().mockRejectedValue(new Error('network timeout'));
    render(<GoalPurchaseDialog {...baseProps()} ambiguous onRetry={onRetry} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Expense reference id' }), EXPENSE_ID);
    await userEvent.type(screen.getByRole('textbox', { name: 'Amount to link' }), '400');
    await userEvent.click(screen.getByRole('button', { name: 'Link purchase' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry unchanged request' }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
  });

  it('disables the form while pending', () => {
    render(<GoalPurchaseDialog {...baseProps()} pending />);
    expect(screen.getByRole('button', { name: 'Linking…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
