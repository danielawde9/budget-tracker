import { useState, type FormEvent } from 'react';
import type { InvestmentAction, LoanAction } from '../api/budget-api.ts';
import type { Entry } from '../api/schemas.ts';
import { activeWallets, pickerGroups, useWorkspace } from '../app/workspace.tsx';
import { useI18n, type MessageKey } from '../lib/i18n.tsx';
import { parseMoney, type Currency } from '../lib/money.ts';
import { ErrorNotice, useCommand } from '../ui/async.tsx';
import { Amount, MoneyField } from '../ui/money.tsx';
import { CoverChoice, DateField, Explain, Preview, FormActions, ItemSelect, NoteField, READY, shortfallOf, WalletSelect, withCovered } from './fields.tsx';
import { SelectField } from '../ui/select-field.tsx';
import { useRecordCopy } from './record-copy.ts';
import type { BillIntent, FormProps } from './forms-everyday.tsx';

const nullable = (text: string): string | null => (text.trim() === '' ? null : text.trim());

const INVEST_ACTIONS: readonly { readonly action: InvestmentAction; readonly label: MessageKey; readonly explain: MessageKey }[] = [
  { action: 'contribute', label: 'invest.contribute', explain: 'invest.contributeExplain' },
  { action: 'value', label: 'invest.value', explain: 'invest.valueExplain' },
  { action: 'withdraw', label: 'invest.withdraw', explain: 'invest.withdrawExplain' },
  { action: 'fee', label: 'invest.fee', explain: 'invest.feeExplain' },
  { action: 'income_cash', label: 'invest.incomeCash', explain: 'invest.incomeCashExplain' },
  { action: 'income_reinvested', label: 'invest.incomeReinvested', explain: 'invest.incomeReinvestedExplain' },
];

export function InvestForm({ catalog, onDone, onCancel, action: initialAction, investmentId }: FormProps & {
  readonly action?: InvestmentAction;
  readonly investmentId?: string;
}) {
  const i18n = useI18n();
  const copy = useRecordCopy();
  const { t, money } = i18n;
  const { api, space, refresh } = useWorkspace();
  const investments = activeWallets(catalog.accounts, 'investment');
  const [action, setAction] = useState<InvestmentAction>(initialAction ?? 'contribute');
  const [accountId, setAccountId] = useState(investmentId ?? investments[0]?.id ?? '');
  const account = investments.find((wallet) => wallet.id === accountId);
  const currency: Currency = account?.currency ?? 'USD';
  const cash = activeWallets(catalog.accounts, 'cash').filter((wallet) => wallet.currency === currency);
  const [cashId, setCashId] = useState('');
  const effectiveCash = cash.some((wallet) => wallet.id === cashId) ? cashId : (cash[0]?.id ?? '');
  const [itemId, setItemId] = useState(() => defaultInvestItem(catalog, accountId));
  const [coverFrom, setCoverFrom] = useState(READY);
  const [amount, setAmount] = useState<bigint | null>(null);
  const [on, setOn] = useState(space.today);
  const [memo, setMemo] = useState('');
  const needsCash = action === 'contribute' || action === 'withdraw' || action === 'income_cash';
  const explain = INVEST_ACTIONS.find((candidate) => candidate.action === action)?.explain ?? 'invest.contributeExplain';
  const command = useCommand((requestId, _: null) => api.recordInvestment({
    spaceId: space.id, requestId, action, investmentId: accountId, amount: amount ?? 0n, on,
    cashWalletId: needsCash ? effectiveCash : null, itemId: action === 'contribute' ? itemId : null, memo: nullable(memo),
    coverFrom: action === 'contribute' && shortfallOf(catalog, itemId, currency, amount) > 0n && coverFrom !== READY ? coverFrom : null,
  }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (amount === null || !account) return;
    const result = await command.submit(null);
    if (!result) return;
    refresh();
    onDone(withCovered(i18n, t('invest.done', { amount: money(amount, currency), account: account.name }), result.covered, currency));
  }
  if (investments.length === 0) return <Explain>{t('invest.needAccount')}</Explain>;
  return (
    <form className="dialog-form cr-stack" onSubmit={(event) => void submit(event)}>
      <SelectField label={t('invest.what')} value={action} onChange={(event) => setAction(event.target.value as InvestmentAction)}>
          {INVEST_ACTIONS.map((option) => <option key={option.action} value={option.action}>{t(option.label)}</option>)}
        </SelectField>
      <Explain>{t(explain)}</Explain>
      <WalletSelect label={t('invest.account')} wallets={investments} value={accountId} onChange={setAccountId} />
      <MoneyField key={action} label={action === 'value' ? copy('New total value', 'القيمة الإجمالية الجديدة') : t('common.amount')} currency={currency} value={amount} onChange={setAmount} allowZero={action === 'value'} autoFocus />
      {account ? <p className="cr-helper">{t('invest.currentValue', { amount: money(account.balance, currency) })}</p> : null}
      {amount !== null && account ? <Preview><p><bdi>{account.name}</bdi> {money(account.balance, currency)} → {money(action === 'value' ? amount : action === 'income_cash' ? account.balance : account.balance + (action === 'withdraw' || action === 'fee' ? -amount : amount), currency)}</p>{action === 'value' ? <p>{amount < account.balance ? copy(`This records a ${money(account.balance - amount, currency)} loss.`, `يسجّل هذا خسارة ${money(account.balance - amount, currency)}.`) : amount > account.balance ? copy(`This records a ${money(amount - account.balance, currency)} gain.`, `يسجّل هذا ربحاً ${money(amount - account.balance, currency)}.`) : copy('The value is unchanged.', 'القيمة لم تتغير.')}</p> : null}{needsCash ? <p>{cash.find(wallet => wallet.id === effectiveCash)?.name}: {money(action === 'contribute' ? -amount : amount, currency)}</p> : <p>{copy('No cash wallet changes.', 'لا تتغير المحافظ النقدية.')}</p>}</Preview> : null}
      {needsCash ? <WalletSelect label={action === 'contribute' ? t('record.paidFrom') : t('record.receivedIn')} wallets={cash} value={effectiveCash} onChange={setCashId} /> : null}
      {action === 'contribute' ? (
        <>
          <ItemSelect label={t('invest.fromItem')} groups={pickerGroups(catalog.plan)} value={itemId} onChange={setItemId} currency={currency} />
          <CoverChoice catalog={catalog} itemId={itemId} currency={currency} amount={amount} value={coverFrom} onChange={setCoverFrom} />
        </>
      ) : null}
      <DateField value={on} onChange={setOn} max={space.today} />
      <NoteField value={memo} onChange={setMemo} />
      {command.error ? <ErrorNotice error={command.error} /> : null}
      <FormActions submitLabel="invest.save" pending={command.pending} onCancel={onCancel} disabled={amount === null || (needsCash && !effectiveCash)} />
    </form>
  );
}

const LOAN_ACTIONS: readonly { readonly action: LoanAction; readonly label: MessageKey; readonly explain: MessageKey; readonly direction: 'i_owe' | 'owed_to_me' }[] = [
  { action: 'repay', label: 'loan.repay', explain: 'loan.repayExplain', direction: 'i_owe' },
  { action: 'borrow', label: 'loan.borrow', explain: 'loan.borrowExplain', direction: 'i_owe' },
  { action: 'collect', label: 'loan.collect', explain: 'loan.collectExplain', direction: 'owed_to_me' },
  { action: 'lend', label: 'loan.lend', explain: 'loan.lendExplain', direction: 'owed_to_me' },
];

export function LoanForm({ catalog, onDone, onCancel, action: initialAction, loanId, bill }: FormProps & {
  readonly action?: LoanAction;
  readonly loanId?: string;
  readonly bill?: BillIntent;
}) {
  const i18n = useI18n();
  const copy = useRecordCopy();
  const { t, money } = i18n;
  const { api, space, refresh } = useWorkspace();
  const [action, setAction] = useState<LoanAction>(bill ? 'repay' : (initialAction ?? 'repay'));
  const definition = LOAN_ACTIONS.find((candidate) => candidate.action === action) ?? LOAN_ACTIONS[0];
  const direction = definition?.direction ?? 'i_owe';
  const loans = activeWallets(catalog.accounts, 'loan').filter((wallet) => wallet.loanDirection === direction);
  const [chosenLoan, setChosenLoan] = useState(bill?.loanWalletId ?? loanId ?? '');
  const effectiveLoan = loans.some((wallet) => wallet.id === chosenLoan) ? chosenLoan : (loans[0]?.id ?? '');
  const loan = loans.find((wallet) => wallet.id === effectiveLoan);
  const currency: Currency = loan?.currency ?? 'USD';
  const cash = activeWallets(catalog.accounts, 'cash').filter((wallet) => wallet.currency === currency);
  const [cashId, setCashId] = useState('');
  const effectiveCash = cash.some((wallet) => wallet.id === cashId) ? cashId : (cash[0]?.id ?? '');
  const linkedItem = catalog.plan.groups.flatMap((group) => group.items).find((item) => item.kind === 'loan_payment' && item.walletId === effectiveLoan);
  const [itemId, setItemId] = useState(bill?.itemId ?? linkedItem?.itemId ?? READY);
  const [principal, setPrincipal] = useState<bigint | null>(bill ? bill.amount : null);
  const [interest, setInterest] = useState<bigint | null>(null);
  const [fee, setFee] = useState<bigint | null>(null);
  const [on, setOn] = useState(bill && bill.dueOn <= space.today ? bill.dueOn : space.today);
  const [memo, setMemo] = useState('');
  const [coverFrom, setCoverFrom] = useState(READY);
  const effectiveInterest = action === 'repay' || action === 'collect' ? interest ?? 0n : 0n;
  const effectiveFee = action === 'repay' ? fee ?? 0n : 0n;
  const total = (principal ?? 0n) + effectiveInterest + effectiveFee;
  const charged = action === 'repay' || (action === 'lend' && itemId !== READY);
  const needsItem = action === 'repay';
  const command = useCommand((requestId, _: null) => api.recordLoan({
    spaceId: space.id, requestId, action, loanId: effectiveLoan, on, principal: principal ?? 0n, interest: effectiveInterest, fee: effectiveFee,
    cashWalletId: effectiveCash, itemId: itemId === READY ? null : itemId, memo: nullable(memo),
    coverFrom: charged && shortfallOf(catalog, itemId === READY ? '' : itemId, currency, total) > 0n && coverFrom !== READY ? coverFrom : null,
    billId: bill?.billId ?? null, billDue: bill?.dueOn ?? null,
  }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (total <= 0n || !loan || (needsItem && itemId === READY)) return;
    const result = await command.submit(null);
    if (!result) return;
    refresh();
    onDone(withCovered(i18n, t('loan.done', { amount: money(total, currency), name: loan.counterparty ?? loan.name }), result.covered, currency));
  }
  return (
    <form className="dialog-form cr-stack" onChangeCapture={event => { const input = event.target as HTMLInputElement; if (input.closest('.cr-money-field') && input.type === 'text') input.setCustomValidity(input.value.trim() && parseMoney(input.value, currency) === null ? t('error.BUDGET_INVALID_AMOUNT') : ''); }} onInvalidCapture={event => { const details = (event.target as HTMLElement).closest('details'); if (details) details.open = true; }} onSubmit={(event) => void submit(event)}>
      {bill ? <Explain>{t('record.payingBill', { name: bill.name, date: i18n.date(bill.dueOn) })}</Explain> : (
        <SelectField label={t('loan.what')} value={action} onChange={(event) => setAction(event.target.value as LoanAction)}>
            {LOAN_ACTIONS.map((option) => <option key={option.action} value={option.action}>{t(option.label)}</option>)}
          </SelectField>
      )}
      <Explain>{t(definition?.explain ?? 'loan.repayExplain')}</Explain>
      {loans.length === 0 ? <Explain tone="warn">{t('loan.needAccount')}</Explain> : (
        <WalletSelect label={t('loan.account')} wallets={loans} value={effectiveLoan} onChange={setChosenLoan} />
      )}
      <MoneyField key={`p-${action}`} label={t('loan.principal')} currency={currency} value={principal} onChange={setPrincipal} autoFocus required={action !== 'repay'} allowZero={action === 'repay'}
        hint={loan ? t('loan.balance', { amount: money(loan.balance < 0n ? -loan.balance : loan.balance, currency) }) : undefined} />
      {action === 'repay' || action === 'collect' ? (
        <details className="cr-record-details"><summary>{copy('Interest and fees (optional)', 'الفائدة والرسوم (اختيارية)')}</summary><MoneyField key={`i-${action}`} label={action === 'repay' ? t('loan.interestPaid') : t('loan.interestReceived')} currency={currency} value={interest} onChange={setInterest} required={false} allowZero />{action === 'repay' ? <MoneyField label={t('loan.fee')} currency={currency} value={fee} onChange={setFee} required={false} allowZero /> : null}</details>
      ) : null}
      {total > 0n && action === 'repay' ? (
        <p className="cr-helper">{t('loan.repaySplit', { total: money(total, currency), principal: money(principal ?? 0n, currency), cost: money(effectiveInterest + effectiveFee, currency) })}</p>
      ) : null}
      {loan && total > 0n ? <Preview><p>{copy('Principal', 'أصل الدين')}: {money(principal ?? 0n, currency)}</p><p>{copy('Interest and fees', 'الفائدة والرسوم')}: {money(effectiveInterest + effectiveFee, currency)}</p><p>{copy('Total paid or received', 'إجمالي المدفوع أو المستلم')}: {money(total, currency)}</p><p>{loan.name}: {money(loan.balance < 0n ? -loan.balance : loan.balance, currency)} → {money((loan.balance < 0n ? -loan.balance : loan.balance) + (action === 'repay' || action === 'collect' ? -(principal ?? 0n) : principal ?? 0n), currency)}</p></Preview> : null}
      <WalletSelect label={action === 'repay' || action === 'lend' ? t('record.paidFrom') : t('record.receivedIn')} wallets={cash} value={effectiveCash} onChange={setCashId} />
      {action === 'repay' || action === 'lend' ? (
        <ItemSelect label={t('loan.fromItem')} groups={pickerGroups(catalog.plan)} value={itemId} onChange={setItemId} currency={currency} includeReady={action === 'lend'}
          readyBalance={catalog.ready[currency]} />
      ) : null}
      {charged ? <CoverChoice catalog={catalog} itemId={itemId === READY ? '' : itemId} currency={currency} amount={total > 0n ? total : null} value={coverFrom} onChange={setCoverFrom} /> : null}
      <DateField value={on} onChange={setOn} max={space.today} />
      <NoteField value={memo} onChange={setMemo} />
      {command.error ? <ErrorNotice error={command.error} /> : null}
      <FormActions submitLabel="loan.save" pending={command.pending} onCancel={onCancel} disabled={total <= 0n || !loan || !effectiveCash || (needsItem && itemId === READY)} />
    </form>
  );
}

export function WalletForm({ onDone, onCancel, kind: initialKind, submitLabel, formId }: Omit<FormProps, 'catalog'> & { readonly kind?: 'cash' | 'investment' | 'loan'; readonly submitLabel?: string; readonly formId?: string }) {
  const { t, money } = useI18n();
  const copy = useRecordCopy();
  const { api, space, refresh } = useWorkspace();
  const [kind, setKind] = useState<'cash' | 'investment' | 'loan'>(initialKind ?? 'cash');
  const [direction, setDirection] = useState<'i_owe' | 'owed_to_me'>('i_owe');
  const [name, setName] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [opening, setOpening] = useState<bigint | null>(0n);
  const [negative, setNegative] = useState(false);
  const [on, setOn] = useState(space.today);
  const signedOpening = (opening ?? 0n) * (kind === 'cash' && negative ? -1n : 1n);
  const command = useCommand((requestId, _: null) => api.createWallet({
    spaceId: space.id, requestId, name: name.trim(), kind, currency,
    opening: signedOpening, openedOn: on,
    loanDirection: kind === 'loan' ? direction : null, counterparty: kind === 'loan' ? nullable(counterparty) : null,
  }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || opening === null) return;
    if (!(await command.submit(null))) return;
    refresh();
    onDone(t('wallet.done', { name: name.trim(), amount: money(kind === 'loan' && direction === 'i_owe' ? -signedOpening : signedOpening, currency) }));
  }
  const explain: MessageKey = kind === 'cash' ? 'wallet.cashExplain' : kind === 'investment' ? 'wallet.investmentExplain' : 'wallet.loanExplain';
  return (
    <form id={formId} className="dialog-form cr-stack" onSubmit={(event) => void submit(event)}>
      <fieldset className="cr-choice">
        <legend>{t('wallet.kind')}</legend>
        {(['cash', 'investment', 'loan'] as const).map((option) => (
          <label key={option}><input type="radio" name="wallet-kind" checked={kind === option} onChange={() => setKind(option)} />{t(`wallet.kind.${option}`)}</label>
        ))}
      </fieldset>
      <Explain>{t(explain)}</Explain>
      {kind === 'loan' ? (
        <fieldset className="cr-choice">
          <legend>{t('wallet.direction')}</legend>
          <label><input type="radio" name="loan-direction" checked={direction === 'i_owe'} onChange={() => setDirection('i_owe')} />{t('wallet.iOwe')}</label>
          <label><input type="radio" name="loan-direction" checked={direction === 'owed_to_me'} onChange={() => setDirection('owed_to_me')} />{t('wallet.owedToMe')}</label>
        </fieldset>
      ) : null}
      <label className="cr-field">
        <span className="cr-label">{t('common.name')}</span>
        <input type="text" required maxLength={60} value={name} data-autofocus="" onChange={(event) => setName(event.target.value)} />
      </label>
      {kind === 'loan' ? (
        <label className="cr-field">
          <span className="cr-label">{t('wallet.counterparty')}</span>
          <input type="text" maxLength={60} value={counterparty} onChange={(event) => setCounterparty(event.target.value)} />
        </label>
      ) : null}
      <fieldset className="cr-choice">
        <legend>{t('common.currency')}</legend>
        {(['USD', 'LBP'] as const).map((option) => (
          <label key={option}><input type="radio" name="wallet-currency" checked={currency === option} onChange={() => setCurrency(option)} />{option}</label>
        ))}
      </fieldset>
      <MoneyField key={currency} label={kind === 'loan' ? t('wallet.outstanding') : t('wallet.opening')} currency={currency} value={opening} onChange={setOpening} allowZero
        hint={kind === 'cash' ? t('wallet.openingHint') : undefined} />
      {kind === 'cash' ? (
        <fieldset className="cr-choice"><legend>{copy('Opening balance meaning', 'معنى الرصيد الافتتاحي')}</legend><label><input type="radio" name="wallet-sign" checked={!negative} onChange={() => setNegative(false)} />{copy('I have this money', 'أملك هذا المال')}</label><label><input type="radio" name="wallet-sign" checked={negative} onChange={() => setNegative(true)} />{copy('I owe this money', 'عليّ هذا المال')}</label></fieldset>
      ) : null}
      <Preview><p>{t('wallet.opening')}: {money(kind === 'loan' && direction === 'i_owe' ? -signedOpening : signedOpening, currency)}</p></Preview>
      <DateField value={on} onChange={setOn} max={space.today} label={t('wallet.asOf')} />
      {command.error ? <ErrorNotice error={command.error} /> : null}
      <FormActions submitText={submitLabel} submitLabel="wallet.save" pending={command.pending} onCancel={onCancel} disabled={!name.trim() || opening === null} />
    </form>
  );
}

export function CorrectForm({ entry, onDone, onCancel }: Omit<FormProps, 'catalog'> & { readonly entry: Entry }) {
  const { t, date } = useI18n();
  const { api, space, refresh } = useWorkspace();
  const [reason, setReason] = useState('');
  const command = useCommand((requestId, _: null) => api.reverseEntry({ spaceId: space.id, requestId, entryId: entry.entryId, reason: reason.trim() }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) return;
    if (!(await command.submit(null))) return;
    refresh();
    onDone(t('correct.done'));
  }
  return (
    <form className="dialog-form cr-stack" onSubmit={(event) => void submit(event)}>
      <Explain>{t('correct.explain', { date: date(entry.occurredOn) })}</Explain>
      <ul className="cr-lines">
        {entry.wallets.map((line, index) => (
          <li key={`w${index}`}><bdi>{line.name}</bdi> <Amount minor={line.amount} currency={line.currency} sign /></li>
        ))}
      </ul>
      <label className="cr-field">
        <span className="cr-label">{t('correct.reason')}</span>
        <input type="text" required maxLength={200} value={reason} data-autofocus="" onChange={(event) => setReason(event.target.value)} />
      </label>
      {command.error ? <ErrorNotice error={command.error} /> : null}
      <FormActions submitLabel="correct.save" pending={command.pending} onCancel={onCancel} disabled={!reason.trim()} />
    </form>
  );
}

/**
 * The item a contribution comes out of by default: one tied to this
 * investment account, else the last group's flexible item (plans list
 * long-term money last). Never matched by name, so renaming is safe.
 */
function defaultInvestItem(catalog: FormProps['catalog'], accountId: string): string {
  const groups = pickerGroups(catalog.plan);
  const linked = groups.flatMap((group) => group.items).find((item) => item.walletId !== null && item.walletId === accountId);
  return linked?.itemId ?? catalog.plan.groups.at(-1)?.flex?.itemId ?? '';
}
