import { BillPaymentLinkForm } from './bill-payment-link.tsx';
import { useEffect, useState } from 'react';
import { toBudgetError, type BudgetError } from '../../api/budget-api.ts';
import type { ActivityCursor, Entry } from '../../api/schemas.ts';
import { PageHeader } from '../../app/shell.tsx';
import { activeWallets, pickerGroups, useWorkspace } from '../../app/workspace.tsx';
import { useUiCopy } from '../../lib/ui-copy.ts';
import { useI18n } from '../../lib/i18n.tsx';
import type { RecordIntent } from '../../record/record-dialog.tsx';
import { ErrorNotice, useLoad } from '../../ui/async.tsx';
import { Dialog } from '../../ui/dialog.tsx';
import { Amount } from '../../ui/money.tsx';
import { SelectField } from '../../ui/select-field.tsx';
import { addMonths, describeEntry, kindLabel } from '../describe.ts';

const FLOW_LABEL = {
  opening: 'flow.opening', income: 'flow.income', other_income: 'flow.other_income', fund: 'flow.fund', release: 'flow.release',
  move: 'flow.move', cover: 'flow.cover', spend: 'flow.spend', refund: 'flow.refund', transfer: 'flow.transfer', exchange: 'flow.exchange',
  invest: 'flow.invest', withdraw: 'flow.withdraw', value: 'flow.value', fee: 'flow.fee', borrow: 'flow.borrow', principal: 'flow.principal',
  interest: 'flow.interest', lend: 'flow.lend', collect: 'flow.collect',
} as const;

export function ActivityScreen({ onRecord, walletId: initialWalletId, month: initialMonth }: { readonly onRecord: (intent: RecordIntent) => void; readonly walletId?: string | null; readonly month?: string | null }) {
  const i18n = useI18n();
  const { t, date } = i18n;
  const c = useUiCopy();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const { api, space, version, catalog } = useWorkspace();
  const [month, setMonth] = useState(initialMonth ?? '');
  const [walletId, setWalletId] = useState(initialWalletId ?? '');
  useEffect(() => { setMonth(initialMonth ?? ''); setWalletId(initialWalletId ?? ''); }, [initialMonth, initialWalletId]);
  const [itemId, setItemId] = useState('');
  const [pages, setPages] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<ActivityCursor | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null);
  const filter: Record<string, string> = {};
  if (month) filter['month'] = month;
  if (walletId) filter['walletId'] = walletId;
  if (itemId) filter['itemId'] = itemId;
  const filterKey = JSON.stringify(filter);
  const first = useLoad(() => api.activity(space.id, { limit: 30, filter }), [api, space.id, version, filterKey]);
  useEffect(() => {
    if (first.status === 'ready') {
      setPages(first.data.entries);
      setCursor(first.data.next);
      setMoreError(null);
    }
  }, [first]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<BudgetError | null>(null);
  async function more() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api.activity(space.id, { limit: 30, before: cursor, filter });
      setPages((current) => [...current, ...page.entries]);
      setCursor(page.next);
    } catch (error) {
      setMoreError(toBudgetError(error));
    } finally {
      setLoadingMore(false);
    }
  }
  const months = Array.from(new Set([...(month ? [month] : []), ...Array.from({ length: 12 }, (_, index) => addMonths(space.currentMonth, -index))])).sort().reverse();
  const visible = pages.filter((entry) => { const line = describeEntry(i18n, entry); const haystack = [line.title, line.detail, entry.memo, kindLabel(i18n, entry.kind), ...entry.wallets.map((wallet) => wallet.name)].join(' ').toLocaleLowerCase(i18n.locale); return (!kind || entry.kind === kind) && haystack.includes(search.trim().toLocaleLowerCase(i18n.locale)); });
  return (
    <>
      <PageHeader title={t('nav.activity')} subtitle={t('activity.intro')} />
      <section className="cr-card">
        <div className="cr-activity-toolbar"><label className="cr-field"><span className="cr-label">{c('search')}</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label><SelectField label={c('allTypes')} value={kind} onChange={(event) => setKind(event.target.value)}><option value="">{c('allTypes')}</option>{Array.from(new Set(pages.map((entry) => entry.kind))).map((value) => <option key={value} value={value}>{kindLabel(i18n, value)}</option>)}</SelectField></div>
        <details className="cr-filter-details" open={Boolean(initialMonth || initialWalletId) || undefined}><summary>{c('moreFilters')}</summary><div className="cr-toolbar cr-filters">
          <SelectField label={t('activity.month')} value={month} onChange={(event) => setMonth(event.target.value)}>
              <option value="">{t('activity.allMonths')}</option>
              {months.map((value) => <option key={value} value={value}>{date(value, 'month')}</option>)}
            </SelectField>
          <SelectField label={t('common.wallet')} value={walletId} onChange={(event) => setWalletId(event.target.value)}>
              <option value="">{t('activity.allWallets')}</option>
              {catalog.data?.accounts.wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}
            </SelectField>
          <SelectField label={t('common.item')} value={itemId} onChange={(event) => setItemId(event.target.value)}>
              <option value="">{t('activity.allItems')}</option>
              {catalog.data ? pickerGroups(catalog.data.plan).map((group) => (
                <optgroup key={group.groupId} label={i18n.name(group)}>
                  {group.items.map((item) => <option key={item.itemId} value={item.itemId}>{i18n.name(item)}</option>)}
                </optgroup>
              )) : null}
            </SelectField>
        </div>
        </details>
        {first.status === 'error' ? <ErrorNotice error={first.error} onRetry={first.reload} /> : null}
        {first.status === 'loading' && pages.length === 0 ? <p role="status" className="cr-helper">{t('common.loading')}</p> : null}
        {first.status === 'ready' && pages.length === 0 ? <p className="cr-helper">{t('activity.empty')}</p> : null}
        {pages.length > 0 && visible.length === 0 ? <p role="status" className="cr-helper">{c('noSearch')}</p> : null}
        <ul className="cr-register">
          {visible.map((entry) => {
            const line = describeEntry(i18n, entry);
            return (
              <li key={entry.entryId} className="cr-register-row">
                <button type="button" className="cr-register-button" onClick={() => setSelected(entry)}>
                  <span className="cr-register-main">
                    <bdi className="cr-register-title">{line.title}</bdi>
                    <span className="cr-helper">
                      {date(entry.occurredOn)} · {kindLabel(i18n, entry.kind)}{line.detail ? ' · ' : ''}<bdi>{line.detail}</bdi>
                      {entry.reversedByEntryId ? ` · ${t('activity.corrected')}` : ''}
                    </span>
                  </span>
                  <span className="cr-amounts">
                    {line.amounts.map((amount) => (
                      <Amount key={amount.currency} minor={amount.minor} currency={amount.currency} sign={line.tone !== 'neutral'} tone={line.tone === 'in' ? 'positive' : 'plain'} />
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {moreError ? <ErrorNotice error={moreError} /> : null}
        {cursor ? <button type="button" className="cr-button cr-button--block" disabled={loadingMore} onClick={() => void more()}>{t('activity.more')}</button> : null}
      </section>
      {selected ? (
        <EntryDetail entry={selected} onClose={() => setSelected(null)} onCorrect={() => { const entry = selected; setSelected(null); onRecord({ kind: 'correct', entry }); }}
          canCorrect={!selected.reversedByEntryId && selected.kind !== 'reversal' && Boolean(catalog.data && activeWallets(catalog.data.accounts, 'cash'))} />
      ) : null}
    </>
  );
}

export function EntryDetail({ entry, onClose, onCorrect, canCorrect }: { readonly entry: Entry; readonly onClose: () => void; readonly onCorrect: () => void; readonly canCorrect: boolean }) {
  const i18n = useI18n();
  const { t, date, name } = i18n;
  const line = describeEntry(i18n, entry);
  const { refresh } = useWorkspace();
  const close = () => { refresh(); onClose(); };
  const [editingLink, setEditingLink] = useState(false);
  const [pending, setPending] = useState(false);
  const canLink = !entry.reversedByEntryId && entry.kind !== 'reversal' && Boolean(entry.billId || (entry.billLinkVersion ?? 0) > 0);
  return (
    <Dialog title={line.title} pending={pending} onClose={close} description={`${kindLabel(i18n, entry.kind)} · ${date(entry.occurredOn)}`}>
      {editingLink ? <BillPaymentLinkForm entry={entry} onDone={onClose} onCancel={() => setEditingLink(false)} onPending={setPending} /> : <div className="cr-stack">
        {entry.memo ? <p><bdi>{entry.memo}</bdi></p> : null}
        {entry.reversalReason ? <p className="cr-explain">{t('activity.reason', { reason: entry.reversalReason })}</p> : null}
        {entry.reversedByEntryId ? <p className="cr-explain cr-explain--warn">{t('activity.wasCorrected')}</p> : null}
        <h3>{t('activity.where')}</h3>
        {entry.wallets.length === 0 ? <p className="cr-helper">{t('activity.noWalletChange')}</p> : (
          <ul className="cr-lines">
            {entry.wallets.map((wallet, index) => (
              <li key={index}><bdi>{wallet.name}</bdi> <span className="cr-helper">{t(FLOW_LABEL[wallet.flow])}</span> <Amount minor={wallet.amount} currency={wallet.currency} sign /></li>
            ))}
          </ul>
        )}
        <h3>{t('activity.whatFor')}</h3>
        {entry.items.length === 0 ? <p className="cr-helper">{t('activity.noPurposeChange')}</p> : (
          <ul className="cr-lines">
            {entry.items.map((item, index) => (
              <li key={index}><bdi>{item.kind === 'ready' ? t('common.readyToAssign') : name(item)}</bdi> <span className="cr-helper">{t(FLOW_LABEL[item.flow])}</span> <Amount minor={item.amount} currency={item.currency} sign /></li>
            ))}
          </ul>
        )}
        {entry.billId ? <p className="cr-helper">{t('bill.linked')}: <bdi>{entry.billName}</bdi> · {date(entry.billDueOn ?? entry.occurredOn)}</p> : null}
        {entry.billLinkHistory?.length ? <section aria-label={t('bill.linkHistory')}><h3>{t('bill.linkHistory')}</h3><ul className="cr-lines">{entry.billLinkHistory.map((event, index) => <li key={index}>
          {event.billId ? <>{t('bill.linked')}: <bdi>{event.billName}</bdi> · {date(event.dueOn ?? entry.occurredOn)}</> : t('bill.detached')}
          {' · '}<bdi>{date(event.createdAt.slice(0, 10))}</bdi>
        </li>)}</ul></section> : null}
        <div className="dialog-actions">
          {canLink ? <button type="button" className="cr-button" onClick={() => setEditingLink(true)}>{t('bill.movePayment')}</button> : null}
          {canCorrect ? <button type="button" className="cr-button" onClick={onCorrect}>{t('activity.correct')}</button> : null}
          <button type="button" className="cr-button cr-button--primary" data-autofocus="" onClick={close}>{t('common.done')}</button>
        </div>
      </div>}
    </Dialog>
  );
}
