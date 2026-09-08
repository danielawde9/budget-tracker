import { useState, type FormEvent } from 'react';

import type { Currency, Locale } from '../loans/types.js';
import type { CommandOutcome } from './use-wallets.js';
import { DialogShell } from './dialog-shell.js';

interface WalletDialogProps {
  locale: Locale;
  pending: boolean;
  onClose(): void;
  onRefresh(): Promise<boolean>;
  onSubmit(input: { name: string; currency: Currency }): Promise<CommandOutcome>;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

export function WalletDialog({ locale, pending, onClose, onRefresh, onSubmit }: WalletDialogProps) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const locked = pending || refreshRequired;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError(t(locale, 'Enter a wallet name.', 'أدخل اسم المحفظة.'));
      return;
    }
    try {
      const outcome = await onSubmit({ name, currency });
      if (outcome.status === 'refresh-required') {
        setRefreshRequired(true);
        setError(t(locale, 'The wallet was created, but categories and history could not be refreshed.', 'تم إنشاء المحفظة، ولكن تعذّر تحديث الفئات والسجل.'));
      } else {
        setSuccess(true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t(locale, 'The wallet was not created.', 'لم يتم إنشاء المحفظة.'));
    }
  }

  async function refreshAcceptedWallet() {
    setRefreshing(true);
    try {
      if (await onRefresh()) setSuccess(true);
      else setError(t(locale, 'The wallet was created, but categories and history could not be refreshed.', 'تم إنشاء المحفظة، ولكن تعذّر تحديث الفئات والسجل.'));
    } catch {
      setError(t(locale, 'The wallet was created, but categories and history could not be refreshed.', 'تم إنشاء المحفظة، ولكن تعذّر تحديث الفئات والسجل.'));
    } finally {
      setRefreshing(false);
    }
  }

  return <DialogShell title={t(locale, 'Create a wallet', 'إنشاء محفظة')} closeLabel={t(locale, 'Close', 'إغلاق')} onClose={onClose} pending={pending || refreshing}>
    {success ? <div className="dialog-result" role="status">
      <strong>{t(locale, 'Wallet created', 'تم إنشاء المحفظة')}</strong>
      <p>{t(locale, 'The refreshed wallet list now shows the server-confirmed balance.', 'تعرض قائمة المحافظ المحدّثة الآن الرصيد المؤكد من الخادم.')}</p>
      <button type="button" data-autofocus onClick={onClose}>{t(locale, 'Done', 'تم')}</button>
    </div> : <form onSubmit={(event) => void submit(event)}>
      <p className="dialog-intro">{t(locale, 'Create an active USD or LBP wallet. Its balance always comes from the immutable journal.', 'أنشئ محفظة فعالة بالدولار أو الليرة. يأتي رصيدها دائمًا من السجل غير القابل للتعديل.')}</p>
      {error && <div className="error-notice" role="alert">{error}{refreshRequired && <div><button type="button" className="button-secondary retry-command" disabled={refreshing} onClick={() => void refreshAcceptedWallet()}>{refreshing ? t(locale, 'Refreshing…', 'جارٍ التحديث…') : t(locale, 'Refresh wallets', 'تحديث المحافظ')}</button></div>}</div>}
      <div className="form-grid wallet-form-grid">
        <label className="full-field">{t(locale, 'Wallet name', 'اسم المحفظة')}<input data-autofocus value={name} maxLength={120} disabled={locked} onChange={(event) => setName(event.target.value)} /></label>
        <label className="full-field">{t(locale, 'Currency', 'العملة')}<select value={currency} disabled={locked} onChange={(event) => setCurrency(event.target.value as Currency)}><option value="USD">USD</option><option value="LBP">LBP</option></select></label>
      </div>
      <div className="dialog-actions"><button type="button" className="button-secondary" disabled={pending || refreshing} onClick={onClose}>{t(locale, refreshRequired ? 'Close' : 'Cancel', refreshRequired ? 'إغلاق' : 'إلغاء')}</button><button type="submit" disabled={locked}>{pending ? t(locale, 'Creating…', 'جارٍ الإنشاء…') : t(locale, 'Create wallet', 'إنشاء المحفظة')}</button></div>
    </form>}
  </DialogShell>;
}
