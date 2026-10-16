import type { PlanMonth } from '../../api/schemas.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { itemPurpose, purposeItems } from '../../lib/money-purpose.ts';
import { useUiCopy } from '../../lib/ui-copy.ts';
import { chartColors, chartPercent, ChartLegend, ChartSwatch, DonutChart } from '../../ui/charts.tsx';
import { Amount } from '../../ui/money.tsx';

export function PlanCharts({ plan }: { readonly plan: PlanMonth }) {
  const { t, name, money, digits, date } = useI18n();
  const c = useUiCopy();
  const currency = plan.planCurrency;
  const total = plan.groups.reduce((sum, group) => sum + group.planned, 0n);
  const rows = plan.groups.map(group => {
    const spending = [...group.items, ...(group.flex ? [group.flex] : [])].filter(item => ['spending', 'reserve'].includes(itemPurpose(group, item)));
    return { id: group.groupId, label: name(group), planned: spending.reduce((sum, item) => sum + item.planned, 0n), spent: spending.reduce((sum, item) => sum + item.spent, 0n), hasSpending: spending.length > 0 };
  }).filter(row => row.hasSpending);
  const scale = rows.reduce((max, row) => [row.planned, row.spent].reduce((value, amount) => amount > value ? amount : value, max), 1n);
  const targets = purposeItems(plan).filter(({ item }) => item.planned > 0n);
  const goals = purposeItems(plan).filter(({ item }) => item.targetMinor !== null && item.targetMinor > 0n && (item.targetDate === null || item.targetDate >= plan.today));
  return <>
    <div className="cr-dashboard-charts cr-plan-charts">
      <section className="cr-card cr-chart-card" aria-labelledby="plan-comparison-heading">
        <h2 id="plan-comparison-heading">{c('planComparison')}</h2><p className="cr-helper">{c('planComparisonHelp')}</p>
        <ChartLegend><ChartSwatch color="var(--cr-chart-2)">{t('plan.planned')}</ChartSwatch><ChartSwatch color="var(--cr-accent)">{t('plan.spent')}</ChartSwatch></ChartLegend>
        {!rows.length ? <p className="cr-helper">{c('noSpendingGroups')}</p> : <ul className="cr-comparison-list">{rows.map(row => <li key={row.id}>
          <div className="cr-section-header"><bdi>{row.label}</bdi>{row.spent > row.planned ? <span className="cr-over-label">{c('overspent')}</span> : null}</div>
          <div className="cr-comparison-line"><span className="cr-bar-track" aria-hidden><span style={{ inlineSize: `${chartPercent(row.planned, scale)}%`, background: 'var(--cr-chart-2)' }} /></span><span className="cr-chart-value"><span className="cr-sr-only">{t('plan.planned')}: </span>{money(row.planned, currency)}</span></div>
          <div className="cr-comparison-line"><span className="cr-bar-track" aria-hidden><span style={{ inlineSize: `${chartPercent(row.spent, scale)}%`, background: row.spent > row.planned ? 'var(--cr-danger)' : 'var(--cr-accent)' }} /></span><span className="cr-chart-value"><span className="cr-sr-only">{t('plan.spent')}: </span>{money(row.spent, currency)}</span></div>
        </li>)}</ul>}
      </section>
      <section className="cr-card cr-chart-card" aria-labelledby="budget-mix-heading">
        <h2 id="budget-mix-heading">{c('budgetMix')}</h2><p className="cr-helper">{c('budgetMixHelp')}</p>
        {total > 0n ? <div className="cr-allocation"><DonutChart label={c('budgetMix')} segments={plan.groups.map((group, index) => ({ value: group.planned, color: chartColors[index % chartColors.length]!, label: `${name(group)}: ${money(group.planned, currency)}` }))}><Amount minor={total} currency={currency} /><span>{c('totalPlanned')}</span></DonutChart>
          <ul className="cr-chart-legend">{plan.groups.map((group, index) => <li key={group.groupId}><span className="cr-chart-dot" style={{ background: chartColors[index % chartColors.length] }} aria-hidden /><bdi>{name(group)}</bdi><span className="cr-helper">{digits(String(Math.round(chartPercent(group.planned, total))))}%</span><Amount minor={group.planned} currency={currency} /></li>)}</ul>
        </div> : <p className="cr-helper">{c('noCategories')}</p>}
      </section>
    </div>
    <section className="cr-card cr-chart-card" aria-labelledby="funding-progress-heading">
      <h2 id="funding-progress-heading">{c('fundingProgress')}</h2><p className="cr-helper">{c('fundingProgressHelp')}</p>
      {!targets.length ? <p className="cr-helper">{c('noFundingTargets')}</p> : <ul className="cr-funding-grid">{plan.groups.filter(group => [...group.items, ...(group.flex ? [group.flex] : [])].some(item => item.planned > 0n)).map((group) => {
        const items = [...group.items, ...(group.flex ? [group.flex] : [])].filter(item => item.planned > 0n);
        const planned = items.reduce((sum, item) => sum + item.planned, 0n);
        const needed = items.reduce((sum, item) => sum + (item.stillToFund > item.planned ? item.planned : item.stillToFund > 0n ? item.stillToFund : 0n), 0n);
        const percent = chartPercent(planned - needed, planned);
        return <li key={group.groupId}><div className="cr-section-header"><bdi>{name(group)}</bdi><strong>{digits(String(Math.floor(percent)))}%</strong></div><progress max="100" value={percent} aria-label={`${name(group)} · ${c('fundedTarget')}`} /><span className="cr-helper">{needed > 0n ? `${c('remainingTarget')}: ${money(needed, currency)}` : c('targetReached')}</span></li>;
      })}</ul>}
    </section>
    {goals.length ? <section className="cr-card cr-chart-card" aria-labelledby="goal-progress-heading"><h2 id="goal-progress-heading">{c('goalProgress')}</h2><p className="cr-helper">{c('goalProgressHelp')}</p><ul className="cr-funding-grid">{goals.map(({ item }) => <li key={item.itemId}><div className="cr-section-header"><bdi>{name(item)}</bdi>{item.targetDate ? <span className="cr-helper">{date(item.targetDate, 'short')}</span> : null}</div><progress max="100" value={chartPercent(item.available, item.targetMinor!)} aria-label={name(item)} /><p className="cr-helper">{money(item.available, currency)} / {money(item.targetMinor!, currency)}</p></li>)}</ul></section> : null}
  </>;
}
