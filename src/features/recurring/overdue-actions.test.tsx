import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { emptyOccurrencePage, InMemoryRecurringGateway } from '../../test/in-memory-recurring-gateway.js';
import { postgrestRejection } from '../../test/postgrest-rejection.js';
import type {
  ConfirmInput, ConfirmResult, ScheduledOccurrenceRow, SetOccurrenceStateInput, SetOccurrenceStateResult,
} from './types.js';
import { UpcomingPage } from './upcoming-page.js';
import { useRecurring } from './use-recurring.js';

// Final review I3: what a person sees after acting on an OVERDUE bill from
// its detail screen, through the real `useRecurring` and `UpcomingPage`.
const TODAY = '2026-09-26';

const water: ScheduledOccurrenceRow = {
  id: 'e0000000-0000-4000-8000-000000000003', scheduleId: 'e0000000-0000-4000-8000-000000000103', sourceRevisionId: '1',
  currentEventId: '5', currency: 'USD', kind: 'expense', nameEn: 'Water', nameAr: 'مياه', dueDate: '2026-09-10',
  expectedMinor: '3000', settledMinor: '0', remainingMinor: '3000', state: 'pending', overdue: true,
  categoryId: null, loanId: null, fundingGoalId: null, preferredWalletId: null, fundingShortfallMinor: null, asOf: TODAY,
};

/** Partitions the way the server does: `scheduled_overdue_page` serves only
 * unpaid, unskipped rows due before today, and the window (today onward)
 * never holds a past due date -- so a paid or skipped overdue bill is in
 * neither list after the command's own refresh. Commands check the row's
 * event head like the real RPCs, so a Reopen that sends a stale head is
 * refused. */
class ServerLikeGateway extends InMemoryRecurringGateway {
  readonly rows = new Map<string, ScheduledOccurrenceRow>();
  /** Makes the next `skip` reject as an ambiguous transport failure BEFORE it
   * takes effect (a timeout with no receipt), so a retry through the payment
   * dialog can be exercised the same way a real timed-out request would be
   * retried (N2). */
  timeOutNextSkip = false;

  constructor(rows: readonly ScheduledOccurrenceRow[]) {
    super();
    for (const row of rows) this.rows.set(row.id, row);
    this.page = { ...emptyOccurrencePage, asOf: TODAY };
    this.sync();
  }

  private sync() {
    this.overdueRows = [...this.rows.values()]
      .filter((row) => row.dueDate < TODAY && (row.state === 'pending' || row.state === 'partial'));
  }

  private head(occurrenceId: string, expectedEventId: string | null): ScheduledOccurrenceRow {
    const row = this.rows.get(occurrenceId);
    if (!row) throw postgrestRejection('P0001', 'the occurrence does not belong to the requested space');
    if (row.currentEventId !== expectedEventId) throw postgrestRejection('40001', 'planning_stale_revision');
    return row;
  }

  override async setOccurrenceState(input: SetOccurrenceStateInput): Promise<SetOccurrenceStateResult> {
    if (this.timeOutNextSkip && input.action === 'skip') {
      this.timeOutNextSkip = false;
      this.calls.push({ name: 'setOccurrenceState:timeout', input });
      throw postgrestRejection('57014', 'canceling statement due to statement timeout');
    }
    const row = this.head(input.occurrenceId, input.expectedEventId);
    const result = await super.setOccurrenceState(input);
    const skipped = input.action === 'skip';
    this.rows.set(row.id, { ...row, state: skipped ? 'skipped' : 'pending', overdue: !skipped, currentEventId: result.eventId });
    this.sync();
    return result;
  }

  override async confirm(input: ConfirmInput): Promise<ConfirmResult> {
    const row = this.head(input.occurrenceId, input.expectedEventId);
    const result = await super.confirm(input);
    const settled = BigInt(row.settledMinor) + BigInt(input.actualAmountMinor);
    const remaining = BigInt(row.expectedMinor) - settled;
    this.rows.set(row.id, {
      ...row, settledMinor: settled.toString(), remainingMinor: (remaining > 0n ? remaining : 0n).toString(),
      state: remaining > 0n ? 'partial' : 'settled', overdue: remaining > 0n, currentEventId: result.occurrenceEventId,
    });
    this.sync();
    return result;
  }
}

function Harness({ gateway, locale = 'en' }: { gateway: InMemoryRecurringGateway; locale?: 'en' | 'ar' }) {
  const recurring = useRecurring(gateway, 'space-1', TODAY, '2026-12-24');
  return <UpcomingPage locale={locale} currency="USD" recurring={recurring} fromDate={TODAY} toDate="2026-12-24"
    referenceOptions={{ categories: [], loans: [], goals: [], wallets: [] }}
    plannedIncomeByCurrency={{ USD: null, LBP: null }} walletOptions={[{ id: 'w1', name: 'Cash', currency: 'USD' }]} />;
}

describe('acting on an overdue bill from its detail screen (final review I3)', () => {
  it('paying it ends on the success confirmation, never the "no longer in the visible range" alert', async () => {
    const user = userEvent.setup();
    const gateway = new ServerLikeGateway([water]);
    render(<Harness gateway={gateway} />);

    await user.click(await screen.findByRole('button', { name: 'Review Water' }));
    await user.click(screen.getByRole('button', { name: 'Review payment' }));
    await user.type(screen.getByLabelText('Actual amount'), '30.00');
    await user.selectOptions(screen.getByLabelText('Paying wallet'), 'w1');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('The payment has been recorded against this occurrence.')).toBeInTheDocument();
    // The command's own refresh really did drop the row from both lists.
    expect(gateway.overdueRows).toHaveLength(0);
    expect(screen.queryByText('This occurrence is no longer in the visible range.')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    const detail = screen.getByRole('region', { name: 'Occurrence detail' });
    expect(within(detail).getByText('Payment recorded. This bill is paid and has left the list.')).toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: 'Review payment' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('skipping it ends on the confirmation with a working Reopen that brings it back', async () => {
    const user = userEvent.setup();
    const gateway = new ServerLikeGateway([water]);
    render(<Harness gateway={gateway} />);

    await user.click(await screen.findByRole('button', { name: 'Review Water' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    expect(await screen.findByText('Skipped. This bill has left the list; Reopen brings it back.')).toBeInTheDocument();
    expect(gateway.overdueRows).toHaveLength(0);
    expect(screen.queryByText('This occurrence is no longer in the visible range.')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(gateway.rows.get(water.id)?.state).toBe('pending'));
    const [skip, reopen] = gateway.calls.filter((call) => call.name === 'setOccurrenceState').map((call) => call.input as SetOccurrenceStateInput);
    expect(skip).toMatchObject({ action: 'skip', expectedEventId: '5' });
    // Reopen sends the head the skip itself returned, so the server accepts it.
    const skipResult = gateway.receipts.get(skip!.requestId)?.result as SetOccurrenceStateResult;
    expect(reopen).toMatchObject({ action: 'reopen', expectedEventId: skipResult.eventId });
    expect(screen.queryByRole('alert')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Back to upcoming bills' }));
    await user.click(screen.getByRole('tab', { name: 'Overdue' }));
    expect(await screen.findByRole('button', { name: 'Review Water' })).toBeInTheDocument();
  });

  it('words the held skip confirmation in Arabic', async () => {
    const user = userEvent.setup();
    const gateway = new ServerLikeGateway([water]);
    render(<Harness gateway={gateway} locale="ar" />);

    await user.click(await screen.findByRole('button', { name: /مراجعة/ }));
    await user.click(screen.getByRole('button', { name: 'تخطٍ' }));

    expect(await screen.findByText('تم تخطي هذه الفاتورة وخرجت من القائمة. استخدم «إعادة فتح» لإرجاعها.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إعادة فتح' })).toBeInTheDocument();
    expect(screen.queryByText('هذه الدفعة المستحقة لم تعد ضمن النطاق المعروض.')).toBeNull();
  });

  // N2 (final re-review): occurrence-detail.tsx used to hard-code every
  // retry as `track('pay', ...)`, so a Skip that came back ambiguous and was
  // retried from the payment dialog ended on "Payment recorded", with no
  // Reopen. The dialog is only reachable at all here because an unrelated
  // Save attempt, made while the Skip's own retry is still pending, is
  // refused client-side ("a command is already pending") -- that refusal is
  // expected and is not itself the bug.
  it('N2: a retried ambiguous Skip ends on the skip confirmation, not "Payment recorded", with Reopen reachable', async () => {
    const user = userEvent.setup();
    const gateway = new ServerLikeGateway([water]);
    gateway.timeOutNextSkip = true;
    render(<Harness gateway={gateway} />);

    await user.click(await screen.findByRole('button', { name: 'Review Water' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(gateway.calls.some((call) => call.name === 'findCommand')).toBe(true));

    await user.click(screen.getByRole('button', { name: 'Review payment' }));
    await user.type(screen.getByLabelText('Actual amount'), '30.00');
    await user.selectOptions(screen.getByLabelText('Paying wallet'), 'w1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByRole('button', { name: 'Retry unchanged request' }));

    await waitFor(() => expect(gateway.rows.get(water.id)?.state).toBe('skipped'));
    expect(await screen.findByText('Skipped. This bill has left the list; Reopen brings it back.')).toBeInTheDocument();
    expect(screen.queryByText('Payment recorded. This bill is paid and has left the list.')).toBeNull();
    expect(gateway.calls.filter((call) => call.name === 'confirm')).toHaveLength(0);

    const reopenButton = screen.getByRole('button', { name: 'Reopen' });
    expect(reopenButton).toBeEnabled();
    await user.click(reopenButton);
    await waitFor(() => expect(gateway.rows.get(water.id)?.state).toBe('pending'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
