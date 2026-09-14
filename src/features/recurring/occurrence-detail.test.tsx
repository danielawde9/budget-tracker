import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OccurrenceDetail } from './occurrence-detail.js';
import type { ScheduledOccurrencePage, ScheduledOccurrenceRow } from './types.js';
import type { RecurringState } from './use-recurring.js';

const OCCURRENCE_ID = '00000000-0000-4000-8000-000000000401';
const OTHER_ID = '00000000-0000-4000-8000-000000000402';
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
    status: 'ready', page: page(), error: null, pending: false, ambiguous: null,
    refresh: vi.fn(), saveSchedule: vi.fn(), materialize: vi.fn(), setOccurrenceState: vi.fn(),
    confirm: vi.fn(), linkExisting: vi.fn(), retryAmbiguous: vi.fn(), clearAmbiguous: vi.fn(), loadMore: vi.fn(),
    ...overrides,
  } as unknown as RecurringState;
}

describe('OccurrenceDetail', () => {
  it('shows a fallback with a way back when the occurrence is no longer in the visible page', () => {
    const onBack = vi.fn();
    render(<OccurrenceDetail locale="en" recurring={fakeRecurringState({ page: page([row({ id: OTHER_ID })]) })} occurrenceId={OCCURRENCE_ID} onBack={onBack} />);
    expect(screen.getByRole('alert')).toHaveTextContent('This occurrence is no longer in the visible range.');
  });

  it('U16-01: shows expected/settled/remaining as distinct figures', () => {
    render(<OccurrenceDetail locale="en" recurring={fakeRecurringState()} occurrenceId={OCCURRENCE_ID} onBack={vi.fn()} />);
    expect(screen.getByText('$500.00')).toBeInTheDocument(); // expected
    expect(screen.getByText('$200.00')).toBeInTheDocument(); // settled
    expect(screen.getByText('$300.00')).toBeInTheDocument(); // remaining
    expect(screen.getByText('Due: 2026-09-30')).toBeInTheDocument();
  });

  it('shows an over-100% settlement with the exact numeric overage, from the raw BigInt values, not the clamped bar', () => {
    render(<OccurrenceDetail locale="en"
      recurring={fakeRecurringState({ page: page([row({ expectedMinor: '10000', settledMinor: '15000', remainingMinor: '0', state: 'settled' })]) })}
      occurrenceId={OCCURRENCE_ID} onBack={vi.fn()} />);
    expect(screen.getByText('+$50.00 over expected')).toBeInTheDocument();
  });

  it('offers Skip only for a pending occurrence, and calls setOccurrenceState with the row\'s own currentEventId', async () => {
    const recurring = fakeRecurringState({
      page: page([row({ state: 'pending', settledMinor: '0', remainingMinor: '50000', currentEventId: '7' })]),
      setOccurrenceState: vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { occurrenceId: OCCURRENCE_ID, eventId: '8' } }),
    });
    render(<OccurrenceDetail locale="en" recurring={recurring} occurrenceId={OCCURRENCE_ID} onBack={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(recurring.setOccurrenceState).toHaveBeenCalledWith({ occurrenceId: OCCURRENCE_ID, expectedEventId: '7', action: 'skip' }));
  });

  it('offers Reopen only for a skipped occurrence', async () => {
    const recurring = fakeRecurringState({
      page: page([row({ state: 'skipped', settledMinor: '0', remainingMinor: '50000' })]),
      setOccurrenceState: vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { occurrenceId: OCCURRENCE_ID, eventId: '8' } }),
    });
    render(<OccurrenceDetail locale="en" recurring={recurring} occurrenceId={OCCURRENCE_ID} onBack={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(recurring.setOccurrenceState).toHaveBeenCalledWith(expect.objectContaining({ action: 'reopen' })));
  });

  it('hides Review payment once nothing remains (fully settled)', () => {
    render(<OccurrenceDetail locale="en"
      recurring={fakeRecurringState({ page: page([row({ state: 'settled', settledMinor: '50000', remainingMinor: '0' })]) })}
      occurrenceId={OCCURRENCE_ID} onBack={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Review payment' })).not.toBeInTheDocument();
  });

  it('opens the payment dialog in Record mode for a plain expense occurrence', async () => {
    render(<OccurrenceDetail locale="en" recurring={fakeRecurringState()} occurrenceId={OCCURRENCE_ID} onBack={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Review payment' }));
    expect(screen.getByRole('radio', { name: 'Record payment' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Record payment' })).toBeChecked();
  });

  it('never offers Record payment for a debt_payment occurrence -- only Link an existing transaction, directing to the loan flow', async () => {
    render(<OccurrenceDetail locale="en"
      recurring={fakeRecurringState({ page: page([row({ kind: 'debt_payment', loanId: '00000000-0000-4000-8000-000000000901' })]) })}
      occurrenceId={OCCURRENCE_ID} onBack={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Review payment' }));
    expect(screen.queryByRole('radio', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.getByText(/record the repayment itself from the loan.s own repayment flow/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Transaction reference id' })).toBeInTheDocument();
  });

  it('U16-04: a confirm timeout offers an unchanged retry, never a second differently-shaped save', async () => {
    // Mirrors the existing dialogs' own "offers an unchanged retry when
    // ambiguous" convention (e.g. goal-funding-dialog.test.tsx): the hook
    // sets its own `ambiguous` state as a side effect of the same failure
    // this rejection models, so the parent-supplied `ambiguous` prop is
    // asserted true from the start, independent of the mocked rejection.
    const recurring = fakeRecurringState({
      ambiguous: { kind: 'confirm', requestId: 'req-1' },
      confirm: vi.fn().mockRejectedValue(new Error('network timeout')),
      retryAmbiguous: vi.fn().mockResolvedValue({ status: 'success', reconciled: true, result: { occurrenceId: OCCURRENCE_ID, occurrenceEventId: '9', financialEventId: 'f1' } }),
    });
    render(<OccurrenceDetail locale="en" recurring={recurring} occurrenceId={OCCURRENCE_ID} onBack={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Review payment' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Actual amount' }), '300');
    await userEvent.type(screen.getByRole('textbox', { name: 'Paying wallet id' }), '00000000-0000-4000-8000-000000000601');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const retryButton = await screen.findByRole('button', { name: 'Retry unchanged request' });
    expect(recurring.confirm).toHaveBeenCalledTimes(1);
    await userEvent.click(retryButton);
    await waitFor(() => expect(recurring.retryAmbiguous).toHaveBeenCalledTimes(1));
    // never a second, freshly-built confirm call with new values -- only the
    // hook's own unchanged-request retry path runs.
    expect(recurring.confirm).toHaveBeenCalledTimes(1);
  });

  it('U16-05: reversing part of a linked payment reopens the remaining amount -- the view reflects whatever the page now returns, with no cached figure of its own', () => {
    const settled = fakeRecurringState({ page: page([row({ state: 'settled', settledMinor: '50000', remainingMinor: '0' })]) });
    const { rerender } = render(<OccurrenceDetail locale="en" recurring={settled} occurrenceId={OCCURRENCE_ID} onBack={vi.fn()} />);
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review payment' })).not.toBeInTheDocument();

    // A 20000 reversal against the 50000 settlement: settled drops to
    // 30000, remaining reopens to 20000 -- three distinct figures, proving
    // this is the "remaining" cell specifically, not a coincidental match
    // against "expected".
    const reopened = fakeRecurringState({ page: page([row({ state: 'partial', settledMinor: '30000', remainingMinor: '20000' })]) });
    rerender(<OccurrenceDetail locale="en" recurring={reopened} occurrenceId={OCCURRENCE_ID} onBack={vi.fn()} />);
    expect(screen.getByText('Partially paid')).toBeInTheDocument();
    expect(screen.getByText('$300.00')).toBeInTheDocument(); // settled, down from 500
    expect(screen.getByText('$200.00')).toBeInTheDocument(); // remaining, reopened from 0
    expect(screen.getByRole('button', { name: 'Review payment' })).toBeInTheDocument();
  });

  it('calls onBack', async () => {
    const onBack = vi.fn();
    render(<OccurrenceDetail locale="en" recurring={fakeRecurringState()} occurrenceId={OCCURRENCE_ID} onBack={onBack} />);
    await userEvent.click(screen.getByRole('button', { name: 'Back to upcoming bills' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
