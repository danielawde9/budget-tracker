import { Fragment, useState } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import { chartPercent } from './chart-ratio.js';
import type { AvailableCashGroupRow } from './types.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

export interface GroupCommitmentRatio {
  /** False for a Future-purpose group (no per-bill budget line applies) and
   * for a spending group with a zero remaining budget line. The DTO carries
   * no `hasPlan`-equivalent flag (unlike goals'/allocation's own group
   * rows), so a zero `budgetRemainingMinor` can mean either "no target was
   * ever set" or "the target is fully spent" -- this UI cannot honestly
   * tell those apart and does not guess; see `commitment-breakdown.test.ts`
   * and `decisions.md`. */
  readonly hasScale: boolean;
  readonly percent: number;
  readonly over: boolean;
  /** Non-null exactly when `over` is true. Computed from the original
   * `BigInt` budgetRemaining/unpaidBills values, never the clamped
   * `chartPercent` coordinate. */
  readonly overageMinor: string | null;
}

/** Budget-remaining-vs-unpaid-bills ratio for one spending group's row bar.
 * Only used by `CommitmentBreakdown` today; kept as its own exported
 * function (rather than inlined) so a future second call site reuses this
 * exact computation instead of duplicating it, matching this feature area's
 * own `settlement-progress.ts` precedent (task 16). */
export function groupCommitmentRatio(group: AvailableCashGroupRow): GroupCommitmentRatio {
  if (group.unpaidBillsMinor === null) return { hasScale: false, percent: 0, over: false, overageMinor: null };
  const budgetRemaining = BigInt(group.budgetRemainingMinor);
  const unpaidBills = BigInt(group.unpaidBillsMinor);
  const hasScale = budgetRemaining > 0n;
  const percent = hasScale ? chartPercent(group.unpaidBillsMinor, group.budgetRemainingMinor) : 0;
  const over = hasScale && unpaidBills > budgetRemaining;
  const overageMinor = over ? (unpaidBills - budgetRemaining).toString() : null;
  return { hasScale, percent, over, overageMinor };
}

interface CommitmentBreakdownProps {
  locale: Locale;
  currency: Currency;
  groups: readonly AvailableCashGroupRow[];
}

/** Every reservation component (`budgetRemainingMinor`/`unpaidBillsMinor`/
 * `goalOverlapMinor`/`commitmentMinor`) for each group as one accessible
 * table with a per-row bar, plus a labelled "Details" drilldown per row that
 * expands a plain-language explanation of the same numbers -- this is the
 * "inspect every reservation component" flow from the brief's Task 1. There
 * is no per-bill/per-goal id in this DTO (only a group aggregate), so this
 * drilldown stays in-page rather than opening a bill/goal editor; see
 * `docs/decisions.md` for why that boundary is honest rather than a gap. */
export function CommitmentBreakdown({ locale, currency, groups }: CommitmentBreakdownProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (groups.length === 0) {
    return <p className="cc-label-muted">{t(locale, 'No reservation components to show yet.', 'لا توجد عناصر حجز لعرضها بعد.')}</p>;
  }

  return (
    <div className="cc-breakdown">
      <table className="cc-breakdown-table">
        <caption className="cc-visually-hidden">
          {t(locale, 'Reservations by group: budget, unpaid bills, goal overlap and net commitment', 'الحجوزات حسب المجموعة: الميزانية، الفواتير غير المدفوعة، تداخل الهدف والصافي المحجوز')}
        </caption>
        <thead><tr>
          <th scope="col">{t(locale, 'Group', 'المجموعة')}</th>
          <th scope="col">{t(locale, 'Budget remaining', 'الميزانية المتبقية')}</th>
          <th scope="col">{t(locale, 'Unpaid bills', 'الفواتير غير المدفوعة')}</th>
          <th scope="col">{t(locale, 'Covered by goal', 'مغطى بهدف')}</th>
          <th scope="col">{t(locale, 'Net reserved', 'صافي المحجوز')}</th>
          <th scope="col"><span className="cc-visually-hidden">{t(locale, 'Details', 'التفاصيل')}</span></th>
        </tr></thead>
        <tbody>
          {groups.map((group) => {
            const name = locale === 'ar' ? (group.nameAr ?? group.nameEn) : (group.nameEn ?? group.nameAr);
            const displayName = name ?? t(locale, 'Unnamed group', 'مجموعة بلا اسم');
            const ratio = groupCommitmentRatio(group);
            const applicable = group.unpaidBillsMinor !== null && group.goalOverlapMinor !== null;
            const expanded = expandedId === group.id;
            return (
              <Fragment key={group.id}>
                <tr className="cc-bar-row">
                  <th scope="row" className="cc-bar-label"><bdi>{displayName}</bdi></th>
                  <td data-label={t(locale, 'Budget remaining', 'الميزانية المتبقية')}>
                    <bdi>{formatMinorAmount(group.budgetRemainingMinor, currency, locale)}</bdi>
                  </td>
                  <td data-label={t(locale, 'Unpaid bills', 'الفواتير غير المدفوعة')}>
                    {applicable
                      ? <bdi>{formatMinorAmount(group.unpaidBillsMinor as string, currency, locale)}</bdi>
                      : t(locale, 'Not applicable', 'لا ينطبق')}
                  </td>
                  <td data-label={t(locale, 'Covered by goal', 'مغطى بهدف')}>
                    {applicable
                      ? <bdi>{formatMinorAmount(group.goalOverlapMinor as string, currency, locale)}</bdi>
                      : t(locale, 'Not applicable', 'لا ينطبق')}
                  </td>
                  <td data-label={t(locale, 'Net reserved', 'صافي المحجوز')} className="cc-net-reserved">
                    <bdi>{formatMinorAmount(group.commitmentMinor, currency, locale)}</bdi>
                  </td>
                  <td>
                    <button type="button" className="cr-button cc-drilldown-button" aria-expanded={expanded}
                      aria-label={`${t(locale, 'Details', 'التفاصيل')} ${displayName}`}
                      onClick={() => setExpandedId(expanded ? null : group.id)}>
                      {t(locale, 'Details', 'التفاصيل')}
                    </button>
                  </td>
                </tr>
                {applicable && (
                  <tr className="cc-bar-visual-row"><td colSpan={6}>
                    {ratio.hasScale ? (
                      <>
                        <div className="cc-progress" data-over={ratio.over ? 'true' : undefined} aria-hidden="true">
                          <span style={{ inlineSize: `${ratio.percent}%` }} />
                        </div>
                        {ratio.over && ratio.overageMinor && (
                          <span className="cc-overage-text">
                            +<bdi>{formatMinorAmount(ratio.overageMinor, currency, locale)}</bdi> {t(locale, 'over remaining budget', 'فوق الميزانية المتبقية')}
                          </span>
                        )}
                      </>
                    ) : (
                      <p className="cc-label-muted">{t(locale, 'No remaining budget line to compare against.', 'لا يوجد بند ميزانية متبقٍ للمقارنة.')}</p>
                    )}
                  </td></tr>
                )}
                {expanded && applicable && (
                  <tr className="cc-detail-row"><td colSpan={6}>
                    <p className="cc-label-muted">
                      {locale === 'ar' ? <>
                        فواتير غير مدفوعة بقيمة <bdi>{formatMinorAmount(group.unpaidBillsMinor as string, currency, locale)}</bdi>،
                        مطروحًا منها <bdi>{formatMinorAmount(group.goalOverlapMinor as string, currency, locale)}</bdi> مغطاة بالفعل بهدف،
                        تترك <bdi>{formatMinorAmount(group.commitmentMinor, currency, locale)}</bdi> ما زالت محجوزة
                        مقابل ميزانية متبقية قدرها <bdi>{formatMinorAmount(group.budgetRemainingMinor, currency, locale)}</bdi>.
                      </> : <>
                        Unpaid bills of <bdi>{formatMinorAmount(group.unpaidBillsMinor as string, currency, locale)}</bdi>,
                        minus <bdi>{formatMinorAmount(group.goalOverlapMinor as string, currency, locale)}</bdi> already covered by a goal,
                        leave <bdi>{formatMinorAmount(group.commitmentMinor, currency, locale)}</bdi> still reserved
                        against a remaining budget of <bdi>{formatMinorAmount(group.budgetRemainingMinor, currency, locale)}</bdi>.
                      </>}
                    </p>
                  </td></tr>
                )}
                {expanded && !applicable && (
                  <tr className="cc-detail-row"><td colSpan={6}>
                    <p className="cc-label-muted">
                      {locale === 'ar' ? <>
                        هذه مجموعة ذات غرض مستقبلي؛ حجزها البالغ <bdi>{formatMinorAmount(group.commitmentMinor, currency, locale)}</bdi> مشمول
                        بالفعل ضمن إجماليات الدين/الهدف أعلاه، وليس ضمن بند ميزانية لكل فاتورة.
                      </> : <>
                        This is a future-purpose group; its <bdi>{formatMinorAmount(group.commitmentMinor, currency, locale)}</bdi> reservation
                        is already included in the debt/goal totals above, not in a per-bill budget line.
                      </>}
                    </p>
                  </td></tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
