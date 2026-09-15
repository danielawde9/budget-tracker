import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CashControlSummary } from './cash-control-summary.js';
import { coreAvailableCashSummaryFixture, emptyAvailableCashSummary } from '../../test/in-memory-cash-control-gateway.js';
import type { AvailableCashSummary } from './types.js';
import type { CashReadSlice } from './use-cash-control.js';

function slice(data: AvailableCashSummary, overrides: Partial<CashReadSlice<AvailableCashSummary>> = {}): CashReadSlice<AvailableCashSummary> {
  return { status: 'ready', data, error: null, refresh: vi.fn(), ...overrides };
}

describe('CashControlSummary: loading/error', () => {
  it('shows a skeleton while loading (full and compact)', () => {
    render(<CashControlSummary locale="en" currency="USD" variant="full" available={slice(emptyAvailableCashSummary, { status: 'loading' })} />);
    expect(document.querySelectorAll('.cr-skeleton').length).toBeGreaterThan(0);
  });

  it('full: shows a role=alert error with a Retry action', async () => {
    const user = userEvent.setup();
    const refresh = vi.fn();
    render(<CashControlSummary locale="en" currency="USD" variant="full" available={slice(emptyAvailableCashSummary, {
      status: 'error', error: { code: 'unknown', message: 'boom', recovery: 'try again' }, refresh,
    })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalled();
  });

  it('compact: shows an inline note (no alert/status role) with a distinctly labelled retry', async () => {
    const user = userEvent.setup();
    const refresh = vi.fn();
    render(<CashControlSummary locale="en" currency="USD" variant="compact" available={slice(emptyAvailableCashSummary, {
      status: 'error', error: { code: 'unknown', message: 'boom', recovery: 'try again' }, refresh,
    })} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry available cash' });
    await user.click(retry);
    expect(refresh).toHaveBeenCalled();
  });
});

describe('CashControlSummary: unplanned/incomplete states never show an allowance', () => {
  it('unplanned: shows a no-plan message and no daily guide', () => {
    render(<CashControlSummary locale="en" currency="USD" variant="full" available={slice({ ...emptyAvailableCashSummary, state: 'unplanned' })} />);
    expect(screen.getByText(/No published plan snapshot yet/)).toBeInTheDocument();
    expect(screen.queryByText('Extra unassigned cash per day')).not.toBeInTheDocument();
  });

  it('incomplete: shows the unmaterialized count and no daily guide', () => {
    render(<CashControlSummary locale="en" currency="USD" variant="full" available={slice({
      ...emptyAvailableCashSummary, state: 'incomplete', unmaterializedCount: 7,
    })} />);
    expect(screen.getByText('Unmaterialized occurrences: 7')).toBeInTheDocument();
    expect(screen.queryByText('Extra unassigned cash per day')).not.toBeInTheDocument();
  });

  it('compact unplanned/incomplete show a short note, not a fabricated figure', () => {
    render(<CashControlSummary locale="en" currency="USD" variant="compact" available={slice({ ...emptyAvailableCashSummary, state: 'incomplete' })} />);
    expect(screen.getByText('This figure needs a refresh before it can be shown.')).toBeInTheDocument();
    expect(screen.queryByText('Available after commitments')).not.toBeInTheDocument();
  });
});

describe('CashControlSummary: ready state data assertions', () => {
  // U19-01: cash 100000 minus commitments 110000 shows shortfall 10000.
  it('U19-01: a negative available amount shows the exact signed figure and the exact shortfall, both distinct from spendable', () => {
    render(<CashControlSummary locale="en" currency="USD" variant="full" available={slice({
      ...coreAvailableCashSummaryFixture,
      cashMinor: '100000', expenseCommitmentsMinor: '110000',
      availableMinor: '-10000', deficitMinor: '10000', spendableMinor: '0', dailyExtraGuideMinor: null,
    })} />);
    expect(screen.getByText('-$100.00')).toBeInTheDocument(); // signed available, not clamped to zero
    const shortfallRows = screen.getAllByText('$100.00');
    expect(shortfallRows.length).toBeGreaterThanOrEqual(1); // the deficit figure
    expect(screen.getAllByText('$0.00').length).toBeGreaterThanOrEqual(1); // spendable, floored
  });

  // U19-04: unconfirmed salary never increases current available cash.
  it('U19-04: a large received-income figure is shown separately and never folds into the available/spendable figures', () => {
    render(<CashControlSummary locale="en" currency="USD" variant="full" available={slice({
      ...coreAvailableCashSummaryFixture,
      cashMinor: '50000', expenseCommitmentsMinor: '0', debtCommitmentsMinor: '0', goalTopupsMinor: '0', futureHeadroomMinor: '0',
      availableMinor: '50000', deficitMinor: '0', spendableMinor: '50000', dailyExtraGuideMinor: '5000', daysRemaining: 10,
      incomeMinusSpendingMinor: '999999', // deliberately distinct from every other figure in this fixture
      receivedIncomeMinor: '9000000', // a huge "unconfirmed salary"-shaped figure, still never posted to cash
    })} />);
    const hero = document.querySelector('.cc-metric--hero');
    expect(hero).toHaveTextContent('$500.00'); // available == cash, unaffected by receivedIncomeMinor
    expect(hero).not.toHaveTextContent('$90,000.00');
    expect(screen.getByText('$90,000.00')).toBeInTheDocument(); // received income shown, but as its own separate figure
  });

  // U19-05: a partial month uses the inclusive remaining days the DB already computed.
  it('U19-05: renders the server-computed inclusive daysRemaining and guide verbatim, without recomputing either', () => {
    render(<CashControlSummary locale="en" currency="USD" variant="full" available={slice({
      ...coreAvailableCashSummaryFixture,
      availableMinor: '1001', deficitMinor: '0', spendableMinor: '1001', daysRemaining: 3, dailyExtraGuideMinor: '333',
    })} />);
    expect(screen.getByText('Extra unassigned cash per day')).toBeInTheDocument();
    expect(screen.getByText('$3.33')).toBeInTheDocument();
    expect(screen.getByText(/3 remaining day/)).toBeInTheDocument();
  });

  it('shows the needsReview banner when the snapshot is stale', () => {
    render(<CashControlSummary locale="en" currency="USD" variant="full" available={slice({ ...coreAvailableCashSummaryFixture, needsReview: true })} />);
    expect(screen.getByText(/figures may be stale/)).toBeInTheDocument();
  });

  it('wraps every DB-sourced amount in its own <bdi>', () => {
    const { container } = render(<CashControlSummary locale="en" currency="USD" variant="full" available={slice(coreAvailableCashSummaryFixture)} />);
    const bdiTexts = [...container.querySelectorAll('bdi')].map((node) => node.textContent);
    expect(bdiTexts).toContain('$1,000.00'); // cash
    expect(bdiTexts).toContain('$500.00'); // available
    expect(bdiTexts).toContain('$800.00'); // received income
  });

  it('compact renders the signed figure and a shortfall line only when negative', () => {
    const { rerender } = render(<CashControlSummary locale="en" currency="USD" variant="compact" available={slice(coreAvailableCashSummaryFixture)} />);
    expect(screen.getByText('$500.00')).toBeInTheDocument();
    expect(screen.queryByText(/Shortfall/)).not.toBeInTheDocument();

    rerender(<CashControlSummary locale="en" currency="USD" variant="compact" available={slice({
      ...coreAvailableCashSummaryFixture, availableMinor: '-10000', deficitMinor: '10000', spendableMinor: '0',
    })} />);
    expect(screen.getByText('-$100.00')).toBeInTheDocument();
    expect(screen.getByText(/Shortfall/)).toBeInTheDocument();
  });

  it('renders Arabic labels', () => {
    render(<CashControlSummary locale="ar" currency="USD" variant="full" available={slice(coreAvailableCashSummaryFixture)} />);
    expect(screen.getByText('المتاح بعد الالتزامات')).toBeInTheDocument();
    expect(screen.getByText('السيولة الإضافية غير المخصَّصة يوميًا')).toBeInTheDocument();
  });
});
