import type { CurrencyOverview, Overview, PlanMonth, Entry } from '../../api/schemas.ts';
import { useWorkspace } from '../../app/workspace.tsx';
import { useI18n } from '../../lib/i18n.tsx';
import { useUiCopy } from '../../lib/ui-copy.ts';
import { LoadState, useLoad } from '../../ui/async.tsx';
import { Amount } from '../../ui/money.tsx';
import { endOfMonth } from '../describe.ts';
import { expenseEntries, expenseGroupRows, loadMonthActivity, spendingSeries, plannedSpending } from './dashboard-model.ts';

export function Dashboard({ overview, view }: { readonly overview: Overview; readonly view: CurrencyOverview }) {
  const { api, space, version } = useWorkspace();
  const plan = useLoad(() => api.planMonth(space.id, overview.month), [api, space.id, overview.month, version]);
  const activity = useLoad(() => loadMonthActivity(api, space.id, overview.month), [api, space.id, overview.month, version]);
  return <div className="cr-dashboard"><LoadState loaded={plan}>{data => <LoadState loaded={activity}>{entries => <DashboardPlan plan={data} entries={entries} overview={overview} view={view} />}</LoadState>}</LoadState></div>;
}

function DashboardPlan({ plan, entries, overview, view }: { readonly plan: PlanMonth; readonly entries: Entry[]; readonly overview: Overview; readonly view: CurrencyOverview }) {
  const { name } = useI18n();
  const c = useUiCopy();
  const expenses = expenseEntries(entries, plan);
  const groups = expenseGroupRows(plan, entries, view.currency, overview.month, overview.today);
  const progressGroups = view.currency === plan.planCurrency ? groups : expenseGroupRows(plan, entries, plan.planCurrency, overview.month, overview.today);
  const spent = groups.reduce((sum, group) => sum + group.spent, 0n);
  const planned = view.currency === plan.planCurrency ? groups.reduce((sum, group) => sum + group.planned, 0n) : null;
  return <>
    <section className="cr-expense-summary" aria-labelledby="monthly-expenses-heading">
      <h2 id="monthly-expenses-heading">{c('monthlyExpenses')}</h2><p className="cr-helper">{c('expenseScope')}</p>
      <dl className="cr-expense-totals">
        <div><dt>{c('plannedExpenses')}</dt><dd>{planned !== null ? <Amount minor={planned} currency={view.currency} /> : '—'}</dd></div>
        <div><dt>{c('spentMonth')}</dt><dd><Amount minor={spent} currency={view.currency} /></dd></div>
        <div><dt>{c('remainingExpenses')}</dt><dd>{planned !== null ? <Amount minor={planned - spent} currency={view.currency} tone={spent > planned ? 'negative' : 'plain'} /> : '—'}</dd></div>
      </dl>{planned === null ? <p className="cr-helper">{c('currencyPlan')}</p> : null}
      {planned !== null && groups.length > 0 ? <section className="cr-expense-remaining" aria-labelledby="remaining-categories-heading">
        <h3 id="remaining-categories-heading">{c('remainingByCategory')}</h3>
        <p className="cr-helper">{c('remainingBudgetHelp')}</p>
        <dl className="cr-expense-remaining-groups">{groups.map(group => <div key={group.groupId}><dt><bdi>{name(group)}</bdi></dt><dd>{group.remaining !== null ? <Amount minor={group.remaining} currency={view.currency} tone={group.remaining < 0n ? 'negative' : 'plain'} /> : '—'}</dd></div>)}</dl>
      </section> : null}
    </section>
    <div className="cr-dashboard-charts">
      <section className="cr-card" aria-labelledby="spending-heading"><h2 id="spending-heading">{c('spendingChart')}</h2><p className="cr-helper">{c('spendingHelp')}</p><SpendingChart entries={expenses} overview={overview} view={view} plan={plan} /></section>
      <section className="cr-card" aria-labelledby="expense-breakdown-heading"><h2 id="expense-breakdown-heading">{c('spendingWhere')}</h2><p className="cr-helper">{c('netSpending')}</p>{groups.length ? <ul className="cr-chart-legend cr-expense-breakdown">{groups.map(group => <li key={group.groupId}><bdi>{name(group)}</bdi><Amount minor={group.spent} currency={view.currency} /></li>)}</ul> : <p className="cr-helper">{c('noCategories')}</p>}{spent === 0n ? <p className="cr-helper">{c('noSpending')}</p> : null}</section>
    </div>
    <section className="cr-card" aria-labelledby="progress-heading"><h2 id="progress-heading">{c('expenseProgress')}</h2><p className="cr-helper">{c('spentPlanned')} · {plan.planCurrency}</p>{progressGroups.length === 0 ? <p className="cr-helper">{c('noCategories')}</p> : <ul className="cr-category-progress">{progressGroups.map(group => {
      const actual = group.spent;
      const ratio = group.planned > 0n ? Number(actual * 10000n / group.planned) / 100 : actual > 0n ? 100 : 0;
      const over = actual > group.planned;
      return <li key={group.groupId}><bdi>{name(group)}</bdi><progress aria-label={name(group)} max={100} value={Math.max(0, Math.min(100, ratio))} className={over ? 'cr-progress-over' : ''} /><span><Amount minor={actual} currency={plan.planCurrency} /> / <Amount minor={group.planned} currency={plan.planCurrency} /><small className="cr-category-remaining">{c('remainingCategory')}: {group.remaining !== null ? <Amount minor={group.remaining} currency={plan.planCurrency} tone={over ? 'negative' : 'plain'} /> : '—'}</small>{over ? <small className="cr-over-label">{c('overspent')}</small> : null}</span></li>;
    })}</ul>}</section>
  </>;
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
    <details className="cr-chart-data"><summary>{c('dailyExpenses')}</summary><table><thead><tr><th>{c('actual')}</th><th>{c('spentMonth')}</th></tr></thead><tbody>{points.slice(1).map(point => <tr key={point.on}><td>{date(point.on, 'short')}</td><td>{money(point.amount, view.currency)}</td></tr>)}</tbody></table></details>
  </>;
}
