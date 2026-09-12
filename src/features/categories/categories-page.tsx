import { useState } from 'react';

import type { Locale } from '../loans/types.js';
import { ArchiveCategoryDialog } from './archive-category-dialog.js';
import { CategoryDialog } from './category-dialog.js';
import { localizeCategoryError } from './errors.js';
import { SubcategoryDialog } from './subcategory-dialog.js';
import type { CategoriesGateway, Category, CategoryKind } from './types.js';
import { useCategories } from './use-categories.js';

interface CategoriesPageProps {
  gateway: CategoriesGateway;
  spaceId: string;
  locale?: Locale;
  onSpaceUnavailable(): void;
}

type OpenDialog = { create: CategoryKind } | { createSubcategory: Category } | { archive: Category } | null;
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
  onCreateSubcategory(category: Category): void;
  onLoadMore(): void;
}

function CategoryName({ category, locale }: { category: Category; locale: Locale }) {
  const secondary = secondaryName(category, locale);
  return <div className="category-name"><bdi>{primaryName(category, locale)}</bdi>{secondary && <small><bdi>{secondary}</bdi></small>}</div>;
}

function CategoryTree({ props }: { props: RegisterProps }) {
  const roots = props.categories.filter((category) => category.parentCategoryId === null);
  return <ul className="category-list">{roots.map((root) => {
    const children = props.categories.filter((category) => category.parentCategoryId === root.id);
    const rootName = primaryName(root, props.locale);
    return <li key={root.id} className="category-tree-root">
      <div className="category-row category-root-row">
        <CategoryName category={root} locale={props.locale} />
        <div className="category-actions">
          <button type="button" className="text-button" aria-label={t(props.locale, `New subcategory for ${rootName}`, `فئة فرعية جديدة ضمن ${rootName}`)} onClick={() => props.onCreateSubcategory(root)}>{t(props.locale, 'New subcategory', 'فئة فرعية جديدة')}</button>
          {children.length === 0 && props.nextCursor === null
            ? <button type="button" className="text-button" aria-label={`${t(props.locale, 'Archive', 'أرشفة')} ${rootName}`} onClick={() => props.onArchive(root)}>{t(props.locale, 'Archive', 'أرشفة')}</button>
            : children.length > 0
              ? <span className="category-archive-note">{t(props.locale, 'Archive subcategories first', 'أرشف الفئات الفرعية أولًا')}</span>
              : null}
        </div>
      </div>
      {children.length > 0 && <ul className="subcategory-list" aria-label={t(props.locale, `Subcategories of ${rootName}`, `الفئات الفرعية ضمن ${rootName}`)}>{children.map((child) => <li key={child.id}>
        <div className="category-row subcategory-row">
          <CategoryName category={child} locale={props.locale} />
          <button type="button" className="text-button" aria-label={`${t(props.locale, 'Archive', 'أرشفة')} ${primaryName(child, props.locale)}`} onClick={() => props.onArchive(child)}>{t(props.locale, 'Archive', 'أرشفة')}</button>
        </div>
      </li>)}</ul>}
    </li>;
  })}</ul>;
}

function CategoryRegister(props: RegisterProps) {
  const income = props.kind === 'income';
  return <section className={`category-register register-section ${props.activeKind === props.kind ? 'category-register-mobile-active' : ''}`} data-category-kind={props.kind} aria-labelledby={`${props.kind}-categories-heading`}>
    <header><div><span className="section-kicker">{income ? t(props.locale, 'Money in', 'الأموال الواردة') : t(props.locale, 'Money out', 'الأموال الصادرة')}</span><h2 id={`${props.kind}-categories-heading`}>{income ? t(props.locale, 'Income categories', 'فئات الدخل') : t(props.locale, 'Expense categories', 'فئات المصروف')}</h2></div><span className="count-badge">{props.categories.length}</span></header>
    {props.categories.length === 0 ? <div className="empty category-empty"><strong>{income ? t(props.locale, 'No income categories yet', 'لا توجد فئات دخل بعد') : t(props.locale, 'No expense categories yet', 'لا توجد فئات مصروف بعد')}</strong><p>{t(props.locale, 'Create a label when this space needs one.', 'أنشئ تسمية عندما تحتاج إليها هذه المساحة.')}</p></div> : <CategoryTree props={props} />}
    {props.nextCursor && <button type="button" className="button-secondary load-more" disabled={props.loadingMore} onClick={props.onLoadMore}>{props.loadingMore ? t(props.locale, 'Loading…', 'جارٍ التحميل…') : t(props.locale, 'Load more', 'تحميل المزيد')}</button>}
  </section>;
}

export function CategoriesPage({ gateway, spaceId, locale = 'en', onSpaceUnavailable }: CategoriesPageProps) {
  const state = useCategories(gateway, spaceId, onSpaceUnavailable);
  const loadError = state.error ? localizeCategoryError(state.error, locale) : null;
  const paginationError = state.paginationError
    ? { ...state.paginationError, error: localizeCategoryError(state.paginationError.error, locale) }
    : null;
  const [activeKind, setActiveKind] = useState<CategoryKind>('income');
  const [dialog, setDialog] = useState<OpenDialog>(null);

  return <section className="categories-workspace">
    <header className="topbar page-header categories-topbar"><div><span className="brand">{t(locale, 'Category register', 'سجل الفئات')}</span><h1>{t(locale, 'Categories', 'الفئات')}</h1><p>{t(locale, 'Keep income and expense labels clear. Archiving affects new entries only; history stays intact.', 'نظّم تسميات الدخل والمصروف بوضوح. تؤثر الأرشفة على القيود الجديدة فقط ويبقى السجل كما هو.')}</p></div><button type="button" className="page-header-action" onClick={() => setDialog({ create: activeKind })}>{t(locale, 'New category', 'فئة جديدة')}</button></header>

    <div className="category-kind-tabs" role="group" aria-label={t(locale, 'Category type', 'نوع الفئة')}><button type="button" className={activeKind === 'income' ? 'category-tab-active' : ''} aria-pressed={activeKind === 'income'} onClick={() => setActiveKind('income')}>{t(locale, 'Income', 'الدخل')}</button><button type="button" className={activeKind === 'expense' ? 'category-tab-active' : ''} aria-pressed={activeKind === 'expense'} onClick={() => setActiveKind('expense')}>{t(locale, 'Expense', 'المصروف')}</button></div>

    {state.status === 'loading' && <div className="state-panel" role="status" aria-label={t(locale, 'Loading categories', 'تحميل الفئات')}>{t(locale, 'Loading this space’s categories…', 'جارٍ تحميل فئات هذه المساحة…')}</div>}
    {state.status === 'error' && <div className="state-panel error-notice" role="alert"><strong>{t(locale, 'Categories are unavailable', 'الفئات غير متاحة')}</strong><p>{loadError?.message}</p><p>{loadError?.recovery}</p><button type="button" onClick={() => void state.refresh()}>{t(locale, 'Try again', 'المحاولة مجددًا')}</button></div>}
    {state.status === 'ready' && <div className="category-registers">
      <CategoryRegister locale={locale} kind="income" categories={state.incomeCategories} activeKind={activeKind} nextCursor={state.incomeNextCursor} loadingMore={state.loadingMore === 'income'} onArchive={(category) => setDialog({ archive: category })} onCreateSubcategory={(category) => setDialog({ createSubcategory: category })} onLoadMore={() => void state.loadMore('income')} />
      <CategoryRegister locale={locale} kind="expense" categories={state.expenseCategories} activeKind={activeKind} nextCursor={state.expenseNextCursor} loadingMore={state.loadingMore === 'expense'} onArchive={(category) => setDialog({ archive: category })} onCreateSubcategory={(category) => setDialog({ createSubcategory: category })} onLoadMore={() => void state.loadMore('expense')} />
    </div>}
    {state.status === 'ready' && paginationError && <div className="state-panel error-notice" role="alert"><strong>{t(locale, 'More categories could not be loaded', 'تعذّر تحميل المزيد من الفئات')}</strong><p>{paginationError.error.message}</p><p>{paginationError.error.recovery}</p><button type="button" onClick={() => void state.loadMore(paginationError.kind)}>{t(locale, `Retry loading ${paginationError.kind} categories`, `إعادة محاولة تحميل فئات ${paginationError.kind === 'income' ? 'الدخل' : 'المصروف'}`)}</button></div>}

    {dialog && 'create' in dialog && <CategoryDialog locale={locale} initialKind={dialog.create} pending={state.pending} ambiguous={state.ambiguous?.kind === 'create'} onClose={() => setDialog(null)} onClearAmbiguous={state.clearAmbiguous} onRetry={state.retryAmbiguous} onRefresh={state.recoverRefresh} onSubmit={state.createCategory} />}
    {dialog && 'createSubcategory' in dialog && <SubcategoryDialog locale={locale} parent={dialog.createSubcategory} pending={state.pending} ambiguous={state.ambiguous?.kind === 'create-subcategory'} onClose={() => setDialog(null)} onClearAmbiguous={state.clearAmbiguous} onRetry={state.retryAmbiguous} onRefresh={state.recoverRefresh} onSubmit={(draft) => state.createSubcategory(dialog.createSubcategory.id, draft)} />}
    {dialog && 'archive' in dialog && <ArchiveCategoryDialog locale={locale} category={dialog.archive} pending={state.pending} ambiguous={state.ambiguous?.kind === 'archive'} onClose={() => setDialog(null)} onRetry={state.retryAmbiguous} onRefresh={state.recoverRefresh} onSubmit={() => state.archiveCategory(dialog.archive.id)} />}
  </section>;
}
