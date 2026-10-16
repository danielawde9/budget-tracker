import type { Entry } from '../../api/schemas.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { useUiCopy } from '../../lib/ui-copy.ts';
import { chartColors } from '../../ui/charts.tsx';
import { kindLabel } from '../describe.ts';

export function ActivityCharts({ entries }: { readonly entries: readonly Entry[] }) {
  const i18n = useI18n();
  const { date, digits } = i18n;
  const c = useUiCopy();
  const byDay = new Map<string, number>();
  const byKind = new Map<Entry['kind'], number>();
  for (const entry of entries) {
    byDay.set(entry.occurredOn, (byDay.get(entry.occurredOn) ?? 0) + 1);
    byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1);
  }
  const days = [...byDay].sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(2, Math.ceil(Math.max(1, ...byDay.values()) / 2) * 2);
  const step = 460 / (days.length || 1);
  const kinds = [...byKind].sort((a, b) => b[1] - a[1]);
  return <div className="cr-activity-insights" aria-labelledby="activity-snapshot-heading">
    <div className="cr-section-header"><div><h2 id="activity-snapshot-heading">{c('activitySnapshot')}</h2><p className="cr-helper">{c('activitySnapshotHelp')}</p></div><span className="cr-count-badge">{digits(String(entries.length))} · {c('matchingRecords')}</span></div>
    {!entries.length ? <p className="cr-helper">{c('noChartRecords')}</p> : <div className="cr-insight-columns">
      <section aria-labelledby="records-by-day-heading"><h3 id="records-by-day-heading">{c('recordsByDay')}</h3>
        <svg className="cr-history-chart" viewBox="0 0 520 180" role="img" aria-label={c('recordsByDay')}>
          {[0, 1, 2].map(index => <g key={index}><line x1="42" x2="502" y1={145 - index * 60} y2={145 - index * 60} className="cr-chart-grid" /><text x="32" y={149 - index * 60} textAnchor="end">{digits(String(Math.round(max * index / 2)))}</text></g>)}
          {days.map(([day, count], index) => <g key={day}><rect x={42 + index * step + step * .2} y={145 - count / max * 120} width={step * .6} height={count / max * 120} rx="3" fill="var(--cr-accent)"><title>{date(day, 'short')}: {digits(String(count))}</title></rect>{index % Math.max(1, Math.ceil(days.length / 5)) === 0 || index === days.length - 1 ? <text x={42 + (index + .5) * step} y="170" textAnchor="middle">{date(day, 'short')}</text> : null}</g>)}
        </svg>
        <details className="cr-chart-data"><summary>{c('dailyActivityData')}</summary><table aria-label={c('recordsByDay')}><thead><tr><th scope="col">{c('activityDate')}</th><th scope="col">{c('activityCount')}</th></tr></thead><tbody>{days.map(([day, count]) => <tr key={day}><td>{date(day, 'short')}</td><td>{digits(String(count))}</td></tr>)}</tbody></table></details>
      </section>
      <section aria-labelledby="record-types-heading"><h3 id="record-types-heading">{c('recordTypes')}</h3><ul className="cr-type-breakdown">{kinds.map(([kind, count], index) => <li key={kind}><span>{kindLabel(i18n, kind)}</span><span className="cr-bar-track" aria-hidden><span style={{ inlineSize: `${count / entries.length * 100}%`, background: chartColors[index % chartColors.length] }} /></span><strong>{digits(String(count))}</strong></li>)}</ul></section>
    </div>}
  </div>;
}
