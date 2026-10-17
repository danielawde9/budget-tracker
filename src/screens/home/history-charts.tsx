import { useId, useState } from 'react';
import type { MoneyHistory } from '../../api/schemas.ts';
import { useWorkspace } from '../../app/workspace.tsx';
import { useI18n } from '../../lib/i18n.tsx';
import type { Currency, Locale } from '../../lib/money.ts';
import { useUiCopy } from '../../lib/ui-copy.ts';
import { LoadState, useLoad } from '../../ui/async.tsx';
import { chartTick, ChartLegend, ChartSwatch, LineChart } from '../../ui/charts.tsx';
import { Amount } from '../../ui/money.tsx';
import { endOfMonth } from '../describe.ts';

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

function monthLabels(months: MoneyHistory['months'], date: ReturnType<typeof useI18n>['date'], digits: ReturnType<typeof useI18n>['digits']) {
  const spansYears = months[0]?.month.slice(0, 4) !== months.at(-1)?.month.slice(0, 4);
  return months.map(month => `${date(month.month, 'shortMonth')}${spansYears ? ` ’${digits(month.month.slice(2, 4))}` : ''}`);
}

export function HistoryCharts({ currency }: { readonly currency: Currency }) {
  const { api, space, version } = useWorkspace();
  const c = useUiCopy();
  const history = useLoad(() => api.moneyHistory(space.id), [api, space.id, version]);
  return <div className="cr-dashboard-charts cr-dashboard-charts--equal">
    <section className="cr-card cr-chart-card" aria-labelledby="flow-history-heading">
      <h2 id="flow-history-heading">{c('incomeVsSpending')}</h2><p className="cr-helper">{c('flowHistoryHelp')}</p>
      <LoadState loaded={history}>{data => data.months.length ? <FlowHistory history={data} currency={currency} /> : <ChartEmpty text={c('noHistory')} />}</LoadState>
    </section>
    <section className="cr-card cr-chart-card" aria-labelledby="savings-history-heading">
      <h2 id="savings-history-heading">{c('savingsHistory')}</h2><p className="cr-helper">{c('savingsHistoryHelp')}</p>
      <LoadState loaded={history}>{data => data.months.length ? <SavingsHistory history={data} currency={currency} /> : <ChartEmpty text={c('noSavingsHistory')} />}</LoadState>
    </section>
  </div>;
}

function ChartEmpty({ text }: { readonly text: string }) {
  return <div className="cr-chart-empty"><span className="cr-chart-empty-bars" aria-hidden><i /><i /><i /><i /><i /></span><p className="cr-helper">{text}</p></div>;
}

function MonthPicker({ months, selected, onSelect }: { readonly months: MoneyHistory['months']; readonly selected: string; readonly onSelect: (month: string) => void }) {
  const { date, digits } = useI18n();
  const c = useUiCopy();
  const labels = monthLabels(months, date, digits);
  return <div className="cr-chart-months" role="group" aria-label={c('selectMonth')}>{months.map((month, index) => <button type="button" key={month.month} aria-label={date(month.month, 'month')} aria-pressed={selected === month.month} onClick={() => onSelect(month.month)}>{labels[index]}</button>)}</div>;
}

function FlowHistory({ history, currency }: { readonly history: MoneyHistory; readonly currency: Currency }) {
  const { date, digits, money, locale } = useI18n();
  const c = useUiCopy();
  const readoutId = useId();
  const hintId = useId();
  const months = [...history.months].sort((a, b) => a.month.localeCompare(b.month));
  const [selected, setSelected] = useState(months.at(-1)!.month);
  const current = months.find(month => month.month === selected) ?? months.at(-1)!;
  const max = months.reduce((value, month) => [month.income[currency], month.spent[currency]].reduce((n, amount) => amount > n ? amount : n, value), 1n);
  const min = months.reduce((value, month) => [month.income[currency], month.spent[currency]].reduce((n, amount) => amount < n ? amount : n, value), 0n);
  const y = (amount: bigint) => 188 - Number((amount - min) * 10000n / (max - min || 1n)) / 10000 * 152;
  const baseline = y(0n);
  const step = 480 / months.length;
  const labels = monthLabels(months, date, digits);
  const labelStep = Math.ceil((months.length - 1) / 5) || 1;
  const net = current.income[currency] - current.spent[currency];
  const monthSummary = (month: MoneyHistory['months'][number]) => `${date(month.month, 'month')} · ${c('incomeRecorded')}: ${money(month.income[currency], currency)} · ${c('spendingRecorded')}: ${money(month.spent[currency], currency)}`;
  return <>
    <div className="cr-chart-readout" id={readoutId}><div><span className="cr-helper">{c('incomeRecorded')}</span><Amount minor={current.income[currency]} currency={currency} /></div><div><span className="cr-helper">{c('spendingRecorded')}</span><Amount minor={current.spent[currency]} currency={currency} /></div><div className="cr-chart-net"><span className="cr-helper">{t(locale, 'Net cash flow', 'صافي التدفق النقدي')}</span><Amount minor={net} currency={currency} sign tone={net < 0n ? 'negative' : net > 0n ? 'positive' : 'plain'} /><span className="cr-helper">{t(locale, 'Income minus spending.', 'الدخل ناقص الإنفاق.')}</span></div><span className="cr-helper">{date(current.month, 'month')}{current.through < endOfMonth(current.month) ? ` · ${c('soFar')}` : ''}</span></div>
    <ChartLegend><ChartSwatch color="var(--cr-accent)">{c('incomeRecorded')}</ChartSwatch><ChartSwatch color="var(--cr-chart-2)">{c('spendingRecorded')}</ChartSwatch></ChartLegend>
    <p className="cr-helper" id={hintId}>{t(locale, 'Hover, focus or tap a month to see exact amounts.', 'مرّر المؤشر أو ركّز أو اضغط على شهر لعرض المبالغ الدقيقة.')}</p>
    <div className="cr-chart-explore"><div className="cr-chart-interactive" style={{ minInlineSize: `max(100%, ${months.length * 55}px)` }}>
    <svg className="cr-history-chart" viewBox="0 0 600 230" role="img" aria-label={c('incomeVsSpending')} aria-describedby={readoutId}>
      {[0, 1, 2].map(index => { const value = min + (max - min) * BigInt(index) / 2n; return <g key={index}><line x1="82" x2="562" y1={y(value)} y2={y(value)} className="cr-chart-grid" /><text x="74" y={y(value) + 4} textAnchor="end">{chartTick(value, currency, locale)}</text></g>; })}
      <line x1="82" x2="562" y1={baseline} y2={baseline} className="cr-chart-grid" />
      {months.map((month, index) => { const center = 82 + step * (index + .5); const width = Math.min(26, step * .28); return <g key={month.month} opacity={month.month === current.month ? 1 : .6}>
        {[month.income[currency], month.spent[currency]].map((value, series) => <rect key={series} x={center + (series ? 4 : -width - 4)} y={Math.min(y(value), baseline)} width={width} height={Math.abs(y(value) - baseline)} rx="3" fill={series ? 'var(--cr-chart-2)' : 'var(--cr-accent)'}><title>{date(month.month, 'month')} · {series ? c('spendingRecorded') : c('incomeRecorded')}: {money(value, currency)}</title></rect>)}
        {index % labelStep === 0 || index === months.length - 1 ? <text x={center} y="221" textAnchor="middle">{labels[index]}</text> : null}
      </g>; })}
    </svg>
    <div className="cr-chart-hit-targets" role="group" aria-label={t(locale, 'Inspect income and spending by month', 'استعراض الدخل والإنفاق حسب الشهر')} aria-describedby={hintId} style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
      {months.map(month => <button className="cr-chart-hit-target" type="button" key={month.month} aria-label={`${t(locale, 'Inspect', 'استعرض')} ${date(month.month, 'month')}`} title={monthSummary(month)} aria-pressed={month.month === current.month} onPointerEnter={() => setSelected(month.month)} onFocus={() => setSelected(month.month)} onClick={() => setSelected(month.month)} />)}
    </div>
    </div></div>
    <MonthPicker months={months} selected={current.month} onSelect={setSelected} />
  </>;
}

function SavingsHistory({ history, currency }: { readonly history: MoneyHistory; readonly currency: Currency }) {
  const { date, digits, money, locale } = useI18n();
  const c = useUiCopy();
  const months = [...history.months].sort((a, b) => a.month.localeCompare(b.month));
  const [selected, setSelected] = useState(months.at(-1)!.month);
  const index = Math.max(0, months.findIndex(month => month.month === selected));
  const current = months[index]!;
  const labels = monthLabels(months, date, digits);
  return <>
    <div className="cr-chart-readout"><div><span className="cr-helper">{c('savedBalance')}</span><Amount minor={current.savings[currency]} currency={currency} /></div><span className="cr-helper">{date(current.month, 'month')} · {t(locale, 'As of', 'حتى')} {date(current.through, 'short')}</span></div>
    <LineChart label={c('savingsHistory')} points={months.map((month, pointIndex) => ({ label: labels[pointIndex]!, value: month.savings[currency] }))} format={value => chartTick(value, currency, locale)} formatValue={value => money(value, currency)} selectedIndex={index} onSelect={pointIndex => setSelected(months[pointIndex]!.month)} interactionHint={t(locale, 'Hover, focus or tap a month to see the exact savings balance.', 'مرّر المؤشر أو ركّز أو اضغط على شهر لعرض رصيد المدخرات الدقيق.')} />
    <MonthPicker months={months} selected={current.month} onSelect={setSelected} />
    {months.length === 1 ? <p className="cr-helper">{c('oneSavingsMonth')}</p> : null}
  </>;
}
