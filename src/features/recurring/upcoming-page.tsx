import { useState } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import { billCount } from './bill-count.js';
import type { LinkableEventOption, LinkableEventsQuery } from './linkable-events.js';
import { MAX_PAGES, PAGE_LIMIT } from './load-all-pages.js';
import { OccurrenceDetail, occurrenceBucket, occurrenceBucketLabel, type OccurrenceBucket } from './occurrence-detail.js';
import { ScheduleEditor, type ScheduleReferenceOptions } from './schedule-editor.js';
import { settlementProgress } from './settlement-progress.js';
import type { RecurringState } from './use-recurring.js';
import { SkeletonStatus } from '../control-room/skeletons.js';

interface UpcomingPageProps {
  locale: Locale;
  currency: Currency;
  recurring: RecurringState;
  /** Inclusive window shown in the occurrence list and summary. */
  fromDate: string;
  toDate: string;
  /** Generation can retain a longer forecast horizon than the viewed month. */
  materializeFromDate?: string;
  materializeToDate?: string;
  /** Named lists for the schedule editor's reference dropdowns. */
  referenceOptions: ScheduleReferenceOptions;
  /** Planned income per currency from the monthly plan (integer-minor). */
  plannedIncomeByCurrency: Readonly<Record<Currency, string | null>>;
  /** Wallets offered by the payment dialog's 'Paying wallet' dropdown. */
  walletOptions: ReadonlyArray<{ readonly id: string; readonly name: string; readonly currency: string }>;
  /** Loads the existing wallet events the payment dialog offers for linking
   * (D4), read-only through the wallets gateway. */
  loadLinkableEvents?: (query: LinkableEventsQuery) => Promise<readonly LinkableEventOption[]>;
  /** Reverses the transaction a settlement just linked (D7). */
  onUnlink?: (eventId: string) => Promise<unknown>;
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

function windowTotals(rows: RecurringState['page']['rows'], fromDate: string, toDate: string) {
  let inflowMinor = 0n;
  let outflowMinor = 0n;
  let inflowCount = 0;
  let outflowCount = 0;
  for (const row of rows.slice(0, MAX_PAGES * PAGE_LIMIT)) {
    if (row.dueDate < fromDate || row.dueDate > toDate || row.state === 'settled' || row.state === 'skipped') continue;
    const remaining = BigInt(row.remainingMinor);
    if (remaining <= 0n) continue;
    if (row.kind === 'income') {
      inflowMinor += remaining;
      inflowCount += 1;
    } else {
      outflowMinor += remaining;
      outflowCount += 1;
    }
  }
  return { inflowMinor, outflowMinor, inflowCount, outflowCount, netMinor: inflowMinor - outflowMinor };
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
    return <OccurrenceDetail locale={props.locale} recurring={recurring} occurrenceId={selectedId} onBack={() => setSelectedId(null)} walletOptions={props.walletOptions}
      {...(props.loadLinkableEvents ? { loadLinkableEvents: props.loadLinkableEvents } : {})}
      {...(props.onUnlink ? { onUnlink: props.onUnlink } : {})} />;
  }

  const rows = recurring.page.rows.filter((row) => row.currency === props.currency && row.dueDate >= props.fromDate && row.dueDate <= props.toDate);
  const isMonthWindow = props.fromDate.endsWith('-01') && props.fromDate.slice(0, 7) === props.toDate.slice(0, 7);
  const filteredRows = rows.filter((row) => filter === 'all' || occurrenceBucket(row) === filter);
  const totals = windowTotals(rows, props.fromDate, props.toDate);
  const busy = recurring.status === 'saving';

  // No own landmark region here -- the route wiring's `UpcomingBillsSection`
  // already supplies one ("Upcoming bills"), matching `AllocationSetup`'s
  // own convention (its `AllocationCurrencySection` wrapper owns the
  // region), not goals' (whose per-currency split needs the inner
  // `GoalsPage` region distinctly named per currency).
  return <div className="rec-page">
    <div className="cr-section-header">
      <h2>{t(props.locale, 'Upcoming bills', 'الفواتير القادمة')}</h2>
      <div className="rec-actions">
        <button type="button" className="cr-button" disabled={busy}
          onClick={() => void recurring.materialize({ fromDate: props.materializeFromDate ?? props.fromDate, toDate: props.materializeToDate ?? props.toDate })}>
          {t(props.locale, 'Refresh occurrences', 'تحديث الدفعات')}
        </button>
        <button type="button" className="cr-button cr-button--primary" onClick={() => setCreating(true)}>{t(props.locale, 'New schedule', 'جدول جديد')}</button>
      </div>
    </div>

    <div className="rec-content"><div className="rec-list-panel">
      <div className="cr-chips rec-filter-tabs" role="tablist" aria-label={t(props.locale, 'Filter occurrences', 'تصفية الدفعات')}>
        {FILTERS.map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value}
          className={`cr-chip${filter === value ? ' cr-chip--active' : ''}`} onClick={() => setFilter(value)}>{filterLabel(props.locale, value)}</button>)}
      </div>

    {/* The count is the shared pager's own cap, in the locale's digits (M4). */}
    {recurring.truncated && <p className="cr-banner" role="alert">
      {t(props.locale,
        `Showing the first ${billCount(MAX_PAGES * PAGE_LIMIT, 'en')}.`,
        `تُعرض أول ${billCount(MAX_PAGES * PAGE_LIMIT, 'ar')}.`)}
    </p>}

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
      <button type="button" className="cr-button" onClick={recurring.clearAmbiguous}>{t(props.locale, 'Dismiss', 'تجاهل')}</button>
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
              <th scope="col">{t(props.locale, 'Settled', 'المُسدَّد')}</th>
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
                  <td data-label={t(props.locale, 'Settled', 'المُسدَّد')}><bdi>{formatMinorAmount(row.settledMinor, row.currency, props.locale)}</bdi></td>
                  <td data-label={t(props.locale, 'Remaining', 'المتبقي')}><bdi>{formatMinorAmount(row.remainingMinor, row.currency, props.locale)}</bdi></td>
                  <td className="rec-bar-visual">
                    {hasTarget && <div className="rec-progress" data-over={over ? 'true' : undefined} aria-hidden="true"><span style={{ inlineSize: `${percent}%` }} /></div>}
                    {hasTarget && BigInt(row.settledMinor) > 0n && <span className="rec-label-muted"><bdi>{new Intl.NumberFormat(props.locale === 'ar' ? 'ar-LB' : 'en-US', { maximumFractionDigits: 0 }).format(percent)}%</bdi> {t(props.locale, 'settled', 'مُسدَّد')}</span>}
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

    </div>
    {(recurring.status === 'ready' || recurring.status === 'saving') && <aside className="cr-card rec-window-summary" aria-label={t(props.locale, 'Window summary', 'ملخص الفترة')}>
      <h3>{isMonthWindow ? t(props.locale, 'In this month', 'خلال هذا الشهر') : t(props.locale, 'In this window', 'خلال هذه الفترة')}</h3>
      <dl>
        <div><dt><bdi>{new Intl.NumberFormat(props.locale === 'ar' ? 'ar-LB' : 'en-US').format(totals.outflowCount)}</bdi> {t(props.locale, totals.outflowCount === 1 ? 'outflow' : 'outflows', 'مدفوعات خارجة')}</dt><dd><bdi>{formatMinorAmount(totals.outflowMinor.toString(), props.currency, props.locale)}</bdi></dd></div>
        <div><dt><bdi>{new Intl.NumberFormat(props.locale === 'ar' ? 'ar-LB' : 'en-US').format(totals.inflowCount)}</bdi> {t(props.locale, totals.inflowCount === 1 ? 'inflow' : 'inflows', 'مدفوعات واردة')}</dt><dd><bdi>{formatMinorAmount(totals.inflowMinor.toString(), props.currency, props.locale)}</bdi></dd></div>
      </dl>
      <details className="rec-window-details">
        <summary>{t(props.locale, 'Net and notes', 'الصافي وملاحظات')}</summary>
        <p className="cr-helper"><bdi>{props.fromDate}</bdi> – <bdi>{props.toDate}</bdi> · {props.currency}</p>
        <p><span>{t(props.locale, 'Net', 'الصافي')}</span> <bdi>{formatMinorAmount(totals.netMinor.toString(), props.currency, props.locale)}</bdi></p>
        <p className="cr-helper">{t(props.locale, 'Unsettled scheduled amounts; these are not cash already received or paid.', 'مبالغ مجدولة لم تُسوَّ بعد؛ وليست سيولة مستلمة أو مدفوعة بالفعل.')}</p>
        {recurring.truncated && <p className="cr-helper">{t(props.locale, 'Totals include listed occurrences only.', 'تشمل المجاميع الدفعات المعروضة فقط.')}</p>}
      </details>
    </aside>}
    </div>

    {creating && <ScheduleEditor locale={props.locale}
      referenceOptions={props.referenceOptions} plannedIncomeByCurrency={props.plannedIncomeByCurrency}
      pending={recurring.pending} ambiguous={recurring.ambiguous !== null}
      onClose={() => setCreating(false)} onClearAmbiguous={recurring.clearAmbiguous} onRetry={recurring.retryAmbiguous}
      onSave={recurring.saveSchedule} />}
  </div>;
}
