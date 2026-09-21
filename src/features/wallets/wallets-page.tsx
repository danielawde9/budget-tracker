import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, ChevronDown, ScrollText, Wallet } from 'lucide-react';

import type { CategoriesGateway } from '../categories/types.js';
import { useCategories } from '../categories/use-categories.js';
import { localizeCategoryError } from '../categories/errors.js';
import type { Locale } from '../loans/types.js';
import { ArchiveWalletDialog } from './archive-wallet-dialog.js';
import { CorrectionDialog } from './correction-dialog.js';
import { formatMinorAmount } from './money.js';
import { filterJournalEvents, journalEventsToCsv, type JournalFilters } from './journal-tools.js';
import { transactionDefaultsFromRecentEvent, type QuickEntryDefaults } from './quick-entry.js';
import { RenameWalletDialog } from './rename-wallet-dialog.js';
import { RestoreWalletDialog } from './restore-wallet-dialog.js';
import { TransactionDialog } from './transaction-dialog.js';
import type { JournalEvent, JournalEventKind, WalletProjection } from './types.js';
import type { WalletsState } from './use-wallets.js';
import { WalletDialog } from './wallet-dialog.js';
import './wallets-workspace.css';

interface WalletsPageProps {
  categoriesGateway?: CategoriesGateway;
  spaceId: string;
  userId?: string;
  walletState: WalletsState;
  locale?: Locale;
  onSpaceUnavailable(): void;
  onOpenLoans(): void;
  initialDialog?: 'transaction' | null;
  openTransaction?: boolean;
  onTransactionDialogOpened?(): void;
}

type OpenDialog = 'wallet' | 'transaction' | { correction: JournalEvent } | { rename: WalletProjection } | { archive: WalletProjection } | { restore: WalletProjection } | null;
const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

function eventLabel(locale: Locale, kind: JournalEventKind): string {
  const labels = {
    opening_balance: ['Opening balance', 'رصيد افتتاحي'], income: ['Income', 'دخل'], expense: ['Expense', 'مصروف'], transfer: ['Transfer', 'تحويل'],
    loan_opening: ['Loan opening', 'رصيد قرض افتتاحي'], loan_lend: ['Loan payment', 'دفع قرض'], loan_borrow: ['Borrowed funds', 'أموال مقترضة'],
    loan_receive_repayment: ['Loan repayment received', 'دفعة قرض مستلمة'], loan_repay_borrowing: ['Loan repayment paid', 'دفعة قرض مدفوعة'], reversal: ['Undo', 'تراجع'],
  } as const;
  return labels[kind][locale === 'ar' ? 1 : 0];
}

const generalKinds = new Set<JournalEventKind>(['opening_balance', 'income', 'expense', 'transfer']);

function archivedMovementWallet(event: JournalEvent): string | null {
  return event.movements.find((movement) => movement.walletArchived)?.walletName ?? null;
}

const emptyCategoriesGateway: CategoriesGateway = {
  listCategories: async () => ({ categories: [], nextCursor: null }),
  createCategory: async () => ({}),
  createSubcategory: async () => ({}),
  archiveCategory: async () => ({}),
  getCommandResult: async () => null,
  recordCategorizedEvent: async () => ({}),
  findCategorizedEventByRequestId: async () => null,
  resolveEventCategories: async () => [],
};

/** Decorative placeholders mirroring the balances-first layout while the first snapshot loads. */
function WalletsWorkspaceSkeleton({ locale }: { locale: Locale }) {
  return (
    <div className="wl-skeleton">
      <p className="cr-visually-hidden" role="status">{t(locale, 'Loading this space’s wallets…', 'جارٍ تحميل محافظ هذه المساحة…')}</p>
      <div className="wl-balance-grid">
        <div className="wl-balance-card"><span className="cr-skeleton cr-skeleton--line-short" aria-hidden="true" /><span className="cr-skeleton cr-skeleton--hero" aria-hidden="true" /></div>
        <div className="wl-balance-card"><span className="cr-skeleton cr-skeleton--line-short" aria-hidden="true" /><span className="cr-skeleton cr-skeleton--hero" aria-hidden="true" /></div>
      </div>
      <div className="wl-skeleton-journal">
        <span className="cr-skeleton cr-skeleton--line-short" aria-hidden="true" />
        <span className="cr-skeleton cr-skeleton--row" aria-hidden="true" />
        <span className="cr-skeleton cr-skeleton--row" aria-hidden="true" />
        <span className="cr-skeleton cr-skeleton--row" aria-hidden="true" />
      </div>
    </div>
  );
}

export function WalletsPage({ categoriesGateway, spaceId, userId, walletState, locale = 'en', onSpaceUnavailable, onOpenLoans, initialDialog = null, openTransaction = false, onTransactionDialogOpened }: WalletsPageProps) {
  const categoryState = useCategories(categoriesGateway ?? emptyCategoriesGateway, spaceId, onSpaceUnavailable);
  const categoryError = categoryState.error ? localizeCategoryError(categoryState.error, locale) : null;
  const categoryPaginationError = categoryState.paginationError
    ? { ...categoryState.paginationError, error: localizeCategoryError(categoryState.paginationError.error, locale) }
    : null;
  const journalCategoryError = walletState.categoryError
    ? localizeCategoryError(walletState.categoryError, locale)
    : null;
  const historyPaginationCategoryError = walletState.historyPaginationError?.categoryError
    ? localizeCategoryError(walletState.historyPaginationError.categoryError, locale)
    : null;
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [filters, setFilters] = useState<JournalFilters>({ query: '', walletId: '', kind: '' });
  const [quickEntryDefaults, setQuickEntryDefaults] = useState<QuickEntryDefaults | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const archivedRegionId = useId();
  const initialDialogConsumed = useRef(false);
  const activeCategories = [...categoryState.incomeCategories, ...categoryState.expenseCategories];
  const filteredEvents = useMemo(() => filterJournalEvents(walletState.events, filters), [filters, walletState.events]);

  function exportCsv() {
    const csv = journalEventsToCsv(filteredEvents);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'budget-journal.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  function openQuickEntry(event?: JournalEvent) {
    const source = event ?? walletState.initialEvents.find((item) => item.kind === 'expense' && !item.reversalOf && !item.reversedBy && !item.loanLinked);
    const defaults = source ? transactionDefaultsFromRecentEvent(source, walletState.wallets, activeCategories) : null;
    setQuickEntryDefaults(event ? defaults : defaults ? { ...defaults, payeeName: null, amount: '' } : null);
    setDialog('transaction');
  }

  useEffect(() => {
    const requestedTransaction = openTransaction || (initialDialog === 'transaction' && !initialDialogConsumed.current);
    if (!requestedTransaction || walletState.wallets.length === 0 || walletState.status !== 'ready') return;
    setDialog('transaction');
    if (initialDialog === 'transaction') initialDialogConsumed.current = true;
    onTransactionDialogOpened?.();
  }, [initialDialog, onTransactionDialogOpened, openTransaction, walletState.status, walletState.wallets.length]);

  return <section className="wallets-workspace">
    <header className="topbar page-header wallets-topbar">
      <div><span className="brand">{t(locale, 'Wallet journal', 'سجل المحافظ')}</span><h1>{t(locale, 'Wallets', 'المحافظ')}</h1><p>{t(locale, 'See server-derived balances, record wallet activity, and undo mistaken transactions.', 'اطّلع على الأرصدة المشتقة من الخادم، وسجّل حركة المحافظ، وتراجع عن المعاملات الخاطئة.')}</p></div>
      <div className="wallet-actions"><button type="button" className="cr-button button-secondary" onClick={() => setDialog('wallet')}>{t(locale, 'New wallet', 'محفظة جديدة')}</button><button type="button" className="cr-button cr-button--primary wl-action-grow" disabled={walletState.wallets.length === 0 || walletState.status !== 'ready'} onClick={() => openQuickEntry()}>{t(locale, 'Add transaction', 'إضافة معاملة')}</button></div>
    </header>

    {walletState.status === 'loading' && <WalletsWorkspaceSkeleton locale={locale} />}
    {walletState.status === 'error' && <div className="state-panel error-notice" role="alert"><strong>{t(locale, 'Wallets are unavailable', 'المحافظ غير متاحة')}</strong><p>{journalCategoryError?.message ?? walletState.error}</p>{journalCategoryError && <p>{journalCategoryError.recovery}</p>}<button type="button" onClick={() => void walletState.refresh()}>{t(locale, 'Try again', 'المحاولة مجددًا')}</button></div>}
    {categoriesGateway && categoryState.status === 'error' && <div className="state-panel error-notice" role="alert"><strong>{t(locale, 'Categories are unavailable', 'الفئات غير متاحة')}</strong><p>{categoryError?.message}</p><p>{categoryError?.recovery}</p><button type="button" onClick={() => void categoryState.refresh()}>{t(locale, 'Try again', 'المحاولة مجددًا')}</button></div>}

    {walletState.status === 'ready' && <>
      <aside className="wallet-context wl-balances" aria-labelledby="wallet-balances-heading">
        <div className="section-heading"><div><span className="section-kicker">{t(locale, 'Current space', 'المساحة الحالية')}</span><h2 id="wallet-balances-heading"><Wallet size={18} aria-hidden className="wl-heading-icon" />{t(locale, 'Active balances', 'الأرصدة الفعالة')}</h2></div><span className="count-badge">{walletState.wallets.length}</span></div>
        {walletState.wallets.length === 0 ? <div className="empty wallet-empty wl-empty-panel"><Wallet size={28} aria-hidden className="wl-empty-icon" /><strong>{t(locale, 'No wallets yet', 'لا توجد محافظ بعد')}</strong><p>{t(locale, 'Create a USD or LBP wallet to start this space’s journal.', 'أنشئ محفظة بالدولار أو الليرة لبدء سجل هذه المساحة.')}</p><button type="button" className="cr-button cr-button--primary" onClick={() => setDialog('wallet')}>{t(locale, 'Create first wallet', 'إنشاء أول محفظة')}</button></div> : <ul className="wallet-list wl-balance-grid">{walletState.wallets.map((wallet) => <li key={wallet.id} className="wl-balance-card">
          <div className="wl-balance-head"><bdi>{wallet.name}</bdi><span className="wl-currency-chip">{wallet.currency}</span></div>
          <bdi className="wallet-balance">{formatMinorAmount(wallet.balanceMinor, wallet.currency, locale)}</bdi>
          <footer className="wl-balance-actions"><button type="button" className="text-button" onClick={() => setDialog({ rename: wallet })}>{t(locale, 'Rename', 'إعادة تسمية')} <bdi>{wallet.name}</bdi></button><button type="button" className="text-button" onClick={() => setDialog({ archive: wallet })}>{t(locale, 'Archive', 'أرشفة')} <bdi>{wallet.name}</bdi></button></footer>
        </li>)}</ul>}
        {walletState.archivedWallets.length > 0 && <div className="wl-archived">
          <button type="button" className="wl-archived-toggle" aria-expanded={archivedOpen} aria-controls={archivedRegionId} onClick={() => setArchivedOpen((open) => !open)}>
            <Archive size={16} aria-hidden />
            {t(locale, `Archived wallets (${walletState.archivedWallets.length})`, `المحافظ المؤرشفة (${walletState.archivedWallets.length})`)}
            <ChevronDown size={16} aria-hidden className="wl-archived-chevron" />
          </button>
          {archivedOpen && <div className="wl-archived-region" id={archivedRegionId}>
            <ul className="wl-archived-list">{walletState.archivedWallets.map((wallet) => <li key={wallet.id} className="wl-archived-row">
              <div className="wl-archived-identity"><bdi>{wallet.name}</bdi><span className="wl-archived-meta">{wallet.currency} · <time dateTime={wallet.archivedAt ?? undefined}>{(wallet.archivedAt ?? '').slice(0, 10)}</time></span></div>
              <button type="button" className="text-button" onClick={() => setDialog({ restore: wallet })}><ArchiveRestore size={14} aria-hidden /> {t(locale, 'Restore', 'استعادة')} <bdi>{wallet.name}</bdi></button>
            </li>)}</ul>
          </div>}
        </div>}
      </aside>

      <section className="journal data-list wl-journal" aria-labelledby="journal-heading">
        <div className="section-heading"><div><span className="section-kicker">{t(locale, 'Immutable journal', 'سجل غير قابل للتعديل')}</span><h2 id="journal-heading">{t(locale, 'Transaction history', 'سجل المعاملات')}</h2></div><button type="button" className="button-secondary" disabled={filteredEvents.length === 0} onClick={exportCsv}>{t(locale, 'Export CSV', 'تصدير CSV')}</button></div>
        {walletState.events.length === 0 ? <div className="empty journal-empty wl-empty-panel"><ScrollText size={28} aria-hidden className="wl-empty-icon" /><strong>{t(locale, 'No transactions yet', 'لا توجد معاملات بعد')}</strong><p>{t(locale, 'Opening balances, income, expenses, and transfers will appear here.', 'ستظهر هنا الأرصدة الافتتاحية والدخل والمصروفات والتحويلات.')}</p></div> : <><div className="journal-filters wl-filters" role="search" aria-label={t(locale, 'Filter transaction history', 'تصفية سجل المعاملات')}><input aria-label={t(locale, 'Search', 'بحث')} placeholder={t(locale, 'Search transactions…', 'ابحث في المعاملات…')} value={filters.query} onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} /><select aria-label={t(locale, 'Wallet', 'المحفظة')} value={filters.walletId} onChange={(event) => setFilters((current) => ({ ...current, walletId: event.target.value }))}><option value="">{t(locale, 'All wallets', 'كل المحافظ')}</option>{walletState.wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}</select><select aria-label={t(locale, 'Event', 'الحدث')} value={filters.kind} onChange={(event) => setFilters((current) => ({ ...current, kind: event.target.value as JournalFilters['kind'] }))}><option value="">{t(locale, 'All events', 'كل الأحداث')}</option>{['opening_balance', 'income', 'expense', 'transfer', 'loan_opening', 'loan_lend', 'loan_borrow', 'loan_receive_repayment', 'loan_repay_borrowing', 'reversal'].map((kind) => <option key={kind} value={kind}>{eventLabel(locale, kind as JournalEventKind)}</option>)}</select></div>{filteredEvents.length === 0 ? <div className="empty journal-empty wl-empty-panel"><strong>{t(locale, 'No matching transactions', 'لا توجد معاملات مطابقة')}</strong></div> : <div className="journal-table" role="table" aria-label={t(locale, 'Transaction history entries', 'قيود سجل المعاملات')}>
          <ol className="journal-list" role="rowgroup">{filteredEvents.map((event) => {
            const label = eventLabel(locale, event.kind);
            const canCorrect = generalKinds.has(event.kind) && !event.loanLinked && !event.reversalOf && !event.reversedBy;
            const categoryLabel = event.category ? (locale === 'ar' ? event.category.nameAr ?? event.category.nameEn : event.category.nameEn ?? event.category.nameAr) : t(locale, 'Uncategorized', 'غير مصنّف');
            const showCategory = Boolean(categoriesGateway && (event.category || event.kind === 'income' || event.kind === 'expense'));
            const enteredBy = userId && event.actorId === userId ? t(locale, 'You', 'أنت') : event.actorId ?? t(locale, 'Unavailable', 'غير متاح');
            return <li key={event.id} role="presentation" className={`journal-row ${event.kind === 'reversal' ? 'wl-journal-row-reversal' : ''}`}>
              {(event.movements.length === 0 ? [null] : event.movements).map((movement, index) => {
                const dateValue = index === 0 ? event.effectiveDate : '—';
                const eventValue = index === 0 ? label : '—';
                const walletValue = movement?.walletName ?? '—';
                const categoryValue = index === 0 && showCategory ? categoryLabel : '—';
                const archivedCategory = index === 0 && Boolean(event.category?.archivedAt);
                const amountValue = movement ? formatMinorAmount(movement.amountMinor, movement.currency, locale) : '—';
                return <div className="journal-movement" key={movement ? `${event.id}-${movement.walletId}` : event.id}>
                  <time dateTime={event.effectiveDate}>{dateValue}</time>
                  <div className="journal-movement-body">
                    <span className="journal-movement-line">
                      <strong>{eventValue}</strong>
                      {index === 0 && showCategory && categoryValue !== '—' ? <span className="journal-category-tag">{archivedCategory ? <><bdi>{categoryValue}</bdi> <small>{t(locale, 'Archived', 'مؤرشفة')}</small></> : <bdi>{categoryValue}</bdi>}</span> : null}
                    </span>
                    <span className="journal-movement-meta">
                      <bdi>{walletValue}</bdi>
                      {index === 0 ? <><span aria-hidden="true">·</span><span>{enteredBy}</span></> : null}
                    </span>
                  </div>
                  <bdi className={movement && BigInt(movement.amountMinor) < 0n ? 'cr-danger-text' : 'cr-positive'}>{amountValue}</bdi>
                </div>;
              })}
              <footer>{(event.payeeName || event.note) && <div className="journal-state">{event.payeeName && <span><bdi>{event.payeeName}</bdi></span>}{event.note && <span><bdi>{event.note}</bdi></span>}</div>}{(event.reversedBy || event.reversalOf || event.loanLinked) && <div className="journal-state">{event.reversedBy && <span>{t(locale, 'Undone', 'تم التراجع عنه')}</span>}{event.reversalOf && <span>{t(locale, 'Undoes an earlier entry', 'تراجع عن قيد سابق')}</span>}{event.loanLinked && <span>{t(locale, 'Loan-linked', 'مرتبط بقرض')}</span>}</div>}{canCorrect && <button type="button" className="text-button" onClick={() => openQuickEntry(event)}>{t(locale, 'Repeat as new', 'كرّر كقيد جديد')}</button>}{canCorrect && (archivedMovementWallet(event) ? <span className="undo-gated">{t(locale, 'Restore', 'استعد')} <bdi>{archivedMovementWallet(event)}</bdi> {t(locale, 'to undo this', 'للتراجع عن هذا')}</span> : <button type="button" className="text-button" onClick={() => setDialog({ correction: event })}>{t(locale, `Undo ${label.toLowerCase()}`, `تراجع عن ${label}`)}</button>)}{event.loanLinked && <button type="button" className="text-button" onClick={onOpenLoans}>{t(locale, 'Manage in Loans', 'الإدارة في القروض')}</button>}</footer>
            </li>;
          })}</ol>
        </div>}</>}
        {walletState.nextCursor && !walletState.historyPaginationError && <button type="button" className="button-secondary load-more" disabled={walletState.loadingMore} onClick={() => void walletState.loadMore()}>{walletState.loadingMore ? t(locale, 'Loading…', 'جارٍ التحميل…') : t(locale, 'Load older entries', 'تحميل قيود أقدم')}</button>}
        {walletState.historyPaginationError && <div className="state-panel error-notice" role="alert"><strong>{t(locale, 'Older entries could not be loaded', 'تعذّر تحميل القيود الأقدم')}</strong><p>{historyPaginationCategoryError?.message ?? walletState.historyPaginationError.error}</p>{historyPaginationCategoryError && <p>{historyPaginationCategoryError.recovery}</p>}<button type="button" disabled={walletState.loadingMore} onClick={() => void walletState.loadMore()}>{walletState.loadingMore ? t(locale, 'Loading…', 'جارٍ التحميل…') : t(locale, 'Retry loading older entries', 'إعادة تحميل القيود الأقدم')}</button></div>}
      </section>
    </>}

    {dialog === 'wallet' && <WalletDialog locale={locale} pending={walletState.pending} onClose={() => setDialog(null)} onRefresh={walletState.recoverRefresh} onSubmit={walletState.createWallet} />}
    {dialog === 'transaction' && <TransactionDialog locale={locale} wallets={walletState.wallets} payees={walletState.payees} recentEvents={walletState.events} quickEntryDefaults={quickEntryDefaults} categories={activeCategories} categoryNextCursors={{ income: categoryState.incomeNextCursor, expense: categoryState.expenseNextCursor }} categoryLoadingMore={categoryState.loadingMore} categoryPaginationError={categoryPaginationError} onLoadMoreCategories={categoryState.loadMore} pending={walletState.pending} ambiguous={walletState.ambiguous?.kind === 'record'} onClose={() => { setDialog(null); setQuickEntryDefaults(null); }} onClearAmbiguous={walletState.clearAmbiguous} onRetry={walletState.retryAmbiguous} onRefresh={walletState.recoverRefresh} onSubmit={walletState.recordEvent} />}
    {dialog && typeof dialog === 'object' && 'correction' in dialog && <CorrectionDialog locale={locale} event={dialog.correction} pending={walletState.pending} ambiguous={walletState.ambiguous?.kind === 'reverse'} onClose={() => setDialog(null)} onClearAmbiguous={walletState.clearAmbiguous} onRetry={walletState.retryAmbiguous} onSubmit={walletState.reverseEvent} />}
    {dialog && typeof dialog === 'object' && 'rename' in dialog && <RenameWalletDialog locale={locale} wallet={dialog.rename} pending={walletState.pending} ambiguous={walletState.ambiguous?.kind === 'rename'} onClose={() => setDialog(null)} onClearAmbiguous={walletState.clearAmbiguous} onRetry={walletState.retryAmbiguous} onSubmit={walletState.renameWallet} />}
    {dialog && typeof dialog === 'object' && 'archive' in dialog && <ArchiveWalletDialog locale={locale} wallet={dialog.archive} pending={walletState.pending} ambiguous={walletState.ambiguous?.kind === 'archive'} onClose={() => setDialog(null)} onClearAmbiguous={walletState.clearAmbiguous} onRetry={walletState.retryAmbiguous} onSubmit={walletState.archiveWallet} />}
    {dialog && typeof dialog === 'object' && 'restore' in dialog && <RestoreWalletDialog locale={locale} wallet={dialog.restore} pending={walletState.pending} ambiguous={walletState.ambiguous?.kind === 'restore'} onClose={() => setDialog(null)} onClearAmbiguous={walletState.clearAmbiguous} onRetry={walletState.retryAmbiguous} onSubmit={walletState.restoreWallet} />}
  </section>;
}
