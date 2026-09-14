import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmPaymentDialog } from './confirm-payment-dialog.js';

const OCCURRENCE_ID = '00000000-0000-4000-8000-000000000401';
const WALLET_ID = '00000000-0000-4000-8000-000000000601';
const EVENT_ID = '00000000-0000-4000-8000-000000000501';

function baseProps() {
  return {
    locale: 'en' as const, currency: 'USD' as const,
    occurrence: { id: OCCURRENCE_ID, nameEn: 'Rent', nameAr: null, currentEventId: '3', remainingMinor: '30000' },
    allowConfirm: true, pending: false, ambiguous: false,
    onClose: vi.fn(), onClearAmbiguous: vi.fn(), onRetry: vi.fn(),
    onConfirm: vi.fn(), onLinkExisting: vi.fn(),
  };
}

describe('ConfirmPaymentDialog', () => {
  it('records a payment by default and shows the success screen', async () => {
    const onConfirm = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { occurrenceId: OCCURRENCE_ID, occurrenceEventId: '4', financialEventId: 'f1' } });
    render(<ConfirmPaymentDialog {...baseProps()} onConfirm={onConfirm} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Actual amount' }), '300');
    await userEvent.type(screen.getByRole('textbox', { name: 'Paying wallet id' }), WALLET_ID);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      occurrenceId: OCCURRENCE_ID, expectedEventId: '3', actualAmountMinor: '30000', walletId: WALLET_ID,
    }));
  });

  it('switches to link mode and submits with a transaction reference id', async () => {
    const onLinkExisting = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { occurrenceId: OCCURRENCE_ID, occurrenceEventId: '4', financialEventId: EVENT_ID } });
    render(<ConfirmPaymentDialog {...baseProps()} onLinkExisting={onLinkExisting} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Link an existing transaction' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Transaction reference id' }), EVENT_ID);
    await userEvent.type(screen.getByRole('textbox', { name: 'Amount to link' }), '150');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onLinkExisting).toHaveBeenCalledWith({ occurrenceId: OCCURRENCE_ID, eventId: EVENT_ID, amountMinor: '15000', expectedEventId: '3' });
  });

  it('locks a debt-payment occurrence to link mode, with no Record payment option', () => {
    render(<ConfirmPaymentDialog {...baseProps()} allowConfirm={false} />);
    expect(screen.queryByRole('radio', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Link an existing transaction' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Transaction reference id' })).toBeInTheDocument();
    expect(screen.getByText(/loan.s own repayment flow/i)).toBeInTheDocument();
  });

  it('rejects a blank amount before calling the gateway', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmPaymentDialog {...baseProps()} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid positive amount.');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid wallet id before calling the gateway, preserving the entered amount', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmPaymentDialog {...baseProps()} onConfirm={onConfirm} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Actual amount' }), '300');
    await userEvent.type(screen.getByRole('textbox', { name: 'Paying wallet id' }), 'not-a-uuid');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the paying wallet’s exact id.');
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
    await userEvent.type(screen.getByRole('textbox', { name: 'Paying wallet id' }), WALLET_ID);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose today or an earlier date.');
  });

  it('offers an unchanged retry when ambiguous', async () => {
    const onRetry = vi.fn().mockResolvedValue({ status: 'success', reconciled: true, result: { occurrenceId: OCCURRENCE_ID, occurrenceEventId: '4', financialEventId: 'f1' } });
    const onConfirm = vi.fn().mockRejectedValue(new Error('network timeout'));
    render(<ConfirmPaymentDialog {...baseProps()} ambiguous onRetry={onRetry} onConfirm={onConfirm} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Actual amount' }), '300');
    await userEvent.type(screen.getByRole('textbox', { name: 'Paying wallet id' }), WALLET_ID);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry unchanged request' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables the form while pending, preventing a double-submit', () => {
    render(<ConfirmPaymentDialog {...baseProps()} pending />);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
