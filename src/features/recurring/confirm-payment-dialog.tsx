import { useEffect, useId, useState, type FormEvent } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount, parsePositiveMinorAmount } from '../wallets/money.js';
import { DialogShell } from '../wallets/dialog-shell.js';
import { classifyRecurringError, localizeRecurringError } from './errors.js';
import type { LinkableEventOption, LinkableEventsQuery } from './linkable-events.js';
import { useSpaceClock } from '../workspace/space-clock.js';
import type { ScheduleKind } from './types.js';
import type { CommandOutcome } from './use-recurring.js';

type PaymentMode = 'confirm' | 'link';

interface ConfirmPaymentOccurrence {
  readonly id: string;
  readonly kind: ScheduleKind;
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
  /** Loads the existing wallet events a person can pick to settle this
   * occurrence (read-only, through the wallets gateway, D4). When it is
   * absent, the 'Link an existing transaction' mode cannot list candidates and
   * says so rather than falling back to a pasted id. */
  loadLinkableEvents?: (query: LinkableEventsQuery) => Promise<readonly LinkableEventOption[]>;
  pending: boolean;
  ambiguous: boolean;
  onClose(): void;
  onClearAmbiguous(): void;
  onRetry(): Promise<CommandOutcome>;
  onConfirm(input: { occurrenceId: string; expectedEventId: string | null; actualAmountMinor: string; effectiveDate: string; walletId: string }): Promise<CommandOutcome>;
  onLinkExisting(input: { occurrenceId: string; eventId: string; amountMinor: string; expectedEventId: string | null }): Promise<CommandOutcome>;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

/** The transaction amount as the amount field's own text (`45.00` for USD,
 * `4500` for LBP), so choosing a candidate pre-fills a valid, editable amount. */
function minorToInput(amountMinor: string, currency: Currency): string {
  const value = BigInt(amountMinor);
  if (currency === 'LBP') return value.toString();
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}

export function ConfirmPaymentDialog(props: ConfirmPaymentDialogProps) {
  const descriptionId = useId();
  // W4a-1: the date default and the "today or earlier" bound come from the
  // space's single server clock -- not a second browser/UTC clock.
  const serverToday = useSpaceClock()?.today ?? '';
  const [mode, setMode] = useState<PaymentMode>('confirm');
  const [amountMajor, setAmountMajor] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(serverToday);
  const [walletId, setWalletId] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [candidates, setCandidates] = useState<readonly LinkableEventOption[] | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const { loadLinkableEvents } = props;
  const { kind } = props.occurrence;
  const { currency, locale } = props;
  // Load the candidates once, the first time link mode is shown. The guard
  // (not a cleanup flag) is what keeps a still-pending load from being
  // cancelled by this effect's own `setLoadingCandidates` re-render.
  useEffect(() => {
    if (mode !== 'link' || !loadLinkableEvents || candidates !== null || loadingCandidates) return;
    setLoadingCandidates(true);
    setCandidatesError(null);
    loadLinkableEvents({ kind, currency })
      .then((options) => setCandidates(options))
      .catch(() => setCandidatesError(t(locale, 'Your wallet transactions could not be loaded. Try again.', 'تعذر تحميل معاملات محفظتك. حاول مرة أخرى.')))
      .finally(() => setLoadingCandidates(false));
  }, [mode, candidates, loadingCandidates, loadLinkableEvents, kind, currency, locale]);

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
      if (!validDate(effectiveDate) || (serverToday !== '' && effectiveDate > serverToday)) {
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

    if (!selectedEventId) {
      setError(t(props.locale, 'Choose the wallet transaction this bill paid.', 'اختر معاملة المحفظة التي دفعت هذه الفاتورة.'));
      return;
    }
    void run(() => props.onLinkExisting({ occurrenceId: props.occurrence.id, eventId: selectedEventId, amountMinor, expectedEventId }));
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

      <fieldset className="cr-choice">
        <legend>{t(props.locale, 'Action', 'الإجراء')}</legend>
        <label><input type="radio" name="rec-payment-mode" checked={mode === 'confirm'} onChange={() => { setMode('confirm'); setError(null); }} />{t(props.locale, 'Record payment', 'تسجيل الدفعة')}</label>
        <label><input type="radio" name="rec-payment-mode" checked={mode === 'link'} onChange={() => { setMode('link'); setError(null); }} />{t(props.locale, 'Link an existing transaction', 'ربط معاملة موجودة')}</label>
      </fieldset>

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
        <label className="full-field">{t(props.locale, 'Wallet transaction', 'معاملة المحفظة')}
          <select data-autofocus value={selectedEventId} disabled={!loadLinkableEvents || loadingCandidates || candidatesError !== null}
            onChange={(event) => {
              const option = (candidates ?? []).find((candidate) => candidate.id === event.target.value);
              setSelectedEventId(event.target.value);
              setAmountMajor(option ? minorToInput(option.amountMinor, option.currency) : '');
              setError(null);
            }}>
            <option value="">{t(props.locale, 'Choose a transaction', 'اختر معاملة')}</option>
            {(candidates ?? []).map((option) => <option key={option.id} value={option.id}>
              {option.effectiveDate} · {option.label} · {formatMinorAmount(option.amountMinor, option.currency, props.locale)}
            </option>)}
          </select></label>
        {loadingCandidates && <p className="rec-label-muted">{t(props.locale, 'Loading your wallet transactions…', 'جارٍ تحميل معاملات محفظتك…')}</p>}
        {candidatesError && <div className="error-notice" role="alert">{candidatesError}</div>}
        {!loadLinkableEvents && <p className="rec-label-muted">{t(props.locale, 'Linking a transaction is unavailable right now.', 'ربط معاملة غير متاح الآن.')}</p>}
        {candidates !== null && candidates.length === 0 && <p className="rec-label-muted">{t(props.locale, 'No matching wallet transaction yet. Record it in Wallets, then link it here.', 'لا توجد معاملة مطابقة بعد. سجّلها في المحافظ ثم اربطها هنا.')}</p>}
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
