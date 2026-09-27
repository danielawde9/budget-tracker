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

  // Final review M3 / D3: a payment that leaves part of the bill (or its
  // instalment) unpaid is never announced as "paid".
  it('words a payment that leaves part of the amount due without saying "paid"', () => {
    const outcome = { status: 'settled', occurrenceId: 'occ-1', nameEn: 'Karim', nameAr: 'كريم', remainsDue: true } as const;
    const { unmount } = render(<SettleNoticeBanner locale="en" outcome={outcome} onDismiss={vi.fn()} />);
    const english = screen.getByRole('status');
    expect(english).toHaveTextContent('Linked this payment to "Karim" — part of it is still due.');
    expect(english).not.toHaveTextContent('as paid');
    unmount();
    render(<SettleNoticeBanner locale="ar" outcome={outcome} onDismiss={vi.fn()} />);
    const arabic = screen.getByRole('status');
    expect(arabic).toHaveTextContent('تم ربط هذه الدفعة بـ«كريم»، ولا يزال جزء من المبلغ مستحقًا.');
    expect(arabic).not.toHaveTextContent('كمدفوعة');
  });

  // D3: an over-payment settles the bill and states the surplus honestly.
  it('states the unallocated surplus of an over-payment in both locales', () => {
    const outcome = {
      status: 'settled', occurrenceId: 'occ-1', nameEn: 'Rent', nameAr: 'إيجار',
      remainsDue: false, unallocatedMinor: '4000', currency: 'USD',
    } as const;
    const { unmount } = render(<SettleNoticeBanner locale="en" outcome={outcome} onDismiss={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Marked "Rent" as paid. This payment was $40.00 more than the amount still due.',
    );
    unmount();
    render(<SettleNoticeBanner locale="ar" outcome={outcome} onDismiss={vi.fn()} />);
    const arabic = screen.getByRole('status');
    expect(arabic).toHaveTextContent('تم تعليم «إيجار» كمدفوعة. كانت هذه الدفعة أكبر من المبلغ المتبقي بمقدار ٤٠٫٠٠');
    // The sentence itself is Arabic; the only Latin text is the currency code
    // `formatMinorAmount` appends everywhere (as in every other amount cell).
    expect(arabic.textContent?.replace('USD', '').replace('تجاهل', '')).not.toMatch(/[A-Za-z]/);
  });

  it('says "paid" when the link paid the bill in full', () => {
    render(<SettleNoticeBanner locale="en" outcome={{ status: 'settled', occurrenceId: 'occ-1', nameEn: 'Rent', nameAr: null, remainsDue: false }} onDismiss={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Marked "Rent" as paid.');
  });

  // Final review M4 and declined #2: the look-alike notice states what
  // happened, with Arabic number agreement, and never points to a screen:
  // none can link an existing expense, and "Review payment" would record
  // the expense a second time.
  it.each([
    [2, "This payment matches 2 bills, so it wasn't linked to any of them.", 'تطابق هذه الدفعة فاتورتين، لذا لم تُربط بأيٍّ منهما.'],
    [3, "This payment matches 3 bills, so it wasn't linked to any of them.", 'تطابق هذه الدفعة ٣ فواتير، لذا لم تُربط بأيٍّ منها.'],
    [11, "This payment matches 11 bills, so it wasn't linked to any of them.", 'تطابق هذه الدفعة ١١ فاتورة، لذا لم تُربط بأيٍّ منها.'],
  ])('words a %i-way look-alike truthfully, with no dead-end instruction', (scheduleCount, english, arabic) => {
    const outcome = { status: 'ambiguous', reason: 'look_alike', scheduleCount } as const;
    const { unmount } = render(<SettleNoticeBanner locale="en" outcome={outcome} onDismiss={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(english);
    expect(screen.getByRole('status')).not.toHaveTextContent(/Upcoming bills|choose|Review payment/);
    unmount();
    render(<SettleNoticeBanner locale="ar" outcome={outcome} onDismiss={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(arabic);
    expect(screen.getByRole('status')).not.toHaveTextContent(/الفواتير القادمة|للاختيار/);
  });
});
