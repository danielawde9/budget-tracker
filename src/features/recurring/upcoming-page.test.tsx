import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UpcomingPage } from './upcoming-page.js';
import type { ScheduledOccurrencePage, ScheduledOccurrenceRow } from './types.js';
import type { RecurringState } from './use-recurring.js';

const OCCURRENCE_ID = '00000000-0000-4000-8000-000000000401';
const ASOF = '2026-09-14';

function row(overrides: Partial<ScheduledOccurrenceRow> = {}): ScheduledOccurrenceRow {
  return {
    id: OCCURRENCE_ID, scheduleId: '00000000-0000-4000-8000-000000000301', sourceRevisionId: '1', currentEventId: '3',
    currency: 'USD', kind: 'expense', nameEn: 'Rent', nameAr: null, dueDate: '2026-09-30',
    expectedMinor: '50000', settledMinor: '20000', remainingMinor: '30000', state: 'partial', overdue: false,
    categoryId: null, loanId: null, fundingGoalId: null, preferredWalletId: null, fundingShortfallMinor: null,
    asOf: ASOF, ...overrides,
  };
}

function page(rows: readonly ScheduledOccurrenceRow[] = [row()]): ScheduledOccurrencePage {
  return { rows, hasMore: false, nextCursor: null, asOf: ASOF };
}

function fakeRecurringState(overrides: Partial<RecurringState> = {}): RecurringState {
  return {
    status: 'ready', page: page(), truncated: false, error: null, pending: false, ambiguous: null,
    refresh: vi.fn(), saveSchedule: vi.fn(), materialize: vi.fn(), setOccurrenceState: vi.fn(),
    confirm: vi.fn(), linkExisting: vi.fn(), retryAmbiguous: vi.fn(), clearAmbiguous: vi.fn(),
    ...overrides,
  } as unknown as RecurringState;
}

function editorProps() {
  return {
    currency: 'USD' as const,
    referenceOptions: { categories: [], loans: [], goals: [], wallets: [] },
    plannedIncomeByCurrency: { USD: null, LBP: null } as const,
    walletOptions: [],
  };
}

describe('UpcomingPage', () => {
  it('shows a loading state', () => {
    render(<UpcomingPage locale="en" {...editorProps()} recurring={fakeRecurringState({ status: 'loading', page: page([]) })} fromDate="2026-09-01" toDate="2026-11-30" />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('U16-01: an occurrence expecting 50000 with 20000 settled shows 30000 remaining', () => {
    render(<UpcomingPage locale="en" {...editorProps()} recurring={fakeRecurringState()} fromDate="2026-09-01" toDate="2026-11-30" />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('$500.00')).toBeInTheDocument(); // expected
    expect(within(table).getByText('$200.00')).toBeInTheDocument(); // settled
    expect(within(table).getByText('$300.00')).toBeInTheDocument(); // remaining
    expect(within(table).getByText('40%').closest('.rec-label-muted')).toHaveTextContent('40% settled');
  });

  it('shows only the selected currency and summarizes unsettled inflows and outflows in the current window', async () => {
    const recurring = fakeRecurringState({ page: page([
      row({ id: 'rent', nameEn: 'Rent', kind: 'expense', remainingMinor: '30000' }),
      row({ id: 'salary', nameEn: 'Salary', kind: 'income', expectedMinor: '100000', settledMinor: '0', remainingMinor: '100000', state: 'pending' }),
      row({ id: 'other-currency', nameEn: 'LBP bill', currency: 'LBP', expectedMinor: '5000000', settledMinor: '0', remainingMinor: '5000000', state: 'pending' }),
      row({ id: 'paid', nameEn: 'Paid bill', expectedMinor: '10000', settledMinor: '10000', remainingMinor: '0', state: 'settled' }),
    ]) });
    render(<UpcomingPage locale="en" {...editorProps()} recurring={recurring} fromDate="2026-09-01" toDate="2026-11-30" />);
    expect(screen.queryByText('LBP bill')).not.toBeInTheDocument();
    const summary = screen.getByRole('complementary', { name: 'Window summary' });
    expect(summary).toHaveTextContent('1 outflow');
    expect(summary).toHaveTextContent('$300.00');
    expect(summary).toHaveTextContent('1 inflow');
    expect(summary).toHaveTextContent('$1,000.00');
    const details = within(summary).getByText('Net and notes').closest('details');
    expect(details).not.toHaveAttribute('open');
    await userEvent.click(within(summary).getByText('Net and notes'));
    expect(details).toHaveAttribute('open');
    expect(details).toHaveTextContent('Net $700.00');
  });

  it('shows only the viewed month while retaining the longer materialization range', async () => {
    const recurring = fakeRecurringState({ page: page([
      row({ id: 'oct', nameEn: 'Monthly bill', dueDate: '2026-10-15' }),
      row({ id: 'nov', nameEn: 'Monthly bill', dueDate: '2026-11-15' }),
      row({ id: 'dec', nameEn: 'Monthly bill', dueDate: '2026-12-15' }),
    ]) });
    render(<UpcomingPage locale="en" {...editorProps()} recurring={recurring} fromDate="2026-10-01" toDate="2026-10-31"
      materializeFromDate="2026-10-01" materializeToDate="2026-12-31" />);
    expect(within(screen.getByRole('table')).getAllByText('Monthly bill')).toHaveLength(1);
    expect(screen.queryByText('2026-11-15')).not.toBeInTheDocument();
    expect(screen.queryByText('2026-12-15')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'In this month' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Window summary' })).toHaveTextContent('1 outflow');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh occurrences' }));
    expect(recurring.materialize).toHaveBeenCalledWith({ fromDate: '2026-10-01', toDate: '2026-12-31' });
  });

  it('U16-02: renders a February month-end due date verbatim, never shifted by client-side date math', () => {
    // A January-31 monthly schedule's February occurrence -- the DB (task
    // 14) already clamped this to the real month end; this UI never
    // reparses it through a `Date` object, so it can't reintroduce the
    // classic Jan31->Feb-overflow bug at the display layer.
    render(<UpcomingPage locale="en" {...editorProps()}
      recurring={fakeRecurringState({ page: page([row({ dueDate: '2026-02-28', asOf: '2026-02-14' })]) })}
      fromDate="2026-02-01" toDate="2026-03-31" />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('2026-02-28')).toBeInTheDocument();
    expect(within(table).queryByText(/2026-03-/)).not.toBeInTheDocument();
  });

  it('shows an empty state distinct from loading when there are no occurrences', () => {
    render(<UpcomingPage locale="en" {...editorProps()} recurring={fakeRecurringState({ page: page([]) })} fromDate="2026-09-01" toDate="2026-11-30" />);
    expect(screen.getByText(/No occurrences in this view yet/)).toBeInTheDocument();
  });

  it('shows a retry action on error', async () => {
    const recurring = fakeRecurringState({ status: 'error', page: page([]), error: { code: 'unknown', message: 'boom', recovery: 'try again' } });
    render(<UpcomingPage locale="en" {...editorProps()} recurring={recurring} fromDate="2026-09-01" toDate="2026-11-30" />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(recurring.refresh).toHaveBeenCalledTimes(1);
  });

  it('shows a refresh action after an accepted write whose follow-up read failed', async () => {
    const recurring = fakeRecurringState({ status: 'accepted-refresh-pending' });
    render(<UpcomingPage locale="en" {...editorProps()} recurring={recurring} fromDate="2026-09-01" toDate="2026-11-30" />);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(recurring.refresh).toHaveBeenCalledTimes(1);
  });

  it('shows check-again/dismiss actions while ambiguous', async () => {
    const recurring = fakeRecurringState({ status: 'ambiguous', ambiguous: { kind: 'confirm', requestId: 'req-1' } });
    render(<UpcomingPage locale="en" {...editorProps()} recurring={recurring} fromDate="2026-09-01" toDate="2026-11-30" />);
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(recurring.retryAmbiguous).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(recurring.clearAmbiguous).toHaveBeenCalledTimes(1);
  });

  it('disables Refresh occurrences while a command is saving, so a command never overlaps with an explicit materialize', () => {
    render(<UpcomingPage locale="en" {...editorProps()} recurring={fakeRecurringState({ status: 'saving' })} fromDate="2026-09-01" toDate="2026-11-30" />);
    expect(screen.getByRole('button', { name: 'Refresh occurrences' })).toBeDisabled();
  });

  it('U16-03: mounting the page -- even twice -- never calls materialize on its own; only the explicit button does, exactly once per click', async () => {
    const recurring = fakeRecurringState();
    const { unmount } = render(<UpcomingPage locale="en" {...editorProps()} recurring={recurring} fromDate="2026-09-01" toDate="2026-11-30" />);
    expect(recurring.materialize).not.toHaveBeenCalled();
    unmount();
    render(<UpcomingPage locale="en" {...editorProps()} recurring={recurring} fromDate="2026-09-01" toDate="2026-11-30" />);
    expect(recurring.materialize).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Refresh occurrences' }));
    expect(recurring.materialize).toHaveBeenCalledTimes(1);
    expect(recurring.materialize).toHaveBeenCalledWith({ fromDate: '2026-09-01', toDate: '2026-11-30' });
  });

  it('filters the list by status bucket', async () => {
    const overdueRow = row({ id: 'aaaa0000-0000-4000-8000-000000000001', nameEn: 'Overdue bill', overdue: true, state: 'pending' });
    const paidRow = row({ id: 'bbbb0000-0000-4000-8000-000000000002', nameEn: 'Paid bill', state: 'settled', settledMinor: '50000', remainingMinor: '0' });
    render(<UpcomingPage locale="en" {...editorProps()} recurring={fakeRecurringState({ page: page([overdueRow, paidRow]) })} fromDate="2026-09-01" toDate="2026-11-30" />);
    expect(screen.getByText('Overdue bill')).toBeInTheDocument();
    expect(screen.getByText('Paid bill')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Overdue' }));
    expect(screen.getByText('Overdue bill')).toBeInTheDocument();
    expect(screen.queryByText('Paid bill')).not.toBeInTheDocument();
  });

  it('shows a truncation alert (D10) verbatim in English and Arabic when a list hit the page cap', () => {
    const { rerender } = render(<UpcomingPage locale="en" {...editorProps()} recurring={fakeRecurringState({ truncated: true })} fromDate="2026-09-01" toDate="2026-11-30" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Showing the first 1,000 bills.');

    rerender(<UpcomingPage locale="ar" {...editorProps()} recurring={fakeRecurringState({ truncated: true })} fromDate="2026-09-01" toDate="2026-11-30" />);
    // Final review M4: Arabic-Indic digits, as amounts are written in Arabic.
    expect(screen.getByRole('alert')).toHaveTextContent('تُعرض أول ١٬٠٠٠ فاتورة.');
  });

  it('shows no truncation alert when the list was not truncated', () => {
    render(<UpcomingPage locale="en" {...editorProps()} recurring={fakeRecurringState({ truncated: false })} fromDate="2026-09-01" toDate="2026-11-30" />);
    expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument();
  });

  it('shows an over-100% settlement with a numeric overage, never just the clamped bar', () => {
    render(<UpcomingPage locale="en" {...editorProps()} recurring={fakeRecurringState({
      page: page([row({ expectedMinor: '10000', settledMinor: '15000', remainingMinor: '0', state: 'settled' })]),
    })} fromDate="2026-09-01" toDate="2026-11-30" />);
    expect(screen.getByText('$50.00').closest('.rec-overage-text')).toHaveTextContent('+$50.00');
  });

  it('opens the schedule editor and creates a schedule', async () => {
    const recurring = fakeRecurringState({
      saveSchedule: vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { scheduleId: 's1', revisionId: '1' } }),
    });
    render(<UpcomingPage locale="en" {...editorProps()} recurring={recurring} fromDate="2026-09-01" toDate="2026-11-30" />);
    await userEvent.click(screen.getByRole('button', { name: 'New schedule' }));
    const form = screen.getByRole('form', { name: 'Schedule details' });
    await userEvent.click(within(form).getByRole('button', { name: 'Next' })); // Type → Amount
    await userEvent.type(within(form).getByRole('textbox', { name: 'Expected amount' }), '500');
    await userEvent.click(within(form).getByRole('button', { name: 'Next' })); // → Details
    await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'Rent');
    await userEvent.type(within(form).getByLabelText('Starts on'), '2026-10-01');
    await userEvent.click(within(form).getByRole('button', { name: 'Next' })); // → References
    await userEvent.click(within(form).getByRole('button', { name: 'Next' })); // → Review
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(recurring.saveSchedule).toHaveBeenCalledTimes(1));
    expect(recurring.saveSchedule).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevisionId: null,
      definition: expect.objectContaining({ kind: 'expense', currency: 'USD', nameEn: 'Rent', expectedMinor: '50000', cadence: 'monthly', startsOn: '2026-10-01' }),
    }));
  });

  it('navigates to an occurrence detail view and back to the list', async () => {
    render(<UpcomingPage locale="en" {...editorProps()} recurring={fakeRecurringState()} fromDate="2026-09-01" toDate="2026-11-30" />);
    await userEvent.click(screen.getByRole('button', { name: /Review/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back to upcoming bills' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Back to upcoming bills' }));
    expect(screen.getByRole('button', { name: 'New schedule' })).toBeInTheDocument();
  });
});
