import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { postgrestRejection } from '../../test/postgrest-rejection.js';
import { CorrectionDialog } from './loan-dialogs.js';
import type { Loan } from './types.js';

const loan: Loan = {
  id: 'loan-1', spaceId: 'space-1', direction: 'they_owe_me', personName: 'Sami', currency: 'USD',
  effectiveDate: '2026-09-01', dueDate: null, note: null, outstandingMinor: '5000',
  originalPrincipalMinor: '5000', totalRepaidMinor: '0', status: 'outstanding',
  plan: { targetMinor: '0', actualRepaymentMinor: '0', remainingReservationMinor: '0', dueAmountMinor: '0', expectedCollectionMinor: '0' },
};

describe('Loans CorrectionDialog archived-wallet rejection', () => {
  it('shows the localized message in English', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => { throw new Error('every wallet movement must use an active wallet'); });
    render(<CorrectionDialog loan={loan} eventId="event-1" locale="en" onClose={vi.fn()} onSave={onSave} />);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Add reversal' }));
    expect(await screen.findByText("This entry's wallet is archived")).toBeInTheDocument();
    expect(screen.getByText('Restore it in Wallets first.')).toBeInTheDocument();
  });

  it('shows the localized message in Arabic without the raw database text', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => { throw new Error('every wallet movement must use an active wallet'); });
    render(<CorrectionDialog loan={loan} eventId="event-1" locale="ar" onClose={vi.fn()} onSave={onSave} />);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'إضافة القيد العكسي' }));
    expect(await screen.findByText('محفظة هذا القيد مؤرشفة')).toBeInTheDocument();
    expect(screen.getByText('استعد المحفظة من صفحة المحافظ أولًا.')).toBeInTheDocument();
    expect(screen.queryByText(/every wallet movement/)).not.toBeInTheDocument();
  });
});

// Final review M8: Task 3's trigger refuses a reversal dated before the entry
// it reverses, so the correction must default to the entry's own date, and a
// refusal must read as copy in both locales.
describe('Loans CorrectionDialog reversal date', () => {
  const withHistory: Loan = {
    ...loan,
    history: [{
      eventId: 'event-1', kind: 'loan_receive_repayment', effectiveDate: '2026-08-15', createdAt: '2026-08-15T09:00:00Z',
      principalDeltaMinor: '-1000', repaymentEffectMinor: '1000', walletName: 'Cash', walletAmountMinor: '1000',
      reversalOf: null, reversedBy: null,
    }],
  };
  const refused = () => { throw postgrestRejection('23514', 'a reversal cannot be dated before the entry it reverses'); };

  it("defaults the correction date to the entry's own date, never today", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    render(<CorrectionDialog loan={withHistory} eventId="event-1" locale="en" onClose={vi.fn()} onSave={onSave} />);
    expect(screen.getByLabelText('Correction date')).toHaveValue('2026-08-15');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Add reversal' }));
    expect(onSave).toHaveBeenCalledWith({ spaceId: 'space-1', eventId: 'event-1', effectiveDate: '2026-08-15' });
  });

  it('explains a correction dated before its entry in English', async () => {
    const user = userEvent.setup();
    render(<CorrectionDialog loan={withHistory} eventId="event-1" locale="en" onClose={vi.fn()} onSave={vi.fn(async () => refused())} />);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Add reversal' }));
    expect(await screen.findByText("A correction can't be dated before the entry it corrects")).toBeInTheDocument();
    expect(screen.getByText("Pick the entry's date or later.")).toBeInTheDocument();
    expect(screen.queryByText('The change was not recorded')).not.toBeInTheDocument();
  });

  it('explains a correction dated before its entry in Arabic, without the raw database text', async () => {
    const user = userEvent.setup();
    render(<CorrectionDialog loan={withHistory} eventId="event-1" locale="ar" onClose={vi.fn()} onSave={vi.fn(async () => refused())} />);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'إضافة القيد العكسي' }));
    expect(await screen.findByText('لا يمكن أن يسبق تاريخ التصحيح تاريخ القيد الأصلي')).toBeInTheDocument();
    expect(screen.getByText('اختر تاريخ القيد أو تاريخًا لاحقًا.')).toBeInTheDocument();
    expect(screen.queryByText(/a reversal cannot be dated/)).not.toBeInTheDocument();
  });
});
