import { translate } from '../../i18n.js';
import { formatMinorAmount } from './money.js';
import type { CurrencySummary, Loan, Locale } from './types.js';

function activeLoanCopy(count: number, locale: Locale): string {
  if (locale === 'ar') {
    if (count === 0) return 'لا قروض نشطة';
    if (count === 1) return 'قرض نشط واحد';
    if (count === 2) return 'قرضان نشطان';
    return `${count} قروض نشطة`;
  }
  return `${count} active ${count === 1 ? 'loan' : 'loans'}`;
}

export function LoanSummary({ summaries, loans, locale }: { summaries: readonly CurrencySummary[]; loans: readonly Loan[]; locale: Locale }) {
  const metrics = [
    ['owedToMe', 'owedToMeMinor'], ['iOweTotal', 'iOweMinor'], ['due', 'dueAmountMinor'],
    ['target', 'targetMinor'], ['paid', 'actualRepaymentMinor'], ['reserved', 'remainingReservationMinor'],
    ['expected', 'expectedCollectionMinor'],
  ] as const;

  return (
    <section className="ln-summary" aria-label={locale === 'ar' ? 'ملخص القروض حسب العملة' : 'Loans summary by currency'}>
      {summaries.map((summary) => (
        <article className="ln-summary-card" data-testid={`summary-${summary.currency}`} key={summary.currency}>
          <h2 className="ln-currency"><bdi>{summary.currency}</bdi></h2>
          <dl className="ln-summary-metrics ln-summary-highlights">
            {metrics.slice(0, 3).map(([label, field], index) => (
              <div className="ln-summary-metric" key={field}>
                <dt>{translate(locale, label)}</dt>
                <dd><bdi>{formatMinorAmount(summary[field], summary.currency, locale)}</bdi></dd>
                {index < 2 ? <small className="cr-helper">{activeLoanCopy(loans.filter((loan) => loan.currency === summary.currency && loan.status !== 'settled' && loan.direction === (index === 0 ? 'they_owe_me' : 'i_owe_them')).length, locale)}</small> : null}
              </div>
            ))}
          </dl>
          <details className="ln-summary-more">
            <summary>{locale === 'ar' ? 'مزيد من إجماليات القروض' : 'More loan totals'}</summary>
            <dl className="ln-summary-metrics ln-summary-details">
              {metrics.slice(3).map(([label, field]) => (
                <div className="ln-summary-metric" key={field}>
                  <dt>{translate(locale, label)}</dt>
                  <dd><bdi>{formatMinorAmount(summary[field], summary.currency, locale)}</bdi></dd>
                </div>
              ))}
            </dl>
          </details>
        </article>
      ))}
    </section>
  );
}
