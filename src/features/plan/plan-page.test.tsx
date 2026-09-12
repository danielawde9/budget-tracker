import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CurrencySummary } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import { PlanPage } from './plan-page.js';
import type { BudgetCategoryRow, BudgetCurrencySummary } from './types.js';

function summary(overrides: Partial<BudgetCurrencySummary> = {}): BudgetCurrencySummary {
  return {
    currency: 'USD',
    plannedIncomeMinor: '300000',
    actualIncomeMinor: '0',
    categoryTargetTotalMinor: '250000',
    categoryActualSpentMinor: '0',
    uncategorizedSpentMinor: '0',
    categoryOverspentMinor: '0',
    actualLoanRepaymentMinor: '0',
    remainingLoanReservationMinor: '0',
    loanCommitmentMinor: '0',
    unallocatedMinor: '50000',
    overallocatedMinor: '0',
    incomePlanRevisionId: 'rev-income-1',
    ...overrides,
  };
}

function categoryRow(overrides: Partial<BudgetCategoryRow> = {}): BudgetCategoryRow {
  return {
    categoryId: 'cat-groceries',
    nameEn: 'Groceries',
    nameAr: 'بقالة',
    archivedAt: null,
    currency: 'USD',
    targetMinor: '100000',
    actualSpentMinor: '80000',
    remainingMinor: '20000',
    overspentMinor: '0',
    targetRevisionId: 'rev-cat-1',
    ...overrides,
  };
}

function loansSummary(overrides: Partial<CurrencySummary> = {}): CurrencySummary {
  return {
    currency: 'USD',
    targetMinor: '50000',
    actualRepaymentMinor: '0',
    remainingReservationMinor: '50000',
    dueAmountMinor: '0',
    expectedCollectionMinor: '0',
    owedToMeMinor: '0',
    iOweMinor: '0',
    ...overrides,
  };
}

function setup(overrides: Partial<Parameters<typeof PlanPage>[0]> = {}) {
  const onSaveIncome = vi.fn(async () => true);
  const onSaveTarget = vi.fn(async () => true);
  const utils = render(
    <PlanPage
      locale="en"
      month="2026-09-01"
      summaries={[summary()]}
      categoryRows={[categoryRow()]}
      pending={false}
      error={null}
      loansSummary={[loansSummary()]}
      onSaveIncome={onSaveIncome}
      onSaveTarget={onSaveTarget}
      {...overrides}
    />,
  );
  return { ...utils, onSaveIncome, onSaveTarget };
}

describe('PlanPage', () => {
  it('renders a planned-income card per currency with the amount and an Edit button', () => {
    setup();
    const card = screen.getByRole('region', { name: 'Planned income USD' });
    expect(within(card).getByText(formatMinorAmount('300000', 'USD', 'en'))).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Edit planned income USD' })).toBeInTheDocument();
    expect(screen.getByText('Set planned income')).toBeInTheDocument();
  });

  it('shows the left-to-allocate amount, or the overallocated amount in danger styling', () => {
    const { container, rerender } = setup();
    const allocateCard = screen.getByRole('region', { name: 'Left to allocate USD' });
    expect(within(allocateCard).getByText(formatMinorAmount('50000', 'USD', 'en'))).toBeInTheDocument();

    rerender(
      <PlanPage
        locale="en"
        month="2026-09-01"
        summaries={[summary({ overallocatedMinor: '40000', unallocatedMinor: '0' })]}
        categoryRows={[]}
        pending={false}
        error={null}
        loansSummary={[]}
        onSaveIncome={async () => true}
        onSaveTarget={async () => true}
      />,
    );
    const danger = container.querySelector('.cr-danger-text');
    expect(danger).not.toBeNull();
    expect(danger).toHaveTextContent(formatMinorAmount('40000', 'USD', 'en'));
  });

  it('renders category rows with name, target vs actual, and an over progress bar when overspent', () => {
    const { container } = setup({
      categoryRows: [
        categoryRow(),
        categoryRow({
          categoryId: 'cat-dining', nameEn: 'Dining', nameAr: 'مطاعم',
          actualSpentMinor: '120000', remainingMinor: null, overspentMinor: '20000',
        }),
        categoryRow({ categoryId: 'cat-old', nameEn: 'Old', nameAr: 'قديم', archivedAt: '2026-01-01' }),
      ],
    });
    const list = screen.getByRole('list', { name: 'Category targets' });
    expect(within(list).getByText('Groceries')).toBeInTheDocument();
    expect(within(list).getByText('Dining')).toBeInTheDocument();
    expect(within(list).queryByText('Old')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.cr-progress')).toHaveLength(2);
    expect(container.querySelectorAll('.cr-progress--over')).toHaveLength(1);
  });

  it('edits income through a plain numeric input and saves with the income revision', async () => {
    const user = userEvent.setup();
    const { onSaveIncome } = setup();
    const card = screen.getByRole('region', { name: 'Planned income USD' });
    await user.click(within(card).getByRole('button', { name: 'Edit planned income USD' }));

    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByRole('textbox');
    await user.clear(input);
    await user.type(input, '2100.00');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(onSaveIncome).toHaveBeenCalledWith({ currency: 'USD', amountMinor: '210000', expectedRevisionId: 'rev-income-1' });
  });

  it('edits a category target with the row target revision', async () => {
    const user = userEvent.setup();
    const { onSaveTarget } = setup();
    const list = screen.getByRole('list', { name: 'Category targets' });
    const row = within(list).getByText('Groceries').closest('li');
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Edit Groceries target' }));

    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByRole('textbox');
    await user.clear(input);
    await user.type(input, '900.00');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(onSaveTarget).toHaveBeenCalledWith({
      categoryId: 'cat-groceries',
      currency: 'USD',
      amountMinor: '90000',
      expectedRevisionId: 'rev-cat-1',
    });
  });

  it('closes the dialog and shows the conflict message when the error indicates a revision conflict', async () => {
    const user = userEvent.setup();
    setup({ onSaveIncome: vi.fn(async () => false), error: 'Revision conflict: income plan was modified' });
    const card = screen.getByRole('region', { name: 'Planned income USD' });
    await user.click(within(card).getByRole('button', { name: 'Edit planned income USD' }));

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('The plan changed elsewhere — refreshed, please review')).toBeInTheDocument();
  });

  it('shows a generic failure message when the error is not a conflict', async () => {
    const user = userEvent.setup();
    setup({ onSaveIncome: vi.fn(async () => false), error: 'Network unreachable' });
    const card = screen.getByRole('region', { name: 'Planned income USD' });
    await user.click(within(card).getByRole('button', { name: 'Edit planned income USD' }));

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('Could not save the plan — please try again.')).toBeInTheDocument();
  });

  it('clears the failure message when the dialog reopens and a retry succeeds', async () => {
    const user = userEvent.setup();
    let fail = true;
    setup({ onSaveIncome: vi.fn(async () => { const ok = !fail; fail = false; return ok; }), error: 'Network unreachable' });
    const card = screen.getByRole('region', { name: 'Planned income USD' });
    await user.click(within(card).getByRole('button', { name: 'Edit planned income USD' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Could not save the plan — please try again.')).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Edit planned income USD' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Could not save the plan — please try again.')).not.toBeInTheDocument();
  });
});
