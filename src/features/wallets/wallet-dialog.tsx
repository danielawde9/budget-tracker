import { useState, type FormEvent } from 'react';

import type { Currency, Locale } from '../loans/types.js';
import type { CommandOutcome } from './use-wallets.js';
import { DialogShell } from './dialog-shell.js';

interface WalletDialogProps {
  locale: Locale;
  pending: boolean;
  onClose(): void;
  onSubmit(input: { name: string; currency: Currency }): Promise<CommandOutcome>;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

export function WalletDialog({ locale, pending, onClose, onSubmit }: WalletDialogProps) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError(t(locale, 'Enter a wallet name.', 'أدخل اسم المحفظة.'));
      return;
    }
    try {
      await onSubmit({ name, currency });
      setSuccess(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t(locale, 'The wallet was not created.', 'لم يتم إنشاء المحفظة.'));
    }
  }

  return <DialogShell title={t(locale, 'Create a wallet', 'إنشاء محفظة')} closeLabel={t(locale, 'Close', 'إغلاق')} onClose={onClose} pending={pending}>
    {success ? <div className="dialog-result" role="status">
      <strong>{t(locale, 'Wallet created', 'تم إنشاء المحفظة')}</strong>
      <p>{t(locale, 'The refreshed wallet list now shows the server-confirmed balance.', 'تعرض قائمة المحافظ المحدّثة الآن الرصيد المؤكد من الخادم.')}</p>
      <button type="button" data-autofocus onClick={onClose}>{t(locale, 'Done', 'تم')}</button>
    </div> : <form onSubmit={(event) => void submit(event)}>
      <p className="dialog-intro">{t(locale, 'Create an active USD or LBP wallet. Its balance always comes from the immutable journal.', 'أنشئ محفظة فعالة بالدولار أو الليرة. يأتي رصيدها دائمًا من السجل غير القابل للتعديل.')}</p>
      {error && <div className="error-notice" role="alert">{error}</div>}
      <div className="form-grid wallet-form-grid">
        <label className="full-field">{t(locale, 'Wallet name', 'اسم المحفظة')}<input data-autofocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
        <label className="full-field">{t(locale, 'Currency', 'العملة')}<select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}><option value="USD">USD</option><option value="LBP">LBP</option></select></label>
      </div>
      <div className="dialog-actions"><button type="button" className="button-secondary" disabled={pending} onClick={onClose}>{t(locale, 'Cancel', 'إلغاء')}</button><button type="submit" disabled={pending}>{pending ? t(locale, 'Creating…', 'جارٍ الإنشاء…') : t(locale, 'Create wallet', 'إنشاء المحفظة')}</button></div>
    </form>}
  </DialogShell>;
}
