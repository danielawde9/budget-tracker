import { useId, useRef, useState } from 'react';
import type { Locale } from '../loans/types.js';
import { DialogShell } from '../wallets/dialog-shell.js';
import { formatMinorAmount } from '../wallets/money.js';
import { classifyGoalsError, localizeGoalsError } from './errors.js';
import type { GoalState, GoalSummary } from './types.js';
import type { CommandOutcome } from './use-goals.js';

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;
export function GoalStateDialog(props: {
  locale: Locale; goal: GoalSummary; target: GoalState; pending: boolean; ambiguous: boolean;
  onClose(): void; onManageFunding(): void; onSubmit(): Promise<CommandOutcome>; onRetry(): Promise<CommandOutcome>;
}) {
  const descriptionId = useId();
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = props.target === 'closed' && BigInt(props.goal.earmarkedMinor) !== 0n;
  const pending = saving || props.pending;
  const action = props.target === 'paused' ? t(props.locale, 'Pause', 'إيقاف مؤقت') : props.target === 'closed' ? t(props.locale, 'Close goal', 'إغلاق الهدف') : t(props.locale, 'Resume', 'استئناف');
  const title = props.target === 'paused' ? t(props.locale, 'Pause goal', 'إيقاف الهدف مؤقتًا') : props.target === 'closed' ? t(props.locale, 'Close goal', 'إغلاق الهدف') : t(props.locale, 'Resume goal', 'استئناف الهدف');
  const goalName = props.locale === 'ar' ? props.goal.nameAr ?? props.goal.nameEn : props.goal.nameEn ?? props.goal.nameAr;
  async function run(retry = false) {
    if (busy.current) return;
    busy.current = true; setSaving(true); setError(null);
    try {
      const result = await (retry ? props.onRetry() : props.onSubmit());
      if (result.status !== 'ambiguous') props.onClose();
    } catch (cause) {
      const view = localizeGoalsError(classifyGoalsError(cause), props.locale);
      setError(`${view.message} ${view.recovery}`);
    } finally { busy.current = false; setSaving(false); }
  }
  return <DialogShell title={title} closeLabel={t(props.locale, 'Cancel', 'إلغاء')} onClose={props.onClose} pending={pending} descriptionId={descriptionId}>
    <p id={descriptionId} className="dialog-intro"><bdi>{goalName}</bdi> — {props.target === 'paused'
      ? t(props.locale, 'Pause work on this goal. Its settings and money set aside are kept; you can resume later.', 'أوقف العمل على هذا الهدف مؤقتًا. تبقى إعداداته والمبلغ المخصص له ويمكنك استئنافه لاحقًا.')
      : props.target === 'closed' ? t(props.locale, 'Finish this goal and keep its history. Closing does not spend or move money.', 'أنه هذا الهدف مع الاحتفاظ بسجله. الإغلاق لا ينفق أو ينقل الأموال.')
      : t(props.locale, 'Make this goal active again. Its existing settings are kept.', 'فعّل هذا الهدف مجددًا مع الاحتفاظ بإعداداته.')}</p>
    {blocked && <div role="status" className="goal-close-guidance"><p>{t(props.locale, 'Money still set aside', 'المبلغ الذي لا يزال مخصصًا')}: <bdi>{formatMinorAmount(props.goal.earmarkedMinor, props.goal.currency, props.locale)}</bdi>. {t(props.locale, 'Free it up or move it to another goal before closing.', 'حرّره أو انقله إلى هدف آخر قبل الإغلاق.')}</p><button type="button" disabled={pending || props.ambiguous} onClick={props.onManageFunding}>{t(props.locale, 'Set money aside', 'تخصيص مبلغ')}</button></div>}
    {error && <p role="alert" className="error-notice">{error}</p>}
    {props.ambiguous && <div role="alert" className="error-notice"><p>{t(props.locale, 'The result is uncertain. Retry the same request.', 'النتيجة غير مؤكدة. أعد الطلب نفسه.')}</p><button type="button" disabled={pending} onClick={() => void run(true)}>{t(props.locale, 'Retry unchanged request', 'إعادة الطلب دون تغيير')}</button></div>}
    <div className="dialog-actions"><button type="button" className="button-secondary" disabled={pending} onClick={props.onClose}>{t(props.locale, 'Cancel', 'إلغاء')}</button><button type="button" data-autofocus className="cr-button cr-button--primary" disabled={pending || props.ambiguous || blocked} onClick={() => void run()}>{pending ? t(props.locale, 'Saving…', 'جارٍ الحفظ…') : action}</button></div>
  </DialogShell>;
}
