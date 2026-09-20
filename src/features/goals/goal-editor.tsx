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
  const existing = props.existing;
  const [kind, setKind] = useState<GoalKind>(existing?.definition.kind ?? 'reserve');
  const [currency, setCurrency] = useState<Currency>(existing?.definition.currency ?? 'USD');
  const [nameEn, setNameEn] = useState(existing?.definition.nameEn ?? '');
  const [nameAr, setNameAr] = useState(existing?.definition.nameAr ?? '');
  const [note, setNote] = useState(existing?.definition.note ?? '');
  const [targetMajor, setTargetMajor] = useState(existing ? (BigInt(existing.definition.targetMinor) / 100n).toString() : '');
  const [contributionMode, setContributionMode] = useState<GoalContributionMode>(existing?.definition.contributionMode ?? 'manual_monthly');
  const [deadline, setDeadline] = useState(existing?.definition.deadline ?? '');
  const [monthlyMajor, setMonthlyMajor] = useState(existing?.definition.monthlyAmountMinor ? (BigInt(existing.definition.monthlyAmountMinor) / 100n).toString() : '');
  const [priorityText, setPriorityText] = useState(String(existing?.definition.priority ?? 0));
  const [state, setState] = useState<GoalState>(props.initialState ?? existing?.currentState ?? 'active');
  const [milestones, setMilestones] = useState<MilestoneDraft[]>(() => (existing?.milestones ?? []).map(draftFromMilestone));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const canAddMilestone = milestones.length < MAX_MILESTONES;

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

  async function run(action: () => Promise<CommandOutcome>) {
    setError(null);
    try {
      const outcome = await action();
      if (outcome.status === 'success' || outcome.status === 'refresh-required') setSuccess(true);
      else if (outcome.status !== 'ambiguous') setError(t(props.locale, 'The result is still unknown. Retry only with this unchanged request.', 'ما زالت النتيجة غير معروفة. أعد المحاولة بهذا الطلب نفسه فقط.'));
    } catch (cause) {
      const view = localizeGoalsError(classifyGoalsError(cause), props.locale);
      setError(`${view.message} ${view.recovery}`);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!nameEn.trim() && !nameAr.trim()) {
      setError(t(props.locale, 'Enter a name in at least one language.', 'أدخل اسمًا بلغة واحدة على الأقل.'));
      return;
    }
    let targetMinor: string;
    try {
      targetMinor = parsePositiveMinorAmount(targetMajor, currency);
    } catch {
      setError(t(props.locale, 'Enter a valid positive target amount.', 'أدخل مبلغ هدف موجب صالح.'));
      return;
    }
    if (contributionMode === 'by_deadline' && !deadline) {
      setError(t(props.locale, 'Choose a deadline for a by-deadline goal.', 'اختر موعدًا نهائيًا لهدف بموعد نهائي.'));
      return;
    }
    let monthlyAmountMinor: string | null = null;
    if (contributionMode === 'manual_monthly') {
      try {
        monthlyAmountMinor = monthlyMajor.trim() ? parsePositiveMinorAmount(monthlyMajor, currency) : '0';
      } catch {
        setError(t(props.locale, 'Enter a valid monthly amount.', 'أدخل مبلغًا شهريًا صالحًا.'));
        return;
      }
    }
    const priority = Number(priorityText);
    if (!Number.isInteger(priority) || priority < 0 || priority > 999) {
      setError(t(props.locale, 'Priority must be a whole number from 0 to 999.', 'يجب أن تكون الأولوية رقمًا صحيحًا من 0 إلى 999.'));
      return;
    }

    const milestoneInputs: GoalMilestoneInput[] = [];
    for (const [index, row] of milestones.entries()) {
      if (!row.labelEn.trim() && !row.labelAr.trim()) {
        setError(t(props.locale, 'Every milestone needs a label in at least one language.', 'يحتاج كل معلم إلى تسمية بلغة واحدة على الأقل.'));
        return;
      }
      let thresholdMinor: string | null = null;
      if (row.kind === 'amount') {
        try {
          thresholdMinor = parsePositiveMinorAmount(row.thresholdMajor, currency);
        } catch {
          setError(t(props.locale, 'Every amount milestone needs a valid positive threshold.', 'يحتاج كل معلم مبلغ إلى حد أدنى موجب صالح.'));
          return;
        }
      }
      milestoneInputs.push({
        id: row.id, kind: row.kind, labelEn: row.labelEn.trim() || null, labelAr: row.labelAr.trim() || null,
        thresholdMinor, dueDate: row.dueDate || null, ordinal: index,
      });
    }

    const definition: GoalDefinitionInput = {
      kind, currency, nameEn: nameEn.trim() || null, nameAr: nameAr.trim() || null, note: note.trim() || null,
      targetMinor, deadline: contributionMode === 'by_deadline' ? deadline : null, contributionMode,
      monthlyAmountMinor, priority,
    };

    if (props.mode === 'create') {
      void run(() => props.onCreate({ goalId: globalThis.crypto.randomUUID(), definition, milestones: milestoneInputs }));
    } else if (existing) {
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

      {props.mode === 'revise' && <fieldset>
        <legend>{t(props.locale, 'State', 'الحالة')}</legend>
        <label><input type="radio" name="goal-state" checked={state === 'active'} onChange={() => setState('active')} />{t(props.locale, 'Active', 'نشط')}</label>
        <label><input type="radio" name="goal-state" checked={state === 'paused'} onChange={() => setState('paused')} />{t(props.locale, 'Paused', 'موقوف مؤقتًا')}</label>
        <label><input type="radio" name="goal-state" checked={state === 'closed'} onChange={() => setState('closed')} />{t(props.locale, 'Closed', 'مغلق')}</label>
      </fieldset>}

      <fieldset className="goal-editor-mode" disabled={props.mode === 'revise'}>
        <legend>{t(props.locale, 'Kind', 'النوع')}</legend>
        <label><input type="radio" name="goal-kind" checked={kind === 'reserve'} onChange={() => setKind('reserve')} />{t(props.locale, 'Reserve', 'احتياطي')}</label>
        <label><input type="radio" name="goal-kind" checked={kind === 'purchase'} onChange={() => setKind('purchase')} />{t(props.locale, 'Purchase', 'شراء')}</label>
      </fieldset>

      <fieldset className="goal-editor-mode" disabled={props.mode === 'revise'}>
        <legend>{t(props.locale, 'Currency', 'العملة')}</legend>
        <label><input type="radio" name="goal-currency" checked={currency === 'USD'} onChange={() => setCurrency('USD')} />USD</label>
        <label><input type="radio" name="goal-currency" checked={currency === 'LBP'} onChange={() => setCurrency('LBP')} />LBP</label>
      </fieldset>

      <div className="form-grid">
        <label className="full-field">{t(props.locale, 'Name (English)', 'الاسم (إنجليزي)')}
          <input data-autofocus type="text" value={nameEn} onChange={(event) => { setNameEn(event.target.value); setError(null); }} /></label>
        <label className="full-field">{t(props.locale, 'Name (Arabic)', 'الاسم (عربي)')}
          <input type="text" value={nameAr} onChange={(event) => { setNameAr(event.target.value); setError(null); }} /></label>
      </div>
      <label className="full-field">{t(props.locale, 'Note', 'ملاحظة')}
        <textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <label className="full-field">{t(props.locale, 'Target amount', 'مبلغ الهدف')}
        <input type="text" inputMode="decimal" value={targetMajor} onChange={(event) => { setTargetMajor(event.target.value); setError(null); }} /></label>

      <fieldset>
        <legend>{t(props.locale, 'Contribution', 'المساهمة')}</legend>
        <label><input type="radio" name="goal-contribution-mode" checked={contributionMode === 'manual_monthly'} onChange={() => setContributionMode('manual_monthly')} />{t(props.locale, 'Manual monthly amount', 'مبلغ شهري يدوي')}</label>
        <label><input type="radio" name="goal-contribution-mode" checked={contributionMode === 'by_deadline'} onChange={() => setContributionMode('by_deadline')} />{t(props.locale, 'By deadline', 'حسب موعد نهائي')}</label>
      </fieldset>
      {contributionMode === 'manual_monthly'
        ? <label className="full-field">{t(props.locale, 'Monthly amount', 'المبلغ الشهري')}
          <input type="text" inputMode="decimal" value={monthlyMajor} onChange={(event) => { setMonthlyMajor(event.target.value); setError(null); }} /></label>
        : <label className="full-field">{t(props.locale, 'Deadline', 'الموعد النهائي')}
          <input type="date" value={deadline} onChange={(event) => { setDeadline(event.target.value); setError(null); }} /></label>}
      <label className="full-field">{t(props.locale, 'Priority (0 = highest)', 'الأولوية (0 = الأعلى)')}
        <input type="number" min={0} max={999} value={priorityText} onChange={(event) => { setPriorityText(event.target.value); setError(null); }} /></label>

      <fieldset className="goal-milestone-editor">
        <legend>{t(props.locale, 'Milestones', 'المعالم')}</legend>
        {milestones.map((row, index) => <div key={row.id} className="goal-milestone-editor-row">
          <div className="goal-row">
            <label><input type="radio" name={`goal-milestone-kind-${row.id}`} checked={row.kind === 'amount'} onChange={() => updateMilestone(row.id, { kind: 'amount' })} />{t(props.locale, 'Amount', 'مبلغ')}</label>
            <label><input type="radio" name={`goal-milestone-kind-${row.id}`} checked={row.kind === 'checklist'} onChange={() => updateMilestone(row.id, { kind: 'checklist', thresholdMajor: '' })} />{t(props.locale, 'Checklist', 'قائمة تحقق')}</label>
            <button type="button" className="cr-button" onClick={() => removeMilestone(row.id)}>{t(props.locale, 'Remove', 'إزالة')}</button>
          </div>
          <div className="form-grid">
            <label>{t(props.locale, 'Milestone name (English)', 'اسم المعلم (إنجليزي)')}
              <input type="text" value={row.labelEn} onChange={(event) => updateMilestone(row.id, { labelEn: event.target.value })} /></label>
            <label>{t(props.locale, 'Milestone name (Arabic)', 'اسم المعلم (عربي)')}
              <input type="text" value={row.labelAr} onChange={(event) => updateMilestone(row.id, { labelAr: event.target.value })} /></label>
          </div>
          {row.kind === 'amount' ? (
            <label className="full-field">{t(props.locale, 'Amount for this milestone', 'مبلغ هذا المعلم')}
              <input type="text" inputMode="decimal" value={row.thresholdMajor} onChange={(event) => updateMilestone(row.id, { thresholdMajor: event.target.value })} /></label>
          ) : null}
          <label className="full-field">{t(props.locale, 'Due date (optional)', 'تاريخ الاستحقاق (اختياري)')}
            <input type="date" value={row.dueDate} onChange={(event) => updateMilestone(row.id, { dueDate: event.target.value })} /></label>
          {index > 0 && <span className="goal-label-muted">{t(props.locale, 'Order', 'الترتيب')}: {index + 1}</span>}
        </div>)}
        <div className="goal-row">
          <button type="button" className="cr-button" disabled={!canAddMilestone} onClick={() => addMilestone('amount')}>{t(props.locale, 'Add amount milestone', 'إضافة معلم مبلغ')}</button>
          <button type="button" className="cr-button" disabled={!canAddMilestone} onClick={() => addMilestone('checklist')}>{t(props.locale, 'Add checklist milestone', 'إضافة معلم قائمة تحقق')}</button>
        </div>
      </fieldset>

      {preview && <p className="goal-label-muted">{t(props.locale, 'Reviewable target', 'الهدف القابل للمراجعة')}: <bdi>{formatMinorAmount(preview.targetMinor, currency, props.locale)}</bdi></p>}
      {error && <div className="error-notice" role="alert">
        {error}
        {props.ambiguous && <div><button type="button" className="button-secondary retry-command" onClick={() => void run(props.onRetry)}>{t(props.locale, 'Retry unchanged request', 'إعادة الطلب دون تغيير')}</button></div>}
      </div>}
      <div className="dialog-actions">
        <button type="button" className="button-secondary" disabled={props.pending} onClick={props.onClose}>{t(props.locale, 'Cancel', 'إلغاء')}</button>
        <button type="submit" disabled={props.pending}>{props.pending ? t(props.locale, 'Saving…', 'جارٍ الحفظ…') : t(props.locale, 'Save', 'حفظ')}</button>
      </div>
    </form>
  </GoalSheetFrame>;
}
