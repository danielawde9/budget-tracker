import { useId, useState, type FormEvent } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount, parsePositiveMinorAmount } from '../wallets/money.js';
import { DialogShell } from '../wallets/dialog-shell.js';
import { classifyGoalsError, localizeGoalsError } from './errors.js';
import type { CommandOutcome } from './use-goals.js';
import type { GoalSummary } from './types.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface GoalPurchaseDialogProps {
  locale: Locale;
  currency: Currency;
  goal: GoalSummary;
  goalHead: string;
  pending: boolean;
  ambiguous: boolean;
  onClose(): void;
  onClearAmbiguous(): void;
  onRetry(): Promise<CommandOutcome>;
  onSubmit(input: { expenseEventId: string; amountMinor: string; expectedHead: string }): Promise<CommandOutcome>;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

/** Existing expense creation stays in the Wallets/Record flow (out of scope
 * for this task); a wallet-side "link this to a goal" entry point is a
 * later integration. This dialog is reached from the goal's own detail
 * page, so the expense is identified by pasting its reference id rather
 * than browsing a picker this task does not own. */
export function GoalPurchaseDialog(props: GoalPurchaseDialogProps) {
  const descriptionId = useId();
  const [expenseEventId, setExpenseEventId] = useState('');
  const [amountText, setAmountText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function run(action: () => Promise<CommandOutcome>) {
    setError(null);
    try {
      const outcome = await action();
      if (outcome.status === 'success' || outcome.status === 'refresh-required') setSuccess(true);
      else if (outcome.status !== 'ambiguous') setError(t(props.locale, 'The result is still unknown. Retry only with this unchanged request.', 'ما زالت النتيجة غير معروفة. أعد المحاولة بهذا الطلب نفسه فقط.'));
    } catch (cause) {
      const view = localizeGoalsError(classifyGoalsError(cause), props.locale);
      setError(`${view.message} ${view.recovery}`);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const id = expenseEventId.trim();
    if (!UUID_PATTERN.test(id)) {
      setError(t(props.locale, 'Enter the expense’s reference id exactly as shown in its history.', 'أدخل معرّف المصروف كما يظهر تمامًا في سجله.'));
      return;
    }
    let amountMinor: string;
    try {
      amountMinor = parsePositiveMinorAmount(amountText, props.currency);
    } catch {
      setError(t(props.locale, 'Enter a valid positive amount.', 'أدخل مبلغًا موجبًا صالحًا.'));
      return;
    }
    void run(() => props.onSubmit({ expenseEventId: id, amountMinor, expectedHead: props.goalHead }));
  }

  const goalName = props.locale === 'ar' ? (props.goal.nameAr ?? props.goal.nameEn) : (props.goal.nameEn ?? props.goal.nameAr);

  if (success) return <DialogShell title={t(props.locale, 'Link a purchase', 'ربط عملية شراء')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} descriptionId={descriptionId} focusVersion="success">
    <div className="dialog-result" role="status">
      <strong>{t(props.locale, 'Purchase linked', 'تم ربط الشراء')}</strong>
      <p id={descriptionId}>{t(props.locale, 'The expense now counts toward this goal’s fulfilled amount.', 'يُحتسب المصروف الآن ضمن المبلغ المُنجز لهذا الهدف.')}</p>
      <button type="button" data-autofocus onClick={props.onClose}>{t(props.locale, 'Done', 'تم')}</button>
    </div>
  </DialogShell>;

  return <DialogShell title={t(props.locale, 'Link a purchase', 'ربط عملية شراء')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending} descriptionId={descriptionId}>
    <form onSubmit={submit}>
      <p id={descriptionId} className="dialog-intro">
        {t(props.locale, 'Link an already-recorded expense to', 'اربط مصروفًا مُسجّلًا مسبقًا بـ')} <bdi>{goalName}</bdi>. {t(props.locale, 'Record the expense itself from Wallets first.', 'سجّل المصروف نفسه من المحافظ أولًا.')}
      </p>
      <label className="full-field">
        {t(props.locale, 'Expense reference id', 'معرّف المصروف')}
        <input data-autofocus type="text" placeholder={t(props.locale, 'e.g. 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d', 'مثال: 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d')} value={expenseEventId} onChange={(event) => { setExpenseEventId(event.target.value); setError(null); }} />
      </label>
      <label className="full-field">
        {t(props.locale, 'Amount to link', 'المبلغ المراد ربطه')}
        <input type="text" inputMode="decimal" placeholder={props.currency === 'USD' ? '0.00' : '0'} value={amountText} onChange={(event) => { setAmountText(event.target.value); setError(null); }} />
      </label>
      <span className="field-note" role="status">{t(props.locale, 'Already fulfilled', 'المُنجز حاليًا')}: <bdi>{formatMinorAmount(props.goal.fulfilledMinor, props.currency, props.locale)}</bdi></span>
      {error && <div className="error-notice" role="alert">
        {error}
        {props.ambiguous && <div><button type="button" className="button-secondary retry-command" onClick={() => void run(props.onRetry)}>{t(props.locale, 'Retry unchanged request', 'إعادة الطلب دون تغيير')}</button></div>}
      </div>}
      <div className="dialog-actions">
        <button type="button" className="button-secondary" disabled={props.pending} onClick={props.onClose}>{t(props.locale, 'Cancel', 'إلغاء')}</button>
        <button type="submit" className="cr-button cr-button--primary" disabled={props.pending}>{props.pending ? t(props.locale, 'Linking…', 'جارٍ الربط…') : t(props.locale, 'Link purchase', 'ربط الشراء')}</button>
      </div>
    </form>
  </DialogShell>;
}
