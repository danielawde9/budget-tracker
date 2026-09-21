import { useId, useState, type FormEvent } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount, parsePositiveMinorAmount } from '../wallets/money.js';
import { DialogShell } from '../wallets/dialog-shell.js';
import { classifyGoalsError, localizeGoalsError } from './errors.js';
import type { CommandOutcome } from './use-goals.js';
import type { GoalSummary } from './types.js';

type FundingMode = 'reserve' | 'release' | 'move';

interface MoveTarget {
  readonly id: string;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
}

interface GoalFundingDialogProps {
  locale: Locale;
  currency: Currency;
  goal: GoalSummary;
  goalHead: string;
  moveTargets: readonly MoveTarget[];
  pending: boolean;
  ambiguous: boolean;
  onClose(): void;
  onClearAmbiguous(): void;
  onRetry(): Promise<CommandOutcome>;
  onReserveOrRelease(input: { action: 'reserve' | 'release'; amountMinor: string; expectedHead: string; acceptUnderfunded: boolean }): Promise<CommandOutcome>;
  /** The destination's head isn't available from the goal list (only a
   * single goal's own `goal_detail` response carries a head) -- fetched
   * fresh right before submitting so it's never a stale, precomputed value. */
  onLoadToHead(goalId: string): Promise<string>;
  onMove(input: { toGoalId: string; amountMinor: string; expectedFromHead: string; expectedToHead: string; acceptUnderfunded: boolean }): Promise<CommandOutcome>;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

export function GoalFundingDialog(props: GoalFundingDialogProps) {
  const descriptionId = useId();
  const [mode, setMode] = useState<FundingMode>('reserve');
  const [amountText, setAmountText] = useState('');
  const [toGoalId, setToGoalId] = useState(props.moveTargets[0]?.id ?? '');
  const [underfundedPrompt, setUnderfundedPrompt] = useState<{ amountMinor: string } | null>(null);
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
      if (view.code === 'underfunded_confirmation_required') {
        const amountMinor = parsePositiveMinorAmount(amountText, props.currency);
        setUnderfundedPrompt({ amountMinor });
        return;
      }
      setError(`${view.message} ${view.recovery}`);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setUnderfundedPrompt(null);
    let amountMinor: string;
    try {
      amountMinor = parsePositiveMinorAmount(amountText, props.currency);
    } catch {
      setError(t(props.locale, 'Enter a valid positive amount.', 'أدخل مبلغًا موجبًا صالحًا.'));
      return;
    }
    if (mode === 'move') {
      const target = props.moveTargets.find((candidate) => candidate.id === toGoalId);
      if (!target) {
        setError(t(props.locale, 'Choose a destination goal.', 'اختر هدفًا وجهة.'));
        return;
      }
      void run(async () => {
        const expectedToHead = await props.onLoadToHead(target.id);
        return props.onMove({ toGoalId: target.id, amountMinor, expectedFromHead: props.goalHead, expectedToHead, acceptUnderfunded: false });
      });
      return;
    }
    void run(() => props.onReserveOrRelease({ action: mode, amountMinor, expectedHead: props.goalHead, acceptUnderfunded: false }));
  }

  function confirmUnderfunded() {
    if (!underfundedPrompt) return;
    void run(() => props.onReserveOrRelease({ action: 'reserve', amountMinor: underfundedPrompt.amountMinor, expectedHead: props.goalHead, acceptUnderfunded: true }));
    setUnderfundedPrompt(null);
  }

  const goalName = props.locale === 'ar' ? (props.goal.nameAr ?? props.goal.nameEn) : (props.goal.nameEn ?? props.goal.nameAr);

  if (success) return <DialogShell title={t(props.locale, 'Manage funding', 'إدارة التمويل')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} descriptionId={descriptionId} focusVersion="success">
    <div className="dialog-result" role="status">
      <strong>{t(props.locale, 'Saved', 'تم الحفظ')}</strong>
      <p id={descriptionId}>{t(props.locale, 'The goal’s funding has been updated.', 'تم تحديث تمويل الهدف.')}</p>
      <button type="button" data-autofocus onClick={props.onClose}>{t(props.locale, 'Done', 'تم')}</button>
    </div>
  </DialogShell>;

  return <DialogShell title={t(props.locale, 'Manage funding', 'إدارة التمويل')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending} descriptionId={descriptionId}>
    <form onSubmit={submit}>
      <p id={descriptionId} className="dialog-intro">
        <bdi>{goalName}</bdi> — {t(props.locale, 'currently reserved', 'المحجوز حاليًا')}: <bdi>{formatMinorAmount(props.goal.earmarkedMinor, props.currency, props.locale)}</bdi>
      </p>
      <fieldset className="cr-choice">
        <legend>{t(props.locale, 'Action', 'الإجراء')}</legend>
        <label><input type="radio" name="goal-funding-mode" checked={mode === 'reserve'} onChange={() => { setMode('reserve'); setError(null); }} />{t(props.locale, 'Reserve', 'حجز')}</label>
        <label><input type="radio" name="goal-funding-mode" checked={mode === 'release'} onChange={() => { setMode('release'); setError(null); }} />{t(props.locale, 'Release', 'تحرير')}</label>
        {props.moveTargets.length > 0 && <label><input type="radio" name="goal-funding-mode" checked={mode === 'move'} onChange={() => { setMode('move'); setError(null); }} />{t(props.locale, 'Move to another goal', 'نقل إلى هدف آخر')}</label>}
      </fieldset>
      {mode === 'move' && <label className="full-field">
        {t(props.locale, 'Destination goal', 'الهدف الوجهة')}
        <select value={toGoalId} onChange={(event) => setToGoalId(event.target.value)}>
          {props.moveTargets.map((target) => <option key={target.id} value={target.id}>
            {props.locale === 'ar' ? (target.nameAr ?? target.nameEn) : (target.nameEn ?? target.nameAr)}
          </option>)}
        </select>
      </label>}
      <label className="full-field">
        {t(props.locale, 'Amount', 'المبلغ')}
        <input data-autofocus type="text" inputMode="decimal" placeholder={props.currency === 'USD' ? '0.00' : '0'} value={amountText} onChange={(event) => { setAmountText(event.target.value); setError(null); }} />
      </label>
      {error && <div className="error-notice" role="alert">
        {error}
        {props.ambiguous && <div><button type="button" className="button-secondary retry-command" onClick={() => void run(props.onRetry)}>{t(props.locale, 'Retry unchanged request', 'إعادة الطلب دون تغيير')}</button></div>}
      </div>}
      {underfundedPrompt && <div className="error-notice" role="alert">
        {t(props.locale, 'This reserve would claim more than the space currently has in cash.', 'سيطالب هذا الحجز بأكثر مما تملكه المساحة حاليًا من نقد.')}
        <div><button type="button" className="button-secondary" onClick={confirmUnderfunded}>{t(props.locale, 'Reserve anyway', 'احجز على أي حال')}</button></div>
      </div>}
      <div className="dialog-actions">
        <button type="button" className="button-secondary" disabled={props.pending} onClick={props.onClose}>{t(props.locale, 'Cancel', 'إلغاء')}</button>
        <button type="submit" className="cr-button cr-button--primary" disabled={props.pending}>{props.pending ? t(props.locale, 'Saving…', 'جارٍ الحفظ…') : t(props.locale, 'Save', 'حفظ')}</button>
      </div>
    </form>
  </DialogShell>;
}
