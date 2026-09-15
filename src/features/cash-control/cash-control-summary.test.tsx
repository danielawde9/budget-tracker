import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CashControlSummary } from './cash-control-summary.js';
import { CashOutlookChart } from './cash-outlook-chart.js';
import { CommitmentBreakdown } from './commitment-breakdown.js';
import {
  coreAvailableCashSummaryFixture, coreCashOutlookFixture, emptyAvailableCashSummary, InMemoryCashControlGateway,
} from '../../test/in-memory-cash-control-gateway.js';
import type { AvailableCashSummary, CashControlGateway } from './types.js';
import { useCashControl } from './use-cash-control.js';
import type { CashReadSlice } from './use-cash-control.js';

function slice(data: AvailableCashSummary, overrides: Partial<CashReadSlice<AvailableCashSummary>> = {}): CashReadSlice<AvailableCashSummary> {
  return { status: 'ready', data, error: null, refresh: vi.fn(), ...overrides };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((doResolve) => { resolve = doResolve; });
  return { promise, resolve };
}

/** Mounts the real `useCashControl` hook (not a fake `CashReadSlice`) and
 * renders its `available` slice through the real `CashControlSummary`
 * component -- used specifically to prove the hook's own generation/abort
 * and membership-loss handling (already proved in isolation by task 18's
 * `use-cash-control.test.tsx`) surfaces correctly in this component's
 * rendered output, per this task's own Task 1 requirement to cover a space
 * switch while loading and revoked-membership recovery at the component
 * layer -- not just re-asserted at the hook layer a second time. */
function HookWiredSummary({ gateway, spaceId, onSpaceUnavailable }: {
  gateway: CashControlGateway; spaceId: string; onSpaceUnavailable?: () => void;
}) {
  const cashControl = useCashControl(gateway, spaceId, 'USD', '2026-09-15', 60, 'expected', onSpaceUnavailable);
  return <CashControlSummary locale="en" currency="USD" variant="full" available={cashControl.available} />;
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

  // U19-03: a paid bill leaves the forecast exactly once -- reflected as a
  // reduction in actual cash, never as a remaining commitment AND never
  // again as a projected future outflow. Proved by rendering the summary
  // and the outlook together (as `CashControlSection` composes them) for
  // "before payment" and "after payment" snapshots of the same $500 rent
  // bill, and asserting the $500 never appears twice.
  it('U19-03: a paid bill is reflected once (reduced cash), never as a remaining commitment or a repeated projected outflow', () => {
    const beforePayment: AvailableCashSummary = {
      ...coreAvailableCashSummaryFixture,
      cashMinor: '150000', expenseCommitmentsMinor: '50000', debtCommitmentsMinor: '0', goalTopupsMinor: '0', futureHeadroomMinor: '0',
      availableMinor: '100000', deficitMinor: '0', spendableMinor: '100000', dailyExtraGuideMinor: null,
      groups: [{
        id: '00000000-0000-4000-8000-000000000901', nameEn: 'Essentials', nameAr: null,
        budgetRemainingMinor: '0', unpaidBillsMinor: '50000', goalOverlapMinor: '0', commitmentMinor: '50000',
      }],
    };
    const beforeOutlook = {
      ...coreCashOutlookFixture,
      days: [{ date: '2026-09-15', openingCashMinor: '150000', expectedIncomeMinor: '0', expectedOutflowMinor: '50000', closingCashMinor: '100000' }],
    };
    const { rerender } = render(<>
      <CashControlSummary locale="en" currency="USD" variant="full" available={slice(beforePayment)} />
      <CommitmentBreakdown locale="en" currency="USD" groups={beforePayment.groups} />
      <CashOutlookChart locale="en" currency="USD" outlook={{ status: 'ready', data: beforeOutlook, error: null, refresh: vi.fn() }} scenario="expected" onScenarioChange={vi.fn()} />
    </>);
    expect(document.querySelector('.cc-metric--hero')).toHaveTextContent('$1,000.00'); // available, pre-payment
    expect(screen.getByText('Essentials').closest('tr')).toHaveTextContent('$500.00'); // still an unpaid bill
    expect(screen.getByText('2026-09-15').closest('tr')).toHaveTextContent('$500.00'); // still a projected outflow

    // After payment: cash drops by exactly 50000 (the bill is now settled,
    // out of actual cash), the group's unpaid-bill/commitment lines drop to
    // zero (nothing left owed), and today's outlook outflow also drops to
    // zero (a settled occurrence is never projected again) -- while
    // available/spendable end up identical to before, since paying a bill
    // that was already fully committed moves money, it does not create or
    // destroy it.
    const afterPayment: AvailableCashSummary = {
      ...beforePayment,
      cashMinor: '100000', expenseCommitmentsMinor: '0',
      availableMinor: '100000', spendableMinor: '100000',
      groups: [{ ...beforePayment.groups[0]!, unpaidBillsMinor: '0', commitmentMinor: '0' }],
    };
    const afterOutlook = {
      ...beforeOutlook,
      days: [{ date: '2026-09-15', openingCashMinor: '100000', expectedIncomeMinor: '0', expectedOutflowMinor: '0', closingCashMinor: '100000' }],
    };
    rerender(<>
      <CashControlSummary locale="en" currency="USD" variant="full" available={slice(afterPayment)} />
      <CommitmentBreakdown locale="en" currency="USD" groups={afterPayment.groups} />
      <CashOutlookChart locale="en" currency="USD" outlook={{ status: 'ready', data: afterOutlook, error: null, refresh: vi.fn() }} scenario="expected" onScenarioChange={vi.fn()} />
    </>);
    expect(document.querySelector('.cc-metric--hero')).toHaveTextContent('$1,000.00'); // unchanged: money moved, not created/lost
    const groupRow = screen.getByText('Essentials').closest('tr')!;
    expect(groupRow).toHaveTextContent('$0.00');
    expect(groupRow).not.toHaveTextContent('$500.00'); // the bill is gone from "still owed"
    const outlookRow = screen.getByText('2026-09-15').closest('tr')!;
    expect(outlookRow).not.toHaveTextContent('$500.00'); // and never re-appears as a projected outflow
  });
});

describe('CashControlSummary: real hook wiring covers a space switch while loading and revoked-membership recovery', () => {
  it('discards a stale response from the prior space and renders only the fresh space’s figure after switching while loading', async () => {
    const first = deferred<AvailableCashSummary>();
    const second = deferred<AvailableCashSummary>();
    const gateway: CashControlGateway = {
      loadAvailable: vi.fn((input: { spaceId: string }) => input.spaceId === 'space-1' ? first.promise : second.promise),
      loadOutlook: vi.fn(async () => coreCashOutlookFixture),
    };
    const { rerender } = render(<HookWiredSummary gateway={gateway} spaceId="space-1" />);
    expect(document.querySelectorAll('.cr-skeleton').length).toBeGreaterThan(0); // still loading space-1

    rerender(<HookWiredSummary gateway={gateway} spaceId="space-2" />);
    second.resolve({ ...coreAvailableCashSummaryFixture, availableMinor: '77700', spendableMinor: '77700', deficitMinor: '0' });
    await waitFor(() => expect(document.querySelector('.cc-metric--hero')).toHaveTextContent('$777.00'));

    // The stale space-1 response resolves late; it must never overwrite
    // the already-rendered fresh space-2 figure.
    first.resolve({ ...coreAvailableCashSummaryFixture, availableMinor: '11100', spendableMinor: '11100', deficitMinor: '0' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('.cc-metric--hero')).not.toHaveTextContent('$111.00');
    expect(document.querySelector('.cc-metric--hero')).toHaveTextContent('$777.00');
  });

  it('clears the visible figure and calls onSpaceUnavailable when membership is revoked, then recovers once a valid space is selected', async () => {
    const gateway = new InMemoryCashControlGateway();
    gateway.error = Object.assign(new Error('planning_not_authorized'), { code: '42501' });
    const onSpaceUnavailable = vi.fn();
    const { rerender } = render(<HookWiredSummary gateway={gateway} spaceId="revoked-space" onSpaceUnavailable={onSpaceUnavailable} />);
    await waitFor(() => expect(onSpaceUnavailable).toHaveBeenCalled());
    expect(document.querySelectorAll('.cr-skeleton').length).toBeGreaterThan(0); // membership loss clears data back to loading
    expect(screen.queryByText('Available after commitments')).not.toBeInTheDocument();

    gateway.error = null;
    gateway.available = coreAvailableCashSummaryFixture;
    rerender(<HookWiredSummary gateway={gateway} spaceId="valid-space" onSpaceUnavailable={onSpaceUnavailable} />);
    await waitFor(() => expect(document.querySelector('.cc-metric--hero')).toHaveTextContent('$500.00'));
  });
});
