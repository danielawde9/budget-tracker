import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { formatMinorAmount } from '../wallets/money.js';
import type { JournalEvent } from '../wallets/types.js';
import type { MonthlyCashSummary } from '../reports/types.js';
import { HomeScreen } from './home-screen.js';

const props = {
  locale: 'en' as const,
  spaceKind: 'personal' as const,
  month: '2026-09-01',
  onMonthChange: vi.fn(),
  onRecord: vi.fn(),
  totals: [
    { currency: 'USD' as const, balanceMinor: '128450' },
    { currency: 'LBP' as const, balanceMinor: '86700000' },
  ],
  budgets: [{
    categoryKey: 'groceries', nameEn: 'Groceries', nameAr: 'بقالة', kind: 'expense' as const,
    currency: 'USD' as const, actualNetMinor: '21000', budgetMinor: '30000', remainingMinor: '9000',
  }],
  trend: [] as readonly MonthlyCashSummary[],
  dataStatus: 'ready' as const,
  dataError: null,
  onRetryLoad: vi.fn(),
  loansOutstanding: [] as readonly { loanId: string; personName: string; currency: 'USD' | 'LBP'; outstandingMinor: string }[],
  recentEvents: [] as readonly JournalEvent[],
};

function byExactText(expected: string) {
  return (_content: string, element: Element | null) =>
    element?.textContent === expected && element.children.length === 0;
}

function event(overrides: Partial<JournalEvent>): JournalEvent {
  return {
    id: 'event-1', spaceId: 'space-1', requestId: 'request-1', kind: 'income',
    effectiveDate: '2026-09-07', createdAt: '2026-09-07T10:00:00Z', reversalOf: null, reversedBy: null,
    loanLinked: false,
    movements: [{ walletId: 'wallet-1', walletName: 'Cash', currency: 'USD', amountMinor: '25000', walletArchived: false }],
    ...overrides,
  };
}

describe('HomeScreen', () => {
  it('shows net position per currency and the month selector', () => {
    render(<HomeScreen {...props} />);
    expect(screen.getByText('$1,284.50')).toBeInTheDocument();
    expect(screen.getByText(byExactText(formatMinorAmount('86700000', 'LBP', 'en')))).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('2026-09-01');
    expect(screen.getByText(/September 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Groceries/)).toBeInTheDocument();
  });

  it('shows the empty journal state', () => {
    render(<HomeScreen {...props} />);
    expect(screen.getByText('No transactions yet')).toBeInTheDocument();
  });

  it('marks over-budget categories with a warning style', () => {
    render(<HomeScreen {...props} budgets={[{
      categoryKey: 'groceries', nameEn: 'Groceries', nameAr: 'بقالة', kind: 'expense' as const,
      currency: 'USD' as const, actualNetMinor: '35000', budgetMinor: '30000', remainingMinor: '-5000',
    }]} />);
    expect(document.querySelector('.cr-progress--over')).not.toBeNull();
    expect(document.querySelector('.cr-warn-text')).not.toBeNull();
  });

  it('falls back to a localized Uncategorized label for null names', () => {
    render(<HomeScreen {...props} budgets={[{
      categoryKey: 'uncategorized', nameEn: null, nameAr: null, kind: 'expense' as const,
      currency: 'USD' as const, actualNetMinor: '5000', budgetMinor: null, remainingMinor: null,
    }]} />);
    expect(screen.getByText('Uncategorized')).toBeInTheDocument();
    expect(document.querySelector('.cr-progress')).toBeNull();
  });

  it('renders Arabic LBP amounts via formatMinorAmount', () => {
    render(<HomeScreen {...props} locale="ar" />);
    expect(screen.getByText(byExactText(formatMinorAmount('86700000', 'LBP', 'ar')))).toBeInTheDocument();
    expect(screen.getByText('لا توجد معاملات بعد')).toBeInTheDocument();
  });

  it('renders faded previous-month trend bars', () => {
    const trend: MonthlyCashSummary[] = [
      { periodMonth: '2026-08-01', periodRole: 'previous', currency: 'USD', incomeNetMinor: '0', expenseNetMinor: '-20000', walletDeltaNetMinor: '0' },
      { periodMonth: '2026-09-01', periodRole: 'current', currency: 'USD', incomeNetMinor: '0', expenseNetMinor: '-40000', walletDeltaNetMinor: '0' },
    ];
    render(<HomeScreen {...props} trend={trend} />);
    expect(document.querySelector('[data-role="previous"]')).not.toBeNull();
    expect(document.querySelector('.cr-bars [data-role="previous"]')).not.toBeNull();
  });

  it('shows recent activity with positive styling for income and hides the loans card when empty', () => {
    render(<HomeScreen {...props} recentEvents={[event({ payeeName: 'Employer' })]} />);
    expect(screen.getByText('Employer')).toBeInTheDocument();
    expect(screen.getByText('$250.00')).toHaveClass('cr-positive');
    expect(screen.queryByText(/Loans/)).not.toBeInTheDocument();
  });

  it('shows an inline error note with a retry action when data failed to load', async () => {
    const user = userEvent.setup();
    const onRetryLoad = vi.fn();
    render(<HomeScreen {...props} dataStatus="error" dataError="boom" onRetryLoad={onRetryLoad} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load the latest data.');
    expect(alert).toHaveTextContent('boom');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetryLoad).toHaveBeenCalledOnce();
  });

  it('shows outstanding loans grouped per currency', () => {
    render(<HomeScreen {...props} loansOutstanding={[
      { loanId: 'loan-1', personName: 'Maya', currency: 'USD', outstandingMinor: '50000' },
      { loanId: 'loan-2', personName: 'Sam', currency: 'USD', outstandingMinor: '25000' },
    ]} />);
    expect(screen.getByText('Maya')).toBeInTheDocument();
    expect(screen.getByText('$750.00')).toBeInTheDocument();
  });
});
