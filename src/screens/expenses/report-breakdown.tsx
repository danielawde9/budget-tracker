import { ChevronDown } from 'lucide-react';
import { useI18n } from '../../lib/i18n.tsx';
import type { Currency } from '../../lib/money.ts';
import { useUiCopy } from '../../lib/ui-copy.ts';
import { chartPercent } from '../../ui/charts.tsx';
import { Amount } from '../../ui/money.tsx';
import { SelectField } from '../../ui/select-field.tsx';
import type { SpendingCategory, SpendingReport, SpendingSelection } from './spending-report.ts';

export function ReportBreakdown({ report, currency, onCurrency, view, onView, onSelect, onRecord }: {
  readonly report: SpendingReport;
  readonly currency: Currency;
  readonly onCurrency: (currency: Currency) => void;
  readonly view: string;
  readonly onView: (view: string) => void;
  readonly onSelect: (selection: SpendingSelection, category: SpendingCategory) => void;
  readonly onRecord: () => void;
}) {
  const { t, name, digits } = useI18n();
  const c = useUiCopy();
  return <section className="cr-card cr-category-totals" aria-labelledby="category-totals-heading">
    <div className="cr-section-header"><h2 id="category-totals-heading">{c('categoryTotals')}</h2>
      <div className="cr-report-breakdown-controls">
        <SelectField label={c('reportViewBy')} value={view} onChange={event => onView(event.target.value)}><option value="categories">{c('reportCategories')}</option><option value="groups">{c('reportGroups')}</option></SelectField>
        <div className="cr-tabs" role="group" aria-label={t('common.currency')}>{(['USD', 'LBP'] as const).map(value => <button key={value} type="button" className={`cr-tab-button${currency === value ? ' cr-tab-button--active' : ''}`} aria-pressed={currency === value} onClick={() => onCurrency(value)}>{value}</button>)}</div>
      </div>
    </div>
    {report.count > 0 ? <>
      <p className="cr-helper">{c('reportBreakdownHelp')} · {currency}</p>
      {view === 'categories' ? <CategoryTable rows={report.categories} currency={currency} onSelect={row => onSelect({ itemId: row.itemId }, row)} /> :
        <div className="cr-report-groups">{report.groups.map(group => <details key={group.groupId} className="cr-report-group">
          <summary><ChevronDown size={18} aria-hidden className="cr-report-disclosure-icon" /><bdi>{name(group)}</bdi><span className="cr-helper">{digits(String(group.count))} {c('reportRecords')}</span><Amount minor={group.total} currency={currency} /></summary>
          <CategoryTable rows={group.categories} currency={currency} grouped onSelect={row => onSelect({ itemId: row.itemId, groupId: group.groupId }, row)} />
        </details>)}</div>}
      {(view === 'groups' ? report.groups.some(group => group.categories.some(row => row.total < 0n)) : report.categories.some(row => row.total < 0n)) ? <p className="cr-helper">{c('categoryShareHelp')}</p> : null}
    </> : <div className="cr-category-empty"><h3>{c('noCategoryExpenses')}</h3><p className="cr-helper">{c('noCategoryExpensesHelp')} · {currency}</p><button type="button" className="cr-button cr-button--primary" onClick={onRecord}>{t('statement.spend')}</button></div>}
  </section>;
}

function CategoryTable({ rows, currency, grouped = false, onSelect }: {
  readonly rows: readonly SpendingCategory[];
  readonly currency: Currency;
  readonly grouped?: boolean;
  readonly onSelect: (row: SpendingCategory) => void;
}) {
  const { name, locale, digits } = useI18n();
  const c = useUiCopy();
  const positive = rows.reduce((sum, row) => sum + (row.total > 0n ? row.total : 0n), 0n);
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  return <table className="cr-category-table" aria-label={c('categoryTotals')}>
    <thead><tr><th scope="col">{c('expenseCategory')}</th><th scope="col">{c('reportNetExpenses')}</th><th scope="col">{c(grouped ? 'reportGroupShare' : 'categoryShare')}</th></tr></thead>
    <tbody>{rows.map(row => {
      const share = chartPercent(row.total, positive);
      return <tr key={row.itemId}>
        <th scope="row"><button type="button" className="text-button cr-report-category-button" aria-label={`${c('reportViewTransactions')}: ${name(row)}`} onClick={() => onSelect(row)}><bdi>{name(row)}</bdi></button>
          <span className="cr-helper">{digits(String(row.count))} {c('reportRecords')}</span>{row.total < 0n ? <span className="cr-helper">{c('netRefunds')}</span> : null}
          {row.total > 0n ? <span className="cr-category-share-track" aria-hidden="true"><span style={{ inlineSize: `${share}%` }} /></span> : null}</th>
        <td><Amount minor={row.total} currency={currency} /></td><td>{row.total > 0n ? digits(percent.format(share / 100)) : '—'}</td>
      </tr>;
    })}</tbody>
  </table>;
}
