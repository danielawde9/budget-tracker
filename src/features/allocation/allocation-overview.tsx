import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import { AllocationBars } from './allocation-bars.js';
import type { AllocationGroupRow, AllocationMonthState } from './types.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

export interface AllocationOverviewProps {
  locale: Locale;
  currency: Currency;
  monthState: AllocationMonthState;
  onDrilldown?: (row: AllocationGroupRow) => void;
  onEdit(): void;
}

/** Read-only reconciliation view: database-derived money only, never a new
 * actuals calculator over the loaded wallet journal. */
export function AllocationOverview(props: AllocationOverviewProps) {
  const { locale, currency, monthState } = props;
  const leftToAllocate = monthState.leftToAllocateMinor;
  const overallocated = leftToAllocate !== null && BigInt(leftToAllocate) < 0n;

  return (
    <section className="alloc-overview" aria-label={t(locale, 'Allocation overview', 'نظرة عامة على التخصيص')}>
      <div className="alloc-row">
        <h2 className="alloc-heading">{t(locale, 'Allocation', 'التخصيص')}</h2>
        <button type="button" className="cr-button" onClick={props.onEdit}>
          {monthState.hasPlan ? t(locale, 'Edit', 'تعديل') : t(locale, 'Set up', 'إعداد')}
        </button>
      </div>

      {monthState.childPlanChanged ? (
        <div className="alloc-stale-banner" role="status">
          <span>{t(locale,
            'A saved target changed since this plan was published. Review before relying on these numbers.',
            'تغيّر هدف محفوظ منذ نشر هذه الخطة. راجع الأرقام قبل الاعتماد عليها.')}</span>
        </div>
      ) : null}

      <div className="alloc-metrics">
        <div className="alloc-metric">
          <span className="alloc-label-muted">{t(locale, 'Planned income', 'الدخل المخطط')}</span>
          <bdi className="alloc-metric-value">
            {monthState.plannedIncomeMinor !== null
              ? formatMinorAmount(monthState.plannedIncomeMinor, currency, locale)
              : t(locale, 'No target', 'بدون هدف')}
          </bdi>
        </div>
        <div className="alloc-metric">
          <span className="alloc-label-muted">{t(locale, 'Received income', 'الدخل المستلم')}</span>
          <bdi className="alloc-metric-value">{formatMinorAmount(monthState.actualIncomeMinor, currency, locale)}</bdi>
        </div>
        <div className="alloc-metric">
          <span className="alloc-label-muted">{t(locale, 'Spent', 'المصروف')}</span>
          <bdi className="alloc-metric-value">{formatMinorAmount(monthState.expenseMinor, currency, locale)}</bdi>
        </div>
        <div className="alloc-metric">
          <span className="alloc-label-muted">{t(locale, 'Income after spending', 'الدخل بعد الإنفاق')}</span>
          <bdi className="alloc-metric-value">{formatMinorAmount(monthState.incomeAfterSpendingMinor, currency, locale)}</bdi>
        </div>
        <div className="alloc-metric">
          <span className="alloc-label-muted">{t(locale, 'Debt paid', 'الدين المسدد')}</span>
          <bdi className="alloc-metric-value">{formatMinorAmount(monthState.ownDebtPaidMinor, currency, locale)}</bdi>
        </div>
        {leftToAllocate !== null ? (
          <div className="alloc-metric">
            <span className="alloc-label-muted">
              {overallocated ? t(locale, 'Overallocated', 'تجاوز التخصيص') : t(locale, 'Left to allocate', 'المتبقي للتخصيص')}
            </span>
            <bdi className={overallocated ? 'alloc-metric-value alloc-danger-text' : 'alloc-metric-value'}>
              {formatMinorAmount(leftToAllocate, currency, locale)}
            </bdi>
          </div>
        ) : null}
      </div>

      {!monthState.hasPlan ? (
        <p>{t(locale, 'No allocation plan for this month yet.', 'لا توجد خطة تخصيص لهذا الشهر بعد.')}</p>
      ) : null}
      {monthState.groups.length > 0 ? (
        <AllocationBars
          locale={locale}
          currency={currency}
          monthHasPlan={monthState.hasPlan}
          rows={monthState.groups}
          onDrilldown={props.onDrilldown}
        />
      ) : null}
    </section>
  );
}
