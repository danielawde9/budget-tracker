import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import { monthLabel } from '../plan/plan-page.js';
import { DialogShell } from '../wallets/dialog-shell.js';
import { classifyAllocationError, localizeAllocationError } from './errors.js';
import { RolloverPolicyEditor } from './rollover-policy-editor.js';
import type { CommandOutcome } from './use-allocation.js';
import type { CloseMonthResult, ClosePreview } from './types.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

export interface MonthCloseDialogProps {
  readonly locale: Locale;
  readonly currency: Currency;
  readonly month: string;
  previewClose(input: { month: string; expectedCloseId: string | null }): Promise<ClosePreview>;
  closeMonth(input: { expectedCloseId: string | null; acceptedPreviewHash: string }): Promise<CommandOutcome>;
  setRollover(input: { rootId: string; enabled: boolean; expectedRevisionId: string | null }): Promise<CommandOutcome>;
  readonly pending: boolean;
  readonly ambiguous: { kind: string; requestId: string } | null;
  retryAmbiguous(): Promise<CommandOutcome>;
  clearAmbiguous(): void;
  onClose(): void;
  onClosed?(closeId: string): void;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; preview: ClosePreview }
  | { kind: 'success' };

/** Freezes one month's facts and opt-in carry. Never posts cash: a close only
 * records what was observed, and a re-close restates rather than editing the
 * prior close. The current close head is discovered from the first preview and
 * re-previewed so the accepted hash matches the exact head the command sends. */
export function MonthCloseDialog(props: MonthCloseDialogProps) {
  const { locale } = props;
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setSubmitError(null);
    setPhase({ kind: 'loading' });
    try {
      const first = await props.previewClose({ month: props.month, expectedCloseId: null });
      const preview = first.expectedCloseId !== null
        ? await props.previewClose({ month: props.month, expectedCloseId: first.expectedCloseId })
        : first;
      setPhase({ kind: 'ready', preview });
    } catch (cause) {
      const view = localizeAllocationError(classifyAllocationError(cause), locale);
      setPhase({ kind: 'error', message: `${view.message} ${view.recovery}` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, props.month, props.previewClose]);

  useEffect(() => { void load(); }, [load]);

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    if (phase.kind !== 'ready') return;
    setSubmitError(null);
    try {
      const outcome = await props.closeMonth({ expectedCloseId: phase.preview.expectedCloseId, acceptedPreviewHash: phase.preview.previewHash });
      if (outcome.status === 'ambiguous') return;
      setPhase({ kind: 'success' });
      props.onClosed?.((outcome.result as CloseMonthResult | undefined)?.closeId ?? '');
    } catch (cause) {
      const view = localizeAllocationError(classifyAllocationError(cause), locale);
      if (view.code === 'stale_revision') {
        setPhase({ kind: 'error', message: `${view.message} ${view.recovery}` });
      } else {
        setSubmitError(`${view.message} ${view.recovery}`);
      }
    }
  };

  const setRollover = async (input: { rootId: string; enabled: boolean; expectedRevisionId: string | null }): Promise<CommandOutcome> => {
    const outcome = await props.setRollover(input);
    if (outcome.status !== 'ambiguous') await load();
    return outcome;
  };

  const title = t(locale, 'Close this month', 'إغلاق هذا الشهر');

  if (phase.kind === 'success') {
    return (
      <DialogShell title={title} closeLabel={t(locale, 'Close', 'إغلاق')} onClose={props.onClose} focusVersion="success">
        <div className="dialog-result" role="status">
          <strong>{t(locale, 'Closed', 'تم الإغلاق')}</strong>
          <p>{t(locale, `${monthLabel(props.month, locale)} is now closed.`, `تم إغلاق ${monthLabel(props.month, locale)}.`)}</p>
          <button type="button" data-autofocus onClick={props.onClose}>{t(locale, 'Done', 'تم')}</button>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell title={title} closeLabel={t(locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending} wide>
      <p className="dialog-intro">{monthLabel(props.month, locale)}</p>
      {phase.kind === 'loading' ? <p className="cr-helper">{t(locale, 'Preparing preview…', 'جارٍ تحضير المعاينة…')}</p> : null}
      {phase.kind === 'error' ? (
        <>
          <p role="alert" className="mt-danger">{phase.message}</p>
          <button type="button" className="cr-button" onClick={() => void load()}>{t(locale, 'Try again', 'حاول مرة أخرى')}</button>
        </>
      ) : null}
      {phase.kind === 'ready' ? (
        <form onSubmit={confirm}>
          <p className="cr-helper">
            {t(locale,
              'Closing freezes this month’s facts and signed carry. It never creates cash entries.',
              'الإغلاق يثبّت وقائع هذا الشهر والترحيل الموقّع. لا ينشئ أي قيود نقدية.')}
          </p>
          <dl className="mt-close-summary">
            <div><dt>{t(locale, 'Income', 'الدخل')}</dt><dd><bdi>{formatMinorAmount(phase.preview.incomeMinor, props.currency, locale)}</bdi></dd></div>
            <div><dt>{t(locale, 'Spending', 'المصروف')}</dt><dd><bdi>{formatMinorAmount(phase.preview.spendingMinor, props.currency, locale)}</bdi></dd></div>
            <div><dt>{t(locale, 'Transactions', 'الحركات')}</dt><dd><bdi>{phase.preview.factCount}</bdi></dd></div>
          </dl>
          {phase.preview.restatementRequired ? (
            <div className="mt-restatement" role="status">
              {t(locale,
                'Restatement required: this month changed since it was closed. Review the updated carry before closing again.',
                'مطلوب إعادة الإثبات: تغيّر هذا الشهر منذ إغلاقه. راجع الترحيل المُحدّث قبل الإغلاق مرة أخرى.')}
            </div>
          ) : null}
          <RolloverPolicyEditor
            locale={locale}
            currency={props.currency}
            roots={phase.preview.roots}
            pending={props.pending}
            onSetRollover={setRollover}
          />
          {props.ambiguous ? (
            <div className="mt-ambiguous" role="alert">
              <span>{t(locale, 'The close result is not confirmed yet.', 'لم يتم تأكيد نتيجة الإغلاق بعد.')}</span>
              <button type="button" className="cr-button" onClick={() => void props.retryAmbiguous()}>{t(locale, 'Check again', 'تحقق مرة أخرى')}</button>
              <button type="button" className="cr-button" onClick={props.clearAmbiguous}>{t(locale, 'Dismiss', 'إغلاق')}</button>
            </div>
          ) : null}
          {submitError ? <p role="alert" className="mt-danger">{submitError}</p> : null}
          <div className="dialog-actions">
            <button type="button" className="cr-button" disabled={props.pending} onClick={props.onClose}>{t(locale, 'Cancel', 'إلغاء')}</button>
            <button type="submit" className="cr-button cr-button--primary" disabled={props.pending || props.ambiguous !== null}>
              {props.pending ? t(locale, 'Saving…', 'جارٍ الحفظ…') : t(locale, 'Close month', 'إغلاق الشهر')}
            </button>
          </div>
        </form>
      ) : null}
    </DialogShell>
  );
}
