import { useState } from 'react';
import type { Alert, BillOccurrence, CurrencyOverview, Overview } from '../../api/schemas.ts';
import { navigate } from '../../app/router.ts';
import { PageHeader } from '../../app/shell.tsx';
import { useWorkspace } from '../../app/workspace.tsx';
import { useI18n } from '../../lib/i18n.tsx';
import { approxUsd, type Currency } from '../../lib/money.ts';
import type { RecordIntent } from '../../record/record-dialog.tsx';
import { LoadState, useLoad } from '../../ui/async.tsx';
import { Amount } from '../../ui/money.tsx';
import { addDays, describeEntry } from '../describe.ts';

export function billIntent(occurrence: BillOccurrence): RecordIntent {
  const bill = {
    billId: occurrence.billId, name: occurrence.name, dueOn: occurrence.dueOn, amount: occurrence.expected,
    currency: occurrence.currency, itemId: occurrence.itemId, loanWalletId: occurrence.loanWalletId,
  };
  return occurrence.loanWalletId ? { kind: 'loan', action: 'repay', bill } : { kind: 'expense', bill };
}

export function HomeScreen({ onRecord }: { readonly onRecord: (intent: RecordIntent) => void }) {
  const i18n = useI18n();
  const { t, date } = i18n;
  const { api, space, version } = useWorkspace();
  const overview = useLoad(() => api.overview(space.id), [api, space.id, version]);
  return (
    <>
      <PageHeader title={t('nav.home')} subtitle={date(space.today, 'weekday')} />
      <LoadState loaded={overview}>{(data) => <HomeBody overview={data} onRecord={onRecord} />}</LoadState>
    </>
  );
}

function HomeBody({ overview, onRecord }: { readonly overview: Overview; readonly onRecord: (intent: RecordIntent) => void }) {
  const { t } = useI18n();
  const [currency, setCurrency] = useState<Currency>(overview.planCurrency);
  const view = overview.currencies.find((candidate) => candidate.currency === currency) ?? overview.currencies[0];
  if (!view) return null;
  const noWallets = overview.currencies.every((candidate) => candidate.wallets.length === 0);
  return (
    <div className="cr-home">
      {noWallets ? (
        <section className="cr-card cr-setup-card">
          <h2>{t('home.addWalletTitle')}</h2>
          <p className="cr-helper">{t('home.addWalletBody')}</p>
          <button type="button" className="cr-button cr-button--primary" onClick={() => onRecord({ kind: 'wallet' })}>{t('home.addWallet')}</button>
        </section>
      ) : null}
      <MoneyCard view={view} overview={overview} currency={currency} onCurrency={setCurrency} />
      <Alerts alerts={overview.alerts} onRecord={onRecord} />
      <UpcomingBills onRecord={onRecord} />
      <div className="cr-home-columns">
        <SetAsideCard view={view} />
        <RecentActivity />
      </div>
    </div>
  );
}

function MoneyCard({ view, overview, currency, onCurrency }: {
  readonly view: CurrencyOverview;
  readonly overview: Overview;
  readonly currency: Currency;
  readonly onCurrency: (currency: Currency) => void;
}) {
  const { t, money } = useI18n();
  const overAssigned = view.ready < 0n;
  const rate = overview.referenceRate;
  return (
    <section className="cr-card cr-money-card" aria-labelledby="money-heading">
      <div className="cr-section-header">
        <div>
          <h2 id="money-heading">{t('home.moneyTitle')}</h2>
          <p className="cr-helper">{t('home.moneyIntro')}</p>
        </div>
        {overview.currencies.length > 1 ? (
          <div className="cr-tabs" role="group" aria-label={t('common.currency')}>
            {overview.currencies.map((candidate) => (
              <button key={candidate.currency} type="button" className={candidate.currency === currency ? 'cr-tab-button cr-tab-button--active' : 'cr-tab-button'}
                aria-pressed={candidate.currency === currency} onClick={() => onCurrency(candidate.currency)}>
                {candidate.currency}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="cr-hero">
        <p className="cr-label">{overAssigned ? t('home.overAssigned') : t('common.readyToAssign')}</p>
        <Amount minor={overAssigned ? -view.ready : view.ready} currency={currency} className="cr-amount--hero" tone={overAssigned ? 'negative' : 'plain'} />
        <p className="cr-helper">{overAssigned ? t('home.overAssignedHelp') : t('home.readyHelp')}</p>
        {currency === 'LBP' && rate && view.cashHeld !== 0n ? (
          <p className="cr-helper">{t('common.approx', { amount: money(approxUsd(view.cashHeld, rate.unitsPerUsd), 'USD'), rate: rate.unitsPerUsd })}</p>
        ) : null}
      </div>
      <dl className="cr-equation" aria-label={t('home.equationLabel')}>
        <div><dt>{t('home.cashHeld')}</dt><dd><Amount minor={view.cashHeld} currency={currency} /></dd></div>
        <div className="cr-equation-op" aria-hidden="true">=</div>
        <div><dt>{t('home.setAside')}</dt><dd><Amount minor={view.setAside} currency={currency} /></dd></div>
        <div className="cr-equation-op" aria-hidden="true">+</div>
        <div><dt>{t('common.readyToAssign')}</dt><dd><Amount minor={view.ready} currency={currency} tone={overAssigned ? 'negative' : 'plain'} /></dd></div>
      </dl>
      <div className="cr-wallet-strip">
        {view.wallets.map((wallet) => (
          <p key={wallet.walletId}><bdi>{wallet.name}</bdi> <Amount minor={wallet.balance} currency={currency} /></p>
        ))}
      </div>
      <p className="cr-net-worth">
        <span>{t('home.netWorth')}</span> <Amount minor={view.netWorth.total} currency={currency} />
        <span className="cr-helper">{t('home.netWorthHelp', {
          investments: money(view.netWorth.investments, currency), owed: money(view.netWorth.owedToMe, currency), owe: money(view.netWorth.iOwe, currency),
        })}</span>
      </p>
    </section>
  );
}

function Alerts({ alerts, onRecord }: { readonly alerts: readonly Alert[]; readonly onRecord: (intent: RecordIntent) => void }) {
  const i18n = useI18n();
  const { t, money, date, name } = i18n;
  if (alerts.length === 0) return null;
  return (
    <section className="cr-card" aria-labelledby="alerts-heading">
      <h2 id="alerts-heading">{t('home.alerts')}</h2>
      <ul className="cr-alerts">
        {alerts.map((alert, index) => {
          const amount = alert.amount !== undefined && alert.currency ? money(alert.amount, alert.currency) : '';
          let text = '';
          let action: { label: string; run: () => void } | null = null;
          switch (alert.kind) {
            case 'over_assigned':
              text = t('alert.overAssigned', { amount });
              action = { label: t('alert.takeBack'), run: () => onRecord({ kind: 'move', ...(alert.currency ? { currency: alert.currency } : {}) }) };
              break;
            case 'ready_to_fund':
              text = t('alert.readyToFund', { amount });
              action = { label: t('plan.fund'), run: () => onRecord({ kind: 'fund' }) };
              break;
            case 'ready_unassigned':
              text = t('alert.readyUnassigned', { amount });
              action = { label: t('plan.move'), run: () => onRecord({ kind: 'move', ...(alert.currency ? { currency: alert.currency } : {}) }) };
              break;
            case 'bill_overdue':
              text = t('alert.billOverdue', { name: alert.name ?? '', date: alert.dueOn ? date(alert.dueOn) : '' });
              action = { label: t('bill.pay'), run: () => navigate({ name: 'plan', month: null }) };
              break;
            case 'bill_short':
              text = t('alert.billShort', { name: alert.name ?? '', amount });
              action = alert.itemId ? { label: t('plan.move'), run: () => onRecord({ kind: 'move', toItemId: alert.itemId ?? '', ...(alert.currency ? { currency: alert.currency } : {}) }) } : null;
              break;
            case 'group_over':
              text = t('alert.groupOver', { name: name({ nameEn: alert.nameEn ?? null, nameAr: alert.nameAr ?? null }), amount });
              action = { label: t('plan.edit'), run: () => navigate({ name: 'plan', month: null }) };
              break;
          }
          return (
            <li key={`${alert.kind}-${index}`} className={alert.kind === 'over_assigned' || alert.kind === 'bill_overdue' ? 'cr-alert cr-alert--danger' : 'cr-alert'}>
              <span>{text}</span>
              {action ? <button type="button" className="cr-button cr-button--sm" onClick={action.run}>{action.label}</button> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function CoveragePill({ occurrence }: { readonly occurrence: BillOccurrence }) {
  const { t, money } = useI18n();
  if (occurrence.status === 'paid') return <span className="status status-settled">{t('bill.status.paid', { amount: money(occurrence.paidAmount, occurrence.currency) })}</span>;
  if (occurrence.status === 'skipped') return <span className="status status-cancelled">{t('bill.status.skipped')}</span>;
  if (occurrence.coverage === 'covered') return <span className="status status-accepted">{t('bill.coverage.covered')}</span>;
  if (occurrence.coverage === 'short') return <span className="status status-overdue">{t('bill.coverage.short', { amount: money(occurrence.shortBy, occurrence.currency) })}</span>;
  if (occurrence.coverage === 'not_covered') return <span className="status status-overdue">{t('bill.coverage.notCovered')}</span>;
  return <span className="status status-pending">{t('bill.coverage.later')}</span>;
}

function UpcomingBills({ onRecord }: { readonly onRecord: (intent: RecordIntent) => void }) {
  const { t, date, name } = useI18n();
  const { api, space, version } = useWorkspace();
  const bills = useLoad(() => api.billsUpcoming(space.id, space.today, addDays(space.today, 31)), [api, space.id, space.today, version]);
  return (
    <section className="cr-card" aria-labelledby="bills-heading">
      <div className="cr-section-header">
        <div>
          <h2 id="bills-heading">{t('home.billsTitle')}</h2>
          <p className="cr-helper">{t('home.billsIntro')}</p>
        </div>
        <button type="button" className="text-button" onClick={() => navigate({ name: 'plan', month: null })}>{t('home.manageBills')}</button>
      </div>
      <LoadState loaded={bills}>
        {(list) => {
          const open = list.filter((occurrence) => occurrence.status === 'due' || occurrence.status === 'overdue');
          if (open.length === 0) return <p className="cr-helper">{t('home.noBills')}</p>;
          return (
            <ul className="cr-register">
              {open.slice(0, 8).map((occurrence) => (
                <li key={`${occurrence.billId}-${occurrence.dueOn}`} className="cr-register-row">
                  <div className="cr-register-main">
                    <bdi className="cr-register-title">{occurrence.name}</bdi>
                    <span className="cr-helper">{date(occurrence.dueOn, 'short')} · <bdi>{name({ nameEn: occurrence.itemNameEn, nameAr: occurrence.itemNameAr })}</bdi></span>
                  </div>
                  <CoveragePill occurrence={occurrence} />
                  <Amount minor={occurrence.expected} currency={occurrence.currency} />
                  <button type="button" className="cr-button cr-button--sm" onClick={() => onRecord(billIntent(occurrence))}>{t('bill.pay')}</button>
                </li>
              ))}
            </ul>
          );
        }}
      </LoadState>
    </section>
  );
}

function SetAsideCard({ view }: { readonly view: CurrencyOverview }) {
  const { t, name } = useI18n();
  const max = view.setAsideByGroup.reduce((top, group) => (group.amount > top ? group.amount : top), 0n);
  return (
    <section className="cr-card" aria-labelledby="set-aside-heading">
      <div className="cr-section-header">
        <div>
          <h2 id="set-aside-heading">{t('home.setAsideTitle')}</h2>
          <p className="cr-helper">{t('home.setAsideIntro')}</p>
        </div>
        <button type="button" className="text-button" onClick={() => navigate({ name: 'plan', month: null })}>{t('home.openPlan')}</button>
      </div>
      {view.setAsideByGroup.length === 0 ? <p className="cr-helper">{t('home.nothingSetAside')}</p> : (
        <ul className="cr-register">
          {view.setAsideByGroup.map((group) => (
            <li key={group.groupId} className="cr-register-row">
              <div className="cr-register-main">
                <bdi className="cr-register-title">{name(group)}</bdi>
                <div className="cr-progress" aria-hidden="true">
                  <span style={{ inlineSize: `${max > 0n ? Number((group.amount * 100n) / max) : 0}%` }} />
                </div>
              </div>
              <Amount minor={group.amount} currency={view.currency} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentActivity() {
  const i18n = useI18n();
  const { t, date } = i18n;
  const { api, space, version } = useWorkspace();
  const recent = useLoad(() => api.activity(space.id, { limit: 6 }), [api, space.id, version]);
  return (
    <section className="cr-card" aria-labelledby="recent-heading">
      <div className="cr-section-header">
        <h2 id="recent-heading">{t('home.recent')}</h2>
        <button type="button" className="text-button" onClick={() => navigate({ name: 'activity' })}>{t('home.seeAll')}</button>
      </div>
      <LoadState loaded={recent}>
        {(page) => page.entries.length === 0 ? <p className="cr-helper">{t('activity.empty')}</p> : (
          <ul className="cr-register">
            {page.entries.map((entry) => {
              const line = describeEntry(i18n, entry);
              return (
                <li key={entry.entryId} className="cr-register-row">
                  <div className="cr-register-main">
                    <bdi className="cr-register-title">{line.title}</bdi>
                    <span className="cr-helper">{date(entry.occurredOn, 'short')}{line.detail ? ' · ' : ''}<bdi>{line.detail}</bdi></span>
                  </div>
                  <span className="cr-amounts">
                    {line.amounts.map((amount) => (
                      <Amount key={amount.currency} minor={amount.minor} currency={amount.currency} sign={line.tone !== 'neutral'}
                        tone={line.tone === 'in' ? 'positive' : 'plain'} />
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </LoadState>
    </section>
  );
}
