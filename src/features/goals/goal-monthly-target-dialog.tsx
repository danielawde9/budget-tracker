import { useId, useState, type FormEvent } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import { DialogShell } from '../wallets/dialog-shell.js';
import { classifyGoalsError, localizeGoalsError } from './errors.js';
import type { CommandOutcome } from './use-goals.js';

/** A monthly target may be zero (it clears the goal's target for the month),
 * so unlike `parsePositiveMinorAmount` this accepts `0`. */
function parseNonnegativeMinor(rawValue: string, currency: Currency): string {
  const value = rawValue.replaceAll(',', '').trim();
  const match = (currency === 'USD' ? /^(\d+)(?:\.(\d{1,2}))?$/ : /^(\d+)$/).exec(value);
  if (!match) throw new Error('Enter a valid amount');
  const whole = (match[1] ?? '').replace(/^0+(?=\d)/, '');
  const fraction = currency === 'USD' ? (match[2] ?? '').padEnd(2, '0') : '';
  const minor = `${whole}${fraction}`.replace(/^0+(?=\d)/, '') || '0';
  if (!/^\d+$/.test(minor) || minor.length > 15) throw new Error('Enter a valid amount');
  return minor;
}

interface GoalMonthlyTargetDialogProps {
  locale: Locale;
  currency: Currency;
  goalName: string | null;
  /** The goal's current monthly target for the plan month, or null when none. */
  currentAmountMinor: string | null;
  /** The current `goal_monthly_target_revisions` head for the plan month, or
   * null when there is no target yet (the first revision). */
  expectedRevisionId: string | null;
  pending: boolean;
  ambiguous: boolean;
  onClose(): void;
  onClearAmbiguous(): void;
  onRetry(): Promise<CommandOutcome>;
  onSet(input: { amountMinor: string; expectedRevisionId: string | null }): Promise<CommandOutcome>;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

export function GoalMonthlyTargetDialog(props: GoalMonthlyTargetDialogProps) {
  const descriptionId = useId();
  const [amountText, setAmountText] = useState(
    props.currentAmountMinor !== null ? formatEditedAmount(props.currentAmountMinor, props.currency) : '',
  );
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
    let amountMinor: string;
    try {
      amountMinor = parseNonnegativeMinor(amountText, props.currency);
    } catch {
      setError(t(props.locale, 'Enter a valid amount (0 clears the target).', 'أدخل مبلغًا صالحًا (0 يمسح الهدف).'));
      return;
    }
    void run(() => props.onSet({ amountMinor, expectedRevisionId: props.expectedRevisionId }));
  }

  if (success) return <DialogShell title={t(props.locale, 'Monthly target', 'الهدف الشهري')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} descriptionId={descriptionId} focusVersion="success">
    <div className="dialog-result" role="status">
      <strong>{t(props.locale, 'Saved', 'تم الحفظ')}</strong>
      <p id={descriptionId}>{t(props.locale, 'The goal’s monthly target has been updated.', 'تم تحديث الهدف الشهري للهدف.')}</p>
      <button type="button" data-autofocus onClick={props.onClose}>{t(props.locale, 'Done', 'تم')}</button>
    </div>
  </DialogShell>;

  return <DialogShell title={t(props.locale, 'Monthly target', 'الهدف الشهري')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending} descriptionId={descriptionId}>
    <form onSubmit={submit}>
      <p id={descriptionId} className="dialog-intro">
        {props.goalName ? <><bdi>{props.goalName}</bdi> — </> : null}
        {t(props.locale, 'monthly target', 'الهدف الشهري')}: <bdi>{props.currentAmountMinor === null ? t(props.locale, 'None set', 'لم يُحدَّد') : formatMinorAmount(props.currentAmountMinor, props.currency, props.locale)}</bdi>
      </p>
      <p className="field-note">{t(props.locale, 'This is the amount the monthly plan reserves for this goal. Enter 0 to clear it.', 'هذا هو المبلغ الذي تخصصه الخطة الشهرية لهذا الهدف. أدخل 0 لمسحه.')}</p>
      <label className="full-field">
        {t(props.locale, 'Monthly target', 'الهدف الشهري')}
        <input data-autofocus type="text" inputMode="decimal" placeholder={props.currency === 'USD' ? '0.00' : '0'} value={amountText} onChange={(event) => { setAmountText(event.target.value); setError(null); }} />
      </label>
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

/** Integer-minor -> the plain `major[.minor]` text an editable field expects
 * (no grouping, no currency label). */
function formatEditedAmount(amountMinor: string, currency: Currency): string {
  if (currency === 'LBP') return amountMinor.replace(/^0+(?=\d)/, '');
  const value = BigInt(amountMinor);
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}`;
}
