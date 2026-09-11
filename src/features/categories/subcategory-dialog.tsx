import { useId, useState, type FormEvent } from 'react';

import type { Locale } from '../loans/types.js';
import { DialogShell } from '../wallets/dialog-shell.js';
import { classifyCategoryError, localizeCategoryError } from './errors.js';
import type { Category } from './types.js';
import type { CategoryCommandOutcome, CreateSubcategoryDraft } from './use-categories.js';

interface SubcategoryDialogProps {
  locale: Locale;
  parent: Category;
  pending: boolean;
  ambiguous: boolean;
  onClose(): void;
  onClearAmbiguous(): void;
  onRetry(): Promise<CategoryCommandOutcome>;
  onRefresh(): Promise<boolean>;
  onSubmit(input: CreateSubcategoryDraft): Promise<CategoryCommandOutcome>;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

function displayName(category: Category, locale: Locale): string {
  return (locale === 'ar' ? category.nameAr ?? category.nameEn : category.nameEn ?? category.nameAr) ?? '';
}

function errorCopy(locale: Locale, cause: unknown): string {
  const error = localizeCategoryError(classifyCategoryError(cause), locale);
  return `${error.message} ${error.recovery}`;
}

export function SubcategoryDialog(props: SubcategoryDialogProps) {
  const descriptionId = useId();
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  function edit(action: () => void) {
    action();
    setError(null);
    props.onClearAmbiguous();
  }

  async function run(action: () => Promise<CategoryCommandOutcome>) {
    setError(null);
    try {
      const outcome = await action();
      if (outcome.status === 'success') setSuccess(true);
      else if (outcome.status === 'refresh-required') {
        setRefreshRequired(true);
        setError(t(props.locale,
          'The subcategory was saved, but the current register could not be refreshed.',
          'تم حفظ الفئة الفرعية، ولكن تعذّر تحديث السجل الحالي.',
        ));
      } else setError(t(props.locale,
        'The result is still unknown. We found no matching subcategory command; retry only if these details are unchanged.',
        'ما زالت النتيجة غير معروفة. لم نجد أمر فئة فرعية مطابقًا؛ أعد المحاولة فقط إذا بقيت التفاصيل كما هي.',
      ));
    } catch (cause) {
      setError(errorCopy(props.locale, cause));
    }
  }

  async function refreshAcceptedCommand() {
    setRefreshing(true);
    try {
      if (await props.onRefresh()) setSuccess(true);
      else setError(t(props.locale,
        'The subcategory was saved, but the current register could not be refreshed.',
        'تم حفظ الفئة الفرعية، ولكن تعذّر تحديث السجل الحالي.',
      ));
    } catch {
      setError(t(props.locale,
        'The subcategory was saved, but the current register could not be refreshed.',
        'تم حفظ الفئة الفرعية، ولكن تعذّر تحديث السجل الحالي.',
      ));
    } finally {
      setRefreshing(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (refreshRequired) return;
    const trimmedEn = nameEn.trim();
    const trimmedAr = nameAr.trim();
    if (!trimmedEn && !trimmedAr) {
      setError(t(props.locale, 'Enter at least one subcategory name.', 'أدخل اسمًا واحدًا للفئة الفرعية على الأقل.'));
      return;
    }
    if (trimmedEn.length > 120 || trimmedAr.length > 120) {
      setError(t(props.locale, 'Subcategory names must be 120 characters or fewer.', 'يجب ألا يزيد اسم الفئة الفرعية عن 120 حرفًا.'));
      return;
    }
    void run(() => props.onSubmit({ nameEn: trimmedEn || null, nameAr: trimmedAr || null }));
  }

  if (success) return <DialogShell title={t(props.locale, 'Create a subcategory', 'إنشاء فئة فرعية')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} descriptionId={descriptionId} focusVersion="success">
    <div className="dialog-result" role="status"><strong>{t(props.locale, 'Subcategory created', 'تم إنشاء الفئة الفرعية')}</strong><p id={descriptionId}>{t(props.locale, 'The active register was refreshed from the server.', 'تم تحديث سجل الفئات الفعالة من الخادم.')}</p><button type="button" data-autofocus onClick={props.onClose}>{t(props.locale, 'Done', 'تم')}</button></div>
  </DialogShell>;

  return <DialogShell title={t(props.locale, 'Create a subcategory', 'إنشاء فئة فرعية')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending || refreshing} descriptionId={descriptionId}>
    <form className="dialog-form" onSubmit={submit}>
      <p id={descriptionId} className="dialog-intro">{t(props.locale, 'Add a subcategory beneath', 'أضف فئة فرعية ضمن')} <strong><bdi>{displayName(props.parent, props.locale)}</bdi></strong>. {t(props.locale, 'Its parent and type cannot change.', 'لا يمكن تغيير الفئة الرئيسية أو النوع.')}</p>
      {error && <div className="error-notice" role="alert">{error}{refreshRequired ? <div><button type="button" className="button-secondary retry-command" disabled={refreshing} onClick={() => void refreshAcceptedCommand()}>{refreshing ? t(props.locale, 'Refreshing…', 'جارٍ التحديث…') : t(props.locale, 'Refresh categories', 'تحديث الفئات')}</button></div> : props.ambiguous && <div><button type="button" className="button-secondary retry-command" disabled={props.pending} onClick={() => void run(props.onRetry)}>{t(props.locale, 'Retry unchanged subcategory', 'إعادة الفئة الفرعية دون تغيير')}</button></div>}</div>}
      <div className="form-grid category-form-grid">
        <div className="category-parent-note"><span>{t(props.locale, 'Parent', 'الفئة الرئيسية')}</span><strong><bdi>{displayName(props.parent, props.locale)}</bdi></strong></div>
        <div className="category-name-note">{t(props.locale, 'At least one name is required.', 'مطلوب اسم واحد على الأقل.')}</div>
        <label>{t(props.locale, 'English name', 'الاسم بالإنجليزية')}<input data-autofocus dir="ltr" maxLength={120} value={nameEn} disabled={refreshRequired} onChange={(event) => edit(() => setNameEn(event.target.value))} /></label>
        <label>{t(props.locale, 'Arabic name', 'الاسم بالعربية')}<input dir="rtl" maxLength={120} value={nameAr} disabled={refreshRequired} onChange={(event) => edit(() => setNameAr(event.target.value))} /></label>
      </div>
      <div className="dialog-actions"><button type="button" className="button-secondary" disabled={props.pending || refreshing} onClick={props.onClose}>{t(props.locale, refreshRequired ? 'Close' : 'Cancel', refreshRequired ? 'إغلاق' : 'إلغاء')}</button><button type="submit" disabled={props.pending || refreshRequired}>{props.pending ? t(props.locale, 'Creating…', 'جارٍ الإنشاء…') : t(props.locale, 'Create subcategory', 'إنشاء الفئة الفرعية')}</button></div>
    </form>
  </DialogShell>;
}
