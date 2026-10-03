import { useState, type FormEvent } from 'react';
import { activeWallets, findItem, pickerGroups, useWorkspace, type Catalog } from '../app/workspace.tsx';
import { useI18n } from '../lib/i18n.tsx';
import type { Currency } from '../lib/money.ts';
import { ErrorNotice, useCommand } from '../ui/async.tsx';
import { MoneyField } from '../ui/money.tsx';
import { DateField, Explain, FormActions, ItemSelect, NoteField, READY, WalletSelect } from './fields.tsx';

export interface BillIntent {
  readonly billId: string;
  readonly name: string;
  readonly dueOn: string;
  readonly amount: bigint;
  readonly currency: Currency;
  readonly itemId: string;
  readonly loanWalletId: string | null;
}

export interface FormProps {
  readonly catalog: Catalog;
  readonly onDone: (message: string) => void;
  readonly onCancel: () => void;
}

const nullable = (text: string): string | null => (text.trim() === '' ? null : text.trim());

function readyBalance(catalog: Catalog, currency: Currency): bigint {
  return currency === catalog.plan.planCurrency ? catalog.plan.ready : 0n;
}

/** Expense: the item pays; a shortfall is covered now from Ready to assign or a chosen item. */
export function ExpenseForm({ catalog, onDone, onCancel, walletId: initialWallet, itemId: initialItem, bill }: FormProps & {
  readonly walletId?: string;
  readonly itemId?: string;
  readonly bill?: BillIntent;
}) {
  const i18n = useI18n();
  const { t, money, name } = i18n;
  const { api, space, refresh } = useWorkspace();
  const wallets = activeWallets(catalog.accounts, 'cash').filter((wallet) => !bill || wallet.currency === bill.currency);
  const [walletId, setWalletId] = useState(initialWallet ?? wallets[0]?.id ?? '');
  const [itemId, setItemId] = useState(bill?.itemId ?? initialItem ?? '');
  const [amount, setAmount] = useState<bigint | null>(bill?.amount ?? null);
  const [on, setOn] = useState(bill && bill.dueOn <= space.today ? bill.dueOn : space.today);
  const [memo, setMemo] = useState(bill?.name ?? '');
  const [coverFrom, setCoverFrom] = useState(READY);
  const wallet = wallets.find((candidate) => candidate.id === walletId);
  const currency: Currency = wallet?.currency ?? 'USD';
  const groups = pickerGroups(catalog.plan);
  const item = itemId ? findItem(catalog.plan, itemId) : null;
  const available = item ? (item.balances[currency] > 0n ? item.balances[currency] : 0n) : 0n;
  const shortfall = amount !== null && item && amount > available ? amount - available : 0n;
  const ready = readyBalance(catalog, currency);
  const command = useCommand((requestId, _: null) => api.recordExpense({
    spaceId: space.id, requestId, walletId, itemId, amount: amount ?? 0n, on, memo: nullable(memo),
    coverFrom: shortfall > 0n && coverFrom !== READY ? coverFrom : null,
    billId: bill?.billId ?? null, billDue: bill?.dueOn ?? null,
  }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (amount === null || !item || !wallet) return;
    const result = await command.submit(null);
    if (!result) return;
    refresh();
    onDone(t('record.expenseDone', { amount: money(amount, currency), name: name(item) }));
  }

  if (wallets.length === 0) return <Explain>{t('record.needWallet')}</Explain>;
  return (
    <form className="dialog-form cr-stack" onSubmit={(event) => void submit(event)}>
      {bill ? <Explain>{t('record.payingBill', { name: bill.name, date: i18n.date(bill.dueOn) })}</Explain> : null}
      <MoneyField label={t('common.amount')} currency={currency} value={amount} onChange={setAmount} autoFocus />
      <WalletSelect label={t('record.paidFrom')} wallets={wallets} value={walletId} onChange={setWalletId} />
      {bill ? null : <ItemSelect label={t('record.whatFor')} groups={groups} value={itemId} onChange={setItemId} currency={currency} />}
      {item && shortfall === 0n ? (
        <p className="cr-helper">{t('record.itemHolds', { name: name(item), amount: money(item.balances[currency], currency) })}</p>
      ) : null}
      {shortfall > 0n && item ? (
        <div className="cr-cover">
          <Explain tone="warn">
            {t('record.shortfall', { name: name(item), available: money(available, currency), shortfall: money(shortfall, currency) })}
          </Explain>
          <ItemSelect
            label={t('record.coverFrom')}
            groups={groups.map((group) => ({ ...group, items: group.items.filter((candidate) => candidate.balances[currency] >= shortfall) }))}
            value={coverFrom}
            onChange={setCoverFrom}
            currency={currency}
            includeReady
            readyBalance={ready}
            exclude={itemId}
          />
          {coverFrom === READY && ready < shortfall ? (
            <Explain tone="warn">{t('record.willOverAssign', { amount: money(shortfall - (ready > 0n ? ready : 0n), currency) })}</Explain>
          ) : null}
        </div>
      ) : null}
      <DateField value={on} onChange={setOn} max={space.today} />
      <NoteField value={memo} onChange={setMemo} />
      {command.error ? <ErrorNotice error={command.error} /> : null}
      <FormActions submitLabel="record.saveExpense" pending={command.pending} onCancel={onCancel} disabled={amount === null || !item} />
    </form>
  );
}

export function RefundForm({ catalog, onDone, onCancel }: FormProps) {
  const { t, money, name } = useI18n();
  const { api, space, refresh } = useWorkspace();
  const wallets = activeWallets(catalog.accounts, 'cash');
  const [walletId, setWalletId] = useState(wallets[0]?.id ?? '');
  const [itemId, setItemId] = useState('');
  const [amount, setAmount] = useState<bigint | null>(null);
  const [on, setOn] = useState(space.today);
  const [memo, setMemo] = useState('');
  const currency: Currency = wallets.find((wallet) => wallet.id === walletId)?.currency ?? 'USD';
  const item = itemId ? findItem(catalog.plan, itemId) : null;
  const command = useCommand((requestId, _: null) => api.recordRefund({ spaceId: space.id, requestId, walletId, itemId, amount: amount ?? 0n, on, memo: nullable(memo) }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (amount === null || !item) return;
    if (!(await command.submit(null))) return;
    refresh();
    onDone(t('record.refundDone', { amount: money(amount, currency), name: name(item) }));
  }
  if (wallets.length === 0) return <Explain>{t('record.needWallet')}</Explain>;
  return (
    <form className="dialog-form cr-stack" onSubmit={(event) => void submit(event)}>
      <Explain>{t('record.refundExplain')}</Explain>
      <MoneyField label={t('common.amount')} currency={currency} value={amount} onChange={setAmount} autoFocus />
      <WalletSelect label={t('record.receivedIn')} wallets={wallets} value={walletId} onChange={setWalletId} />
      <ItemSelect label={t('record.refundTo')} groups={pickerGroups(catalog.plan)} value={itemId} onChange={setItemId} currency={currency} />
      <DateField value={on} onChange={setOn} max={space.today} />
      <NoteField value={memo} onChange={setMemo} />
      {command.error ? <ErrorNotice error={command.error} /> : null}
      <FormActions submitLabel="record.saveRefund" pending={command.pending} onCancel={onCancel} disabled={amount === null || !item} />
    </form>
  );
}

export function IncomeForm({ catalog, onDone, onCancel, walletId: initialWallet, onFund }: FormProps & { readonly walletId?: string; readonly onFund: () => void }) {
  const { t, money, name } = useI18n();
  const { api, space, refresh } = useWorkspace();
  const wallets = activeWallets(catalog.accounts, 'cash');
  const [walletId, setWalletId] = useState(initialWallet ?? wallets[0]?.id ?? '');
  const [amount, setAmount] = useState<bigint | null>(null);
  const [on, setOn] = useState(space.today);
  const [memo, setMemo] = useState('');
  const [target, setTarget] = useState(READY);
  const [done, setDone] = useState<string | null>(null);
  const currency: Currency = wallets.find((wallet) => wallet.id === walletId)?.currency ?? 'USD';
  const command = useCommand((requestId, _: null) => api.recordIncome({
    spaceId: space.id, requestId, walletId, amount: amount ?? 0n, on, memo: nullable(memo), itemId: target === READY ? null : target,
  }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (amount === null) return;
    if (!(await command.submit(null))) return;
    refresh();
    const item = target === READY ? null : findItem(catalog.plan, target);
    const message = item
      ? t('record.incomeIntoItem', { amount: money(amount, currency), name: name(item) })
      : t('record.incomeDone', { amount: money(amount, currency) });
    if (target === READY && currency === catalog.plan.planCurrency && catalog.plan.stillToFund > 0n) setDone(message);
    else onDone(message);
  }
  if (done) {
    return (
      <div className="dialog-result cr-stack">
        <p role="status">{done}</p>
        <p className="cr-helper">{t('record.fundNowHint', { amount: money(catalog.plan.stillToFund, catalog.plan.planCurrency) })}</p>
        <div className="dialog-actions">
          <button type="button" className="cr-button" onClick={() => onDone(done)}>{t('common.done')}</button>
          <button type="button" className="cr-button cr-button--primary" onClick={onFund}>{t('plan.fund')}</button>
        </div>
      </div>
    );
  }
  if (wallets.length === 0) return <Explain>{t('record.needWallet')}</Explain>;
  return (
    <form className="dialog-form cr-stack" onSubmit={(event) => void submit(event)}>
      <MoneyField label={t('common.amount')} currency={currency} value={amount} onChange={setAmount} autoFocus />
      <WalletSelect label={t('record.receivedIn')} wallets={wallets} value={walletId} onChange={setWalletId} />
      <ItemSelect label={t('record.incomeGoesTo')} groups={pickerGroups(catalog.plan)} value={target} onChange={setTarget} currency={currency} includeReady />
      <Explain>{t('record.incomeExplain')}</Explain>
      <DateField value={on} onChange={setOn} max={space.today} />
      <NoteField value={memo} onChange={setMemo} />
      {command.error ? <ErrorNotice error={command.error} /> : null}
      <FormActions submitLabel="record.saveIncome" pending={command.pending} onCancel={onCancel} disabled={amount === null} />
    </form>
  );
}

export function TransferForm({ catalog, onDone, onCancel }: FormProps) {
  const { t, money } = useI18n();
  const { api, space, refresh } = useWorkspace();
  const wallets = activeWallets(catalog.accounts, 'cash');
  const [fromId, setFromId] = useState(wallets[0]?.id ?? '');
  const from = wallets.find((wallet) => wallet.id === fromId);
  const targets = wallets.filter((wallet) => wallet.id !== fromId && wallet.currency === from?.currency);
  const [toId, setToId] = useState('');
  const effectiveTo = targets.some((wallet) => wallet.id === toId) ? toId : (targets[0]?.id ?? '');
  const [amount, setAmount] = useState<bigint | null>(null);
  const [on, setOn] = useState(space.today);
  const [memo, setMemo] = useState('');
  const currency: Currency = from?.currency ?? 'USD';
  const command = useCommand((requestId, _: null) => api.recordTransfer({ spaceId: space.id, requestId, fromWalletId: fromId, toWalletId: effectiveTo, amount: amount ?? 0n, on, memo: nullable(memo) }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (amount === null || !effectiveTo) return;
    if (!(await command.submit(null))) return;
    refresh();
    onDone(t('record.transferDone', { amount: money(amount, currency) }));
  }
  return (
    <form className="dialog-form cr-stack" onSubmit={(event) => void submit(event)}>
      <Explain>{t('record.transferExplain')}</Explain>
      <MoneyField label={t('common.amount')} currency={currency} value={amount} onChange={setAmount} autoFocus />
      <WalletSelect label={t('record.from')} wallets={wallets} value={fromId} onChange={setFromId} />
      {targets.length > 0 ? (
        <WalletSelect label={t('record.to')} wallets={targets} value={effectiveTo} onChange={setToId} />
      ) : (
        <Explain tone="warn">{t('record.noTransferTarget')}</Explain>
      )}
      <DateField value={on} onChange={setOn} max={space.today} />
      <NoteField value={memo} onChange={setMemo} />
      {command.error ? <ErrorNotice error={command.error} /> : null}
      <FormActions submitLabel="record.saveTransfer" pending={command.pending} onCancel={onCancel} disabled={amount === null || !effectiveTo} />
    </form>
  );
}

/** Move money between purposes. No wallet changes; never income or spending. */
export function MoveForm({ catalog, onDone, onCancel, fromItemId, toItemId, currency: initialCurrency }: FormProps & {
  readonly fromItemId?: string;
  readonly toItemId?: string;
  readonly currency?: Currency;
}) {
  const { t, money, name } = useI18n();
  const { api, space, refresh } = useWorkspace();
  const [currency, setCurrency] = useState<Currency>(initialCurrency ?? catalog.plan.planCurrency);
  const [from, setFrom] = useState(fromItemId ?? READY);
  const [to, setTo] = useState(toItemId ?? '');
  const [amount, setAmount] = useState<bigint | null>(null);
  const [on, setOn] = useState(space.today);
  const groups = pickerGroups(catalog.plan);
  const ready = readyBalance(catalog, currency);
  const fromItem = from === READY ? null : findItem(catalog.plan, from);
  const toItem = to === READY ? null : findItem(catalog.plan, to);
  const fromAvailable = fromItem ? fromItem.balances[currency] : ready;
  const command = useCommand((requestId, _: null) => api.assignMoney({
    spaceId: space.id, requestId, on, moves: [{ from: from === READY ? null : from, to: to === READY ? null : to, currency, amount: amount ?? 0n }],
  }));
  const label = (item: ReturnType<typeof findItem>) => (item ? name(item) : t('common.readyToAssign'));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (amount === null || from === to) return;
    if (!(await command.submit(null))) return;
    refresh();
    onDone(t('record.moveDone', { amount: money(amount, currency), from: label(fromItem), to: label(toItem) }));
  }
  return (
    <form className="dialog-form cr-stack" onSubmit={(event) => void submit(event)}>
      <Explain>{t('record.moveExplain')}</Explain>
      <fieldset className="cr-choice">
        <legend>{t('common.currency')}</legend>
        {(['USD', 'LBP'] as const).map((option) => (
          <label key={option}><input type="radio" name="move-currency" checked={currency === option} onChange={() => setCurrency(option)} />{option}</label>
        ))}
      </fieldset>
      <ItemSelect label={t('record.from')} groups={groups} value={from} onChange={setFrom} currency={currency} includeReady readyBalance={ready} />
      <ItemSelect label={t('record.to')} groups={groups} value={to} onChange={setTo} currency={currency} includeReady readyBalance={ready} exclude={from} />
      <MoneyField key={currency} label={t('common.amount')} currency={currency} value={amount} onChange={setAmount} autoFocus
        hint={t('record.moveAvailable', { name: label(fromItem), amount: money(fromAvailable, currency) })} />
      {amount !== null && amount > fromAvailable ? <Explain tone="warn">{t('record.moveTooMuch')}</Explain> : null}
      <DateField value={on} onChange={setOn} max={space.today} />
      {command.error ? <ErrorNotice error={command.error} /> : null}
      <FormActions submitLabel="record.saveMove" pending={command.pending} onCancel={onCancel} disabled={amount === null || from === to || amount > fromAvailable} />
    </form>
  );
}

/** Exchange: both amounts are what actually changed hands; the rate is derived. */
export function ExchangeForm({ catalog, onDone, onCancel }: FormProps) {
  const { t, money, name } = useI18n();
  const { api, space, refresh } = useWorkspace();
  const wallets = activeWallets(catalog.accounts, 'cash');
  const [fromId, setFromId] = useState(wallets.find((wallet) => wallet.currency === 'USD')?.id ?? wallets[0]?.id ?? '');
  const from = wallets.find((wallet) => wallet.id === fromId);
  const targets = wallets.filter((wallet) => wallet.currency !== from?.currency);
  const [toId, setToId] = useState('');
  const effectiveTo = targets.some((wallet) => wallet.id === toId) ? toId : (targets[0]?.id ?? '');
  const to = targets.find((wallet) => wallet.id === effectiveTo);
  const [gave, setGave] = useState<bigint | null>(null);
  const [got, setGot] = useState<bigint | null>(null);
  const [purpose, setPurpose] = useState(READY);
  const [on, setOn] = useState(space.today);
  const fromCurrency: Currency = from?.currency ?? 'USD';
  const toCurrency: Currency = to?.currency ?? 'LBP';
  const item = purpose === READY ? null : findItem(catalog.plan, purpose);
  const rate = gave && got && fromCurrency === 'USD' ? (got * 100n) / gave : gave && got ? (gave * 100n) / got : null;
  const command = useCommand((requestId, _: null) => api.recordExchange({
    spaceId: space.id, requestId, fromWalletId: fromId, fromAmount: gave ?? 0n, toWalletId: effectiveTo, toAmount: got ?? 0n,
    itemId: purpose === READY ? null : purpose, on,
  }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!gave || !got || !to) return;
    if (!(await command.submit(null))) return;
    refresh();
    onDone(t('record.exchangeDone', { gave: money(gave, fromCurrency), got: money(got, toCurrency) }));
  }
  if (targets.length === 0) return <Explain>{t('record.needOtherCurrency')}</Explain>;
  return (
    <form className="dialog-form cr-stack" onSubmit={(event) => void submit(event)}>
      <Explain>{t('record.exchangeExplain')}</Explain>
      <WalletSelect label={t('record.from')} wallets={wallets} value={fromId} onChange={setFromId} />
      <MoneyField key={`gave-${fromCurrency}`} label={t('record.youGave')} currency={fromCurrency} value={gave} onChange={setGave} autoFocus />
      <WalletSelect label={t('record.to')} wallets={targets} value={effectiveTo} onChange={setToId} />
      <MoneyField key={`got-${toCurrency}`} label={t('record.youGot')} currency={toCurrency} value={got} onChange={setGot} />
      {rate !== null ? <p className="cr-helper">{t('record.impliedRate', { rate: (rate / 100n).toString() })}</p> : null}
      <ItemSelect label={t('record.exchangeFor')} groups={pickerGroups(catalog.plan)} value={purpose} onChange={setPurpose} currency={fromCurrency}
        includeReady readyBalance={readyBalance(catalog, fromCurrency)} />
      {item ? <p className="cr-helper">{t('record.exchangeKeepsPurpose', { name: name(item) })}</p> : null}
      <DateField value={on} onChange={setOn} max={space.today} />
      {command.error ? <ErrorNotice error={command.error} /> : null}
      <FormActions submitLabel="record.saveExchange" pending={command.pending} onCancel={onCancel} disabled={!gave || !got} />
    </form>
  );
}

