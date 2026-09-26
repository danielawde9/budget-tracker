import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { postgrestRejection } from '../../test/postgrest-rejection.js';
import { classifyRecurringError } from './errors.js';
import { SettleNoticeBanner } from './settle-notice-banner.js';

// The classified form of the most common real failure (E2a): the plain
// `{ code, message }` object the gateway rethrows, run through the same
// classifier the settle functions use -- final review I1.
const LINK_REFUSED = classifyRecurringError(
  postgrestRejection('P0001', 'a payment cannot be linked before its effective date has occurred'),
);

describe('SettleNoticeBanner', () => {
  it('shows the English partial-settlement message with the bill name and the localized error', () => {
    render(
      <SettleNoticeBanner
        locale="en"
        outcome={{ status: 'partial', occurrenceId: 'occ-sep', nameEn: 'Karim', nameAr: null, linkedCount: 1, error: LINK_REFUSED }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Marked "Karim" as paid, but the rest of this repayment couldn\'t be linked: A payment can’t be recorded before its effective date has occurred.',
    );
  });

  it('shows the Arabic partial-settlement message with the bill name and the localized error, no English server text', () => {
    render(
      <SettleNoticeBanner
        locale="ar"
        outcome={{ status: 'partial', occurrenceId: 'occ-sep', nameEn: 'Karim', nameAr: 'كريم', linkedCount: 1, error: LINK_REFUSED }}
        onDismiss={vi.fn()}
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(
      'تم تعليم «كريم» كمدفوعة، لكن تعذّر ربط باقي هذه الدفعة: لا يمكن تسجيل دفعة قبل حلول تاريخها الفعلي.',
    );
    expect(status.textContent).not.toMatch(/[A-Za-z]/);
  });

  it('shows a failed link in English as copy, never "[object Object]"', () => {
    render(<SettleNoticeBanner locale="en" outcome={{ status: 'failed', error: LINK_REFUSED }} onDismiss={vi.fn()} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent("Couldn't mark the bill as paid: A payment can’t be recorded before its effective date has occurred.");
    expect(status).not.toHaveTextContent('[object Object]');
  });

  it('shows a failed link in Arabic as Arabic copy only', () => {
    render(<SettleNoticeBanner locale="ar" outcome={{ status: 'failed', error: LINK_REFUSED }} onDismiss={vi.fn()} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('تعذر تعليم الفاتورة كمدفوعة: لا يمكن تسجيل دفعة قبل حلول تاريخها الفعلي.');
    expect(status.textContent).not.toMatch(/[A-Za-z]/);
  });

  // Final review M2: an incomplete candidate list refuses to decide, and the
  // notice says so instead of implying a look-alike count it never computed.
  it('says a truncated candidate list refused to decide, in both locales', () => {
    const { unmount } = render(<SettleNoticeBanner locale="en" outcome={{ status: 'ambiguous', reason: 'truncated' }} onDismiss={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      "There are too many bills to check them all, so this payment wasn't linked to any of them.",
    );
    unmount();
    render(<SettleNoticeBanner locale="ar" outcome={{ status: 'ambiguous', reason: 'truncated' }} onDismiss={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'عدد الفواتير كبير جدًا بحيث يتعذر التحقق منها كلها، لذا لم تُربط هذه الدفعة بأي منها.',
    );
  });
});
