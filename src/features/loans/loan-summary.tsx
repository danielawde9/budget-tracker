import { translate } from '../../i18n.js';
import { formatMinorAmount } from './money.js';
import type { CurrencySummary, Locale } from './types.js';

export function LoanSummary({ summaries, locale }: { summaries: readonly CurrencySummary[]; locale: Locale }) {
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
          <dl className="ln-summary-metrics">
            {metrics.map(([label, field]) => (
              <div className="ln-summary-metric" key={field}>
                <dt>{translate(locale, label)}</dt>
                <dd><bdi>{formatMinorAmount(summary[field], summary.currency, locale)}</bdi></dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </section>
  );
}
