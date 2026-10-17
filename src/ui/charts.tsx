import { useId } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Currency, Locale } from '../lib/money.ts';

export function chartTick(value: bigint, currency: Currency, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(Number(value) / (currency === 'USD' ? 100 : 1));
}

/** Scale exact minor units before converting to a browser-sized number. */
export function chartPercent(value: bigint, total: bigint): number {
  if (total <= 0n || value <= 0n) return 0;
  return Math.min(100, Number(value * 10000n / total) / 100);
}

export const chartColors = Array.from({ length: 6 }, (_, index) => `var(--cr-chart-${index})`);

export function ChartLegend({ children }: { readonly children: ReactNode }) {
  return <div className="cr-chart-key">{children}</div>;
}

export function ChartSwatch({ children, color, dashed = false }: { readonly children: ReactNode; readonly color: string; readonly dashed?: boolean }) {
  return <span><i style={{ borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }} aria-hidden />{children}</span>;
}

export function DonutChart({ label, segments, children, selectedIndex, onSelect }: {
  readonly label: string;
  readonly segments: readonly { readonly value: bigint; readonly color: string; readonly label: string }[];
  readonly children: ReactNode;
  readonly selectedIndex?: number | undefined;
  readonly onSelect?: (index: number) => void;
}) {
  const total = segments.reduce((sum, segment) => sum + (segment.value > 0n ? segment.value : 0n), 0n);
  let offset = 0;
  return <div className="cr-ring-chart">
    <svg viewBox="0 0 220 220" role="img" aria-label={label}>
      <circle cx="110" cy="110" r="91" className="cr-ring-track" />
      {segments.map((segment, index) => {
        if (segment.value <= 0n) return null;
        const length = chartPercent(segment.value, total);
        const start = offset;
        offset += length;
        return <circle key={index} className="cr-ring-segment" opacity={selectedIndex === undefined || selectedIndex === index ? 1 : .3} onPointerEnter={() => onSelect?.(index)} onClick={() => onSelect?.(index)} cx="110" cy="110" r="91" pathLength="100" fill="none" stroke={segment.color} strokeWidth={selectedIndex === index ? 28 : 22} strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-start} transform="rotate(-90 110 110)"><title>{segment.label}</title></circle>;
      })}
    </svg>
    <div className="cr-ring-label">{children}</div>
  </div>;
}

export function LineChart({ label, points, format, selectedIndex, onSelect, formatValue = format, interactionHint }: {
  readonly label: string;
  readonly points: readonly { readonly label: string; readonly value: bigint }[];
  readonly format: (value: bigint) => string;
  readonly selectedIndex?: number;
  readonly onSelect?: (index: number) => void;
  readonly formatValue?: (value: bigint) => string;
  readonly interactionHint?: string;
}) {
  const gradientId = useId();
  const min = points.reduce((value, point) => point.value < value ? point.value : value, 0n);
  const max = points.reduce((value, point) => point.value > value ? point.value : value, 1n);
  const range = max - min || 1n;
  const x = (index: number) => points.length === 1 ? 320 : 82 + index / (points.length - 1) * 480;
  const y = (value: bigint) => 190 - Number((value - min) * 10000n / range) / 10000 * 155;
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(point.value)}`).join(' ');
  const hitStart = (index: number) => index === 0 ? 60 : (x(index - 1) + x(index)) / 2;
  const hitEnd = (index: number) => index === points.length - 1 ? 584 : (x(index) + x(index + 1)) / 2;
  return <><div className="cr-chart-explore"><div className="cr-chart-interactive" style={onSelect ? { minInlineSize: `max(100%, ${points.length * 55}px)` } : undefined}><svg className="cr-history-chart" viewBox="0 0 600 230" role="img" aria-label={label}>
    <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--cr-accent)" stopOpacity=".18" /><stop offset="100%" stopColor="var(--cr-accent)" stopOpacity="0" /></linearGradient></defs>
    {[0, 1, 2].map(step => { const value = min + range * BigInt(step) / 2n; return <g key={step}><line x1="82" x2="562" y1={y(value)} y2={y(value)} className="cr-chart-grid" /><text x="74" y={y(value) + 4} textAnchor="end">{format(value)}</text></g>; })}
    {points.length > 1 ? <><path d={`${path} L ${x(points.length - 1)} ${y(min)} L ${x(0)} ${y(min)} Z`} fill={`url(#${gradientId})`} /><path d={path} className="cr-chart-actual" /></> : null}
    {selectedIndex !== undefined && points[selectedIndex] ? <line x1={x(selectedIndex)} x2={x(selectedIndex)} y1="24" y2="195" className="cr-chart-guide" /> : null}
    {points.map((point, index) => <g key={`${point.label}-${index}`}><circle cx={x(index)} cy={y(point.value)} r={index === selectedIndex ? 7 : 4} className="cr-chart-point"><title>{point.label}: {formatValue(point.value)}</title></circle>{index % Math.max(1, Math.ceil(points.length / 5)) === 0 || index === points.length - 1 ? <text x={x(index)} y="221" textAnchor="middle">{point.label}</text> : null}</g>)}
  </svg>{onSelect ? <div className="cr-chart-hit-targets cr-chart-hit-targets--line" style={{ '--cr-chart-points': points.length, insetInlineStart: `${60 / 600 * 100}%`, inlineSize: `${524 / 600 * 100}%`, insetBlockStart: `${24 / 230 * 100}%`, blockSize: `${172 / 230 * 100}%` } as CSSProperties}>{points.map((point, index) => <button key={`${point.label}-${index}`} type="button" className="cr-chart-hit-target" style={{ insetInlineStart: `${(hitStart(index) - 60) / 524 * 100}%`, inlineSize: `${(hitEnd(index) - hitStart(index)) / 524 * 100}%` }} aria-label={`${point.label}: ${formatValue(point.value)}`} aria-pressed={selectedIndex === index} onPointerEnter={() => onSelect(index)} onFocus={() => onSelect(index)} onClick={() => onSelect(index)} onKeyDown={event => {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : direction ? Math.max(0, Math.min(points.length - 1, index + direction)) : null;
    if (next === null) return;
    event.preventDefault();
    (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
  }} />)}</div> : null}</div></div>{interactionHint ? <p className="cr-helper cr-chart-hint">{interactionHint}</p> : null}</>;
}
