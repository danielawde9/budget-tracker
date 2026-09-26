import { ArrowDownLeft, ArrowUpRight, Calendar } from 'lucide-react';
import { translate } from '../../i18n.js';
import { formatMinorAmount } from './money.js';
import type { Loan, LoanDirection, Locale } from './types.js';

function LoanRow({ loan, locale, onOpen, onRepay }: { loan: Loan; locale: Locale; onOpen: (loan: Loan) => void; onRepay: (loan: Loan) => void }) {
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
          <span className="ln-row-meta-item"><Calendar aria-hidden size={14} /><small>{locale === 'ar' ? 'تاريخ الاستحقاق' : 'Due date'}</small><bdi>{loan.dueDate ?? (locale === 'ar' ? 'لا يوجد تاريخ' : 'No due date')}</bdi></span>
          {loan.direction === 'i_owe_them' ? (
            <span className="ln-row-meta-item"><small>{translate(locale, 'target')}</small><bdi>{formatMinorAmount(loan.plan.targetMinor, loan.currency, locale)}</bdi></span>
          ) : null}
        </span>
      </button>
      {loan.status !== 'settled' && <button type="button" className="cr-button button-secondary ln-row-repay" onClick={() => onRepay(loan)} aria-label={locale === 'ar' ? `${loan.direction === 'they_owe_me' ? 'تسجيل دفعة مستلمة من' : 'تسجيل دفعة إلى'} ${loan.personName}` : `${loan.direction === 'they_owe_me' ? 'Receive repayment from' : 'Record repayment to'} ${loan.personName}`}>
        {locale === 'ar' ? (loan.direction === 'they_owe_me' ? 'تسجيل دفعة مستلمة' : 'تسجيل دفعة') : (loan.direction === 'they_owe_me' ? 'Receive repayment' : 'Record repayment')}
      </button>}
    </li>
  );
}

export function LoanList({ loans, direction, locale, onOpen, onRepay, onAddLoan }: { loans: readonly Loan[]; direction: LoanDirection; locale: Locale; onOpen: (loan: Loan) => void; onRepay: (loan: Loan) => void; onAddLoan: () => void }) {
  const filtered = loans.filter((loan) => loan.direction === direction);
  return (
    <section className="ln-register" data-loan-direction={direction}>
      <header className="ln-register-header">
        {direction === 'they_owe_me' ? <ArrowDownLeft aria-hidden size={18} /> : <ArrowUpRight aria-hidden size={18} />}
        <h2>{locale === 'ar' ? (direction === 'they_owe_me' ? 'أموال أقرضتها' : 'أموال اقترضتها') : (direction === 'they_owe_me' ? 'Money lent' : 'Money borrowed')}</h2>
        <span className="count-badge">{filtered.length}</span>
      </header>
      <p className="cr-helper">{locale === 'ar' ? (direction === 'they_owe_me' ? 'أشخاص مدينون لك' : 'أشخاص أنت مدين لهم') : (direction === 'they_owe_me' ? 'People who owe you money' : 'People you owe money to')}</p>
      {filtered.length ? <ul className="ln-rows">{filtered.map((loan) => <LoanRow key={loan.id} loan={loan} locale={locale} onOpen={onOpen} onRepay={onRepay} />)}</ul> : (
        <div className="ln-empty">
          <p>{translate(locale, direction === 'they_owe_me' ? 'emptyTheyOwe' : 'emptyIOwe')}</p>
          <button type="button" className="cr-button cr-button--primary" onClick={onAddLoan}>{translate(locale, 'addLoan')}</button>
        </div>
      )}
    </section>
  );
}
