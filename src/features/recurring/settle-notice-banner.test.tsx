import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettleNoticeBanner } from './settle-notice-banner.js';

describe('SettleNoticeBanner', () => {
  it('shows the English partial-settlement message with the bill name and the error', () => {
    render(
      <SettleNoticeBanner
        locale="en"
        outcome={{ status: 'partial', occurrenceId: 'occ-sep', nameEn: 'Karim', nameAr: null, linkedCount: 1, message: 'a payment cannot be linked before its effective date has occurred' }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Marked "Karim" as paid, but the rest of this repayment couldn\'t be linked: a payment cannot be linked before its effective date has occurred',
    );
  });

  it('shows the Arabic partial-settlement message with the bill name and the error', () => {
    render(
      <SettleNoticeBanner
        locale="ar"
        outcome={{ status: 'partial', occurrenceId: 'occ-sep', nameEn: 'Karim', nameAr: 'كريم', linkedCount: 1, message: 'a payment cannot be linked before its effective date has occurred' }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'تم تعليم «كريم» كمدفوعة، لكن تعذّر ربط باقي هذه الدفعة: a payment cannot be linked before its effective date has occurred',
    );
  });
});
