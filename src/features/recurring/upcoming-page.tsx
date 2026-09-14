import { useState } from 'react';
import type { Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import { OccurrenceDetail, occurrenceBucket, occurrenceBucketLabel, type OccurrenceBucket } from './occurrence-detail.js';
import { ScheduleEditor } from './schedule-editor.js';
import { settlementProgress } from './settlement-progress.js';
import type { RecurringState } from './use-recurring.js';
import { SkeletonStatus } from '../control-room/skeletons.js';

interface UpcomingPageProps {
  locale: Locale;
  recurring: RecurringState;
  /** The same bounded window `useRecurring` was constructed with -- reused
   * verbatim for the explicit "Refresh occurrences" materialize call so the
   * button never silently generates a different range than the one on
   * screen. */
  fromDate: string;
  toDate: string;
}

type FilterValue = 'all' | OccurrenceBucket;

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

const FILTERS: readonly FilterValue[] = ['all', 'due', 'overdue', 'partial', 'upcoming', 'paid', 'skipped'];

function filterLabel(locale: Locale, filter: FilterValue): string {
  if (filter === 'all') return t(locale, 'All', 'الكل');
  return occurrenceBucketLabel(locale, filter);
}

function kindLabel(locale: Locale, kind: 'income' | 'expense' | 'debt_payment'): string {
  if (kind === 'income') return t(locale, 'Income', 'دخل');
  if (kind === 'debt_payment') return t(locale, 'Debt payment', 'سداد دين');
  return t(locale, 'Expense', 'مصروف');
}

/** The full occurrence list as one accessible table -- an exact-value table
 * with a per-row bar-chart equivalent, matching `allocation-bars.tsx`'s own
 * shape (task 08, the closest chart/bars precedent) rather than goals'
 * single-progress-bar-per-entity shape, since this screen's natural unit is
 * a *list* of many occurrences, each with its own expected/settled reading.
 * Every "Review" button is this table's own labelled drilldown into
 * `OccurrenceDetail`. */
export function UpcomingPage(props: UpcomingPageProps) {
  const [filter, setFilter] = useState<FilterValue>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const recurring = props.recurring;

  if (selectedId) {
    return <OccurrenceDetail locale={props.locale} recurring={recurring} occurrenceId={selectedId} onBack={() => setSelectedId(null)} />;
  }

  const rows = recurring.page.rows;
  const filteredRows = rows.filter((row) => filter === 'all' || occurrenceBucket(row) === filter);
  const busy = recurring.status === 'saving';

  // No own landmark region here -- the route wiring's `UpcomingBillsSection`
  // already supplies one ("Upcoming bills"), matching `AllocationSetup`'s
  // own convention (its `AllocationCurrencySection` wrapper owns the
  // region), not goals' (whose per-currency split needs the inner
  // `GoalsPage` region distinctly named per currency).
  return <div className="rec-page">
    <div className="rec-row">
      <h2 className="rec-heading">{t(props.locale, 'Upcoming bills', 'الفواتير القادمة')}</h2>
      <div className="rec-row">
        <button type="button" className="cr-button" disabled={busy}
          onClick={() => void recurring.materialize({ fromDate: props.fromDate, toDate: props.toDate })}>
          {t(props.locale, 'Refresh occurrences', 'تحديث الدفعات')}
        </button>
        <button type="button" className="cr-button" onClick={() => setCreating(true)}>{t(props.locale, 'New schedule', 'جدول جديد')}</button>
      </div>
    </div>

    <div className="rec-row rec-filter-tabs" role="tablist" aria-label={t(props.locale, 'Filter occurrences', 'تصفية الدفعات')}>
      {FILTERS.map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value}
        className="cr-button" onClick={() => setFilter(value)}>{filterLabel(props.locale, value)}</button>)}
    </div>

    {recurring.status === 'loading' && <>
      <SkeletonStatus locale={props.locale} />
      <div className="rec-skeleton-rows" aria-hidden="true">
        <span className="cr-skeleton cr-skeleton--row" /><span className="cr-skeleton cr-skeleton--row" /><span className="cr-skeleton cr-skeleton--row" />
      </div>
    </>}
    {recurring.status === 'error' && <div className="cr-card" role="alert">
      <p>{recurring.error?.message}</p>
      <p><small>{recurring.error?.recovery}</small></p>
      <button type="button" className="cr-button" onClick={() => void recurring.refresh()}>{t(props.locale, 'Retry', 'إعادة المحاولة')}</button>
    </div>}
    {recurring.status === 'accepted-refresh-pending' && <div className="cr-card" role="alert">
      <p>{t(props.locale, 'Your change was saved, but the list could not refresh.', 'تم حفظ تغييرك، لكن تعذر تحديث القائمة.')}</p>
      <button type="button" className="cr-button" onClick={() => void recurring.refresh()}>{t(props.locale, 'Refresh', 'تحديث')}</button>
    </div>}
    {recurring.status === 'ambiguous' && <div className="cr-card" role="alert">
      <p>{t(props.locale, 'The result of the last command is still unknown.', 'نتيجة الأمر الأخير ما زالت غير معروفة.')}</p>
      <button type="button" className="cr-button" onClick={() => void recurring.retryAmbiguous()}>{t(props.locale, 'Check again', 'تحقق مرة أخرى')}</button>
      <button type="button" className="button-secondary" onClick={recurring.clearAmbiguous}>{t(props.locale, 'Dismiss', 'تجاهل')}</button>
    </div>}

    {(recurring.status === 'ready' || recurring.status === 'saving' || recurring.status === 'accepted-refresh-pending' || recurring.status === 'ambiguous') && (
      filteredRows.length === 0
        ? <p className="rec-label-muted">{t(props.locale, 'No occurrences in this view yet. Try Refresh occurrences, or widen the filter.', 'لا توجد دفعات في هذا العرض بعد. جرّب تحديث الدفعات أو توسيع عامل التصفية.')}</p>
        : <div className="rec-bars">
          <table className="rec-bars-table">
            <caption className="rec-visually-hidden">{t(props.locale, 'Upcoming bills: expected versus settled', 'الفواتير القادمة: المتوقع مقابل المُسدَّد')}</caption>
            <thead><tr>
              <th scope="col">{t(props.locale, 'Bill', 'الفاتورة')}</th>
              <th scope="col">{t(props.locale, 'Due', 'الاستحقاق')}</th>
              <th scope="col">{t(props.locale, 'Status', 'الحالة')}</th>
              <th scope="col">{t(props.locale, 'Expected', 'المتوقع')}</th>
              <th scope="col">{t(props.locale, 'Remaining', 'المتبقي')}</th>
              <th scope="col">{t(props.locale, 'Progress', 'التقدم')}</th>
              <th scope="col"><span className="rec-visually-hidden">{t(props.locale, 'Actions', 'الإجراءات')}</span></th>
            </tr></thead>
            <tbody>
              {filteredRows.map((row) => {
                const name = props.locale === 'ar' ? (row.nameAr ?? row.nameEn) : (row.nameEn ?? row.nameAr);
                const bucket = occurrenceBucket(row);
                const { hasTarget, percent, over, overageMinor } = settlementProgress(row.expectedMinor, row.settledMinor);
                return <tr key={row.id} className="rec-bar-row">
                  <th scope="row" className="rec-bar-label">
                    <bdi>{name}</bdi>
                    <span className="rec-label-muted">{' '}{kindLabel(props.locale, row.kind)}</span>
                  </th>
                  <td data-label={t(props.locale, 'Due', 'الاستحقاق')}>{row.dueDate}</td>
                  <td data-label={t(props.locale, 'Status', 'الحالة')}>
                    <span className={`rec-badge rec-badge-${bucket}`}>{occurrenceBucketLabel(props.locale, bucket)}</span>
                  </td>
                  <td data-label={t(props.locale, 'Expected', 'المتوقع')}><bdi>{formatMinorAmount(row.expectedMinor, row.currency, props.locale)}</bdi></td>
                  <td data-label={t(props.locale, 'Remaining', 'المتبقي')}><bdi>{formatMinorAmount(row.remainingMinor, row.currency, props.locale)}</bdi></td>
                  <td className="rec-bar-visual">
                    {hasTarget && <div className="rec-progress" data-over={over ? 'true' : undefined} aria-hidden="true"><span style={{ inlineSize: `${percent}%` }} /></div>}
                    {over && overageMinor && <span className="rec-overage-text">+<bdi>{formatMinorAmount(overageMinor, row.currency, props.locale)}</bdi></span>}
                  </td>
                  <td>
                    <button type="button" className="cr-button rec-drilldown-button"
                      aria-label={`${t(props.locale, 'Review', 'مراجعة')} ${name ?? ''}`}
                      onClick={() => setSelectedId(row.id)}>
                      {t(props.locale, 'Review', 'مراجعة')}
                    </button>
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
    )}

    {creating && <ScheduleEditor locale={props.locale}
      pending={recurring.pending} ambiguous={recurring.ambiguous !== null}
      onClose={() => setCreating(false)} onClearAmbiguous={recurring.clearAmbiguous} onRetry={recurring.retryAmbiguous}
      onSave={recurring.saveSchedule} />}
  </div>;
}
