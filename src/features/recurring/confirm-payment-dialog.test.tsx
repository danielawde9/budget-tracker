import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveSpaceClock } from '../workspace/space-clock.js';
import { ConfirmPaymentDialog } from './confirm-payment-dialog.js';
import type { LinkableEventOption } from './linkable-events.js';

const OCCURRENCE_ID = '00000000-0000-4000-8000-000000000401';
const WALLET_ID = '00000000-0000-4000-8000-000000000601';
const EVENT_ID = '00000000-0000-4000-8000-000000000501';

const CANDIDATE: LinkableEventOption = {
  id: EVENT_ID, kind: 'expense', effectiveDate: '2026-09-20', amountMinor: '15000', currency: 'USD', label: 'Rent',
};

// W4a-1: the dialog takes "today" from the server clock. Publish the
// browser-local date so the existing date-default/future-date assertions hold.
function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

beforeEach(() => {
  const today = todayLocal();
  setActiveSpaceClock({ timezone: 'UTC', today, currentMonth: `${today.slice(0, 7)}-01` });
});

function baseProps() {
  return {
    locale: 'en' as const, currency: 'USD' as const,
    occurrence: { id: OCCURRENCE_ID, kind: 'expense' as const, nameEn: 'Rent', nameAr: null, currentEventId: '3', remainingMinor: '30000' },
    walletOptions: [{ id: WALLET_ID, name: 'Daily USD', currency: 'USD' }],
    loadLinkableEvents: vi.fn(async () => [CANDIDATE]),
    pending: false, ambiguous: false,
    onClose: vi.fn(), onClearAmbiguous: vi.fn(), onRetry: vi.fn(),
    onConfirm: vi.fn(), onLinkExisting: vi.fn(),
  };
}

async function choosePayingWallet() {
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Paying wallet' }), WALLET_ID);
}

describe('ConfirmPaymentDialog', () => {
  it('records a payment by default and shows the success screen', async () => {
    const onConfirm = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { occurrenceId: OCCURRENCE_ID, occurrenceEventId: '4', financialEventId: 'f1' } });
    render(<ConfirmPaymentDialog {...baseProps()} onConfirm={onConfirm} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Actual amount' }), '300');
    await choosePayingWallet();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      occurrenceId: OCCURRENCE_ID, expectedEventId: '3', actualAmountMinor: '30000', walletId: WALLET_ID,
    }));
  });

  it('links a picked wallet transaction and pre-fills its amount (D4)', async () => {
    const onLinkExisting = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { occurrenceId: OCCURRENCE_ID, occurrenceEventId: '4', financialEventId: EVENT_ID } });
    const loadLinkableEvents = vi.fn(async () => [CANDIDATE]);
    render(<ConfirmPaymentDialog {...baseProps()} loadLinkableEvents={loadLinkableEvents} onLinkExisting={onLinkExisting} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Link an existing transaction' }));
    const picker = await screen.findByRole('combobox', { name: 'Wallet transaction' });
    await waitFor(() => expect(loadLinkableEvents).toHaveBeenCalledWith({ kind: 'expense', currency: 'USD' }));
    await screen.findByRole('option', { name: /Rent/ });
    await userEvent.selectOptions(picker, EVENT_ID);
    // No pasted id: the amount comes from the picked transaction.
    expect(screen.getByRole('textbox', { name: 'Amount to link' })).toHaveValue('150.00');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onLinkExisting).toHaveBeenCalledWith({ occurrenceId: OCCURRENCE_ID, eventId: EVENT_ID, amountMinor: '15000', expectedEventId: '3' });
  });

  it('requires a picked transaction before linking', async () => {
    const onLinkExisting = vi.fn();
    render(<ConfirmPaymentDialog {...baseProps()} onLinkExisting={onLinkExisting} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Link an existing transaction' }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Amount to link' }), '150');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose the wallet transaction this bill paid.');
    expect(onLinkExisting).not.toHaveBeenCalled();
  });

  it('says linking is unavailable when no candidate loader is wired', async () => {
    const props = baseProps();
    delete (props as { loadLinkableEvents?: unknown }).loadLinkableEvents;
    render(<ConfirmPaymentDialog {...props} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Link an existing transaction' }));
    expect(screen.getByText('Linking a transaction is unavailable right now.')).toBeInTheDocument();
  });

  it('offers both Record payment and Link for a debt-payment occurrence, so it can be settled (D4)', () => {
    render(<ConfirmPaymentDialog {...baseProps()} occurrence={{ ...baseProps().occurrence, kind: 'debt_payment' }} />);
    expect(screen.getByRole('radio', { name: 'Record payment' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Link an existing transaction' })).toBeInTheDocument();
    expect(screen.queryByText(/record the repayment itself from the loan.s own repayment flow/i)).not.toBeInTheDocument();
  });

  it('rejects a blank amount before calling the gateway', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmPaymentDialog {...baseProps()} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid positive amount.');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('rejects saving with no paying wallet chosen, preserving the entered amount', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmPaymentDialog {...baseProps()} onConfirm={onConfirm} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Actual amount' }), '300');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Select the paying wallet.');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Actual amount' })).toHaveValue('300');
  });

  it('rejects an effective date after today', async () => {
    render(<ConfirmPaymentDialog {...baseProps()} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Actual amount' }), '300');
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 10);
    const dateInput = screen.getByLabelText('Effective date');
    await userEvent.clear(dateInput);
    await userEvent.type(dateInput, future);
    await choosePayingWallet();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose today or an earlier date.');
  });

  it('offers an unchanged retry when ambiguous', async () => {
    const onRetry = vi.fn().mockResolvedValue({ status: 'success', reconciled: true, result: { occurrenceId: OCCURRENCE_ID, occurrenceEventId: '4', financialEventId: 'f1' } });
    const onConfirm = vi.fn().mockRejectedValue(new Error('network timeout'));
    render(<ConfirmPaymentDialog {...baseProps()} ambiguous onRetry={onRetry} onConfirm={onConfirm} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Actual amount' }), '300');
    await choosePayingWallet();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry unchanged request' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables the form while pending, preventing a double-submit', () => {
    render(<ConfirmPaymentDialog {...baseProps()} pending />);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('renders the paying-wallet field in Arabic', () => {
    render(<ConfirmPaymentDialog {...baseProps()} locale="ar" />);
    expect(screen.getByRole('combobox', { name: 'محفظة الدفع' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Daily USD · USD' })).toBeInTheDocument();
  });
});
