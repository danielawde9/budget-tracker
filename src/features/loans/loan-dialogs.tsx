import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { classifyLoanError } from './errors.js';
import { formatMinorAmount, parseMinorAmount } from './money.js';
import type { Currency, Loan, LoanErrorView, LoanHistoryItem, Locale, Wallet } from './types.js';

interface ModalProps { title: string; locale: Locale; onClose: () => void; children: ReactNode; wide?: boolean }

const localized = (locale: Locale, english: string, arabic: string) => locale === 'ar' ? arabic : english;

function Modal({ title, locale, onClose, children, wide = false }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  useEffect(() => {
    panel.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !panel.current) return;
      const controls = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')];
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); returnFocus.current?.focus(); };
  }, [onClose]);
  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`dialog ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel}>
        <header className="dialog-header"><h2>{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label={localized(locale, 'Close', 'إغلاق')}>×</button></header>
        {children}
      </div>
    </div>
  );
}

function ErrorNotice({ error, locale }: { error: LoanErrorView; locale: Locale }) {
  const arabic = {
    wrong_currency: ['اختر محفظة مطابقة', 'اختر محفظة فعالة في هذه المساحة وبعملة القرض نفسها.'],
    overpayment: ['المبلغ أكبر من القرض المتبقي', 'حدّث القرض وأدخل مبلغًا لا يتجاوز أصل الدين المتبقي.'],
    retry_collision: ['تغيّر هذا الطلب أثناء إعادة المحاولة', 'راجع السجل الحالي ثم أرسل التفاصيل المصححة كطلب جديد.'],
    missing_membership: ['لم يعد لديك وصول إلى هذه المساحة', 'انتقل إلى مساحة أخرى أو اطلب من مدير المنزل إعادة عضويتك.'],
    dependent_repayment: ['تعتمد دفعات لاحقة على هذا القيد', 'اعكس الدفعات اللاحقة أولًا، ثم أعد محاولة هذا التصحيح.'],
    target_above_outstanding: ['الهدف أكبر من القرض المتبقي', 'أدخل هدفًا شهريًا لا يتجاوز أصل الدين المتبقي.'],
    database_rejection: ['لم يتم تسجيل التغيير', 'راجع التفاصيل وحدّث السجل ثم حاول مجددًا.'],
  } as const;
  const translated = arabic[error.code];
  return <div className="error-notice" role="alert"><strong>{locale === 'ar' ? translated[0] : error.title}</strong><p><bdi>{error.message}</bdi></p><p>{locale === 'ar' ? translated[1] : error.recovery}</p></div>;
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

  return <Modal title={localized(locale, 'Add a loan', 'إضافة قرض')} locale={locale} onClose={onClose} wide>
    <p className="dialog-intro">{mode === 'opening' ? localized(locale, 'Record what is already outstanding. No wallet money moves.', 'سجّل المبلغ القائم حاليًا. لن تتحرك أموال أي محفظة.') : direction === 'they_owe_me' ? localized(locale, 'Record money leaving a wallet and becoming owed to you.', 'سجّل مالًا خرج من محفظة وأصبح دينًا مستحقًا لك.') : localized(locale, 'Record money entering a wallet and becoming owed by you.', 'سجّل مالًا دخل إلى محفظة وأصبح دينًا مستحقًا عليك.')}</p>
    <form onSubmit={(event) => void submit(event)}>
      <fieldset className="choice-grid"><legend>{localized(locale, 'What happened?', 'ماذا حدث؟')}</legend>
        <label><input type="radio" name="mode" checked={mode === 'opening'} onChange={() => setMode('opening')} /> {localized(locale, 'Opening outstanding', 'رصيد قائم عند البدء')}</label>
        <label><input type="radio" name="mode" checked={mode === 'cash' && direction === 'they_owe_me'} onChange={() => { setMode('cash'); setDirection('they_owe_me'); }} /> {localized(locale, 'I lent money', 'أقرضت مالًا')}</label>
        <label><input type="radio" name="mode" checked={mode === 'cash' && direction === 'i_owe_them'} onChange={() => { setMode('cash'); setDirection('i_owe_them'); }} /> {localized(locale, 'I borrowed money', 'اقترضت مالًا')}</label>
      </fieldset>
      {mode === 'opening' ? <fieldset className="segmented"><legend>{localized(locale, 'Direction', 'اتجاه الدين')}</legend><label><input type="radio" name="direction" checked={direction === 'they_owe_me'} onChange={() => setDirection('they_owe_me')} /> {localized(locale, 'They owe me', 'لديهم دين لي')}</label><label><input type="radio" name="direction" checked={direction === 'i_owe_them'} onChange={() => setDirection('i_owe_them')} /> {localized(locale, 'I owe them', 'عليّ دين لهم')}</label></fieldset> : null}
      <div className="form-grid">
        <label>{localized(locale, 'Person', 'الشخص')}<input name="person" required maxLength={120} autoFocus /></label>
        <label>{localized(locale, 'Currency', 'العملة')}<select name="currency" value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}><option>USD</option><option>LBP</option></select></label>
        <label>{localized(locale, 'Amount', 'المبلغ')}<input name="amount" required inputMode="decimal" placeholder={currency === 'USD' ? '0.00' : '0'} /></label>
        {mode === 'cash' ? <label>{localized(locale, 'Wallet', 'المحفظة')}<select name="wallet" required>{matchingWallets.map((wallet) => <option value={wallet.id} key={wallet.id}>{wallet.name}</option>)}</select>{matchingWallets.length === 0 ? <small className="field-error">{localized(locale, `No active ${currency} wallet is available in this space.`, `لا توجد محفظة ${currency} فعالة في هذه المساحة.`)}</small> : null}</label> : null}
        <label>{localized(locale, 'Loan date', 'تاريخ القرض')}<input name="effectiveDate" type="date" defaultValue={today()} required /></label>
        <label>{localized(locale, 'Due date', 'تاريخ الاستحقاق')} <span>{localized(locale, '(optional)', '(اختياري)')}</span><input name="dueDate" type="date" /></label>
        <label className="full-field">{localized(locale, 'Note', 'ملاحظة')} <span>{localized(locale, '(optional)', '(اختياري)')}</span><textarea name="note" maxLength={2000} rows={3} /></label>
      </div>
      {error ? <ErrorNotice error={error} locale={locale} /> : null}
      <footer className="dialog-actions"><button type="button" className="button-secondary" onClick={onClose}>{localized(locale, 'Cancel', 'إلغاء')}</button><button type="submit" disabled={busy || (mode === 'cash' && matchingWallets.length === 0)}>{busy ? localized(locale, 'Recording…', 'جارٍ التسجيل…') : mode === 'opening' ? localized(locale, 'Record opening', 'تسجيل الرصيد القائم') : direction === 'they_owe_me' ? localized(locale, 'Record lending', 'تسجيل الإقراض') : localized(locale, 'Record borrowing', 'تسجيل الاقتراض')}</button></footer>
    </form>
  </Modal>;
}

function PlanFigures({ loan, locale }: { loan: Loan; locale: Locale }) {
  const items = [
    [localized(locale, 'Monthly target', 'هدف الشهر'), loan.plan.targetMinor], [localized(locale, 'Paid this month', 'المدفوع هذا الشهر'), loan.plan.actualRepaymentMinor],
    [localized(locale, 'Still reserved', 'المحجوز المتبقي'), loan.plan.remainingReservationMinor], [localized(locale, 'Due amount', 'المبلغ المستحق'), loan.plan.dueAmountMinor],
  ];
  return <dl className="detail-figures">{items.map(([label, amount]) => <div key={label}><dt>{label}</dt><dd><bdi>{formatMinorAmount(amount ?? '0', loan.currency, locale)}</bdi></dd></div>)}</dl>;
}

function historyLabel(loan: Loan, item: NonNullable<Loan['history']>[number], locale: Locale): string {
  const kindLabels = {
    loan_opening: ['opening entry', 'رصيد افتتاحي'],
    loan_lend: ['lending entry', 'قرض إقراض'],
    loan_borrow: ['borrowing entry', 'قرض اقتراض'],
    loan_receive_repayment: ['received repayment', 'دفعة مستلمة'],
    loan_repay_borrowing: ['borrowing repayment', 'دفعة سداد قرض'],
    reversal: ['reversal', 'قيد عكسي'],
  } as const satisfies Record<LoanHistoryItem['kind'], readonly [string, string]>;
  const kindLabel = kindLabels[item.kind];
  const kind = localized(locale, kindLabel[0], kindLabel[1]);
  const date = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-LB' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${item.effectiveDate}T00:00:00Z`));
  return localized(locale, `Correct ${kind} from ${date}`, `تصحيح ${kind} بتاريخ ${date}`);
}

export function LoanDetailDialog({ loan, locale, onClose, onRepay, onTarget, onCorrect }: { loan: Loan; locale: Locale; onClose: () => void; onRepay: () => void; onTarget: () => void; onCorrect: (eventId: string) => void }) {
  return <Modal title={localized(locale, `${loan.personName} loan details`, `تفاصيل قرض ${loan.personName}`)} locale={locale} onClose={onClose} wide>
    <div className="detail-hero"><div><span className={`status status-${loan.status}`}>{localized(locale, loan.status[0]?.toUpperCase() + loan.status.slice(1), loan.status === 'settled' ? 'مسدّد' : loan.status === 'overdue' ? 'متأخر' : 'قائم')}</span><p>{localized(locale, loan.direction === 'they_owe_me' ? 'They owe me' : 'I owe them', loan.direction === 'they_owe_me' ? 'لديهم دين لي' : 'عليّ دين لهم')}</p></div><strong><bdi>{formatMinorAmount(loan.outstandingMinor, loan.currency, locale)}</bdi><small>{localized(locale, 'remaining', 'متبقٍ')}</small></strong></div>
    <dl className="detail-figures detail-figures-three"><div><dt>{localized(locale, 'Opening amount', 'المبلغ عند البدء')}</dt><dd><bdi>{formatMinorAmount(loan.originalPrincipalMinor, loan.currency, locale)}</bdi></dd></div><div><dt>{localized(locale, 'Total repaid', 'إجمالي المسدّد')}</dt><dd><bdi>{formatMinorAmount(loan.totalRepaidMinor, loan.currency, locale)}</bdi></dd></div><div><dt>{localized(locale, 'Due date', 'تاريخ الاستحقاق')}</dt><dd><bdi>{loan.dueDate ?? localized(locale, 'No due date', 'بدون تاريخ استحقاق')}</bdi></dd></div></dl>
    {loan.direction === 'i_owe_them' ? <><PlanFigures loan={loan} locale={locale} /><button type="button" className="button-secondary" onClick={onTarget}>{localized(locale, 'Change monthly target', 'تغيير هدف الشهر')}</button></> : null}
    <div className="section-heading"><h3>{localized(locale, 'Ledger history', 'سجل القيود')}</h3>{loan.status !== 'settled' ? <button type="button" onClick={onRepay}>{localized(locale, loan.direction === 'they_owe_me' ? 'Receive repayment' : 'Record repayment', loan.direction === 'they_owe_me' ? 'تسجيل دفعة مستلمة' : 'تسجيل دفعة')}</button> : null}</div>
    <ol className="history">{loan.history?.map((item) => <li key={item.eventId}><div><strong><bdi>{item.kind.replaceAll('_', ' ')}</bdi></strong><span><bdi>{formatMinorAmount(item.principalDeltaMinor.replace('-', ''), loan.currency, locale)}</bdi> · <bdi>{item.effectiveDate}</bdi></span></div>{item.kind !== 'reversal' && !item.reversedBy ? <button type="button" className="text-button" aria-label={historyLabel(loan, item, locale)} onClick={() => onCorrect(item.eventId)}>{localized(locale, 'Correct', 'تصحيح')}</button> : <span>{localized(locale, 'Reversed', 'معكوس')}</span>}</li>)}</ol>
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
  return <Modal title={localized(locale, `${loan.direction === 'they_owe_me' ? 'Receive repayment from' : 'Record repayment to'} ${loan.personName}`, `${loan.direction === 'they_owe_me' ? 'تسجيل دفعة مستلمة من' : 'تسجيل دفعة إلى'} ${loan.personName}`)} locale={locale} onClose={onClose} wide>
    <p className="dialog-intro">{localized(locale, 'This records actual wallet money and reduces the outstanding principal together.', 'يسجّل هذا حركة المال الفعلية ويخفّض أصل الدين القائم معًا.')}</p>
    <form onSubmit={(event) => void submit(event)}><div className="form-grid">
      <label>{localized(locale, 'Amount', 'المبلغ')}<input aria-label={localized(locale, 'Repayment amount', 'مبلغ الدفعة')} value={amount} onChange={(event) => setAmount(event.target.value)} required inputMode="decimal" /></label>
      <label>{localized(locale, 'Wallet', 'المحفظة')}<select name="wallet" required>{matching.map((wallet) => <option value={wallet.id} key={wallet.id}>{wallet.name}</option>)}</select></label>
      <label>{localized(locale, 'Payment date', 'تاريخ الدفعة')}<input name="effectiveDate" type="date" defaultValue={today()} required /></label>
    </div><button type="button" className="text-button" onClick={() => setAmount(loan.currency === 'USD' ? (Number(loan.outstandingMinor) / 100).toFixed(2) : loan.outstandingMinor)}>{localized(locale, 'Use full remaining amount', 'استخدام كامل المبلغ المتبقي')}</button>
    {error ? <ErrorNotice error={error} locale={locale} /> : null}<footer className="dialog-actions"><button type="button" className="button-secondary" onClick={onClose}>{localized(locale, 'Cancel', 'إلغاء')}</button><button type="submit" disabled={busy}>{busy ? localized(locale, 'Recording…', 'جارٍ التسجيل…') : `${localized(locale, action, loan.direction === 'they_owe_me' ? 'استلام' : 'دفع')} ${amount ? (() => { try { return formatMinorAmount(parseMinorAmount(amount, loan.currency), loan.currency, locale); } catch { return localized(locale, 'amount', 'المبلغ'); } })() : localized(locale, 'amount', 'المبلغ')}`}</button></footer></form>
  </Modal>;
}

export function TargetDialog({ loan, month, locale, onClose, onSave }: { loan: Loan; month: string; locale: Locale; onClose: () => void; onSave: (input: { spaceId: string; loanId: string; month: string; targetMinor: string }) => Promise<void> }) {
  const [amount, setAmount] = useState(loan.currency === 'USD' ? (Number(loan.plan.targetMinor) / 100).toFixed(2) : loan.plan.targetMinor); const [busy, setBusy] = useState(false); const [error, setError] = useState<LoanErrorView | null>(null);
  async function submit(event: FormEvent) { event.preventDefault(); try { const targetMinor = amount.trim() === '0' ? '0' : parseMinorAmount(amount, loan.currency); if (BigInt(targetMinor) > BigInt(loan.outstandingMinor)) throw new Error('the monthly target cannot exceed outstanding principal'); setBusy(true); await onSave({ spaceId: loan.spaceId, loanId: loan.id, month, targetMinor }); onClose(); } catch (cause) { setError(classifyLoanError(cause)); } finally { setBusy(false); } }
  return <Modal title={localized(locale, `Monthly target for ${loan.personName}`, `هدف الشهر لقرض ${loan.personName}`)} locale={locale} onClose={onClose}><form onSubmit={(event) => void submit(event)}><label>{localized(locale, 'Target amount', 'مبلغ الهدف')}<input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required /></label><p className="field-note">{localized(locale, 'Set 0 to clear this month’s target. A target reserves money in the plan; it does not pay the loan.', 'ضع صفرًا لمسح هدف هذا الشهر. الهدف يحجز المال في الخطة ولا يسدّد القرض.')}</p>{error ? <ErrorNotice error={error} locale={locale} /> : null}<footer className="dialog-actions"><button type="button" className="button-secondary" onClick={onClose}>{localized(locale, 'Cancel', 'إلغاء')}</button><button type="submit" disabled={busy}>{localized(locale, 'Save target', 'حفظ الهدف')}</button></footer></form></Modal>;
}

export function CorrectionDialog({ loan, eventId, locale, onClose, onSave }: { loan: Loan; eventId: string; locale: Locale; onClose: () => void; onSave: (input: { spaceId: string; eventId: string; effectiveDate: string }) => Promise<void> }) {
  const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<LoanErrorView | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); try { setBusy(true); setError(null); await onSave({ spaceId: loan.spaceId, eventId, effectiveDate: String(data.get('effectiveDate')) }); onClose(); } catch (cause) { setError(classifyLoanError(cause)); } finally { setBusy(false); } }
  return <Modal title={localized(locale, 'Correct this ledger entry', 'تصحيح هذا القيد')} locale={locale} onClose={onClose}><p className="dialog-intro">{localized(locale, 'Posted history cannot be edited or deleted. This adds a linked reversal that restores both the wallet effect and the loan principal effect.', 'لا يمكن تعديل السجل المرحّل أو حذفه. يضيف هذا قيدًا عكسيًا مرتبطًا يعيد أثر المحفظة وأصل الدين معًا.')}</p><form onSubmit={(event) => void submit(event)}><label>{localized(locale, 'Correction date', 'تاريخ التصحيح')}<input name="effectiveDate" type="date" defaultValue={today()} required /></label><label className="confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> {localized(locale, 'I understand this adds a reversal', 'أفهم أن هذا يضيف قيدًا عكسيًا')}</label>{error ? <ErrorNotice error={error} locale={locale} /> : null}<footer className="dialog-actions"><button type="button" className="button-secondary" onClick={onClose}>{localized(locale, 'Cancel', 'إلغاء')}</button><button type="submit" disabled={!confirmed || busy}>{localized(locale, 'Add reversal', 'إضافة القيد العكسي')}</button></footer></form></Modal>;
}
