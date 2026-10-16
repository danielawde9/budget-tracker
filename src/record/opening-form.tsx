import { useState, type FormEvent } from 'react';
import { findItem, pickerGroups, useWorkspace } from '../app/workspace.tsx';
import { useI18n } from '../lib/i18n.tsx';
import type { Currency } from '../lib/money.ts';
import { ErrorNotice, useCommand } from '../ui/async.tsx';
import { Amount, MoneyField } from '../ui/money.tsx';
import { SelectField } from '../ui/select-field.tsx';
import { DateField, Explain, FormActions, ItemSelect, Preview } from './fields.tsx';
import type { FormProps } from './forms-everyday.tsx';
import { useRecordCopy } from './record-copy.ts';

/** Account openings add missing assets; category openings only assign existing assets. */
export function OpeningForm({ catalog, onDone, onCancel, walletId, itemId: initialItem, target = 'account' }: FormProps & {
  readonly target?: 'account' | 'category'; readonly walletId?: string; readonly itemId?: string;
}) {
  const { api, space, refresh } = useWorkspace();
  const { t, money, name } = useI18n();
  const copy = useRecordCopy();
  const category = target === 'category';
  const wallets = catalog.accounts.wallets.filter(wallet => !wallet.archived);
  const [accountId, setAccountId] = useState(walletId ?? wallets[0]?.id ?? '');
  const account = wallets.find(wallet => wallet.id === accountId);
  const [chosenCurrency, setCurrency] = useState<Currency>(catalog.plan.planCurrency);
  const currency = category ? chosenCurrency : account?.currency ?? chosenCurrency;
  const [itemId, setItemId] = useState(initialItem ?? '');
  const item = findItem(catalog.plan, itemId);
  const [amount, setAmount] = useState<bigint | null>(null);
  const [on, setOn] = useState(space.today);
  const [submitted, setSubmitted] = useState(false);
  const ready = catalog.ready[currency];
  const exceedsReady = category && amount !== null && amount > ready;
  const command = useCommand((requestId, _: null) => category
    ? api.assignMoney({ spaceId: space.id, requestId, on, opening: true, moves: [{ from: null, to: itemId, currency, amount: amount ?? 0n }] })
    : api.recordWalletOpening({ spaceId: space.id, requestId, walletId: accountId, amount: amount ?? 0n, on }));
  async function submit(event: FormEvent) {
    event.preventDefault(); setSubmitted(true);
    if (amount === null || amount <= 0n || !on || on > space.today || (category ? !item || exceedsReady : !account)) return;
    if (!(await command.submit(null))) return;
    refresh();
    onDone(copy(`Opening balance of ${money(amount, currency)} recorded.`, `تم تسجيل رصيد افتتاحي بقيمة ${money(amount, currency)}.`));
  }
  const delta = !category && account?.kind === 'loan' && account.loanDirection === 'i_owe' ? -(amount ?? 0n) : amount ?? 0n;
  return <form className="dialog-form cr-stack" onSubmit={event => void submit(event)}>
    <Explain>{category
      ? copy('Assign money already held in your accounts. This changes its purpose, not your account balance, income or monthly funding.', 'وزّع مالًا موجودًا في حساباتك. يتغير غرضه فقط، دون تغيير رصيد الحساب أو الدخل أو التمويل الشهري.')
      : copy('Add only existing money missing from this account. This adds to its recorded balance without counting as income. If the account balance is already correct, assign the money in Plan instead.', 'أضف فقط مالًا موجودًا لم يُسجّل في هذا الحساب. يُضاف إلى الرصيد دون احتسابه دخلًا. إذا كان رصيد الحساب صحيحًا، وزّع المال في الخطة بدلًا من ذلك.')}</Explain>
    {category ? <>
      <fieldset className="cr-choice"><legend>{t('common.currency')}</legend>{(['USD','LBP'] as const).map(value => <label key={value}><input type="radio" name="opening-currency" checked={currency === value} onChange={() => { setCurrency(value); setAmount(null); }} />{value}</label>)}</fieldset>
      <ItemSelect label={copy('Category', 'الفئة')} groups={pickerGroups(catalog.plan)} value={itemId} onChange={setItemId} currency={currency} />
      <p className="cr-helper">{copy('Available to assign', 'متاح للتوزيع')}: <Amount minor={ready} currency={currency} /></p>
    </> : <SelectField label={copy('Account', 'الحساب')} value={accountId} required onChange={event => { setAccountId(event.target.value); setAmount(null); }}><option value="" disabled>{copy('Choose an account', 'اختر حسابًا')}</option>{wallets.map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.name} · {wallet.currency}</option>)}</SelectField>}
    {!category && wallets.length === 0 ? <p role="status">{copy('Add an account first, then enter its opening balance.', 'أضف حسابًا أولًا ثم أدخل رصيده الافتتاحي.')}</p> : null}
    <MoneyField key={`${currency}-${accountId}`} name="openingAmount" label={category ? copy('Opening amount', 'المبلغ الافتتاحي') : copy('Missing opening amount', 'المبلغ الافتتاحي غير المسجل')} currency={currency} value={amount} onChange={setAmount} />
    <DateField value={on} onChange={setOn} max={space.today} label={copy('Balance date', 'تاريخ الرصيد')} />
    {amount !== null && amount > 0n ? <Preview>{category && item ? <>
      <p><bdi>{name(item)}</bdi>: {money(item.balances[currency], currency)} → {money(item.balances[currency] + amount, currency)}</p>
      <p>{copy('Unassigned money', 'المال غير الموزع')}: {money(ready, currency)} → {money(ready - amount, currency)}</p>
      <p>{copy('Account balances stay the same.', 'تبقى أرصدة الحسابات كما هي.')}</p>
    </> : account ? <><p><bdi>{account.name}</bdi>: {money(account.balance, currency)} → {money(account.balance + delta, currency)}</p><p>{copy('Adds previously unrecorded opening money.', 'يضيف مالًا افتتاحيًا لم يُسجّل من قبل.')}</p></> : null}</Preview> : null}
    {exceedsReady ? <Explain tone="warn">{copy('There is not enough unassigned money. If this money is missing from your accounts, add its opening balance in Accounts first.', 'لا يوجد مال غير موزّع كافٍ. إذا لم يُسجّل هذا المال في حساباتك، أضف رصيده الافتتاحي في الحسابات أولًا.')}</Explain> : null}
    {submitted && (amount === null || amount <= 0n) ? <p role="alert">{t('error.BUDGET_INVALID_AMOUNT')}</p> : null}
    {command.error ? <ErrorNotice error={command.error} /> : null}
    <FormActions submitLabel="wallet.save" submitText={copy('Save opening balance', 'حفظ الرصيد الافتتاحي')} pending={command.pending} onCancel={onCancel} />
  </form>;
}
