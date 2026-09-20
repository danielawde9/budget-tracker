import { useMemo, useState } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import { allocateIncome, basisPointsToPercentText, percentToBasisPoints } from './money-allocation.js';
import type { AllocationRootMappingInput, AllocationRootTargetInput, AllocationTemplateGroupInput } from './types.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);
const residualId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

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

/** Setup/edit flow: manual or percentage mode, group weights, root mappings,
 * and an integer preview of every allocation before a single confirm submit. */
export function AllocationMonthEditor(props: AllocationMonthEditorProps) {
  const { locale, currency, categories, initial } = props;
  const [mode, setMode] = useState<'manual' | 'percentage'>(initial.groups.length > 0 ? 'percentage' : 'manual');
  const [incomeText, setIncomeText] = useState(initial.incomeMajorText);
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

  const parsedIncome = useMemo(() => {
    try { return { value: parseNonnegativeMajorAmount(incomeText, currency), error: null as string | null }; }
    catch (cause) { return { value: null, error: cause instanceof Error ? cause.message : 'Invalid income.' }; }
  }, [incomeText, currency]);

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

  const totalBps = groups.reduce((sum, group) => {
    try { return sum + percentToBasisPoints(group.percentText || '0'); } catch { return sum; }
  }, 0);

  const canSubmit = !props.pending
    && parsedIncome.value !== null
    && (mode === 'manual' || (preview?.rows !== null && preview?.error === null && groups.every((group) => group.nameEn.trim() || group.nameAr.trim())))
    && overallocatedGroupIds.size === 0;

  const submit = () => {
    if (!canSubmit || parsedIncome.value === null) {
      setFormError(t(locale, 'Review the highlighted fields before confirming.', 'راجع الحقول المميزة قبل التأكيد.'));
      return;
    }
    setFormError(null);
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

  return (
    <form
      className="alloc-editor"
      aria-label={t(locale, 'Allocation setup', 'إعداد التخصيص')}
      onSubmit={(event) => { event.preventDefault(); submit(); }}
    >
      <fieldset className="alloc-fieldset">
        <legend>{t(locale, 'Mode', 'الوضع')}</legend>
        <label className="alloc-radio">
          <input type="radio" name="alloc-mode" checked={mode === 'manual'} onChange={() => setMonthMode('manual')} />
          {t(locale, 'Manual (targets only)', 'يدوي (أهداف فقط)')}
        </label>
        <label className="alloc-radio">
          <input type="radio" name="alloc-mode" checked={mode === 'percentage'} onChange={() => setMonthMode('percentage')} />
          {t(locale, 'Percentage groups', 'مجموعات بالنسبة المئوية')}
        </label>
      </fieldset>

      <label className="alloc-field">
        {t(locale, 'Planned income', 'الدخل المخطط')}
        <input
          type="text" inputMode="decimal" value={incomeText}
          aria-invalid={parsedIncome.error ? true : undefined}
          onChange={(event) => setIncomeText(event.target.value)}
        />
      </label>
      {parsedIncome.error ? <p className="alloc-danger-text" role="alert">{parsedIncome.error}</p> : null}

      {mode === 'percentage' ? (
        <fieldset className="alloc-fieldset">
          <legend>{t(locale, 'Groups', 'المجموعات')}</legend>
          {groups.map((group) => (
            <div key={group.id} className="alloc-group-row">
              <fieldset className="segmented alloc-purpose">
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
                type="text" aria-label={t(locale, 'Group name', 'اسم المجموعة')}
                value={locale === 'ar' ? group.nameAr : group.nameEn}
                onChange={(event) => updateGroup(group.id, locale === 'ar' ? { nameAr: event.target.value } : { nameEn: event.target.value })}
              />
              <input
                type="text" inputMode="decimal" aria-label={t(locale, 'Percent', 'النسبة')}
                value={group.percentText}
                onChange={(event) => updateGroup(group.id, { percentText: event.target.value })}
              />
              <span className="alloc-label-muted">
                {groupTargetById.has(group.id) ? formatMinorAmount(groupTargetById.get(group.id)!, currency, locale) : ''}
              </span>
              {overallocatedGroupIds.has(group.id) ? (
                <span className="alloc-danger-text" role="alert">
                  {t(locale, 'Assigned category targets exceed this group.', 'أهداف الفئات المخصصة تتجاوز هذه المجموعة.')}
                </span>
              ) : null}
              <button type="button" className="cr-button" onClick={() => removeGroup(group.id)}>
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
        </fieldset>
      ) : null}

      <fieldset className="alloc-fieldset">
        <legend>{t(locale, 'Categories', 'الفئات')}</legend>
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
                type="text" inputMode="decimal"
                aria-label={t(locale, `${categoryName(category, locale)} target`, `هدف ${categoryName(category, locale)}`)}
                value={draft.amountMajorText}
                onChange={(event) => setRootTargets((current) => ({ ...current, [category.id]: { ...draft, amountMajorText: event.target.value } }))}
              />
            </div>
          );
        })}
      </fieldset>

      {formError ? <p className="alloc-danger-text" role="alert">{formError}</p> : null}
      {props.error ? <p className="alloc-danger-text" role="alert">{props.error}</p> : null}

      <div className="alloc-row">
        <button type="button" className="cr-button" onClick={props.onCancel} disabled={props.pending}>
          {t(locale, 'Cancel', 'إلغاء')}
        </button>
        <button type="submit" className="cr-button" disabled={!canSubmit}>
          {props.pending ? t(locale, 'Saving…', 'جارٍ الحفظ…') : t(locale, 'Confirm', 'تأكيد')}
        </button>
      </div>
    </form>
  );
}
