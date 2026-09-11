import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

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
