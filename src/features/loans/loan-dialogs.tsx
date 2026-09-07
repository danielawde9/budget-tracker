import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { classifyLoanError } from './errors.js';
import { formatMinorAmount, parseMinorAmount } from './money.js';
import type { Currency, Loan, LoanErrorView, Locale, Wallet } from './types.js';

interface ModalProps { title: string; onClose: () => void; children: ReactNode; wide?: boolean }

function Modal({ title, onClose, children, wide = false }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [onClose]);
  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`dialog ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel}>
        <header className="dialog-header"><h2>{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Close">×</button></header>
        {children}
      </div>
    </div>
  );
}

function ErrorNotice({ error }: { error: LoanErrorView }) {
  return <div className="error-notice" role="alert"><strong>{error.title}</strong><p>{error.message}</p><p>{error.recovery}</p></div>;
}

const today = () => new Date().toISOString().slice(0, 10);

export function CreateLoanDialog({ spaceId, wallets, locale, onClose, onSave }: { spaceId: string; wallets: readonly Wallet[]; locale: Locale; onClose: () => void; onSave: (input: { mode: 'opening' | 'cash'; spaceId: string; direction: 'they_owe_me' | 'i_owe_them'; personName: string; currency: Currency; walletId?: string; amountMinor: string; effectiveDate: string; dueDate: string | null; note: string | null }) => Promise<void> }) {
  const [mode, setMode] = useState<'opening' | 'cash'>('opening');
  const [direction, setDirection] = useState<'they_owe_me' | 'i_owe_them'>('they_owe_me');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<LoanErrorView | null>(null);
  const matchingWallets = wallets.filter((wallet) => wallet.archivedAt === null && wallet.currency === currency);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const effectiveDate = String(data.get('effectiveDate'));
    const dueDate = String(data.get('dueDate') ?? '') || null;
    if (dueDate && dueDate < effectiveDate) {
      setError({ code: 'database_rejection', title: 'Check the due date', message: 'The due date cannot be before the loan date.', recovery: 'Choose the same date or a later date.' });
      return;
    }
    try {
      setBusy(true); setError(null);
      await onSave({
        mode, spaceId, direction, currency, personName: String(data.get('person')).trim(),
        amountMinor: parseMinorAmount(String(data.get('amount')), currency),
        ...(mode === 'cash' ? { walletId: String(data.get('wallet')) } : {}),
        effectiveDate, dueDate, note: String(data.get('note') ?? '').trim() || null,
      });
      onClose();
    } catch (cause) { setError(classifyLoanError(cause)); } finally { setBusy(false); }
  }

  return <Modal title={locale === 'ar' ? 'إضافة قرض' : 'Add a loan'} onClose={onClose} wide>
    <p className="dialog-intro">{mode === 'opening' ? 'Record what is already outstanding. No wallet money moves.' : direction === 'they_owe_me' ? 'Record money leaving a wallet and becoming owed to you.' : 'Record money entering a wallet and becoming owed by you.'}</p>
    <form onSubmit={(event) => void submit(event)}>
      <fieldset className="choice-grid"><legend>What happened?</legend>
        <label><input type="radio" name="mode" checked={mode === 'opening'} onChange={() => setMode('opening')} /> Opening outstanding</label>
        <label><input type="radio" name="mode" checked={mode === 'cash' && direction === 'they_owe_me'} onChange={() => { setMode('cash'); setDirection('they_owe_me'); }} /> I lent money</label>
        <label><input type="radio" name="mode" checked={mode === 'cash' && direction === 'i_owe_them'} onChange={() => { setMode('cash'); setDirection('i_owe_them'); }} /> I borrowed money</label>
      </fieldset>
      {mode === 'opening' ? <fieldset className="segmented"><legend>Direction</legend><label><input type="radio" name="direction" checked={direction === 'they_owe_me'} onChange={() => setDirection('they_owe_me')} /> They owe me</label><label><input type="radio" name="direction" checked={direction === 'i_owe_them'} onChange={() => setDirection('i_owe_them')} /> I owe them</label></fieldset> : null}
      <div className="form-grid">
        <label>Person<input name="person" required maxLength={120} autoFocus /></label>
        <label>Currency<select name="currency" value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}><option>USD</option><option>LBP</option></select></label>
        <label>Amount<input name="amount" required inputMode="decimal" placeholder={currency === 'USD' ? '0.00' : '0'} /></label>
        {mode === 'cash' ? <label>Wallet<select name="wallet" required>{matchingWallets.map((wallet) => <option value={wallet.id} key={wallet.id}>{wallet.name}</option>)}</select>{matchingWallets.length === 0 ? <small className="field-error">No active {currency} wallet is available in this space.</small> : null}</label> : null}
        <label>Loan date<input name="effectiveDate" type="date" defaultValue={today()} required /></label>
        <label>Due date <span>(optional)</span><input name="dueDate" type="date" /></label>
        <label className="full-field">Note <span>(optional)</span><textarea name="note" maxLength={2000} rows={3} /></label>
      </div>
      {error ? <ErrorNotice error={error} /> : null}
      <footer className="dialog-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancel</button><button type="submit" disabled={busy || (mode === 'cash' && matchingWallets.length === 0)}>{busy ? 'Recording…' : mode === 'opening' ? 'Record opening' : direction === 'they_owe_me' ? 'Record lending' : 'Record borrowing'}</button></footer>
    </form>
  </Modal>;
}

function PlanFigures({ loan, locale }: { loan: Loan; locale: Locale }) {
  const items = [
    ['Monthly target', loan.plan.targetMinor], ['Paid this month', loan.plan.actualRepaymentMinor],
    ['Still reserved', loan.plan.remainingReservationMinor], ['Due amount', loan.plan.dueAmountMinor],
  ];
  return <dl className="detail-figures">{items.map(([label, amount]) => <div key={label}><dt>{label}</dt><dd><bdi>{formatMinorAmount(amount ?? '0', loan.currency, locale)}</bdi></dd></div>)}</dl>;
}

function historyLabel(loan: Loan, item: NonNullable<Loan['history']>[number], locale: Locale): string {
  const kind = item.kind === 'loan_lend' ? 'lending entry' : item.kind === 'loan_borrow' ? 'borrowing entry' : item.kind.includes('repayment') ? 'repayment' : item.kind === 'reversal' ? 'reversal' : 'opening entry';
  const date = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-LB' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${item.effectiveDate}T00:00:00Z`));
  return `Correct ${kind} from ${date}`;
}

export function LoanDetailDialog({ loan, locale, onClose, onRepay, onTarget, onCorrect }: { loan: Loan; locale: Locale; onClose: () => void; onRepay: () => void; onTarget: () => void; onCorrect: (eventId: string) => void }) {
  return <Modal title={`${loan.personName} loan details`} onClose={onClose} wide>
    <div className="detail-hero"><div><span className={`status status-${loan.status}`}>{loan.status[0]?.toUpperCase()}{loan.status.slice(1)}</span><p>{loan.direction === 'they_owe_me' ? 'They owe me' : 'I owe them'}</p></div><strong><bdi>{formatMinorAmount(loan.outstandingMinor, loan.currency, locale)}</bdi><small>remaining</small></strong></div>
    <dl className="detail-figures"><div><dt>Opening amount</dt><dd><bdi>{formatMinorAmount(loan.originalPrincipalMinor, loan.currency, locale)}</bdi></dd></div><div><dt>Total repaid</dt><dd><bdi>{formatMinorAmount(loan.totalRepaidMinor, loan.currency, locale)}</bdi></dd></div><div><dt>Due date</dt><dd><bdi>{loan.dueDate ?? 'No due date'}</bdi></dd></div></dl>
    {loan.direction === 'i_owe_them' ? <><PlanFigures loan={loan} locale={locale} /><button type="button" className="button-secondary" onClick={onTarget}>Change monthly target</button></> : null}
    <div className="section-heading"><h3>Ledger history</h3>{loan.status !== 'settled' ? <button type="button" onClick={onRepay}>{loan.direction === 'they_owe_me' ? 'Receive repayment' : 'Record repayment'}</button> : null}</div>
    <ol className="history">{loan.history?.map((item) => <li key={item.eventId}><div><strong>{item.kind.replaceAll('_', ' ')}</strong><span><bdi>{formatMinorAmount(item.principalDeltaMinor.replace('-', ''), loan.currency, locale)}</bdi> · <bdi>{item.effectiveDate}</bdi></span></div>{item.kind !== 'reversal' && !item.reversedBy ? <button type="button" className="text-button" aria-label={historyLabel(loan, item, locale)} onClick={() => onCorrect(item.eventId)}>Correct</button> : <span>Reversed</span>}</li>)}</ol>
  </Modal>;
}

export function RepaymentDialog({ loan, wallets, locale, onClose, onSave }: { loan: Loan; wallets: readonly Wallet[]; locale: Locale; onClose: () => void; onSave: (input: { spaceId: string; loanId: string; walletId: string; amountMinor: string; effectiveDate: string }) => Promise<void> }) {
  const [amount, setAmount] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<LoanErrorView | null>(null);
  const matching = wallets.filter((wallet) => wallet.archivedAt === null && wallet.currency === loan.currency);
  const action = loan.direction === 'they_owe_me' ? 'Receive' : 'Pay';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try {
      const amountMinor = parseMinorAmount(amount, loan.currency);
      if (BigInt(amountMinor) > BigInt(loan.outstandingMinor)) throw new Error('the repayment exceeds the outstanding principal');
      setBusy(true); setError(null);
      await onSave({ spaceId: loan.spaceId, loanId: loan.id, walletId: String(data.get('wallet')), amountMinor, effectiveDate: String(data.get('effectiveDate')) });
      onClose();
    } catch (cause) { setError(classifyLoanError(cause)); } finally { setBusy(false); }
  }
  return <Modal title={`${loan.direction === 'they_owe_me' ? 'Receive repayment from' : 'Record repayment to'} ${loan.personName}`} onClose={onClose} wide>
    <p className="dialog-intro">This records actual wallet money and reduces the outstanding principal together.</p>
    <form onSubmit={(event) => void submit(event)}><div className="form-grid">
      <label>Amount<input aria-label="Repayment amount" value={amount} onChange={(event) => setAmount(event.target.value)} required inputMode="decimal" /></label>
      <label>Wallet<select name="wallet" required>{matching.map((wallet) => <option value={wallet.id} key={wallet.id}>{wallet.name}</option>)}</select></label>
      <label>Payment date<input name="effectiveDate" type="date" defaultValue={today()} required /></label>
    </div><button type="button" className="text-button" onClick={() => setAmount(loan.currency === 'USD' ? (Number(loan.outstandingMinor) / 100).toFixed(2) : loan.outstandingMinor)}>Use full remaining amount</button>
    {error ? <ErrorNotice error={error} /> : null}<footer className="dialog-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancel</button><button type="submit" disabled={busy}>{busy ? 'Recording…' : `${action} ${amount ? (() => { try { return formatMinorAmount(parseMinorAmount(amount, loan.currency), loan.currency, locale); } catch { return 'amount'; } })() : 'amount'}`}</button></footer></form>
  </Modal>;
}

export function TargetDialog({ loan, month, onClose, onSave }: { loan: Loan; month: string; onClose: () => void; onSave: (input: { spaceId: string; loanId: string; month: string; targetMinor: string }) => Promise<void> }) {
  const [amount, setAmount] = useState(loan.currency === 'USD' ? (Number(loan.plan.targetMinor) / 100).toFixed(2) : loan.plan.targetMinor); const [busy, setBusy] = useState(false); const [error, setError] = useState<LoanErrorView | null>(null);
  async function submit(event: FormEvent) { event.preventDefault(); try { const targetMinor = amount.trim() === '0' ? '0' : parseMinorAmount(amount, loan.currency); if (BigInt(targetMinor) > BigInt(loan.outstandingMinor)) throw new Error('the monthly target cannot exceed outstanding principal'); setBusy(true); await onSave({ spaceId: loan.spaceId, loanId: loan.id, month, targetMinor }); onClose(); } catch (cause) { setError(classifyLoanError(cause)); } finally { setBusy(false); } }
  return <Modal title={`Monthly target for ${loan.personName}`} onClose={onClose}><form onSubmit={(event) => void submit(event)}><label>Target amount<input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required /></label><p className="field-note">Set 0 to clear this month’s target. A target reserves money in the plan; it does not pay the loan.</p>{error ? <ErrorNotice error={error} /> : null}<footer className="dialog-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancel</button><button type="submit" disabled={busy}>Save target</button></footer></form></Modal>;
}

export function CorrectionDialog({ loan, eventId, onClose, onSave }: { loan: Loan; eventId: string; onClose: () => void; onSave: (input: { spaceId: string; eventId: string; effectiveDate: string }) => Promise<void> }) {
  const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<LoanErrorView | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); try { setBusy(true); setError(null); await onSave({ spaceId: loan.spaceId, eventId, effectiveDate: String(data.get('effectiveDate')) }); onClose(); } catch (cause) { setError(classifyLoanError(cause)); } finally { setBusy(false); } }
  return <Modal title="Correct this ledger entry" onClose={onClose}><p className="dialog-intro">Posted history cannot be edited or deleted. This adds a linked reversal that restores both the wallet effect and the loan principal effect.</p><form onSubmit={(event) => void submit(event)}><label>Correction date<input name="effectiveDate" type="date" defaultValue={today()} required /></label><label className="confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I understand this adds a reversal</label>{error ? <ErrorNotice error={error} /> : null}<footer className="dialog-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancel</button><button type="submit" disabled={!confirmed || busy}>Add reversal</button></footer></form></Modal>;
}
