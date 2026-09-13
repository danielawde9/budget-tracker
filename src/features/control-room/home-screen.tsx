import type { ReactNode } from 'react';
import type { MonthlyCashSummary } from '../reports/types.js';
import type { CategoryBudgetRow } from '../insights/types.js';
import type { Currency, Locale, SpaceKind } from '../loans/types.js';
import { formatMinorAmount, sumMinorAmounts } from '../wallets/money.js';
import type { JournalEvent, JournalEventKind } from '../wallets/types.js';
import { HomeSkeleton } from './skeletons.js';

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

export function eventLabel(event: JournalEvent, locale: Locale): string {
  if (event.payeeName?.trim()) return event.payeeName.trim();
  const categoryName = locale === 'ar' ? event.category?.nameAr : event.category?.nameEn;
  if (categoryName?.trim()) return categoryName.trim();
  const kind = KIND_LABELS[event.kind];
  return t(locale, kind?.en ?? event.kind, kind?.ar ?? event.kind);
}

function eventNet(event: JournalEvent): { currency: Currency; amountMinor: string } | null {
  const movement = event.movements[0];
  if (!movement) return null;
  return { currency: movement.currency, amountMinor: sumMinorAmounts(event.movements.map((m) => m.amountMinor)) };
}

export interface HomeScreenProps {
  locale: Locale;
  spaceKind: SpaceKind;
  month: string; // YYYY-MM-01
  onMonthChange(month: string): void;
  onRecord(): void;
  totals: readonly { currency: Currency; balanceMinor: string }[];
  budgets: readonly CategoryBudgetRow[];
  trend: readonly MonthlyCashSummary[];
  dataStatus: 'loading' | 'ready' | 'error';
  dataError: string | null;
  onRetryLoad(): void;
  loansOutstanding: readonly { loanId: string; personName: string; currency: Currency; outstandingMinor: string }[];
  recentEvents: readonly JournalEvent[];
}

function BudgetCard({ budgets, locale }: { budgets: readonly CategoryBudgetRow[]; locale: Locale }) {
  return (
    <section className="cr-card" aria-label={t(locale, 'Budget vs actual', 'الميزانية مقابل الفعلي')}>
      <div className="cr-row">
        <h2 className="cr-label">{t(locale, 'Budget vs actual', 'الميزانية مقابل الفعلي')}</h2>
      </div>
      {budgets.length === 0 ? (
        <p>{t(locale, 'No budget targets this month.', 'لا توجد أهداف ميزانية هذا الشهر.')}</p>
      ) : budgets.map((row) => {
        const name = (locale === 'ar' ? row.nameAr : row.nameEn)
          ?? t(locale, 'Uncategorized', 'غير مصنف');
        const over = row.remainingMinor !== null && BigInt(row.remainingMinor) < 0n;
        let width: number | null = null;
        if (row.budgetMinor !== null && BigInt(row.budgetMinor) > 0n) {
          const raw = (BigInt(row.actualNetMinor) * 100n) / BigInt(row.budgetMinor);
          const pct = raw < 0n ? 0n : raw;
          width = Number(pct > 100n ? 100n : pct);
        }
        return (
          <div key={`${row.categoryKey}-${row.currency}`} className="cr-journal-row">
            <div>
              <span className={over ? 'cr-warn-text' : undefined}>{name}</span>
              <div className="cr-row" style={{ fontSize: 13 }}>
                <span>{formatMinorAmount(row.actualNetMinor, row.currency, locale)}</span>
                <span className="cr-label">{row.budgetMinor !== null ? formatMinorAmount(row.budgetMinor, row.currency, locale) : ''}</span>
              </div>
              {width !== null ? (
                <div className={over ? 'cr-progress cr-progress--over' : 'cr-progress'} aria-hidden="true">
                  <span style={{ inlineSize: `${width}%` }} />
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function TrendCard({ trend, locale }: { trend: readonly MonthlyCashSummary[]; locale: Locale }) {
  if (trend.length === 0) return null;
  const maxExpense = trend.reduce((max, row) => {
    const value = BigInt(row.expenseNetMinor);
    const abs = value < 0n ? -value : value;
    return abs > max ? abs : max;
  }, 0n);
  return (
    <section className="cr-card" aria-label={t(locale, 'Monthly trend', 'الاتجاه الشهري')}>
      <h2 className="cr-label">{t(locale, 'Monthly trend', 'الاتجاه الشهري')}</h2>
      <div className="cr-bars">
        {trend.map((row) => {
          const value = BigInt(row.expenseNetMinor);
          const abs = value < 0n ? -value : value;
          const height = maxExpense > 0n ? Math.max(2, Number((abs * 100n) / maxExpense)) : 2;
          return (
            <span
              key={`${row.periodMonth}-${row.currency}`}
              data-role={row.periodRole === 'previous' ? 'previous' : 'current'}
              style={{ blockSize: `${height}%` }}
              title={`${monthLabel(row.periodMonth, locale)} · ${row.currency} · ${formatMinorAmount(row.expenseNetMinor, row.currency, locale)}`}
            />
          );
        })}
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
    <section className="cr-card" aria-label={t(locale, 'Loans', 'الديون')}>
      <h2 className="cr-label">{t(locale, 'Loans', 'الديون')}</h2>
      <p>
        {t(locale, `${loans.length} outstanding loan(s)`, `${loans.length} دين قائم`)}
      </p>
      {loans.map((loan) => (
        <div key={loan.loanId} className="cr-journal-row">
          <span>{loan.personName}</span>
          <span className="cr-amount">{formatMinorAmount(loan.outstandingMinor, loan.currency, locale)}</span>
        </div>
      ))}
      <div className="cr-row">
        <span className="cr-label">{t(locale, 'Total outstanding', 'إجمالي المتبقي')}</span>
        {[...perCurrency.entries()].map(([currency, total]) => (
          <span key={currency} className="cr-amount">{formatMinorAmount(total.toString(), currency, locale)}</span>
        ))}
      </div>
    </section>
  );
}

function RecentActivity({ events, locale, onRecord }: { events: readonly JournalEvent[]; locale: Locale; onRecord(): void }) {
  return (
    <section className="cr-card" aria-label={t(locale, 'Recent activity', 'النشاط الأخير')}>
      <div className="cr-row">
        <h2 className="cr-label">{t(locale, 'Recent activity', 'النشاط الأخير')}</h2>
        <button type="button" className="cr-button" onClick={onRecord}>{t(locale, 'Record', 'سجل')}</button>
      </div>
      {events.length === 0 ? (
        <p>{t(locale, 'No transactions yet', 'لا توجد معاملات بعد')}</p>
      ) : events.map((event) => {
        const net = eventNet(event);
        const positive = event.kind === 'income' && net !== null && BigInt(net.amountMinor) > 0n;
        const amount: ReactNode = net
          ? <span className={positive ? 'cr-positive' : undefined}>{formatMinorAmount(net.amountMinor, net.currency, locale)}</span>
          : null;
        return (
          <div key={event.id} className="cr-journal-row">
            <span>{eventLabel(event, locale)}</span>
            {amount}
          </div>
        );
      })}
    </section>
  );
}

export function HomeScreen(props: HomeScreenProps) {
  const { locale, spaceKind, month, onMonthChange } = props;
  const spaceLabel = spaceKind === 'household'
    ? t(locale, 'Household space', 'مساحة عائلية')
    : t(locale, 'Personal space', 'مساحة شخصية');
  return (
    <>
      <header className="cr-row">
        <h1>{spaceLabel}</h1>
        <label className="cr-label">
          {t(locale, 'Month', 'الشهر')}
          <select value={month} onChange={(event) => onMonthChange(event.target.value)}>
            {monthOptions(month).map((option) => (
              <option key={option} value={option}>{monthLabel(option, locale)}</option>
            ))}
          </select>
        </label>
      </header>
      {props.dataStatus === 'loading' ? (
        <HomeSkeleton locale={locale} />
      ) : (
        <>
          <section className="cr-card" aria-label={t(locale, 'Net position', 'صافي المركز')}>
            <h2 className="cr-label">{t(locale, 'Net position', 'صافي المركز')}</h2>
            {props.totals.map((total) => (
              <p key={total.currency} className="cr-amount cr-amount--hero">
                {formatMinorAmount(total.balanceMinor, total.currency, locale)}
              </p>
            ))}
            <div className="cr-chips">
              {props.totals.map((total) => (
                <span key={total.currency} className="cr-chip">{total.currency}</span>
              ))}
            </div>
          </section>
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
          <RecentActivity events={props.recentEvents.slice(0, 5)} locale={locale} onRecord={props.onRecord} />
        </>
      )}
    </>
  );
}
