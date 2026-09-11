import { useId, useState } from 'react';

import type { Locale } from '../loans/types.js';
import { classifyWalletError, localizeWalletError } from './errors.js';
import { DialogShell } from './dialog-shell.js';
import type { CommandOutcome } from './use-wallets.js';
import type { WalletProjection } from './types.js';

interface RestoreWalletDialogProps {
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

export function RestoreWalletDialog(props: RestoreWalletDialogProps) {
  const descriptionId = useId();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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

  if (success) return <DialogShell title={t(props.locale, 'Restore wallet', 'استعادة المحفظة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} descriptionId={descriptionId} focusVersion="success">
    <div className="dialog-result" role="status"><strong>{t(props.locale, 'Wallet restored', 'تمت استعادة المحفظة')}</strong><p id={descriptionId}>{t(props.locale, 'It is back in active balances and every wallet picker.', 'عادت إلى الأرصدة الفعالة وكل قائمة محافظ.')}</p><button type="button" data-autofocus onClick={props.onClose}>{t(props.locale, 'Done', 'تم')}</button></div>
  </DialogShell>;

  return <DialogShell title={t(props.locale, 'Restore wallet', 'استعادة المحفظة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending} descriptionId={descriptionId}>
    <p id={descriptionId} className="dialog-intro">{t(props.locale, 'Restore', 'استعادة')} <strong><bdi>{props.wallet.name}</bdi></strong>? {t(props.locale, 'It returns to active balances and every wallet picker.', 'ستعود إلى الأرصدة الفعالة وكل قائمة محافظ.')}</p>
    {error && <div className="error-notice" role="alert">{error}{props.ambiguous && <div><button type="button" className="button-secondary retry-command" onClick={() => void run(props.onRetry)}>{t(props.locale, 'Retry unchanged restore', 'إعادة الاستعادة دون تغيير')}</button></div>}</div>}
    <div className="dialog-actions"><button type="button" className="button-secondary" disabled={props.pending} onClick={props.onClose}>{t(props.locale, 'Cancel', 'إلغاء')}</button><button type="button" data-autofocus disabled={props.pending} onClick={() => void run(() => props.onSubmit({ walletId: props.wallet.id }))}>{props.pending ? t(props.locale, 'Restoring…', 'جارٍ الاستعادة…') : t(props.locale, 'Restore', 'استعادة')}</button></div>
  </DialogShell>;
}
