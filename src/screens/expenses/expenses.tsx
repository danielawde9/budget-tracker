import { useEffect, useMemo, useRef, useState } from 'react';
import type { Entry } from '../../api/schemas.ts';
import { PageHeader } from '../../app/shell.tsx';
import { useWorkspace } from '../../app/workspace.tsx';
import { useI18n } from '../../lib/i18n.tsx';
import type { Currency } from '../../lib/money.ts';
import { useUiCopy } from '../../lib/ui-copy.ts';
import type { RecordIntent } from '../../record/record-dialog.tsx';
import { ErrorNotice, useLoad } from '../../ui/async.tsx';
import { Amount } from '../../ui/money.tsx';
import { kindLabel } from '../describe.ts';
import { EntryDetail } from '../activity/activity.tsx';
import { ReportBreakdown } from './report-breakdown.tsx';
import { ReportPeriod } from './report-period.tsx';
import { buildSpendingReport, loadReportActivity, matchingSpendingEntries, reportPeriod, type ReportPreset, type ReportRange, type SpendingCategory, type SpendingSelection } from './spending-report.ts';

export function ExpensesScreen({ onRecord }: { readonly onRecord: (intent: RecordIntent) => void }) {
  const { space } = useWorkspace();
  return <SpendingReportScreen key={`${space.id}:${space.currentMonth}`} onRecord={onRecord} />;
}

function SpendingReportScreen({ onRecord }: { readonly onRecord: (intent: RecordIntent) => void }) {
  const { t } = useI18n();
  const c = useUiCopy();
  const { api, space, version } = useWorkspace();
  const [chosenRange, setRange] = useState<ReportRange>(() => reportPeriod('thisMonth', space.today));
  const [preset, setPreset] = useState<ReportPreset>('thisMonth');
  const [currency, setCurrency] = useState<Currency>(space.planCurrency);
  const [view, setView] = useState('categories');
  const range = preset === 'custom' ? chosenRange : reportPeriod(preset, space.today, chosenRange.from);
  const rangeKey = `${range.from}:${range.to}`;
  const activity = useLoad(async () => ({ key: rangeKey, entries: await loadReportActivity(api, space.id, range) }),
    [api, space.id, range.from, range.to, version]);
  const ready = activity.status === 'ready' && activity.data.key === rangeKey;
  return <div className="cr-spending-report">
    <PageHeader title={c('spendingReport')} subtitle={c('reportIntro')} actions={<a className="cr-button" href="#/activity">{t('nav.activity')}</a>} />
    <ReportPeriod range={range} preset={preset} today={space.today} onChange={(next, preset) => { setRange(next); setPreset(preset); }} />
    {activity.status === 'error' ? <ErrorNotice error={activity.error} onRetry={activity.reload} /> : null}
    {activity.status !== 'error' && !ready ? <p className="cr-helper" role="status">{t('common.loading')}</p> : null}
    {ready ? <ReportResults key={`${rangeKey}:${currency}`} entries={activity.data.entries} range={range} currency={currency} onCurrency={setCurrency} view={view} onView={setView} onRecord={onRecord} /> : null}
  </div>;
}

function ReportResults({ entries, range, currency, onCurrency, view, onView, onRecord }: {
  readonly entries: readonly Entry[];
  readonly range: ReportRange;
  readonly currency: Currency;
  readonly onCurrency: (currency: Currency) => void;
  readonly view: string;
  readonly onView: (view: string) => void;
  readonly onRecord: (intent: RecordIntent) => void;
}) {
  const i18n = useI18n();
  const { date, name, digits } = i18n;
  const c = useUiCopy();
  const { catalog } = useWorkspace();
  const plan = catalog.data?.plan;
  const reports = useMemo(() => ({ USD: buildSpendingReport(entries, range, 'USD', plan), LBP: buildSpendingReport(entries, range, 'LBP', plan) }), [entries, range, plan]);
  const [selection, setSelection] = useState<(SpendingSelection & { category: SpendingCategory }) | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [shown, setShown] = useState(30);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (selection) heading.current?.focus(); }, [selection]);
  const records = useMemo(() => matchingSpendingEntries(entries, range, currency, selection, plan), [entries, range, currency, selection, plan]);
  const selectedTotal = records.reduce((sum, record) => sum + record.total, 0n);
  return <>
    <section className="cr-card" aria-labelledby="total-expenses-heading">
      <h2 id="total-expenses-heading">{c('totalExpenses')}</h2>
      <p className="cr-helper">{c('netSpending')}</p>
      <div className="cr-report-totals">{(['USD', 'LBP'] as const).map(value => <div key={value} className="cr-report-currency-total" role="group" aria-label={`${value} ${c('expenses')}`}>
        <h3>{value}</h3><p className="cr-category-total"><Amount minor={reports[value].total} currency={value} /></p>
        <dl className="cr-report-summary-lines">
          <div><dt>{c('reportPurchases')}</dt><dd><Amount minor={reports[value].purchases} currency={value} /></dd></div>
          <div><dt>{c('reportRefunds')}</dt><dd><Amount minor={reports[value].refunds} currency={value} /></dd></div>
          <div><dt>{c('reportRecords')}</dt><dd>{digits(String(reports[value].count))}</dd></div>
        </dl>
      </div>)}</div>
      <p className="cr-helper">{c('reportExpenseScope')}</p>
    </section>
    <ReportBreakdown report={reports[currency]} currency={currency} onCurrency={onCurrency} view={view} onView={onView} onSelect={(selected, category) => { setSelection({ ...selected, category }); setShown(30); }} onRecord={() => onRecord({ kind: 'expense' })} />
    <section className="cr-card" aria-labelledby="report-transactions-heading">
      <div className="cr-section-header"><h2 id="report-transactions-heading" tabIndex={-1} ref={heading}>{c('reportTransactions')}</h2>{selection ? <button type="button" className="cr-button cr-button--sm" onClick={() => { setSelection(null); setShown(30); }}>{c('reportAllCategories')}</button> : null}</div>
      <div className="cr-section-header cr-report-detail-summary"><p>{selection ? <bdi>{name(selection.category)}</bdi> : c('reportAllCategories')} · {currency}<span className="cr-helper">{digits(String(records.length))} {c('reportRecords')} · {date(range.from, 'short')} – {date(range.to, 'short')}</span></p><Amount minor={selectedTotal} currency={currency} /></div>
      {records.length ? <ul className="cr-register">{records.slice(0, shown).map(record => <li key={record.entry.entryId} className="cr-register-row">
        <button type="button" className="cr-register-button" onClick={() => setEntry(record.entry)}>
          <span className="cr-register-main"><bdi className="cr-register-title">{record.entry.memo || kindLabel(i18n, record.entry.kind)}</bdi>
            <span className="cr-helper">{date(record.entry.occurredOn)} · {kindLabel(i18n, record.entry.kind)} · <bdi>{[...new Set(record.entry.wallets.filter(wallet => wallet.currency === currency).map(wallet => wallet.name))].join(' · ')}</bdi></span>
            <span className="cr-helper"><bdi>{[...new Set(record.lines.map(line => name(line)))].join(' · ')}</bdi></span>
          </span><Amount minor={record.total} currency={currency} /></button>
      </li>)}</ul> : <p className="cr-helper">{c('reportNoTransactions')}</p>}
      {records.length > shown ? <div className="cr-report-more"><p className="cr-helper">{c('reportShowing')} {digits(String(Math.min(shown, records.length)))} / {digits(String(records.length))}</p><button type="button" className="cr-button" onClick={() => setShown(value => value + 30)}>{c('reportMoreTransactions')}</button></div> : null}
    </section>
    {entry ? <EntryDetail entry={entry} onClose={() => setEntry(null)} onCorrect={() => { setEntry(null); onRecord({ kind: 'correct', entry }); }} canCorrect={!entry.reversedByEntryId && entry.kind !== 'reversal' && Boolean(catalog.data?.accounts.wallets.some(wallet => wallet.kind === 'cash' && !wallet.archived))} /> : null}
  </>;
}
