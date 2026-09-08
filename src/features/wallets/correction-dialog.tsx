import { useState, type FormEvent } from 'react';

import type { Locale } from '../loans/types.js';
import { DialogShell } from './dialog-shell.js';
import type { CommandOutcome } from './use-wallets.js';
import type { JournalEvent } from './types.js';

interface CorrectionDialogProps {
  locale: Locale;
  event: JournalEvent;
  pending: boolean;
  ambiguous: boolean;
  onClose(): void;
  onClearAmbiguous(): void;
  onRetry(): Promise<CommandOutcome>;
  onSubmit(input: { eventId: string; effectiveDate: string }): Promise<CommandOutcome>;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function CorrectionDialog(props: CorrectionDialogProps) {
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function run(action: () => Promise<CommandOutcome>) {
    setError(null);
    try {
      const outcome = await action();
      if (outcome.status === 'success') setSuccess(true);
      else setError(t(props.locale, 'The result is still unknown. Retry only with these unchanged details.', 'ما زالت النتيجة غير معروفة. أعد المحاولة بهذه التفاصيل نفسها فقط.'));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(/already has a reversal|cannot be reversed/i.test(message)
        ? t(props.locale, 'This entry is already reversed or cannot be corrected here. Refresh the journal.', 'تم عكس هذا القيد بالفعل أو لا يمكن تصحيحه هنا. حدّث السجل.')
        : /dependent repayments/i.test(message)
          ? t(props.locale, 'This loan entry has dependent repayments. Manage its correction in Loans.', 'يرتبط قيد القرض هذا بدفعات لاحقة. أدِر تصحيحه في القروض.')
          : message || t(props.locale, 'The correction was not recorded.', 'لم يتم تسجيل التصحيح.'));
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!confirmed) {
      setError(t(props.locale, 'Confirm that you understand this creates a linked inverse entry.', 'أكد أنك تفهم أن هذا ينشئ قيدًا عكسيًا مرتبطًا.'));
      return;
    }
    if (!validDate(effectiveDate)) {
      setError(t(props.locale, 'Enter a valid correction date.', 'أدخل تاريخ تصحيح صالحًا.'));
      return;
    }
    void run(() => props.onSubmit({ eventId: props.event.id, effectiveDate }));
  }

  if (success) return <DialogShell title={t(props.locale, 'Correct this transaction', 'تصحيح هذه المعاملة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose}><div className="dialog-result" role="status"><strong>{t(props.locale, 'Correction recorded', 'تم تسجيل التصحيح')}</strong><p>{t(props.locale, 'The original remains in history with its linked inverse entry.', 'يبقى القيد الأصلي في السجل مع قيده العكسي المرتبط.')}</p><button type="button" data-autofocus onClick={props.onClose}>{t(props.locale, 'Done', 'تم')}</button></div></DialogShell>;

  return <DialogShell title={t(props.locale, 'Correct this transaction', 'تصحيح هذه المعاملة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending}>
    <form onSubmit={submit}>
      <p className="dialog-intro">{t(props.locale, 'Corrections never edit or remove history. This creates a linked inverse entry for every wallet effect.', 'لا تعدّل التصحيحات السجل أو تحذفه. ينشئ هذا قيدًا عكسيًا مرتبطًا لكل تأثير على المحفظة.')}</p>
      {error && <div className="error-notice" role="alert">{error}{props.ambiguous && <div><button type="button" className="button-secondary retry-command" onClick={() => void run(props.onRetry)}>{t(props.locale, 'Retry unchanged correction', 'إعادة التصحيح دون تغيير')}</button></div>}</div>}
      <label>{t(props.locale, 'Correction date', 'تاريخ التصحيح')}<input data-autofocus type="date" value={effectiveDate} onChange={(event) => { setEffectiveDate(event.target.value); setError(null); props.onClearAmbiguous(); }} /></label>
      <label className="confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{t(props.locale, 'I understand this adds a linked reversal and keeps the original.', 'أفهم أن هذا يضيف قيدًا عكسيًا مرتبطًا ويُبقي الأصل.')}</label>
      <div className="dialog-actions"><button type="button" className="button-secondary" disabled={props.pending} onClick={props.onClose}>{t(props.locale, 'Cancel', 'إلغاء')}</button><button type="submit" disabled={props.pending}>{props.pending ? t(props.locale, 'Recording…', 'جارٍ التسجيل…') : t(props.locale, 'Add linked reversal', 'إضافة القيد العكسي المرتبط')}</button></div>
    </form>
  </DialogShell>;
}
