import { useId, useRef, useState, type ReactNode } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount, parsePositiveMinorAmount } from '../wallets/money.js';
import { DialogShell } from '../wallets/dialog-shell.js';
import { classifyRecurringError, localizeRecurringError } from './errors.js';
import type { CommandOutcome } from './use-recurring.js';
import type { ScheduleCadence, ScheduleDefinitionInput, ScheduleKind, ScheduleState } from './types.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface ScheduleReferenceOptions {
  readonly categories: ReadonlyArray<{ readonly id: string; readonly nameEn: string; readonly nameAr: string }>;
  readonly loans: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly goals: ReadonlyArray<{ readonly id: string; readonly nameEn: string; readonly nameAr: string }>;
  readonly wallets: ReadonlyArray<{ readonly id: string; readonly name: string; readonly currency: string }>;
}

interface ScheduleEditorProps {
  locale: Locale;
  pending: boolean;
  ambiguous: boolean;
  /** Named lists the reference dropdowns render; every select submits the
   * chosen row's own id (or null for the 'None' option). */
  referenceOptions: ScheduleReferenceOptions;
  /** Planned income per currency from the monthly plan (integer-minor), used
   * by the income amount source. A null entry means that currency has no
   * planned income, so the 'Planned income' choice stays disabled for it. */
  plannedIncomeByCurrency: Readonly<Record<Currency, string | null>>;
  onClose(): void;
  onClearAmbiguous(): void;
  onRetry(): Promise<CommandOutcome>;
  onSave(input: { scheduleId: string; expectedRevisionId: string | null; definition: ScheduleDefinitionInput }): Promise<CommandOutcome>;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

function validDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

type AmountSource = 'custom' | 'planned';

const STEPS = ['type', 'amount', 'details', 'references', 'review'] as const;
type StepId = (typeof STEPS)[number];

function stepLabel(locale: Locale, step: StepId): string {
  switch (step) {
    case 'type': return t(locale, 'Type', 'النوع');
    case 'amount': return t(locale, 'Amount', 'المبلغ');
    case 'details': return t(locale, 'Details', 'التفاصيل');
    case 'references': return t(locale, 'References', 'المراجع');
    case 'review': return t(locale, 'Review', 'مراجعة');
  }
}

function kindLabel(locale: Locale, kind: ScheduleKind): string {
  switch (kind) {
    case 'expense': return t(locale, 'Expense (bill)', 'مصروف (فاتورة)');
    case 'income': return t(locale, 'Income', 'دخل');
    case 'debt_payment': return t(locale, 'Debt payment', 'سداد دين');
  }
}

function stateLabel(locale: Locale, state: ScheduleState): string {
  switch (state) {
    case 'active': return t(locale, 'Active', 'نشط');
    case 'paused': return t(locale, 'Paused', 'موقوف مؤقتًا');
    case 'ended': return t(locale, 'Ended', 'منتهٍ');
  }
}

function cadenceLabel(locale: Locale, cadence: ScheduleCadence): string {
  switch (cadence) {
    case 'weekly': return t(locale, 'Weekly', 'أسبوعيًا');
    case 'monthly': return t(locale, 'Monthly', 'شهريًا');
    case 'yearly': return t(locale, 'Yearly', 'سنويًا');
  }
}

function cadenceUnit(locale: Locale, cadence: ScheduleCadence): string {
  switch (cadence) {
    case 'weekly': return t(locale, 'weeks', 'أسابيع');
    case 'monthly': return t(locale, 'months', 'أشهر');
    case 'yearly': return t(locale, 'years', 'سنوات');
  }
}

function StepIndicator({ locale, step }: { locale: Locale; step: number }) {
  return (
    <div className="cr-wizard-steps" aria-label={t(locale, 'Progress', 'التقدم')}>
      {STEPS.map((candidate, index) => (
        <span
          key={candidate}
          className={`cr-wizard-step${index === step ? ' cr-wizard-step--current' : index < step ? ' cr-wizard-step--done' : ''}`}
          aria-current={index === step ? 'step' : undefined}
        >
          <span className="cr-wizard-step-dot" aria-hidden="true" />
          <span className="cr-wizard-step-label">{stepLabel(locale, candidate)}</span>
        </span>
      ))}
    </div>
  );
}

function ReviewRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="cr-wizard-review-row"><span>{label}</span><span>{children}</span></div>;
}

export function ScheduleEditor(props: ScheduleEditorProps) {
  const descriptionId = useId();
  const loanHintId = useId();
  const plannedHintId = useId();
  const plannedSummaryHintId = useId();
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<ScheduleKind>('expense');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [state, setState] = useState<ScheduleState>('active');
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [expectedMajor, setExpectedMajor] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [cadence, setCadence] = useState<ScheduleCadence>('monthly');
  const [intervalCountText, setIntervalCountText] = useState('1');
  const [categoryId, setCategoryId] = useState('');
  const [loanId, setLoanId] = useState('');
  const [fundingGoalId, setFundingGoalId] = useState('');
  const [preferredWalletId, setPreferredWalletId] = useState('');
  const [amountSource, setAmountSource] = useState<AmountSource>('custom');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const savingRef = useRef(false);

  const plannedIncomeMinor = props.plannedIncomeByCurrency[currency];
  const plannedSelected = kind === 'income' && amountSource === 'planned' && plannedIncomeMinor != null;

  async function run(action: () => Promise<CommandOutcome>) {
    setError(null);
    try {
      const outcome = await action();
      if (outcome.status === 'success' || outcome.status === 'refresh-required') setSuccess(true);
      else if (outcome.status !== 'ambiguous') setError(t(props.locale, 'The result is still unknown. Retry only with this unchanged request.', 'ما زالت النتيجة غير معروفة. أعد المحاولة بهذا الطلب نفسه فقط.'));
    } catch (cause) {
      const view = localizeRecurringError(classifyRecurringError(cause), props.locale);
      setError(`${view.message} ${view.recovery}`);
    } finally {
      savingRef.current = false;
    }
  }

  function changeKind(next: ScheduleKind) {
    setKind(next);
    setError(null);
    if (next === 'income' && amountSource === 'planned' && props.plannedIncomeByCurrency[currency] == null) setAmountSource('custom');
  }

  function changeCurrency(next: Currency) {
    setCurrency(next);
    setError(null);
    if (amountSource === 'planned' && props.plannedIncomeByCurrency[next] == null) setAmountSource('custom');
  }

  function resolveExpectedMinor(): { ok: true; minor: string } | { ok: false; plannedMissing: boolean } {
    if (kind === 'income' && amountSource === 'planned') {
      const planned = props.plannedIncomeByCurrency[currency];
      if (planned == null) return { ok: false, plannedMissing: true };
      return { ok: true, minor: planned };
    }
    try {
      return { ok: true, minor: parsePositiveMinorAmount(expectedMajor, currency) };
    } catch {
      return { ok: false, plannedMissing: false };
    }
  }

  /** Wizard gating (design-guidelines §13): Next validates only the step it
   * leaves, reusing the single-form submit checks verbatim so messages stay
   * byte-identical. Save re-runs every gate as a defense-in-depth pass. */
  function validateStep(index: number): boolean {
    if (index === 1) {
      const resolved = resolveExpectedMinor();
      if (!resolved.ok) {
        setError(resolved.plannedMissing
          ? t(props.locale, `Set planned income for ${currency} in the Plan section first.`, `حدّد الدخل المخطط لعملة ${currency} في قسم الخطة أولًا.`)
          : t(props.locale, 'Enter a valid positive expected amount.', 'أدخل مبلغًا متوقعًا موجبًا صالحًا.'));
        return false;
      }
      return true;
    }
    if (index === 2) {
      if (!nameEn.trim() && !nameAr.trim()) {
        setError(t(props.locale, 'Enter a name in at least one language.', 'أدخل اسمًا بلغة واحدة على الأقل.'));
        return false;
      }
      if (!validDate(startsOn)) {
        setError(t(props.locale, 'Choose a valid start date.', 'اختر تاريخ بدء صالح.'));
        return false;
      }
      if (endsOn && !validDate(endsOn)) {
        setError(t(props.locale, 'Enter a valid end date, or leave it blank.', 'أدخل تاريخ انتهاء صالح أو اتركه فارغًا.'));
        return false;
      }
      const intervalCount = Number(intervalCountText);
      if (!Number.isInteger(intervalCount) || intervalCount < 1 || intervalCount > 99) {
        setError(t(props.locale, 'The repeat interval must be a whole number from 1 to 99.', 'يجب أن يكون فاصل التكرار رقمًا صحيحًا من 1 إلى 99.'));
        return false;
      }
      return true;
    }
    if (index === 3) {
      if (kind === 'debt_payment' && !loanId) {
        setError(t(props.locale, 'Select the loan this payment covers', 'اختر القرض الذي يغطيه هذا الدفع'));
        return false;
      }
      return true;
    }
    return true;
  }

  function goNext() {
    if (props.pending) return;
    if (!validateStep(step)) return;
    setError(null);
    setStep(step + 1);
  }

  function goBack() {
    if (props.pending) return;
    setError(null);
    setStep((current) => Math.max(0, current - 1));
  }

  function save() {
    if (savingRef.current) return;
    if (props.pending) return;
    for (let index = 1; index <= 3; index += 1) {
      if (!validateStep(index)) {
        setStep(index);
        return;
      }
    }
    setError(null);
    const resolved = resolveExpectedMinor();
    if (!resolved.ok) return; // every gate above passed; unreachable
    const definition: ScheduleDefinitionInput = {
      currency, kind, state, nameEn: nameEn.trim() || null, nameAr: nameAr.trim() || null,
      expectedMinor: resolved.minor, startsOn, endsOn: endsOn || null, cadence, intervalCount: Number(intervalCountText),
      categoryId: categoryId || null, loanId: loanId || null, fundingGoalId: fundingGoalId || null, preferredWalletId: preferredWalletId || null,
    };
    savingRef.current = true;
    void run(() => props.onSave({ scheduleId: globalThis.crypto.randomUUID(), expectedRevisionId: null, definition }));
  }

  if (success) return <DialogShell title={t(props.locale, 'Schedule saved', 'تم حفظ الجدول')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} descriptionId={descriptionId} focusVersion="success">
    <div className="dialog-result" role="status">
      <strong>{t(props.locale, 'Saved', 'تم الحفظ')}</strong>
      <p id={descriptionId}>{t(props.locale, 'The schedule has been created. Occurrences appear after the next refresh.', 'تم إنشاء الجدول. تظهر الدفعات بعد التحديث التالي.')}</p>
      <button type="button" data-autofocus onClick={props.onClose}>{t(props.locale, 'Done', 'تم')}</button>
    </div>
  </DialogShell>;

  const stepId = STEPS[step] ?? 'type';
  const stepTitle = stepLabel(props.locale, stepId);
  const reviewNames = [nameEn.trim(), nameAr.trim()].filter(Boolean);
  const reviewCategory = props.referenceOptions.categories.find((item) => item.id === categoryId);
  const reviewLoan = props.referenceOptions.loans.find((item) => item.id === loanId);
  const reviewGoal = props.referenceOptions.goals.find((item) => item.id === fundingGoalId);
  const reviewWallet = props.referenceOptions.wallets.find((item) => item.id === preferredWalletId);
  const reviewResolved = resolveExpectedMinor();

  return <DialogShell title={t(props.locale, 'New schedule', 'جدول جديد')}
    closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending} wide descriptionId={descriptionId}>
    <form aria-label={t(props.locale, 'Schedule details', 'تفاصيل الجدول')}>
      <p id={descriptionId} className="dialog-intro">{t(props.locale, 'A schedule’s kind and currency can’t change after it’s created; already-materialized occurrences keep their own recorded amount and date no matter what a later revision says.', 'لا يمكن تغيير نوع الجدول أو عملته بعد إنشائه؛ تحتفظ الدفعات المُنشأة مسبقًا بمبلغها وتاريخها المسجَّلين مهما قالت مراجعة لاحقة.')}</p>

      <StepIndicator locale={props.locale} step={step} />
      <h3 className="cr-wizard-step-heading">{stepTitle}</h3>

      <div key={step} className="cr-wizard-content" role="group" aria-label={stepTitle}>
        {stepId === 'type' && <>
          <fieldset className="cr-choice">
            <legend>{t(props.locale, 'Kind', 'النوع')}</legend>
            <label><input type="radio" name="rec-kind" autoFocus data-autofocus checked={kind === 'expense'} onChange={() => changeKind('expense')} />{kindLabel(props.locale, 'expense')}</label>
            <label><input type="radio" name="rec-kind" checked={kind === 'income'} onChange={() => changeKind('income')} />{kindLabel(props.locale, 'income')}</label>
            <label><input type="radio" name="rec-kind" checked={kind === 'debt_payment'} onChange={() => changeKind('debt_payment')} />{kindLabel(props.locale, 'debt_payment')}</label>
          </fieldset>

          <fieldset className="cr-choice">
            <legend>{t(props.locale, 'Currency', 'العملة')}</legend>
            <label><input type="radio" name="rec-currency" checked={currency === 'USD'} onChange={() => changeCurrency('USD')} />USD</label>
            <label><input type="radio" name="rec-currency" checked={currency === 'LBP'} onChange={() => changeCurrency('LBP')} />LBP</label>
          </fieldset>

          <fieldset className="cr-choice">
            <legend>{t(props.locale, 'State', 'الحالة')}</legend>
            <label><input type="radio" name="rec-state" checked={state === 'active'} onChange={() => { setState('active'); setError(null); }} />{stateLabel(props.locale, 'active')}</label>
            <label><input type="radio" name="rec-state" checked={state === 'paused'} onChange={() => { setState('paused'); setError(null); }} />{stateLabel(props.locale, 'paused')}</label>
          </fieldset>
        </>}

        {stepId === 'amount' && <>
          {kind === 'income' && <fieldset className="cr-choice">
            <legend>{t(props.locale, 'Amount source', 'مصدر المبلغ')}</legend>
            <label><input type="radio" name="rec-amount-source" autoFocus checked={amountSource === 'custom'} onChange={() => { setAmountSource('custom'); setError(null); }} />{t(props.locale, 'Custom amount', 'مبلغ مخصص')}</label>
            <label><input type="radio" name="rec-amount-source" checked={amountSource === 'planned'} disabled={plannedIncomeMinor == null} onChange={() => { setAmountSource('planned'); setError(null); }} aria-describedby={plannedIncomeMinor == null ? plannedHintId : undefined} />{t(props.locale, 'Planned income', 'الدخل المخطط')}</label>
            {plannedIncomeMinor == null && <span id={plannedHintId} className="rec-required-hint">{t(props.locale, `Set planned income for ${currency} in the Plan section first.`, `حدّد الدخل المخطط لعملة ${currency} في قسم الخطة أولًا.`)}</span>}
          </fieldset>}

          {plannedSelected
            ? <div className="full-field">
                <span className="rec-label-muted">{t(props.locale, 'Expected amount', 'المبلغ المتوقع')}</span>
                <p aria-describedby={plannedSummaryHintId}><bdi>{formatMinorAmount(plannedIncomeMinor, currency, props.locale)}</bdi></p>
                <p id={plannedSummaryHintId} className="rec-label-muted">{t(props.locale, `From the planned income for ${currency} in the monthly plan.`, `من الدخل المخطط لعملة ${currency} في الخطة الشهرية.`)}</p>
              </div>
            : <label className="full-field">{t(props.locale, 'Expected amount', 'المبلغ المتوقع')}
                <input type="text" autoFocus={kind !== 'income'} inputMode="decimal" placeholder={currency === 'USD' ? '0.00' : '0'} value={expectedMajor} onChange={(event) => { setExpectedMajor(event.target.value); setError(null); }} /></label>}
        </>}

        {stepId === 'details' && <>
          <div className="form-grid">
            <label className="full-field">{t(props.locale, 'Name (English)', 'الاسم (إنجليزي)')}
              <input type="text" autoFocus placeholder={t(props.locale, 'e.g. Internet bill', 'مثال: فاتورة الإنترنت')} value={nameEn} onChange={(event) => { setNameEn(event.target.value); setError(null); }} /></label>
            <label className="full-field">{t(props.locale, 'Name (Arabic)', 'الاسم (عربي)')}
              <input type="text" placeholder={t(props.locale, 'مثال: فاتورة الإنترنت', 'مثال: فاتورة الإنترنت')} value={nameAr} onChange={(event) => { setNameAr(event.target.value); setError(null); }} /></label>
          </div>

          <fieldset className="cr-choice">
            <legend>{t(props.locale, 'Recurrence', 'التكرار')}</legend>
            <label><input type="radio" name="rec-cadence" checked={cadence === 'weekly'} onChange={() => setCadence('weekly')} />{cadenceLabel(props.locale, 'weekly')}</label>
            <label><input type="radio" name="rec-cadence" checked={cadence === 'monthly'} onChange={() => setCadence('monthly')} />{cadenceLabel(props.locale, 'monthly')}</label>
            <label><input type="radio" name="rec-cadence" checked={cadence === 'yearly'} onChange={() => setCadence('yearly')} />{cadenceLabel(props.locale, 'yearly')}</label>
          </fieldset>
          <div className="cr-affix">
            <label>{t(props.locale, 'Repeat every', 'كرر كل')}
              <input type="number" min={1} max={99} placeholder={t(props.locale, 'e.g. 2', 'مثال: 2')} value={intervalCountText} onChange={(event) => { setIntervalCountText(event.target.value); setError(null); }} /></label>
            <span className="cr-affix-suffix" aria-hidden="true">{cadenceUnit(props.locale, cadence)}</span>
          </div>

          <div className="form-grid">
            <label className="full-field">{t(props.locale, 'Starts on', 'يبدأ في')}
              <input type="date" value={startsOn} onChange={(event) => { setStartsOn(event.target.value); setError(null); }} /></label>
            <label className="full-field">{t(props.locale, 'Ends on (optional)', 'ينتهي في (اختياري)')}
              <input type="date" value={endsOn} onChange={(event) => { setEndsOn(event.target.value); setError(null); }} /></label>
          </div>
        </>}

        {stepId === 'references' && <fieldset className="cr-form-section">
          <legend>{t(props.locale, 'References (optional)', 'المراجع (اختياري)')}</legend>
          <label className="full-field">{t(props.locale, 'Category', 'الفئة')}
            <select autoFocus value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setError(null); }}>
              <option value="">{t(props.locale, 'None', 'بدون')}</option>
              {props.referenceOptions.categories.map((item) => <option key={item.id} value={item.id}>{props.locale === 'ar' ? item.nameAr : item.nameEn}</option>)}
            </select></label>
          <div className="full-field">
            {/* The optional hints are siblings of the label, never inside it --
               text inside a <label> becomes part of its accessible name, which
               would silently turn "Loan" into "Loan (required for a debt
               payment)" and break getByLabelText/getByRole('combobox',
               {name}) lookups the moment the kind changes (the same class of
               defect task 13's evidence record documents finding). */}
            <label>{t(props.locale, 'Loan', 'القرض')}
              <select value={loanId} aria-describedby={kind === 'debt_payment' && props.referenceOptions.loans.length === 0 ? loanHintId : undefined} onChange={(event) => { setLoanId(event.target.value); setError(null); }}>
                <option value="">{t(props.locale, 'None', 'بدون')}</option>
                {props.referenceOptions.loans.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select></label>
            {kind === 'debt_payment' && <span className="rec-required-hint">{t(props.locale, '(required for a debt payment)', '(مطلوب لسداد الدين)')}</span>}
            {kind === 'debt_payment' && props.referenceOptions.loans.length === 0 && <span id={loanHintId} className="rec-required-hint">{t(props.locale, 'Add a loan in the Loans section first.', 'أضف قرضًا في قسم القروض أولًا.')}</span>}
          </div>
          <label className="full-field">{t(props.locale, 'Funding goal', 'هدف التمويل')}
            <select value={fundingGoalId} onChange={(event) => { setFundingGoalId(event.target.value); setError(null); }}>
              <option value="">{t(props.locale, 'None', 'بدون')}</option>
              {props.referenceOptions.goals.map((item) => <option key={item.id} value={item.id}>{props.locale === 'ar' ? item.nameAr : item.nameEn}</option>)}
            </select></label>
          <label className="full-field">{t(props.locale, 'Preferred wallet', 'المحفظة المفضّلة')}
            <select value={preferredWalletId} onChange={(event) => { setPreferredWalletId(event.target.value); setError(null); }}>
              <option value="">{t(props.locale, 'None', 'بدون')}</option>
              {props.referenceOptions.wallets.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.currency}</option>)}
            </select></label>
        </fieldset>}

        {stepId === 'review' && <div className="cr-wizard-review">
          <ReviewRow label={t(props.locale, 'Kind', 'النوع')}>{kindLabel(props.locale, kind)}</ReviewRow>
          <ReviewRow label={t(props.locale, 'Currency', 'العملة')}>{currency}</ReviewRow>
          <ReviewRow label={t(props.locale, 'State', 'الحالة')}>{stateLabel(props.locale, state)}</ReviewRow>
          {reviewResolved.ok && <ReviewRow label={t(props.locale, 'Expected amount', 'المبلغ المتوقع')}><bdi>{formatMinorAmount(reviewResolved.minor, currency, props.locale)}</bdi></ReviewRow>}
          <ReviewRow label={t(props.locale, 'Recurrence', 'التكرار')}>{`${cadenceLabel(props.locale, cadence)} · ${Number(intervalCountText)} ${cadenceUnit(props.locale, cadence)}`}</ReviewRow>
          <ReviewRow label={t(props.locale, 'Starts on', 'يبدأ في')}>{startsOn}</ReviewRow>
          <ReviewRow label={t(props.locale, 'Ends on', 'ينتهي في')}>{endsOn || '—'}</ReviewRow>
          <ReviewRow label={t(props.locale, 'Name', 'الاسم')}>{reviewNames.map((name, index) => <span key={name}>{index > 0 ? ' · ' : ''}<bdi>{name}</bdi></span>)}</ReviewRow>
          <ReviewRow label={t(props.locale, 'Category', 'الفئة')}>{reviewCategory ? (props.locale === 'ar' ? reviewCategory.nameAr : reviewCategory.nameEn) : t(props.locale, 'None', 'بدون')}</ReviewRow>
          <ReviewRow label={t(props.locale, 'Loan', 'القرض')}>{reviewLoan ? reviewLoan.name : t(props.locale, 'None', 'بدون')}</ReviewRow>
          <ReviewRow label={t(props.locale, 'Funding goal', 'هدف التمويل')}>{reviewGoal ? (props.locale === 'ar' ? reviewGoal.nameAr : reviewGoal.nameEn) : t(props.locale, 'None', 'بدون')}</ReviewRow>
          <ReviewRow label={t(props.locale, 'Preferred wallet', 'المحفظة المفضّلة')}>{reviewWallet ? `${reviewWallet.name} · ${reviewWallet.currency}` : t(props.locale, 'None', 'بدون')}</ReviewRow>
        </div>}
      </div>

      {error && <div className="error-notice" role="alert">
        {error}
        {props.ambiguous && <div><button type="button" className="button-secondary retry-command" onClick={() => void run(props.onRetry)}>{t(props.locale, 'Retry unchanged request', 'إعادة الطلب دون تغيير')}</button></div>}
      </div>}
      <div className="cr-wizard-footer">
        <button type="button" className="text-button" disabled={props.pending} onClick={props.onClose}>{t(props.locale, 'Cancel', 'إلغاء')}</button>
        {step > 0 && <button type="button" className="button-secondary" disabled={props.pending} onClick={goBack}>{t(props.locale, 'Back', 'رجوع')}</button>}
        <div className="cr-wizard-footer-end">
          {stepId === 'review'
            ? <button type="button" className="cr-button cr-button--primary" disabled={props.pending || savingRef.current} onClick={() => save()}>{props.pending || savingRef.current ? t(props.locale, 'Saving…', 'جارٍ الحفظ…') : t(props.locale, 'Save', 'حفظ')}</button>
            : <button type="button" className="cr-button cr-button--primary" disabled={props.pending} onClick={goNext}>{t(props.locale, 'Next', 'التالي')}</button>}
        </div>
      </div>
    </form>
  </DialogShell>;
}
