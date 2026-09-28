import { useCallback, useEffect, useState } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import type { AllocationGateway, AllocationHistoryRow } from './types.js';
import { useAllocation } from './use-allocation.js';
import { MonthCloseDialog } from './month-close-dialog.js';
import { MonthCopyDialog } from './month-copy-dialog.js';
import { MonthHistory } from './month-history.js';
import './month-transitions.css';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

/** The month immediately before `month` (a `YYYY-MM-01` key), as a month key. */
function previousMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7));
  const date = new Date(Date.UTC(year, monthIndex - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

interface HistoryState {
  status: 'loading' | 'ready' | 'error';
  rows: readonly AllocationHistoryRow[];
}

export interface MonthTransitionsPanelProps {
  readonly locale: Locale;
  readonly spaceId: string;
  readonly currency: Currency;
  /** The selected Plan month (`YYYY-MM-01`): copy targets it, close freezes it. */
  readonly month: string;
  readonly gateway: AllocationGateway;
  onSpaceUnavailable?: (() => void) | undefined;
}

/** Plan month controls (task 22): copy the previous saved month, close a
 * finished month, and opt a category into signed carry. All three commands run
 * through one `useAllocation` state machine, so an accepted/ambiguous/refresh
 * outcome is shared and a change is never double-posted. */
export function MonthTransitionsPanel(props: MonthTransitionsPanelProps) {
  const { locale } = props;
  const allocation = useAllocation(props.gateway, props.spaceId, props.month, props.currency, props.onSpaceUnavailable);
  const [copyOpen, setCopyOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [history, setHistory] = useState<HistoryState>({ status: 'loading', rows: [] });

  const loadHistoryPage = allocation.loadHistoryPage;
  const loadHistory = useCallback(async () => {
    setHistory({ status: 'loading', rows: [] });
    try {
      const page = await loadHistoryPage({ beforeId: null, limit: 20 });
      setHistory({ status: 'ready', rows: page.rows });
    } catch {
      setHistory({ status: 'error', rows: [] });
    }
  }, [loadHistoryPage]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const ready = allocation.status !== 'loading' && allocation.status !== 'error';

  return (
    <section className="mt-panel" aria-label={t(locale, 'Month transitions', 'انتقالات الشهر')}>
      {allocation.status === 'loading' ? (
        <p className="cr-helper">{t(locale, 'Loading month transitions…', 'جارٍ تحميل انتقالات الشهر…')}</p>
      ) : (
        <>
          <div className="cr-section-header">
            <h2>{t(locale, 'Month transitions', 'انتقالات الشهر')}</h2>
          </div>
          {allocation.status === 'error' ? (
            <div className="cr-card" role="alert">
              <span>{t(locale, 'Could not load the month transitions.', 'تعذر تحميل انتقالات الشهر.')}</span>
              <button type="button" className="cr-button" onClick={() => void allocation.refresh()}>{t(locale, 'Retry', 'إعادة المحاولة')}</button>
            </div>
          ) : null}
          {allocation.status === 'accepted-refresh-pending' ? (
            <div className="cr-card" role="alert">
              <span>{t(locale, 'Saved, but refreshing the month failed — check your connection.', 'تم الحفظ، لكن تعذر تحديث الشهر — تحقق من الاتصال.')}</span>
              <button type="button" className="cr-button" onClick={() => void allocation.refresh()}>{t(locale, 'Refresh', 'تحديث')}</button>
            </div>
          ) : null}
          {allocation.status === 'ambiguous' ? (
            <div className="cr-card" role="alert">
              <span>{t(locale, 'We could not confirm whether the last change went through.', 'تعذر التأكد مما إذا كان التغيير الأخير قد تم.')}</span>
              <button type="button" className="cr-button" onClick={() => void allocation.retryAmbiguous()}>{t(locale, 'Check again', 'تحقق مرة أخرى')}</button>
              <button type="button" className="cr-button" onClick={allocation.clearAmbiguous}>{t(locale, 'Dismiss', 'إغلاق')}</button>
            </div>
          ) : null}
          {ready ? (
            <>
              <p className="cr-helper">
                {t(locale,
                  'Copy the previous saved month into this one, close a finished month, or opt a category into signed carry.',
                  'انسخ الشهر المحفوظ السابق إلى هذا الشهر، أو أغلق شهرًا منتهيًا، أو فعّل الترحيل الموقّع لفئة.')}
              </p>
              <div className="mt-actions">
                <button type="button" className="cr-button" onClick={() => setCopyOpen(true)}>
                  {t(locale, 'Copy previous month', 'نسخ الشهر السابق')}
                </button>
                <button type="button" className="cr-button" onClick={() => setCloseOpen(true)}>
                  {t(locale, 'Close month', 'إغلاق الشهر')}
                </button>
              </div>
              <MonthHistory locale={locale} currency={props.currency} month={props.month} status={history.status} rows={history.rows} />
            </>
          ) : null}
        </>
      )}
      {copyOpen ? (
        <MonthCopyDialog
          locale={locale}
          currency={props.currency}
          targetMonth={props.month}
          previousMonth={previousMonth(props.month)}
          loadSourceMonth={(targetMonth) => allocation.loadMonthFor(targetMonth)}
          previewCopy={(input) => allocation.previewCopy(input)}
          copyMonth={(input) => allocation.copyMonth(input)}
          pending={allocation.pending}
          ambiguous={allocation.ambiguous}
          retryAmbiguous={allocation.retryAmbiguous}
          clearAmbiguous={allocation.clearAmbiguous}
          onClose={() => setCopyOpen(false)}
          onCopied={() => { void allocation.refresh(); }}
        />
      ) : null}
      {closeOpen ? (
        <MonthCloseDialog
          locale={locale}
          currency={props.currency}
          month={props.month}
          previewClose={(input) => allocation.previewClose(input)}
          closeMonth={(input) => allocation.closeMonth(input)}
          setRollover={(input) => allocation.setRollover(input)}
          pending={allocation.pending}
          ambiguous={allocation.ambiguous}
          retryAmbiguous={allocation.retryAmbiguous}
          clearAmbiguous={allocation.clearAmbiguous}
          onClose={() => setCloseOpen(false)}
          onClosed={() => { void allocation.refresh(); }}
        />
      ) : null}
    </section>
  );
}
