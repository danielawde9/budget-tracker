import { useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '../../lib/i18n.tsx';
import { useUiCopy } from '../../lib/ui-copy.ts';
import { SelectField } from '../../ui/select-field.tsx';
import { addMonths } from '../describe.ts';
import { reportPeriod, validReportRange, type ReportPreset, type ReportRange } from './spending-report.ts';

export function ReportPeriod({ range, preset, today, onChange }: {
  readonly range: ReportRange;
  readonly preset: ReportPreset;
  readonly today: string;
  readonly onChange: (range: ReportRange, preset: ReportPreset) => void;
}) {
  const { date, t } = useI18n();
  const c = useUiCopy();
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [invalid, setInvalid] = useState(false);
  const fromRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  useEffect(() => { setFrom(range.from); setTo(range.to); setInvalid(false); }, [range.from, range.to]);
  const monthly = ['thisMonth', 'lastMonth', 'month'].includes(preset);
  function chooseMonth(month: string) {
    if (/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/.test(month) && month <= today.slice(0, 7)) onChange(reportPeriod('month', today, month), 'month');
  }
  return <section className="cr-card cr-report-period" aria-labelledby="report-period-heading">
    <h2 id="report-period-heading">{c('reportPeriod')}</h2>
    <div className="cr-report-period-controls">
      <SelectField label={c('reportPeriod')} value={preset} onChange={event => {
        const next = event.target.value as ReportPreset;
        setInvalid(false);
        onChange(next === 'custom' ? range : reportPeriod(next, today, range.from), next);
      }}>
        <option value="thisMonth">{c('reportThisMonth')}</option><option value="lastMonth">{c('reportLastMonth')}</option>
        <option value="last30Days">{c('reportLast30Days')}</option><option value="thisYear">{c('reportThisYear')}</option>
        {preset === 'month' ? <option value="month">{c('reportSelectedMonth')}</option> : null}<option value="custom">{c('reportCustom')}</option>
      </SelectField>
      {monthly ? <div className="cr-report-month-controls">
        <button type="button" className="cr-icon-button" aria-label={c('reportPreviousMonth')} onClick={() => chooseMonth(addMonths(range.from, -1).slice(0, 7))}><ChevronLeft aria-hidden size={20} /></button>
        <label className="cr-field"><span className="cr-label">{t('activity.month')}</span><input type="month" value={range.from.slice(0, 7)} max={today.slice(0, 7)} onChange={event => chooseMonth(event.target.value)} /></label>
        <button type="button" className="cr-icon-button" aria-label={c('reportNextMonth')} disabled={range.from.slice(0, 7) >= today.slice(0, 7)} onClick={() => chooseMonth(addMonths(range.from, 1).slice(0, 7))}><ChevronRight aria-hidden size={20} /></button>
      </div> : null}
    </div>
    {preset === 'custom' ? <form className="cr-report-custom-dates" noValidate onSubmit={event => {
      event.preventDefault();
      if (!validReportRange({ from, to }, today)) { setInvalid(true); fromRef.current?.focus(); return; }
      setInvalid(false); onChange({ from, to }, 'custom');
    }}>
      <label className="cr-field"><span className="cr-label">{c('reportFrom')}</span><input ref={fromRef} type="date" required max={today} value={from} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} onChange={event => { setFrom(event.target.value); setInvalid(false); }} /></label>
      <label className="cr-field"><span className="cr-label">{c('reportTo')}</span><input type="date" required max={today} value={to} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} onChange={event => { setTo(event.target.value); setInvalid(false); }} /></label>
      <button type="submit" className="cr-button">{c('reportApply')}</button>
      {invalid ? <p id={errorId} className="error-notice" role="alert">{c('reportInvalidDates')}</p> : null}
    </form> : null}
    <p className="cr-helper cr-report-applied-dates">{date(range.from)} – {date(range.to)}</p>
  </section>;
}
