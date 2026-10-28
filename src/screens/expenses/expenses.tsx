import { useState } from 'react';
import type { Entry, SpaceSummary } from '../../api/schemas.ts';
import { PageHeader } from '../../app/shell.tsx';
import { useWorkspace } from '../../app/workspace.tsx';
import { useI18n } from '../../lib/i18n.tsx';
import type { Currency } from '../../lib/money.ts';
import { useUiCopy } from '../../lib/ui-copy.ts';
import type { RecordIntent } from '../../record/record-dialog.tsx';
import { ErrorNotice, useLoad } from '../../ui/async.tsx';
import { chartPercent } from '../../ui/charts.tsx';
import { Amount } from '../../ui/money.tsx';
import { loadMonthActivity, spendingByCategory } from '../home/dashboard-model.ts';

export function ExpensesScreen({ onRecord }: { readonly onRecord: (intent: RecordIntent) => void }) {
  const { t, date } = useI18n();
  const c = useUiCopy();
  const { api, space, version } = useWorkspace();
  const activity = useLoad(
    () => loadMonthActivity(api, space.id, space.currentMonth),
    [api, space.id, space.currentMonth, version],
  );

  return <>
    <PageHeader title={c('expenseProgress')} subtitle={`${c('activeMonth')} · ${date(space.currentMonth, 'month')}`}
      actions={<a className="cr-button" href="#/activity">{t('nav.activity')}</a>} />
    {activity.status === 'error' ? <ErrorNotice error={activity.error} onRetry={activity.reload} /> : null}
    {activity.status === 'loading' ? <p className="cr-helper" role="status">{t('common.loading')}</p> : null}
    {activity.status === 'ready' ? <CategoryTotals key={`${space.id}:${space.currentMonth}`} entries={activity.data} space={space} onRecord={onRecord} /> : null}
  </>;
}

function CategoryTotals({ entries, space, onRecord }: {
  readonly entries: readonly Entry[];
  readonly space: SpaceSummary;
  readonly onRecord: (intent: RecordIntent) => void;
}) {
  const { t, name, locale, digits } = useI18n();
  const c = useUiCopy();
  const [currency, setCurrency] = useState<Currency>(space.planCurrency);
  const rows = spendingByCategory(entries, currency, space.currentMonth, space.today);
  const total = rows.reduce((sum, row) => sum + row.amount, 0n);
  const positiveTotal = rows.reduce((sum, row) => sum + (row.amount > 0n ? row.amount : 0n), 0n);
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });

  return <section className="cr-card cr-category-totals" aria-labelledby="total-expenses-heading">
    <div className="cr-section-header">
      <h2 id="total-expenses-heading">{c('totalExpenses')}</h2>
      <div className="cr-tabs" role="group" aria-label={t('common.currency')}>
        {(['USD', 'LBP'] as const).map(value => <button key={value} type="button"
          className={`cr-tab-button${currency === value ? ' cr-tab-button--active' : ''}`}
          aria-pressed={currency === value} onClick={() => setCurrency(value)}>{value}</button>)}
      </div>
    </div>
    <p className="cr-category-total"><Amount minor={total} currency={currency} /></p>
    <p className="cr-helper">{c('actualCategoriesHelp')} {c('netSpending')}.</p>
    {rows.length > 0 ? <>
      <table className="cr-category-table" aria-label={c('categoryTotals')}>
        <thead><tr><th scope="col">{c('expenseCategory')}</th><th scope="col">{t('plan.spent')}</th><th scope="col">{c('categoryShare')}</th></tr></thead>
        <tbody>{rows.map(row => {
          const share = chartPercent(row.amount, positiveTotal);
          return <tr key={row.itemId}>
            <th scope="row">
              <bdi>{name(row)}</bdi>
              {row.amount < 0n ? <span className="cr-helper">{c('netRefunds')}</span> : <span className="cr-category-share-track" aria-hidden="true"><span style={{ inlineSize: `${share}%` }} /></span>}
            </th>
            <td><Amount minor={row.amount} currency={currency} /></td>
            <td>{row.amount > 0n ? digits(percent.format(share / 100)) : '—'}</td>
          </tr>;
        })}</tbody>
      </table>
      {rows.some(row => row.amount < 0n) ? <p className="cr-helper">{c('categoryShareHelp')}</p> : null}
    </> : <div className="cr-category-empty">
      <h3>{c('noCategoryExpenses')}</h3>
      <p className="cr-helper">{c('noCategoryExpensesHelp')}</p>
      <button type="button" className="cr-button cr-button--primary" onClick={() => onRecord({ kind: 'expense' })}>{t('statement.spend')}</button>
    </div>}
  </section>;
}
