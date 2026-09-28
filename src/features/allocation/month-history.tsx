import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import type { AllocationHistoryRow } from './types.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

export interface MonthHistoryProps {
  readonly locale: Locale;
  readonly currency: Currency;
  readonly month: string;
  readonly status: 'loading' | 'ready' | 'error';
  readonly rows: readonly AllocationHistoryRow[];
}

/** Read-only list of this month's saved allocation snapshots. Database-derived
 * money only; nothing here recomputes a total from the wallet journal. */
export function MonthHistory(props: MonthHistoryProps) {
  const { locale } = props;
  return (
    <section className="mt-history" aria-label={t(locale, 'Saved versions', 'النسخ المحفوظة')}>
      <h3 className="mt-history-title">{t(locale, 'Saved versions', 'النسخ المحفوظة')}</h3>
      {props.status === 'loading' ? (
        <p className="cr-helper">{t(locale, 'Loading saved versions…', 'جارٍ تحميل النسخ المحفوظة…')}</p>
      ) : null}
      {props.status === 'error' ? (
        <p className="cr-helper">{t(locale, 'Could not load saved versions.', 'تعذر تحميل النسخ المحفوظة.')}</p>
      ) : null}
      {props.status === 'ready' && props.rows.length === 0 ? (
        <p className="cr-helper">{t(locale, 'No saved versions for this month yet.', 'لا توجد نسخ محفوظة لهذا الشهر بعد.')}</p>
      ) : null}
      {props.status === 'ready' && props.rows.length > 0 ? (
        <ul className="mt-history-list">
          {props.rows.map((row) => (
            <li key={row.snapshotId} className="mt-history-row">
              <span className="mt-history-label">{t(locale, 'Planned income', 'الدخل المخطط')}</span>
              <bdi className="mt-history-amount">{formatMinorAmount(row.plannedIncomeMinor, props.currency, locale)}</bdi>
              <span className="mt-history-meta">{row.createdAt.slice(0, 10)} · #{row.snapshotId}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
