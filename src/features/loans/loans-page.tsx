import { useEffect, useState } from 'react';
import { translate } from '../../i18n.js';
import { LoanList } from './loan-list.js';
import { LoanSummary } from './loan-summary.js';
import { CorrectionDialog, CreateLoanDialog, LoanDetailDialog, RepaymentDialog, TargetDialog } from './loan-dialogs.js';
import { useLoans } from './use-loans.js';
import type { Loan, LoansGateway, Locale, Space } from './types.js';
import { LoansSkeleton } from '../control-room/skeletons.js';
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
}

export function LoansPage({ gateway, locale: controlledLocale, spaces: controlledSpaces, spaceId, onLocaleChange, onSpaceChange, onSpaceUnavailable, embedded = false }: LoansPageProps) {
  const state = useLoans(gateway, spaceId === undefined ? undefined : {
    spaceId,
    ...(onSpaceUnavailable ? { onSpaceUnavailable } : {}),
  });
  const [internalLocale, setInternalLocale] = useState<Locale>('en');
  const locale = controlledLocale ?? internalLocale;
  const spaces = controlledSpaces ?? state.spaces;
  const [creating, setCreating] = useState(false);
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);
  const [subdialog, setSubdialog] = useState<'repay' | 'target' | null>(null);
  const [correctionEventId, setCorrectionEventId] = useState<string | null>(null);
  const selectedLoan = state.dashboard?.loans.find((loan) => loan.id === selectedLoanId) ?? null;
  const Root = embedded ? 'div' : 'main';

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);

  return <Root className="ln-root">
    <header className="ln-header">
      <div className="ln-heading">
        {embedded ? null : <span className="brand">Budget ledger</span>}
        <span className="section-kicker">{translate(locale, 'loansKicker')}</span>
        <h1>{translate(locale, 'loans')}</h1>
        <p className="ln-lede">{translate(locale, 'subtitle')}</p>
      </div>
      <div className="ln-header-actions">
        {embedded ? null : <button type="button" className="button-secondary" onClick={() => onLocaleChange ? onLocaleChange() : setInternalLocale(locale === 'en' ? 'ar' : 'en')}>{locale === 'en' ? translate(locale, 'arabic') : translate(locale, 'english')}</button>}
        <button type="button" className="cr-button cr-button--primary" onClick={() => setCreating(true)} disabled={!state.dashboard}>{translate(locale, 'addLoan')}</button>
      </div>
    </header>

    <section className="ln-toolbar" aria-label="Loans controls">
      {embedded ? null : <label className="ln-field">{translate(locale, 'space')}<select value={state.spaceId} onChange={(event) => onSpaceChange ? onSpaceChange(event.target.value) : state.setSpaceId(event.target.value)}>{spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>}
      <label className="ln-field">{translate(locale, 'month')}<input type="month" value={state.month.slice(0, 7)} onChange={(event) => state.setMonth(event.target.value)} /></label>
      {!embedded && state.dashboard ? <span className="ln-space-kind">{translate(locale, state.dashboard.space.kind)}</span> : null}
    </section>

    {state.loading && !state.dashboard ? <LoansSkeleton locale={locale} /> : null}
    {state.error ? <div className="error-notice ln-state-error" role="alert"><strong>{state.error.title}</strong><p>{state.error.message}</p><p>{state.error.recovery}</p><button type="button" onClick={() => void state.retry()}>{translate(locale, 'tryAgain')}</button></div> : null}
    {state.dashboard ? <>
      <LoanSummary summaries={state.dashboard.summaries} locale={locale} />
      <div className="loan-columns ln-registers">
        <LoanList loans={state.dashboard.loans} direction="they_owe_me" locale={locale} onOpen={(loan) => setSelectedLoanId(loan.id)} onAddLoan={() => setCreating(true)} />
        <LoanList loans={state.dashboard.loans} direction="i_owe_them" locale={locale} onOpen={(loan) => setSelectedLoanId(loan.id)} onAddLoan={() => setCreating(true)} />
      </div>
    </> : null}

    {creating && state.dashboard ? <CreateLoanDialog spaceId={state.dashboard.space.id} wallets={state.dashboard.wallets} locale={locale} onClose={() => setCreating(false)} onSave={state.createLoan} /> : null}
    {selectedLoan ? <LoanDetailDialog loan={selectedLoan} locale={locale} active={!subdialog && !correctionEventId} onClose={() => setSelectedLoanId(null)} onRepay={() => setSubdialog('repay')} onTarget={() => setSubdialog('target')} onCorrect={setCorrectionEventId} /> : null}
    {selectedLoan && subdialog === 'repay' && state.dashboard ? <RepaymentDialog loan={selectedLoan} wallets={state.dashboard.wallets} locale={locale} onClose={() => setSubdialog(null)} onSave={state.recordRepayment} /> : null}
    {selectedLoan && subdialog === 'target' ? <TargetDialog loan={selectedLoan} month={state.month} locale={locale} onClose={() => setSubdialog(null)} onSave={state.setMonthlyTarget} /> : null}
    {selectedLoan && correctionEventId ? <CorrectionDialog loan={selectedLoan} eventId={correctionEventId} locale={locale} onClose={() => setCorrectionEventId(null)} onSave={state.reverseEvent} /> : null}
  </Root>;
}
