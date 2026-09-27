import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CurrencySummary, Loan } from '../loans/types.js';
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

function owedLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 'loan-maya', spaceId: 'space-1', direction: 'i_owe_them', personName: 'Maya', currency: 'USD',
    effectiveDate: '2026-01-01', dueDate: null, note: null, outstandingMinor: '100000',
    originalPrincipalMinor: '100000', totalRepaidMinor: '0', status: 'outstanding',
    plan: { targetMinor: '20000', actualRepaymentMinor: '0', remainingReservationMinor: '20000', dueAmountMinor: '0', expectedCollectionMinor: '0' },
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
  it('uses the Plan header currency when controlled by its route', () => {
    setup({
      currency: 'LBP',
      summaries: [summary(), summary({ currency: 'LBP', plannedIncomeMinor: '5000000' })],
      categoryRows: [categoryRow(), categoryRow({ categoryId: 'cat-fuel', nameEn: 'Fuel', currency: 'LBP' })],
    });

    expect(screen.queryByRole('tablist', { name: 'Currency' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Planned income LBP' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Planned income USD' })).not.toBeInTheDocument();
    expect(screen.getByText('Fuel')).toBeInTheDocument();
  });

  it('separates the whole plan by currency tabs, defaulting to USD', async () => {
    const user = userEvent.setup();
    setup({
      summaries: [
        summary(),
        summary({ currency: 'LBP', plannedIncomeMinor: '5000000', incomePlanRevisionId: 'rev-income-2', unallocatedMinor: '1000000' }),
      ],
      categoryRows: [
        categoryRow(),
        categoryRow({ categoryId: 'cat-fuel', nameEn: 'Fuel', currency: 'LBP', targetMinor: '2000000', targetRevisionId: 'rev-cat-2' }),
      ],
      loansSummary: [loansSummary(), loansSummary({ currency: 'LBP', targetMinor: '1500000' })],
    });

    const tablist = screen.getByRole('tablist', { name: 'Currency' });
    expect(within(tablist).getByRole('tab', { name: 'USD' })).toHaveAttribute('aria-selected', 'true');
    expect(within(tablist).getByRole('tab', { name: 'LBP' })).toHaveAttribute('aria-selected', 'false');

    expect(screen.getByRole('region', { name: 'Planned income USD' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Planned income LBP' })).not.toBeInTheDocument();
    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.queryByText('Fuel')).not.toBeInTheDocument();
    expect(screen.queryByText('LBP 1,500,000')).not.toBeInTheDocument();

    await user.click(within(tablist).getByRole('tab', { name: 'LBP' }));

    expect(screen.getByRole('region', { name: 'Planned income LBP' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Planned income USD' })).not.toBeInTheDocument();
    expect(screen.getByText('Fuel')).toBeInTheDocument();
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument();
    expect(screen.getByText('LBP 1,500,000')).toBeInTheDocument();
  });

  it('renders the planned-income card for the active currency tab', async () => {
    const user = userEvent.setup();
    setup();
    const card = screen.getByRole('region', { name: 'Planned income USD' });
    expect(within(card).getByText(formatMinorAmount('300000', 'USD', 'en'))).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Edit planned income USD' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'LBP' }));
    expect(screen.queryByRole('region', { name: 'Planned income USD' })).not.toBeInTheDocument();
    expect(screen.getByText('Set planned income')).toBeInTheDocument();
  });

  it('presents the missing-income state as one primary call to action without a nested box', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('tab', { name: 'LBP' }));
    const button = screen.getByRole('button', { name: /Set planned income/ });
    expect(button.className).toContain('cr-button--primary');
    expect(button.className).toContain('cr-button--block');
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
    setup({
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
    expect(list.querySelectorAll('.cr-progress')).toHaveLength(2);
    expect(list.querySelectorAll('.cr-progress--over')).toHaveLength(1);
  });

  it('shows each target share of planned income without replacing spent-versus-target context', () => {
    setup({
      summaries: [summary({ plannedIncomeMinor: '300000' })],
      categoryRows: [categoryRow({ targetMinor: '100000', actualSpentMinor: '80000' })],
    });
    const row = screen.getByText('Groceries').closest('li');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('33% of planned income')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('$800.00').closest('p')).toHaveTextContent('$800.00 spent');
    expect(within(row as HTMLElement).getByText('$1,000.00')).toBeInTheDocument();
  });

  it('shows an empty category and loan state for the selected currency', async () => {
    const user = userEvent.setup();
    setup({ categoryRows: [categoryRow()], loansSummary: [loansSummary()] });
    await user.click(screen.getByRole('tab', { name: 'LBP' }));
    expect(screen.getByText('No category targets this month.')).toBeInTheDocument();
    expect(screen.getByText('No loan commitments this month.')).toBeInTheDocument();
  });

  it('summarizes category and loan commitments against planned income', () => {
    setup({
      summaries: [summary({ plannedIncomeMinor: '300000', categoryTargetTotalMinor: '200000', loanCommitmentMinor: '50000', unallocatedMinor: '50000' })],
      loansSummary: [loansSummary({ targetMinor: '50000', actualRepaymentMinor: '10000', remainingReservationMinor: '40000' })],
    });
    const remaining = screen.getByRole('region', { name: 'Left to allocate USD' });
    expect(within(remaining).getByText('83% allocated')).toBeInTheDocument();
    const commitments = screen.getByRole('region', { name: 'Loan commitments' });
    expect(within(commitments).getByText('$500.00')).toBeInTheDocument();
    expect(within(commitments).getByText('$100.00').closest('small')).toHaveTextContent('$100.00 paid this month');
  });

  it('shows named outgoing loan commitments when current loan data is available', () => {
    setup({
      loansSummary: [loansSummary({ targetMinor: '50000' })],
      loanRows: [
        owedLoan(),
        owedLoan({ id: 'loan-karim', personName: 'Karim', plan: { targetMinor: '30000', actualRepaymentMinor: '0', remainingReservationMinor: '30000', dueAmountMinor: '0', expectedCollectionMinor: '0' } }),
        owedLoan({ id: 'loan-receivable', direction: 'they_owe_me', personName: 'Omar' }),
      ],
    });
    const commitments = screen.getByRole('region', { name: 'Loan commitments' });
    expect(within(commitments).getByText('Maya').closest('bdi')).not.toBeNull();
    expect(within(commitments).getByText('Karim').closest('bdi')).not.toBeNull();
    expect(within(commitments).queryByText('Omar')).not.toBeInTheDocument();
    expect(within(commitments).getByText('$200.00')).toBeInTheDocument();
    expect(within(commitments).getByText('$300.00')).toBeInTheDocument();
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

  it('renders Arabic copy without leaking English labels', async () => {
    const user = userEvent.setup();
    setup({ locale: 'ar' });
    expect(screen.getByRole('tablist', { name: 'العملة' })).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'الدخل المخطط USD' });
    await user.click(within(card).getByRole('button', { name: 'تعديل الدخل المخطط USD' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('الدخل المخطط');
    expect(within(dialog).getByRole('button', { name: 'إلغاء' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'حفظ' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'إلغاء' }));
    const targets = screen.getByRole('region', { name: 'أهداف الفئات' });
    expect(within(targets).getByText('بقالة')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'التزامات الديون' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Category targets' })).not.toBeInTheDocument();
  });
});
