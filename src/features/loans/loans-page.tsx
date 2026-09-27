import { useEffect, useState } from 'react';
import { translate } from '../../i18n.js';
import { LoanList } from './loan-list.js';
import { LoanSummary } from './loan-summary.js';
import { formatMinorAmount } from './money.js';
import { CorrectionDialog, CreateLoanDialog, LoanDetailDialog, RepaymentDialog, TargetDialog } from './loan-dialogs.js';
import { useLoans } from './use-loans.js';
import type { Currency, Loan, LoanHistoryItem, LoansGateway, Locale, Space } from './types.js';
import { LoansSkeleton } from '../control-room/skeletons.js';
import { PageHeader } from '../control-room/page-header.js';
import './loans-workspace.css';

interface LoansPageProps {
  gateway: LoansGateway;
  locale?: Locale;
  spaces?: readonly Space[];
  spaceId?: string;
  onLocaleChange?(): void;
  onSpaceChange?(spaceId: string): void;
  onSpaceUnavailable?(): void;
  embedded?: boolean;
  currency?: Currency;
}

const activityLabels: Record<LoanHistoryItem['kind'], readonly [string, string]> = {
  loan_opening: ['Opening balance', 'رصيد افتتاحي'],
  loan_lend: ['Loan given', 'قرض مُعطى'],
  loan_borrow: ['Loan received', 'قرض مستلم'],
  loan_receive_repayment: ['Repayment received', 'دفعة مستلمة'],
  loan_repay_borrowing: ['Repayment paid', 'دفعة مدفوعة'],
  reversal: ['Correction', 'تصحيح'],
};

function recentLoanActivity(loans: readonly Loan[]): { loan: Loan; item: LoanHistoryItem }[] {
  const recent: { loan: Loan; item: LoanHistoryItem }[] = [];
  for (const loan of loans) {
    for (const item of loan.history ?? []) {
      recent.push({ loan, item });
      recent.sort((a, b) => b.item.effectiveDate.localeCompare(a.item.effectiveDate) || b.item.createdAt.localeCompare(a.item.createdAt));
      if (recent.length > 5) recent.pop();
    }
  }
  return recent;
}

export function LoansPage({ gateway, locale: controlledLocale, spaces: controlledSpaces, spaceId, onLocaleChange, onSpaceChange, onSpaceUnavailable, embedded = false, currency }: LoansPageProps) {
  const state = useLoans(gateway, spaceId === undefined ? undefined : {
    spaceId,
    ...(onSpaceUnavailable ? { onSpaceUnavailable } : {}),
  });
  const [internalLocale, setInternalLocale] = useState<Locale>('en');
  const locale = controlledLocale ?? internalLocale;
  const spaces = controlledSpaces ?? state.spaces;
  const [creating, setCreating] = useState(false);
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);
  const [repaymentLoanId, setRepaymentLoanId] = useState<string | null>(null);
  const [subdialog, setSubdialog] = useState<'target' | null>(null);
  const [correctionEventId, setCorrectionEventId] = useState<string | null>(null);
  const visibleLoans = state.dashboard?.loans.filter((loan) => currency === undefined || loan.currency === currency) ?? [];
  const visibleSummaries = state.dashboard?.summaries.filter((summary) => currency === undefined || summary.currency === currency) ?? [];
  const selectedLoan = visibleLoans.find((loan) => loan.id === selectedLoanId) ?? null;
  const repaymentLoan = visibleLoans.find((loan) => loan.id === repaymentLoanId) ?? null;
  const activity = recentLoanActivity(visibleLoans);
  const Root = embedded ? 'div' : 'main';

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);

  return <Root className={`ln-root${embedded ? ' ln-root--embedded' : ''}`}>
    <PageHeader
      title={translate(locale, 'loans')}
      subtitle={translate(locale, 'subtitle')}
      actions={<>
        {embedded ? null : <button type="button" className="button-secondary" onClick={() => onLocaleChange ? onLocaleChange() : setInternalLocale(locale === 'en' ? 'ar' : 'en')}>{locale === 'en' ? translate(locale, 'arabic') : translate(locale, 'english')}</button>}
        {embedded ? <details className="ln-month-menu">
          <summary aria-label={`${translate(locale, 'month')}: ${state.month.slice(0, 7)}`}>{translate(locale, 'month')}</summary>
          <div className="ln-month-menu-panel">
            <label className="ln-field">{translate(locale, 'month')}<input type="month" value={state.month.slice(0, 7)} onChange={(event) => state.setMonth(event.target.value)} /></label>
          </div>
        </details> : null}
        <button type="button" className="cr-button cr-button--primary" onClick={() => setCreating(true)} disabled={!state.dashboard}>{translate(locale, 'addLoan')}</button>
      </>}
    />

    {!embedded ? <section className="ln-toolbar" aria-label="Loans controls">
      <label className="ln-field">{translate(locale, 'space')}<select value={state.spaceId} onChange={(event) => onSpaceChange ? onSpaceChange(event.target.value) : state.setSpaceId(event.target.value)}>{spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>
      <label className="ln-field">{translate(locale, 'month')}<input type="month" value={state.month.slice(0, 7)} onChange={(event) => state.setMonth(event.target.value)} /></label>
      {state.dashboard ? <span className="ln-space-kind">{translate(locale, state.dashboard.space.kind)}</span> : null}
    </section> : null}

    {state.loading && !state.dashboard ? <LoansSkeleton locale={locale} /> : null}
    {state.error ? <div className="error-notice ln-state-error" role="alert"><strong>{state.error.title}</strong><p>{state.error.message}</p><p>{state.error.recovery}</p><button type="button" onClick={() => void state.retry()}>{translate(locale, 'tryAgain')}</button></div> : null}
    {state.dashboard ? <>
      <LoanSummary summaries={visibleSummaries} loans={visibleLoans} locale={locale} />
      <div className="loan-columns ln-registers">
        <LoanList loans={visibleLoans} direction="they_owe_me" locale={locale} onOpen={(loan) => setSelectedLoanId(loan.id)} onRepay={(loan) => setRepaymentLoanId(loan.id)} onAddLoan={() => setCreating(true)} />
        <LoanList loans={visibleLoans} direction="i_owe_them" locale={locale} onOpen={(loan) => setSelectedLoanId(loan.id)} onRepay={(loan) => setRepaymentLoanId(loan.id)} onAddLoan={() => setCreating(true)} />
      </div>
      {activity.length > 0 && <section className="cr-card ln-activity" aria-label={locale === 'ar' ? 'نشاط القروض الأخير' : 'Recent loan activity'}>
        <div className="cr-section-header"><h2>{locale === 'ar' ? 'نشاط القروض الأخير' : 'Recent loan activity'}</h2></div>
        <ol className="ln-activity-list">{activity.map(({ loan, item }) => <li key={`${loan.id}-${item.eventId}`} className="ln-activity-row">
          <time className="cr-helper" dateTime={item.effectiveDate}>{item.effectiveDate}</time>
          <span className="ln-activity-description"><bdi>{loan.personName}</bdi><span className="cr-helper">{activityLabels[item.kind][locale === 'ar' ? 1 : 0]}</span></span>
          <bdi className="cr-amount ln-activity-amount">{formatMinorAmount((item.walletAmountMinor ?? item.principalDeltaMinor).replace('-', ''), loan.currency, locale)}</bdi>
          <button type="button" className="text-button" onClick={() => setSelectedLoanId(loan.id)} aria-label={locale === 'ar' ? `عرض سجل قرض ${loan.personName}` : `View ${loan.personName} loan history`}>{locale === 'ar' ? 'عرض القرض' : 'View loan'}</button>
        </li>)}</ol>
      </section>}
    </> : null}

    {creating && state.dashboard ? <CreateLoanDialog spaceId={state.dashboard.space.id} wallets={state.dashboard.wallets} locale={locale} onClose={() => setCreating(false)} onSave={state.createLoan} /> : null}
    {selectedLoan ? <LoanDetailDialog loan={selectedLoan} locale={locale} active={!repaymentLoanId && !subdialog && !correctionEventId} onClose={() => setSelectedLoanId(null)} onRepay={() => setRepaymentLoanId(selectedLoan.id)} onTarget={() => setSubdialog('target')} onCorrect={setCorrectionEventId} /> : null}
    {repaymentLoan && state.dashboard ? <RepaymentDialog loan={repaymentLoan} wallets={state.dashboard.wallets} locale={locale} onClose={() => setRepaymentLoanId(null)} onSave={state.recordRepayment} /> : null}
    {selectedLoan && subdialog === 'target' ? <TargetDialog loan={selectedLoan} month={state.month} locale={locale} onClose={() => setSubdialog(null)} onSave={state.setMonthlyTarget} /> : null}
    {selectedLoan && correctionEventId ? <CorrectionDialog loan={selectedLoan} eventId={correctionEventId} locale={locale} onClose={() => setCorrectionEventId(null)} onSave={state.reverseEvent} /> : null}
  </Root>;
}
