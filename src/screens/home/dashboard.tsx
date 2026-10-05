import { ShoppingCart, ChartNoAxesCombined, ShieldCheck, PiggyBank } from 'lucide-react';
import type { CurrencyOverview, Overview, PlanMonth, Entry } from '../../api/schemas.ts';
import { useWorkspace } from '../../app/workspace.tsx';
import { navigate } from '../../app/router.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { useUiCopy } from '../../lib/ui-copy.ts';
import { LoadState, useLoad } from '../../ui/async.tsx';
import { Amount } from '../../ui/money.tsx';
import { endOfMonth } from '../describe.ts';
import { dashboardTotals, loadMonthActivity, spendingSeries, plannedSpending } from './dashboard-model.ts';

export function Dashboard({ overview, view }: { readonly overview: Overview; readonly view: CurrencyOverview }) {
  const { api, space, version } = useWorkspace();
  const plan = useLoad(() => api.planMonth(space.id, overview.month), [api, space.id, overview.month, version]);
  return <div className="cr-dashboard">
    <LoadState loaded={plan}>{data => <DashboardPlan plan={data} overview={overview} view={view} />}</LoadState>
  </div>;
}

function DashboardPlan({ plan, overview, view }: { readonly plan: PlanMonth; readonly overview: Overview; readonly view: CurrencyOverview }) {
  const { api, space, version } = useWorkspace();
  const { name } = useI18n();
  const c = useUiCopy();
  const totals = dashboardTotals(plan, view.currency);
  const items = plan.groups.flatMap(group => [...group.items, ...(group.flex ? [group.flex] : [])]);
  const hasReserves = items.some(item => item.kind === 'reserve' || item.kind === 'loan_payment');
  const hasSavings = items.some(item => item.kind === 'goal');
  const activity = useLoad(() => loadMonthActivity(api, space.id, overview.month), [api, space.id, overview.month, version]);
  const segments = view.setAsideByGroup.filter(group => group.amount !== 0n);
  const positive = segments.filter(group => group.amount > 0n);
  const positiveTotal = positive.reduce((sum, group) => sum + group.amount, 0n);
  const total = segments.reduce((sum, group) => sum + group.amount, 0n);
  let offset = 0;
  const colors = ['#17634f', '#58ac92', '#e1b751', '#7492bd', '#986eac', '#a5beb0'];
  const stops = positive.map((group, index) => {
    const start = offset;
    offset += Number(group.amount * 10000n / (positiveTotal || 1n)) / 100;
    return `${colors[index % colors.length]} ${start}% ${offset}%`;
  });
  return <>
    <div className="cr-dashboard-metrics">
      <Metric label={c('availableSpend')} help={c('availableHelp')} amount={totals.available} currency={view.currency} Icon={ShoppingCart} />
      <article className="cr-card cr-metric"><ChartNoAxesCombined size={22} aria-hidden /><div><p className="cr-helper">{c('spentMonth')}</p><LoadState loaded={activity}>{entries => <Amount minor={spendingSeries(entries, view.currency, overview.month, overview.today).at(-1)?.amount ?? 0n} currency={view.currency} />}</LoadState><p className="cr-helper">{c('netSpending')}</p></div></article>
      {hasReserves ? <Metric label={c('reserves')} help={c('reservesHelp')} amount={totals.reserves} currency={view.currency} Icon={ShieldCheck} /> : null}
      {hasSavings ? <Metric label={c('savings')} help={c('savingsHelp')} amount={totals.savings} currency={view.currency} Icon={PiggyBank} /> : null}
    </div>
    <div className="cr-dashboard-charts">
      <section className="cr-card" aria-labelledby="spending-heading"><h2 id="spending-heading">{c('spendingChart')}</h2><p className="cr-helper">{c('spendingHelp')}</p><LoadState loaded={activity}>{entries => <SpendingChart entries={entries} overview={overview} view={view} plan={plan} />}</LoadState></section>
      <section className="cr-card" aria-labelledby="allocation-heading"><h2 id="allocation-heading">{c('allocation')}</h2>{segments.length === 0 ? <p className="cr-helper">{c('noAllocation')}</p> : <div className="cr-allocation"><div className="cr-donut" style={{ background: stops.length ? `conic-gradient(${stops.join(',')})` : '#e1ece7' }}><div><Amount minor={total} currency={view.currency} /><span>{c('totalAssigned')}</span></div></div><ul className="cr-chart-legend">{segments.map(group => <li key={group.groupId}><span className="cr-chart-dot" style={{ background: group.amount < 0n ? 'var(--cr-danger)' : colors[positive.indexOf(group) % colors.length] }} aria-hidden /><bdi>{name(group)}{group.amount < 0n ? <small className="cr-over-label">{c('needsCovering')}</small> : null}</bdi><Amount minor={group.amount} currency={view.currency} tone={group.amount < 0n ? 'negative' : 'plain'} /></li>)}</ul></div>}</section>
    </div>
    <section className="cr-card" aria-labelledby="progress-heading"><div className="cr-section-header"><h2 id="progress-heading">{c('categoryProgress')}</h2><button className="text-button" type="button" onClick={() => navigate({ name: 'plan', month: overview.month })}>{c('viewPlan')}</button></div><p className="cr-helper">{c('spentPlanned')} · {plan.planCurrency}</p>{view.currency !== plan.planCurrency ? <p className="cr-helper">{c('currencyPlan')}</p> : null}{plan.groups.length === 0 ? <p className="cr-helper">{c('noCategories')}</p> : <ul className="cr-category-progress">{plan.groups.map(group => {
      const ratio = group.planned > 0n ? Number(group.spent * 10000n / group.planned) / 100 : group.spent > 0n ? 100 : 0;
      const over = group.spent > group.planned;
      return <li key={group.groupId}><bdi>{name(group)}</bdi><progress aria-label={name(group)} max={100} value={Math.max(0, Math.min(100, ratio))} className={over ? 'cr-progress-over' : ''} /><span><Amount minor={group.spent} currency={plan.planCurrency} /> / <Amount minor={group.planned} currency={plan.planCurrency} />{over ? <small className="cr-over-label">{c('overspent')}</small> : null}</span></li>;
    })}</ul>}</section>
  </>;
}

function Metric({ label, help, amount, currency, Icon }: { label: string; help: string; amount: bigint; currency: CurrencyOverview['currency']; Icon: typeof ShoppingCart }) {
  return <article className="cr-card cr-metric"><Icon size={22} aria-hidden /><div><p className="cr-helper">{label}</p><Amount minor={amount} currency={currency} /><p className="cr-helper">{help}</p></div></article>;
}

function SpendingChart({ entries, overview, view, plan }: { entries: Entry[]; overview: Overview; view: CurrencyOverview; plan: PlanMonth }) {
  const { money, date } = useI18n();
  const c = useUiCopy();
  const points = spendingSeries(entries, view.currency, overview.month, overview.today);
  const planned = view.currency === plan.planCurrency ? plannedSpending(plan) : 0n;
  const values = points.map(point => point.amount);
  const max = values.reduce((a, b) => b > a ? b : a, planned > 0n ? planned : 1n);
  const min = values.reduce((a, b) => b < a ? b : a, 0n);
  const range = max - min || 1n;
  const lastDay = Number(endOfMonth(overview.month).slice(-2));
  const x = (day: number) => 66 + day / lastDay * 510;
  const y = (amount: bigint) => 225 - Number((amount - min) * 10000n / range) / 10000 * 195;
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.amount)}`).join(' ');
  const latest = points.at(-1)?.amount ?? 0n;
  return <>
    <div className="cr-chart-key"><span><i />{c('actual')}</span>{planned > 0n ? <span><i className="cr-chart-key-plan" />{c('plannedPace')}</span> : null}<strong>{money(latest, view.currency)}</strong></div>
    <svg className="cr-spending-chart" viewBox="0 0 610 270" role="img" aria-label={`${c('spendingChart')}: ${money(latest, view.currency)}`}>
      {[0, 1, 2].map(step => { const amount = min + range * BigInt(step) / 2n; return <g key={step}><line x1={66} x2={576} y1={y(amount)} y2={y(amount)} className="cr-chart-grid" /><text x={58} y={y(amount) + 4} textAnchor="end">{money(amount, view.currency)}</text></g>; })}
      {planned > 0n ? <path d={`M ${x(0)} ${y(0n)} L ${x(lastDay)} ${y(planned)}`} className="cr-chart-pace" /> : null}
      <path d={`${path} L ${x(points.length - 1)} ${y(0n)} L ${x(0)} ${y(0n)} Z`} className="cr-chart-area" />
      <path d={path} className="cr-chart-actual" />
      {[1, Math.ceil(lastDay / 2), lastDay].map(day => <text key={day} x={x(day)} y={252} textAnchor="middle">{date(`${overview.month.slice(0, 7)}-${String(day).padStart(2, '0')}`, 'short')}</text>)}
    </svg>
    {values.every(value => value === 0n) ? <p className="cr-helper">{c('noSpending')}</p> : null}
    <details className="cr-chart-data"><summary>{c('breakdown')}</summary><table><thead><tr><th>{c('actual')}</th><th>{c('spentMonth')}</th></tr></thead><tbody>{points.slice(1).map(point => <tr key={point.on}><td>{date(point.on, 'short')}</td><td>{money(point.amount, view.currency)}</td></tr>)}</tbody></table></details>
  </>;
}
