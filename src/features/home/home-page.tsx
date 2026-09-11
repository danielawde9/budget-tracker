import type { Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import type { JournalEvent, JournalEventKind, WalletProjection } from '../wallets/types.js';

interface HomePageProps {
  locale: Locale;
  wallets: readonly WalletProjection[];
  recentEvents: readonly JournalEvent[];
  onOpenWallets(): void;
  onRecordTransaction(): void;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

function eventLabel(locale: Locale, kind: JournalEventKind): string {
  const labels = {
    opening_balance: ['Opening balance', 'رصيد افتتاحي'], income: ['Income', 'دخل'], expense: ['Expense', 'مصروف'], transfer: ['Transfer', 'تحويل'],
    loan_opening: ['Loan opening', 'رصيد قرض افتتاحي'], loan_lend: ['Loan payment', 'دفع قرض'], loan_borrow: ['Borrowed funds', 'أموال مقترضة'],
    loan_receive_repayment: ['Loan repayment received', 'دفعة قرض مستلمة'], loan_repay_borrowing: ['Loan repayment paid', 'دفعة قرض مدفوعة'], reversal: ['Undo', 'تراجع'],
  } as const;
  return labels[kind][locale === 'ar' ? 1 : 0];
}

export function HomePage({ locale, wallets, recentEvents, onOpenWallets, onRecordTransaction }: HomePageProps) {
  const hasWallets = wallets.length > 0;
  return <section className="home-workspace">
    <header className="topbar home-topbar">
      <div><span className="brand">{t(locale, 'Financial workspace', 'مساحة العمل المالية')}</span><h1>{t(locale, 'Welcome back', 'مرحبًا بعودتك')}</h1><p>{t(locale, 'Your active balances and latest ledger activity.', 'أرصدتك الفعالة وأحدث نشاطات الدفتر.')}</p></div>
      <div className="wallet-actions"><button type="button" className="button-secondary" onClick={onOpenWallets}>{t(locale, 'View wallets', 'عرض المحافظ')}</button><button type="button" disabled={!hasWallets} onClick={onRecordTransaction}>{t(locale, 'Record transaction', 'تسجيل معاملة')}</button></div>
    </header>
    {!hasWallets ? <div className="empty home-empty"><strong>{t(locale, 'Create your first wallet to start tracking this space.', 'أنشئ محفظتك الأولى لبدء متابعة هذه المساحة.')}</strong><button type="button" onClick={onOpenWallets}>{t(locale, 'Create a wallet', 'إنشاء محفظة')}</button><p>{t(locale, 'Create an active wallet before recording a transaction.', 'أنشئ محفظة فعالة قبل تسجيل معاملة.')}</p></div> : <>
      <section className="wallet-folio" aria-labelledby="home-balances-heading">
        <div className="section-heading"><div><span className="section-kicker">{t(locale, 'Current space', 'المساحة الحالية')}</span><h2 id="home-balances-heading">{t(locale, 'Active balances', 'الأرصدة الفعالة')}</h2></div><span>{wallets.length}</span></div>
        <ul className="wallet-list">{wallets.map((wallet) => <li key={wallet.id}><div><bdi>{wallet.name}</bdi><span>{wallet.currency}</span></div><bdi className="wallet-balance">{formatMinorAmount(wallet.balanceMinor, wallet.currency, locale)}</bdi></li>)}</ul>
      </section>
      <section className="journal" aria-labelledby="recent-events-heading"><div className="section-heading"><div><span className="section-kicker">{t(locale, 'Immutable journal', 'سجل غير قابل للتعديل')}</span><h2 id="recent-events-heading">{t(locale, 'Recent activity', 'النشاط الأخير')}</h2></div></div>
        {recentEvents.length === 0 ? <div className="empty"><strong>{t(locale, 'No transactions yet', 'لا توجد معاملات بعد')}</strong></div> : <ol className="journal-list">{recentEvents.map((event) => <li key={event.id}><header><div><strong>{eventLabel(locale, event.kind)}</strong><time dateTime={event.effectiveDate}>{event.effectiveDate}</time></div></header><ul>{event.movements.map((movement) => <li key={`${event.id}-${movement.walletId}`}><bdi>{movement.walletName}</bdi><bdi>{formatMinorAmount(movement.amountMinor, movement.currency, locale)}</bdi></li>)}</ul></li>)}</ol>}
      </section>
    </>}
  </section>;
}
