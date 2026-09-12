import { useId, useState, type FormEvent } from 'react';

import type { Locale } from '../loans/types.js';
import { DialogShell } from '../wallets/dialog-shell.js';
import { classifyCategoryError, localizeCategoryError } from './errors.js';
import type { Category } from './types.js';
import type { CategoryCommandOutcome } from './use-categories.js';

interface ArchiveCategoryDialogProps {
  locale: Locale;
  category: Category;
  pending: boolean;
  ambiguous: boolean;
  onClose(): void;
  onRetry(): Promise<CategoryCommandOutcome>;
  onRefresh(): Promise<boolean>;
  onSubmit(): Promise<CategoryCommandOutcome>;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

function displayName(category: Category, locale: Locale): string {
  return (locale === 'ar' ? category.nameAr ?? category.nameEn : category.nameEn ?? category.nameAr) ?? '';
}

export function ArchiveCategoryDialog(props: ArchiveCategoryDialogProps) {
  const descriptionId = useId();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function run(action: () => Promise<CategoryCommandOutcome>) {
    setError(null);
    try {
      const outcome = await action();
      if (outcome.status === 'success') setSuccess(true);
      else if (outcome.status === 'refresh-required') {
        setRefreshRequired(true);
        setError(t(props.locale, 'The category was archived, but the current register could not be refreshed.', 'تمت أرشفة الفئة، ولكن تعذّر تحديث السجل الحالي.'));
      } else setError(t(props.locale, 'The result is still unknown. Retry only with this unchanged category.', 'ما زالت النتيجة غير معروفة. أعد المحاولة بهذه الفئة نفسها فقط.'));
    } catch (cause) {
      const result = localizeCategoryError(classifyCategoryError(cause), props.locale);
      setError(`${result.message} ${result.recovery}`);
    }
  }

  async function refreshAcceptedCommand() {
    setRefreshing(true);
    try {
      if (await props.onRefresh()) setSuccess(true);
      else setError(t(props.locale, 'The category was archived, but the current register could not be refreshed.', 'تمت أرشفة الفئة، ولكن تعذّر تحديث السجل الحالي.'));
    } catch {
      setError(t(props.locale, 'The category was archived, but the current register could not be refreshed.', 'تمت أرشفة الفئة، ولكن تعذّر تحديث السجل الحالي.'));
    } finally {
      setRefreshing(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (refreshRequired) return;
    if (!confirmed) {
      setError(t(props.locale, 'Confirm that new transactions will no longer offer this category.', 'أكد أن هذه الفئة لن تظهر بعد الآن للمعاملات الجديدة.'));
      return;
    }
    void run(props.onSubmit);
  }

  if (success) return <DialogShell title={t(props.locale, 'Archive category', 'أرشفة الفئة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} descriptionId={descriptionId} focusVersion="success">
    <div className="dialog-result" role="status"><strong>{t(props.locale, 'Category archived', 'تمت أرشفة الفئة')}</strong><p id={descriptionId}>{t(props.locale, 'Historical entries keep their original category label.', 'تحتفظ القيود التاريخية بتسمية الفئة الأصلية.')}</p><button type="button" data-autofocus onClick={props.onClose}>{t(props.locale, 'Done', 'تم')}</button></div>
  </DialogShell>;

  return <DialogShell title={t(props.locale, 'Archive category', 'أرشفة الفئة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending || refreshing} descriptionId={descriptionId}>
    <form className="dialog-form" onSubmit={submit}>
      <p id={descriptionId} className="dialog-intro dialog-consequence">{t(props.locale, 'Archive', 'أرشفة')} <strong><bdi>{displayName(props.category, props.locale)}</bdi></strong>? {t(props.locale, 'It disappears from new entries but remains attached to history.', 'ستختفي من القيود الجديدة وتبقى مرتبطة بالسجل.')}</p>
      {error && <div className="error-notice" role="alert">{error}{refreshRequired ? <div><button type="button" className="button-secondary retry-command" disabled={refreshing} onClick={() => void refreshAcceptedCommand()}>{refreshing ? t(props.locale, 'Refreshing…', 'جارٍ التحديث…') : t(props.locale, 'Refresh categories', 'تحديث الفئات')}</button></div> : props.ambiguous && <div><button type="button" className="button-secondary retry-command" disabled={props.pending} onClick={() => void run(props.onRetry)}>{t(props.locale, 'Retry unchanged archive', 'إعادة الأرشفة دون تغيير')}</button></div>}</div>}
      <label className="confirm"><input data-autofocus type="checkbox" checked={confirmed} disabled={refreshRequired} onChange={(event) => { setConfirmed(event.target.checked); setError(null); }} />{t(props.locale, 'I understand this category will not be available for new transactions.', 'أفهم أن هذه الفئة لن تكون متاحة للمعاملات الجديدة.')}</label>
      <div className="dialog-actions"><button type="button" className="button-secondary" disabled={props.pending || refreshing} onClick={props.onClose}>{t(props.locale, refreshRequired ? 'Close' : 'Cancel', refreshRequired ? 'إغلاق' : 'إلغاء')}</button><button type="submit" disabled={props.pending || refreshRequired}>{props.pending ? t(props.locale, 'Archiving…', 'جارٍ الأرشفة…') : t(props.locale, 'Archive category', 'أرشفة الفئة')}</button></div>
    </form>
  </DialogShell>;
}
