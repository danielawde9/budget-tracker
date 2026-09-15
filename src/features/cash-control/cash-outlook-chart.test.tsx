import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CashOutlookChart } from './cash-outlook-chart.js';
import type { CashOutlook } from './types.js';
import type { CashReadSlice } from './use-cash-control.js';

function slice(overrides: Partial<CashReadSlice<CashOutlook>> = {}): CashReadSlice<CashOutlook> {
  return {
    status: 'ready',
    data: {
      currency: 'USD', startDate: '2026-09-15', scenario: 'expected',
      assumption: 'Projects only unpaid scheduled income and scheduled bills.',
      days: [], firstNegativeDate: null, state: 'ready', overdueCount: 0, overdueMinor: '0',
    },
    error: null,
    refresh: vi.fn(),
    ...overrides,
  };
}

function renderChart(
  overrides: Partial<CashReadSlice<CashOutlook>> = {},
  scenario: 'expected' | 'no_future_income' = 'expected',
  onScenarioChange = vi.fn(),
  locale: 'en' | 'ar' = 'en',
) {
  return { onScenarioChange, ...render(
    <CashOutlookChart locale={locale} currency="USD" outlook={slice(overrides)} scenario={scenario} onScenarioChange={onScenarioChange} />,
  ) };
}

describe('CashOutlookChart', () => {
  it('shows a loading skeleton', () => {
    renderChart({ status: 'loading' });
    expect(document.querySelectorAll('.cr-skeleton').length).toBeGreaterThan(0);
  });

  it('shows an error with a retry action that calls refresh', async () => {
    const user = userEvent.setup();
    const refresh = vi.fn();
    renderChart({ status: 'error', error: { code: 'unknown', message: 'boom', recovery: 'try again' }, refresh });
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalled();
  });

  it('shows an incomplete-window message and no chart when state is incomplete', () => {
    renderChart({ data: { ...slice().data, state: 'incomplete' } });
    expect(screen.getByText(/forecast is incomplete/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows an empty-window message when ready with no days', () => {
    renderChart();
    expect(screen.getByText('No forecast days in this window yet.')).toBeInTheDocument();
  });

  it('shows "no shortfall projected" when firstNegativeDate is null, and renders every day as a table row', () => {
    renderChart({
      data: {
        ...slice().data,
        days: [
          { date: '2026-09-15', openingCashMinor: '100000', expectedIncomeMinor: '0', expectedOutflowMinor: '20000', closingCashMinor: '80000' },
          { date: '2026-09-16', openingCashMinor: '80000', expectedIncomeMinor: '0', expectedOutflowMinor: '10000', closingCashMinor: '70000' },
        ],
      },
    });
    expect(screen.getByText('No shortfall projected in this window.')).toBeInTheDocument();
    expect(screen.getByText('2026-09-15')).toBeInTheDocument();
    expect(screen.getByText('2026-09-16')).toBeInTheDocument();
  });

  it('flags the first-negative-date row, colors the closing cash danger, and renders a negative-side bar segment', () => {
    renderChart({
      data: {
        ...slice().data,
        firstNegativeDate: '2026-09-16',
        days: [
          { date: '2026-09-15', openingCashMinor: '100000', expectedIncomeMinor: '0', expectedOutflowMinor: '80000', closingCashMinor: '20000' },
          { date: '2026-09-16', openingCashMinor: '20000', expectedIncomeMinor: '0', expectedOutflowMinor: '30000', closingCashMinor: '-10000' },
        ],
      },
    });
    expect(screen.getByText('First shortfall')).toBeInTheDocument();
    const negativeRow = screen.getByText('2026-09-16').closest('tr')!;
    expect(negativeRow).toHaveAttribute('data-first-negative', 'true');
    expect(negativeRow.querySelector('.cc-danger-text')).toBeInTheDocument();
    const negativeSegment = negativeRow.querySelector('.cc-signed-bar-negative') as HTMLElement;
    expect(negativeSegment.style.inlineSize).not.toBe('0%');
    const positiveRow = screen.getByText('2026-09-15').closest('tr')!;
    const positiveSegment = positiveRow.querySelector('.cc-signed-bar-positive') as HTMLElement;
    expect(positiveSegment.style.inlineSize).not.toBe('0%');
  });

  it('shows the overdue count and amount, bucketed into today', () => {
    renderChart({
      data: {
        ...slice().data, overdueCount: 2, overdueMinor: '15000',
        days: [{ date: '2026-09-15', openingCashMinor: '100000', expectedIncomeMinor: '0', expectedOutflowMinor: '12000', closingCashMinor: '88000' }],
      },
    });
    expect(screen.getByText(/Overdue/).closest('p')).toHaveTextContent('2');
    expect(screen.getByText('$150.00')).toBeInTheDocument();
  });

  it('calls onScenarioChange when a scenario tab is clicked, and marks the active one selected', async () => {
    const user = userEvent.setup();
    const { onScenarioChange } = renderChart({}, 'expected');
    const conservative = screen.getByRole('tab', { name: 'Conservative (no future income)' });
    expect(conservative).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Expected income' })).toHaveAttribute('aria-selected', 'true');
    await user.click(conservative);
    expect(onScenarioChange).toHaveBeenCalledWith('no_future_income');
  });

  it('wraps every amount in its own <bdi>', () => {
    const { container } = renderChart({
      data: {
        ...slice().data,
        overdueCount: 1, overdueMinor: '5000',
        days: [{ date: '2026-09-15', openingCashMinor: '100000', expectedIncomeMinor: '0', expectedOutflowMinor: '20000', closingCashMinor: '80000' }],
      },
    });
    const bdiTexts = [...container.querySelectorAll('bdi')].map((node) => node.textContent);
    expect(bdiTexts).toContain('$1,000.00'); // opening cash
    expect(bdiTexts).toContain('$800.00'); // closing cash
    expect(bdiTexts).toContain('$50.00'); // overdue amount
  });

  it('renders Arabic labels', () => {
    renderChart({}, 'expected', vi.fn(), 'ar');
    expect(screen.getByText('التوقع المتوقع')).toBeInTheDocument();
    expect(screen.getByText('لا توجد أيام توقع في هذا النطاق بعد.')).toBeInTheDocument();
  });
});
