import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import { allocateIncome, basisPointsToPercentText, minorToMajorText, percentToBasisPoints } from './money-allocation.js';
import type { AllocationRootMappingInput, AllocationRootTargetInput, AllocationTemplateGroupInput } from './types.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);
const residualId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

const STEP_ORDER = ['mode', 'groups', 'categories', 'review'] as const;
type Step = (typeof STEP_ORDER)[number];

function stepLabel(locale: Locale, step: Step): string {
  switch (step) {
    case 'mode': return t(locale, 'Mode', 'الوضع');
    case 'groups': return t(locale, 'Groups', 'المجموعات');
    case 'categories': return t(locale, 'Categories', 'الفئات');
    case 'review': return t(locale, 'Review', 'مراجعة');
  }
}

function stepHeading(locale: Locale, step: Step): string {
  return step === 'mode' ? t(locale, 'Mode and income', 'الوضع والدخل') : stepLabel(locale, step);
}

function groupHasName(group: GroupDraft): boolean {
  return Boolean(group.nameEn.trim() || group.nameAr.trim());
}

function parseNonnegativeMajorAmount(rawValue: string, currency: Currency): string {
  const value = rawValue.replaceAll(',', '').trim();
  const match = (currency === 'USD' ? /^(\d+)(?:\.(\d{1,2}))?$/ : /^(\d+)$/).exec(value);
  if (!match) throw new Error('Enter a valid amount.');
  const whole = (match[1] ?? '').replace(/^0+(?=\d)/, '');
  const fraction = currency === 'USD' ? (match[2] ?? '').padEnd(2, '0') : '';
  const minor = `${whole}${fraction}`.replace(/^0+(?=\d)/, '') || '0';
  if (!/^\d+$/.test(minor) || minor.length > 15) throw new Error('Enter a valid amount.');
  return minor;
}

export interface CategoryOption {
  readonly id: string;
  readonly nameEn: string;
  readonly nameAr: string;
}

export interface GroupDraft {
  readonly id: string;
  readonly purpose: 'spending' | 'future';
  readonly nameEn: string;
  readonly nameAr: string;
  readonly percentText: string;
}

export interface RootTargetDraft {
  readonly categoryId: string;
  readonly groupId: string | null;
  readonly amountMajorText: string;
  readonly expectedRevisionId: string | null;
}

export interface AllocationMonthEditorInitial {
  readonly incomeMajorText: string;
  readonly groups: readonly GroupDraft[];
  readonly rootTargets: readonly RootTargetDraft[];
  readonly loanGroupId: string | null;
}

export interface AllocationMonthEditorSubmission {
  readonly incomeMinor: string;
  readonly groups: readonly AllocationTemplateGroupInput[];
  readonly rootMappings: readonly AllocationRootMappingInput[];
  readonly rootTargets: readonly AllocationRootTargetInput[];
  readonly loanGroupId: string | null;
}

export interface AllocationMonthEditorProps {
  locale: Locale;
  currency: Currency;
  categories: readonly CategoryOption[];
  initial: AllocationMonthEditorInitial;
  /** Latest planned-income revision from the monthly plan (integer-minor), or
   * null when the plan has none for this currency. Rendered as a helper under
   * the income field and offered as a one-click fill when the entered income
   * diverges from it. */
  plannedIncomeMinor: string | null;
  pending: boolean;
  error: string | null;
  onCancel(): void;
  onSubmit(input: AllocationMonthEditorSubmission): void;
}

function categoryName(category: CategoryOption, locale: Locale): string {
  return (locale === 'ar' ? category.nameAr : category.nameEn) || category.nameEn || category.nameAr;
}

function newGroupId(): string {
  // allocateIncome (the live preview helper) validates every group id as a
  // canonical UUID, so a new draft group needs a real one immediately, not a
  // placeholder replaced later.
  return globalThis.crypto.randomUUID();
}

/** Setup/edit flow as a step form: mode and income, percentage groups
 * (skipped entirely in manual mode), category targets, then a review of every
 * saved value before a single confirm submit. Next validates only the current
 * step; the confirm payload is unchanged from the single-screen editor. */
export function AllocationMonthEditor(props: AllocationMonthEditorProps) {
  const { locale, currency, categories, initial } = props;
  const plannedIncomeHintId = useId();
  const [mode, setMode] = useState<'manual' | 'percentage'>(initial.groups.length > 0 ? 'percentage' : 'manual');
  const [incomeText, setIncomeText] = useState(initial.incomeMajorText);
  const [incomeTouched, setIncomeTouched] = useState(false);
  const [groups, setGroups] = useState<GroupDraft[]>([...initial.groups]);
  const [rootTargets, setRootTargets] = useState<Record<string, RootTargetDraft>>(() => {
    const byId: Record<string, RootTargetDraft> = {};
    for (const category of categories) {
      const existing = initial.rootTargets.find((row) => row.categoryId === category.id);
      byId[category.id] = existing ?? { categoryId: category.id, groupId: null, amountMajorText: '0', expectedRevisionId: null };
    }
    return byId;
  });
  const [loanGroupId, setLoanGroupId] = useState<string | null>(initial.loanGroupId);
  const [formError, setFormError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('mode');
  const [stepError, setStepError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  // A confirmed submit hands off to the parent, which drives props.pending;
  // re-arm once that pending cycle ends so a rejected save can be retried.
  useEffect(() => {
    if (!props.pending && submittingRef.current) submittingRef.current = false;
  }, [props.pending]);

  const parsedIncome = useMemo(() => {
    try { return { value: parseNonnegativeMajorAmount(incomeText, currency), error: null as string | null }; }
    catch (cause) { return { value: null, error: cause instanceof Error ? cause.message : 'Invalid income.' }; }
  }, [incomeText, currency]);

  const plannedIncomeMajorText = props.plannedIncomeMinor !== null ? minorToMajorText(props.plannedIncomeMinor, currency) : null;
  // The plan-value shortcut shows only when the entered text parses to a
  // different amount; once it matches (or nothing parseable is entered) it
  // would be a no-op.
  const incomeDiffersFromPlan = props.plannedIncomeMinor !== null
    && parsedIncome.value !== null
    && parsedIncome.value !== props.plannedIncomeMinor;

  const spendingGroups = groups.filter((group) => group.purpose === 'spending');
  const futureGroups = groups.filter((group) => group.purpose === 'future');

  const preview = useMemo(() => {
    if (mode === 'manual' || parsedIncome.value === null) return null;
    try {
      const weights = groups.map((group, index) => ({ id: group.id, order: index, basisPoints: percentToBasisPoints(group.percentText || '0') }));
      return { rows: allocateIncome(parsedIncome.value, weights), error: null as string | null };
    } catch (cause) {
      return { rows: null, error: cause instanceof Error ? cause.message : 'Invalid allocation.' };
    }
  }, [mode, groups, parsedIncome.value]);

  const groupTargetById = useMemo(() => {
    const map = new Map<string, string>();
    if (preview?.rows) for (const row of preview.rows) if (row.id !== residualId) map.set(row.id, row.amountMinor);
    return map;
  }, [preview]);

  const assignedByGroup = useMemo(() => {
    const map = new Map<string, bigint>();
    for (const row of Object.values(rootTargets)) {
      if (!row.groupId) continue;
      let amountMinor: bigint;
      try { amountMinor = BigInt(parseNonnegativeMajorAmount(row.amountMajorText, currency)); } catch { continue; }
      map.set(row.groupId, (map.get(row.groupId) ?? 0n) + amountMinor);
    }
    return map;
  }, [rootTargets, currency]);

  const overallocatedGroupIds = useMemo(() => {
    const overs = new Set<string>();
    for (const group of spendingGroups) {
      const target = groupTargetById.get(group.id);
      const assigned = assignedByGroup.get(group.id) ?? 0n;
      if (target !== undefined && assigned > BigInt(target)) overs.add(group.id);
    }
    return overs;
  }, [spendingGroups, groupTargetById, assignedByGroup]);

  const parseTargetMinor = (draft: RootTargetDraft): string | null => {
    try { return parseNonnegativeMajorAmount(draft.amountMajorText, currency); } catch { return null; }
  };

  const addGroup = () => setGroups((current) => [...current, {
    id: newGroupId(), purpose: 'spending', nameEn: '', nameAr: '', percentText: '0',
  }]);
  const removeGroup = (id: string) => {
    setGroups((current) => current.filter((group) => group.id !== id));
    setRootTargets((current) => {
      const next = { ...current };
      for (const key of Object.keys(next)) if (next[key]!.groupId === id) next[key] = { ...next[key]!, groupId: null };
      return next;
    });
    if (loanGroupId === id) setLoanGroupId(null);
  };
  const updateGroup = (id: string, patch: Partial<GroupDraft>) =>
    setGroups((current) => current.map((group) => (group.id === id ? { ...group, ...patch } : group)));

  const setMonthMode = (next: 'manual' | 'percentage') => {
    if (next === 'manual') {
      setGroups([]);
      setRootTargets((current) => {
        const cleared: Record<string, RootTargetDraft> = {};
        for (const [id, draft] of Object.entries(current)) cleared[id] = { ...draft, groupId: null };
        return cleared;
      });
      setLoanGroupId(null);
    } else if (groups.length === 0) {
      setGroups([{ id: newGroupId(), purpose: 'spending', nameEn: '', nameAr: '', percentText: '0' }]);
    }
    setMode(next);
  };

  const applyPlannedIncome = () => {
    if (plannedIncomeMajorText !== null) setIncomeText(plannedIncomeMajorText);
  };

  const totalBps = groups.reduce((sum, group) => {
    try { return sum + percentToBasisPoints(group.percentText || '0'); } catch { return sum; }
  }, 0);

  const canSubmit = !props.pending
    && parsedIncome.value !== null
    && (mode === 'manual' || (preview?.rows !== null && preview?.error === null && groups.every(groupHasName)))
    && overallocatedGroupIds.size === 0;

  const submit = () => {
    if (submittingRef.current) return;
    if (!canSubmit || parsedIncome.value === null) {
      setFormError(t(locale, 'Review the highlighted fields before confirming.', 'راجع الحقول المميزة قبل التأكيد.'));
      return;
    }
    setFormError(null);
    submittingRef.current = true;
    const rootMappings: AllocationRootMappingInput[] = [];
    const rootTargetInputs: AllocationRootTargetInput[] = [];
    for (const draft of Object.values(rootTargets)) {
      if (draft.groupId) rootMappings.push({ categoryId: draft.categoryId, groupId: draft.groupId });
      let amountMinor: string;
      try { amountMinor = parseNonnegativeMajorAmount(draft.amountMajorText, currency); } catch { amountMinor = '0'; }
      rootTargetInputs.push({ categoryId: draft.categoryId, amountMinor, expectedRevisionId: draft.expectedRevisionId });
    }
    props.onSubmit({
      incomeMinor: parsedIncome.value,
      groups: mode === 'manual' ? [] : groups.map((group, index) => ({
        id: group.id, purpose: group.purpose, nameEn: group.nameEn.trim() || null, nameAr: group.nameAr.trim() || null,
        order: index, basisPoints: percentToBasisPoints(group.percentText || '0'),
      })),
      rootMappings,
      rootTargets: rootTargetInputs,
      loanGroupId: mode === 'manual' ? null : loanGroupId,
    });
  };

  // Conditional steps are skipped (never shown disabled): the groups step is
  // not in the chain at all in manual mode, so Next runs 1 → 3 and Back from
  // Review lands on Categories directly.
  const visibleSteps = useMemo<readonly Step[]>(
    () => (mode === 'percentage' ? STEP_ORDER : STEP_ORDER.filter((candidate) => candidate !== 'groups')),
    [mode],
  );
  const currentStep: Step = step === 'groups' && mode !== 'percentage' ? 'categories' : step;
  const currentIndex = visibleSteps.indexOf(currentStep);
  const nextStep = visibleSteps[currentIndex + 1] ?? null;
  const previousStep = currentIndex > 0 ? visibleSteps[currentIndex - 1]! : null;

  const goNext = () => {
    if (!nextStep) return;
    if (currentStep === 'mode' && parsedIncome.error) {
      setIncomeTouched(true); // the field's own alert explains
      return;
    }
    if (currentStep === 'groups') {
      if (groups.some((group) => !groupHasName(group))) {
        setStepError(t(locale, 'Name each group before continuing.', 'أدخل اسمًا لكل مجموعة قبل المتابعة.'));
        return;
      }
      if (preview?.error) return; // the field's own alert explains
    }
    if (currentStep === 'categories' && categories.some((category) => parseTargetMinor(rootTargets[category.id]!) === null)) {
      setStepError(t(locale, 'Enter a valid amount.', 'أدخل مبلغًا صالحًا.'));
      return;
    }
    setStepError(null);
    setStep(nextStep);
  };

  const goBack = () => {
    if (!previousStep) return;
    setStepError(null);
    setStep(previousStep);
  };

  const heading = stepHeading(locale, currentStep);
  const loanGroup = groups.find((group) => group.id === loanGroupId) ?? null;

  return (
    <form
      className="alloc-editor"
      aria-label={t(locale, 'Allocation setup', 'إعداد التخصيص')}
      onSubmit={(event) => { event.preventDefault(); if (currentStep === 'review') submit(); else goNext(); }}
    >
      <div className="cr-wizard-steps" aria-label={t(locale, 'Progress', 'التقدم')}>
        {visibleSteps.map((candidate, index) => (
          <span
            key={candidate}
            className={`cr-wizard-step${index < currentIndex ? ' cr-wizard-step--done' : index === currentIndex ? ' cr-wizard-step--current' : ''}`}
          >
            <span className="cr-wizard-step-dot" />
            <span>{stepLabel(locale, candidate)}</span>
          </span>
        ))}
      </div>

      <h3 className="cr-wizard-step-heading">{heading}</h3>

      <div key={currentStep} className="cr-wizard-content" role="group" aria-label={heading}>
        {currentStep === 'mode' ? (
          <>
            <fieldset className="cr-choice">
              <legend>{t(locale, 'Mode', 'الوضع')}</legend>
              <label>
                <input type="radio" name="alloc-mode" checked={mode === 'manual'} onChange={() => setMonthMode('manual')} />
                {t(locale, 'Manual (targets only)', 'يدوي (أهداف فقط)')}
              </label>
              <label>
                <input type="radio" name="alloc-mode" checked={mode === 'percentage'} onChange={() => setMonthMode('percentage')} />
                {t(locale, 'Percentage groups', 'مجموعات بالنسبة المئوية')}
              </label>
            </fieldset>

            <label className="alloc-field">
              {t(locale, 'Planned income', 'الدخل المخطط')}
              <input
                type="text" inputMode="decimal" placeholder={currency === 'USD' ? '0.00' : '0'} value={incomeText}
                aria-invalid={incomeTouched && parsedIncome.error ? true : undefined}
                aria-describedby={props.plannedIncomeMinor !== null ? plannedIncomeHintId : undefined}
                onChange={(event) => { setIncomeTouched(true); setIncomeText(event.target.value); }}
              />
            </label>
            {props.plannedIncomeMinor !== null ? (
              <p id={plannedIncomeHintId} className="cr-helper">
                {t(locale,
                  `From the monthly plan: ${formatMinorAmount(props.plannedIncomeMinor, currency, locale)}. Confirming this setup updates it.`,
                  `من الخطة الشهرية: ${formatMinorAmount(props.plannedIncomeMinor, currency, locale)}. تأكيد هذا الإعداد يحدّثه.`)}
              </p>
            ) : null}
            {incomeDiffersFromPlan ? (
              <button type="button" className="text-button" onClick={applyPlannedIncome}>
                {t(locale, 'Use planned income', 'استخدام الدخل المخطط')}
              </button>
            ) : null}
            {incomeTouched && parsedIncome.error ? <p className="alloc-danger-text" role="alert">{parsedIncome.error}</p> : null}
          </>
        ) : null}

        {currentStep === 'groups' ? (
          <>
            {groups.map((group) => (
              <div key={group.id} className="alloc-group-row">
                <fieldset className="cr-choice">
                  <legend>{t(locale, 'Purpose', 'الغرض')}</legend>
                  {(['spending', 'future'] as const).map((option) => (
                    <label key={option}>
                      <input
                        type="radio"
                        name={`alloc-purpose-${group.id}`}
                        checked={group.purpose === option}
                        onChange={() => updateGroup(group.id, { purpose: option })}
                      />
                      {t(locale, option === 'spending' ? 'Spending' : 'Future', option === 'spending' ? 'إنفاق' : 'مستقبلي')}
                    </label>
                  ))}
                </fieldset>
                <input
                  type="text" className="alloc-group-name" aria-label={t(locale, 'Group name', 'اسم المجموعة')}
                  placeholder={t(locale, 'Group name', 'اسم المجموعة')}
                  value={locale === 'ar' ? group.nameAr : group.nameEn}
                  onChange={(event) => updateGroup(group.id, locale === 'ar' ? { nameAr: event.target.value } : { nameEn: event.target.value })}
                />
                <div className="cr-affix">
                  <input
                    type="text" inputMode="decimal" placeholder={t(locale, 'e.g. 25', 'مثال: 25')} aria-label={t(locale, 'Percent', 'النسبة')}
                    value={group.percentText}
                    onChange={(event) => updateGroup(group.id, { percentText: event.target.value })}
                  />
                  <span className="cr-affix-suffix" aria-hidden="true">%</span>
                </div>
                <span className="alloc-label-muted alloc-group-amount">
                  {groupTargetById.has(group.id) ? formatMinorAmount(groupTargetById.get(group.id)!, currency, locale) : ''}
                </span>
                {overallocatedGroupIds.has(group.id) ? (
                  <span className="alloc-danger-text" role="alert">
                    {t(locale, 'Assigned category targets exceed this group.', 'أهداف الفئات المخصصة تتجاوز هذه المجموعة.')}
                  </span>
                ) : null}
                <button type="button" className="text-button alloc-group-remove" onClick={() => removeGroup(group.id)}>
                  {t(locale, 'Remove', 'إزالة')}
                </button>
              </div>
            ))}
            <button type="button" className="cr-button" onClick={addGroup}>
              {t(locale, 'Add group', 'إضافة مجموعة')}
            </button>
            <p className="alloc-label-muted">{t(locale, `Total: ${basisPointsToPercentText(totalBps)}%`, `الإجمالي: ${basisPointsToPercentText(totalBps)}%`)}</p>
            {preview?.error ? <p className="alloc-danger-text" role="alert">{preview.error}</p> : null}
            {preview?.rows ? (
              <p className="alloc-label-muted">
                {t(locale, 'Unallocated', 'غير مخصص')}: {formatMinorAmount(preview.rows.find((row) => row.id === residualId)?.amountMinor ?? '0', currency, locale)}
              </p>
            ) : null}

            {futureGroups.length > 0 ? (
              <label className="alloc-field">
                {t(locale, 'Link debt payments to', 'ربط سداد الديون بـ')}
                <select value={loanGroupId ?? ''} onChange={(event) => setLoanGroupId(event.target.value || null)}>
                  <option value="">{t(locale, 'Standalone (no group)', 'مستقل (بدون مجموعة)')}</option>
                  {futureGroups.map((group) => (
                    <option key={group.id} value={group.id}>{locale === 'ar' ? group.nameAr : group.nameEn}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        ) : null}

        {currentStep === 'categories' ? (
          <>
            {categories.length === 0 ? (
              <p>{t(locale, 'No active expense categories yet.', 'لا توجد فئات مصروفات فعالة بعد.')}</p>
            ) : categories.map((category) => {
              const draft = rootTargets[category.id]!;
              return (
                <div key={category.id} className="alloc-root-row">
                  <span><bdi>{categoryName(category, locale)}</bdi></span>
                  {mode === 'percentage' && spendingGroups.length > 0 ? (
                    <select
                      aria-label={t(locale, `${categoryName(category, locale)} group`, `مجموعة ${categoryName(category, locale)}`)}
                      value={draft.groupId ?? ''}
                      onChange={(event) => setRootTargets((current) => ({ ...current, [category.id]: { ...draft, groupId: event.target.value || null } }))}
                    >
                      <option value="">{t(locale, 'Standalone', 'مستقل')}</option>
                      {spendingGroups.map((group) => (
                        <option key={group.id} value={group.id}>{locale === 'ar' ? group.nameAr : group.nameEn}</option>
                      ))}
                    </select>
                  ) : null}
                  <input
                    type="text" inputMode="decimal" placeholder={currency === 'USD' ? '0.00' : '0'}
                    aria-label={t(locale, `${categoryName(category, locale)} target`, `هدف ${categoryName(category, locale)}`)}
                    aria-invalid={parseTargetMinor(draft) === null ? true : undefined}
                    value={draft.amountMajorText}
                    onChange={(event) => setRootTargets((current) => ({ ...current, [category.id]: { ...draft, amountMajorText: event.target.value } }))}
                  />
                </div>
              );
            })}
          </>
        ) : null}

        {currentStep === 'review' ? (
          <div className="cr-wizard-review">
            <div className="cr-wizard-review-row">
              <span>{t(locale, 'Mode', 'الوضع')}</span>
              <span>{mode === 'percentage' ? t(locale, 'Percentage groups', 'مجموعات بالنسبة المئوية') : t(locale, 'Manual (targets only)', 'يدوي (أهداف فقط)')}</span>
            </div>
            <div className="cr-wizard-review-row">
              <span>{t(locale, 'Planned income', 'الدخل المخطط')}</span>
              <span>{parsedIncome.value !== null ? formatMinorAmount(parsedIncome.value, currency, locale) : incomeText}</span>
            </div>
            {mode === 'percentage' ? groups.map((group) => (
              <div className="cr-wizard-review-row" key={group.id}>
                <span>
                  {t(locale, group.purpose === 'spending' ? 'Spending' : 'Future', group.purpose === 'spending' ? 'إنفاق' : 'مستقبلي')}
                  {' · '}<bdi>{locale === 'ar' ? group.nameAr : group.nameEn}</bdi>{' · '}{group.percentText || '0'}%
                </span>
                <span>{groupTargetById.has(group.id) ? formatMinorAmount(groupTargetById.get(group.id)!, currency, locale) : ''}</span>
              </div>
            )) : null}
            {mode === 'percentage' && futureGroups.length > 0 ? (
              <div className="cr-wizard-review-row">
                <span>{t(locale, 'Link debt payments to', 'ربط سداد الديون بـ')}</span>
                <span>{loanGroup ? <bdi>{locale === 'ar' ? loanGroup.nameAr : loanGroup.nameEn}</bdi> : t(locale, 'Standalone (no group)', 'مستقل (بدون مجموعة)')}</span>
              </div>
            ) : null}
            {categories.map((category) => {
              const draft = rootTargets[category.id]!;
              const minor = parseTargetMinor(draft);
              return (
                <div className="cr-wizard-review-row" key={category.id}>
                  <span>{t(locale, `${categoryName(category, locale)} target`, `هدف ${categoryName(category, locale)}`)}</span>
                  <span>{minor !== null ? formatMinorAmount(minor, currency, locale) : <bdi>{draft.amountMajorText}</bdi>}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {currentStep === 'review'
        ? spendingGroups.filter((group) => overallocatedGroupIds.has(group.id)).map((group) => (
            <p key={group.id} className="alloc-danger-text" role="alert">
              <bdi>{locale === 'ar' ? group.nameAr : group.nameEn}</bdi>
              {': '}
              {t(locale, 'Assigned category targets exceed this group.', 'أهداف الفئات المخصصة تتجاوز هذه المجموعة.')}
            </p>
          ))
        : null}
      {stepError ? <p className="alloc-danger-text" role="alert">{stepError}</p> : null}
      {formError ? <p className="alloc-danger-text" role="alert">{formError}</p> : null}
      {props.error ? <p className="alloc-danger-text" role="alert">{props.error}</p> : null}

      <div className="cr-wizard-footer">
        <div className="alloc-wizard-footer-start">
          <button type="button" className="text-button" onClick={props.onCancel} disabled={props.pending}>
            {t(locale, 'Cancel', 'إلغاء')}
          </button>
          {previousStep !== null ? (
            <button type="button" className="cr-button button-secondary" onClick={goBack}>
              {t(locale, 'Back', 'رجوع')}
            </button>
          ) : null}
        </div>
        <div className="cr-wizard-footer-end">
          {currentStep === 'review' ? (
            <button type="submit" className="cr-button cr-button--primary" disabled={!canSubmit}>
              {props.pending ? t(locale, 'Saving…', 'جارٍ الحفظ…') : t(locale, 'Confirm', 'تأكيد')}
            </button>
          ) : (
            // A real submit button so Enter in any field triggers the same
            // onSubmit path as a click (the handler advances the step).
            <button type="submit" className="cr-button cr-button--primary">
              {t(locale, 'Next', 'التالي')}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
