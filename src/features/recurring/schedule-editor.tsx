import { useId, useMemo, useState, type FormEvent } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount, parsePositiveMinorAmount } from '../wallets/money.js';
import { DialogShell } from '../wallets/dialog-shell.js';
import { classifyRecurringError, localizeRecurringError } from './errors.js';
import type { CommandOutcome } from './use-recurring.js';
import type { ScheduleCadence, ScheduleDefinitionInput, ScheduleKind, ScheduleState } from './types.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface ScheduleEditorProps {
  locale: Locale;
  pending: boolean;
  ambiguous: boolean;
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

function parseOptionalReference(value: string, field: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!UUID_PATTERN.test(trimmed)) throw new Error(field);
  return trimmed;
}

/** Reference ids (category/loan/funding-goal/preferred-wallet) are entered
 * as pasted ids, not chosen from a picker -- the same scope boundary
 * `GoalPurchaseDialog` (task 13) already used: building category/loan/wallet
 * pickers here would mean extending those other features' own list UIs,
 * out of this task's owned files ("do not change... posting gateways").
 * `save_schedule` itself validates every reference server-side regardless. */
export function ScheduleEditor(props: ScheduleEditorProps) {
  const descriptionId = useId();
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
  const [categoryIdText, setCategoryIdText] = useState('');
  const [loanIdText, setLoanIdText] = useState('');
  const [fundingGoalIdText, setFundingGoalIdText] = useState('');
  const [preferredWalletIdText, setPreferredWalletIdText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const preview = useMemo(() => {
    try {
      return { expectedMinor: parsePositiveMinorAmount(expectedMajor || '0', currency) };
    } catch {
      return null;
    }
  }, [expectedMajor, currency]);

  async function run(action: () => Promise<CommandOutcome>) {
    setError(null);
    try {
      const outcome = await action();
      if (outcome.status === 'success' || outcome.status === 'refresh-required') setSuccess(true);
      else if (outcome.status !== 'ambiguous') setError(t(props.locale, 'The result is still unknown. Retry only with this unchanged request.', 'ما زالت النتيجة غير معروفة. أعد المحاولة بهذا الطلب نفسه فقط.'));
    } catch (cause) {
      const view = localizeRecurringError(classifyRecurringError(cause), props.locale);
      setError(`${view.message} ${view.recovery}`);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!nameEn.trim() && !nameAr.trim()) {
      setError(t(props.locale, 'Enter a name in at least one language.', 'أدخل اسمًا بلغة واحدة على الأقل.'));
      return;
    }
    let expectedMinor: string;
    try {
      expectedMinor = parsePositiveMinorAmount(expectedMajor, currency);
    } catch {
      setError(t(props.locale, 'Enter a valid positive expected amount.', 'أدخل مبلغًا متوقعًا موجبًا صالحًا.'));
      return;
    }
    if (!validDate(startsOn)) {
      setError(t(props.locale, 'Choose a valid start date.', 'اختر تاريخ بدء صالح.'));
      return;
    }
    if (endsOn && !validDate(endsOn)) {
      setError(t(props.locale, 'Enter a valid end date, or leave it blank.', 'أدخل تاريخ انتهاء صالح أو اتركه فارغًا.'));
      return;
    }
    const intervalCount = Number(intervalCountText);
    if (!Number.isInteger(intervalCount) || intervalCount < 1 || intervalCount > 99) {
      setError(t(props.locale, 'The repeat interval must be a whole number from 1 to 99.', 'يجب أن يكون فاصل التكرار رقمًا صحيحًا من 1 إلى 99.'));
      return;
    }

    let categoryId: string | null;
    let loanId: string | null;
    let fundingGoalId: string | null;
    let preferredWalletId: string | null;
    try {
      categoryId = parseOptionalReference(categoryIdText, 'category');
      loanId = parseOptionalReference(loanIdText, 'loan');
      fundingGoalId = parseOptionalReference(fundingGoalIdText, 'fundingGoal');
      preferredWalletId = parseOptionalReference(preferredWalletIdText, 'preferredWallet');
    } catch {
      setError(t(props.locale, 'Reference ids must be exact ids as shown in their own screens, or left blank.', 'يجب أن تكون المعرّفات دقيقة كما تظهر في شاشاتها الخاصة، أو تُترك فارغة.'));
      return;
    }
    if (kind === 'debt_payment' && !loanId) {
      setError(t(props.locale, 'A debt payment schedule needs a loan reference id.', 'تحتاج جدولة سداد الدين إلى معرّف قرض.'));
      return;
    }

    const definition: ScheduleDefinitionInput = {
      currency, kind, state, nameEn: nameEn.trim() || null, nameAr: nameAr.trim() || null,
      expectedMinor, startsOn, endsOn: endsOn || null, cadence, intervalCount,
      categoryId, loanId, fundingGoalId, preferredWalletId,
    };
    void run(() => props.onSave({ scheduleId: globalThis.crypto.randomUUID(), expectedRevisionId: null, definition }));
  }

  if (success) return <DialogShell title={t(props.locale, 'Schedule saved', 'تم حفظ الجدول')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} descriptionId={descriptionId} focusVersion="success">
    <div className="dialog-result" role="status">
      <strong>{t(props.locale, 'Saved', 'تم الحفظ')}</strong>
      <p id={descriptionId}>{t(props.locale, 'The schedule has been created. Occurrences appear after the next refresh.', 'تم إنشاء الجدول. تظهر الدفعات بعد التحديث التالي.')}</p>
      <button type="button" data-autofocus onClick={props.onClose}>{t(props.locale, 'Done', 'تم')}</button>
    </div>
  </DialogShell>;

  return <DialogShell title={t(props.locale, 'New schedule', 'جدول جديد')}
    closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending} wide descriptionId={descriptionId}>
    <form aria-label={t(props.locale, 'Schedule details', 'تفاصيل الجدول')} onSubmit={submit}>
      <p id={descriptionId} className="dialog-intro">{t(props.locale, 'A schedule’s kind and currency can’t change after it’s created; already-materialized occurrences keep their own recorded amount and date no matter what a later revision says.', 'لا يمكن تغيير نوع الجدول أو عملته بعد إنشائه؛ تحتفظ الدفعات المُنشأة مسبقًا بمبلغها وتاريخها المسجَّلين مهما قالت مراجعة لاحقة.')}</p>

      <fieldset className="rec-editor-mode">
        <legend>{t(props.locale, 'Kind', 'النوع')}</legend>
        <label><input type="radio" name="rec-kind" checked={kind === 'expense'} onChange={() => setKind('expense')} />{t(props.locale, 'Expense (bill)', 'مصروف (فاتورة)')}</label>
        <label><input type="radio" name="rec-kind" checked={kind === 'income'} onChange={() => setKind('income')} />{t(props.locale, 'Income', 'دخل')}</label>
        <label><input type="radio" name="rec-kind" checked={kind === 'debt_payment'} onChange={() => setKind('debt_payment')} />{t(props.locale, 'Debt payment', 'سداد دين')}</label>
      </fieldset>

      <fieldset className="rec-editor-mode">
        <legend>{t(props.locale, 'Currency', 'العملة')}</legend>
        <label><input type="radio" name="rec-currency" checked={currency === 'USD'} onChange={() => setCurrency('USD')} />USD</label>
        <label><input type="radio" name="rec-currency" checked={currency === 'LBP'} onChange={() => setCurrency('LBP')} />LBP</label>
      </fieldset>

      <fieldset className="rec-editor-mode">
        <legend>{t(props.locale, 'State', 'الحالة')}</legend>
        <label><input type="radio" name="rec-state" checked={state === 'active'} onChange={() => setState('active')} />{t(props.locale, 'Active', 'نشط')}</label>
        <label><input type="radio" name="rec-state" checked={state === 'paused'} onChange={() => setState('paused')} />{t(props.locale, 'Paused', 'موقوف مؤقتًا')}</label>
      </fieldset>

      <div className="form-grid">
        <label className="full-field">{t(props.locale, 'Name (English)', 'الاسم (إنجليزي)')}
          <input data-autofocus type="text" value={nameEn} onChange={(event) => { setNameEn(event.target.value); setError(null); }} /></label>
        <label className="full-field">{t(props.locale, 'Name (Arabic)', 'الاسم (عربي)')}
          <input type="text" value={nameAr} onChange={(event) => { setNameAr(event.target.value); setError(null); }} /></label>
      </div>

      <label className="full-field">{t(props.locale, 'Expected amount', 'المبلغ المتوقع')}
        <input type="text" inputMode="decimal" value={expectedMajor} onChange={(event) => { setExpectedMajor(event.target.value); setError(null); }} /></label>

      <fieldset>
        <legend>{t(props.locale, 'Recurrence', 'التكرار')}</legend>
        <label><input type="radio" name="rec-cadence" checked={cadence === 'weekly'} onChange={() => setCadence('weekly')} />{t(props.locale, 'Weekly', 'أسبوعيًا')}</label>
        <label><input type="radio" name="rec-cadence" checked={cadence === 'monthly'} onChange={() => setCadence('monthly')} />{t(props.locale, 'Monthly', 'شهريًا')}</label>
        <label><input type="radio" name="rec-cadence" checked={cadence === 'yearly'} onChange={() => setCadence('yearly')} />{t(props.locale, 'Yearly', 'سنويًا')}</label>
      </fieldset>
      <label className="full-field">{t(props.locale, 'Repeat every N cadence units', 'التكرار كل N من وحدات التكرار')}
        <input type="number" min={1} max={99} value={intervalCountText} onChange={(event) => { setIntervalCountText(event.target.value); setError(null); }} /></label>

      <div className="form-grid">
        <label className="full-field">{t(props.locale, 'Starts on', 'يبدأ في')}
          <input type="date" value={startsOn} onChange={(event) => { setStartsOn(event.target.value); setError(null); }} /></label>
        <label className="full-field">{t(props.locale, 'Ends on (optional)', 'ينتهي في (اختياري)')}
          <input type="date" value={endsOn} onChange={(event) => { setEndsOn(event.target.value); setError(null); }} /></label>
      </div>

      <fieldset className="rec-reference-fields">
        <legend>{t(props.locale, 'References (optional, paste an exact id)', 'المراجع (اختياري، الصق معرّفًا دقيقًا)')}</legend>
        <label className="full-field">{t(props.locale, 'Category id', 'معرّف الفئة')}
          <input type="text" value={categoryIdText} onChange={(event) => { setCategoryIdText(event.target.value); setError(null); }} /></label>
        <div className="full-field">
          {/* The optional hint is a sibling of the label, never inside it --
             text inside a <label> becomes part of its accessible name, which
             would silently turn "Loan id" into "Loan id (required for a
             debt payment)" and break getByLabelText/getByRole('textbox',
             {name}) lookups the moment the kind changes (the same class of
             defect task 13's evidence record documents finding). */}
          <label>{t(props.locale, 'Loan id', 'معرّف القرض')}
            <input type="text" value={loanIdText} onChange={(event) => { setLoanIdText(event.target.value); setError(null); }} /></label>
          {kind === 'debt_payment' && <span className="rec-required-hint">{t(props.locale, '(required for a debt payment)', '(مطلوب لسداد الدين)')}</span>}
        </div>
        <label className="full-field">{t(props.locale, 'Funding goal id', 'معرّف هدف التمويل')}
          <input type="text" value={fundingGoalIdText} onChange={(event) => { setFundingGoalIdText(event.target.value); setError(null); }} /></label>
        <label className="full-field">{t(props.locale, 'Preferred wallet id', 'معرّف المحفظة المفضّلة')}
          <input type="text" value={preferredWalletIdText} onChange={(event) => { setPreferredWalletIdText(event.target.value); setError(null); }} /></label>
      </fieldset>

      {preview && <p className="rec-label-muted">{t(props.locale, 'Reviewable expected amount', 'المبلغ المتوقع القابل للمراجعة')}: <bdi>{formatMinorAmount(preview.expectedMinor, currency, props.locale)}</bdi></p>}
      {error && <div className="error-notice" role="alert">
        {error}
        {props.ambiguous && <div><button type="button" className="button-secondary retry-command" onClick={() => void run(props.onRetry)}>{t(props.locale, 'Retry unchanged request', 'إعادة الطلب دون تغيير')}</button></div>}
      </div>}
      <div className="dialog-actions">
        <button type="button" className="button-secondary" disabled={props.pending} onClick={props.onClose}>{t(props.locale, 'Cancel', 'إلغاء')}</button>
        <button type="submit" disabled={props.pending}>{props.pending ? t(props.locale, 'Saving…', 'جارٍ الحفظ…') : t(props.locale, 'Save', 'حفظ')}</button>
      </div>
    </form>
  </DialogShell>;
}
