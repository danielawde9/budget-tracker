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
  const [effectiveDate, setEffectiveDate] = useState(props.event.effectiveDate);
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
        ? t(props.locale, 'This transaction was already undone or cannot be undone here. Refresh the history.', 'تم التراجع عن هذه المعاملة بالفعل أو لا يمكن التراجع عنها هنا. حدّث السجل.')
        : /dependent repayments/i.test(message)
          ? t(props.locale, 'This loan entry has dependent repayments. Manage its correction in Loans.', 'يرتبط قيد القرض هذا بدفعات لاحقة. أدِر تصحيحه في القروض.')
          : message || t(props.locale, 'The undo was not recorded.', 'لم يتم تسجيل التراجع.'));
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!confirmed) {
      setError(t(props.locale, 'Tick the box to confirm the undo.', 'حدّد المربع لتأكيد التراجع.'));
      return;
    }
    if (!validDate(effectiveDate)) {
      setError(t(props.locale, 'Enter a valid undo date.', 'أدخل تاريخ تراجع صالحًا.'));
      return;
    }
    void run(() => props.onSubmit({ eventId: props.event.id, effectiveDate }));
  }

  if (success) return <DialogShell title={t(props.locale, 'Undo this transaction', 'التراجع عن هذه المعاملة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose}><div className="dialog-result" role="status"><strong>{t(props.locale, 'Transaction undone', 'تم التراجع عن المعاملة')}</strong><p>{t(props.locale, 'This transaction no longer affects your balances. It stays in history, marked as undone.', 'لم تعد هذه المعاملة تؤثر في أرصدتك. تبقى في السجل مع إشارة إلى التراجع عنها.')}</p><button type="button" data-autofocus onClick={props.onClose}>{t(props.locale, 'Done', 'تم')}</button></div></DialogShell>;

  return <DialogShell title={t(props.locale, 'Undo this transaction', 'التراجع عن هذه المعاملة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending}>
    <form onSubmit={submit}>
      <p className="dialog-intro">{t(props.locale, 'Undo adds an opposite entry that cancels this transaction’s effect on your wallets. Nothing is erased: both entries stay in history.', 'يضيف التراجع قيدًا معاكسًا يُلغي أثر هذه المعاملة على محافظك. لا يُحذف شيء: يبقى القيدان في السجل.')}</p>
      {error && <div className="error-notice" role="alert">{error}{props.ambiguous && <div><button type="button" className="button-secondary retry-command" onClick={() => void run(props.onRetry)}>{t(props.locale, 'Retry unchanged undo', 'إعادة التراجع دون تغيير')}</button></div>}</div>}
      <label>{t(props.locale, 'Undo date', 'تاريخ التراجع')}<input data-autofocus type="date" value={effectiveDate} onChange={(event) => { setEffectiveDate(event.target.value); setError(null); props.onClearAmbiguous(); }} /></label>
      <label className="confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{t(props.locale, 'I understand the original stays in history, marked as undone.', 'أفهم أن المعاملة الأصلية تبقى في السجل مع إشارة إلى التراجع عنها.')}</label>
      <div className="dialog-actions"><button type="button" className="button-secondary" disabled={props.pending} onClick={props.onClose}>{t(props.locale, 'Cancel', 'إلغاء')}</button><button type="submit" disabled={props.pending}>{props.pending ? t(props.locale, 'Undoing…', 'جارٍ التراجع…') : t(props.locale, 'Undo transaction', 'التراجع عن المعاملة')}</button></div>
    </form>
  </DialogShell>;
}
