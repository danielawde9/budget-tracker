import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount, parsePositiveMinorAmount } from '../wallets/money.js';
import { classifyGoalsError, localizeGoalsError } from './errors.js';
import type { CommandOutcome } from './use-goals.js';
import type { GoalDefinitionInput, GoalMilestoneInput, GoalKind, GoalMilestoneKind, GoalContributionMode, GoalState } from './types.js';

interface MilestoneDraft {
  readonly id: string;
  kind: GoalMilestoneKind;
  labelEn: string;
  labelAr: string;
  thresholdMajor: string;
  dueDate: string;
}

interface GoalEditorExisting {
  readonly goalId: string;
  readonly expectedRevisionId: string;
  readonly currentState: GoalState;
  /** Best-effort reconstruction: `goal_page`/`goal_detail`'s summary (task
   * 11's own exact field list) does not expose `contributionMode`, the
   * goal's own base `monthlyAmountMinor`, or `note` -- there is no SQL
   * change in scope for this task to add them. Pass whatever the caller
   * can genuinely derive; the editor shows a warning in revise mode
   * because these three fields are re-entered fresh, not pre-filled from
   * a value it cannot see. See docs/decisions.md for the follow-up this
   * leaves for a future task. */
  readonly definition: GoalDefinitionInput;
  readonly milestones: readonly GoalMilestoneInput[];
}

interface GoalEditorProps {
  locale: Locale;
  mode: 'create' | 'revise';
  existing?: GoalEditorExisting;
  /** Pre-selects the state radio for a one-click-feeling pause/resume/close
   * action from the detail page; the user still reviews before submitting. */
  initialState?: GoalState | undefined;
  /** Integer-minor planned income for this goal's currency from the monthly
   * plan. When null, the 'Planned income' monthly-amount source is disabled
   * with a hint pointing at the Plan section. */
  plannedIncomeMinor: string | null;
  pending: boolean;
  ambiguous: boolean;
  onClose(): void;
  onClearAmbiguous(): void;
  onRetry(): Promise<CommandOutcome>;
  onCreate(input: { goalId: string; definition: GoalDefinitionInput; milestones: readonly GoalMilestoneInput[] }): Promise<CommandOutcome>;
  onRevise(input: { goalId: string; expectedRevisionId: string; definition: GoalDefinitionInput; milestones: readonly GoalMilestoneInput[]; state: GoalState }): Promise<CommandOutcome>;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;
const MAX_MILESTONES = 20;

const WIZARD_STEPS = ['type', 'target', 'contributions', 'milestones', 'review'] as const;
type WizardStep = (typeof WIZARD_STEPS)[number];

function wizardStepIndex(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step);
}

function stepLabel(locale: Locale, step: WizardStep): string {
  switch (step) {
    case 'type': return t(locale, 'Type', 'النوع');
    case 'target': return t(locale, 'Target', 'الهدف');
    case 'contributions': return t(locale, 'Contributions', 'المساهمات');
    case 'milestones': return t(locale, 'Milestones', 'المعالم');
    case 'review': return t(locale, 'Review', 'مراجعة');
  }
}

function kindLabel(locale: Locale, kind: GoalKind): string {
  return kind === 'reserve' ? t(locale, 'Reserve', 'احتياطي') : t(locale, 'Purchase', 'شراء');
}

interface GoalSheetFrameProps {
  locale: Locale;
  title: string;
  closeLabel: string;
  pending?: boolean;
  onClose(): void;
  children: ReactNode;
}

function GoalSheetFrame({ locale, title, closeLabel, pending = false, onClose, children }: GoalSheetFrameProps) {
  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    const target = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current;
    target?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const controls = [...panel.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
      )];
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      returnFocus.current?.focus();
    };
  }, [onClose, pending]);

  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !pending) onClose();
    }}>
      <div
        ref={panel}
        className="dialog goal-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="dialog-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" aria-label={closeLabel} disabled={pending} onClick={onClose}>×</button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}

function draftFromMilestone(milestone: GoalMilestoneInput): MilestoneDraft {
  return {
    id: milestone.id, kind: milestone.kind, labelEn: milestone.labelEn ?? '', labelAr: milestone.labelAr ?? '',
    thresholdMajor: milestone.thresholdMinor ? (BigInt(milestone.thresholdMinor) / 100n).toString() : '',
    dueDate: milestone.dueDate ?? '',
  };
}

export function GoalEditor(props: GoalEditorProps) {
  const descriptionId = useId();
  const plannedHintId = useId();
  const plannedUnavailableHintId = useId();
  const existing = props.existing;
  const plannedIncomeMinor = props.plannedIncomeMinor ?? null;
  const [step, setStep] = useState<WizardStep>('type');
  const [kind, setKind] = useState<GoalKind>(existing?.definition.kind ?? 'reserve');
  const [currency, setCurrency] = useState<Currency>(existing?.definition.currency ?? 'USD');
  const [nameEn, setNameEn] = useState(existing?.definition.nameEn ?? '');
  const [nameAr, setNameAr] = useState(existing?.definition.nameAr ?? '');
  const [note, setNote] = useState(existing?.definition.note ?? '');
  const [targetMajor, setTargetMajor] = useState(existing ? (BigInt(existing.definition.targetMinor) / 100n).toString() : '');
  const [contributionMode, setContributionMode] = useState<GoalContributionMode>(existing?.definition.contributionMode ?? 'manual_monthly');
  const [monthlySource, setMonthlySource] = useState<'custom' | 'planned'>(() =>
    existing?.definition.monthlyAmountMinor != null && existing.definition.monthlyAmountMinor === plannedIncomeMinor
      ? 'planned'
      : 'custom');
  const [deadline, setDeadline] = useState(existing?.definition.deadline ?? '');
  const [monthlyMajor, setMonthlyMajor] = useState(existing?.definition.monthlyAmountMinor ? (BigInt(existing.definition.monthlyAmountMinor) / 100n).toString() : '');
  const [priorityText, setPriorityText] = useState(String(existing?.definition.priority ?? 0));
  const [state, setState] = useState<GoalState>(props.initialState ?? existing?.currentState ?? 'active');
  const [milestones, setMilestones] = useState<MilestoneDraft[]>(() => (existing?.milestones ?? []).map(draftFromMilestone));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const savingRef = useRef(false);

  const stepIndex = wizardStepIndex(step);
  const canAddMilestone = milestones.length < MAX_MILESTONES;
  const plannedIncomeLinked = contributionMode === 'manual_monthly' && monthlySource === 'planned' && plannedIncomeMinor !== null;

  function addMilestone(milestoneKind: GoalMilestoneKind) {
    setMilestones((current) => [...current, {
      id: globalThis.crypto.randomUUID(), kind: milestoneKind, labelEn: '', labelAr: '', thresholdMajor: '', dueDate: '',
    }]);
  }

  function removeMilestone(id: string) {
    setMilestones((current) => current.filter((row) => row.id !== id));
  }

  function updateMilestone(id: string, patch: Partial<MilestoneDraft>) {
    setMilestones((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  const preview = useMemo(() => {
    try {
      return { targetMinor: parsePositiveMinorAmount(targetMajor || '0', currency) };
    } catch {
      return null;
    }
  }, [targetMajor, currency]);

  const reviewMonthlyMinor = useMemo(() => {
    if (contributionMode !== 'manual_monthly') return null;
    if (plannedIncomeLinked) return plannedIncomeMinor;
    try {
      return monthlyMajor.trim() ? parsePositiveMinorAmount(monthlyMajor, currency) : '0';
    } catch {
      return null;
    }
  }, [contributionMode, plannedIncomeLinked, plannedIncomeMinor, monthlyMajor, currency]);

  async function run(action: () => Promise<CommandOutcome>) {
    setError(null);
    try {
      const outcome = await action();
      if (outcome.status === 'success' || outcome.status === 'refresh-required') setSuccess(true);
      else if (outcome.status !== 'ambiguous') setError(t(props.locale, 'The result is still unknown. Retry only with this unchanged request.', 'ما زالت النتيجة غير معروفة. أعد المحاولة بهذا الطلب نفسه فقط.'));
    } catch (cause) {
      const view = localizeGoalsError(classifyGoalsError(cause), props.locale);
      setError(`${view.message} ${view.recovery}`);
    } finally {
      savingRef.current = false;
    }
  }

  function validateTarget(): { targetMinor: string; priority: number } | null {
    if (!nameEn.trim() && !nameAr.trim()) {
      setError(t(props.locale, 'Enter a name in at least one language.', 'أدخل اسمًا بلغة واحدة على الأقل.'));
      return null;
    }
    let targetMinor: string;
    try {
      targetMinor = parsePositiveMinorAmount(targetMajor, currency);
    } catch {
      setError(t(props.locale, 'Enter a valid positive target amount.', 'أدخل مبلغ هدف موجب صالح.'));
      return null;
    }
    const priority = Number(priorityText);
    if (!Number.isInteger(priority) || priority < 0 || priority > 999) {
      setError(t(props.locale, 'Priority must be a whole number from 0 to 999.', 'يجب أن تكون الأولوية رقمًا صحيحًا من 0 إلى 999.'));
      return null;
    }
    return { targetMinor, priority };
  }

  function validateContributions(): { monthlyAmountMinor: string | null } | null {
    if (contributionMode === 'by_deadline' && !deadline) {
      setError(t(props.locale, 'Choose a deadline for a by-deadline goal.', 'اختر موعدًا نهائيًا لهدف بموعد نهائي.'));
      return null;
    }
    let monthlyAmountMinor: string | null = null;
    if (contributionMode === 'manual_monthly') {
      if (plannedIncomeLinked) {
        monthlyAmountMinor = plannedIncomeMinor;
      } else {
        try {
          monthlyAmountMinor = monthlyMajor.trim() ? parsePositiveMinorAmount(monthlyMajor, currency) : '0';
        } catch {
          setError(t(props.locale, 'Enter a valid monthly amount.', 'أدخل مبلغًا شهريًا صالحًا.'));
          return null;
        }
      }
    }
    return { monthlyAmountMinor };
  }

  function buildMilestoneInputs(): GoalMilestoneInput[] | null {
    const milestoneInputs: GoalMilestoneInput[] = [];
    for (const [index, row] of milestones.entries()) {
      if (!row.labelEn.trim() && !row.labelAr.trim()) {
        setError(t(props.locale, 'Every milestone needs a label in at least one language.', 'يحتاج كل معلم إلى تسمية بلغة واحدة على الأقل.'));
        return null;
      }
      let thresholdMinor: string | null = null;
      if (row.kind === 'amount') {
        try {
          thresholdMinor = parsePositiveMinorAmount(row.thresholdMajor, currency);
        } catch {
          setError(t(props.locale, 'Every amount milestone needs a valid positive threshold.', 'يحتاج كل معلم مبلغ إلى حد أدنى موجب صالح.'));
          return null;
        }
      }
      milestoneInputs.push({
        id: row.id, kind: row.kind, labelEn: row.labelEn.trim() || null, labelAr: row.labelAr.trim() || null,
        thresholdMinor, dueDate: row.dueDate || null, ordinal: index,
      });
    }
    return milestoneInputs;
  }

  function goNext() {
    setError(null);
    if (step === 'target' && !validateTarget()) return;
    if (step === 'contributions' && !validateContributions()) return;
    if (step === 'milestones' && !buildMilestoneInputs()) return;
    const next = WIZARD_STEPS[stepIndex + 1];
    if (next) setStep(next);
  }

  function goBack() {
    setError(null);
    const previous = WIZARD_STEPS[stepIndex - 1];
    if (previous) setStep(previous);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (step !== 'review') {
      goNext();
      return;
    }
    if (savingRef.current) return;
    setError(null);
    const target = validateTarget();
    if (!target) return;
    const contributions = validateContributions();
    if (!contributions) return;
    const milestoneInputs = buildMilestoneInputs();
    if (!milestoneInputs) return;

    const definition: GoalDefinitionInput = {
      kind, currency, nameEn: nameEn.trim() || null, nameAr: nameAr.trim() || null, note: note.trim() || null,
      targetMinor: target.targetMinor, deadline: contributionMode === 'by_deadline' ? deadline : null, contributionMode,
      monthlyAmountMinor: contributions.monthlyAmountMinor, priority: target.priority,
    };

    if (props.mode === 'create') {
      savingRef.current = true;
      void run(() => props.onCreate({ goalId: globalThis.crypto.randomUUID(), definition, milestones: milestoneInputs }));
    } else if (existing) {
      savingRef.current = true;
      void run(() => props.onRevise({ goalId: existing.goalId, expectedRevisionId: existing.expectedRevisionId, definition, milestones: milestoneInputs, state }));
    }
  }

  if (success) return <GoalSheetFrame locale={props.locale} title={t(props.locale, 'Goal saved', 'تم حفظ الهدف')} closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose}>
    <div className="dialog-result" role="status">
      <strong>{t(props.locale, 'Saved', 'تم الحفظ')}</strong>
      <p id={descriptionId}>{props.mode === 'create' ? t(props.locale, 'The goal has been created.', 'تم إنشاء الهدف.') : t(props.locale, 'The goal has been updated.', 'تم تحديث الهدف.')}</p>
      <button type="button" data-autofocus onClick={props.onClose}>{t(props.locale, 'Done', 'تم')}</button>
    </div>
  </GoalSheetFrame>;

  return <GoalSheetFrame locale={props.locale} title={props.mode === 'create' ? t(props.locale, 'New goal', 'هدف جديد') : t(props.locale, 'Edit goal', 'تعديل الهدف')}
    closeLabel={t(props.locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={props.pending}>
    <form aria-label={t(props.locale, 'Goal details', 'تفاصيل الهدف')} onSubmit={submit}>
      <p id={descriptionId} className="dialog-intro">{t(props.locale, 'Reserve saves toward a general amount; purchase tracks a specific thing you plan to buy.', 'يوفر الحجز لمبلغ عام؛ يتتبع الشراء شيئًا معينًا تخطط لشرائه.')}</p>

      {props.mode === 'revise' && <div className="error-notice" role="status">
        {t(props.locale, 'The note and monthly base amount aren’t shown here yet — review them before saving, since this replaces the goal’s full definition.', 'لا تُعرض الملاحظة والمبلغ الشهري الأساسي هنا بعد — راجعهما قبل الحفظ، لأن هذا يستبدل تعريف الهدف بالكامل.')}
      </div>}

      <div className="cr-wizard-steps" aria-label={t(props.locale, 'Progress', 'التقدم')}>
        {WIZARD_STEPS.map((candidate, index) => {
          const stateClass = index < stepIndex ? 'done' : index === stepIndex ? 'current' : 'upcoming';
          return (
            <span key={candidate} className={`cr-wizard-step cr-wizard-step--${stateClass}`}>
              <span className="cr-wizard-step-dot" />
              <span className="cr-wizard-step-label">{stepLabel(props.locale, candidate)}</span>
            </span>
          );
        })}
      </div>

      <h3 className="cr-wizard-step-heading">{stepLabel(props.locale, step)}</h3>

      <div key={step} className="cr-wizard-content" role="group" aria-label={stepLabel(props.locale, step)}>
        {step === 'type' && <>
          <fieldset className="cr-choice" disabled={props.mode === 'revise'}>
            <legend>{t(props.locale, 'Kind', 'النوع')}</legend>
            <label><input type="radio" name="goal-kind" checked={kind === 'reserve'} onChange={() => setKind('reserve')} />{t(props.locale, 'Reserve', 'احتياطي')}</label>
            <label><input type="radio" name="goal-kind" checked={kind === 'purchase'} onChange={() => setKind('purchase')} />{t(props.locale, 'Purchase', 'شراء')}</label>
          </fieldset>
          <fieldset className="cr-choice" disabled={props.mode === 'revise'}>
            <legend>{t(props.locale, 'Currency', 'العملة')}</legend>
            <label><input type="radio" name="goal-currency" checked={currency === 'USD'} onChange={() => { setCurrency('USD'); setMonthlySource('custom'); setError(null); }} />USD</label>
            <label><input type="radio" name="goal-currency" checked={currency === 'LBP'} onChange={() => { setCurrency('LBP'); setMonthlySource('custom'); setError(null); }} />LBP</label>
          </fieldset>
          {props.mode === 'revise' && <fieldset className="cr-choice">
            <legend>{t(props.locale, 'State', 'الحالة')}</legend>
            <label><input type="radio" name="goal-state" checked={state === 'active'} onChange={() => setState('active')} />{t(props.locale, 'Active', 'نشط')}</label>
            <label><input type="radio" name="goal-state" checked={state === 'paused'} onChange={() => setState('paused')} />{t(props.locale, 'Paused', 'موقوف مؤقتًا')}</label>
            <label><input type="radio" name="goal-state" checked={state === 'closed'} onChange={() => setState('closed')} />{t(props.locale, 'Closed', 'مغلق')}</label>
          </fieldset>}
        </>}

        {step === 'target' && <>
          <div className="form-grid">
            <label className="full-field">{t(props.locale, 'Name (English)', 'الاسم (إنجليزي)')}
              <input data-autofocus type="text" placeholder={t(props.locale, 'e.g. Emergency fund', 'مثال: صندوق الطوارئ')} value={nameEn} onChange={(event) => { setNameEn(event.target.value); setError(null); }} /></label>
            <label className="full-field">{t(props.locale, 'Name (Arabic)', 'الاسم (عربي)')}
              <input type="text" placeholder={t(props.locale, 'مثال: صندوق الطوارئ', 'مثال: صندوق الطوارئ')} value={nameAr} onChange={(event) => { setNameAr(event.target.value); setError(null); }} /></label>
            <label className="full-field">{t(props.locale, 'Note', 'ملاحظة')}
              <textarea placeholder={t(props.locale, 'Optional', 'اختياري')} value={note} onChange={(event) => setNote(event.target.value)} /></label>
            <label className="full-field">{t(props.locale, 'Target amount', 'مبلغ الهدف')}
              <input type="text" inputMode="decimal" placeholder={currency === 'USD' ? '0.00' : '0'} value={targetMajor} onChange={(event) => { setTargetMajor(event.target.value); setError(null); }} /></label>
            <label className="full-field">{t(props.locale, 'Priority (0 = highest)', 'الأولوية (0 = الأعلى)')}
              <input type="number" min={0} max={999} placeholder="0" value={priorityText} onChange={(event) => { setPriorityText(event.target.value); setError(null); }} /></label>
          </div>
          {preview && <p className="goal-label-muted">{t(props.locale, 'Reviewable target', 'الهدف القابل للمراجعة')}: <bdi>{formatMinorAmount(preview.targetMinor, currency, props.locale)}</bdi></p>}
        </>}

        {step === 'contributions' && <>
          <fieldset className="cr-choice">
            <legend>{t(props.locale, 'Contribution mode', 'وضع المساهمة')}</legend>
            <label><input type="radio" name="goal-contribution-mode" checked={contributionMode === 'manual_monthly'} onChange={() => setContributionMode('manual_monthly')} />{t(props.locale, 'Manual monthly amount', 'مبلغ شهري يدوي')}</label>
            <label><input type="radio" name="goal-contribution-mode" checked={contributionMode === 'by_deadline'} onChange={() => setContributionMode('by_deadline')} />{t(props.locale, 'By deadline', 'حسب موعد نهائي')}</label>
          </fieldset>
          {contributionMode === 'manual_monthly' && <fieldset className="cr-choice">
            <legend>{t(props.locale, 'Monthly amount source', 'مصدر المبلغ الشهري')}</legend>
            <label><input type="radio" name="goal-monthly-source" checked={monthlySource === 'custom'} onChange={() => { setMonthlySource('custom'); setError(null); }} />{t(props.locale, 'Custom amount', 'مبلغ مخصص')}</label>
            <label><input type="radio" name="goal-monthly-source" checked={monthlySource === 'planned'} disabled={plannedIncomeMinor === null}
              aria-describedby={plannedIncomeMinor === null ? plannedUnavailableHintId : undefined}
              onChange={() => { setMonthlySource('planned'); setError(null); }} />{t(props.locale, 'Planned income', 'الدخل المخطط')}</label>
            {plannedIncomeMinor === null && <p id={plannedUnavailableHintId} className="field-note">
              {t(props.locale, `Set planned income for ${currency} in the Plan section first.`, `حدد الدخل المخطط لعملة ${currency} في قسم الخطة أولًا.`)}
            </p>}
          </fieldset>}
          {contributionMode === 'manual_monthly'
            ? plannedIncomeLinked
              ? <><label className="full-field">{t(props.locale, 'Monthly amount', 'المبلغ الشهري')}
                <output className="goal-metric-value" aria-describedby={plannedHintId}><bdi>{formatMinorAmount(plannedIncomeMinor, currency, props.locale)}</bdi></output></label>
              <p id={plannedHintId} className="field-note">{t(props.locale, 'Linked from the monthly plan’s planned income.', 'مرتبط بالدخل المخطط في الخطة الشهرية.')}</p></>
              : <label className="full-field">{t(props.locale, 'Monthly amount', 'المبلغ الشهري')}
                <input type="text" inputMode="decimal" placeholder={currency === 'USD' ? '0.00' : '0'} value={monthlyMajor} onChange={(event) => { setMonthlyMajor(event.target.value); setError(null); }} /></label>
            : <label className="full-field">{t(props.locale, 'Deadline', 'الموعد النهائي')}
              <input type="date" value={deadline} onChange={(event) => { setDeadline(event.target.value); setError(null); }} /></label>}
        </>}

        {step === 'milestones' && <>
          {milestones.map((row, index) => <div key={row.id} className="goal-milestone-editor-row">
            <div className="goal-row">
              <label><input type="radio" name={`goal-milestone-kind-${row.id}`} checked={row.kind === 'amount'} onChange={() => updateMilestone(row.id, { kind: 'amount' })} />{t(props.locale, 'Amount', 'مبلغ')}</label>
              <label><input type="radio" name={`goal-milestone-kind-${row.id}`} checked={row.kind === 'checklist'} onChange={() => updateMilestone(row.id, { kind: 'checklist', thresholdMajor: '' })} />{t(props.locale, 'Checklist', 'قائمة تحقق')}</label>
              <button type="button" className="text-button" onClick={() => removeMilestone(row.id)}>{t(props.locale, 'Remove', 'إزالة')}</button>
            </div>
            <div className="form-grid">
              <label>{t(props.locale, 'Milestone name (English)', 'اسم المعلم (إنجليزي)')}
                <input type="text" placeholder={t(props.locale, 'e.g. Halfway there', 'مثال: منتصف الطريق')} value={row.labelEn} onChange={(event) => updateMilestone(row.id, { labelEn: event.target.value })} /></label>
              <label>{t(props.locale, 'Milestone name (Arabic)', 'اسم المعلم (عربي)')}
                <input type="text" placeholder={t(props.locale, 'بالعربية', 'بالعربية')} value={row.labelAr} onChange={(event) => updateMilestone(row.id, { labelAr: event.target.value })} /></label>
              {row.kind === 'amount' ? (
                <label className="full-field">{t(props.locale, 'Amount for this milestone', 'مبلغ هذا المعلم')}
                  <input type="text" inputMode="decimal" placeholder={currency === 'USD' ? '0.00' : '0'} value={row.thresholdMajor} onChange={(event) => updateMilestone(row.id, { thresholdMajor: event.target.value })} /></label>
              ) : null}
              <label className="full-field">{t(props.locale, 'Due date (optional)', 'تاريخ الاستحقاق (اختياري)')}
                <input type="date" value={row.dueDate} onChange={(event) => updateMilestone(row.id, { dueDate: event.target.value })} /></label>
            </div>
            {index > 0 && <span className="goal-label-muted">{t(props.locale, 'Order', 'الترتيب')}: {index + 1}</span>}
          </div>)}
          <div className="goal-row">
            <button type="button" className="cr-button" disabled={!canAddMilestone} onClick={() => addMilestone('amount')}>{t(props.locale, 'Add amount milestone', 'إضافة معلم مبلغ')}</button>
            <button type="button" className="cr-button" disabled={!canAddMilestone} onClick={() => addMilestone('checklist')}>{t(props.locale, 'Add checklist milestone', 'إضافة معلم قائمة تحقق')}</button>
          </div>
        </>}

        {step === 'review' && <div className="cr-wizard-review">
          <div className="cr-wizard-review-row">
            <span>{t(props.locale, 'Kind', 'النوع')}</span>
            <span>{kindLabel(props.locale, kind)}</span>
          </div>
          <div className="cr-wizard-review-row">
            <span>{t(props.locale, 'Currency', 'العملة')}</span>
            <span>{currency}</span>
          </div>
          <div className="cr-wizard-review-row">
            <span>{t(props.locale, 'Names', 'الأسماء')}</span>
            <span><bdi>{nameEn.trim() || '—'}</bdi>{' · '}<bdi>{nameAr.trim() || '—'}</bdi></span>
          </div>
          <div className="cr-wizard-review-row">
            <span>{t(props.locale, 'Note', 'ملاحظة')}</span>
            <span>{note.trim() ? <bdi>{note.trim()}</bdi> : '—'}</span>
          </div>
          <div className="cr-wizard-review-row">
            <span>{t(props.locale, 'Target amount', 'مبلغ الهدف')}</span>
            <span>{preview ? <bdi>{formatMinorAmount(preview.targetMinor, currency, props.locale)}</bdi> : '—'}</span>
          </div>
          <div className="cr-wizard-review-row">
            <span>{t(props.locale, 'Priority (0 = highest)', 'الأولوية (0 = الأعلى)')}</span>
            <span>{priorityText}</span>
          </div>
          <div className="cr-wizard-review-row">
            <span>{t(props.locale, 'Contribution mode', 'وضع المساهمة')}</span>
            <span>
              {contributionMode === 'manual_monthly'
                ? <><bdi>{t(props.locale, 'Manual monthly amount', 'مبلغ شهري يدوي')}</bdi>{reviewMonthlyMinor ? <> · <bdi>{formatMinorAmount(reviewMonthlyMinor, currency, props.locale)}</bdi></> : null}</>
                : <><bdi>{t(props.locale, 'By deadline', 'حسب موعد نهائي')}</bdi>{deadline ? <> · <bdi>{deadline}</bdi></> : null}</>}
            </span>
          </div>
          <div className="cr-wizard-review-row">
            <span>{t(props.locale, 'Milestones', 'المعالم')}</span>
            <span>{milestones.length}</span>
          </div>
        </div>}
      </div>

      {error && <div className="error-notice" role="alert">
        {error}
        {props.ambiguous && <div><button type="button" className="button-secondary retry-command" onClick={() => void run(props.onRetry)}>{t(props.locale, 'Retry unchanged request', 'إعادة الطلب دون تغيير')}</button></div>}
      </div>}
      <div className="cr-wizard-footer">
        <button type="button" className="text-button" disabled={props.pending} onClick={props.onClose}>{t(props.locale, 'Cancel', 'إلغاء')}</button>
        <div className="cr-wizard-footer-end">
          {stepIndex > 0 && <button type="button" className="button-secondary" onClick={goBack}>{t(props.locale, 'Back', 'رجوع')}</button>}
          {step === 'review'
            ? <button type="submit" className="cr-button cr-button--primary" disabled={props.pending || savingRef.current}>{props.pending || savingRef.current ? t(props.locale, 'Saving…', 'جارٍ الحفظ…') : t(props.locale, 'Save', 'حفظ')}</button>
            : <button type="submit" className="cr-button cr-button--primary">{t(props.locale, 'Next', 'التالي')}</button>}
        </div>
      </div>
    </form>
  </GoalSheetFrame>;
}
