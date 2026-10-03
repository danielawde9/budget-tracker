import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GoalPurchaseDialog } from './goal-purchase-dialog.js';
import type { GoalSummary } from './types.js';

const expense = { id: 'expense-1', kind: 'expense' as const, currency: 'USD' as const, effectiveDate: '2026-10-02', amountMinor: '4500', label: 'Cedar Market' };
const base = {
  locale: 'en' as const, currency: 'USD' as const,
  goal: { nameEn: 'Laptop', fulfilledMinor: '0' } as GoalSummary, goalHead: 'head',
  pending: false, ambiguous: false, onClose: vi.fn(), onClearAmbiguous: vi.fn(),
  onRetry: vi.fn(async () => ({ status: 'success' as const, reconciled: true })),
  onSubmit: vi.fn(async () => ({ status: 'success' as const, reconciled: false })),
};

describe('goal expense dropdown', () => {
  it('selects a readable expense without typing an ID and sends the selected ID internally', async () => {
    const onSubmit = vi.fn(base.onSubmit);
    render(<GoalPurchaseDialog {...base} onSubmit={onSubmit} loadExpenses={vi.fn(async () => [expense])} />);
    expect(screen.queryByRole('textbox', { name: /reference id/i })).not.toBeInTheDocument();
    const picker = screen.getByRole('combobox', { name: 'Expense' });
    await screen.findByRole('option', { name: /Cedar Market.*\$45.00/ });
    await userEvent.selectOptions(picker, expense.id);
    await userEvent.type(screen.getByRole('textbox', { name: 'Amount to link' }), '45');
    await userEvent.click(screen.getByRole('button', { name: 'Link purchase' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ expenseEventId: expense.id, amountMinor: '4500', expectedHead: 'head' }));
  });

  it('keeps submission disabled when there are no eligible expenses', async () => {
    render(<GoalPurchaseDialog {...base} loadExpenses={vi.fn(async () => [])} />);
    await screen.findByText(/No eligible expenses/);
    expect(screen.getByRole('button', { name: 'Link purchase' })).toBeDisabled();
  });

  it('retries a failed read without exposing a manual ID fallback', async () => {
    const loadExpenses = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([expense]);
    render(<GoalPurchaseDialog {...base} loadExpenses={loadExpenses} />);
    await screen.findByText(/Could not load expenses/);
    await userEvent.click(screen.getByRole('button', { name: 'Retry expenses' }));
    await screen.findByRole('option', { name: /Cedar Market/ });
    expect(loadExpenses).toHaveBeenCalledTimes(2);
  });

  it('locks a resolved uncertain result and exposes unchanged retry', async () => {
    render(<GoalPurchaseDialog {...base} ambiguous loadExpenses={vi.fn(async () => [expense])} />);
    expect(screen.getByRole('button', { name: 'Retry unchanged request' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Expense' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Link purchase' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Retry unchanged request' }));
    expect(base.onRetry).toHaveBeenCalled();
  });

  it('rejects a blank amount before sending a command', async () => {
    const onSubmit = vi.fn();
    render(<GoalPurchaseDialog {...base} onSubmit={onSubmit} loadExpenses={vi.fn(async () => [expense])} />);
    await screen.findByRole('option', { name: /Cedar Market/ });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Expense' }), expense.id);
    await userEvent.click(screen.getByRole('button', { name: 'Link purchase' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid positive amount');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows fulfillment context and disables inputs while posting', () => {
    render(<GoalPurchaseDialog {...base} goal={{ ...base.goal, fulfilledMinor: '40000' }} pending />);
    expect(screen.getByText('$400.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Linking…' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Amount to link' })).toBeDisabled();
  });
});
