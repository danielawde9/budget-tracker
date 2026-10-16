import { useState } from 'react';
import type { MoneyHistory } from '../../api/schemas.ts';
import { useWorkspace } from '../../app/workspace.tsx';
import { useI18n } from '../../lib/i18n.tsx';
import type { Currency } from '../../lib/money.ts';
import { useUiCopy } from '../../lib/ui-copy.ts';
import { LoadState, useLoad } from '../../ui/async.tsx';
import { chartTick, ChartLegend, ChartSwatch, LineChart } from '../../ui/charts.tsx';
import { Amount } from '../../ui/money.tsx';
import { endOfMonth } from '../describe.ts';

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
  const { date } = useI18n();
  const c = useUiCopy();
  return <div className="cr-chart-months" role="group" aria-label={c('selectMonth')}>{months.map(month => <button type="button" key={month.month} aria-label={date(month.month, 'month')} aria-pressed={selected === month.month} onClick={() => onSelect(month.month)}>{date(month.month, 'shortMonth')}</button>)}</div>;
}

function FlowHistory({ history, currency }: { readonly history: MoneyHistory; readonly currency: Currency }) {
  const { date, money, locale } = useI18n();
  const c = useUiCopy();
  const months = [...history.months].sort((a, b) => a.month.localeCompare(b.month));
  const [selected, setSelected] = useState(months.at(-1)!.month);
  const current = months.find(month => month.month === selected) ?? months.at(-1)!;
  const max = months.reduce((value, month) => [month.income[currency], month.spent[currency]].reduce((n, amount) => amount > n ? amount : n, value), 1n);
  const min = months.reduce((value, month) => [month.income[currency], month.spent[currency]].reduce((n, amount) => amount < n ? amount : n, value), 0n);
  const y = (amount: bigint) => 188 - Number((amount - min) * 10000n / (max - min || 1n)) / 10000 * 152;
  const baseline = y(0n);
  const step = 480 / months.length;
  return <>
    <div className="cr-chart-readout"><div><span className="cr-helper">{c('incomeRecorded')}</span><Amount minor={current.income[currency]} currency={currency} /></div><div><span className="cr-helper">{c('spendingRecorded')}</span><Amount minor={current.spent[currency]} currency={currency} /></div><span className="cr-helper">{date(current.month, 'month')}{current.through < endOfMonth(current.month) ? ` · ${c('soFar')}` : ''}</span></div>
    <ChartLegend><ChartSwatch color="var(--cr-accent)">{c('incomeRecorded')}</ChartSwatch><ChartSwatch color="var(--cr-chart-2)">{c('spendingRecorded')}</ChartSwatch></ChartLegend>
    <svg className="cr-history-chart" viewBox="0 0 600 230" role="img" aria-label={c('incomeVsSpending')}>
      {[0, 1, 2].map(index => { const value = min + (max - min) * BigInt(index) / 2n; return <g key={index}><line x1="82" x2="562" y1={y(value)} y2={y(value)} className="cr-chart-grid" /><text x="74" y={y(value) + 4} textAnchor="end">{chartTick(value, currency, locale)}</text></g>; })}
      <line x1="82" x2="562" y1={baseline} y2={baseline} className="cr-chart-grid" />
      {months.map((month, index) => { const center = 82 + step * (index + .5); const width = Math.min(26, step * .28); return <g key={month.month} opacity={month.month === current.month ? 1 : .6}>
        {[month.income[currency], month.spent[currency]].map((value, series) => <rect key={series} x={center + (series ? 4 : -width - 4)} y={Math.min(y(value), baseline)} width={width} height={Math.abs(y(value) - baseline)} rx="3" fill={series ? 'var(--cr-chart-2)' : 'var(--cr-accent)'}><title>{date(month.month, 'month')} · {series ? c('spendingRecorded') : c('incomeRecorded')}: {money(value, currency)}</title></rect>)}
        <text x={center} y="221" textAnchor="middle">{date(month.month, 'shortMonth')}</text>
      </g>; })}
    </svg>
    <MonthPicker months={months} selected={current.month} onSelect={setSelected} />
  </>;
}

function SavingsHistory({ history, currency }: { readonly history: MoneyHistory; readonly currency: Currency }) {
  const { date, locale } = useI18n();
  const c = useUiCopy();
  const months = [...history.months].sort((a, b) => a.month.localeCompare(b.month));
  const [selected, setSelected] = useState(months.at(-1)!.month);
  const index = Math.max(0, months.findIndex(month => month.month === selected));
  const current = months[index]!;
  return <>
    <div className="cr-chart-readout"><div><span className="cr-helper">{c('savedBalance')}</span><Amount minor={current.savings[currency]} currency={currency} /></div><span className="cr-helper">{date(current.through, 'short')}</span></div>
    <LineChart label={c('savingsHistory')} points={months.map(month => ({ label: date(month.month, 'shortMonth'), value: month.savings[currency] }))} format={value => chartTick(value, currency, locale)} selectedIndex={index} />
    <MonthPicker months={months} selected={current.month} onSelect={setSelected} />
    {months.length === 1 ? <p className="cr-helper">{c('oneSavingsMonth')}</p> : null}
  </>;
}
