import { useEffect, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Download, HandCoins, Search } from 'lucide-react';

import type { JournalCsvResult } from '../wallets/journal-csv.js';
import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import type { JournalEvent, JournalEventKind } from '../wallets/types.js';
import { KIND_LABELS, eventLabel } from './home-screen.js';
import { PageHeader } from './page-header.js';
import './daily-layout.css';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

type KindFilter = 'all' | JournalEventKind | 'exchange' | 'loans';

const LOAN_KINDS: readonly JournalEventKind[] = [
  'loan_opening',
  'loan_lend',
  'loan_borrow',
  'loan_receive_repayment',
  'loan_repay_borrowing',
];

function isMultiCurrency(event: JournalEvent): boolean {
  const currencies = new Set(event.movements.map((movement) => movement.currency));
  return currencies.size > 1;
}

function matchesFilter(event: JournalEvent, filter: KindFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'loans') return LOAN_KINDS.includes(event.kind);
  if (filter === 'exchange') return isMultiCurrency(event);
  if (filter === 'transfer') return event.kind === 'transfer' && !isMultiCurrency(event);
  return event.kind === filter;
}

function matchesDateRange(event: JournalEvent, fromDate: string, toDate: string): boolean {
  if (fromDate !== '' && event.effectiveDate < fromDate) return false;
  if (toDate !== '' && event.effectiveDate > toDate) return false;
  return true;
}

export interface JournalSearchView {
  query: string;
  events: readonly JournalEvent[];
  nextCursor: string | null;
  pending: boolean;
  loadingMore: boolean;
  error: string | null;
}

const FILTER_CHIPS: readonly { filter: KindFilter; en: string; ar: string }[] = [
  { filter: 'all', en: 'All', ar: 'الكل' },
  { filter: 'income', en: 'Income', ar: 'دخل' },
  { filter: 'expense', en: 'Expense', ar: 'مصروف' },
  { filter: 'transfer', en: 'Transfer', ar: 'تحويل' },
  { filter: 'exchange', en: 'Exchange', ar: 'صرف' },
  { filter: 'loans', en: 'Loans', ar: 'الديون' },
];

function rowLabel(event: JournalEvent, locale: Locale): string {
  if (event.reversalOf !== null) {
    return t(locale, `Reversal of ${event.reversalOf}`, `عكس قيد ${event.reversalOf}`);
  }
  return eventLabel(event, locale);
}

function entryType(event: JournalEvent, locale: Locale): string {
  if (isMultiCurrency(event)) return t(locale, 'Exchange', 'صرف');
  if (LOAN_KINDS.includes(event.kind)) return t(locale, 'Loans', 'الديون');
  return t(locale, KIND_LABELS[event.kind].en, KIND_LABELS[event.kind].ar);
}

function entryIcon(kind: JournalEventKind) {
  if (kind === 'income') return ArrowUpRight;
  if (kind === 'expense') return ArrowDownLeft;
  if (LOAN_KINDS.includes(kind)) return HandCoins;
  return ArrowLeftRight;
}

function displayDate(value: string, locale: Locale): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-LB' : 'en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }).format(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1));
}

function shownEntryTotals(events: readonly JournalEvent[]): Map<Currency, { income: bigint; expense: bigint }> {
  const totals = new Map<Currency, { income: bigint; expense: bigint }>();
  for (const event of events) {
    if (event.kind !== 'income' && event.kind !== 'expense') continue;
    for (const movement of event.movements) {
      const current = totals.get(movement.currency) ?? { income: 0n, expense: 0n };
      const amount = BigInt(movement.amountMinor);
      totals.set(movement.currency, event.kind === 'income'
        ? { ...current, income: current.income + amount }
        : { ...current, expense: current.expense + (amount < 0n ? -amount : amount) });
    }
  }
  return totals;
}

export interface JournalScreenProps {
  locale: Locale;
  events: readonly JournalEvent[];
  nextCursor: string | null;
  loadingMore: boolean;
  onLoadMore(): void;
  onReverse(eventId: string, effectiveDate: string): Promise<unknown>;
  reversePending: boolean;
  search: JournalSearchView | null;
  onSearchQueryChange(query: string): void;
  onLoadMoreSearch(): void;
  onExportCsv(): Promise<JournalCsvResult>;
}

export function JournalScreen(props: JournalScreenProps) {
  const { locale, onSearchQueryChange } = props;
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<JournalEvent | null>(null);
  const [reverseError, setReverseError] = useState<string | null>(null);
  const [exportPending, setExportPending] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [exportTruncated, setExportTruncated] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    onSearchQueryChange(query);
  }, [query, onSearchQueryChange]);

  useEffect(() => {
    if (!selected) return;
    sheetRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelected(null);
        setReverseError(null);
        openerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selected]);

  const closeSheet = () => {
    setSelected(null);
    setReverseError(null);
    openerRef.current?.focus();
  };

  const reverseSelected = async () => {
    if (!selected) return;
    setReverseError(null);
    try {
      await props.onReverse(selected.id, selected.effectiveDate);
    } catch (cause) {
      const message = cause instanceof Error && cause.message.trim() ? cause.message : t(locale, 'Unknown error.', 'خطأ غير معروف.');
      setReverseError(`${t(locale, 'Could not reverse this entry.', 'تعذر عكس هذا القيد.')} ${message}`);
    }
  };

  const runExport = async () => {
    if (exportPending) return;
    setExportPending(true);
    setExportFailed(false);
    setExportTruncated(false);
    try {
      const result = await props.onExportCsv();
      setExportTruncated(result.truncated);
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const day = result.highWaterMark?.createdAt.slice(0, 10) ?? 'empty';
      anchor.download = `journal-${day}-${locale}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportFailed(true);
    } finally {
      setExportPending(false);
    }
  };

  const trimmedQuery = query.trim();
  const searchActive = trimmedQuery !== '';
  const searchView = props.search !== null && props.search.query === trimmedQuery ? props.search : null;
  const sourceEvents = searchActive ? searchView?.events ?? [] : props.events;
  const visibleEvents = sourceEvents.filter(
    (event) => matchesFilter(event, kindFilter) && matchesDateRange(event, fromDate, toDate),
  );
  const shownTotals = shownEntryTotals(visibleEvents);
  const filtersActive = kindFilter !== 'all' || fromDate !== '' || toDate !== '';
  const clearFilters = () => {
    setKindFilter('all');
    setFromDate('');
    setToDate('');
  };
  const selectedReversible = selected !== null && selected.reversalOf === null && selected.reversedBy === null;

  return (
    <>
      <div className="daily-journal-header"><PageHeader
        title={t(locale, 'Journal', 'القيود')}
        subtitle={t(locale, 'Everything that has happened with your money.', 'كل ما حدث بأموالك.')}
        actions={<button type="button" className="cr-button cr-button--sm" disabled={exportPending} onClick={() => void runExport()}><Download aria-hidden="true" size={18} />{exportPending ? t(locale, 'Exporting…', 'جارٍ التصدير…') : t(locale, 'Export CSV', 'تصدير CSV')}</button>}
      /></div>
      {exportFailed ? (
        <div role="alert">
          <span className="cr-danger-text">
            {t(locale, 'The export was not created. Check the current space access and try again.', 'لم يتم إنشاء التصدير. تحقق من صلاحية المساحة الحالية وحاول مجددًا.')}
          </span>
        </div>
      ) : null}
      {exportTruncated ? (
        <p role="status">
          {t(locale, 'The export reached the row limit. Narrow the range and export again.', 'بلغ التصدير حد الصفوف. ضيّق النطاق وصدّر مجددًا.')}
        </p>
      ) : null}
      <section className="cr-card daily-journal-totals" aria-label={t(locale, 'Shown entry totals', 'إجماليات القيود المعروضة')}>
        <p className="cr-helper">{t(locale, 'Shown entries', 'القيود المعروضة')}</p>
        {shownTotals.size === 0 ? <p className="cr-helper">{t(locale, 'No income or expenses in the entries shown.', 'لا دخل أو مصروفات في القيود المعروضة.')}</p> : (
          <div className="daily-journal-total-grid">
            <div><span className="cr-label">{t(locale, 'Total in', 'إجمالي الدخل')}</span>{[...shownTotals.entries()].map(([currency, values]) => <bdi key={currency} className="cr-amount cr-positive">{formatMinorAmount(values.income.toString(), currency, locale)}</bdi>)}</div>
            <div><span className="cr-label">{t(locale, 'Total out', 'إجمالي المصروفات')}</span>{[...shownTotals.entries()].map(([currency, values]) => <bdi key={currency} className="cr-amount">{formatMinorAmount(values.expense.toString(), currency, locale)}</bdi>)}</div>
          </div>
        )}
      </section>
      <div className="daily-journal-filters">
      <label className="cr-field cr-journal-search">
        <span className="cr-label daily-journal-search-label">{t(locale, 'Search', 'بحث')}</span>
        <span className="daily-search-control"><Search aria-hidden="true" size={18} /><input
          type="search"
          placeholder={t(locale, 'Notes, labels, wallets…', 'ملاحظات، أسماء، محافظ…')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        /></span>
      </label>
      <div className="cr-journal-dates">
        <label className="cr-field cr-journal-date">
          <span className="cr-label">{t(locale, 'From', 'من')}</span>
          <input
            type="date"
            aria-label={t(locale, 'From date', 'من تاريخ')}
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
        </label>
        <label className="cr-field cr-journal-date">
          <span className="cr-label">{t(locale, 'To', 'إلى')}</span>
          <input
            type="date"
            aria-label={t(locale, 'To date', 'إلى تاريخ')}
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
        </label>
        {filtersActive ? (
          <button type="button" className="cr-button cr-button--sm cr-journal-clear" onClick={clearFilters}>
            {t(locale, 'Clear filters', 'مسح عوامل التصفية')}
          </button>
        ) : null}
      </div>
      </div>
      <div className="cr-toolbar">
        <div className="cr-chips" role="group" aria-label={t(locale, 'Filter by type', 'تصفية حسب النوع')}>
          {FILTER_CHIPS.map((chip) => (
            <button
              key={chip.filter}
              type="button"
              className={kindFilter === chip.filter ? 'cr-chip cr-chip--active' : 'cr-chip'}
              aria-pressed={kindFilter === chip.filter}
              onClick={() => setKindFilter(chip.filter)}
            >
              {t(locale, chip.en, chip.ar)}
            </button>
          ))}
        </div>
      </div>
      <section className={visibleEvents.length > 0 ? 'cr-card daily-journal-register daily-journal-register--filled' : 'cr-card daily-journal-register'} aria-label={t(locale, 'Journal entries', 'قيود اليومية')}>
        {visibleEvents.length > 0 ? <div className="daily-journal-columns cr-label" aria-hidden="true"><span>{t(locale, 'Date', 'التاريخ')}</span><span>{t(locale, 'Description', 'الوصف')}</span><span>{t(locale, 'Wallet', 'المحفظة')}</span><span>{t(locale, 'Type', 'النوع')}</span><span>{t(locale, 'Amount', 'المبلغ')}</span></div> : null}
        {searchActive && searchView?.pending === true && sourceEvents.length === 0 ? (
          <p role="status">{t(locale, 'Searching…', 'جارٍ البحث…')}</p>
        ) : null}
        {searchActive && searchView?.error ? (
          <div role="alert">
            <span className="cr-danger-text">
              {t(locale, 'The journal search was not accepted. Check the current space access and try again.', 'لم يتم قبول بحث القيود. تحقق من صلاحية المساحة الحالية وحاول مجددًا.')}
            </span>
          </div>
        ) : null}
        {visibleEvents.length === 0 && !(searchActive && searchView?.pending === true) ? (
          <p>{sourceEvents.length === 0 && !searchActive && props.events.length === 0
            ? t(locale, 'No journal entries yet.', 'لا توجد قيود بعد.')
            : t(locale, 'No journal entries match.', 'لا توجد قيود مطابقة.')}</p>
        ) : visibleEvents.map((event) => {
          const label = rowLabel(event, locale);
          const reversal = event.reversalOf !== null;
          const Icon = entryIcon(event.kind);
          const categoryName = locale === 'ar' ? event.category?.nameAr : event.category?.nameEn;
          return (
            <button
              key={event.id}
              type="button"
              className="cr-journal-row cr-journal-row--button daily-journal-row"
              onClick={(click) => {
                openerRef.current = click.currentTarget;
                setReverseError(null);
                setSelected(event);
              }}
            >
              <span className="daily-journal-date cr-helper">{displayDate(event.effectiveDate, locale)}</span>
              <span className="daily-journal-description"><Icon aria-hidden="true" size={18} /><span><bdi>{label}</bdi>{event.note?.trim() ? <small className="cr-helper"><bdi>{event.note.trim()}</bdi></small> : categoryName && categoryName !== label ? <small className="cr-helper"><bdi>{categoryName}</bdi></small> : null}</span></span>
              <span className="daily-journal-meta"><span className="daily-journal-wallet cr-helper">{event.movements.map((movement) => <bdi key={`${movement.walletId}-${movement.currency}`}>{movement.walletName}</bdi>)}</span><span className="daily-journal-kind cr-chip">{entryType(event, locale)}</span></span>
              <span className="daily-journal-amount">
                {event.movements.map((movement) => {
                  const positive = event.kind === 'income' && BigInt(movement.amountMinor) > 0n;
                  const className = reversal
                    ? 'cr-reversal-text'
                    : positive
                      ? 'cr-positive'
                      : undefined;
                  return (
                    <bdi key={`${event.id}-${movement.walletId}-${movement.currency}`} className={className}>
                      {formatMinorAmount(movement.amountMinor, movement.currency, locale)}
                    </bdi>
                  );
                })}
              </span>
            </button>
          );
        })}
      </section>
      {searchActive
        ? searchView?.nextCursor ? (
          <button
            type="button"
            className="cr-button cr-button--block"
            disabled={searchView.pending || searchView.loadingMore}
            onClick={props.onLoadMoreSearch}
          >
            {t(locale, 'Load more', 'تحميل المزيد')}
          </button>
        ) : null
        : props.nextCursor !== null ? (
          <button
            type="button"
            className="cr-button cr-button--block"
            disabled={props.loadingMore}
            onClick={props.onLoadMore}
          >
            {t(locale, 'Load more', 'تحميل المزيد')}
          </button>
        ) : null}
      {selected ? (
        <div className="cr-sheet-backdrop" onClick={closeSheet}>
          <div
            ref={sheetRef}
            className="cr-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={rowLabel(selected, locale)}
            tabIndex={-1}
            onClick={(click) => click.stopPropagation()}
          >
            <h2><bdi>{rowLabel(selected, locale)}</bdi></h2>
            <p className="cr-label">
              {t(locale, KIND_LABELS[selected.kind].en, KIND_LABELS[selected.kind].ar)}
              {' · '}
              {selected.effectiveDate}
            </p>
            {selected.note?.trim() ? <p><bdi>{selected.note.trim()}</bdi></p> : null}
            <ul className="cr-movements">
              {selected.movements.map((movement) => (
                <li key={`${movement.walletId}-${movement.currency}`}>
                  <span>
                    <bdi>{movement.walletName}</bdi>
                    {movement.walletArchived ? ` ${t(locale, '(archived)', '(مؤرشفة)')}` : ''}
                  </span>
                  <span className={selected.reversalOf !== null ? 'cr-reversal-text' : 'cr-amount'}>
                    {formatMinorAmount(movement.amountMinor, movement.currency, locale)}
                  </span>
                </li>
              ))}
            </ul>
            {selected.reversedBy !== null ? (
              <p className="cr-label">
                {t(locale, `Reversed by reversal ${selected.reversedBy}`, `عُكست بواسطة القيد ${selected.reversedBy}`)}
              </p>
            ) : null}
            {selected.reversalOf !== null ? (
              <p className="cr-label">
                {t(locale, `Reversal of ${selected.reversalOf}`, `عكس القيد ${selected.reversalOf}`)}
              </p>
            ) : null}
            {reverseError ? (
              <div className="cr-sheet-error" role="alert">
                <span className="cr-danger-text">{reverseError}</span>
              </div>
            ) : null}
            <button
              type="button"
              className="cr-button cr-button--danger cr-button--block"
              disabled={!selectedReversible || props.reversePending}
              onClick={() => void reverseSelected()}
            >
              {t(locale, 'Reverse', 'اعكس القيد')}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
