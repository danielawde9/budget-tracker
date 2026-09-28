import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import { monthLabel } from '../plan/plan-page.js';
import { DialogShell } from '../wallets/dialog-shell.js';
import { classifyAllocationError, localizeAllocationError } from './errors.js';
import type { CommandOutcome } from './use-allocation.js';
import type { AllocationMonthState, CopyMonthResult, MonthCopyPreview } from './types.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

function name(en: string | null, ar: string | null, locale: Locale): string {
  return (locale === 'ar' ? ar : en) ?? en ?? ar ?? '';
}

export interface MonthCopyDialogProps {
  readonly locale: Locale;
  readonly currency: Currency;
  readonly targetMonth: string;
  readonly previousMonth: string;
  loadSourceMonth(month: string): Promise<AllocationMonthState>;
  previewCopy(input: { sourceSnapshotId: string; targetMonth: string }): Promise<MonthCopyPreview>;
  copyMonth(input: {
    sourceSnapshotId: string;
    targetMonth: string;
    expectedTargetSnapshotId: string | null;
    acceptedPreviewHash: string;
  }): Promise<CommandOutcome>;
  readonly pending: boolean;
  readonly ambiguous: { kind: string; requestId: string } | null;
  retryAmbiguous(): Promise<CommandOutcome>;
  clearAmbiguous(): void;
  onClose(): void;
  onCopied?(snapshotId: string): void;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'error'; message: string; stale: boolean }
  | { kind: 'ready'; preview: MonthCopyPreview; sourceSnapshotId: string }
  | { kind: 'success' };

/** Previews copying the immediately-previous saved month into this one and
 * confirms with the preview's exact hash and expected target head -- a changed
 * target rejects as stale rather than silently overwriting. */
export function MonthCopyDialog(props: MonthCopyDialogProps) {
  const { locale } = props;
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setSubmitError(null);
    setPhase({ kind: 'loading' });
    try {
      const source = await props.loadSourceMonth(props.previousMonth);
      if (source.snapshotId === null) {
        setPhase({ kind: 'empty' });
        return;
      }
      const preview = await props.previewCopy({ sourceSnapshotId: source.snapshotId, targetMonth: props.targetMonth });
      setPhase({ kind: 'ready', preview, sourceSnapshotId: source.snapshotId });
    } catch (cause) {
      const view = localizeAllocationError(classifyAllocationError(cause), locale);
      setPhase({ kind: 'error', message: `${view.message} ${view.recovery}`, stale: view.code === 'stale_revision' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, props.loadSourceMonth, props.previewCopy, props.previousMonth, props.targetMonth]);

  useEffect(() => { void load(); }, [load]);

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    if (phase.kind !== 'ready') return;
    setSubmitError(null);
    try {
      const outcome = await props.copyMonth({
        sourceSnapshotId: phase.sourceSnapshotId,
        targetMonth: props.targetMonth,
        expectedTargetSnapshotId: phase.preview.expectedTargetSnapshotId,
        acceptedPreviewHash: phase.preview.previewHash,
      });
      if (outcome.status === 'ambiguous') return;
      setPhase({ kind: 'success' });
      props.onCopied?.((outcome.result as CopyMonthResult | undefined)?.snapshotId ?? '');
    } catch (cause) {
      const view = localizeAllocationError(classifyAllocationError(cause), locale);
      if (view.code === 'stale_revision') {
        setPhase({ kind: 'error', message: `${view.message} ${view.recovery}`, stale: true });
      } else {
        setSubmitError(`${view.message} ${view.recovery}`);
      }
    }
  };

  const title = t(locale, 'Copy a saved month', 'نسخ شهر محفوظ');

  if (phase.kind === 'success') {
    return (
      <DialogShell title={title} closeLabel={t(locale, 'Close', 'إغلاق')} onClose={props.onClose} focusVersion="success">
        <div className="dialog-result" role="status">
          <strong>{t(locale, 'Copied', 'تم النسخ')}</strong>
          <p>{t(locale, `This month now uses the plan copied from ${monthLabel(props.previousMonth, locale)}.`, `يستخدم هذا الشهر الآن الخطة المنسوخة من ${monthLabel(props.previousMonth, locale)}.`)}</p>
          <button type="button" data-autofocus onClick={props.onClose}>{t(locale, 'Done', 'تم')}</button>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell title={title} closeLabel={t(locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending} wide>
      <p className="dialog-intro">
        {t(locale, 'Destination month', 'الشهر الهدف')}: <bdi>{monthLabel(props.targetMonth, locale)}</bdi>
        {' · '}
        {t(locale, 'Source', 'المصدر')}: <bdi>{monthLabel(props.previousMonth, locale)}</bdi>
      </p>
      {phase.kind === 'loading' ? <p className="cr-helper">{t(locale, 'Preparing preview…', 'جارٍ تحضير المعاينة…')}</p> : null}
      {phase.kind === 'empty' ? <p>{t(locale, 'The previous month has no published plan to copy.', 'لا توجد خطة منشورة في الشهر السابق لنسخها.')}</p> : null}
      {phase.kind === 'error' ? (
        <>
          <p role="alert" className="mt-danger">
            {phase.stale
              ? t(locale, "This month's saved plan changed since the preview. Preview again before copying.", 'تغيّرت خطة هذا الشهر المحفوظة منذ المعاينة. أعد المعاينة قبل النسخ.')
              : phase.message}
          </p>
          <button type="button" className="cr-button" onClick={() => void load()}>{t(locale, 'Preview again', 'إعادة المعاينة')}</button>
        </>
      ) : null}
      {phase.kind === 'ready' ? (
        <form onSubmit={confirm}>
          <p className="cr-helper">
            {t(locale,
              'Copying reuses this saved month’s percentages, base income and targets. Actual amounts and recurring items are never duplicated.',
              'النسخ يعيد استخدام النسب والدخل الأساسي والأهداف من هذا الشهر المحفوظ. لا تتكرر المبالغ الفعلية أو البنود المتكررة أبدًا.')}
          </p>
          <p className="cr-helper">
            {t(locale, 'Planned income', 'الدخل المخطط')}: <bdi>{formatMinorAmount(phase.preview.incomeMinor, props.currency, locale)}</bdi>
          </p>
          <h3>{t(locale, 'Destination changes', 'تغييرات الشهر الهدف')}</h3>
          <ul className="mt-copy-roots">
            {phase.preview.roots.map((row) => (
              <li key={row.categoryId} className="mt-copy-root">
                <bdi>{name(row.nameEn, row.nameAr, locale)}</bdi>
                <span className="cr-helper">{t(locale, 'target', 'هدف')} <bdi>{formatMinorAmount(row.baseMinor, props.currency, locale)}</bdi></span>
                <span className="cr-helper">{t(locale, 'carry', 'ترحيل')} <bdi>{formatMinorAmount(row.carryMinor, props.currency, locale)}</bdi></span>
                <span className="cr-helper">{t(locale, 'effective', 'الفعال')} <bdi>{formatMinorAmount(row.effectiveMinor, props.currency, locale)}</bdi></span>
              </li>
            ))}
          </ul>
          {phase.preview.omissions.length > 0 ? (
            <>
              <h3>{t(locale, 'Not copied', 'غير منسوخ')}</h3>
              <ul className="mt-copy-omissions">
                {phase.preview.omissions.map((omission) => (
                  <li key={`${omission.kind}-${omission.entityId}`}>
                    <bdi>{omission.entityId}</bdi> · {t(locale, omission.kind, omission.kind)} · {t(locale, omission.reason, omission.reason)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {props.ambiguous ? (
            <div className="mt-ambiguous" role="alert">
              <span>{t(locale, 'The copy result is not confirmed yet.', 'لم يتم تأكيد نتيجة النسخ بعد.')}</span>
              <button type="button" className="cr-button" onClick={() => void props.retryAmbiguous()}>{t(locale, 'Check again', 'تحقق مرة أخرى')}</button>
              <button type="button" className="cr-button" onClick={props.clearAmbiguous}>{t(locale, 'Dismiss', 'إغلاق')}</button>
            </div>
          ) : null}
          {submitError ? <p role="alert" className="mt-danger">{submitError}</p> : null}
          <div className="dialog-actions">
            <button type="button" className="cr-button" disabled={props.pending} onClick={props.onClose}>{t(locale, 'Cancel', 'إلغاء')}</button>
            <button type="submit" className="cr-button cr-button--primary" disabled={props.pending || props.ambiguous !== null}>
              {props.pending ? t(locale, 'Saving…', 'جارٍ الحفظ…') : t(locale, 'Copy plan', 'نسخ الخطة')}
            </button>
          </div>
        </form>
      ) : null}
    </DialogShell>
  );
}
