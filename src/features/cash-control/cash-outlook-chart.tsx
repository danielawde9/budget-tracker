import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import { chartPercent } from './chart-ratio.js';
import type { CashOutlook, CashOutlookDay, CashOutlookScenario } from './types.js';
import type { CashReadSlice } from './use-cash-control.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

const SCENARIOS: readonly CashOutlookScenario[] = ['expected', 'no_future_income'];

function scenarioLabel(locale: Locale, scenario: CashOutlookScenario): string {
  return scenario === 'expected'
    ? t(locale, 'Expected income', 'الدخل المتوقع')
    : t(locale, 'Conservative (no future income)', 'متحفظ (بدون دخل مستقبلي)');
}

/** The bounded 0-100 visual half-width for one signed day bar, plus which
 * side of the zero baseline it belongs on. Reuses `chartPercent` with the
 * day's absolute magnitude (per the brief's own "for signed plots, call it
 * with the absolute magnitude and render on the appropriate side of zero"
 * instruction) against the widest magnitude in the visible window, so every
 * bar in the chart shares one scale. Sign is read directly from the
 * original `closingCashMinor` string, never from the clamped percent. */
function signedDayRatio(day: CashOutlookDay, scaleMinor: string): { negative: boolean; percent: number } {
  const closing = BigInt(day.closingCashMinor);
  const magnitude = closing < 0n ? (-closing).toString() : day.closingCashMinor;
  return { negative: closing < 0n, percent: chartPercent(magnitude, scaleMinor) };
}

function widestMagnitude(days: readonly CashOutlookDay[]): string {
  let widest = 0n;
  for (const day of days) {
    const closing = BigInt(day.closingCashMinor);
    const magnitude = closing < 0n ? -closing : closing;
    if (magnitude > widest) widest = magnitude;
  }
  return widest.toString();
}

interface CashOutlookChartProps {
  locale: Locale;
  currency: Currency;
  outlook: CashReadSlice<CashOutlook>;
  scenario: CashOutlookScenario;
  onScenarioChange(scenario: CashOutlookScenario): void;
}

/** The 60-day forecast: a per-day signed bar (zero baseline, an inverse
 * segment for a negative closing balance) alongside its own accessible
 * table, a scenario switch (expected vs. conservative/no-future-income),
 * the first shortfall date, and overdue items bucketed into today. This is
 * always visibly a forecast ("Expected outlook"), never the actual
 * wallet-balance figure `CashControlSummary` shows. */
export function CashOutlookChart({ locale, currency, outlook, scenario, onScenarioChange }: CashOutlookChartProps) {
  return (
    <section className="cc-outlook" aria-label={t(locale, 'Expected outlook', 'التوقع المتوقع')}>
      <div className="cc-row">
        <h3 className="cc-subheading">{t(locale, 'Expected outlook', 'التوقع المتوقع')}</h3>
        <div className="cc-row cc-scenario-tabs" role="tablist" aria-label={t(locale, 'Forecast scenario', 'سيناريو التوقع')}>
          {SCENARIOS.map((value) => (
            <button key={value} type="button" role="tab" aria-selected={scenario === value} className="cr-button"
              onClick={() => onScenarioChange(value)}>
              {scenarioLabel(locale, value)}
            </button>
          ))}
        </div>
      </div>

      {outlook.status === 'loading' && (
        <div className="cc-skeleton-rows" aria-hidden="true">
          <span className="cr-skeleton cr-skeleton--row" /><span className="cr-skeleton cr-skeleton--row" /><span className="cr-skeleton cr-skeleton--row" />
        </div>
      )}

      {outlook.status === 'error' && (
        <div className="cr-card" role="alert">
          <p>{outlook.error?.message}</p>
          <p><small>{outlook.error?.recovery}</small></p>
          <button type="button" className="cr-button" onClick={outlook.refresh}>{t(locale, 'Retry', 'إعادة المحاولة')}</button>
        </div>
      )}

      {outlook.status === 'ready' && outlook.data.state === 'incomplete' && (
        <p className="cc-label-muted">
          {t(locale, 'The forecast is incomplete for this window (materialization needed, or the overdue backlog is too large). Refresh occurrences from Upcoming bills, then reload.',
            'التوقع غير مكتمل لهذا النطاق (يلزم توليد الدفعات، أو التراكم المتأخر كبير جدًا). حدّث الدفعات من الفواتير القادمة، ثم أعد التحميل.')}
        </p>
      )}

      {outlook.status === 'ready' && outlook.data.state === 'ready' && (
        outlook.data.days.length === 0 ? (
          <p className="cc-label-muted">{t(locale, 'No forecast days in this window yet.', 'لا توجد أيام توقع في هذا النطاق بعد.')}</p>
        ) : (
          <>
            <p className="cc-label-muted">{outlook.data.assumption}</p>
            {outlook.data.overdueCount > 0 && (
              <p className="cc-danger-text">
                {t(locale, 'Overdue', 'متأخر')}: {outlook.data.overdueCount} · <bdi>{formatMinorAmount(outlook.data.overdueMinor, currency, locale)}</bdi>{' '}
                {t(locale, '(bucketed into today)', '(مُدرج ضمن اليوم)')}
              </p>
            )}
            {outlook.data.firstNegativeDate ? (
              <p className="cc-danger-text">
                {t(locale, 'First projected shortfall', 'أول عجز متوقع')}: {outlook.data.firstNegativeDate}
              </p>
            ) : (
              <p className="cc-label-muted">{t(locale, 'No shortfall projected in this window.', 'لا يوجد عجز متوقع في هذا النطاق.')}</p>
            )}
            <OutlookTable locale={locale} currency={currency} outlook={outlook.data} />
          </>
        )
      )}
    </section>
  );
}

function OutlookTable({ locale, currency, outlook }: { locale: Locale; currency: Currency; outlook: CashOutlook }) {
  const scaleMinor = widestMagnitude(outlook.days);
  const hasScale = BigInt(scaleMinor) > 0n;
  return (
    <div className="cc-bars">
      <table className="cc-outlook-table">
        <caption className="cc-visually-hidden">
          {t(locale, 'Daily forecast: opening cash, expected income, expected outflow and closing cash', 'التوقع اليومي: السيولة الافتتاحية، الدخل المتوقع، المصروف المتوقع والسيولة الختامية')}
        </caption>
        <thead><tr>
          <th scope="col">{t(locale, 'Date', 'التاريخ')}</th>
          <th scope="col">{t(locale, 'Opening cash', 'السيولة الافتتاحية')}</th>
          <th scope="col">{t(locale, 'Expected income', 'الدخل المتوقع')}</th>
          <th scope="col">{t(locale, 'Expected outflow', 'المصروف المتوقع')}</th>
          <th scope="col">{t(locale, 'Closing cash', 'السيولة الختامية')}</th>
          <th scope="col"><span className="cc-visually-hidden">{t(locale, 'Trend', 'الاتجاه')}</span></th>
        </tr></thead>
        <tbody>
          {outlook.days.map((day) => {
            const negative = BigInt(day.closingCashMinor) < 0n;
            const ratio = hasScale ? signedDayRatio(day, scaleMinor) : null;
            const isFirstNegative = outlook.firstNegativeDate === day.date;
            return (
              <tr key={day.date} className="cc-bar-row" data-first-negative={isFirstNegative ? 'true' : undefined}>
                <th scope="row" data-label={t(locale, 'Date', 'التاريخ')}>
                  {day.date}
                  {isFirstNegative && <span className="cc-badge cc-badge-negative">{t(locale, 'First shortfall', 'أول عجز')}</span>}
                </th>
                <td data-label={t(locale, 'Opening cash', 'السيولة الافتتاحية')}><bdi>{formatMinorAmount(day.openingCashMinor, currency, locale)}</bdi></td>
                <td data-label={t(locale, 'Expected income', 'الدخل المتوقع')}><bdi>{formatMinorAmount(day.expectedIncomeMinor, currency, locale)}</bdi></td>
                <td data-label={t(locale, 'Expected outflow', 'المصروف المتوقع')}><bdi>{formatMinorAmount(day.expectedOutflowMinor, currency, locale)}</bdi></td>
                <td data-label={t(locale, 'Closing cash', 'السيولة الختامية')} className={negative ? 'cc-danger-text' : undefined}>
                  <bdi>{formatMinorAmount(day.closingCashMinor, currency, locale)}</bdi>
                </td>
                <td className="cc-bar-visual">
                  {ratio && (
                    <div className="cc-signed-bar" aria-hidden="true">
                      <span className="cc-signed-bar-negative"><span style={{ inlineSize: ratio.negative ? `${ratio.percent}%` : '0%' }} /></span>
                      <span className="cc-signed-bar-zero" />
                      <span className="cc-signed-bar-positive"><span style={{ inlineSize: ratio.negative ? '0%' : `${ratio.percent}%` }} /></span>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
