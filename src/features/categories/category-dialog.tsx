import { useState, type FormEvent } from 'react';

import type { Locale } from '../loans/types.js';
import { DialogShell } from '../wallets/dialog-shell.js';
import { classifyCategoryError } from './errors.js';
import type { CategoryKind } from './types.js';
import type { CategoryCommandOutcome, CreateCategoryDraft } from './use-categories.js';

interface CategoryDialogProps {
  locale: Locale;
  initialKind: CategoryKind;
  pending: boolean;
  ambiguous: boolean;
  onClose(): void;
  onClearAmbiguous(): void;
  onRetry(): Promise<CategoryCommandOutcome>;
  onSubmit(input: CreateCategoryDraft): Promise<CategoryCommandOutcome>;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

function errorCopy(locale: Locale, cause: unknown): string {
  const error = classifyCategoryError(cause);
  if (locale === 'en') return `${error.message} ${error.recovery}`;
  const messages = {
    missing_membership: 'لم يعد لديك وصول إلى هذه المساحة. حدّث المساحات المتاحة واختر مساحة يمكنك الوصول إليها.',
    duplicate_name: 'تستخدم فئة فعالة أحد هذين الاسمين بالفعل. استخدم اسمًا آخر أو أرشف الفئة الحالية أولًا.',
    invalid_category: 'لم تعد هذه الفئة متاحة. حدّث الفئات واختر فئة فعالة من النوع المطابق.',
    request_collision: 'لم يعد هذا الطلب يطابق التفاصيل الأصلية. راجع القيم الحالية وأرسلها كطلب جديد.',
    already_archived: 'هذه الفئة مؤرشفة بالفعل. حدّث سجل الفئات لعرض القائمة الحالية.',
    unknown: 'لم يتم قبول طلب الفئة. راجع التفاصيل وحاول مجددًا.',
  } as const;
  return messages[error.code];
}

export function CategoryDialog(props: CategoryDialogProps) {
  const [kind, setKind] = useState<CategoryKind>(props.initialKind);
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
      else setError(t(props.locale,
        'The result is still unknown. We found no matching category command; retry only if these details are unchanged.',
        'ما زالت النتيجة غير معروفة. لم نجد أمر فئة مطابقًا؛ أعد المحاولة فقط إذا بقيت التفاصيل كما هي.',
      ));
    } catch (cause) {
      setError(errorCopy(props.locale, cause));
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmedEn = nameEn.trim();
    const trimmedAr = nameAr.trim();
    if (!trimmedEn && !trimmedAr) {
      setError(t(props.locale, 'Enter at least one category name.', 'أدخل اسمًا واحدًا للفئة على الأقل.'));
      return;
    }
    if (trimmedEn.length > 120 || trimmedAr.length > 120) {
      setError(t(props.locale, 'Category names must be 120 characters or fewer.', 'يجب ألا يزيد اسم الفئة عن 120 حرفًا.'));
      return;
    }
    void run(() => props.onSubmit({ kind, nameEn: trimmedEn || null, nameAr: trimmedAr || null }));
  }

  if (success) return <DialogShell title={t(props.locale, 'Create a category', 'إنشاء فئة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose}>
    <div className="dialog-result" role="status"><strong>{t(props.locale, 'Category created', 'تم إنشاء الفئة')}</strong><p>{t(props.locale, 'The active register was refreshed from the server.', 'تم تحديث سجل الفئات الفعالة من الخادم.')}</p><button type="button" data-autofocus onClick={props.onClose}>{t(props.locale, 'Done', 'تم')}</button></div>
  </DialogShell>;

  return <DialogShell title={t(props.locale, 'Create a category', 'إنشاء فئة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending}>
    <form onSubmit={submit}>
      <p className="dialog-intro">{t(props.locale, 'Add an income or expense label. Enter either language or both; missing names are never invented.', 'أضف تسمية للدخل أو المصروف. أدخل لغة واحدة أو كلتيهما؛ لا يتم اختلاق الاسم المفقود.')}</p>
      {error && <div className="error-notice" role="alert">{error}{props.ambiguous && <div><button type="button" className="button-secondary retry-command" disabled={props.pending} onClick={() => void run(props.onRetry)}>{t(props.locale, 'Retry unchanged category', 'إعادة الفئة دون تغيير')}</button></div>}</div>}
      <div className="form-grid category-form-grid">
        <label>{t(props.locale, 'Type', 'النوع')}<select value={kind} onChange={(event) => edit(() => setKind(event.target.value as CategoryKind))}><option value="income">{t(props.locale, 'Income', 'دخل')}</option><option value="expense">{t(props.locale, 'Expense', 'مصروف')}</option></select></label>
        <div className="category-name-note">{t(props.locale, 'At least one name is required.', 'مطلوب اسم واحد على الأقل.')}</div>
        <label>{t(props.locale, 'English name', 'الاسم بالإنجليزية')}<input data-autofocus dir="ltr" maxLength={120} value={nameEn} onChange={(event) => edit(() => setNameEn(event.target.value))} /></label>
        <label>{t(props.locale, 'Arabic name', 'الاسم بالعربية')}<input dir="rtl" maxLength={120} value={nameAr} onChange={(event) => edit(() => setNameAr(event.target.value))} /></label>
      </div>
      <div className="dialog-actions"><button type="button" className="button-secondary" disabled={props.pending} onClick={props.onClose}>{t(props.locale, 'Cancel', 'إلغاء')}</button><button type="submit" disabled={props.pending}>{props.pending ? t(props.locale, 'Creating…', 'جارٍ الإنشاء…') : t(props.locale, 'Create category', 'إنشاء الفئة')}</button></div>
    </form>
  </DialogShell>;
}
