import { BillPaymentLinkForm } from './bill-payment-link.tsx';
import { useEffect, useRef, useState } from 'react';
import { toBudgetError, type BudgetError } from '../../api/budget-api.ts';
import { entryKind, type ActivityCursor, type Entry } from '../../api/schemas.ts';
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
import { ActivityCharts } from './activity-charts.tsx';

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
  const [selectedDay, setSelectedDay] = useState('');
  const { api, space, version, catalog } = useWorkspace();
  const [month, setMonth] = useState(initialMonth ?? '');
  const [walletId, setWalletId] = useState(initialWalletId ?? '');
  useEffect(() => { setMonth(initialMonth ?? ''); setWalletId(initialWalletId ?? ''); }, [initialMonth, initialWalletId]);
  const [itemId, setItemId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [pages, setPages] = useState<Entry[]>([]);
  const [knownItems, setKnownItems] = useState<Map<string, Entry['items'][number]>>(() => new Map());
  useEffect(() => {
    setKnownItems(current => { const next = new Map(current); for (const entry of pages) for (const item of entry.items) if (item.kind !== 'ready') next.set(item.itemId, item); return next; });
  }, [pages]);
  const [cursor, setCursor] = useState<ActivityCursor | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null);
  const filter: Record<string, string> = {};
  if (month) filter['month'] = month;
  if (walletId) filter['walletId'] = walletId;
  if (itemId) filter['itemId'] = itemId;
  if (groupId) filter['groupId'] = groupId;
  if (purpose) filter['purpose'] = purpose;
  if (kind) filter['kind'] = kind;
  const filterKey = JSON.stringify(filter);
  const generation = useRef(0);
  useEffect(() => { generation.current += 1; setPages([]); setCursor(null); setMoreError(null); setLoadingMore(false); }, [filterKey, version, space.id, api]);
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
    const requestGeneration = generation.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api.activity(space.id, { limit: 30, before: cursor, filter });
      if (generation.current !== requestGeneration) return;
      setPages((current) => [...current, ...page.entries]);
      setCursor(page.next);
    } catch (error) {
      if (generation.current === requestGeneration) setMoreError(toBudgetError(error));
    } finally {
      if (generation.current === requestGeneration) setLoadingMore(false);
    }
  }
  const months = Array.from(new Set([...(month ? [month] : []), ...Array.from({ length: 12 }, (_, index) => addMonths(space.currentMonth, -index))])).sort().reverse();
  const searched = pages.filter((entry) => { const line = describeEntry(i18n, entry); const haystack = [line.title, line.detail, entry.memo, kindLabel(i18n, entry.kind), ...entry.wallets.map((wallet) => wallet.name), ...entry.items.flatMap(item => [i18n.name(item), item.groupNameEn, item.groupNameAr])].join(' ').toLocaleLowerCase(i18n.locale); return haystack.includes(search.trim().toLocaleLowerCase(i18n.locale)); });
  const visible = selectedDay ? searched.filter(entry => entry.occurredOn === selectedDay) : searched;
  return (
    <>
      <PageHeader title={t('nav.activity')} subtitle={t('activity.intro')} actions={<a className="cr-button" href="#/expenses">{c('viewCategoryExpenses')}</a>} />
      <section className="cr-card">
        <div className="cr-activity-toolbar"><label className="cr-field"><span className="cr-label">{c('search')}</span><input type="search" placeholder={t('input.activitySearch')} value={search} onChange={(event) => setSearch(event.target.value)} /></label><SelectField label={c('allTypes')} value={kind} onChange={(event) => setKind(event.target.value)}><option value="">{c('allTypes')}</option>{entryKind.options.map((value) => <option key={value} value={value}>{kindLabel(i18n, value)}</option>)}</SelectField></div>
        <div className="cr-toolbar cr-filters cr-activity-filters">
          <SelectField label={c('purposeFilter')} value={purpose} onChange={event => setPurpose(event.target.value)}><option value="">{c('allPurposes')}</option><option value="expense">{c('expenses')}</option><option value="savings">{c('savingsSection')}</option></SelectField>
          <SelectField label={c('group')} value={groupId} onChange={event => setGroupId(event.target.value)}><option value="">{c('allGroups')}</option>{catalog.data?.plan.groups.map(group => <option key={group.groupId} value={group.groupId}>{i18n.name(group)}</option>)}{[...new Map([...knownItems.values()].filter(item => item.groupId && !catalog.data?.plan.groups.some(group => group.groupId === item.groupId)).map(item => [item.groupId!, item])).values()].map(item => <option key={item.groupId} value={item.groupId!}>{i18n.name({ nameEn: item.groupNameEn ?? null, nameAr: item.groupNameAr ?? null })}</option>)}</SelectField>
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
              <optgroup label={i18n.locale === 'ar' ? 'فئات سابقة' : 'Earlier categories'}>{[...knownItems.values()].filter(item => !catalog.data?.plan.groups.some(group => [...group.items, ...(group.flex ? [group.flex] : [])].some(candidate => candidate.itemId === item.itemId))).map(item => <option key={item.itemId} value={item.itemId}>{i18n.name(item)}</option>)}</optgroup>
            </SelectField>
        </div>
        {first.status === 'ready' ? <ActivityCharts entries={searched} selectedDay={selectedDay} selectedKind={kind} onDayChange={setSelectedDay} onKindChange={setKind} /> : null}
        {first.status === 'error' ? <ErrorNotice error={first.error} onRetry={first.reload} /> : null}
        {first.status === 'loading' && pages.length === 0 ? <p role="status" className="cr-helper">{t('common.loading')}</p> : null}
        {first.status === 'ready' && pages.length === 0 ? <p className="cr-helper">{t('activity.empty')}</p> : null}
        {pages.length > 0 && visible.length === 0 ? <p role="status" className="cr-helper">{selectedDay ? (i18n.locale === 'ar' ? 'لا توجد قيود محمّلة تطابق هذا اليوم والفلاتر. اعرض كل الأيام المحمّلة أو حمّل المزيد.' : 'No loaded records match this day and your filters. Show all loaded days or load more.') : c('noSearch')}</p> : null}
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
                    <ActivityTags entry={entry} />
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

function ActivityTags({ entry }: { readonly entry: Entry }) {
  const { catalog } = useWorkspace();
  const { name } = useI18n();
  const tags = new Map<string, string>();
  for (const item of entry.items) {
    if (item.kind === 'ready') continue;
    const group = catalog.data?.plan.groups.find(group => [...group.items, ...(group.flex ? [group.flex] : [])].some(candidate => candidate.itemId === item.itemId));
    const groupName = item.groupId ? name({ nameEn: item.groupNameEn ?? null, nameAr: item.groupNameAr ?? null }) : group ? name(group) : '';
    if (groupName) tags.set(`group-${item.groupId ?? group?.groupId}`, groupName);
    tags.set(`item-${item.itemId}`, name(item));
  }
  return tags.size ? <span className="cr-activity-tags">{[...tags].map(([key, label]) => <bdi key={key} className="cr-activity-tag">{label}</bdi>)}</span> : null;
}
