import { useState, type FormEvent } from 'react';

import type { Locale } from '../loans/types.js';
import { classifyWalletError, localizeWalletError } from './errors.js';
import { DialogShell } from './dialog-shell.js';
import type { CommandOutcome } from './use-wallets.js';
import type { WalletProjection } from './types.js';

interface RenameWalletDialogProps {
  locale: Locale;
  wallet: WalletProjection;
  pending: boolean;
  ambiguous: boolean;
  onClose(): void;
  onClearAmbiguous(): void;
  onRetry(): Promise<CommandOutcome>;
  onSubmit(input: { walletId: string; name: string }): Promise<CommandOutcome>;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

export function RenameWalletDialog(props: RenameWalletDialogProps) {
  const [name, setName] = useState(props.wallet.name);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const trimmed = name.trim();
  const unchanged = trimmed === props.wallet.name;

  async function run(action: () => Promise<CommandOutcome>) {
    setError(null);
    try {
      const outcome = await action();
      if (outcome.status === 'success') setSuccess(true);
      else setError(t(props.locale, 'The result is still unknown. Retry only with this unchanged name.', 'ما زالت النتيجة غير معروفة. أعد المحاولة بهذا الاسم نفسه فقط.'));
    } catch (cause) {
      const result = localizeWalletError(classifyWalletError(cause), props.locale);
      setError(`${result.message} ${result.recovery}`);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!trimmed || unchanged) return;
    void run(() => props.onSubmit({ walletId: props.wallet.id, name: trimmed }));
  }

  if (success) return <DialogShell title={t(props.locale, 'Rename wallet', 'إعادة تسمية المحفظة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose}>
    <div className="dialog-result" role="status"><strong>{t(props.locale, 'Wallet renamed', 'تمت إعادة تسمية المحفظة')}</strong><p>{t(props.locale, 'The new name now shows everywhere this wallet appears, including past entries.', 'يظهر الاسم الجديد الآن في كل مكان تظهر فيه هذه المحفظة، بما في ذلك القيود السابقة.')}</p><button type="button" data-autofocus onClick={props.onClose}>{t(props.locale, 'Done', 'تم')}</button></div>
  </DialogShell>;

  return <DialogShell title={t(props.locale, 'Rename wallet', 'إعادة تسمية المحفظة')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending}>
    <form onSubmit={submit}>
      {error && <div className="error-notice" role="alert">{error}{props.ambiguous && <div><button type="button" className="button-secondary retry-command" onClick={() => void run(props.onRetry)}>{t(props.locale, 'Retry unchanged rename', 'إعادة تسمية دون تغيير')}</button></div>}</div>}
      <label className="full-field">{t(props.locale, 'Wallet name', 'اسم المحفظة')}<input data-autofocus value={name} maxLength={120} disabled={props.pending} onChange={(event) => { setName(event.target.value); setError(null); props.onClearAmbiguous(); }} /></label>
      <div className="dialog-actions"><button type="button" className="button-secondary" disabled={props.pending} onClick={props.onClose}>{t(props.locale, 'Cancel', 'إلغاء')}</button><button type="submit" disabled={props.pending || !trimmed || unchanged}>{props.pending ? t(props.locale, 'Saving…', 'جارٍ الحفظ…') : t(props.locale, 'Save', 'حفظ')}</button></div>
    </form>
  </DialogShell>;
}
