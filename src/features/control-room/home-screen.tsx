import { ChartColumnIncreasing, Clock3, HandCoins, ListChecks, Wallet } from 'lucide-react';
import { CashControlSummary } from '../cash-control/cash-control-summary.js';
import type { AvailableCashSummary } from '../cash-control/types.js';
import type { CashReadSlice } from '../cash-control/use-cash-control.js';
import type { MonthlyCashSummary } from '../reports/types.js';
import type { CategoryBudgetRow } from '../insights/types.js';
import type { Currency, Locale, SpaceKind } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import type { JournalEvent, JournalEventKind } from '../wallets/types.js';
import { HomeSkeleton } from './skeletons.js';
import { PageHeader } from './page-header.js';
import './daily-layout.css';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

export const KIND_LABELS: Record<JournalEventKind, { en: string; ar: string }> = {
  opening_balance: { en: 'Opening balance', ar: 'الرصيد الافتتاحي' },
  income: { en: 'Income', ar: 'دخل' },
  expense: { en: 'Expense', ar: 'مصروف' },
  transfer: { en: 'Transfer', ar: 'تحويل' },
  loan_opening: { en: 'Loan opening', ar: 'افتتاح دين' },
  loan_lend: { en: 'Money lent', ar: 'إقراض' },
  loan_borrow: { en: 'Money borrowed', ar: 'استقراض' },
  loan_receive_repayment: { en: 'Repayment received', ar: 'استلام سداد' },
  loan_repay_borrowing: { en: 'Borrowing repaid', ar: 'سداد دين' },
  reversal: { en: 'Reversal', ar: 'عكس قيد' },
};

function monthOptions(anchor: string): string[] {
  const year = Number(anchor.slice(0, 4));
  const month = Number(anchor.slice(5, 7));
  const options: string[] = [];
  for (let offset = 11; offset >= 0; offset -= 1) {
    const date = new Date(year, month - 1 - offset, 1);
    options.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`);
  }
  return options;
}

function monthLabel(month: string, locale: Locale): string {
  const date = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-LB' : 'en-US', { month: 'long', year: 'numeric' }).format(date);
}

function dateLabel(date: string, locale: Locale): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-LB' : 'en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }).format(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1));
}

export function eventLabel(event: JournalEvent, locale: Locale): string {
  if (event.payeeName?.trim()) return event.payeeName.trim();
  const categoryName = locale === 'ar' ? event.category?.nameAr : event.category?.nameEn;
  if (categoryName?.trim()) return categoryName.trim();
  const kind = KIND_LABELS[event.kind];
  return t(locale, kind?.en ?? event.kind, kind?.ar ?? event.kind);
}
export interface HomeScreenProps {
  locale: Locale;
  spaceKind: SpaceKind;
  month: string; // YYYY-MM-01
  onMonthChange(month: string): void;
  onRecord(): void;
  onSeeAll?(): void;
  totals: readonly { currency: Currency; balanceMinor: string }[];
  budgets: readonly CategoryBudgetRow[];
  trend: readonly MonthlyCashSummary[];
  dataStatus: 'loading' | 'ready' | 'error';
  dataError: string | null;
  onRetryLoad(): void;
  loansOutstanding: readonly { loanId: string; personName: string; currency: Currency; outstandingMinor: string }[];
  recentEvents: readonly JournalEvent[];
  /** One compact "Available after commitments" reading per currency --
   * full drilldown (reservation breakdown, outlook) lives only in Plan. */
  cashControlByCurrency: readonly { currency: Currency; available: CashReadSlice<AvailableCashSummary> }[];
}

function CashControlCard({ locale, byCurrency }: { locale: Locale; byCurrency: HomeScreenProps['cashControlByCurrency'] }) {
  if (byCurrency.length === 0) return null;
  return (
    <section className="cr-card daily-home-card" aria-label={t(locale, 'Available after commitments', 'المتاح بعد الالتزامات')}>
      <div className="daily-section-heading"><ChartColumnIncreasing aria-hidden="true" size={20} /><h2>{t(locale, 'Available after commitments', 'المتاح بعد الالتزامات')}</h2></div>
      <p className="cr-helper">{t(locale, 'Cash left after everything you have already committed this month.', 'السيولة المتبقية بعد كل ما التزمت به هذا الشهر.')}</p>
      <div className="daily-metric-grid">
        {byCurrency.map((entry) => (
          <div key={entry.currency} className="daily-currency-metric">
            <span className="cr-label">{entry.currency}</span>
            <CashControlSummary locale={locale} currency={entry.currency} available={entry.available} variant="compact" />
          </div>
        ))}
      </div>
    </section>
  );
}

function BudgetCard({ budgets, locale }: { budgets: readonly CategoryBudgetRow[]; locale: Locale }) {
  return (
    <section className="cr-card daily-home-card" aria-label={t(locale, 'Budget vs actual', 'الميزانية مقابل الفعلي')}>
      <div className="daily-section-heading"><ListChecks aria-hidden="true" size={20} /><h2>{t(locale, 'Budget vs actual', 'الميزانية مقابل الفعلي')}</h2></div>
      <p className="cr-helper">{t(locale, 'How your categories are doing this month.', 'كيف تسير فئاتك هذا الشهر.')}</p>
      {budgets.length === 0 ? (
        <p>{t(locale, 'No budget targets this month.', 'لا توجد أهداف ميزانية هذا الشهر.')}</p>
      ) : budgets.map((row) => {
        const name = (locale === 'ar' ? row.nameAr : row.nameEn)
          ?? t(locale, 'Uncategorized', 'غير مصنف');
        const over = row.remainingMinor !== null && BigInt(row.remainingMinor) < 0n;
        let percent: bigint | null = null;
        if (row.budgetMinor !== null && BigInt(row.budgetMinor) > 0n) {
          const budget = BigInt(row.budgetMinor);
          const actual = BigInt(row.actualNetMinor);
          percent = actual <= 0n ? 0n : (actual * 100n + budget / 2n) / budget;
        }
        return (
          <div key={`${row.categoryKey}-${row.currency}`} className="cr-journal-row daily-budget-row">
            <div className="daily-budget-body">
              <div className="cr-row">
                <bdi className={over ? 'cr-warn-text' : undefined}>{name}</bdi>
                <span className="cr-amount"><bdi>{formatMinorAmount(row.actualNetMinor, row.currency, locale)}</bdi>{row.budgetMinor !== null ? <span className="cr-label"> / <bdi>{formatMinorAmount(row.budgetMinor, row.currency, locale)}</bdi></span> : null}</span>
              </div>
              {percent !== null ? (
                <div className="daily-budget-progress">
                  <div className={over ? 'cr-progress cr-progress--over' : 'cr-progress'} aria-hidden="true">
                    <span style={{ inlineSize: `${Number(percent > 100n ? 100n : percent)}%` }} />
                  </div>
                  <span className="cr-label">{percent > 999n ? '999+%' : `${percent}%`}</span>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function absoluteMinor(value: string): bigint {
  const amount = BigInt(value);
  return amount < 0n ? -amount : amount;
}

function TrendCurrency({ rows, currency, locale }: { rows: readonly MonthlyCashSummary[]; currency: Currency; locale: Locale }) {
  const max = rows.reduce((highest, row) => {
    const income = absoluteMinor(row.incomeNetMinor);
    const expense = absoluteMinor(row.expenseNetMinor);
    return [highest, income, expense].reduce((a, b) => a > b ? a : b);
  }, 0n);
  const height = (value: bigint) => max > 0n ? Math.max(2, Number((value * 100n) / max)) : 2;

  return (
    <div className="daily-trend-currency">
      <strong className="cr-label">{currency}</strong>
      <div className="cr-bars daily-trend-bars">
        {rows.map((row) => {
          const income = absoluteMinor(row.incomeNetMinor);
          const expense = absoluteMinor(row.expenseNetMinor);
          const label = monthLabel(row.periodMonth, locale);
          return (
            <div className="daily-trend-period" key={row.periodMonth}>
              <div className="daily-trend-pair">
                <span data-role={row.periodRole} data-series="income" role="img" aria-label={`${label} · ${currency} · ${t(locale, 'Income', 'الدخل')} ${formatMinorAmount(row.incomeNetMinor, currency, locale)}`} style={{ blockSize: `${height(income)}%` }} />
                <span data-role={row.periodRole} data-series="expense" role="img" aria-label={`${label} · ${currency} · ${t(locale, 'Expenses', 'المصروفات')} ${formatMinorAmount(expense.toString(), currency, locale)}`} style={{ blockSize: `${height(expense)}%` }} />
              </div>
              <span className="cr-label">{label}</span>
              <span className="cr-helper daily-trend-values">
                <span>{t(locale, 'In', 'دخل')} <bdi>{formatMinorAmount(income.toString(), currency, locale)}</bdi></span>
                <span>{t(locale, 'Out', 'خرج')} <bdi>{formatMinorAmount(expense.toString(), currency, locale)}</bdi></span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrendCard({ trend, locale }: { trend: readonly MonthlyCashSummary[]; locale: Locale }) {
  if (trend.length === 0) return null;
  const currencies = [...new Set(trend.map((row) => row.currency))];
  return (
    <section className="cr-card daily-home-card" aria-label={t(locale, 'Monthly trend', 'الاتجاه الشهري')}>
      <div className="daily-section-heading"><ChartColumnIncreasing aria-hidden="true" size={20} /><h2>{t(locale, 'Monthly trend', 'الاتجاه الشهري')}</h2></div>
      <p className="cr-helper">{t(locale, 'Income and expenses by month.', 'الدخل والمصروفات حسب الشهر.')}</p>
      <div className="daily-trend-legend cr-label"><span className="cr-trend-key cr-trend-key--income">{t(locale, 'Income', 'الدخل')}</span><span className="cr-trend-key cr-trend-key--expense">{t(locale, 'Expenses', 'المصروفات')}</span></div>
      <div className="daily-trend-currencies">
        {currencies.map((currency) => <TrendCurrency key={currency} currency={currency} locale={locale} rows={trend.filter((row) => row.currency === currency)} />)}
      </div>
    </section>
  );
}

function LoansCard({ loans, locale }: { loans: HomeScreenProps['loansOutstanding']; locale: Locale }) {
  if (loans.length === 0) return null;
  const perCurrency = new Map<Currency, bigint>();
  for (const loan of loans) {
    perCurrency.set(loan.currency, (perCurrency.get(loan.currency) ?? 0n) + BigInt(loan.outstandingMinor));
  }
  return (
    <section className="cr-card daily-home-card" aria-label={t(locale, 'Loans', 'الديون')}>
      <div className="daily-section-heading"><HandCoins aria-hidden="true" size={20} /><h2>{t(locale, 'Loans', 'الديون')}</h2></div>
      <p className="cr-helper">
        {t(locale, `${loans.length} outstanding loan(s)`, `${loans.length} دين قائم`)}
      </p>
      {loans.map((loan) => (
        <div key={loan.loanId} className="cr-journal-row">
          <bdi>{loan.personName}</bdi>
          <bdi className="cr-amount">{formatMinorAmount(loan.outstandingMinor, loan.currency, locale)}</bdi>
        </div>
      ))}
      <div className="cr-row">
        <span className="cr-label">{t(locale, 'Total outstanding', 'إجمالي المتبقي')}</span>
        {[...perCurrency.entries()].map(([currency, total]) => (
          <bdi key={currency} className="cr-amount">{formatMinorAmount(total.toString(), currency, locale)}</bdi>
        ))}
      </div>
    </section>
  );
}

function RecentActivity({ events, locale, onRecord, onSeeAll }: { events: readonly JournalEvent[]; locale: Locale; onRecord(): void; onSeeAll: (() => void) | undefined }) {
  return (
    <section className="cr-card daily-home-card" aria-label={t(locale, 'Recent activity', 'النشاط الأخير')}>
      <div className="cr-section-header">
        <div className="daily-section-heading"><Clock3 aria-hidden="true" size={20} /><h2>{t(locale, 'Recent activity', 'النشاط الأخير')}</h2></div>
        {events.length > 0 && onSeeAll ? <button type="button" className="text-button" onClick={onSeeAll}>{t(locale, 'See all activity', 'عرض كل النشاط')}</button> : null}
      </div>
      {events.length === 0 ? (
        <div className="daily-empty-activity"><p>{t(locale, 'No transactions yet', 'لا توجد معاملات بعد')}</p><button type="button" className="cr-button cr-button--primary" onClick={onRecord}>{t(locale, 'Record', 'سجل')}</button></div>
      ) : events.map((event) => {
        const amounts = event.movements.map((movement, index) => (
          <bdi
            key={`${event.id}-${movement.walletId}-${movement.currency}-${index}`}
            className={event.kind === 'income' && BigInt(movement.amountMinor) > 0n ? 'cr-positive' : undefined}
          >
            {formatMinorAmount(movement.amountMinor, movement.currency, locale)}
          </bdi>
        ));
        return (
          <div key={event.id} className="cr-journal-row daily-activity-row">
            <span className="cr-label">{dateLabel(event.effectiveDate, locale)}</span>
            <span className="daily-activity-label"><bdi>{eventLabel(event, locale)}</bdi><span className="cr-helper">{t(locale, KIND_LABELS[event.kind].en, KIND_LABELS[event.kind].ar)}</span></span>
            {amounts.length > 0 ? <span className="cr-journal-amounts">{amounts}</span> : null}
          </div>
        );
      })}
    </section>
  );
}

export function HomeScreen(props: HomeScreenProps) {
  const { locale, spaceKind, month, onMonthChange, onSeeAll } = props;
  const spaceLabel = spaceKind === 'household'
    ? t(locale, 'Household space', 'مساحة عائلية')
    : t(locale, 'Personal space', 'مساحة شخصية');
  return (
    <>
      <PageHeader
        title={t(locale, 'Home', 'الرئيسية')}
        subtitle={spaceLabel}
        actions={(
          <label className="cr-field">
            <span className="cr-label">{t(locale, 'Month', 'الشهر')}</span>
            <select value={month} onChange={(event) => onMonthChange(event.target.value)}>
              {monthOptions(month).map((option) => (
                <option key={option} value={option}>{monthLabel(option, locale)}</option>
              ))}
            </select>
          </label>
        )}
      />
      {props.dataStatus === 'loading' ? (
        <HomeSkeleton locale={locale} />
      ) : (
        <>
          <div className="daily-home-grid">
          <section className="cr-card daily-home-card" aria-label={t(locale, 'Wallet balances', 'أرصدة المحافظ')}>
            <div className="daily-section-heading"><Wallet aria-hidden="true" size={20} /><h2>{t(locale, 'Wallet balances', 'أرصدة المحافظ')}</h2></div>
            <p className="cr-helper">{t(locale, 'Your current cash across wallets, by currency.', 'أرصدتك الحالية في المحافظ حسب العملة.')}</p>
            <div className="daily-metric-grid">
              {props.totals.map((total) => (
                <div key={total.currency} className="daily-currency-metric"><span className="cr-label">{total.currency}</span><bdi className="cr-amount cr-amount--dashboard">{formatMinorAmount(total.balanceMinor, total.currency, locale)}</bdi></div>
              ))}
            </div>
          </section>
          <CashControlCard locale={locale} byCurrency={props.cashControlByCurrency} />
          {props.dataStatus === 'error' ? (
            <div className="cr-card" role="alert">
              <div className="cr-row">
                <span>{t(locale, 'Could not load the latest data.', 'تعذر تحميل أحدث البيانات.')}</span>
                <button type="button" className="cr-button" onClick={props.onRetryLoad}>
                  {t(locale, 'Retry', 'إعادة المحاولة')}
                </button>
              </div>
              {props.dataError ? <small>{props.dataError}</small> : null}
            </div>
          ) : null}
          <BudgetCard budgets={props.budgets} locale={locale} />
          <TrendCard trend={props.trend} locale={locale} />
          <LoansCard loans={props.loansOutstanding} locale={locale} />
          <RecentActivity events={props.recentEvents.slice(0, 5)} locale={locale} onRecord={props.onRecord} onSeeAll={onSeeAll} />
          </div>
        </>
      )}
    </>
  );
}
