import { useId, type ReactNode } from 'react';
import type { PlanMonth } from '../api/schemas.ts';
import { useWorkspace } from '../app/workspace.tsx';
import { useI18n } from '../lib/i18n.tsx';
import type { Currency } from '../lib/money.ts';
import { useUiCopy } from '../lib/ui-copy.ts';
import { LoadState, useLoad } from './async.tsx';
import { Dialog } from './dialog.tsx';
import { Amount } from './money.tsx';

function MoneyRow({ label, amount, currency, total = false }: {
  readonly label: ReactNode; readonly amount: bigint; readonly currency: Currency; readonly total?: boolean;
}) {
  return <div className={total ? 'cr-breakdown-total' : undefined}><dt>{label}</dt><dd><Amount minor={amount} currency={currency} /></dd></div>;
}

/** A fresh overview keeps current allocations independent of the viewed plan month. */
export function WalletBalanceBreakdown({ currency, onClose }: { readonly currency: Currency; readonly onClose: () => void }) {
  const { api, space, version } = useWorkspace();
  const { t, name } = useI18n();
  const c = useUiCopy();
  const overview = useLoad(() => api.overview(space.id), [api, space.id, version]);
  return <Dialog title={c('walletBreakdown')} description={currency} onClose={onClose}>
    <p className="cr-helper">{c('walletBreakdownHelp')}</p>
    <LoadState loaded={overview}>{data => {
      const pile = data.currencies.find(view => view.currency === currency);
      if (!pile) return <p className="cr-helper">{t('accounts.none')}</p>;
      const walletRemainder = pile.cashHeld - pile.wallets.reduce((sum, wallet) => sum + wallet.balance, 0n);
      const allocations = pile.setAsideByGroup.reduce((sum, group) => sum + group.amount, 0n);
      const other = pile.cashHeld - pile.ready - allocations;
      return <div className="cr-stack">
        <section aria-label={c('whereHeld')}>
          <h3>{c('whereHeld')}</h3>
          <dl className="cr-money-breakdown">
            {pile.wallets.map(wallet => <MoneyRow key={wallet.walletId} label={<bdi>{wallet.name}</bdi>} amount={wallet.balance} currency={currency} />)}
            {walletRemainder !== 0n ? <MoneyRow label={c('archivedCash')} amount={walletRemainder} currency={currency} /> : null}
            <MoneyRow label={c('recordedCash')} amount={pile.cashHeld} currency={currency} total />
          </dl>
        </section>
        <section aria-label={c('allocation')}>
          <h3>{c('allocation')}</h3>
          <dl className="cr-money-breakdown">
            {pile.setAsideByGroup.map(group => <MoneyRow key={group.groupId} label={<bdi>{name(group)}</bdi>} amount={group.amount} currency={currency} />)}
            {other !== 0n ? <MoneyRow label={c('otherAllocations')} amount={other} currency={currency} /> : null}
            <MoneyRow label={t('common.readyToAssign')} amount={pile.ready} currency={currency} />
            <MoneyRow label={c('allocationTotal')} amount={allocations + other + pile.ready} currency={currency} total />
          </dl>
          {other !== 0n ? <p className="cr-helper">{c('otherAllocationsHelp')}</p> : null}
        </section>
      </div>;
    }}</LoadState>
  </Dialog>;
}

/** The same response as the headline; no transactions or balances are changed. */
export function FundingBreakdown({ plan, onClose }: { readonly plan: PlanMonth; readonly onClose: () => void }) {
  const { t, name, date } = useI18n();
  const c = useUiCopy();
  const captionId = useId();
  const currency = plan.planCurrency;
  const detailed = plan.assignedFunding !== undefined && plan.spentFromReady !== undefined;
  const scoped = plan.fundingScope === 'planned_groups';
  const assigned = plan.assignedFunding ?? plan.funded;
  const groupedFunding = plan.groups.reduce((sum, group) => sum + (scoped && group.planned === 0n ? 0n : group.funded), 0n);
  const outside = assigned - groupedFunding;
  const matches = !detailed || assigned + plan.spentFromReady! === plan.funded;
  return <Dialog title={c('fundingBreakdown')} description={date(plan.month, 'month')} onClose={onClose} wide>
    <div className="cr-stack">
      <p className="cr-helper">{c('fundingBreakdownHelp')}</p>
      <dl className="cr-money-breakdown" aria-label={c('fundingBreakdown')}>
        <MoneyRow label={c('monthlyTarget')} amount={plan.groupsTotal} currency={currency} />
        {detailed ? <>
          <MoneyRow label={c(scoped ? 'countedAssignments' : 'assignedMonth')} amount={assigned} currency={currency} />
          <MoneyRow label={c('directReadySpending')} amount={plan.spentFromReady!} currency={currency} />
        </> : null}
        <MoneyRow label={c('countedFunding')} amount={plan.funded} currency={currency} />
        <MoneyRow label={t('plan.stillToFund')} amount={plan.stillToFund} currency={currency} total />
      </dl>
      {!matches ? <p className="error-notice" role="alert">{c('fundingUnavailable')}</p> : null}
      <div className="cr-breakdown-table" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table>
          <caption id={captionId}>{c('fundingCategories')}</caption>
          <thead><tr><th scope="col">{t('common.item')}</th><th scope="col">{c('monthlyTarget')}</th><th scope="col">{c(scoped ? 'countedAssignment' : 'assignedMonth')}</th><th scope="col">{detailed ? c('targetDifference') : t('plan.stillToFund')}</th></tr></thead>
          <tbody>{plan.groups.map(group => {
            const items = [...group.items, ...(group.flex ? [group.flex] : [])];
            const counted = scoped && group.planned === 0n ? 0n : group.funded;
            const difference = detailed ? group.planned - counted : items.reduce((sum, item) => sum + item.stillToFund, 0n);
            return <tr key={group.groupId}><th scope="row"><bdi>{name(group)}</bdi></th><td><Amount minor={group.planned} currency={currency} /></td><td><Amount minor={counted} currency={currency} /></td><td><Amount minor={difference} currency={currency} /></td></tr>;
          })}</tbody>
        </table>
      </div>
      {outside !== 0n ? <dl className="cr-money-breakdown"><MoneyRow label={c('outsidePlanFunding')} amount={outside} currency={currency} /></dl> : null}
      {scoped && ((plan.assignedFundingExcluded ?? 0n) !== 0n || (plan.spentFromReadyExcluded ?? 0n) !== 0n) ? <section aria-label={c('excludedFunding')}>
        <h3>{c('excludedFunding')}</h3>
        <dl className="cr-money-breakdown">
          <MoneyRow label={c('excludedAssignments')} amount={plan.assignedFundingExcluded ?? 0n} currency={currency} />
          <MoneyRow label={c('excludedReadySpending')} amount={plan.spentFromReadyExcluded ?? 0n} currency={currency} />
        </dl>
      </section> : null}
      {scoped ? <p className="cr-helper">{c('scopedFundingHelp')}</p> : null}
      <p className="cr-helper">{c(detailed ? 'fundingCreditHelp' : 'legacyFundingHelp')}</p>
    </div>
  </Dialog>;
}
