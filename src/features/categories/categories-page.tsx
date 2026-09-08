import { useState } from 'react';

import type { Locale } from '../loans/types.js';
import { ArchiveCategoryDialog } from './archive-category-dialog.js';
import { CategoryDialog } from './category-dialog.js';
import type { CategoriesGateway, Category, CategoryKind } from './types.js';
import { useCategories } from './use-categories.js';

interface CategoriesPageProps {
  gateway: CategoriesGateway;
  spaceId: string;
  locale?: Locale;
  onSpaceUnavailable(): void;
}

type OpenDialog = { create: CategoryKind } | { archive: Category } | null;
const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

function primaryName(category: Category, locale: Locale): string {
  return (locale === 'ar' ? category.nameAr ?? category.nameEn : category.nameEn ?? category.nameAr) ?? '';
}

function secondaryName(category: Category, locale: Locale): string | null {
  const value = locale === 'ar' ? category.nameEn : category.nameAr;
  return value && value !== primaryName(category, locale) ? value : null;
}

interface RegisterProps {
  locale: Locale;
  kind: CategoryKind;
  categories: readonly Category[];
  activeKind: CategoryKind;
  nextCursor: string | null;
  loadingMore: boolean;
  onArchive(category: Category): void;
  onLoadMore(): void;
}

function CategoryRegister(props: RegisterProps) {
  const income = props.kind === 'income';
  return <section className={`category-register ${props.activeKind === props.kind ? 'category-register-mobile-active' : ''}`} aria-labelledby={`${props.kind}-categories-heading`}>
    <header><div><span className="section-kicker">{income ? t(props.locale, 'Money in', 'الأموال الواردة') : t(props.locale, 'Money out', 'الأموال الصادرة')}</span><h2 id={`${props.kind}-categories-heading`}>{income ? t(props.locale, 'Income categories', 'فئات الدخل') : t(props.locale, 'Expense categories', 'فئات المصروف')}</h2></div><span>{props.categories.length}</span></header>
    {props.categories.length === 0 ? <div className="empty category-empty"><strong>{income ? t(props.locale, 'No income categories yet', 'لا توجد فئات دخل بعد') : t(props.locale, 'No expense categories yet', 'لا توجد فئات مصروف بعد')}</strong><p>{t(props.locale, 'Create a label when this space needs one.', 'أنشئ تسمية عندما تحتاج إليها هذه المساحة.')}</p></div> : <ul className="category-list">{props.categories.map((category) => <li key={category.id}><div><bdi>{primaryName(category, props.locale)}</bdi>{secondaryName(category, props.locale) && <small><bdi>{secondaryName(category, props.locale)}</bdi></small>}</div><button type="button" className="text-button" aria-label={`${t(props.locale, 'Archive', 'أرشفة')} ${primaryName(category, props.locale)}`} onClick={() => props.onArchive(category)}>{t(props.locale, 'Archive', 'أرشفة')}</button></li>)}</ul>}
    {props.nextCursor && <button type="button" className="button-secondary load-more" disabled={props.loadingMore} onClick={props.onLoadMore}>{props.loadingMore ? t(props.locale, 'Loading…', 'جارٍ التحميل…') : t(props.locale, 'Load more', 'تحميل المزيد')}</button>}
  </section>;
}

export function CategoriesPage({ gateway, spaceId, locale = 'en', onSpaceUnavailable }: CategoriesPageProps) {
  const state = useCategories(gateway, spaceId, onSpaceUnavailable);
  const [activeKind, setActiveKind] = useState<CategoryKind>('income');
  const [dialog, setDialog] = useState<OpenDialog>(null);

  return <section className="categories-workspace">
    <header className="topbar categories-topbar"><div><span className="brand">{t(locale, 'Category register', 'سجل الفئات')}</span><h1>{t(locale, 'Categories', 'الفئات')}</h1><p>{t(locale, 'Keep income and expense labels clear. Archiving affects new entries only; history stays intact.', 'نظّم تسميات الدخل والمصروف بوضوح. تؤثر الأرشفة على القيود الجديدة فقط ويبقى السجل كما هو.')}</p></div><button type="button" onClick={() => setDialog({ create: activeKind })}>{t(locale, 'New category', 'فئة جديدة')}</button></header>

    <div className="category-kind-tabs" role="group" aria-label={t(locale, 'Category type', 'نوع الفئة')}><button type="button" className={activeKind === 'income' ? 'category-tab-active' : ''} aria-pressed={activeKind === 'income'} onClick={() => setActiveKind('income')}>{t(locale, 'Income', 'الدخل')}</button><button type="button" className={activeKind === 'expense' ? 'category-tab-active' : ''} aria-pressed={activeKind === 'expense'} onClick={() => setActiveKind('expense')}>{t(locale, 'Expense', 'المصروف')}</button></div>

    {state.status === 'loading' && <div className="state-panel" role="status" aria-label={t(locale, 'Loading categories', 'تحميل الفئات')}>{t(locale, 'Loading this space’s categories…', 'جارٍ تحميل فئات هذه المساحة…')}</div>}
    {state.status === 'error' && <div className="state-panel error-notice" role="alert"><strong>{t(locale, 'Categories are unavailable', 'الفئات غير متاحة')}</strong><p>{state.error?.message}</p><p>{state.error?.recovery}</p><button type="button" onClick={() => void state.refresh()}>{t(locale, 'Try again', 'المحاولة مجددًا')}</button></div>}
    {state.status === 'ready' && <div className="category-registers">
      <CategoryRegister locale={locale} kind="income" categories={state.incomeCategories} activeKind={activeKind} nextCursor={state.incomeNextCursor} loadingMore={state.loadingMore === 'income'} onArchive={(category) => setDialog({ archive: category })} onLoadMore={() => void state.loadMore('income')} />
      <CategoryRegister locale={locale} kind="expense" categories={state.expenseCategories} activeKind={activeKind} nextCursor={state.expenseNextCursor} loadingMore={state.loadingMore === 'expense'} onArchive={(category) => setDialog({ archive: category })} onLoadMore={() => void state.loadMore('expense')} />
    </div>}
    {state.status === 'ready' && state.paginationError && <div className="state-panel error-notice" role="alert"><strong>{t(locale, 'More categories could not be loaded', 'تعذّر تحميل المزيد من الفئات')}</strong><p>{state.paginationError.error.message}</p><p>{state.paginationError.error.recovery}</p><button type="button" onClick={() => void state.loadMore(state.paginationError!.kind)}>{t(locale, `Retry loading ${state.paginationError.kind} categories`, `إعادة محاولة تحميل فئات ${state.paginationError.kind === 'income' ? 'الدخل' : 'المصروف'}`)}</button></div>}

    {dialog && 'create' in dialog && <CategoryDialog locale={locale} initialKind={dialog.create} pending={state.pending} ambiguous={state.ambiguous?.kind === 'create'} onClose={() => setDialog(null)} onClearAmbiguous={state.clearAmbiguous} onRetry={state.retryAmbiguous} onSubmit={state.createCategory} />}
    {dialog && 'archive' in dialog && <ArchiveCategoryDialog locale={locale} category={dialog.archive} pending={state.pending} ambiguous={state.ambiguous?.kind === 'archive'} onClose={() => setDialog(null)} onRetry={state.retryAmbiguous} onSubmit={() => state.archiveCategory(dialog.archive.id)} />}
  </section>;
}
