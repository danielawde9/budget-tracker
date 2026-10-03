import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { PlanGroup, PlanItem, PlanMonth } from '../../api/schemas.ts';
import { navigate } from '../../app/router.ts';
import { PageHeader } from '../../app/shell.tsx';
import { useWorkspace } from '../../app/workspace.tsx';
import { useI18n, type MessageKey } from '../../lib/i18n.tsx';
import { bpsToPercentText } from '../../lib/plan-math.ts';
import type { RecordIntent } from '../../record/record-dialog.tsx';
import { LoadState, useLoad } from '../../ui/async.tsx';
import { Amount } from '../../ui/money.tsx';
import { addMonths } from '../describe.ts';
import { BillsSection } from './bills-section.tsx';
import { ItemStatementDialog } from './item-statement.tsx';
import { PlanEditorDialog } from './plan-editor.tsx';

export const KIND_LABEL: Readonly<Record<PlanItem['kind'], MessageKey>> = {
  ready: 'common.readyToAssign',
  spending: 'kind.spending',
  reserve: 'kind.reserve',
  goal: 'kind.goal',
  flex: 'kind.flex',
  loan_payment: 'kind.loan_payment',
};

export function PlanScreen({ month, onRecord }: { readonly month: string; readonly onRecord: (intent: RecordIntent) => void }) {
  const { t, date } = useI18n();
  const { api, space, version } = useWorkspace();
  const plan = useLoad(() => api.planMonth(space.id, month), [api, space.id, month, version]);
  const [editing, setEditing] = useState(false);
  const [statement, setStatement] = useState<PlanItem | null>(null);
  const isCurrent = month === space.currentMonth;
  const goTo = (offset: number) => navigate({ name: 'plan', month: addMonths(month, offset) });
  return (
    <>
      <PageHeader
        title={t('nav.plan')}
        subtitle={
          <span className="cr-month-nav">
            <button type="button" className="cr-icon-button" aria-label={t('plan.previousMonth')} onClick={() => goTo(-1)}><ChevronLeft aria-hidden size={18} className="cr-flip-rtl" /></button>
            <strong>{date(month, 'month')}</strong>
            <button type="button" className="cr-icon-button" aria-label={t('plan.nextMonth')} onClick={() => goTo(1)}><ChevronRight aria-hidden size={18} className="cr-flip-rtl" /></button>
            {isCurrent ? null : <button type="button" className="text-button" onClick={() => navigate({ name: 'plan', month: null })}>{t('plan.thisMonth')}</button>}
          </span>
        }
        actions={
          <>
            <button type="button" className="cr-button" onClick={() => onRecord({ kind: 'move' })}>{t('plan.move')}</button>
            <button type="button" className="cr-button" onClick={() => setEditing(true)}>{t('plan.edit')}</button>
            {isCurrent ? <button type="button" className="cr-button cr-button--primary" onClick={() => onRecord({ kind: 'fund', month })}>{t('plan.fund')}</button> : null}
          </>
        }
      />
      <LoadState loaded={plan}>
        {(data) => (
          <div className="cr-plan">
            <PlanSummary plan={data} />
            {data.groups.map((group, index) => (
              <GroupCard key={group.groupId} group={group} index={index} currency={data.planCurrency} today={data.today} onOpen={setStatement} />
            ))}
            <BillsSection onRecord={onRecord} />
            {editing ? <PlanEditorDialog plan={data} month={month} onClose={() => setEditing(false)} /> : null}
            {statement ? <ItemStatementDialog item={statement} month={month} onClose={() => setStatement(null)} onRecord={(intent) => { setStatement(null); onRecord(intent); }} /> : null}
          </div>
        )}
      </LoadState>
    </>
  );
}

function PlanSummary({ plan }: { readonly plan: PlanMonth }) {
  const { t, money, name, digits } = useI18n();
  const currency = plan.planCurrency;
  const plannedBps = plan.groups.reduce((sum, group) => sum + group.percentBps, 0);
  // A past month shows what was left unassigned when it ended, not today's figure.
  const ready = plan.isPast ? plan.readyAtMonthEnd : plan.ready;
  return (
    <section className="cr-card" aria-labelledby="plan-summary-heading">
      <h2 id="plan-summary-heading">{plan.isPast ? t('plan.summaryPast') : t('plan.summary')}</h2>
      <dl className="cr-figures">
        <div><dt>{t('plan.expectedIncome')}</dt><dd><Amount minor={plan.expectedIncome} currency={currency} /></dd></div>
        <div><dt>{t('plan.received')}</dt><dd><Amount minor={plan.received} currency={currency} /></dd></div>
        <div><dt>{t('plan.funded')}</dt><dd><Amount minor={plan.funded} currency={currency} /></dd></div>
        <div><dt>{t('plan.stillToFund')}</dt><dd><Amount minor={plan.stillToFund} currency={currency} tone={plan.stillToFund > 0n ? 'warn' : 'plain'} /></dd></div>
        <div><dt>{plan.isPast ? t('plan.readyAtMonthEnd') : t('common.readyToAssign')}</dt><dd><Amount minor={ready} currency={currency} tone={ready < 0n ? 'negative' : 'plain'} /></dd></div>
      </dl>
      <div className="cr-stack-bar" role="img" aria-label={t('plan.barLabel')}>
        {plan.groups.map((group, index) => (
          <span key={group.groupId} className={`cr-stack-bar-part cr-tone-${index % 6}`} style={{ flexGrow: group.percentBps }} title={`${name(group)} ${bpsToPercentText(group.percentBps)}%`} />
        ))}
        {plannedBps < 10000 ? <span className="cr-stack-bar-part cr-stack-bar-rest" style={{ flexGrow: 10000 - plannedBps }} /> : null}
      </div>
      <p className="cr-helper">
        {t('plan.plannedLine', { percent: digits(bpsToPercentText(plannedBps)), notPlanned: money(plan.notPlanned, currency) })}
        {plan.overPlanned > 0n ? ` ${t('plan.overLine', { amount: money(plan.overPlanned, currency) })}` : ''}
      </p>
      <p className="cr-helper">{t('plan.howItWorks')}</p>
    </section>
  );
}

function GroupCard({ group, index, currency, today, onOpen }: {
  readonly group: PlanGroup;
  readonly index: number;
  readonly currency: PlanMonth['planCurrency'];
  readonly today: string;
  readonly onOpen: (item: PlanItem) => void;
}) {
  const { t, money, name, digits } = useI18n();
  const rows = [...group.items, ...(group.flex ? [group.flex] : [])];
  return (
    <details className="cr-card cr-group" open={index === 0}>
      <summary className="cr-group-summary">
        <span className={`cr-dot cr-tone-${index % 6}`} aria-hidden="true" />
        <span className="cr-group-name"><bdi>{name(group)}</bdi> <span className="cr-helper">{digits(bpsToPercentText(group.percentBps))}%</span></span>
        <span className="cr-group-figures">
          <span><span className="cr-label">{t('plan.planned')}</span><Amount minor={group.planned} currency={currency} /></span>
          <span><span className="cr-label">{t('plan.spent')}</span><Amount minor={group.spent} currency={currency} /></span>
          <span><span className="cr-label">{t('plan.available')}</span><Amount minor={group.available} currency={currency} /></span>
        </span>
      </summary>
      {group.over > 0n ? <p className="cr-explain cr-explain--warn">{t('plan.groupOver', { amount: money(group.over, currency) })}</p> : null}
      <table className="cr-plan-table">
        <thead>
          <tr>
            <th scope="col">{t('common.item')}</th>
            <th scope="col">{t('plan.planned')}</th>
            <th scope="col">{t('plan.funded')}</th>
            <th scope="col">{t('plan.spent')}</th>
            <th scope="col">{t('plan.available')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <ItemRow key={item.itemId} item={item} currency={currency} today={today} onOpen={() => onOpen(item)} />
          ))}
        </tbody>
      </table>
      {group.otherOut > 0n ? <p className="cr-helper">{t('plan.otherOutLine', { amount: money(group.otherOut, currency) })}</p> : null}
    </details>
  );
}

function ItemRow({ item, currency, today, onOpen }: { readonly item: PlanItem; readonly currency: PlanMonth['planCurrency']; readonly today: string; readonly onOpen: () => void }) {
  const { t, money, name, date, digits } = useI18n();
  const other = currency === 'USD' ? 'LBP' : 'USD';
  // Progress toward a target only means something until its date has passed.
  const showProgress = item.targetMinor !== null && item.targetMinor > 0n && (item.targetDate === null || item.targetDate >= today);
  const progress = showProgress && item.targetMinor ? Number((item.available * 100n) / item.targetMinor) : null;
  return (
    <tr className={item.kind === 'flex' ? 'cr-plan-row cr-plan-row--flex' : 'cr-plan-row'}>
      <th scope="row">
        <button type="button" className="cr-link-button" onClick={onOpen}>
          <bdi>{name(item)}</bdi>
        </button>
        <span className="cr-kind">{t(KIND_LABEL[item.kind])}</span>
        {item.broughtForward !== 0n ? <span className="cr-helper">{t('plan.broughtForward', { amount: money(item.broughtForward, currency) })}</span> : null}
        {item.opening !== 0n ? <span className="cr-helper">{t('plan.openingLine', { amount: money(item.opening, currency) })}</span> : null}
        {progress !== null && item.targetMinor ? (
          <span className="cr-goal">
            <span className="cr-progress" aria-hidden="true"><span style={{ inlineSize: `${Math.min(progress, 100)}%` }} /></span>
            <span className="cr-helper">{t('plan.goalProgress', { saved: money(item.available, currency), target: money(item.targetMinor, currency), percent: digits(String(Math.min(progress, 999))) })}{item.targetDate ? ` · ${date(item.targetDate)}` : ''}</span>
          </span>
        ) : null}
      </th>
      <td><Amount minor={item.planned} currency={currency} /></td>
      <td>
        <Amount minor={item.funded} currency={currency} />
        {item.stillToFund > 0n ? <span className="cr-helper">{t('plan.needs', { amount: money(item.stillToFund, currency) })}</span> : null}
      </td>
      <td>
        <Amount minor={item.spent} currency={currency} />
        {item.otherOut !== 0n ? <span className="cr-helper">{t('plan.otherOutItem', { amount: money(item.otherOut, currency) })}</span> : null}
      </td>
      <td>
        <Amount minor={item.available} currency={currency} />
        {item.balances[other] !== 0n ? <Amount minor={item.balances[other]} currency={other} className="cr-amount--secondary" /> : null}
      </td>
    </tr>
  );
}
