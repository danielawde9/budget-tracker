import { useState } from 'react';

import type { CategoriesGateway } from '../categories/types.js';
import { useCategories } from '../categories/use-categories.js';
import { localizeCategoryError } from '../categories/errors.js';
import type { Locale } from '../loans/types.js';
import { CorrectionDialog } from './correction-dialog.js';
import { formatMinorAmount } from './money.js';
import { TransactionDialog } from './transaction-dialog.js';
import type { JournalEvent, JournalEventKind, WalletsGateway } from './types.js';
import { useWallets } from './use-wallets.js';
import { WalletDialog } from './wallet-dialog.js';

interface WalletsPageProps {
  gateway: WalletsGateway;
  categoriesGateway?: CategoriesGateway;
  spaceId: string;
  locale?: Locale;
  onSpaceUnavailable(): void;
  onOpenLoans(): void;
}

type OpenDialog = 'wallet' | 'transaction' | { correction: JournalEvent } | null;
const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

function eventLabel(locale: Locale, kind: JournalEventKind): string {
  const labels = {
    opening_balance: ['Opening balance', 'رصيد افتتاحي'], income: ['Income', 'دخل'], expense: ['Expense', 'مصروف'], transfer: ['Transfer', 'تحويل'],
    loan_opening: ['Loan opening', 'رصيد قرض افتتاحي'], loan_lend: ['Loan payment', 'دفع قرض'], loan_borrow: ['Borrowed funds', 'أموال مقترضة'],
    loan_receive_repayment: ['Loan repayment received', 'دفعة قرض مستلمة'], loan_repay_borrowing: ['Loan repayment paid', 'دفعة قرض مدفوعة'], reversal: ['Reversal', 'قيد عكسي'],
  } as const;
  return labels[kind][locale === 'ar' ? 1 : 0];
}

const generalKinds = new Set<JournalEventKind>(['opening_balance', 'income', 'expense', 'transfer']);

const emptyCategoriesGateway: CategoriesGateway = {
  listCategories: async () => ({ categories: [], nextCursor: null }),
  createCategory: async () => ({}),
  archiveCategory: async () => ({}),
  getCommandResult: async () => null,
  recordCategorizedEvent: async () => ({}),
  findCategorizedEventByRequestId: async () => null,
  resolveEventCategories: async () => [],
};

export function WalletsPage({ gateway, categoriesGateway, spaceId, locale = 'en', onSpaceUnavailable, onOpenLoans }: WalletsPageProps) {
  const categoryState = useCategories(categoriesGateway ?? emptyCategoriesGateway, spaceId, onSpaceUnavailable);
  const walletState = useWallets(gateway, spaceId, onSpaceUnavailable, undefined, categoriesGateway);
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
  const activeCategories = [...categoryState.incomeCategories, ...categoryState.expenseCategories];

  return <section className="wallets-workspace">
    <header className="topbar wallets-topbar">
      <div><span className="brand">{t(locale, 'Wallet journal', 'سجل المحافظ')}</span><h1>{t(locale, 'Wallets', 'المحافظ')}</h1><p>{t(locale, 'See server-derived balances, record wallet activity, and correct history with linked reversals.', 'اطّلع على الأرصدة المشتقة من الخادم، وسجّل حركة المحافظ، وصحّح السجل بقيود عكسية مرتبطة.')}</p></div>
      <div className="wallet-actions"><button type="button" className="button-secondary" onClick={() => setDialog('wallet')}>{t(locale, 'New wallet', 'محفظة جديدة')}</button><button type="button" disabled={walletState.wallets.length === 0 || walletState.status !== 'ready'} onClick={() => setDialog('transaction')}>{t(locale, 'Add transaction', 'إضافة معاملة')}</button></div>
    </header>

    {walletState.status === 'loading' && <div className="state-panel" role="status" aria-label="Loading wallets">{t(locale, 'Loading this space’s wallets…', 'جارٍ تحميل محافظ هذه المساحة…')}</div>}
    {walletState.status === 'error' && <div className="state-panel error-notice" role="alert"><strong>{t(locale, 'Wallets are unavailable', 'المحافظ غير متاحة')}</strong><p>{journalCategoryError?.message ?? walletState.error}</p>{journalCategoryError && <p>{journalCategoryError.recovery}</p>}<button type="button" onClick={() => void walletState.refresh()}>{t(locale, 'Try again', 'المحاولة مجددًا')}</button></div>}
    {categoriesGateway && categoryState.status === 'error' && <div className="state-panel error-notice" role="alert"><strong>{t(locale, 'Categories are unavailable', 'الفئات غير متاحة')}</strong><p>{categoryError?.message}</p><p>{categoryError?.recovery}</p><button type="button" onClick={() => void categoryState.refresh()}>{t(locale, 'Try again', 'المحاولة مجددًا')}</button></div>}
    {walletState.status === 'ready' && <>
      <section className="wallet-folio" aria-labelledby="wallet-balances-heading">
        <div className="section-heading"><div><span className="section-kicker">{t(locale, 'Current space', 'المساحة الحالية')}</span><h2 id="wallet-balances-heading">{t(locale, 'Active balances', 'الأرصدة الفعالة')}</h2></div><span>{walletState.wallets.length}</span></div>
        {walletState.wallets.length === 0 ? <div className="empty wallet-empty"><strong>{t(locale, 'No wallets yet', 'لا توجد محافظ بعد')}</strong><p>{t(locale, 'Create a USD or LBP wallet to start this space’s journal.', 'أنشئ محفظة بالدولار أو الليرة لبدء سجل هذه المساحة.')}</p><button type="button" onClick={() => setDialog('wallet')}>{t(locale, 'Create first wallet', 'إنشاء أول محفظة')}</button></div> : <ul className="wallet-list">{walletState.wallets.map((wallet) => <li key={wallet.id}><div><bdi>{wallet.name}</bdi><span>{wallet.currency}</span></div><bdi className="wallet-balance">{formatMinorAmount(wallet.balanceMinor, wallet.currency, locale)}</bdi></li>)}</ul>}
      </section>

      <section className="journal" aria-labelledby="journal-heading">
        <div className="section-heading"><div><span className="section-kicker">{t(locale, 'Immutable journal', 'سجل غير قابل للتعديل')}</span><h2 id="journal-heading">{t(locale, 'Transaction history', 'سجل المعاملات')}</h2></div></div>
        {walletState.events.length === 0 ? <div className="empty"><strong>{t(locale, 'No transactions yet', 'لا توجد معاملات بعد')}</strong><p>{t(locale, 'Opening balances, income, expenses, and transfers will appear here.', 'ستظهر هنا الأرصدة الافتتاحية والدخل والمصروفات والتحويلات.')}</p></div> : <ol className="journal-list">{walletState.events.map((event) => {
          const label = eventLabel(locale, event.kind);
          const canCorrect = generalKinds.has(event.kind) && !event.loanLinked && !event.reversalOf && !event.reversedBy;
          return <li key={event.id} className={event.kind === 'reversal' ? 'journal-reversal' : ''}>
            <header><div><strong>{label}</strong><time dateTime={event.effectiveDate}>{event.effectiveDate}</time></div><div className="journal-state">{event.reversedBy && <span>{t(locale, 'Reversed', 'تم عكسه')}</span>}{event.reversalOf && <span>{t(locale, 'Linked reversal', 'قيد عكسي مرتبط')}</span>}{event.loanLinked && <span>{t(locale, 'Loan-linked', 'مرتبط بقرض')}</span>}</div></header>
            {categoriesGateway && (event.category || event.kind === 'income' || event.kind === 'expense') && <div className="journal-category"><span>{t(locale, 'Category', 'الفئة')}</span> <bdi>{event.category ? (locale === 'ar' ? event.category.nameAr ?? event.category.nameEn : event.category.nameEn ?? event.category.nameAr) : t(locale, 'Uncategorized', 'غير مصنّف')}</bdi>{event.category?.archivedAt && <small>{t(locale, 'Archived', 'مؤرشفة')}</small>}</div>}
            <ul>{event.movements.map((movement) => <li key={`${event.id}-${movement.walletId}`}><bdi>{movement.walletName}</bdi><bdi className={BigInt(movement.amountMinor) < 0n ? 'amount-negative' : 'amount-positive'}>{formatMinorAmount(movement.amountMinor, movement.currency, locale)}</bdi></li>)}</ul>
            <footer>{canCorrect && <button type="button" className="text-button" onClick={() => setDialog({ correction: event })}>{t(locale, `Correct ${label.toLowerCase()}`, `تصحيح ${label}`)}</button>}{event.loanLinked && <button type="button" className="text-button" onClick={onOpenLoans}>{t(locale, 'Manage in Loans', 'الإدارة في القروض')}</button>}</footer>
          </li>;
        })}</ol>}
        {walletState.nextCursor && !walletState.historyPaginationError && <button type="button" className="button-secondary load-more" disabled={walletState.loadingMore} onClick={() => void walletState.loadMore()}>{walletState.loadingMore ? t(locale, 'Loading…', 'جارٍ التحميل…') : t(locale, 'Load older entries', 'تحميل قيود أقدم')}</button>}
        {walletState.historyPaginationError && <div className="state-panel error-notice" role="alert"><strong>{t(locale, 'Older entries could not be loaded', 'تعذّر تحميل القيود الأقدم')}</strong><p>{historyPaginationCategoryError?.message ?? walletState.historyPaginationError.error}</p>{historyPaginationCategoryError && <p>{historyPaginationCategoryError.recovery}</p>}<button type="button" disabled={walletState.loadingMore} onClick={() => void walletState.loadMore()}>{walletState.loadingMore ? t(locale, 'Loading…', 'جارٍ التحميل…') : t(locale, 'Retry loading older entries', 'إعادة تحميل القيود الأقدم')}</button></div>}
      </section>
    </>}

    {dialog === 'wallet' && <WalletDialog locale={locale} pending={walletState.pending} onClose={() => setDialog(null)} onSubmit={walletState.createWallet} />}
    {dialog === 'transaction' && <TransactionDialog locale={locale} wallets={walletState.wallets} categories={activeCategories} categoryNextCursors={{ income: categoryState.incomeNextCursor, expense: categoryState.expenseNextCursor }} categoryLoadingMore={categoryState.loadingMore} categoryPaginationError={categoryPaginationError} onLoadMoreCategories={categoryState.loadMore} pending={walletState.pending} ambiguous={walletState.ambiguous?.kind === 'record'} onClose={() => setDialog(null)} onClearAmbiguous={walletState.clearAmbiguous} onRetry={walletState.retryAmbiguous} onRefresh={walletState.recoverRefresh} onSubmit={walletState.recordEvent} />}
    {dialog && typeof dialog === 'object' && <CorrectionDialog locale={locale} event={dialog.correction} pending={walletState.pending} ambiguous={walletState.ambiguous?.kind === 'reverse'} onClose={() => setDialog(null)} onClearAmbiguous={walletState.clearAmbiguous} onRetry={walletState.retryAmbiguous} onSubmit={walletState.reverseEvent} />}
  </section>;
}
