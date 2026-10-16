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

/** Opening totals add only missing assets or assign assets already recorded. */
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
  const [total, setTotal] = useState<bigint | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [on, setOn] = useState(space.today);
  const [submitted, setSubmitted] = useState(false);
  const debt = !category && account?.kind === 'loan' && account.loanDirection === 'i_owe';
  // Debt totals are entered as a positive outstanding amount. The database
  // snapshot remains signed so stale checks also work for loan accounts.
  const recorded = category ? item?.balances[currency] ?? 0n : account?.balance ?? 0n;
  const current = debt ? -recorded : recorded;
  const difference = total === null ? 0n : total - current;
  const ready = catalog.ready[currency];
  const exceedsReady = category && difference > 0n && difference > ready;
  const lowerTotal = total !== null && difference < 0n;
  const noChange = total !== null && difference === 0n;
  const command = useCommand((requestId, _: null) => category
    ? api.assignMoney({ spaceId: space.id, requestId, on, opening: true, moves: [{ from: null, to: itemId, currency, amount: difference, expectedBalance: recorded }] })
    : api.recordWalletOpening({ spaceId: space.id, requestId, walletId: accountId, amount: difference, on, expectedBalance: recorded }));
  const stale = command.error?.code === 'BUDGET_BALANCE_CHANGED';
  function resetSelection() { setTotal(null); setConfirmed(false); setSubmitted(false); }
  function reloadBalances() {
    resetSelection(); command.resetRequest(); refresh();
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setSubmitted(true);
    if (total === null || difference <= 0n || !confirmed || stale || !on || on > space.today || (category ? !item || exceedsReady : !account)) return;
    if (!(await command.submit(null))) return;
    refresh();
    onDone(category
      ? copy(`${money(difference, currency)} assigned. Category balance: ${money(total, currency)}.`, `تم توزيع ${money(difference, currency)}. رصيد الفئة: ${money(total, currency)}.`)
      : debt
        ? copy(`${money(difference, currency)} of missing debt recorded. Total outstanding: ${money(total, currency)}.`, `تم تسجيل دين غير مسجّل بقيمة ${money(difference, currency)}. إجمالي الدين: ${money(total, currency)}.`)
        : copy(`${money(difference, currency)} of missing opening money recorded. Account balance: ${money(total, currency)}.`, `تم تسجيل مال افتتاحي غير مسجّل بقيمة ${money(difference, currency)}. رصيد الحساب: ${money(total, currency)}.`));
  }
  return <form className="dialog-form cr-stack" onSubmit={event => void submit(event)}>
    <Explain>{category
      ? copy('Enter the total this category should hold, including money already assigned. Only the difference comes from unassigned money. Account balances, income and monthly funding stay the same.', 'أدخل إجمالي ما يجب أن تحتويه هذه الفئة، بما فيه المال الموزّع سابقًا. يُؤخذ الفرق فقط من المال غير الموزّع. تبقى أرصدة الحسابات والدخل والتمويل الشهري كما هي.')
      : debt
        ? copy('Enter the total debt still owed, including debt already recorded. Only previously missing debt is added.', 'أدخل إجمالي الدين المتبقي عليك، بما فيه الدين المسجّل سابقًا. يُضاف فقط الدين غير المسجّل.')
        : copy('Enter the total this account should hold, including all money already recorded. Only previously missing money is added, without counting as income. If its balance is correct, assign the money in Plan.', 'أدخل إجمالي ما يجب أن يحتويه الحساب، بما فيه كل المال المسجّل سابقًا. يُضاف فقط المال غير المسجّل دون احتسابه دخلًا. إذا كان الرصيد صحيحًا، وزّع المال في الخطة.')}</Explain>
    {category ? <>
      <fieldset className="cr-choice"><legend>{t('common.currency')}</legend>{(['USD','LBP'] as const).map(value => <label key={value}><input type="radio" name="opening-currency" checked={currency === value} onChange={() => { setCurrency(value); resetSelection(); }} />{value}</label>)}</fieldset>
      <ItemSelect label={copy('Category', 'الفئة')} groups={pickerGroups(catalog.plan)} value={itemId} onChange={value => { setItemId(value); resetSelection(); }} currency={currency} />
      <p className="cr-helper">{copy('Available to assign', 'متاح للتوزيع')}: <Amount minor={ready} currency={currency} /></p>
    </> : <SelectField label={copy('Account', 'الحساب')} value={accountId} required onChange={event => { setAccountId(event.target.value); resetSelection(); }}><option value="" disabled>{copy('Choose an account', 'اختر حسابًا')}</option>{wallets.map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.name} · {wallet.currency}</option>)}</SelectField>}
    {!category && wallets.length === 0 ? <p role="status">{copy('Add an account first, then enter its opening balance.', 'أضف حسابًا أولًا ثم أدخل رصيده الافتتاحي.')}</p> : null}
    {(category ? item : account) ? <p className="cr-helper">{debt ? copy('Currently recorded debt', 'الدين المسجّل حاليًا') : copy('Current recorded balance', 'الرصيد المسجّل حاليًا')}: <Amount minor={current} currency={currency} /></p> : null}
    <MoneyField key={`${currency}-${accountId}`} name="openingTotal" label={category ? copy('Total category balance', 'إجمالي رصيد الفئة') : debt ? copy('Total outstanding debt', 'إجمالي الدين المتبقي') : copy('Total account balance', 'إجمالي رصيد الحساب')} currency={currency} value={total} onChange={setTotal} allowZero />
    <DateField value={on} onChange={setOn} max={space.today} label={copy('Balance date', 'تاريخ الرصيد')} />
    {total !== null && difference > 0n ? <Preview>{category && item ? <>
      <p><bdi>{name(item)}</bdi>: {money(current, currency)} → {money(total, currency)}</p>
      <p>{copy('Money to assign', 'المال المراد توزيعه')}: {money(difference, currency)}</p>
      <p>{copy('Unassigned money', 'المال غير الموزع')}: {money(ready, currency)} → {money(ready - difference, currency)}</p>
      <p>{copy('Account balances stay the same.', 'تبقى أرصدة الحسابات كما هي.')}</p>
    </> : account ? <>
      <p>{debt ? copy('Outstanding debt', 'الدين المتبقي') : <bdi>{account.name}</bdi>}: {money(current, currency)} → {money(total, currency)}</p>
      <p>{debt ? copy('Missing debt to add', 'الدين غير المسجّل المراد إضافته') : copy('Missing money to add', 'المال غير المسجّل المراد إضافته')}: {money(difference, currency)}</p>
    </> : null}</Preview> : null}
    {noChange ? <p role="status" className="cr-helper">{copy('This total is already recorded. Nothing will be added.', 'هذا الإجمالي مسجّل بالفعل. لن يُضاف أي مبلغ.')}</p> : null}
    {lowerTotal ? <Explain tone="warn">{category
      ? copy('An opening balance can only add money. To lower this category balance, use Move money in Plan to return the difference to unassigned money.', 'يمكن للرصيد الافتتاحي إضافة المال فقط. لخفض رصيد الفئة، استخدم نقل المال في الخطة لإعادة الفرق إلى المال غير الموزّع.')
      : copy('An opening balance can only add a missing amount. To lower this total, correct the relevant record in Activity or record the actual payment or expense.', 'يمكن للرصيد الافتتاحي إضافة مبلغ غير مسجّل فقط. لخفض الإجمالي، صحّح القيد المعني في النشاط أو سجّل الدفعة أو المصروف الفعلي.')}</Explain> : null}
    {exceedsReady ? <>
      <Explain tone="warn">{copy('There is not enough unassigned money. Review the total or use Move money in Plan to free money already assigned elsewhere.', 'لا يوجد مال غير موزّع كافٍ. راجع الإجمالي أو استخدم نقل المال في الخطة لتحرير مال موزّع في مكان آخر.')}</Explain>
      <Explain>{copy('Only if money is missing from the recorded account balance, use Accounts → Add opening balance first. Include money already recorded in that account total.', 'فقط إذا كان هناك مال غير مسجّل في رصيد الحساب، استخدم الحسابات ← إضافة رصيد افتتاحي أولًا. أدرج المال المسجّل سابقًا ضمن إجمالي الحساب.')}</Explain>
    </> : null}
    <fieldset className="cr-choice"><legend>{copy('Confirm what is already recorded', 'تأكيد ما تم تسجيله سابقًا')}</legend><label><input type="checkbox" name="opening-confirmed" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{category
      ? copy('This money is already included in my account balances.', 'هذا المال مدرج بالفعل في أرصدة حساباتي.')
      : debt
        ? copy('This total includes all debt already recorded. Only the difference is missing.', 'يشمل هذا الإجمالي كل الدين المسجّل سابقًا. الفرق فقط غير مسجّل.')
        : copy('This total includes all money already recorded in this account. Only the difference is missing.', 'يشمل هذا الإجمالي كل المال المسجّل سابقًا في هذا الحساب. الفرق فقط غير مسجّل.')}</label></fieldset>
    {submitted && total === null ? <p role="alert">{t('error.BUDGET_INVALID_AMOUNT')}</p> : null}
    {submitted && total !== null && difference > 0n && !confirmed ? <p role="alert">{copy('Confirm what is already included before saving.', 'أكّد ما هو مدرج بالفعل قبل الحفظ.')}</p> : null}
    {command.error ? <ErrorNotice error={command.error} /> : null}
    {stale ? <button type="button" className="cr-button" onClick={reloadBalances}>{copy('Reload balances', 'إعادة تحميل الأرصدة')}</button> : null}
    <FormActions submitLabel="wallet.save" submitText={copy('Save opening balance', 'حفظ الرصيد الافتتاحي')} pending={command.pending} disabled={noChange || lowerTotal || exceedsReady || stale} onCancel={onCancel} />
  </form>;
}
