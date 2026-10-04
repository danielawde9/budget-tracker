import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import type { PlanInput } from '../../api/budget-api.ts';
import type { PlanMonth } from '../../api/schemas.ts';
import { activeWallets, useWorkspace } from '../../app/workspace.tsx';
import { useI18n } from '../../lib/i18n.tsx';
import { parseMoney, type Currency } from '../../lib/money.ts';
import { bpsToPercentText, flexPlanned, groupOver, percentTextToBps, splitByBps } from '../../lib/plan-math.ts';
import { ErrorNotice, useCommand } from '../../ui/async.tsx';
import { Dialog } from '../../ui/dialog.tsx';
import { Amount, MoneyField } from '../../ui/money.tsx';
import { SelectField } from '../../ui/select-field.tsx';
import { usePlanCopy } from './plan-copy.ts';
import './plan-redesign.css';
import { KIND_LABEL } from './plan.tsx';

type EditableKind = 'spending' | 'reserve' | 'goal' | 'loan_payment';

interface DraftItem {
  readonly key: string;
  readonly itemId: string | null;
  readonly kind: EditableKind;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly monthly: bigint | null;
  readonly target: bigint | null;
  readonly targetInvalid: boolean;
  readonly targetDate: string | null;
  readonly walletId: string | null;
}

interface DraftGroup {
  readonly key: string;
  readonly groupId: string | null;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly flexEn: string | null;
  readonly flexAr: string | null;
  readonly bpsText: string;
  readonly items: readonly DraftItem[];
}

interface Draft {
  readonly income: bigint | null;
  readonly groups: readonly DraftGroup[];
  readonly archiveItemIds: readonly string[];
  readonly archiveGroupIds: readonly string[];
}

let keySeed = 0;
const nextKey = (): string => `draft-${(keySeed += 1)}`;

function toDraft(plan: PlanMonth): Draft {
  return {
    income: plan.expectedIncome,
    archiveItemIds: [],
    archiveGroupIds: [],
    groups: plan.groups.map((group) => ({
      key: group.groupId,
      groupId: group.groupId,
      nameEn: group.nameEn,
      nameAr: group.nameAr,
      flexEn: group.flex?.nameEn ?? null,
      flexAr: group.flex?.nameAr ?? null,
      bpsText: bpsToPercentText(group.percentBps),
      items: group.items.map((item) => ({
        key: item.itemId,
        itemId: item.itemId,
        kind: item.kind as EditableKind,
        nameEn: item.nameEn,
        nameAr: item.nameAr,
        monthly: item.inPlan ? item.planned : 0n,
        target: item.targetMinor,
        targetInvalid: false,
        targetDate: item.targetDate,
        walletId: item.walletId,
      })),
    })),
  };
}

function move<T>(list: readonly T[], index: number, offset: number): T[] {
  const next = [...list];
  const target = index + offset;
  const value = next[index];
  const other = next[target];
  if (value === undefined || other === undefined) return next;
  next[index] = other;
  next[target] = value;
  return next;
}

/**
 * Edits the whole plan for a month (it then applies from that month on).
 * Group % sets the group's share of expected income; items have fixed
 * amounts; the rest of each group goes to its flexible item.
 */
export function PlanEditorDialog({ plan, month, onClose, groupId }: { readonly plan: PlanMonth; readonly month: string; readonly onClose: () => void; readonly groupId?: string | undefined }) {
  const { t, date } = useI18n();
  return (
    <Dialog title={t('editor.title', { month: date(month, 'month') })} onClose={onClose} wide description={t('editor.intro')}>
      <PlanEditorForm plan={plan} month={month} onCancel={onClose} onSaved={onClose} initialGroupId={groupId} />
    </Dialog>
  );
}

export function PlanEditorForm({ plan, month, onCancel, onSaved, cancelLabel, initialGroupId }: {
  readonly plan: PlanMonth;
  readonly month: string;
  readonly onCancel: () => void;
  readonly onSaved: () => void;
  readonly cancelLabel?: string;
  readonly initialGroupId?: string | undefined;
}) {
  const { t, money, name, locale } = useI18n();
  const { api, space, refresh, catalog } = useWorkspace();
  const [draft, setDraft] = useState<Draft>(() => toDraft(plan));
  const copy = usePlanCopy();
  const [selectedGroup, setSelectedGroup] = useState(initialGroupId ?? plan.groups[0]?.groupId ?? '');
  const activeKey = draft.groups.some((group) => group.key === selectedGroup) ? selectedGroup : draft.groups[0]?.key;
  const currency: Currency = plan.planCurrency;
  const loans = catalog.data ? activeWallets(catalog.data.accounts, 'loan').filter((wallet) => wallet.loanDirection === 'i_owe') : [];

  const bps = draft.groups.map((group) => percentTextToBps(group.bpsText));
  const bpsValid = bps.every((value) => value !== null);
  const totalBps = bps.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const amounts = useMemo(
    () => (bpsValid && totalBps <= 10000 && draft.income !== null ? splitByBps(draft.income, bps.map((value) => value ?? 0)) : null),
    [bpsValid, totalBps, draft.income, bps],
  );
  const itemsValid = draft.groups.every((group) => group.items.every((item) => item.monthly !== null && (item.nameEn ?? item.nameAr ?? '').trim() !== ''
    && ((item.kind !== 'reserve' && item.kind !== 'goal') || !item.targetInvalid)
    && (item.kind !== 'loan_payment' || item.walletId !== null || loans.length === 0)));
  const valid = draft.income !== null && bpsValid && totalBps <= 10000 && itemsValid && draft.groups.every((group) => (group.nameEn ?? group.nameAr ?? '').trim() !== '');

  const command = useCommand((requestId, input: PlanInput) => api.savePlan({ spaceId: space.id, requestId, month, expectedRevision: plan.revision, plan: input }));

  const setGroup = (key: string, change: (group: DraftGroup) => DraftGroup) =>
    setDraft((current) => ({ ...current, groups: current.groups.map((group) => (group.key === key ? change(group) : group)) }));
  const setItem = (groupKey: string, itemKey: string, change: (item: DraftItem) => DraftItem) =>
    setGroup(groupKey, (group) => ({ ...group, items: group.items.map((item) => (item.key === itemKey ? change(item) : item)) }));
  const localName = (value: { nameEn: string | null; nameAr: string | null }) => (locale === 'ar' ? value.nameAr ?? value.nameEn ?? '' : value.nameEn ?? value.nameAr ?? '');
  const withName = <T extends { nameEn: string | null; nameAr: string | null }>(value: T, text: string): T =>
    (locale === 'ar' ? { ...value, nameAr: text } : { ...value, nameEn: text });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || draft.income === null) return;
    const input: PlanInput = {
      expectedIncome: draft.income,
      archiveItemIds: draft.archiveItemIds,
      archiveGroupIds: draft.archiveGroupIds,
      groups: draft.groups.map((group, index) => ({
        groupId: group.groupId,
        nameEn: group.nameEn?.trim() || null,
        nameAr: group.nameAr?.trim() || null,
        percentBps: bps[index] ?? 0,
        items: group.items.map((item) => ({
          itemId: item.itemId,
          kind: item.kind,
          nameEn: item.nameEn?.trim() || null,
          nameAr: item.nameAr?.trim() || null,
          monthly: item.monthly ?? 0n,
          target: item.kind === 'reserve' || item.kind === 'goal' ? item.target : null,
          targetDate: item.kind === 'reserve' || item.kind === 'goal' ? item.targetDate : null,
          walletId: item.kind === 'loan_payment' ? item.walletId : null,
        })),
      })),
    };
    if (!(await command.submit(input))) return;
    refresh();
    onSaved();
  }

  return (
      <form className="dialog-form cr-stack cr-plan-editor" onSubmit={(event) => void submit(event)}>
        <div className="plan-editor-totals">
        <MoneyField label={t('plan.expectedIncome')} currency={currency} value={draft.income} onChange={(income) => setDraft((current) => ({ ...current, income }))} allowZero
          hint={t('editor.incomeHint')} />
        <p className={totalBps > 10000 ? 'cr-explain cr-explain--warn' : 'cr-explain'} role="status">
          {totalBps > 10000
            ? t('error.BUDGET_PLAN_OVER_100')
            : t('editor.total', { percent: bpsToPercentText(totalBps), notPlanned: draft.income !== null && amounts ? money(draft.income - amounts.reduce((sum, part) => sum + part, 0n), currency) : '—' })}
        </p>
        </div>
        <div className="plan-editor-layout">
        <nav className="plan-group-nav" aria-label={copy.groups}>
          {draft.groups.map((group) => <button key={group.key} type="button" className="cr-button" aria-current={group.key === activeKey ? 'true' : undefined} onClick={() => setSelectedGroup(group.key)}>{name(group) || t('editor.newGroup')}</button>)}
        </nav>
        {draft.groups.map((group, groupIndex) => {
          const amount = amounts?.[groupIndex] ?? null;
          const itemAmounts = group.items.map((item) => item.monthly ?? 0n);
          const flexName = locale === 'ar' ? (group.flexAr ?? group.flexEn) : (group.flexEn ?? group.flexAr);
          return (
            <fieldset key={group.key} hidden={group.key !== activeKey} className="cr-form-section cr-editor-group">
              <legend>{name(group) || t('editor.newGroup')}</legend>
              <div className="cr-editor-group-head">
                <label className="cr-field">
                  <span className="cr-label">{t('editor.groupName')}</span>
                  <input type="text" required maxLength={60} value={localName(group)} onChange={(event) => setGroup(group.key, (current) => withName(current, event.target.value))} />
                </label>
                <label className="cr-field cr-editor-percent">
                  <span className="cr-label">{t('editor.percent')}</span>
                  <span className="cr-affix">
                    <input type="text" inputMode="decimal" dir="ltr" required value={group.bpsText} aria-invalid={bps[groupIndex] === null}
                      onChange={(event) => setGroup(group.key, (current) => ({ ...current, bpsText: event.target.value }))} />
                    <span className="cr-affix-suffix" aria-hidden="true">%</span>
                  </span>
                </label>
                <p className="cr-editor-group-amount">{amount !== null ? <Amount minor={amount} currency={currency} /> : '—'}</p>
              </div>
              <p className="cr-explain">{copy.optionalAmounts}</p>
              <ul className="cr-editor-items">
                {group.items.map((item, itemIndex) => (
                  <li key={item.key} className="cr-editor-item">
                    <label className="cr-field">
                      <span className="cr-label">{t('editor.itemName')}</span>
                      <input type="text" required maxLength={60} value={localName(item)} onChange={(event) => setItem(group.key, item.key, (current) => withName(current, event.target.value))} />
                    </label>
                    <MoneyField label={t('editor.monthly')} currency={currency} value={item.monthly} allowZero
                      onChange={(monthly) => setItem(group.key, item.key, (current) => ({ ...current, monthly }))} />
                    <details className="plan-item-options" open={item.kind === 'loan_payment' && item.walletId === null}>
                    <summary>{copy.optional}</summary>
                    {item.itemId ? <p className="cr-kind">{t(KIND_LABEL[item.kind])}</p> : (
                      <SelectField label={t('editor.kind')} value={item.kind} onChange={(event) => setItem(group.key, item.key, (current) => ({ ...current, kind: event.target.value as EditableKind }))}>
                          {(['spending', 'reserve', 'goal', 'loan_payment'] as const).map((kind) => <option key={kind} value={kind}>{t(KIND_LABEL[kind])}</option>)}
                        </SelectField>
                    )}

                    {item.kind === 'reserve' || item.kind === 'goal' ? (
                      <>
                        <div onChangeCapture={(event) => {
                          const input = event.target;
                          if (!(input instanceof HTMLInputElement)) return;
                          const raw = input.value.trim();
                          const parsed = raw === '' ? null : parseMoney(raw, currency);
                          setItem(group.key, item.key, (current) => ({ ...current, targetInvalid: raw !== '' && (parsed === null || parsed <= 0n) }));
                        }}>
                        <MoneyField label={t('editor.target')} currency={currency} value={item.target} required={false}
                          onChange={(target) => setItem(group.key, item.key, (current) => ({ ...current, target }))} />
                        </div>
                        <label className="cr-field">
                          <span className="cr-label">{t('editor.targetDate')}</span>
                          <input type="date" dir="ltr" value={item.targetDate ?? ''} onChange={(event) => setItem(group.key, item.key, (current) => ({ ...current, targetDate: event.target.value || null }))} />
                        </label>
                      </>
                    ) : null}
                    {item.kind === 'loan_payment' && loans.length > 0 ? (
                      <SelectField label={t('editor.loan')} value={item.walletId ?? ''} required onChange={(event) => setItem(group.key, item.key, (current) => ({ ...current, walletId: event.target.value || null }))}>
                          <option value="" disabled>{t('editor.chooseLoan')}</option>
                          {loans.map((loan) => <option key={loan.id} value={loan.id}>{loan.name}</option>)}
                        </SelectField>
                    ) : null}
                    <div className="cr-row">
                      <button type="button" className="cr-icon-button" aria-label={t('editor.itemUp')} disabled={itemIndex === 0}
                        onClick={() => setGroup(group.key, (current) => ({ ...current, items: move(current.items, itemIndex, -1) }))}><ArrowUp aria-hidden size={18} /></button>
                      <button type="button" className="cr-icon-button" aria-label={t('editor.itemDown')} disabled={itemIndex === group.items.length - 1}
                        onClick={() => setGroup(group.key, (current) => ({ ...current, items: move(current.items, itemIndex, 1) }))}><ArrowDown aria-hidden size={18} /></button>
                      <button type="button" className="cr-icon-button" aria-label={t('editor.removeItem')}
                        onClick={() => setDraft((current) => ({
                          ...current,
                          groups: current.groups.map((candidate) => (candidate.key === group.key ? { ...candidate, items: candidate.items.filter((other) => other.key !== item.key) } : candidate)),
                          archiveItemIds: item.itemId ? [...current.archiveItemIds, item.itemId] : current.archiveItemIds,
                        }))}><Trash2 aria-hidden size={18} /></button>
                    </div>
                    </details>
                  </li>
                ))}
              </ul>
              {amount !== null ? (
                groupOver(amount, itemAmounts) > 0n ? (
                  <p className="cr-explain cr-explain--warn">{t('editor.over', { amount: money(groupOver(amount, itemAmounts), currency) })}</p>
                ) : (
                  <p className="cr-explain">{t('plan.flexGets', { name: flexName ?? t('kind.flex'), amount: money(flexPlanned(amount, itemAmounts), currency) })}</p>
                )
              ) : null}
              <button type="button" className="text-button" onClick={() => setGroup(group.key, (current) => ({
                ...current,
                items: [...current.items, { key: nextKey(), itemId: null, kind: 'spending', nameEn: null, nameAr: null, monthly: 0n, target: null, targetInvalid: false, targetDate: null, walletId: null }],
              }))}><Plus aria-hidden size={16} /> {t('editor.addItem')}</button>
              <details className="plan-item-options"><summary>{copy.groupOptions}</summary>
                <div className="cr-row">
                  <button type="button" className="cr-icon-button" aria-label={t('editor.groupUp')} disabled={groupIndex === 0}
                    onClick={() => setDraft((current) => ({ ...current, groups: move(current.groups, groupIndex, -1) }))}><ArrowUp aria-hidden size={18} /></button>
                  <button type="button" className="cr-icon-button" aria-label={t('editor.groupDown')} disabled={groupIndex === draft.groups.length - 1}
                    onClick={() => setDraft((current) => ({ ...current, groups: move(current.groups, groupIndex, 1) }))}><ArrowDown aria-hidden size={18} /></button>
                  <button type="button" className="cr-icon-button" aria-label={t('editor.removeGroup')}
                    onClick={() => setDraft((current) => ({
                      ...current,
                      groups: current.groups.filter((candidate) => candidate.key !== group.key),
                      archiveGroupIds: group.groupId ? [...current.archiveGroupIds, group.groupId] : current.archiveGroupIds,
                      archiveItemIds: [...current.archiveItemIds, ...group.items.flatMap((item) => (item.itemId ? [item.itemId] : []))],
                    }))}><Trash2 aria-hidden size={18} /></button>
                </div>
              </details>
            </fieldset>
          );
        })}
        </div>
        <button type="button" className="cr-button" onClick={() => { const key = nextKey(); setSelectedGroup(key); setDraft((current) => ({
          ...current,
          groups: [...current.groups, { key, groupId: null, nameEn: null, nameAr: null, flexEn: null, flexAr: null, bpsText: '0', items: [] }],
        })); }}><Plus aria-hidden size={16} /> {t('editor.addGroup')}</button>
        {!valid && totalBps <= 10000 ? <p className="cr-helper" role="status">{copy.invalid}</p> : null}
        {command.error ? <ErrorNotice error={command.error} /> : null}
        <div className="dialog-actions">
          <button type="button" className="cr-button" onClick={onCancel} disabled={command.pending}>{cancelLabel ?? t('common.cancel')}</button>
          <button type="submit" className="cr-button cr-button--primary" disabled={!valid || command.pending}>{command.pending ? t('common.saving') : t('editor.save')}</button>
        </div>
      </form>
  );
}
