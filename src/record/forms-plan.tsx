import { useState, type FormEvent } from 'react';
import type { Bill } from '../api/schemas.ts';
import { activeWallets, findItem, pickerGroups, useWorkspace } from '../app/workspace.tsx';
import { useI18n } from '../lib/i18n.tsx';
import type { Currency } from '../lib/money.ts';
import { ErrorNotice, LoadState, useCommand, useLoad } from '../ui/async.tsx';
import { Amount, MoneyField } from '../ui/money.tsx';
import { Explain, FormActions, ItemSelect } from './fields.tsx';
import type { FormProps } from './forms-everyday.tsx';

/**
 * Fund my plan: the database proposes what each item still needs this month,
 * top to bottom, from the money in Ready to assign. Every line is editable.
 */
export function FundForm({ catalog, onDone, onCancel, month }: FormProps & { readonly month: string }) {
  const { t, money, name } = useI18n();
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
        const total = lines.reduce((sum, line) => sum + line.amount, 0n);
        const tooMuch = total > catalog.plan.ready;
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
          <form className="dialog-form cr-stack" onSubmit={(event) => void submit(event)}>
            <Explain>{t('fund.explain', { available: money(data.available, currency) })}</Explain>
            <ul className="cr-fund-lines">
              {data.lines.map((line) => {
                const item = findItem(catalog.plan, line.itemId);
                return (
                  <li key={line.itemId} className="cr-fund-line">
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
            {data.unfunded > 0n ? <p className="cr-helper">{t('fund.stillAfter', { amount: money(data.unfunded, currency) })}</p> : null}
            {tooMuch ? <Explain tone="warn">{t('fund.tooMuch', { amount: money(catalog.plan.ready, currency) })}</Explain> : null}
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
    <form className="dialog-form cr-stack" onSubmit={(event) => { event.preventDefault(); void save(false); }}>
      <Explain>{t('bill.explain')}</Explain>
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
        <label className="cr-field">
          <span className="cr-label">{t('bill.endsOn')}</span>
          <input type="date" value={end} min={firstDue} dir="ltr" onChange={(event) => setEnd(event.target.value)} />
        </label>
      )}
      {item?.kind === 'loan_payment' && loans.length > 0 ? (
        <label className="cr-field">
          <span className="cr-label">{t('bill.loan')}</span>
          <select value={loanId} onChange={(event) => setLoanId(event.target.value)}>
            <option value="">{t('common.none')}</option>
            {loans.map((loan) => <option key={loan.id} value={loan.id}>{loan.name}</option>)}
          </select>
        </label>
      ) : null}
      {command.error ? <ErrorNotice error={command.error} /> : null}
      {bill ? (
        <button type="button" className="cr-button cr-button--danger" disabled={command.pending} onClick={() => void save(true)}>{t('bill.remove')}</button>
      ) : null}
      <FormActions submitLabel="common.save" pending={command.pending} onCancel={onCancel} disabled={!name.trim() || !item || amount === null} />
    </form>
  );
}

