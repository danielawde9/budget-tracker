import { useEffect, useState } from 'react';
import { translate } from '../../i18n.js';
import { LoanList } from './loan-list.js';
import { LoanSummary } from './loan-summary.js';
import { CorrectionDialog, CreateLoanDialog, LoanDetailDialog, RepaymentDialog, TargetDialog } from './loan-dialogs.js';
import { useLoans } from './use-loans.js';
import type { Loan, LoansGateway, Locale, Space } from './types.js';

interface LoansPageProps {
  gateway: LoansGateway;
  locale?: Locale;
  spaces?: readonly Space[];
  spaceId?: string;
  onLocaleChange?(): void;
  onSpaceChange?(spaceId: string): void;
  onSpaceUnavailable?(): void;
}

export function LoansPage({ gateway, locale: controlledLocale, spaces: controlledSpaces, spaceId, onLocaleChange, onSpaceChange, onSpaceUnavailable }: LoansPageProps) {
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

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);

  return <main className="app-shell">
    <header className="topbar">
      <div><span className="brand">Budget ledger</span><h1>{translate(locale, 'loans')}</h1><p>{translate(locale, 'subtitle')}</p></div>
      <button type="button" className="locale-button" onClick={() => onLocaleChange ? onLocaleChange() : setInternalLocale(locale === 'en' ? 'ar' : 'en')}>{locale === 'en' ? translate(locale, 'arabic') : translate(locale, 'english')}</button>
    </header>

    <section className="controls" aria-label="Loans controls">
      <label>{translate(locale, 'space')}<select value={state.spaceId} onChange={(event) => onSpaceChange ? onSpaceChange(event.target.value) : state.setSpaceId(event.target.value)}>{spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>
      <label>{translate(locale, 'month')}<input type="month" value={state.month.slice(0, 7)} onChange={(event) => state.setMonth(event.target.value)} /></label>
      <button type="button" onClick={() => setCreating(true)} disabled={!state.dashboard}>{translate(locale, 'addLoan')}</button>
      {state.dashboard ? <span className="space-kind">{translate(locale, state.dashboard.space.kind)}</span> : null}
    </section>

    {state.loading && !state.dashboard ? <div className="state-panel" role="status">Loading the ledger…</div> : null}
    {state.error ? <div className="state-panel error-notice" role="alert"><strong>{state.error.title}</strong><p>{state.error.message}</p><p>{state.error.recovery}</p><button type="button" onClick={() => void state.retry()}>{translate(locale, 'tryAgain')}</button></div> : null}
    {state.dashboard ? <>
      <LoanSummary summaries={state.dashboard.summaries} locale={locale} />
      <div className="loan-columns">
        <LoanList loans={state.dashboard.loans} direction="they_owe_me" locale={locale} onOpen={(loan) => setSelectedLoanId(loan.id)} />
        <LoanList loans={state.dashboard.loans} direction="i_owe_them" locale={locale} onOpen={(loan) => setSelectedLoanId(loan.id)} />
      </div>
    </> : null}

    {creating && state.dashboard ? <CreateLoanDialog spaceId={state.dashboard.space.id} wallets={state.dashboard.wallets} locale={locale} onClose={() => setCreating(false)} onSave={state.createLoan} /> : null}
    {selectedLoan && !subdialog && !correctionEventId ? <LoanDetailDialog loan={selectedLoan} locale={locale} onClose={() => setSelectedLoanId(null)} onRepay={() => setSubdialog('repay')} onTarget={() => setSubdialog('target')} onCorrect={setCorrectionEventId} /> : null}
    {selectedLoan && subdialog === 'repay' && state.dashboard ? <RepaymentDialog loan={selectedLoan} wallets={state.dashboard.wallets} locale={locale} onClose={() => setSubdialog(null)} onSave={state.recordRepayment} /> : null}
    {selectedLoan && subdialog === 'target' ? <TargetDialog loan={selectedLoan} month={state.month} locale={locale} onClose={() => setSubdialog(null)} onSave={state.setMonthlyTarget} /> : null}
    {selectedLoan && correctionEventId ? <CorrectionDialog loan={selectedLoan} eventId={correctionEventId} locale={locale} onClose={() => setCorrectionEventId(null)} onSave={state.reverseEvent} /> : null}
  </main>;
}
