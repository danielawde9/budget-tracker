import { useState } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { AllocationMonthEditor, type AllocationMonthEditorInitial, type CategoryOption } from './allocation-month-editor.js';
import { AllocationOverview } from './allocation-overview.js';
import { basisPointsToPercentText } from './money-allocation.js';
import type { AllocationCategoryRow, AllocationGateway, AllocationGroupRow, PublishMonthResult, SaveTemplateResult } from './types.js';
import type { useAllocation } from './use-allocation.js';
import { AllocationSkeleton } from '../control-room/skeletons.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

export interface AllocationSetupProps {
  locale: Locale;
  currency: Currency;
  month: string;
  categories: readonly CategoryOption[];
  categoryTargets?: ReadonlyMap<string, { amountMinor: string; revisionId: string | null }> | undefined;
  allocation: ReturnType<typeof useAllocation>;
  gateway: AllocationGateway;
}

function minorToMajorText(amountMinor: string, currency: Currency): string {
  if (currency === 'LBP') return amountMinor;
  const negative = amountMinor.startsWith('-');
  const digits = negative ? amountMinor.slice(1) : amountMinor;
  const padded = digits.padStart(3, '0');
  const whole = padded.slice(0, -2).replace(/^0+(?=\d)/, '');
  const fraction = padded.slice(-2);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function buildInitialDraft(
  currency: Currency,
  groups: readonly AllocationGroupRow[],
  categories: readonly CategoryOption[],
  categoryPage: readonly AllocationCategoryRow[] | null,
  categoryTargets: ReadonlyMap<string, { amountMinor: string; revisionId: string | null }> | undefined,
  plannedIncomeMinor: string | null,
  loanGroupId: string | null,
): AllocationMonthEditorInitial {
  const realGroups = groups.filter((row) => row.groupId !== null && (row.rowKind === 'spending' || row.rowKind === 'future'));
  const rootTargets = categories.map((category) => {
    const fromPage = categoryPage?.find((row) => row.rootId === category.id) ?? null;
    const fromPlan = categoryTargets?.get(category.id) ?? null;
    const amountMinor = fromPage?.targetMinor ?? fromPlan?.amountMinor ?? '0';
    return {
      categoryId: category.id,
      groupId: fromPage?.groupId ?? null,
      amountMajorText: minorToMajorText(amountMinor, currency),
      expectedRevisionId: fromPlan?.revisionId ?? null,
    };
  });
  return {
    incomeMajorText: minorToMajorText(plannedIncomeMinor ?? '0', currency),
    groups: realGroups.map((row) => ({
      id: row.groupId!, purpose: row.rowKind as 'spending' | 'future',
      nameEn: row.nameEn ?? '', nameAr: row.nameAr ?? '',
      percentText: row.basisPoints !== null ? basisPointsToPercentText(row.basisPoints) : '0',
    })),
    rootTargets,
    loanGroupId,
  };
}

/** Wires useAllocation's state machine to the read-only overview and the
 * setup/edit form. A single "Confirm" click chains saveTemplate then
 * publishMonth as two explicit steps through the same hook instance, so an
 * ambiguous outcome on either step surfaces through the hook's existing
 * ambiguous/retry machinery without ever double-posting. */
export function AllocationSetup(props: AllocationSetupProps) {
  const { locale, currency, allocation } = props;
  const [editing, setEditing] = useState(false);
  const [drilldown, setDrilldown] = useState<{ row: AllocationGroupRow; rows: readonly AllocationCategoryRow[] } | null>(null);
  const [categoryPage, setCategoryPage] = useState<readonly AllocationCategoryRow[] | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (allocation.status === 'loading') {
    return <AllocationSkeleton locale={locale} />;
  }
  if (allocation.status === 'error') {
    return (
      <div className="cr-card" role="alert">
        <div className="alloc-row">
          <span>{t(locale, 'Could not load the allocation plan.', 'تعذر تحميل خطة التخصيص.')}</span>
          <button type="button" className="cr-button" onClick={() => void allocation.refresh()}>
            {t(locale, 'Retry', 'إعادة المحاولة')}
          </button>
        </div>
        {allocation.error ? <small>{allocation.error.message}</small> : null}
      </div>
    );
  }

  const openEditor = async () => {
    setSubmitError(null);
    if (allocation.month.hasPlan && allocation.month.snapshotId) {
      try {
        const page = await allocation.loadCategoryPage({ snapshotId: allocation.month.snapshotId, groupId: null, afterRootId: null, limit: 100 });
        setCategoryPage(page.rows);
      } catch {
        setCategoryPage(null);
      }
    } else {
      setCategoryPage(null);
    }
    setEditing(true);
  };

  if (editing) {
    const initial = buildInitialDraft(
      currency, allocation.month.groups, props.categories, categoryPage, props.categoryTargets,
      allocation.month.plannedIncomeMinor, allocation.month.groups.find((row) => row.rowKind === 'future')?.groupId ?? null,
    );
    return (
      <AllocationMonthEditor
        locale={locale}
        currency={currency}
        categories={props.categories}
        initial={initial}
        pending={allocation.pending}
        error={submitError ?? (allocation.error?.message ?? null)}
        onCancel={() => setEditing(false)}
        onSubmit={(submission) => {
          void (async () => {
            setSubmitError(null);
            try {
              const templateOutcome = await allocation.saveTemplate({
                currency,
                expectedRevisionId: allocation.month.templateRevisionId,
                groups: submission.groups,
                rootMappings: submission.rootMappings,
              });
              if (templateOutcome.status === 'ambiguous') return;
              const templateResult = templateOutcome.result as SaveTemplateResult;
              const publishOutcome = await allocation.publishMonth({
                templateRevisionId: templateResult.templateRevisionId,
                expectedSnapshotId: allocation.month.snapshotId,
                expectedIncomeRevisionId: allocation.month.incomeRevisionId,
                incomeMinor: submission.incomeMinor,
                rootTargets: submission.rootTargets,
                loanGroupId: submission.loanGroupId,
              });
              void (publishOutcome.result as PublishMonthResult | undefined);
              if (publishOutcome.status === 'ambiguous') return;
              setEditing(false);
            } catch (cause) {
              setSubmitError(cause instanceof Error ? cause.message : t(locale, 'Could not save this plan.', 'تعذر حفظ هذه الخطة.'));
            }
          })();
        }}
      />
    );
  }

  return (
    <>
      <AllocationOverview
        locale={locale}
        currency={currency}
        monthState={allocation.month}
        onEdit={() => void openEditor()}
        onDrilldown={(row) => {
          void (async () => {
            if (!allocation.month.snapshotId) return;
            const page = await allocation.loadCategoryPage({
              snapshotId: allocation.month.snapshotId, groupId: row.groupId, afterRootId: null, limit: 100,
            });
            setDrilldown({ row, rows: page.rows });
          })();
        }}
      />
      {allocation.status === 'accepted-refresh-pending' ? (
        <div className="cr-card" role="alert">
          <span>{t(locale, 'Saved, but refreshing the plan failed — check your connection.', 'تم الحفظ، لكن تعذر تحديث الخطة — تحقق من الاتصال.')}</span>
          <button type="button" className="cr-button" onClick={() => void allocation.refresh()}>
            {t(locale, 'Refresh', 'تحديث')}
          </button>
        </div>
      ) : null}
      {allocation.status === 'ambiguous' ? (
        <div className="cr-card" role="alert">
          <span>{t(locale, 'We could not confirm whether the last save went through.', 'تعذر التأكد مما إذا كان الحفظ الأخير قد تم.')}</span>
          <button type="button" className="cr-button" onClick={() => void allocation.retryAmbiguous()}>
            {t(locale, 'Check again', 'تحقق مرة أخرى')}
          </button>
          <button type="button" className="cr-button" onClick={allocation.clearAmbiguous}>
            {t(locale, 'Dismiss', 'إغلاق')}
          </button>
        </div>
      ) : null}
      {drilldown ? (
        <div className="cr-card" role="dialog" aria-label={t(locale, 'Category detail', 'تفاصيل الفئة')}>
          <div className="alloc-row">
            <h3>{locale === 'ar' ? drilldown.row.nameAr : drilldown.row.nameEn}</h3>
            <button type="button" className="cr-button" onClick={() => setDrilldown(null)}>{t(locale, 'Close', 'إغلاق')}</button>
          </div>
          <ul>
            {drilldown.rows.map((row) => (
              <li key={row.rootId}><bdi>{locale === 'ar' ? row.nameAr : row.nameEn}</bdi></li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
