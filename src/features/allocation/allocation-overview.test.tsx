import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AllocationOverview } from './allocation-overview.js';
import type { AllocationMonthState } from './types.js';

function monthState(overrides: Partial<AllocationMonthState> = {}): AllocationMonthState {
  return {
    snapshotId: '12', templateRevisionId: '9', incomeRevisionId: '30001', hasPlan: true,
    plannedIncomeMinor: '200000', actualIncomeMinor: '180000', expenseMinor: '161000',
    incomeAfterSpendingMinor: '19000', ownDebtPaidMinor: '15000', remainingDebtMinor: '0',
    leftToAllocateMinor: '0', childPlanChanged: false, asOf: '2026-09-14T12:00:00Z',
    groups: [],
    ...overrides,
  };
}

describe('AllocationOverview', () => {
  it('U08-01 shows 200000 planned, 180000 received, 161000 spent, and 19000 after spending', () => {
    render(<AllocationOverview locale="en" currency="USD" monthState={monthState()} onEdit={vi.fn()} />);
    expect(screen.getByText('$2,000.00')).toBeInTheDocument();
    expect(screen.getByText('$1,800.00')).toBeInTheDocument();
    expect(screen.getByText('$1,610.00')).toBeInTheDocument();
    expect(screen.getByText('$190.00')).toBeInTheDocument();
  });

  it('U08-04 shows received income distinctly from planned income after a salary entry, without altering the saved target', () => {
    render(<AllocationOverview locale="en" currency="USD" monthState={monthState({ actualIncomeMinor: '250000' })} onEdit={vi.fn()} />);
    expect(screen.getByText('$2,000.00')).toBeInTheDocument();
    expect(screen.getByText('$2,500.00')).toBeInTheDocument();
  });

  it('shows an overallocated warning when leftToAllocate is negative', () => {
    render(<AllocationOverview locale="en" currency="USD" monthState={monthState({ leftToAllocateMinor: '-500' })} onEdit={vi.fn()} />);
    expect(screen.getByText('Overallocated')).toBeInTheDocument();
    expect(screen.getByText('-$5.00').className).toContain('alloc-danger-text');
  });

  it('shows a stale-dependency review banner when childPlanChanged is true, not an automatic rebase', () => {
    render(<AllocationOverview locale="en" currency="USD" monthState={monthState({ childPlanChanged: true })} onEdit={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/changed since this plan was published/);
  });

  it('shows "Set up" when there is no plan yet, and "Edit" once a plan exists', () => {
    const { rerender } = render(<AllocationOverview locale="en" currency="USD" monthState={monthState({ hasPlan: false, plannedIncomeMinor: null, leftToAllocateMinor: null })} onEdit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Set up' })).toBeInTheDocument();
    rerender(<AllocationOverview locale="en" currency="USD" monthState={monthState()} onEdit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('calls onEdit when the setup/edit button is pressed', async () => {
    const onEdit = vi.fn();
    render(<AllocationOverview locale="en" currency="USD" monthState={monthState()} onEdit={onEdit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('shows an empty-plan message instead of bars when there are no groups', () => {
    render(<AllocationOverview locale="en" currency="USD" monthState={monthState({ hasPlan: false, plannedIncomeMinor: null, leftToAllocateMinor: null })} onEdit={vi.fn()} />);
    expect(screen.getByText('No allocation plan for this month yet.')).toBeInTheDocument();
  });
});
