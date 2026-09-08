import { useMemo, useState, type FormEvent } from 'react';

import type { Locale } from '../loans/types.js';
import { DialogShell } from './dialog-shell.js';
import { formatMinorAmount, invertMinorAmount, parsePositiveMinorAmount } from './money.js';
import type { CommandOutcome } from './use-wallets.js';
import type { GeneralEventKind, MovementInput, WalletProjection } from './types.js';

interface TransactionDialogProps {
  locale: Locale;
  wallets: readonly WalletProjection[];
  pending: boolean;
  ambiguous: boolean;
  onClose(): void;
  onClearAmbiguous(): void;
  onRetry(): Promise<CommandOutcome>;
  onSubmit(input: { kind: GeneralEventKind; effectiveDate: string; movements: readonly MovementInput[] }): Promise<CommandOutcome>;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;
const today = () => new Date().toISOString().slice(0, 10);

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function TransactionDialog(props: TransactionDialogProps) {
  const [kind, setKind] = useState<GeneralEventKind>('income');
  const [walletId, setWalletId] = useState(props.wallets[0]?.id ?? '');
  const [toWalletId, setToWalletId] = useState(props.wallets[1]?.id ?? props.wallets[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [movements, setMovements] = useState<readonly MovementInput[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const wallet = props.wallets.find((item) => item.id === walletId);
  const toWallet = props.wallets.find((item) => item.id === toWalletId);

  function edit(action: () => void) {
    action();
    setMovements(null);
    setError(null);
    props.onClearAmbiguous();
  }

  function review(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!wallet) {
      setError(t(props.locale, 'Choose an active wallet.', 'اختر محفظة فعالة.'));
      return;
    }
    if (!validDate(effectiveDate)) {
      setError(t(props.locale, 'Enter a valid effective date.', 'أدخل تاريخ سريان صالحًا.'));
      return;
    }
    let minor: string;
    try {
      minor = parsePositiveMinorAmount(amount, wallet.currency);
    } catch {
      setError(t(props.locale, 'Enter a valid positive amount.', 'أدخل مبلغًا موجبًا صالحًا.'));
      return;
    }
    if (kind === 'transfer') {
      if (!toWallet || toWallet.id === wallet.id) {
        setError(t(props.locale, 'Choose two different wallets.', 'اختر محفظتين مختلفتين.'));
        return;
      }
      if (toWallet.currency !== wallet.currency) {
        setError(t(props.locale, 'Transfers require wallets in the same currency.', 'تتطلب التحويلات محافظ بالعملة نفسها.'));
        return;
      }
      setMovements([{ walletId: wallet.id, amountMinor: invertMinorAmount(minor) }, { walletId: toWallet.id, amountMinor: minor }]);
      return;
    }
    setMovements([{ walletId: wallet.id, amountMinor: kind === 'expense' ? invertMinorAmount(minor) : minor }]);
  }

  async function submit() {
    if (!movements) return;
    setError(null);
    try {
      const outcome = await props.onSubmit({ kind, effectiveDate, movements });
      if (outcome.status === 'success') setSuccess(true);
      else setError(t(props.locale, 'The result is still unknown. We found no matching event; retry only if these details are unchanged.', 'ما زالت النتيجة غير معروفة. لم نجد حدثًا مطابقًا؛ أعد المحاولة فقط إذا بقيت التفاصيل كما هي.'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t(props.locale, 'The transaction was not recorded.', 'لم يتم تسجيل المعاملة.'));
    }
  }

  async function retry() {
    setError(null);
    try {
      const outcome = await props.onRetry();
      if (outcome.status === 'success') setSuccess(true);
      else setError(t(props.locale, 'The result is still unknown. Check the connection before retrying again.', 'ما زالت النتيجة غير معروفة. تحقق من الاتصال قبل إعادة المحاولة.'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t(props.locale, 'The transaction was not recorded.', 'لم يتم تسجيل المعاملة.'));
    }
  }

  const kindLabel = useMemo(() => ({
    opening_balance: t(props.locale, 'opening balance', 'رصيد افتتاحي'),
    income: t(props.locale, 'income', 'دخل'),
    expense: t(props.locale, 'expense', 'مصروف'),
    transfer: t(props.locale, 'transfer', 'تحويل'),
  })[kind], [kind, props.locale]);

  if (success) return <DialogShell title={t(props.locale, 'Add a transaction', 'إضافة معاملة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose}>
    <div className="dialog-result" role="status"><strong>{t(props.locale, 'Transaction recorded', 'تم تسجيل المعاملة')}</strong><p>{t(props.locale, 'Balances and history were refreshed from the protected journal.', 'تم تحديث الأرصدة والسجل من الدفتر المحمي.')}</p><button type="button" data-autofocus onClick={props.onClose}>{t(props.locale, 'Done', 'تم')}</button></div>
  </DialogShell>;

  return <DialogShell title={t(props.locale, 'Add a transaction', 'إضافة معاملة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending} wide>
    <form onSubmit={review}>
      <p className="dialog-intro">{t(props.locale, 'Record one immutable wallet event. Review the signed wallet effects before confirmation.', 'سجّل حدث محفظة واحدًا غير قابل للتعديل. راجع تأثيرات المحافظ الموقّعة قبل التأكيد.')}</p>
      {error && <div className="error-notice" role="alert">{error}{props.ambiguous && <div><button type="button" className="button-secondary retry-command" disabled={props.pending} onClick={() => void retry()}>{t(props.locale, 'Retry unchanged transaction', 'إعادة المعاملة دون تغيير')}</button></div>}</div>}
      <div className="form-grid">
        <label>{t(props.locale, 'Type', 'النوع')}<select data-autofocus value={kind} onChange={(event) => edit(() => setKind(event.target.value as GeneralEventKind))}><option value="opening_balance">{t(props.locale, 'Opening balance', 'رصيد افتتاحي')}</option><option value="income">{t(props.locale, 'Income', 'دخل')}</option><option value="expense">{t(props.locale, 'Expense', 'مصروف')}</option><option value="transfer">{t(props.locale, 'Transfer', 'تحويل')}</option></select></label>
        <label>{t(props.locale, 'Effective date', 'تاريخ السريان')}<input type="date" value={effectiveDate} onChange={(event) => edit(() => setEffectiveDate(event.target.value))} /></label>
        <label>{kind === 'transfer' ? t(props.locale, 'From wallet', 'من محفظة') : t(props.locale, 'Wallet', 'المحفظة')}<select value={walletId} onChange={(event) => edit(() => setWalletId(event.target.value))}>{props.wallets.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.currency}</option>)}</select></label>
        {kind === 'transfer' && <label>{t(props.locale, 'To wallet', 'إلى محفظة')}<select value={toWalletId} onChange={(event) => edit(() => setToWalletId(event.target.value))}>{props.wallets.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.currency}</option>)}</select></label>}
        <label className="full-field">{t(props.locale, 'Amount', 'المبلغ')}<input inputMode="decimal" value={amount} onChange={(event) => edit(() => setAmount(event.target.value))} /></label>
      </div>
      {movements && wallet && <section className="effect-preview" aria-label={t(props.locale, 'Wallet effect preview', 'معاينة تأثير المحافظ')}>
        <h3>{t(props.locale, 'Confirm wallet effects', 'تأكيد تأثيرات المحافظ')}</h3>
        <ul>{movements.map((movement) => {
          const affected = props.wallets.find((item) => item.id === movement.walletId);
          if (!affected) return null;
          const receives = BigInt(movement.amountMinor) > 0n;
          return <li key={movement.walletId}><bdi>{affected.name}</bdi> {receives ? t(props.locale, 'receives', 'تستقبل') : t(props.locale, 'sends', 'ترسل')} <bdi>{formatMinorAmount(BigInt(movement.amountMinor) < 0n ? invertMinorAmount(movement.amountMinor) : movement.amountMinor, affected.currency, props.locale)}</bdi>.</li>;
        })}</ul>
        <p>{t(props.locale, 'The resulting balances will come from the refreshed journal; this preview does not calculate them.', 'ستأتي الأرصدة الناتجة من السجل المحدّث؛ لا تحسب هذه المعاينة الأرصدة.')}</p>
      </section>}
      <div className="dialog-actions"><button type="button" className="button-secondary" disabled={props.pending} onClick={props.onClose}>{t(props.locale, 'Cancel', 'إلغاء')}</button>{movements ? <button type="button" disabled={props.pending} onClick={() => void submit()}>{props.pending ? t(props.locale, 'Recording…', 'جارٍ التسجيل…') : `${t(props.locale, 'Record', 'تسجيل')} ${kindLabel}`}</button> : <button type="submit">{t(props.locale, 'Review transaction', 'مراجعة المعاملة')}</button>}</div>
    </form>
  </DialogShell>;
}
