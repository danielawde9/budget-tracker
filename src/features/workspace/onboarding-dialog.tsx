import { useId, useRef, useState, useEffect, type FormEvent, type KeyboardEvent } from 'react';
import { UserRound, UsersRound } from 'lucide-react';
import onboardingBackdrop from '../../assets/onboarding-lifestyle-backdrop.png';
import type { Currency, Locale, SpaceKind } from '../loans/types.js';
import { parsePositiveMinorAmount } from '../wallets/money.js';
import type { OnboardingProgress, OnboardingSetup } from './onboarding-progress.js';
import type { CreateSpaceInput, CreateWalletInput, CreatedRecord, OpeningBalanceInput } from './types.js';

interface OnboardingDialogProps {
  locale: Locale;
  mode?: 'first' | 'additional';
  /** Resumed progress: start at the wallet step, or at the starting-balance step. */
  setup?: OnboardingSetup | null;
  createSpace(input: CreateSpaceInput): Promise<CreatedRecord>;
  createWallet(input: CreateWalletInput): Promise<CreatedRecord>;
  /** Persist the wizard step so an abandoned first run can be resumed. */
  onProgress?(progress: OnboardingProgress): void;
  /** Record the wallet's starting balance. Present only for the first-run wizard. */
  recordOpeningBalance?(input: OpeningBalanceInput): Promise<void>;
  onComplete(spaceId: string): void;
  /** Present only when the wizard can be dismissed (an additional space, never first run). */
  onClose?(): void;
}

const copy = {
  en: {
    product: 'Budget ledger', progress: 'Setup progress', stepSpace: 'Space', stepWallet: 'First wallet', stepBalance: 'Opening balance',
    spaceTitle: 'Create your first space', spaceTitleAdditional: 'Add another space',
    spaceIntro: 'A space keeps one set of wallets and loans together.',
    chooseKind: 'Choose a space type', personal: 'Personal space', household: 'Household space',
    personalDescription: 'Just for you. Keep your finances private.',
    householdDescription: 'Share with the people you live with.',
    personalPrivate: 'A personal space is private. Only you can see its wallets, loans and data.',
    spaceName: 'Space name', currencyLabel: 'Choose a currency',
    spaceNameHint: 'e.g. Home', walletNameHint: 'e.g. Cash',
    spaceExamples: 'For example: My money or Our home.',
    personalAction: 'Create personal space', householdAction: 'Create household space',
    combinedAction: 'Create space and wallet', walletRequired: 'Enter a wallet name between 1 and 120 characters.',
    mobileWalletTitle: 'Set up your first wallet',
    mobileWalletHint: 'This will be the first wallet in your space. You can add more later.',
    walletTitle: 'Add your first wallet', walletIntro: 'Choose the currency you use first. You can add more wallets later.',
    walletName: 'Wallet name', walletAction: (currency: Currency) => `Create ${currency} wallet`,
    householdLater: 'After setup, invite members from Manage > Household.',
    required: 'Enter a name between 1 and 120 characters.', working: 'Checking your setup…',
    balanceTitle: 'Opening balance', balanceAmount: 'Amount', balanceAction: 'Record opening balance',
    balanceInvalid: 'Enter a valid positive amount.', skip: 'Skip',
    close: 'Close', cancel: 'Cancel',
    sceneTitle: 'A clearer picture for a brighter tomorrow',
    sceneBody: 'Track your money. Stay in control. Build the life you want.',
  },
  ar: {
    product: 'دفتر الميزانية', progress: 'تقدّم الإعداد', stepSpace: 'المساحة', stepWallet: 'المحفظة الأولى', stepBalance: 'رصيد افتتاحي',
    spaceTitle: 'إنشاء مساحتك الأولى', spaceTitleAdditional: 'إضافة مساحة أخرى',
    spaceIntro: 'تجمع المساحة مجموعة واحدة من المحافظ والقروض.',
    chooseKind: 'اختر نوع المساحة', personal: 'مساحة شخصية', household: 'مساحة منزلية',
    personalDescription: 'لك وحدك. احتفظ بخصوصية أموالك.',
    householdDescription: 'شاركها مع الأشخاص الذين تعيش معهم.',
    personalPrivate: 'المساحة الشخصية خاصة. أنت وحدك من يرى محافظها وقروضها وبياناتها.',
    spaceName: 'اسم المساحة', currencyLabel: 'اختر العملة',
    spaceNameHint: 'مثال: المنزل', walletNameHint: 'مثال: نقد',
    spaceExamples: 'مثال: أموالي أو منزلنا.',
    personalAction: 'إنشاء مساحة شخصية', householdAction: 'إنشاء مساحة منزلية',
    combinedAction: 'إنشاء المساحة والمحفظة', walletRequired: 'أدخل اسمًا للمحفظة من 1 إلى 120 حرفًا.',
    mobileWalletTitle: 'أعدّ محفظتك الأولى',
    mobileWalletHint: 'ستكون هذه أول محفظة في مساحتك. يمكنك إضافة المزيد لاحقًا.',
    walletTitle: 'أضف محفظتك الأولى', walletIntro: 'اختر العملة التي تستخدمها أولًا. يمكنك إضافة محافظ أخرى لاحقًا.',
    walletName: 'اسم المحفظة', walletAction: (currency: Currency) => `إنشاء محفظة ${currency}`,
    householdLater: 'بعد الإعداد، يمكنك دعوة الأعضاء من صفحة المنزل ضمن إدارة.',
    required: 'أدخل اسمًا من 1 إلى 120 حرفًا.', working: 'جارٍ التحقق من الإعداد…',
    balanceTitle: 'رصيد افتتاحي', balanceAmount: 'المبلغ', balanceAction: 'تسجيل رصيد افتتاحي',
    balanceInvalid: 'أدخل مبلغًا موجبًا صالحًا.', skip: 'تخطَّ',
    close: 'إغلاق', cancel: 'إلغاء',
    sceneTitle: 'صورة أوضح لغد أفضل',
    sceneBody: 'تابع أموالك. حافظ على التحكم. وابنِ الحياة التي تريدها.',
  },
} as const;

function focusable(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
}

function initialStep(setup: OnboardingSetup | null | undefined): 'space' | 'wallet' | 'balance' {
  if (!setup) return 'space';
  return setup.wallet ? 'balance' : 'wallet';
}

export function OnboardingDialog({ locale, mode = 'first', setup = null, createSpace, createWallet, onProgress, recordOpeningBalance, onComplete, onClose }: OnboardingDialogProps) {
  const text = copy[locale];
  const [step, setStep] = useState<'space' | 'wallet' | 'balance'>(() => initialStep(setup));
  const [kind, setKind] = useState<SpaceKind>('personal');
  const [spaceName, setSpaceName] = useState('');
  const [spaceId, setSpaceId] = useState(setup?.spaceId ?? '');
  const [currency, setCurrency] = useState<Currency>(setup?.wallet?.currency ?? 'USD');
  const [walletName, setWalletName] = useState('');
  const [walletId, setWalletId] = useState(setup?.wallet?.id ?? '');
  const [amount, setAmount] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 700px)').matches === true);
  const dialogRef = useRef<HTMLElement>(null);
  // One request id for the whole wizard run: retrying the starting balance reuses
  // it, so an opening balance is never posted twice.
  const [balanceRequestId] = useState(() => setup?.balanceRequestId ?? crypto.randomUUID());
  const personalDescriptionId = useId();
  const householdDescriptionId = useId();
  const combinedSetup = compact && mode === 'first';
  const balanceEnabled = mode === 'first' && typeof recordOpeningBalance === 'function';

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(max-width: 700px)');
    const update = () => setCompact(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    focusable(dialog)[0]?.focus();
  }, [step]);

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (onClose && !pending) onClose();
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

  const finishAfterWallet = (targetSpaceId: string) => {
    if (balanceEnabled) setStep('balance');
    else onComplete(targetSpaceId);
  };

  const submitSpace = async (event: FormEvent) => {
    event.preventDefault();
    const name = spaceName.trim();
    if (name.length < 1 || name.length > 120) {
      setError(text.required);
      return;
    }
    const firstWalletName = walletName.trim();
    if (combinedSetup && (firstWalletName.length < 1 || firstWalletName.length > 120)) {
      setError(text.walletRequired);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await createSpace({ name, kind });
      setSpaceId(result.id);
      if (mode === 'first') onProgress?.({ spaceId: result.id, balanceRequestId });
      if (!combinedSetup) {
        setStep('wallet');
        return;
      }
      try {
        const wallet = await createWallet({ spaceId: result.id, name: firstWalletName, currency });
        setWalletId(wallet.id);
        finishAfterWallet(result.id);
      } catch (cause) {
        setStep('wallet');
        throw cause;
      }
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
      const wallet = await createWallet({ spaceId, name, currency });
      setWalletId(wallet.id);
      finishAfterWallet(spaceId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.required);
    } finally {
      setPending(false);
    }
  };

  const submitBalance = async (event: FormEvent) => {
    event.preventDefault();
    if (!recordOpeningBalance) {
      onComplete(spaceId);
      return;
    }
    let amountMinor: string;
    try {
      amountMinor = parsePositiveMinorAmount(amount, currency);
    } catch {
      setError(text.balanceInvalid);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await recordOpeningBalance({ spaceId, walletId, amountMinor, requestId: balanceRequestId });
      onComplete(spaceId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.balanceInvalid);
    } finally {
      setPending(false);
    }
  };

  const skipBalance = () => {
    if (!pending) onComplete(spaceId);
  };

  const spaceTitle = mode === 'additional' ? text.spaceTitleAdditional : text.spaceTitle;
  const title = step === 'space' ? spaceTitle : step === 'wallet' ? text.walletTitle : text.balanceTitle;
  const intro = step === 'space' ? text.spaceIntro : step === 'wallet' ? text.walletIntro : null;
  const cancel = onClose ? <button type="button" className="button-secondary" disabled={pending} onClick={onClose}>{text.cancel}</button> : null;
  return <div className="overlay onboarding-overlay">
    <div className="onboarding-scene" aria-hidden="true">
      <img src={onboardingBackdrop} alt="" />
      <div className="onboarding-scene-copy"><p className="onboarding-scene-title">{text.sceneTitle}</p><p className="onboarding-scene-body">{text.sceneBody}</p></div>
    </div>
    <div className="onboarding-scrim" aria-hidden="true" />
    <section ref={dialogRef} className="dialog dialog-setup onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" onKeyDown={trapFocus}>
      <header className="dialog-header"><div><span className="auth-brand"><span className="auth-brand-mark" aria-hidden="true" />{text.product}</span><h1 id="onboarding-title">{title}</h1>{intro ? <p className="dialog-intro">{intro}</p> : null}</div>{onClose ? <button type="button" className="icon-button" aria-label={text.close} disabled={pending} onClick={onClose}>×</button> : null}</header>
      <ol className="onboarding-progress" aria-label={text.progress}>
        <li className={step === 'space' ? 'onboarding-progress-current' : 'onboarding-progress-done'}><span className="onboarding-step-number" aria-hidden="true">1</span><span aria-current={step === 'space' ? 'step' : undefined}>{text.stepSpace}</span></li>
        <li className={step === 'wallet' ? 'onboarding-progress-current' : step === 'balance' ? 'onboarding-progress-done' : undefined}><span className="onboarding-step-number" aria-hidden="true">2</span><span aria-current={step === 'wallet' ? 'step' : undefined}>{text.stepWallet}</span></li>
        {balanceEnabled ? <li className={step === 'balance' ? 'onboarding-progress-current' : undefined}><span className="onboarding-step-number" aria-hidden="true">3</span><span aria-current={step === 'balance' ? 'step' : undefined}>{text.stepBalance}</span></li> : null}
      </ol>
      {step === 'space' ? <form onSubmit={(event) => void submitSpace(event)}>
        <fieldset className="segmented onboarding-kind-options">
          <legend>{text.chooseKind}</legend>
          <label><input type="radio" name="space-kind" aria-label={text.personal} aria-describedby={personalDescriptionId} checked={kind === 'personal'} onChange={() => setKind('personal')} /><UserRound className="onboarding-kind-icon" aria-hidden="true" /><span><strong>{text.personal}</strong><small id={personalDescriptionId}>{text.personalDescription}</small></span></label>
          <label><input type="radio" name="space-kind" aria-label={text.household} aria-describedby={householdDescriptionId} checked={kind === 'household'} onChange={() => setKind('household')} /><UsersRound className="onboarding-kind-icon" aria-hidden="true" /><span><strong>{text.household}</strong><small id={householdDescriptionId}>{text.householdDescription}</small></span></label>
        </fieldset>
        <label className="onboarding-name-field">{text.spaceName}<input autoComplete="off" maxLength={120} placeholder={text.spaceNameHint} value={spaceName} onChange={(event) => setSpaceName(event.target.value)} /></label>
        <p className="onboarding-name-hint">{text.spaceExamples}</p>
        {combinedSetup ? <div className="onboarding-mobile-wallet">
          <h2>{text.mobileWalletTitle}</h2>
          <input aria-label={text.walletName} autoComplete="off" maxLength={120} placeholder={text.walletNameHint} value={walletName} onChange={(event) => setWalletName(event.target.value)} />
          <p className="onboarding-name-hint">{text.mobileWalletHint}</p>
        </div> : null}
        {error ? <div className="error-notice" role="alert">{error}</div> : null}
        {pending ? <div role="status">{text.working}</div> : null}
        <div className="dialog-actions">{cancel}<button type="submit" className="cr-button cr-button--primary cr-button--block" disabled={pending}>{combinedSetup ? text.combinedAction : kind === 'personal' ? text.personalAction : text.householdAction}</button></div>
        {kind === 'personal' ? <p className="onboarding-privacy">{text.personalPrivate}</p> : null}
      </form> : step === 'wallet' ? <form onSubmit={(event) => void submitWallet(event)}>
        {kind === 'household' ? <p className="onboarding-boundary">{text.householdLater}</p> : null}
        <fieldset className="segmented onboarding-currency-options">
          <legend>{text.currencyLabel}</legend>
          <label><input type="radio" name="currency" checked={currency === 'USD'} onChange={() => setCurrency('USD')} />USD</label>
          <label><input type="radio" name="currency" checked={currency === 'LBP'} onChange={() => setCurrency('LBP')} />LBP</label>
        </fieldset>
        <label className="onboarding-name-field">{text.walletName}<input autoComplete="off" maxLength={120} placeholder={text.walletNameHint} value={walletName} onChange={(event) => setWalletName(event.target.value)} /></label>
        {error ? <div className="error-notice" role="alert">{error}</div> : null}
        {pending ? <div role="status">{text.working}</div> : null}
        <div className="dialog-actions">{cancel}<button type="submit" className="cr-button cr-button--primary cr-button--block" disabled={pending}>{text.walletAction(currency)}</button></div>
      </form> : <form onSubmit={(event) => void submitBalance(event)}>
        <label className="onboarding-name-field">{text.balanceAmount}<input inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        {error ? <div className="error-notice" role="alert">{error}</div> : null}
        {pending ? <div role="status">{text.working}</div> : null}
        <div className="dialog-actions"><button type="button" className="button-secondary" disabled={pending} onClick={skipBalance}>{text.skip}</button><button type="submit" className="cr-button cr-button--primary cr-button--block" disabled={pending}>{text.balanceAction}</button></div>
      </form>}
    </section>
  </div>;
}
