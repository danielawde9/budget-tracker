import { useEffect, useId, useState, type FormEvent } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount, parsePositiveMinorAmount } from '../wallets/money.js';
import { DialogShell } from '../wallets/dialog-shell.js';
import { classifyGoalsError, localizeGoalsError } from './errors.js';
import type { CommandOutcome } from './use-goals.js';
import type { GoalSummary } from './types.js';

import type { LinkableEventOption } from '../recurring/linkable-events.js';

interface GoalPurchaseDialogProps {
  locale: Locale;
  loadExpenses?: (() => Promise<readonly LinkableEventOption[]>) | undefined;
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

export function GoalPurchaseDialog(props: GoalPurchaseDialogProps) {
  const descriptionId = useId();
  const [expenseEventId, setExpenseEventId] = useState('');
  const [amountText, setAmountText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [expenses, setExpenses] = useState<readonly LinkableEventOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const locked = props.pending || props.ambiguous;
  useEffect(() => {
    let active = true;
    setLoading(true); setReadError(false); setExpenseEventId('');
    if (!props.loadExpenses) { setExpenses([]); setLoading(false); return; }
    void props.loadExpenses().then(rows => {
      if (active) { setExpenses(rows.filter(row => row.kind === 'expense' && row.currency === props.currency)); setLoading(false); }
    }, () => { if (active) { setReadError(true); setLoading(false); } });
    return () => { active = false; };
  }, [props.loadExpenses, props.currency, attempt]);

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
    if (locked) return;
    if (!expenses.some(expense => expense.id === id)) {
      setError(t(props.locale, 'Choose an expense to link.', 'اختر مصروفًا لربطه.'));
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
        {t(props.locale, 'Expense', 'المصروف')}
        <select data-autofocus required value={expenseEventId} disabled={locked || loading || readError || expenses.length === 0}
          onChange={event => { setExpenseEventId(event.target.value); setError(null); }}>
          <option value="">{loading ? t(props.locale, 'Loading expenses…', 'جارٍ تحميل المصروفات…') : t(props.locale, 'Choose an expense', 'اختر مصروفًا')}</option>
          {expenses.map(expense => <option key={expense.id} value={expense.id}>
            {expense.effectiveDate} · {expense.label} · {formatMinorAmount(expense.amountMinor, props.currency, props.locale)}
          </option>)}
        </select>
      </label>
      {readError && <div className="error-notice" role="alert">{t(props.locale, 'Could not load expenses.', 'تعذّر تحميل المصروفات.')} <button type="button" disabled={locked} onClick={() => setAttempt(value => value + 1)}>{t(props.locale, 'Retry expenses', 'إعادة تحميل المصروفات')}</button></div>}
      {!loading && !readError && expenses.length === 0 && <p role="status">{t(props.locale, 'No eligible expenses in this currency. Record an expense first, then return here.', 'لا توجد مصروفات قابلة للربط بهذه العملة. سجّل مصروفًا أولًا ثم عد إلى هنا.')}</p>}
      <label className="full-field">
        {t(props.locale, 'Amount to link', 'المبلغ المراد ربطه')}
        <input disabled={locked} type="text" inputMode="decimal" placeholder={props.currency === 'USD' ? '0.00' : '0'} value={amountText} onChange={(event) => { setAmountText(event.target.value); setError(null); }} />
      </label>
      <span className="field-note" role="status">{t(props.locale, 'Already fulfilled', 'المُنجز حاليًا')}: <bdi>{formatMinorAmount(props.goal.fulfilledMinor, props.currency, props.locale)}</bdi></span>
      {(error || props.ambiguous) && <div className="error-notice" role="alert">
        {error ?? t(props.locale, 'The result is uncertain. Retry the same request before making changes.', 'النتيجة غير مؤكدة. أعد الطلب نفسه قبل إجراء تغييرات.')}
        {props.ambiguous && <div><button type="button" className="button-secondary retry-command" onClick={() => void run(props.onRetry)}>{t(props.locale, 'Retry unchanged request', 'إعادة الطلب دون تغيير')}</button></div>}
      </div>}
      <div className="dialog-actions">
        <button type="button" className="button-secondary" disabled={props.pending} onClick={props.onClose}>{t(props.locale, 'Cancel', 'إلغاء')}</button>
        <button type="submit" className="cr-button cr-button--primary" disabled={locked || !expenseEventId || loading || readError}>{props.pending ? t(props.locale, 'Linking…', 'جارٍ الربط…') : t(props.locale, 'Link purchase', 'ربط الشراء')}</button>
      </div>
    </form>
  </DialogShell>;
}
