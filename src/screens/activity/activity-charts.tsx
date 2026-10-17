import { useState } from 'react';
import type { Entry } from '../../api/schemas.ts';
import { useI18n } from '../../lib/i18n.tsx';
import type { Locale } from '../../lib/money.ts';
import { useUiCopy } from '../../lib/ui-copy.ts';
import { chartColors } from '../../ui/charts.tsx';
import { kindLabel } from '../describe.ts';

function t(locale: Locale, en: string, ar: string) { return locale === 'ar' ? ar : en; }

interface ActivityChartsProps {
  readonly entries: readonly Entry[];
  readonly selectedDay?: string;
  readonly selectedKind?: string;
  readonly onDayChange?: (day: string) => void;
  readonly onKindChange?: (kind: string) => void;
}

export function ActivityCharts({ entries, selectedDay = '', selectedKind = '', onDayChange, onKindChange }: ActivityChartsProps) {
  const i18n = useI18n();
  const { date, digits, locale } = i18n;
  const c = useUiCopy();
  const [hoveredDay, setHoveredDay] = useState('');
  const [focusedDay, setFocusedDay] = useState('');
  const [localDay, setLocalDay] = useState('');
  const dayFilter = onDayChange ? selectedDay : localDay;
  const selectDay = (day: string) => {
    const next = day === dayFilter ? '' : day;
    if (onDayChange) onDayChange(next);
    else setLocalDay(next);
  };
  const byDay = new Map<string, number>();
  const byKind = new Map<Entry['kind'], number>();
  for (const entry of entries) {
    byDay.set(entry.occurredOn, (byDay.get(entry.occurredOn) ?? 0) + 1);
    if (!dayFilter || entry.occurredOn === dayFilter) byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1);
  }
  const matchingCount = dayFilter ? (byDay.get(dayFilter) ?? 0) : entries.length;
  const inspectedDay = (byDay.has(hoveredDay) ? hoveredDay : '') || (byDay.has(focusedDay) ? focusedDay : '') || dayFilter;
  const inspectedCount = byDay.get(inspectedDay) ?? 0;
  const loadedCount = (count: number) => t(locale, `${digits(String(count))} loaded ${count === 1 ? 'record' : 'records'}`, `${digits(String(count))} من القيود المحمّلة`);
  const days = [...byDay].sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(2, Math.ceil(Math.max(1, ...byDay.values()) / 2) * 2);
  const step = 460 / (days.length || 1);
  const kinds = [...byKind].sort((a, b) => b[1] - a[1]);
  return <div className="cr-activity-insights" aria-labelledby="activity-snapshot-heading">
    <div className="cr-section-header"><div><h2 id="activity-snapshot-heading">{c('activitySnapshot')}</h2><p className="cr-helper">{c('activitySnapshotHelp')}</p></div><span className="cr-count-badge">{digits(String(matchingCount))} · {c('matchingRecords')}</span></div>
    {dayFilter || selectedKind ? <div className="cr-toolbar">
      {dayFilter ? <><span className="cr-helper">{t(locale, 'Selected day', 'اليوم المحدد')}: {date(dayFilter)}</span><button type="button" className="text-button" onClick={() => selectDay(dayFilter)}>{t(locale, 'Show all loaded days', 'عرض كل الأيام المحمّلة')}</button></> : null}
      {selectedKind ? <><span className="cr-helper">{kindLabel(i18n, selectedKind as Entry['kind'])}</span><button type="button" className="text-button" onClick={() => onKindChange?.('')}>{t(locale, 'Show all types', 'عرض كل الأنواع')}</button></> : null}
    </div> : null}
    {dayFilter && !entries.length ? <p className="cr-chart-insight" role="status">{date(dayFilter)} · {loadedCount(0)}</p> : null}
    {!entries.length ? <p className="cr-helper">{c('noChartRecords')}</p> : <div className="cr-insight-columns">
      <section aria-labelledby="records-by-day-heading"><h3 id="records-by-day-heading">{c('recordsByDay')}</h3>
        <p id="activity-day-help" className="cr-helper">{t(locale, 'Select a day to filter the list below. Bars keep all loaded days in view.', 'اختر يوماً لتصفية القائمة أدناه. تبقى كل الأيام المحمّلة ظاهرة في الرسم.')}</p>
        <div className="cr-chart-explore"><div className="cr-chart-interactive" style={{ minInlineSize: days.length * 50 }}>
        <svg className="cr-history-chart" viewBox="0 0 520 180" role="img" aria-label={c('recordsByDay')} aria-describedby="activity-day-help">
          <title>{c('recordsByDay')}</title>
          {[0, 1, 2].map(index => <g key={index}><line x1="42" x2="502" y1={145 - index * 60} y2={145 - index * 60} className="cr-chart-grid" /><text x="32" y={149 - index * 60} textAnchor="end">{digits(String(Math.round(max * index / 2)))}</text></g>)}
          {days.map(([day, count], index) => <g key={day}><rect x={42 + index * step + step * .2} y={145 - count / max * 120} width={step * .6} height={count / max * 120} rx="3" fill="var(--cr-accent)" opacity={!inspectedDay || inspectedDay === day ? 1 : .4}><title>{date(day)}: {digits(String(count))}</title></rect>{index % Math.max(1, Math.ceil(days.length / 5)) === 0 || index === days.length - 1 ? <text x={42 + (index + .5) * step} y="170" textAnchor="middle">{date(day, 'short')}</text> : null}</g>)}
        </svg>
        <div className="cr-chart-hit-targets" role="group" aria-label={t(locale, 'Filter loaded records by day', 'تصفية القيود المحمّلة حسب اليوم')} style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`, insetInlineStart: `${42 / 520 * 100}%`, insetInlineEnd: `${18 / 520 * 100}%`, insetBlockStart: `${25 / 180 * 100}%`, insetBlockEnd: `${35 / 180 * 100}%`, inlineSize: 'auto', blockSize: 'auto', direction: 'ltr' }}>
          {days.map(([day, count]) => <button key={day} type="button" className="cr-chart-hit" aria-pressed={day === dayFilter} aria-label={`${t(locale, 'Show records on', 'عرض قيود يوم')} ${date(day)} · ${digits(String(count))}`} aria-describedby="activity-day-help" onPointerEnter={() => setHoveredDay(day)} onPointerLeave={() => setHoveredDay('')} onFocus={() => setFocusedDay(day)} onBlur={() => setFocusedDay('')} onClick={() => selectDay(day)} />)}
        </div>
        </div></div>
        <p className="cr-chart-insight" role="status" aria-atomic="true">{inspectedDay ? `${date(inspectedDay)} · ${loadedCount(inspectedCount)}` : t(locale, 'Point to a bar or use Tab to inspect a day. Select it to see its records.', 'أشر إلى عمود أو استخدم Tab لعرض تفاصيل اليوم. اختره لرؤية قيوده.')}</p>
        <details className="cr-chart-data"><summary>{c('dailyActivityData')}</summary><table aria-label={c('recordsByDay')}><thead><tr><th scope="col">{c('activityDate')}</th><th scope="col">{c('activityCount')}</th></tr></thead><tbody>{days.map(([day, count]) => <tr key={day}><td>{date(day, 'short')}</td><td>{digits(String(count))}</td></tr>)}</tbody></table></details>
      </section>
      <section aria-labelledby="record-types-heading"><h3 id="record-types-heading">{c('recordTypes')}</h3><p className="cr-helper">{dayFilter ? t(locale, 'Types for the selected day. Choose a type to filter the journal.', 'أنواع القيود في اليوم المحدد. اختر نوعاً لتصفية السجل.') : t(locale, 'Choose a type to filter the journal.', 'اختر نوعاً لتصفية السجل.')}</p><ul className="cr-type-breakdown">{kinds.map(([kind, count], index) => <li key={kind}><button type="button" className="cr-type-breakdown-button" aria-pressed={kind === selectedKind} aria-label={`${t(locale, 'Filter by', 'تصفية حسب')} ${kindLabel(i18n, kind)} · ${digits(String(count))}`} onClick={() => onKindChange?.(selectedKind === kind ? '' : kind)}><span>{kindLabel(i18n, kind)}</span><span className="cr-bar-track" aria-hidden><span style={{ inlineSize: `${count / matchingCount * 100}%`, background: chartColors[index % chartColors.length] }} /></span><strong>{digits(String(count))}</strong></button></li>)}</ul></section>
    </div>}
  </div>;
}
