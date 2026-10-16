import { useId } from 'react';
import type { ReactNode } from 'react';
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

export function DonutChart({ label, segments, children }: {
  readonly label: string;
  readonly segments: readonly { readonly value: bigint; readonly color: string; readonly label: string }[];
  readonly children: ReactNode;
}) {
  const total = segments.reduce((sum, segment) => sum + (segment.value > 0n ? segment.value : 0n), 0n);
  let offset = 0;
  return <div className="cr-ring-chart">
    <svg viewBox="0 0 220 220" role="img" aria-label={label}>
      <circle cx="110" cy="110" r="91" className="cr-ring-track" />
      {segments.filter(segment => segment.value > 0n).map((segment, index) => {
        const length = chartPercent(segment.value, total);
        const start = offset;
        offset += length;
        return <circle key={index} cx="110" cy="110" r="91" pathLength="100" fill="none" stroke={segment.color} strokeWidth="22" strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-start} transform="rotate(-90 110 110)"><title>{segment.label}</title></circle>;
      })}
    </svg>
    <div className="cr-ring-label">{children}</div>
  </div>;
}

export function LineChart({ label, points, format, selectedIndex }: {
  readonly label: string;
  readonly points: readonly { readonly label: string; readonly value: bigint }[];
  readonly format: (value: bigint) => string;
  readonly selectedIndex?: number;
}) {
  const gradientId = useId();
  const min = points.reduce((value, point) => point.value < value ? point.value : value, 0n);
  const max = points.reduce((value, point) => point.value > value ? point.value : value, 1n);
  const range = max - min || 1n;
  const x = (index: number) => points.length === 1 ? 320 : 82 + index / (points.length - 1) * 480;
  const y = (value: bigint) => 190 - Number((value - min) * 10000n / range) / 10000 * 155;
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(point.value)}`).join(' ');
  return <svg className="cr-history-chart" viewBox="0 0 600 230" role="img" aria-label={label}>
    <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--cr-accent)" stopOpacity=".18" /><stop offset="100%" stopColor="var(--cr-accent)" stopOpacity="0" /></linearGradient></defs>
    {[0, 1, 2].map(step => { const value = min + range * BigInt(step) / 2n; return <g key={step}><line x1="82" x2="562" y1={y(value)} y2={y(value)} className="cr-chart-grid" /><text x="74" y={y(value) + 4} textAnchor="end">{format(value)}</text></g>; })}
    {points.length > 1 ? <><path d={`${path} L ${x(points.length - 1)} ${y(min)} L ${x(0)} ${y(min)} Z`} fill={`url(#${gradientId})`} /><path d={path} className="cr-chart-actual" /></> : null}
    {points.map((point, index) => <g key={point.label}><circle cx={x(index)} cy={y(point.value)} r={index === selectedIndex ? 6 : 4} className="cr-chart-point"><title>{point.label}: {format(point.value)}</title></circle><text x={x(index)} y="221" textAnchor="middle">{point.label}</text></g>)}
  </svg>;
}
