import { useState, type FormEvent } from 'react';
import type { Bill } from '../api/schemas.ts';
import { activeWallets, findItem, pickerGroups, useWorkspace } from '../app/workspace.tsx';
import { useI18n } from '../lib/i18n.tsx';
import { parseMoney, type Currency } from '../lib/money.ts';
import { ErrorNotice, LoadState, useCommand, useLoad } from '../ui/async.tsx';
import { Amount, MoneyField } from '../ui/money.tsx';
import { Explain, FormActions, ItemSelect } from './fields.tsx';
import { SelectField } from '../ui/select-field.tsx';
import { useRecordCopy } from './record-copy.ts';
import { Preview } from './fields.tsx';
import type { FormProps } from './forms-everyday.tsx';

/**
 * Fund my plan: the database proposes what each item still needs this month,
 * top to bottom, from the money in Ready to assign. Every line is editable.
 */
export function FundForm({ catalog, onDone, onCancel, month }: FormProps & { readonly month: string }) {
  const { t, money, name, date } = useI18n();
  const copy = useRecordCopy();
  const [chosenGroup, setChosenGroup] = useState('');
  const { api, space, refresh } = useWorkspace();
  const currency = catalog.plan.planCurrency;
  const preview = useLoad(() => api.fundingPreview(space.id, month, currency), [api, space.id, month, currency]);
  const [overrides, setOverrides] = useState<Record<string, bigint | null>>({});
  const command = useCommand((requestId, moves: { itemId: string; amount: bigint }[]) => api.assignMoney({
    spaceId: space.id, requestId, on: space.today, moves: moves.map((move) => ({ from: null, to: move.itemId, currency, amount: move.amount })),
  }));
  return (
    <LoadState loaded={preview}>
      {(data) => {
        const lines = data.lines.map((line) => ({ itemId: line.itemId, amount: line.itemId in overrides ? (overrides[line.itemId] ?? 0n) : line.amountMinor }));
        const proposedTotal = data.lines.reduce((sum, line) => sum + line.amountMinor, 0n);
        const total = lines.reduce((sum, line) => sum + line.amount, 0n);
        const groups = catalog.plan.groups.filter(group => data.lines.some(line => [...group.items, ...(group.flex ? [group.flex] : [])].some(item => item.itemId === line.itemId)));
        const selectedGroup = groups.find(group => group.groupId === chosenGroup) ?? groups[0];
        const visibleIds = new Set(selectedGroup ? [...selectedGroup.items, ...(selectedGroup.flex ? [selectedGroup.flex] : [])].map(item => item.itemId) : data.lines.map(line => line.itemId));
        const tooMuch = total > catalog.ready[currency];
        async function submit(event: FormEvent) {
          event.preventDefault();
          const moves = lines.filter((line) => line.amount > 0n);
          if (moves.length === 0 || tooMuch) return;
          if (!(await command.submit(moves))) return;
          refresh();
          onDone(t('fund.done', { amount: money(total, currency) }));
        }
        if (data.lines.length === 0) {
          return (
            <div className="cr-stack">
              <Explain>{data.unfunded > 0n ? t('fund.nothingReady', { amount: money(data.unfunded, currency) }) : t('fund.allFunded')}</Explain>
              <div className="dialog-actions"><button type="button" className="cr-button cr-button--primary" onClick={onCancel}>{t('common.done')}</button></div>
            </div>
          );
        }
        return (
          <form className="dialog-form cr-stack" onChangeCapture={event => { const input = event.target as HTMLInputElement; if (input.closest('[data-fund-item]') && input.type === 'text') input.setCustomValidity(input.value.trim() && parseMoney(input.value, currency) === null ? t('error.BUDGET_INVALID_AMOUNT') : ''); }} onInvalidCapture={(event) => { const row = (event.target as HTMLElement).closest('[data-fund-item]'); const group = groups.find(group => [...group.items, ...(group.flex ? [group.flex] : [])].some(item => item.itemId === row?.getAttribute('data-fund-item'))); if (group) setChosenGroup(group.groupId); }} onSubmit={(event) => void submit(event)}>
            <p className="cr-helper">{date(month, 'month')}</p>
            <Explain>{t('fund.explain', { available: money(data.available, currency) })}</Explain>
            <Preview><div className="cr-record-summary"><p>{t('common.readyToAssign')}<br />{money(catalog.ready[currency], currency)}</p><p>{t('fund.total')}<br />{money(total, currency)}</p><p>{copy('Left to assign', 'يبقى للتوزيع')}<br />{money(catalog.ready[currency] - total, currency)}</p></div></Preview>
            <div className="cr-fund-groups" role="group" aria-label={copy('Plan groups', 'مجموعات الخطة')}>{groups.map(group => <button className={selectedGroup?.groupId === group.groupId ? 'cr-chip cr-chip--active' : 'cr-chip'} type="button" key={group.groupId} aria-pressed={selectedGroup?.groupId === group.groupId} onClick={() => setChosenGroup(group.groupId)}>{name(group)}</button>)}</div>
            <ul className="cr-fund-lines">
              {data.lines.map((line) => {
                const item = findItem(catalog.plan, line.itemId);
                return (
                  <li key={line.itemId} data-fund-item={line.itemId} className="cr-fund-line" hidden={!visibleIds.has(line.itemId)}>
                    <MoneyField
                      label={item ? name(item) : line.itemId}
                      currency={currency}
                      value={line.itemId in overrides ? (overrides[line.itemId] ?? null) : line.amountMinor}
                      onChange={(value) => setOverrides((current) => ({ ...current, [line.itemId]: value }))}
                      required={false}
                      allowZero
                    />
                  </li>
                );
              })}
            </ul>
            <p className="cr-fund-total">
              <span>{t('fund.total')}</span> <Amount minor={total} currency={currency} tone={tooMuch ? 'negative' : 'plain'} />
            </p>
            {data.unfunded + proposedTotal - total > 0n ? <p className="cr-helper">{t('fund.stillAfter', { amount: money(data.unfunded + proposedTotal - total, currency) })}</p> : null}
            {tooMuch ? <Explain tone="warn">{t('fund.tooMuch', { amount: money(catalog.ready[currency], currency) })}</Explain> : null}
            {command.error ? <ErrorNotice error={command.error} /> : null}
            <FormActions submitLabel="fund.save" pending={command.pending} onCancel={onCancel} disabled={total <= 0n || tooMuch} />
          </form>
        );
      }}
    </LoadState>
  );
}

export function BillForm({ catalog, onDone, onCancel, bill }: FormProps & { readonly bill?: Bill }) {
  const { t, money } = useI18n();
  const copy = useRecordCopy();
  const { api, space, refresh } = useWorkspace();
  const [name, setName] = useState(bill?.name ?? '');
  const [itemId, setItemId] = useState(bill?.itemId ?? '');
  const [currency, setCurrency] = useState<Currency>(bill?.currency ?? catalog.plan.planCurrency);
  const [amount, setAmount] = useState<bigint | null>(bill?.amount ?? null);
  const [cadence, setCadence] = useState<'monthly' | 'yearly' | 'once'>(bill?.cadence ?? 'monthly');
  const [firstDue, setFirstDue] = useState(bill?.firstDueOn ?? space.today);
  const [end, setEnd] = useState(bill?.endOn ?? '');
  const item = itemId ? findItem(catalog.plan, itemId) : null;
  const loans = activeWallets(catalog.accounts, 'loan').filter((wallet) => wallet.loanDirection === 'i_owe');
  const [loanId, setLoanId] = useState(bill?.loanWalletId ?? item?.walletId ?? '');
  const command = useCommand((requestId, archived: boolean) => api.saveBill({
    spaceId: space.id, requestId, billId: bill?.billId ?? null, name: name.trim(), itemId, amount: amount ?? 0n, currency, cadence,
    firstDue, end: end || null, loanId: item?.kind === 'loan_payment' && loanId ? loanId : null, archived,
  }));
  async function save(archived: boolean) {
    if (!name.trim() || !item || amount === null) return;
    if (!(await command.submit(archived))) return;
    refresh();
    onDone(archived ? t('bill.removed', { name: name.trim() }) : t('bill.saved', { name: name.trim(), amount: money(amount, currency) }));
  }
  return (
    <form className="dialog-form cr-stack" onInvalidCapture={event => { const details = (event.target as HTMLElement).closest('details'); if (details) details.open = true; }} onSubmit={(event) => { event.preventDefault(); void save(false); }}>
      <Explain>{copy('A reminder to pay. Adding a bill does not spend money.', 'تذكير بالدفع. إضافة فاتورة لا تنفق المال.')}</Explain>
      <label className="cr-field">
        <span className="cr-label">{t('common.name')}</span>
        <input type="text" required maxLength={60} value={name} data-autofocus="" onChange={(event) => setName(event.target.value)} />
      </label>
      <ItemSelect label={t('bill.paidFrom')} groups={pickerGroups(catalog.plan)} value={itemId} onChange={setItemId} currency={currency} />
      <fieldset className="cr-choice">
        <legend>{t('common.currency')}</legend>
        {(['USD', 'LBP'] as const).map((option) => (
          <label key={option}><input type="radio" name="bill-currency" checked={currency === option} onChange={() => setCurrency(option)} />{option}</label>
        ))}
      </fieldset>
      <MoneyField key={currency} label={t('bill.expected')} currency={currency} value={amount} onChange={setAmount} />
      <fieldset className="cr-choice">
        <legend>{t('bill.repeats')}</legend>
        {(['monthly', 'yearly', 'once'] as const).map((option) => (
          <label key={option}><input type="radio" name="bill-cadence" checked={cadence === option} onChange={() => setCadence(option)} />{t(`bill.cadence.${option}`)}</label>
        ))}
      </fieldset>
      <label className="cr-field">
        <span className="cr-label">{cadence === 'once' ? t('bill.dueOn') : t('bill.firstDue')}</span>
        <input type="date" required value={firstDue} dir="ltr" onChange={(event) => setFirstDue(event.target.value)} />
      </label>
      {cadence === 'once' ? null : (
        <details className="cr-record-details" open={Boolean(bill?.endOn)}><summary>{t('bill.endsOn')}</summary><label className="cr-field">
          <span className="cr-label">{t('bill.endsOn')}</span>
          <input type="date" value={end} min={firstDue} dir="ltr" onChange={(event) => setEnd(event.target.value)} />
        </label></details>
      )}
      {item?.kind === 'loan_payment' && loans.length > 0 ? (
        <SelectField label={t('bill.loan')} value={loanId} onChange={(event) => setLoanId(event.target.value)}>
            <option value="">{t('common.none')}</option>
            {loans.map((loan) => <option key={loan.id} value={loan.id}>{loan.name}</option>)}
          </SelectField>
      ) : null}
      {command.error ? <ErrorNotice error={command.error} /> : null}
      {bill ? (
        <button type="button" className="cr-button cr-button--danger" disabled={command.pending} onClick={() => void save(true)}>{copy('Stop future reminders', 'إيقاف التذكيرات القادمة')}</button>
      ) : null}
      <FormActions submitLabel="common.save" pending={command.pending} onCancel={onCancel} disabled={!name.trim() || !item || amount === null} />
    </form>
  );
}

