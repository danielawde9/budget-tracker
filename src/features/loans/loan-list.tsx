import { translate } from '../../i18n.js';
import { formatMinorAmount } from './money.js';
import type { Loan, LoanDirection, Locale } from './types.js';

function LoanRow({ loan, locale, onOpen }: { loan: Loan; locale: Locale; onOpen: (loan: Loan) => void }) {
  return (
    <li className="loan-row">
      <button type="button" className="loan-row-button mobile-safe-row" onClick={() => onOpen(loan)} aria-label={locale === 'ar' ? `فتح قرض ${loan.personName}` : `Open ${loan.personName} loan`}>
        <span className="loan-person"><bdi>{loan.personName}</bdi><small>{loan.note ?? (locale === 'ar' ? 'بدون ملاحظة' : 'No note')}</small></span>
        <span className={`status status-${loan.status}`}>{translate(locale, loan.status)}</span>
        <span className="loan-amount"><small>{translate(locale, 'remaining')}</small><strong><bdi>{formatMinorAmount(loan.outstandingMinor, loan.currency, locale)}</bdi></strong></span>
        <span className="loan-due"><small>{translate(locale, 'due')}</small><bdi>{loan.dueDate ?? (locale === 'ar' ? 'لا يوجد تاريخ' : 'No due date')}</bdi></span>
        {loan.direction === 'i_owe_them' ? (
          <span className="loan-plan"><small>{translate(locale, 'reserved')}</small><bdi>{formatMinorAmount(loan.plan.remainingReservationMinor, loan.currency, locale)}</bdi></span>
        ) : null}
      </button>
    </li>
  );
}

export function LoanList({ loans, direction, locale, onOpen }: { loans: readonly Loan[]; direction: LoanDirection; locale: Locale; onOpen: (loan: Loan) => void }) {
  const filtered = loans.filter((loan) => loan.direction === direction);
  return (
    <section className="loan-group register-section" data-loan-direction={direction}>
      <header>
        <h2>{translate(locale, direction === 'they_owe_me' ? 'theyOwe' : 'iOwe')}</h2>
        <span className="count-badge">{filtered.length}</span>
      </header>
      {filtered.length ? <ul>{filtered.map((loan) => <LoanRow key={loan.id} loan={loan} locale={locale} onOpen={onOpen} />)}</ul> : <p className="empty">{translate(locale, 'noLoans')}</p>}
    </section>
  );
}
