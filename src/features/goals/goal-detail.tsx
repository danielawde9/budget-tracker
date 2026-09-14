import { useCallback, useEffect, useState } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import { chartPercent } from './chart-ratio.js';
import { classifyGoalsError, localizeGoalsError, type GoalsErrorView } from './errors.js';
import { GoalEditor } from './goal-editor.js';
import { GoalFundingDialog } from './goal-funding-dialog.js';
import { GoalMilestones } from './goal-milestones.js';
import { GoalPurchaseDialog } from './goal-purchase-dialog.js';
import type { GoalDetail as GoalDetailData, GoalHistoryRow, GoalState, GoalSummary } from './types.js';
import type { GoalsState } from './use-goals.js';
import { GoalDetailSkeleton } from '../control-room/skeletons.js';

interface GoalDetailProps {
  locale: Locale;
  currency: Currency;
  goals: GoalsState;
  goalId: string;
  otherGoals: readonly GoalSummary[];
  onBack(): void;
}

type DialogKind = 'funding' | 'purchase' | 'edit';

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

function currentMonthStart(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function horizonLabel(locale: Locale, horizon: GoalSummary['horizon']): string {
  if (horizon === 'short') return t(locale, 'Short horizon', 'أفق قصير');
  if (horizon === 'long') return t(locale, 'Long horizon', 'أفق طويل');
  return t(locale, 'Open horizon', 'أفق مفتوح');
}

function forecastLabel(locale: Locale, detail: GoalDetailData['summary']): string {
  if (detail.forecastState === 'estimate' && detail.forecastMonth) {
    return `${t(locale, 'Estimated completion', 'الإنجاز المُقدَّر')}: ${detail.forecastMonth}`;
  }
  if (detail.forecastState === 'insufficient_history') return t(locale, 'Not enough history to forecast yet', 'لا يوجد سجل كافٍ للتنبؤ بعد');
  if (detail.forecastState === 'no_positive_pace') return t(locale, 'No recent positive contribution pace', 'لا يوجد وتيرة مساهمة إيجابية حديثة');
  return t(locale, 'Beyond a 120-month forecast horizon', 'يتجاوز أفق التنبؤ البالغ 120 شهرًا');
}

/** Progress toward target: covered for a reserve goal, covered+fulfilled for
 * a purchase goal (task 11's own "progress" definition). `chartPercent`
 * controls the visual coordinate only -- overage is derived from the
 * original BigInt values, never the clamped percent, and a null coverage
 * (unavailable, not zero) renders no bar at all rather than an empty one. */
function GoalProgressBar({ locale, currency, summary }: { locale: Locale; currency: Currency; summary: GoalSummary }) {
  if (summary.coveredMinor === null) return <p className="goal-label-muted">{t(locale, 'Coverage is currently unavailable.', 'التغطية غير متوفرة حاليًا.')}</p>;
  const progressMinor = (BigInt(summary.coveredMinor) + (summary.kind === 'purchase' ? BigInt(summary.fulfilledMinor) : 0n)).toString();
  const target = BigInt(summary.targetMinor);
  const progress = BigInt(progressMinor);
  const percent = chartPercent(progressMinor, summary.targetMinor);
  const over = target > 0n && progress > target;
  return <div className="goal-progress-block">
    <table className="goal-progress-table">
      <caption className="goal-visually-hidden">{t(locale, 'Progress toward target', 'التقدم نحو الهدف')}</caption>
      <tbody><tr>
        <td data-label={t(locale, 'Progress', 'التقدم')}>
          <div className="goal-progress" data-over={over ? 'true' : undefined} aria-hidden="true"><span style={{ inlineSize: `${percent}%` }} /></div>
          {over && <span className="goal-overage-text">+{formatMinorAmount((progress - target).toString(), currency, locale)} {t(locale, 'over target', 'فوق الهدف')}</span>}
        </td>
      </tr></tbody>
    </table>
  </div>;
}

function historyDescription(locale: Locale, row: GoalHistoryRow): string {
  const detail = row.detail as Record<string, unknown>;
  switch (row.sourceKind) {
    case 'definition': return t(locale, 'Definition updated', 'تم تحديث التعريف');
    case 'earmark': return `${t(locale, 'Earmark', 'حجز')}: ${String(detail['operation'] ?? '')} ${String(detail['amountMinor'] ?? '')}`;
    case 'purchase_link': return t(locale, 'Purchase linked', 'تم ربط شراء');
    case 'checklist': return `${t(locale, 'Checklist', 'قائمة تحقق')}: ${String(detail['action'] ?? '')}`;
    case 'monthly_target': return t(locale, 'Monthly target set', 'تم تعيين هدف شهري');
    case 'financial_reversal': return t(locale, 'Linked expense reversed', 'تم عكس المصروف المرتبط');
    default: return row.sourceKind;
  }
}

export function GoalDetail(props: GoalDetailProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [detail, setDetail] = useState<GoalDetailData | null>(null);
  const [error, setError] = useState<GoalsErrorView | null>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [pendingState, setPendingState] = useState<GoalState | null>(null);
  const [historyRows, setHistoryRows] = useState<readonly GoalHistoryRow[]>([]);
  const [historyCursor, setHistoryCursor] = useState<{ createdAt: string; sourceKind: string; sourceId: string } | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const month = currentMonthStart();

  const { loadDetail, loadHistory } = props.goals;
  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const data = await loadDetail({ goalId: props.goalId, month });
      setDetail(data);
      setStatus('ready');
      const history = await loadHistory({ goalId: props.goalId, beforeCreatedAt: null, beforeSourceKind: null, beforeSourceId: null, limit: 10 });
      setHistoryRows(history.rows);
      setHistoryCursor(history.nextCursor);
      setHistoryHasMore(history.hasMore);
    } catch (cause) {
      setError(localizeGoalsError(classifyGoalsError(cause), props.locale));
      setStatus('error');
    }
    // loadDetail/loadHistory are useCallback-stable in useGoals (they only
    // depend on gateway/spaceId, never on the hook's own saving/ambiguous
    // state) -- depending on the whole `props.goals` object here instead
    // would re-run this effect on every mutation status change (saving ->
    // ready etc.), flashing this component back to "loading" and unmounting
    // whatever dialog is currently open mid-submission.
  }, [loadDetail, loadHistory, props.goalId, month, props.locale]);

  useEffect(() => { void load(); }, [load]);

  async function loadMoreHistory() {
    if (!historyCursor) return;
    const page = await props.goals.loadHistory({
      goalId: props.goalId, beforeCreatedAt: historyCursor.createdAt,
      beforeSourceKind: historyCursor.sourceKind as GoalHistoryRow['sourceKind'], beforeSourceId: historyCursor.sourceId, limit: 10,
    });
    setHistoryRows((current) => [...current, ...page.rows]);
    setHistoryCursor(page.nextCursor);
    setHistoryHasMore(page.hasMore);
  }

  function closeDialog() {
    setDialog(null);
    setPendingState(null);
    void load();
  }

  function openStateChange(target: GoalState) {
    setPendingState(target);
    setDialog('edit');
  }

  if (status === 'loading') return <GoalDetailSkeleton locale={props.locale} />;
  if (status === 'error' || !detail) return <div className="cr-card" role="alert">
    <p>{error?.message}</p>
    <p><small>{error?.recovery}</small></p>
    <button type="button" className="cr-button" onClick={() => void load()}>{t(props.locale, 'Retry', 'إعادة المحاولة')}</button>
  </div>;

  const summary = detail.summary;
  const goalName = props.locale === 'ar' ? (summary.nameAr ?? summary.nameEn) : (summary.nameEn ?? summary.nameAr);
  const nextMilestone = [...detail.milestones].sort((a, b) => a.ordinal - b.ordinal).find((row) => row.currentState === 'incomplete');
  const moveTargets = props.otherGoals
    .filter((candidate) => candidate.id !== props.goalId && candidate.state === 'active')
    .map((candidate) => ({ id: candidate.id, nameEn: candidate.nameEn, nameAr: candidate.nameAr }));

  return <section className="goal-detail" aria-label={t(props.locale, 'Goal detail', 'تفاصيل الهدف')}>
    <div className="goal-row">
      <button type="button" className="cr-button" onClick={props.onBack}>{t(props.locale, 'Back to goals', 'العودة إلى الأهداف')}</button>
      <h2 className="goal-heading"><bdi>{goalName}</bdi></h2>
      <button type="button" className="cr-button" onClick={() => setDialog('edit')}>{t(props.locale, 'Edit', 'تعديل')}</button>
    </div>

    {summary.needsReview && <div className="cr-card" role="alert">
      <p>{t(props.locale, 'This closed goal has a restored balance from a later reversal. Review it.', 'يحتوي هذا الهدف المغلق على رصيد مستعاد من عملية عكس لاحقة. راجعه.')}</p>
      <div className="goal-row">
        <button type="button" className="cr-button" onClick={() => setDialog('funding')}>{t(props.locale, 'Manage funding', 'إدارة التمويل')}</button>
        <button type="button" className="cr-button" onClick={() => openStateChange('active')}>{t(props.locale, 'Reopen goal', 'إعادة فتح الهدف')}</button>
      </div>
    </div>}

    <div className="goal-metrics">
      <div className="goal-metric"><span className="goal-label-muted">{t(props.locale, 'Target', 'الهدف')}</span><bdi className="goal-metric-value">{formatMinorAmount(summary.targetMinor, props.currency, props.locale)}</bdi></div>
      <div className="goal-metric"><span className="goal-label-muted">{t(props.locale, 'Earmarked', 'المحجوز')}</span><bdi className="goal-metric-value">{formatMinorAmount(summary.earmarkedMinor, props.currency, props.locale)}</bdi></div>
      <div className="goal-metric"><span className="goal-label-muted">{t(props.locale, 'Cash-covered', 'مُغطّى نقدًا')}</span><bdi className="goal-metric-value">{summary.coveredMinor === null ? t(props.locale, 'Unknown', 'غير معروف') : formatMinorAmount(summary.coveredMinor, props.currency, props.locale)}</bdi></div>
      <div className="goal-metric"><span className="goal-label-muted">{t(props.locale, 'Fulfilled', 'المُنجز')}</span><bdi className="goal-metric-value">{formatMinorAmount(summary.fulfilledMinor, props.currency, props.locale)}</bdi></div>
      {summary.shortageMinor !== null && <div className="goal-metric"><span className="goal-label-muted">{t(props.locale, 'Shortage before bills', 'العجز قبل الفواتير')}</span><bdi className="goal-metric-value goal-danger-text">{formatMinorAmount(summary.shortageMinor, props.currency, props.locale)}</bdi></div>}
      <div className="goal-metric"><span className="goal-label-muted">{t(props.locale, 'Monthly target', 'الهدف الشهري')}</span><bdi className="goal-metric-value">{summary.monthlyTargetMinor === null ? t(props.locale, 'None set', 'لم يُحدَّد') : formatMinorAmount(summary.monthlyTargetMinor, props.currency, props.locale)}</bdi></div>
      <div className="goal-metric"><span className="goal-label-muted">{t(props.locale, 'This month’s net contribution', 'صافي المساهمة لهذا الشهر')}</span><bdi className="goal-metric-value">{formatMinorAmount(summary.monthlyNetContributionMinor, props.currency, props.locale)}</bdi></div>
    </div>

    <GoalProgressBar locale={props.locale} currency={props.currency} summary={summary} />

    <p className="goal-label-muted">{horizonLabel(props.locale, summary.horizon)}{nextMilestone && <> · {t(props.locale, 'Next milestone', 'المعلم التالي')}: <bdi>{props.locale === 'ar' ? (nextMilestone.labelAr ?? nextMilestone.labelEn) : (nextMilestone.labelEn ?? nextMilestone.labelAr)}</bdi></>}</p>
    <p className="goal-label-muted">{forecastLabel(props.locale, summary)}</p>

    <div className="goal-row">
      {(summary.state !== 'closed' || summary.needsReview) && <button type="button" className="cr-button" onClick={() => setDialog('funding')}>{t(props.locale, 'Manage funding (reserve/release/move)', 'إدارة التمويل (حجز/تحرير/نقل)')}</button>}
      <button type="button" className="cr-button" onClick={() => setDialog('purchase')}>{t(props.locale, 'Link a purchase', 'ربط عملية شراء')}</button>
      {summary.state === 'active' && <button type="button" className="cr-button" onClick={() => openStateChange('paused')}>{t(props.locale, 'Pause goal', 'إيقاف الهدف مؤقتًا')}</button>}
      {summary.state === 'paused' && <button type="button" className="cr-button" onClick={() => openStateChange('active')}>{t(props.locale, 'Resume goal', 'استئناف الهدف')}</button>}
      {summary.state !== 'closed' && <button type="button" className="cr-button" onClick={() => openStateChange('closed')}>{t(props.locale, 'Close goal', 'إغلاق الهدف')}</button>}
    </div>

    <h3>{t(props.locale, 'Milestones', 'المعالم')}</h3>
    <GoalMilestones locale={props.locale} currency={props.currency} milestones={detail.milestones}
      pending={props.goals.pending} onSetMilestone={async (input) => {
        const outcome = await props.goals.setMilestone(input);
        if (outcome.status !== 'ambiguous') void load();
        return outcome;
      }} />

    <h3>{t(props.locale, 'History', 'السجل')}</h3>
    <ul className="goal-history-list">
      {historyRows.map((row) => <li key={`${row.sourceKind}-${row.sourceId}`}>{historyDescription(props.locale, row)} — <small>{row.createdAt}</small></li>)}
    </ul>
    {historyHasMore && <button type="button" className="cr-button" onClick={() => void loadMoreHistory()}>{t(props.locale, 'Load more history', 'تحميل المزيد من السجل')}</button>}

    {dialog === 'funding' && <GoalFundingDialog locale={props.locale} currency={props.currency} goal={summary} goalHead={detail.earmarkHead}
      moveTargets={moveTargets} pending={props.goals.pending} ambiguous={props.goals.ambiguous !== null}
      onClose={closeDialog} onClearAmbiguous={props.goals.clearAmbiguous} onRetry={props.goals.retryAmbiguous}
      onReserveOrRelease={(input) => props.goals.reserveOrRelease({ ...input, goalId: props.goalId })}
      onLoadToHead={(id) => props.goals.loadDetail({ goalId: id, month }).then((data) => data.earmarkHead)}
      onMove={(input) => props.goals.move({ ...input, fromGoalId: props.goalId })} />}

    {dialog === 'purchase' && <GoalPurchaseDialog locale={props.locale} currency={props.currency} goal={summary} goalHead={detail.earmarkHead}
      pending={props.goals.pending} ambiguous={props.goals.ambiguous !== null}
      onClose={closeDialog} onClearAmbiguous={props.goals.clearAmbiguous} onRetry={props.goals.retryAmbiguous}
      onSubmit={(input) => props.goals.linkPurchase({
        expenseEventId: input.expenseEventId,
        lines: [{ goalId: props.goalId, amountMinor: input.amountMinor, expectedHead: input.expectedHead }],
      })} />}

    {dialog === 'edit' && <GoalEditor locale={props.locale} mode="revise" initialState={pendingState ?? undefined}
      existing={{
        goalId: props.goalId, expectedRevisionId: summary.revisionId, currentState: summary.state,
        definition: {
          kind: summary.kind, currency: props.currency, nameEn: summary.nameEn, nameAr: summary.nameAr, note: null,
          targetMinor: summary.targetMinor, deadline: summary.dueDate,
          contributionMode: summary.dueDate !== null ? 'by_deadline' : 'manual_monthly',
          monthlyAmountMinor: summary.dueDate !== null ? null : (summary.monthlyTargetMinor ?? '0'),
          priority: 0,
        },
        milestones: detail.milestones.map((row) => ({
          id: row.id, kind: row.kind, labelEn: row.labelEn, labelAr: row.labelAr,
          thresholdMinor: row.thresholdMinor, dueDate: row.dueDate, ordinal: row.ordinal,
        })),
      }}
      pending={props.goals.pending} ambiguous={props.goals.ambiguous !== null}
      onClose={closeDialog} onClearAmbiguous={props.goals.clearAmbiguous} onRetry={props.goals.retryAmbiguous}
      onCreate={props.goals.create} onRevise={props.goals.revise} />}
  </section>;
}
