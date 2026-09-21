import { ArrowDownLeft, ArrowUpRight, Calendar } from 'lucide-react';
import { translate } from '../../i18n.js';
import { formatMinorAmount } from './money.js';
import type { Loan, LoanDirection, Locale } from './types.js';

function LoanRow({ loan, locale, onOpen }: { loan: Loan; locale: Locale; onOpen: (loan: Loan) => void }) {
  return (
    <li className="ln-row">
      <button type="button" className="ln-row-button" onClick={() => onOpen(loan)} aria-label={locale === 'ar' ? `فتح قرض ${loan.personName}` : `Open ${loan.personName} loan`}>
        <span className="ln-row-person">
          <bdi className="ln-row-name">{loan.personName}</bdi>
          <small className="ln-row-note">{loan.note ?? (locale === 'ar' ? 'بدون ملاحظة' : 'No note')}</small>
        </span>
        <span className={`status status-${loan.status} ln-row-status`}>{translate(locale, loan.status)}</span>
        <span className="ln-row-amount"><small>{translate(locale, 'remaining')}</small><strong><bdi>{formatMinorAmount(loan.outstandingMinor, loan.currency, locale)}</bdi></strong></span>
        <span className="ln-row-meta">
          <span className="ln-row-meta-item"><Calendar aria-hidden size={14} /><small>{translate(locale, 'due')}</small><bdi>{loan.dueDate ?? (locale === 'ar' ? 'لا يوجد تاريخ' : 'No due date')}</bdi></span>
          {loan.direction === 'i_owe_them' ? (
            <span className="ln-row-meta-item"><small>{translate(locale, 'reserved')}</small><bdi>{formatMinorAmount(loan.plan.remainingReservationMinor, loan.currency, locale)}</bdi></span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

export function LoanList({ loans, direction, locale, onOpen, onAddLoan }: { loans: readonly Loan[]; direction: LoanDirection; locale: Locale; onOpen: (loan: Loan) => void; onAddLoan: () => void }) {
  const filtered = loans.filter((loan) => loan.direction === direction);
  return (
    <section className="ln-register" data-loan-direction={direction}>
      <header className="ln-register-header">
        {direction === 'they_owe_me' ? <ArrowDownLeft aria-hidden size={18} /> : <ArrowUpRight aria-hidden size={18} />}
        <h2>{translate(locale, direction === 'they_owe_me' ? 'theyOwe' : 'iOwe')}</h2>
        <span className="count-badge">{filtered.length}</span>
      </header>
      {filtered.length ? <ul className="ln-rows">{filtered.map((loan) => <LoanRow key={loan.id} loan={loan} locale={locale} onOpen={onOpen} />)}</ul> : (
        <div className="ln-empty">
          <p>{translate(locale, direction === 'they_owe_me' ? 'emptyTheyOwe' : 'emptyIOwe')}</p>
          <button type="button" className="cr-button cr-button--primary" onClick={onAddLoan}>{translate(locale, 'addLoan')}</button>
        </div>
      )}
    </section>
  );
}
