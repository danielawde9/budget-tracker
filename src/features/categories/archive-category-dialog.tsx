import { useState, type FormEvent } from 'react';

import type { Locale } from '../loans/types.js';
import { DialogShell } from '../wallets/dialog-shell.js';
import { classifyCategoryError } from './errors.js';
import type { Category } from './types.js';
import type { CategoryCommandOutcome } from './use-categories.js';

interface ArchiveCategoryDialogProps {
  locale: Locale;
  category: Category;
  pending: boolean;
  ambiguous: boolean;
  onClose(): void;
  onRetry(): Promise<CategoryCommandOutcome>;
  onSubmit(): Promise<CategoryCommandOutcome>;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

function displayName(category: Category, locale: Locale): string {
  return (locale === 'ar' ? category.nameAr ?? category.nameEn : category.nameEn ?? category.nameAr) ?? '';
}

export function ArchiveCategoryDialog(props: ArchiveCategoryDialogProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function run(action: () => Promise<CategoryCommandOutcome>) {
    setError(null);
    try {
      const outcome = await action();
      if (outcome.status === 'success') setSuccess(true);
      else setError(t(props.locale, 'The result is still unknown. Retry only with this unchanged category.', 'ما زالت النتيجة غير معروفة. أعد المحاولة بهذه الفئة نفسها فقط.'));
    } catch (cause) {
      const result = classifyCategoryError(cause);
      setError(props.locale === 'ar'
        ? result.code === 'already_archived' ? 'هذه الفئة مؤرشفة بالفعل. حدّث القائمة الحالية.' : 'لم تتم أرشفة الفئة. حدّث القائمة وحاول مجددًا.'
        : `${result.message} ${result.recovery}`);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!confirmed) {
      setError(t(props.locale, 'Confirm that new transactions will no longer offer this category.', 'أكد أن هذه الفئة لن تظهر بعد الآن للمعاملات الجديدة.'));
      return;
    }
    void run(props.onSubmit);
  }

  if (success) return <DialogShell title={t(props.locale, 'Archive category', 'أرشفة الفئة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose}>
    <div className="dialog-result" role="status"><strong>{t(props.locale, 'Category archived', 'تمت أرشفة الفئة')}</strong><p>{t(props.locale, 'Historical entries keep their original category label.', 'تحتفظ القيود التاريخية بتسمية الفئة الأصلية.')}</p><button type="button" data-autofocus onClick={props.onClose}>{t(props.locale, 'Done', 'تم')}</button></div>
  </DialogShell>;

  return <DialogShell title={t(props.locale, 'Archive category', 'أرشفة الفئة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending}>
    <form onSubmit={submit}>
      <p className="dialog-intro">{t(props.locale, 'Archive', 'أرشفة')} <strong><bdi>{displayName(props.category, props.locale)}</bdi></strong>? {t(props.locale, 'It disappears from new entries but remains attached to history.', 'ستختفي من القيود الجديدة وتبقى مرتبطة بالسجل.')}</p>
      {error && <div className="error-notice" role="alert">{error}{props.ambiguous && <div><button type="button" className="button-secondary retry-command" disabled={props.pending} onClick={() => void run(props.onRetry)}>{t(props.locale, 'Retry unchanged archive', 'إعادة الأرشفة دون تغيير')}</button></div>}</div>}
      <label className="confirm"><input data-autofocus type="checkbox" checked={confirmed} onChange={(event) => { setConfirmed(event.target.checked); setError(null); }} />{t(props.locale, 'I understand this category will not be available for new transactions.', 'أفهم أن هذه الفئة لن تكون متاحة للمعاملات الجديدة.')}</label>
      <div className="dialog-actions"><button type="button" className="button-secondary" disabled={props.pending} onClick={props.onClose}>{t(props.locale, 'Cancel', 'إلغاء')}</button><button type="submit" disabled={props.pending}>{props.pending ? t(props.locale, 'Archiving…', 'جارٍ الأرشفة…') : t(props.locale, 'Archive category', 'أرشفة الفئة')}</button></div>
    </form>
  </DialogShell>;
}
