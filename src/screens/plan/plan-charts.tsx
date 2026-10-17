import { useState } from 'react';
import type { PlanMonth } from '../../api/schemas.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { purposeItems } from '../../lib/money-purpose.ts';
import { expenseGroups } from '../home/dashboard-model.ts';
import { useUiCopy } from '../../lib/ui-copy.ts';
import { chartColors, chartPercent, DonutChart } from '../../ui/charts.tsx';
import { Amount } from '../../ui/money.tsx';

export function PlanCharts({ plan }: { readonly plan: PlanMonth }) {
  const { t, name, money, digits, date, locale } = useI18n();
  const c = useUiCopy();
  const copy = (en: string, ar: string) => locale === 'ar' ? ar : en;
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'budget' | 'remaining'>('budget');
  const selectedIndex = plan.groups.findIndex(group => group.groupId === selectedGroup);
  const selection = plan.groups[selectedIndex];
  const currency = plan.planCurrency;
  const total = plan.groups.reduce((sum, group) => sum + group.planned, 0n);
  const rows = expenseGroups(plan).filter(group => group.expenseItems.length > 0).map(group => ({ id: group.groupId, label: name(group), planned: group.planned, spent: group.spent, items: group.expenseItems })).sort((a, b) => {
    const first = sortBy === 'budget' ? b.planned : a.planned - a.spent;
    const second = sortBy === 'budget' ? a.planned : b.planned - b.spent;
    return first < second ? -1 : first > second ? 1 : a.label.localeCompare(b.label);
  });
  const targets = purposeItems(plan).filter(({ item }) => item.planned > 0n);
  const goals = purposeItems(plan).filter(({ item }) => item.targetMinor !== null && item.targetMinor > 0n && (item.targetDate === null || item.targetDate >= plan.today));
  return <>
    <div className="cr-dashboard-charts cr-plan-charts">
      <section className="cr-card cr-chart-card" aria-labelledby="plan-comparison-heading">
        <h2 id="plan-comparison-heading">{c('planComparison')}</h2><p className="cr-helper">{c('planComparisonHelp')}</p>
        <div className="cr-chart-tools" role="group" aria-label={copy('Sort spending categories', 'ترتيب فئات الإنفاق')}><button className="cr-chip" type="button" aria-pressed={sortBy === 'budget'} onClick={() => setSortBy('budget')}>{copy('Largest budget', 'الأكبر ميزانية')}</button><button className="cr-chip" type="button" aria-pressed={sortBy === 'remaining'} onClick={() => setSortBy('remaining')}>{copy('Least remaining', 'الأقل متبقيًا')}</button></div>
        <p className="cr-helper">{copy('Select a category to see its items. The marker shows your planned limit.', 'اختر فئة لعرض بنودها. تشير العلامة إلى حد الميزانية المخطط.')}</p>
        {!rows.length ? <p className="cr-helper">{c('noSpendingGroups')}</p> : <ul className="cr-comparison-list">{rows.map(row => <li key={row.id}>
          <details className="cr-budget-detail"><summary><span className="cr-section-header"><bdi>{row.label}</bdi><span className={row.spent > row.planned ? 'cr-over-label' : 'cr-helper'}>{money(row.planned > row.spent ? row.planned - row.spent : row.spent - row.planned, currency)} · {row.spent > row.planned ? c('overspent') : copy('left', 'متبقٍ')}</span></span>
          <span className="cr-budget-track" aria-hidden><span style={{ inlineSize: `${chartPercent(row.spent, row.spent > row.planned ? row.spent : row.planned)}%`, background: row.spent > row.planned ? 'var(--cr-danger)' : 'var(--cr-accent)' }} /><i style={{ insetInlineStart: `${Math.min(99, chartPercent(row.planned, row.spent > row.planned ? row.spent : row.planned))}%` }} /></span>
          <span className="cr-budget-caption"><span>{t('plan.spent')}: <bdi>{money(row.spent, currency)}</bdi></span><span>{t('plan.planned')}: <bdi>{money(row.planned, currency)}</bdi></span></span></summary>
          <div className="cr-budget-items"><h3>{copy('Item breakdown', 'تفاصيل البنود')}</h3><dl>{row.items.map(item => <div key={item.itemId}><dt><bdi>{name(item)}</bdi></dt><dd><bdi>{money(item.spent, currency)}</bdi><span className="cr-helper"> / <bdi>{money(item.planned, currency)}</bdi></span></dd></div>)}</dl></div></details>
        </li>)}</ul>}
      </section>
      <section className="cr-card cr-chart-card" aria-labelledby="budget-mix-heading">
        <h2 id="budget-mix-heading">{c('budgetMix')}</h2><p className="cr-helper">{c('budgetMixHelp')}</p>
        {total > 0n ? <><div className="cr-allocation"><DonutChart label={c('budgetMix')} selectedIndex={selectedIndex >= 0 ? selectedIndex : undefined} onSelect={index => setSelectedGroup(plan.groups[index]!.groupId)} segments={plan.groups.map((group, index) => ({ value: group.planned, color: chartColors[index % chartColors.length]!, label: `${name(group)}: ${money(group.planned, currency)}` }))}><Amount minor={selection?.planned ?? total} currency={currency} /><span>{selection ? name(selection) : c('totalPlanned')}</span>{selection ? <strong>{digits(String(Math.round(chartPercent(selection.planned, total))))}%</strong> : null}</DonutChart>
          <ul className="cr-chart-legend cr-allocation-options">{plan.groups.map((group, index) => <li key={group.groupId}><button type="button" aria-pressed={selectedGroup === group.groupId} onClick={() => setSelectedGroup(group.groupId)} onFocus={() => setSelectedGroup(group.groupId)} onPointerEnter={event => { if (event.pointerType === 'mouse') setSelectedGroup(group.groupId); }}><span className="cr-chart-dot" style={{ background: chartColors[index % chartColors.length] }} aria-hidden /><bdi>{name(group)}</bdi><span className="cr-helper">{digits(String(Math.round(chartPercent(group.planned, total))))}%</span><Amount minor={group.planned} currency={currency} /></button></li>)}</ul>
        </div><div className="cr-chart-footer"><span className="cr-helper">{copy('Hover or select a category to explore your budget.', 'مرّر المؤشر أو اختر فئة لاستكشاف ميزانيتك.')}</span>{selection ? <button className="text-button" type="button" onClick={() => setSelectedGroup(null)}>{copy('Show total budget', 'عرض إجمالي الميزانية')}</button> : null}</div></> : <p className="cr-helper">{c('noCategories')}</p>}
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
