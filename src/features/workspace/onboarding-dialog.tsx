import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Currency, Locale, SpaceKind } from '../loans/types.js';
import type { CreateSpaceInput, CreateWalletInput, CreatedRecord } from './types.js';

interface OnboardingDialogProps {
  locale: Locale;
  mode?: 'first' | 'additional';
  createSpace(input: CreateSpaceInput): Promise<CreatedRecord>;
  createWallet(input: CreateWalletInput): Promise<CreatedRecord>;
  onComplete(spaceId: string): void;
}

const copy = {
  en: {
    product: 'Budget ledger', progress: 'Setup progress', stepSpace: 'Space', stepWallet: 'First wallet',
    spaceTitle: 'Create your first space', spaceTitleAdditional: 'Add another space',
    spaceIntro: 'A space keeps one set of wallets and loans together.',
    chooseKind: 'Choose a space type', personal: 'Personal space', household: 'Household space',
    personalDescription: 'Just for you. Keep your finances private.',
    householdDescription: 'Share with the people you live with.',
    personalPrivate: 'A personal space is private. Only you can see its wallets, loans and data.',
    spaceName: 'Space name', currencyLabel: 'Choose a currency',
    spaceNameHint: 'e.g. Home', walletNameHint: 'e.g. Cash',
    personalAction: 'Create personal space', householdAction: 'Create household space',
    walletTitle: 'Add your first wallet', walletIntro: 'Choose the currency you use first. You can add more wallets later.',
    walletName: 'Wallet name', walletAction: (currency: Currency) => `Create ${currency} wallet`,
    householdLater: 'After setup, invite members from Manage > Household.',
    required: 'Enter a name between 1 and 120 characters.', working: 'Checking your setup…',
  },
  ar: {
    product: 'دفتر الميزانية', progress: 'تقدّم الإعداد', stepSpace: 'المساحة', stepWallet: 'المحفظة الأولى',
    spaceTitle: 'إنشاء مساحتك الأولى', spaceTitleAdditional: 'إضافة مساحة أخرى',
    spaceIntro: 'تجمع المساحة مجموعة واحدة من المحافظ والقروض.',
    chooseKind: 'اختر نوع المساحة', personal: 'مساحة شخصية', household: 'مساحة منزلية',
    personalDescription: 'لك وحدك. احتفظ بخصوصية أموالك.',
    householdDescription: 'شاركها مع الأشخاص الذين تعيش معهم.',
    personalPrivate: 'المساحة الشخصية خاصة. أنت وحدك من يرى محافظها وقروضها وبياناتها.',
    spaceName: 'اسم المساحة', currencyLabel: 'اختر العملة',
    spaceNameHint: 'مثال: المنزل', walletNameHint: 'مثال: نقد',
    personalAction: 'إنشاء مساحة شخصية', householdAction: 'إنشاء مساحة منزلية',
    walletTitle: 'أضف محفظتك الأولى', walletIntro: 'اختر العملة التي تستخدمها أولًا. يمكنك إضافة محافظ أخرى لاحقًا.',
    walletName: 'اسم المحفظة', walletAction: (currency: Currency) => `إنشاء محفظة ${currency}`,
    householdLater: 'بعد الإعداد، يمكنك دعوة الأعضاء من صفحة المنزل ضمن إدارة.',
    required: 'أدخل اسمًا من 1 إلى 120 حرفًا.', working: 'جارٍ التحقق من الإعداد…',
  },
} as const;

function focusable(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
}

export function OnboardingDialog({ locale, mode = 'first', createSpace, createWallet, onComplete }: OnboardingDialogProps) {
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
  const personalDescriptionId = useId();
  const householdDescriptionId = useId();

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
      onComplete(spaceId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.required);
    } finally {
      setPending(false);
    }
  };

  const spaceTitle = mode === 'additional' ? text.spaceTitleAdditional : text.spaceTitle;
  const title = step === 'space' ? spaceTitle : text.walletTitle;
  return <div className="overlay onboarding-overlay">
    <section ref={dialogRef} className="dialog dialog-setup onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" onKeyDown={trapFocus}>
      <header className="dialog-header"><div><span className="auth-brand"><span className="auth-brand-mark" aria-hidden="true" />{text.product}</span><h1 id="onboarding-title">{title}</h1><p className="dialog-intro">{step === 'space' ? text.spaceIntro : text.walletIntro}</p></div></header>
      <ol className="onboarding-progress" aria-label={text.progress}>
        <li className={step === 'space' ? 'onboarding-progress-current' : 'onboarding-progress-done'}><span className="onboarding-step-number" aria-hidden="true">1</span><span aria-current={step === 'space' ? 'step' : undefined}>{text.stepSpace}</span></li>
        <li className={step === 'wallet' ? 'onboarding-progress-current' : undefined}><span className="onboarding-step-number" aria-hidden="true">2</span><span aria-current={step === 'wallet' ? 'step' : undefined}>{text.stepWallet}</span></li>
      </ol>
      {step === 'space' ? <form onSubmit={(event) => void submitSpace(event)}>
        <fieldset className="segmented onboarding-kind-options">
          <legend>{text.chooseKind}</legend>
          <label><input type="radio" name="space-kind" aria-label={text.personal} aria-describedby={personalDescriptionId} checked={kind === 'personal'} onChange={() => setKind('personal')} /><span><strong>{text.personal}</strong><small id={personalDescriptionId}>{text.personalDescription}</small></span></label>
          <label><input type="radio" name="space-kind" aria-label={text.household} aria-describedby={householdDescriptionId} checked={kind === 'household'} onChange={() => setKind('household')} /><span><strong>{text.household}</strong><small id={householdDescriptionId}>{text.householdDescription}</small></span></label>
        </fieldset>
        <label className="onboarding-name-field">{text.spaceName}<input autoComplete="off" maxLength={120} placeholder={text.spaceNameHint} value={spaceName} onChange={(event) => setSpaceName(event.target.value)} /></label>
        {error ? <div className="error-notice" role="alert">{error}</div> : null}
        {pending ? <div role="status">{text.working}</div> : null}
        <div className="dialog-actions"><button type="submit" className="cr-button cr-button--primary cr-button--block" disabled={pending}>{kind === 'personal' ? text.personalAction : text.householdAction}</button></div>
        {kind === 'personal' ? <p className="onboarding-privacy">{text.personalPrivate}</p> : null}
      </form> : <form onSubmit={(event) => void submitWallet(event)}>
        {kind === 'household' ? <p className="onboarding-boundary">{text.householdLater}</p> : null}
        <fieldset className="segmented onboarding-currency-options">
          <legend>{text.currencyLabel}</legend>
          <label><input type="radio" name="currency" checked={currency === 'USD'} onChange={() => setCurrency('USD')} />USD</label>
          <label><input type="radio" name="currency" checked={currency === 'LBP'} onChange={() => setCurrency('LBP')} />LBP</label>
        </fieldset>
        <label className="onboarding-name-field">{text.walletName}<input autoComplete="off" maxLength={120} placeholder={text.walletNameHint} value={walletName} onChange={(event) => setWalletName(event.target.value)} /></label>
        {error ? <div className="error-notice" role="alert">{error}</div> : null}
        {pending ? <div role="status">{text.working}</div> : null}
        <div className="dialog-actions"><button type="submit" className="cr-button cr-button--primary cr-button--block" disabled={pending}>{text.walletAction(currency)}</button></div>
      </form>}
    </section>
  </div>;
}
