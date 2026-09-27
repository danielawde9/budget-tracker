import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { JournalEvent } from '../wallets/types.js';
import type { MonthlyCashSummary } from '../reports/types.js';
import { HomeScreen } from './home-screen.js';
import type { HomeScreenProps } from './home-screen.js';

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
  loansOutstanding: [] as HomeScreenProps['loansOutstanding'],
  recentEvents: [] as readonly JournalEvent[],
  cashControlByCurrency: [] as HomeScreenProps['cashControlByCurrency'],
};

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
  it('labels net position per currency and keeps the month selector', () => {
    render(<HomeScreen {...props} />);
    expect(screen.getByRole('region', { name: 'Net position' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Net position' }).querySelector('.cr-amount--metric')).toHaveTextContent('$1,284.50');
    expect(screen.getByRole('region', { name: 'Net position' })).toHaveTextContent('LBP86,700,000');
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
    expect(screen.getByText('117%')).toBeInTheDocument();
  });

  it('falls back to a localized Uncategorized label for null names', () => {
    render(<HomeScreen {...props} budgets={[{
      categoryKey: 'uncategorized', nameEn: null, nameAr: null, kind: 'expense' as const,
      currency: 'USD' as const, actualNetMinor: '5000', budgetMinor: null, remainingMinor: null,
    }]} />);
    expect(screen.getByText('Uncategorized')).toBeInTheDocument();
    expect(document.querySelector('.cr-progress')).toBeNull();
  });

  it('renders Arabic LBP amounts with a separate currency label', () => {
    render(<HomeScreen {...props} locale="ar" />);
    expect(screen.getByRole('region', { name: 'صافي المركز' })).toHaveTextContent('LBP٨٦٬٧٠٠٬٠٠٠');
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

  it('compares real income and expense in one selected currency at a time', async () => {
    const user = userEvent.setup();
    const trend: MonthlyCashSummary[] = [
      { periodMonth: '2026-09-01', periodRole: 'current', currency: 'USD', incomeNetMinor: '70000', expenseNetMinor: '-40000', walletDeltaNetMinor: '30000' },
      { periodMonth: '2026-09-01', periodRole: 'current', currency: 'LBP', incomeNetMinor: '2000000', expenseNetMinor: '-1500000', walletDeltaNetMinor: '500000' },
    ];
    render(<HomeScreen {...props} trend={trend} />);
    const chart = screen.getByRole('region', { name: 'Monthly trend' });
    expect(chart).toHaveTextContent('USD');
    expect(chart).toHaveTextContent('LBP');
    expect(chart).toHaveTextContent('Income');
    expect(chart).toHaveTextContent('Expenses');
    expect(screen.getByRole('img', { name: /USD · Income \$700\.00/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /USD · Expenses \$400\.00/ })).toBeInTheDocument();
    expect(chart.querySelectorAll('[data-series="income"]')).toHaveLength(1);
    expect(chart.querySelectorAll('[data-series="expense"]')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'LBP', pressed: false }));
    expect(screen.getByRole('img', { name: /LBP · Income LBP 2,000,000/ })).toBeInTheDocument();
    expect(chart.querySelectorAll('[data-series="income"]')).toHaveLength(1);
    expect(chart.querySelectorAll('[data-series="expense"]')).toHaveLength(1);
  });

  it('shows recent activity with positive styling for income and hides the loans card when empty', () => {
    render(<HomeScreen {...props} recentEvents={[event({ payeeName: 'Employer' })]} />);
    expect(screen.getByText('Employer')).toBeInTheDocument();
    expect(screen.getByText('$250.00')).toHaveClass('cr-positive');
    expect(screen.queryByRole('region', { name: 'Loans' })).not.toBeInTheDocument();
  });

  it('opens the full journal from recent activity and keeps Record for the empty state', async () => {
    const user = userEvent.setup();
    const onSeeAll = vi.fn();
    const onRecord = vi.fn();
    const { rerender } = render(<HomeScreen {...props} recentEvents={[event({ payeeName: 'Employer' })]} onSeeAll={onSeeAll} onRecord={onRecord} />);
    await user.click(screen.getByRole('button', { name: 'See all activity' }));
    expect(onSeeAll).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument();

    rerender(<HomeScreen {...props} recentEvents={[]} onSeeAll={onSeeAll} onRecord={onRecord} />);
    await user.click(screen.getByRole('button', { name: 'Record' }));
    expect(onRecord).toHaveBeenCalledOnce();
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

  it('keeps loan receivables and debts distinct in the Home summary', () => {
    render(<HomeScreen {...props} loansOutstanding={[
      { loanId: 'loan-1', personName: 'Maya', currency: 'USD', direction: 'they_owe_me', outstandingMinor: '50000' },
      { loanId: 'loan-2', personName: 'Sam', currency: 'USD', direction: 'i_owe_them', outstandingMinor: '25000' },
    ]} />);
    const loans = screen.getByRole('region', { name: 'Loans' });
    expect(loans).toHaveTextContent('Maya');
    expect(loans).toHaveTextContent('Owes you');
    expect(loans).toHaveTextContent('$500.00');
    expect(loans).toHaveTextContent('Sam');
    expect(loans).toHaveTextContent('You owe');
    expect(loans).toHaveTextContent('$250.00');
    expect(loans).not.toHaveTextContent('Total outstanding');
  });

  it('adds receivables and subtracts debts from wallet balances per currency', () => {
    render(<HomeScreen {...props} loansOutstanding={[
      { loanId: 'loan-1', personName: 'Maya', currency: 'USD', direction: 'they_owe_me', outstandingMinor: '50000' },
      { loanId: 'loan-2', personName: 'Sam', currency: 'USD', direction: 'i_owe_them', outstandingMinor: '25000' },
    ]} />);
    const netPosition = screen.getByRole('region', { name: 'Net position' });
    expect(netPosition).toHaveTextContent('$1,534.50');
    expect(netPosition).toHaveTextContent('Wallets $1,284.50');
    expect(netPosition).toHaveTextContent('Loans net $250.00');
    expect(netPosition).toHaveTextContent('LBP');
  });
});
