import { useId, useState, type FormEvent } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount, parsePositiveMinorAmount } from '../wallets/money.js';
import { DialogShell } from '../wallets/dialog-shell.js';
import { classifyRecurringError, localizeRecurringError } from './errors.js';
import type { CommandOutcome } from './use-recurring.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type PaymentMode = 'confirm' | 'link';

interface ConfirmPaymentOccurrence {
  readonly id: string;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly currentEventId: string | null;
  readonly remainingMinor: string;
}

interface ConfirmPaymentDialogProps {
  locale: Locale;
  currency: Currency;
  occurrence: ConfirmPaymentOccurrence;
  /** Wallets offered by the 'Paying wallet' dropdown; the select submits the
   * chosen wallet's own id. */
  walletOptions: ReadonlyArray<{ readonly id: string; readonly name: string; readonly currency: string }>;
  /** False for a `debt_payment` occurrence -- loan occurrences use the
   * existing loan repayment flow, never this dialog's generic wallet/amount
   * fields ("do not invent a new loan-posting path here"). Record the
   * repayment from Loans first, then link it here. */
  allowConfirm: boolean;
  pending: boolean;
  ambiguous: boolean;
  onClose(): void;
  onClearAmbiguous(): void;
  onRetry(): Promise<CommandOutcome>;
  onConfirm(input: { occurrenceId: string; expectedEventId: string | null; actualAmountMinor: string; effectiveDate: string; walletId: string }): Promise<CommandOutcome>;
  onLinkExisting(input: { occurrenceId: string; eventId: string; amountMinor: string; expectedEventId: string | null }): Promise<CommandOutcome>;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;
const todayIso = () => new Date().toISOString().slice(0, 10);

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function ConfirmPaymentDialog(props: ConfirmPaymentDialogProps) {
  const descriptionId = useId();
  const referenceHintId = useId();
  const [mode, setMode] = useState<PaymentMode>(props.allowConfirm ? 'confirm' : 'link');
  const [amountMajor, setAmountMajor] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [walletId, setWalletId] = useState('');
  const [eventIdText, setEventIdText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function run(action: () => Promise<CommandOutcome>) {
    setError(null);
    try {
      const outcome = await action();
      if (outcome.status === 'success' || outcome.status === 'refresh-required') setSuccess(true);
      else if (outcome.status !== 'ambiguous') setError(t(props.locale, 'The result is still unknown. Retry only with this unchanged request.', 'ما زالت النتيجة غير معروفة. أعد المحاولة بهذا الطلب نفسه فقط.'));
    } catch (cause) {
      const view = localizeRecurringError(classifyRecurringError(cause), props.locale);
      setError(`${view.message} ${view.recovery}`);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    let amountMinor: string;
    try {
      amountMinor = parsePositiveMinorAmount(amountMajor, props.currency);
    } catch {
      setError(t(props.locale, 'Enter a valid positive amount.', 'أدخل مبلغًا موجبًا صالحًا.'));
      return;
    }
    const expectedEventId = props.occurrence.currentEventId;

    if (mode === 'confirm') {
      if (!validDate(effectiveDate) || effectiveDate > todayIso()) {
        setError(t(props.locale, 'Choose today or an earlier date.', 'اختر تاريخ اليوم أو تاريخًا أسبق.'));
        return;
      }
      if (!walletId) {
        setError(t(props.locale, 'Select the paying wallet.', 'اختر محفظة الدفع.'));
        return;
      }
      void run(() => props.onConfirm({ occurrenceId: props.occurrence.id, expectedEventId, actualAmountMinor: amountMinor, effectiveDate, walletId }));
      return;
    }

    const eventId = eventIdText.trim();
    if (!UUID_PATTERN.test(eventId)) {
      setError(t(props.locale, 'Enter the transaction’s exact reference id.', 'أدخل المعرّف المرجعي الدقيق للمعاملة.'));
      return;
    }
    void run(() => props.onLinkExisting({ occurrenceId: props.occurrence.id, eventId, amountMinor, expectedEventId }));
  }

  const name = props.locale === 'ar' ? (props.occurrence.nameAr ?? props.occurrence.nameEn) : (props.occurrence.nameEn ?? props.occurrence.nameAr);
  const title = mode === 'confirm' ? t(props.locale, 'Record payment', 'تسجيل الدفعة') : t(props.locale, 'Link an existing transaction', 'ربط معاملة موجودة');

  if (success) return <DialogShell title={title} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} descriptionId={descriptionId} focusVersion="success">
    <div className="dialog-result" role="status">
      <strong>{t(props.locale, 'Saved', 'تم الحفظ')}</strong>
      <p id={descriptionId}>{t(props.locale, 'The payment has been recorded against this occurrence.', 'تم تسجيل الدفعة مقابل هذه الدفعة المستحقة.')}</p>
      <button type="button" data-autofocus onClick={props.onClose}>{t(props.locale, 'Done', 'تم')}</button>
    </div>
  </DialogShell>;

  return <DialogShell title={title} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending} descriptionId={descriptionId}>
    <form onSubmit={submit}>
      <p id={descriptionId} className="dialog-intro">
        <bdi>{name}</bdi> — {t(props.locale, 'remaining', 'المتبقي')}: <bdi>{formatMinorAmount(props.occurrence.remainingMinor, props.currency, props.locale)}</bdi>
      </p>

      {!props.allowConfirm && <div className="error-notice" role="status">
        {t(props.locale, 'This is a debt payment occurrence. Record the repayment itself from the loan’s own repayment flow, then link it here.', 'هذه دفعة مستحقة لسداد دين. سجّل السداد نفسه من مسار سداد القرض الخاص به، ثم اربطه هنا.')}
      </div>}

      {props.allowConfirm && <fieldset className="cr-choice">
        <legend>{t(props.locale, 'Action', 'الإجراء')}</legend>
        <label><input type="radio" name="rec-payment-mode" checked={mode === 'confirm'} onChange={() => { setMode('confirm'); setError(null); }} />{t(props.locale, 'Record payment', 'تسجيل الدفعة')}</label>
        <label><input type="radio" name="rec-payment-mode" checked={mode === 'link'} onChange={() => { setMode('link'); setError(null); }} />{t(props.locale, 'Link an existing transaction', 'ربط معاملة موجودة')}</label>
      </fieldset>}

      {mode === 'confirm' && <>
        <label className="full-field">{t(props.locale, 'Actual amount', 'المبلغ الفعلي')}
          <input data-autofocus type="text" inputMode="decimal" placeholder={props.currency === 'USD' ? '0.00' : '0'} value={amountMajor} onChange={(event) => { setAmountMajor(event.target.value); setError(null); }} /></label>
        <label className="full-field">{t(props.locale, 'Effective date', 'تاريخ التنفيذ')}
          <input type="date" value={effectiveDate} onChange={(event) => { setEffectiveDate(event.target.value); setError(null); }} /></label>
        <label className="full-field">{t(props.locale, 'Paying wallet', 'محفظة الدفع')}
          <select value={walletId} onChange={(event) => { setWalletId(event.target.value); setError(null); }}>
            <option value="">{t(props.locale, 'Select a wallet', 'اختر محفظة')}</option>
            {props.walletOptions.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name} · {wallet.currency}</option>)}
          </select></label>
      </>}

      {mode === 'link' && <>
        <label className="full-field">{t(props.locale, 'Transaction reference id', 'المعرّف المرجعي للمعاملة')}
          <input data-autofocus type="text" placeholder={t(props.locale, 'e.g. 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d', 'مثال: 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d')} value={eventIdText} aria-describedby={referenceHintId} onChange={(event) => { setEventIdText(event.target.value); setError(null); }} /></label>
        {/* No list of candidate events exists in this dialog's data scope --
           `useRecurring` loads only the occurrence page, and link mode must
           stay reachable for debt-payment occurrences recorded from Loans --
           so the reference stays a pasted id, with the hint pointing at where
           that id is shown. */}
        <p id={referenceHintId} className="rec-label-muted">{t(props.locale, 'Find the reference id on the transaction’s entry in the Wallets section.', 'اعثر على المعرّف المرجعي في قيد المعاملة ضمن قسم المحافظ.')}</p>
        <label className="full-field">{t(props.locale, 'Amount to link', 'المبلغ المراد ربطه')}
          <input type="text" inputMode="decimal" placeholder={props.currency === 'USD' ? '0.00' : '0'} value={amountMajor} onChange={(event) => { setAmountMajor(event.target.value); setError(null); }} /></label>
      </>}

      {error && <div className="error-notice" role="alert">
        {error}
        {props.ambiguous && <div><button type="button" className="button-secondary retry-command" onClick={() => void run(props.onRetry)}>{t(props.locale, 'Retry unchanged request', 'إعادة الطلب دون تغيير')}</button></div>}
      </div>}
      <div className="dialog-actions">
        <button type="button" className="button-secondary" disabled={props.pending} onClick={props.onClose}>{t(props.locale, 'Cancel', 'إلغاء')}</button>
        <button type="submit" className="cr-button cr-button--primary" disabled={props.pending}>{props.pending ? t(props.locale, 'Saving…', 'جارٍ الحفظ…') : t(props.locale, 'Save', 'حفظ')}</button>
      </div>
    </form>
  </DialogShell>;
}
