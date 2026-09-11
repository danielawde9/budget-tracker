import { useId, useState, type FormEvent } from 'react';

import type { Locale } from '../loans/types.js';
import { classifyWalletError, localizeWalletError } from './errors.js';
import { DialogShell } from './dialog-shell.js';
import { formatMinorAmount } from './money.js';
import type { CommandOutcome } from './use-wallets.js';
import type { WalletProjection } from './types.js';

interface ArchiveWalletDialogProps {
  locale: Locale;
  wallet: WalletProjection;
  pending: boolean;
  ambiguous: boolean;
  onClose(): void;
  onClearAmbiguous(): void;
  onRetry(): Promise<CommandOutcome>;
  onSubmit(input: { walletId: string }): Promise<CommandOutcome>;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

export function ArchiveWalletDialog(props: ArchiveWalletDialogProps) {
  const descriptionId = useId();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const zeroBalance = BigInt(props.wallet.balanceMinor) === 0n;

  async function run(action: () => Promise<CommandOutcome>) {
    setError(null);
    try {
      const outcome = await action();
      if (outcome.status === 'success') setSuccess(true);
      else setError(t(props.locale, 'The result is still unknown. Retry only with this unchanged wallet.', 'ما زالت النتيجة غير معروفة. أعد المحاولة بهذه المحفظة نفسها فقط.'));
    } catch (cause) {
      const result = localizeWalletError(classifyWalletError(cause), props.locale);
      setError(`${result.message} ${result.recovery}`);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!zeroBalance) return;
    if (!confirmed) {
      setError(t(props.locale, 'Confirm that you understand this wallet will leave active balances.', 'أكد أنك تفهم أن هذه المحفظة ستغادر الأرصدة الفعالة.'));
      return;
    }
    void run(() => props.onSubmit({ walletId: props.wallet.id }));
  }

  if (success) return <DialogShell title={t(props.locale, 'Archive wallet', 'أرشفة المحفظة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} descriptionId={descriptionId} focusVersion="success">
    <div className="dialog-result" role="status"><strong>{t(props.locale, 'Wallet archived', 'تمت أرشفة المحفظة')}</strong><p id={descriptionId}>{t(props.locale, 'It leaves active balances and every wallet picker. Its history stays, and it can be restored.', 'تغادر الأرصدة الفعالة وكل قائمة محافظ. يبقى سجلها، ويمكن استعادتها.')}</p><button type="button" data-autofocus onClick={props.onClose}>{t(props.locale, 'Done', 'تم')}</button></div>
  </DialogShell>;

  return <DialogShell title={t(props.locale, 'Archive wallet', 'أرشفة المحفظة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending} descriptionId={descriptionId}>
    <form onSubmit={submit}>
      {zeroBalance
        ? <p id={descriptionId} className="dialog-intro">{t(props.locale, 'Archive', 'أرشفة')} <strong><bdi>{props.wallet.name}</bdi></strong>? {t(props.locale, 'It leaves active balances and every wallet picker. Its history stays, and it can be restored.', 'ستغادر الأرصدة الفعالة وكل قائمة محافظ. يبقى سجلها، ويمكن استعادتها.')}</p>
        : <p id={descriptionId} className="dialog-intro">{t(props.locale, 'This wallet still has money in it', 'لا تزال هذه المحفظة تحتوي على مال')}: <bdi>{formatMinorAmount(props.wallet.balanceMinor, props.wallet.currency, props.locale)}</bdi>. {t(props.locale, 'Undo or move its transactions until the balance is 0.', 'تراجع عن معاملاتها أو انقلها حتى يصبح الرصيد صفرًا.')}</p>}
      {error && <div className="error-notice" role="alert">{error}{props.ambiguous && <div><button type="button" className="button-secondary retry-command" onClick={() => void run(props.onRetry)}>{t(props.locale, 'Retry unchanged archive', 'إعادة الأرشفة دون تغيير')}</button></div>}</div>}
      {zeroBalance && <label className="confirm"><input data-autofocus type="checkbox" checked={confirmed} onChange={(event) => { setConfirmed(event.target.checked); setError(null); props.onClearAmbiguous(); }} />{t(props.locale, 'I understand this wallet will leave active balances and every wallet picker.', 'أفهم أن هذه المحفظة ستغادر الأرصدة الفعالة وكل قائمة محافظ.')}</label>}
      {zeroBalance && <div className="dialog-actions"><button type="button" className="button-secondary" disabled={props.pending} onClick={props.onClose}>{t(props.locale, 'Cancel', 'إلغاء')}</button><button type="submit" disabled={props.pending}>{props.pending ? t(props.locale, 'Archiving…', 'جارٍ الأرشفة…') : t(props.locale, 'Archive wallet', 'أرشفة المحفظة')}</button></div>}
    </form>
  </DialogShell>;
}
