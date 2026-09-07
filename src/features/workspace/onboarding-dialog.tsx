import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Currency, Locale, SpaceKind } from '../loans/types.js';
import type { CreateSpaceInput, CreateWalletInput, CreatedRecord } from './types.js';

interface OnboardingDialogProps {
  locale: Locale;
  createSpace(input: CreateSpaceInput): Promise<CreatedRecord>;
  createWallet(input: CreateWalletInput): Promise<CreatedRecord>;
  onComplete(): void;
}

const copy = {
  en: {
    spaceTitle: 'Create your first space', spaceIntro: 'A space keeps one set of wallets and loans together.',
    personal: 'Personal space', household: 'Household space', spaceName: 'Space name',
    personalAction: 'Create personal space', householdAction: 'Create household space',
    walletTitle: 'Add your first wallet', walletIntro: 'Choose the currency you use first. You can add more wallets in a later milestone.',
    walletName: 'Wallet name', walletAction: (currency: Currency) => `Create ${currency} wallet`,
    householdLater: 'Household invitations and member management are coming in a separate milestone.',
    required: 'Enter a name between 1 and 120 characters.', working: 'Checking your setup…',
  },
  ar: {
    spaceTitle: 'إنشاء مساحتك الأولى', spaceIntro: 'تجمع المساحة مجموعة واحدة من المحافظ والقروض.',
    personal: 'مساحة شخصية', household: 'مساحة منزلية', spaceName: 'اسم المساحة',
    personalAction: 'إنشاء مساحة شخصية', householdAction: 'إنشاء مساحة منزلية',
    walletTitle: 'أضف محفظتك الأولى', walletIntro: 'اختر العملة التي تستخدمها أولًا. يمكنك إضافة محافظ أخرى في مرحلة لاحقة.',
    walletName: 'اسم المحفظة', walletAction: (currency: Currency) => `إنشاء محفظة ${currency}`,
    householdLater: 'ستتوفر دعوات المنزل وإدارة الأعضاء في مرحلة منفصلة.',
    required: 'أدخل اسمًا من 1 إلى 120 حرفًا.', working: 'جارٍ التحقق من الإعداد…',
  },
} as const;

function focusable(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
}

export function OnboardingDialog({ locale, createSpace, createWallet, onComplete }: OnboardingDialogProps) {
  const text = copy[locale];
  const [step, setStep] = useState<'space' | 'wallet'>('space');
  const [kind, setKind] = useState<SpaceKind>('personal');
  const [spaceName, setSpaceName] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [walletName, setWalletName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    focusable(dialog)[0]?.focus();
  }, [step]);

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusable(event.currentTarget);
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const submitSpace = async (event: FormEvent) => {
    event.preventDefault();
    const name = spaceName.trim();
    if (name.length < 1 || name.length > 120) {
      setError(text.required);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await createSpace({ name, kind });
      setSpaceId(result.id);
      setStep('wallet');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.required);
    } finally {
      setPending(false);
    }
  };

  const submitWallet = async (event: FormEvent) => {
    event.preventDefault();
    const name = walletName.trim();
    if (name.length < 1 || name.length > 120) {
      setError(text.required);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await createWallet({ spaceId, name, currency });
      onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.required);
    } finally {
      setPending(false);
    }
  };

  const title = step === 'space' ? text.spaceTitle : text.walletTitle;
  return <div className="overlay onboarding-overlay">
    <section ref={dialogRef} className="dialog onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" onKeyDown={trapFocus}>
      <header className="dialog-header"><div><span className="brand">Budget ledger</span><h1 id="onboarding-title">{title}</h1></div></header>
      {step === 'space' ? <form onSubmit={(event) => void submitSpace(event)}>
        <p className="dialog-intro">{text.spaceIntro}</p>
        <fieldset className="segmented">
          <legend>{text.spaceTitle}</legend>
          <label><input type="radio" name="space-kind" checked={kind === 'personal'} onChange={() => setKind('personal')} />{text.personal}</label>
          <label><input type="radio" name="space-kind" checked={kind === 'household'} onChange={() => setKind('household')} />{text.household}</label>
        </fieldset>
        <label>{text.spaceName}<input autoComplete="off" maxLength={120} value={spaceName} onChange={(event) => setSpaceName(event.target.value)} /></label>
        {error ? <div className="error-notice" role="alert">{error}</div> : null}
        {pending ? <div role="status">{text.working}</div> : null}
        <div className="dialog-actions"><button type="submit" disabled={pending}>{kind === 'personal' ? text.personalAction : text.householdAction}</button></div>
      </form> : <form onSubmit={(event) => void submitWallet(event)}>
        <p className="dialog-intro">{text.walletIntro}</p>
        {kind === 'household' ? <p className="onboarding-boundary">{text.householdLater}</p> : null}
        <fieldset className="segmented">
          <legend>{text.walletTitle}</legend>
          <label><input type="radio" name="currency" checked={currency === 'USD'} onChange={() => setCurrency('USD')} />USD</label>
          <label><input type="radio" name="currency" checked={currency === 'LBP'} onChange={() => setCurrency('LBP')} />LBP</label>
        </fieldset>
        <label>{text.walletName}<input autoComplete="off" maxLength={120} value={walletName} onChange={(event) => setWalletName(event.target.value)} /></label>
        {error ? <div className="error-notice" role="alert">{error}</div> : null}
        {pending ? <div role="status">{text.working}</div> : null}
        <div className="dialog-actions"><button type="submit" disabled={pending}>{text.walletAction(currency)}</button></div>
      </form>}
    </section>
  </div>;
}
