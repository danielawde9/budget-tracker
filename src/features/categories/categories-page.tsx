import { useState } from 'react';
import { Archive, ChevronDown, Plus, Tags } from 'lucide-react';

import type { Locale } from '../loans/types.js';
import { ArchiveCategoryDialog } from './archive-category-dialog.js';
import { CategoryDialog } from './category-dialog.js';
import { localizeCategoryError } from './errors.js';
import { SubcategoryDialog } from './subcategory-dialog.js';
import type { CategoriesGateway, Category, CategoryKind } from './types.js';
import { useCategories } from './use-categories.js';
import { PageHeader } from '../control-room/page-header.js';
import { CategoriesSkeleton } from '../control-room/skeletons.js';
import './categories-manage.css';

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
  nextCursor: string | null;
  loadingMore: boolean;
  onCreate(): void;
  onArchive(category: Category): void;
  onCreateSubcategory(category: Category): void;
  onLoadMore(): void;
}

function CategoryName({ category, locale }: { category: Category; locale: Locale }) {
  const secondary = secondaryName(category, locale);
  return <div className="category-name cg-name"><bdi>{primaryName(category, locale)}</bdi>{secondary && <small><bdi>{secondary}</bdi></small>}</div>;
}

function CategoryTree({ props }: { props: RegisterProps }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const roots = props.categories.filter((category) => category.parentCategoryId === null);
  return <ul className="category-list cg-list">{roots.map((root) => {
    const children = props.categories.filter((category) => category.parentCategoryId === root.id);
    const rootName = primaryName(root, props.locale);
    const expanded = !collapsed.has(root.id);
    return <li key={root.id} className="category-tree-root cg-tree-root">
      <div className="category-row category-root-row cg-row cg-row-root">
        {children.length > 0 ? <button type="button" className="text-button cg-toggle" aria-label={t(props.locale, `${expanded ? 'Collapse' : 'Expand'} ${rootName} subcategories`, `${expanded ? 'طي' : 'عرض'} الفئات الفرعية ضمن ${rootName}`)} aria-expanded={expanded} onClick={() => setCollapsed((current) => {
          const next = new Set(current);
          if (expanded) next.add(root.id); else next.delete(root.id);
          return next;
        })}><ChevronDown aria-hidden size={17} /></button> : <span className="cg-toggle-spacer" aria-hidden="true" />}
        <span className="cg-root-icon" aria-hidden="true"><Tags size={19} /></span>
        <CategoryName category={root} locale={props.locale} />
        {children.length > 0 ? <span className="cr-helper cg-child-count">{children.length}</span> : null}
        <div className="category-actions cg-actions">
          <button type="button" className="text-button cg-action" aria-label={t(props.locale, `New subcategory for ${rootName}`, `فئة فرعية جديدة ضمن ${rootName}`)} onClick={() => props.onCreateSubcategory(root)}><Plus aria-hidden size={15} />{t(props.locale, 'New subcategory', 'فئة فرعية جديدة')}</button>
          {children.length === 0 && props.nextCursor === null
            ? <button type="button" className="text-button cg-action cg-action-archive" aria-label={`${t(props.locale, 'Archive', 'أرشفة')} ${rootName}`} onClick={() => props.onArchive(root)}><Archive aria-hidden size={15} />{t(props.locale, 'Archive', 'أرشفة')}</button>
            : null}
        </div>
        {children.length > 0
          ? <span className="category-archive-note cg-archive-note">{t(props.locale, 'Archive subcategories first', 'أرشف الفئات الفرعية أولًا')}</span>
          : null}
      </div>
      {children.length > 0 && expanded && <ul className="subcategory-list cg-subcategory-list" aria-label={t(props.locale, `Subcategories of ${rootName}`, `الفئات الفرعية ضمن ${rootName}`)}>{children.map((child) => <li key={child.id}>
        <div className="category-row subcategory-row cg-row cg-row-sub">
          <CategoryName category={child} locale={props.locale} />
          <button type="button" className="text-button cg-action cg-action-archive" aria-label={`${t(props.locale, 'Archive', 'أرشفة')} ${primaryName(child, props.locale)}`} onClick={() => props.onArchive(child)}><Archive aria-hidden size={15} />{t(props.locale, 'Archive', 'أرشفة')}</button>
        </div>
      </li>)}</ul>}
    </li>;
  })}</ul>;
}

function CategoryRegister(props: RegisterProps) {
  const income = props.kind === 'income';
  const rootCount = props.categories.filter((category) => category.parentCategoryId === null).length;
  return <section className="category-register register-section cg-register cr-card" data-category-kind={props.kind} aria-labelledby={`${props.kind}-categories-heading`}>
    <header className="cg-register-header cr-section-header"><h2 id={`${props.kind}-categories-heading`}>{income ? t(props.locale, 'Income categories', 'فئات الدخل') : t(props.locale, 'Expense categories', 'فئات المصروف')}</h2><span className="cr-helper cg-count">{props.nextCursor ? t(props.locale, `${rootCount} loaded`, `تم تحميل ${rootCount}`) : t(props.locale, `${rootCount} ${rootCount === 1 ? 'category' : 'categories'}`, `${rootCount} فئة`)}</span></header>
    {props.categories.length === 0 ? <div className="empty category-empty cg-empty"><strong>{income ? t(props.locale, 'No income categories yet', 'لا توجد فئات دخل بعد') : t(props.locale, 'No expense categories yet', 'لا توجد فئات مصروف بعد')}</strong><p>{t(props.locale, 'Create a label when this space needs one.', 'أنشئ تسمية عندما تحتاج إليها هذه المساحة.')}</p><button type="button" className="cr-button cr-button--primary cg-empty-action" onClick={props.onCreate}>{t(props.locale, 'New category', 'فئة جديدة')}</button></div> : <CategoryTree props={props} />}
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
    <PageHeader
      title={t(locale, 'Categories', 'الفئات')}
      subtitle={t(locale, 'Use categories to label your income and expenses. Archiving hides a category from new entries; past records stay intact.', 'استخدم الفئات لتسمية الدخل والمصروف. تخفي الأرشفة الفئة من القيود الجديدة وتبقى السجلات السابقة كما هي.')}
    />

    <div className="cg-toolbar">
      <div className="category-kind-tabs cg-kind-tabs" role="group" aria-label={t(locale, 'Category type', 'نوع الفئة')}><button type="button" className={`cr-chip ${activeKind === 'income' ? 'cr-chip--active category-tab-active' : ''}`} aria-pressed={activeKind === 'income'} onClick={() => setActiveKind('income')}>{t(locale, 'Income', 'الدخل')}</button><button type="button" className={`cr-chip ${activeKind === 'expense' ? 'cr-chip--active category-tab-active' : ''}`} aria-pressed={activeKind === 'expense'} onClick={() => setActiveKind('expense')}>{t(locale, 'Expense', 'المصروف')}</button></div>
      <button type="button" className="cr-button cr-button--primary cg-new-category" onClick={() => setDialog({ create: activeKind })}><Plus aria-hidden size={18} />{t(locale, 'New category', 'فئة جديدة')}</button>
    </div>

    {state.status === 'loading' && <CategoriesSkeleton locale={locale} />}
    {state.status === 'error' && <div className="state-panel error-notice" role="alert"><strong>{t(locale, 'Categories are unavailable', 'الفئات غير متاحة')}</strong><p>{loadError?.message}</p><p>{loadError?.recovery}</p><button type="button" onClick={() => void state.refresh()}>{t(locale, 'Try again', 'المحاولة مجددًا')}</button></div>}
    {state.status === 'ready' && <div className="category-registers cg-registers">
      <CategoryRegister locale={locale} kind="income" categories={state.incomeCategories} nextCursor={state.incomeNextCursor} loadingMore={state.loadingMore === 'income'} onCreate={() => setDialog({ create: 'income' })} onArchive={(category) => setDialog({ archive: category })} onCreateSubcategory={(category) => setDialog({ createSubcategory: category })} onLoadMore={() => void state.loadMore('income')} />
      <CategoryRegister locale={locale} kind="expense" categories={state.expenseCategories} nextCursor={state.expenseNextCursor} loadingMore={state.loadingMore === 'expense'} onCreate={() => setDialog({ create: 'expense' })} onArchive={(category) => setDialog({ archive: category })} onCreateSubcategory={(category) => setDialog({ createSubcategory: category })} onLoadMore={() => void state.loadMore('expense')} />
    </div>}
    {state.status === 'ready' && paginationError && <div className="state-panel error-notice" role="alert"><strong>{t(locale, 'More categories could not be loaded', 'تعذّر تحميل المزيد من الفئات')}</strong><p>{paginationError.error.message}</p><p>{paginationError.error.recovery}</p><button type="button" onClick={() => void state.loadMore(paginationError.kind)}>{t(locale, `Retry loading ${paginationError.kind} categories`, `إعادة محاولة تحميل فئات ${paginationError.kind === 'income' ? 'الدخل' : 'المصروف'}`)}</button></div>}

    {dialog && 'create' in dialog && <CategoryDialog locale={locale} initialKind={dialog.create} pending={state.pending} ambiguous={state.ambiguous?.kind === 'create'} onClose={() => setDialog(null)} onClearAmbiguous={state.clearAmbiguous} onRetry={state.retryAmbiguous} onRefresh={state.recoverRefresh} onSubmit={state.createCategory} />}
    {dialog && 'createSubcategory' in dialog && <SubcategoryDialog locale={locale} parent={dialog.createSubcategory} pending={state.pending} ambiguous={state.ambiguous?.kind === 'create-subcategory'} onClose={() => setDialog(null)} onClearAmbiguous={state.clearAmbiguous} onRetry={state.retryAmbiguous} onRefresh={state.recoverRefresh} onSubmit={(draft) => state.createSubcategory(dialog.createSubcategory.id, draft)} />}
    {dialog && 'archive' in dialog && <ArchiveCategoryDialog locale={locale} category={dialog.archive} pending={state.pending} ambiguous={state.ambiguous?.kind === 'archive'} onClose={() => setDialog(null)} onRetry={state.retryAmbiguous} onRefresh={state.recoverRefresh} onSubmit={() => state.archiveCategory(dialog.archive.id)} />}
  </section>;
}
