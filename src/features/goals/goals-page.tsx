import { useState } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import { GoalDetail } from './goal-detail.js';
import { GoalEditor } from './goal-editor.js';
import { chartPercent } from './chart-ratio.js';
import type { GoalStateFilter, GoalSummary } from './types.js';
import type { GoalsState } from './use-goals.js';
import { GoalsSkeleton } from '../control-room/skeletons.js';

interface GoalsPageProps {
  locale: Locale;
  currency: Currency;
  /** Integer-minor planned income for this page's currency from the monthly
   * plan; forwarded to the create editor's 'Planned income' amount source. */
  plannedIncomeMinor: string | null;
  goals: GoalsState;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

const FILTERS: readonly GoalStateFilter[] = ['active', 'paused', 'closed', 'needs_review', 'all'];

function filterLabel(locale: Locale, filter: GoalStateFilter): string {
  switch (filter) {
    case 'active': return t(locale, 'Active', 'نشط');
    case 'paused': return t(locale, 'Paused', 'موقوف مؤقتًا');
    case 'closed': return t(locale, 'Closed', 'مغلق');
    case 'needs_review': return t(locale, 'Needs review', 'يحتاج مراجعة');
    case 'all': return t(locale, 'All', 'الكل');
  }
}

function goalProgress(goal: GoalSummary): number | null {
  if (goal.coveredMinor === null) return null;
  const reached = BigInt(goal.coveredMinor) + (goal.kind === 'purchase' ? BigInt(goal.fulfilledMinor) : 0n);
  return chartPercent(reached.toString(), goal.targetMinor);
}

export function GoalsPage(props: GoalsPageProps) {
  const [stateFilter, setStateFilter] = useState<GoalStateFilter>('active');
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const goals = props.goals;

  if (selectedGoalId) {
    return <GoalDetail locale={props.locale} currency={props.currency} goals={goals} goalId={selectedGoalId}
      otherGoals={goals.page.rows} plannedIncomeMinor={props.plannedIncomeMinor} onBack={() => setSelectedGoalId(null)} />;
  }

  const visibleGoals = goals.page.rows.filter((goal) =>
    stateFilter === 'all' || (stateFilter === 'needs_review' ? goal.needsReview : goal.state === stateFilter));

  return <section className="goal-page" aria-label={t(props.locale, 'Goals', 'الأهداف')}>
    <div className="cr-section-header">
      <h2>{t(props.locale, 'Goals', 'الأهداف')}</h2>
      <button type="button" className="cr-button cr-button--primary" onClick={() => setCreating(true)}>{t(props.locale, 'New goal', 'هدف جديد')}</button>
    </div>

    <div className="cr-chips goal-filter-tabs" role="tablist" aria-label={t(props.locale, 'Filter goals', 'تصفية الأهداف')}>
      {FILTERS.map((filter) => <button key={filter} type="button" role="tab" aria-selected={stateFilter === filter}
        className={`cr-chip${stateFilter === filter ? ' cr-chip--active' : ''}`} onClick={() => setStateFilter(filter)}>{filterLabel(props.locale, filter)}</button>)}
    </div>

    {goals.status === 'loading' && <GoalsSkeleton locale={props.locale} />}
    {goals.status === 'error' && <div className="cr-card" role="alert">
      <p>{goals.error?.message}</p>
      <p><small>{goals.error?.recovery}</small></p>
      <button type="button" className="cr-button" onClick={() => void goals.refresh()}>{t(props.locale, 'Retry', 'إعادة المحاولة')}</button>
    </div>}
    {goals.status === 'accepted-refresh-pending' && <div className="cr-card" role="alert">
      <p>{t(props.locale, 'Your change was saved, but the list could not refresh.', 'تم حفظ تغييرك، لكن تعذر تحديث القائمة.')}</p>
      <button type="button" className="cr-button" onClick={() => void goals.refresh()}>{t(props.locale, 'Refresh', 'تحديث')}</button>
    </div>}
    {goals.status === 'ambiguous' && <div className="cr-card" role="alert">
      <p>{t(props.locale, 'The result of the last command is still unknown.', 'نتيجة الأمر الأخير ما زالت غير معروفة.')}</p>
      <button type="button" className="cr-button" onClick={() => void goals.retryAmbiguous()}>{t(props.locale, 'Check again', 'تحقق مرة أخرى')}</button>
      <button type="button" className="cr-button" onClick={goals.clearAmbiguous}>{t(props.locale, 'Dismiss', 'تجاهل')}</button>
    </div>}

    {(goals.status === 'ready' || goals.status === 'saving' || goals.status === 'accepted-refresh-pending' || goals.status === 'ambiguous') && (
      visibleGoals.length === 0
        ? <p className="goal-label-muted">{t(props.locale, 'No goals yet in this view.', 'لا توجد أهداف بعد في هذا العرض.')}</p>
        : <div className="goal-page-content"><ul className="goal-list">
          {visibleGoals.map((goal) => {
              const name = props.locale === 'ar' ? (goal.nameAr ?? goal.nameEn) : (goal.nameEn ?? goal.nameAr);
              const progress = goalProgress(goal);
              return <li key={goal.id} className="cr-card goal-list-row">
                <div className="goal-row goal-card-heading">
                  <strong><bdi>{name ?? t(props.locale, 'Unnamed goal', 'هدف بلا اسم')}</bdi></strong>
                  <span className="cr-helper">{filterLabel(props.locale, goal.state)}</span>
                </div>
                {goal.needsReview && <span className="goal-complete-badge">{t(props.locale, 'Needs review', 'يحتاج مراجعة')}</span>}
                <div className="goal-card-figures">
                  <div><span className="cr-helper">{t(props.locale, 'Earmarked', 'المحجوز')}</span><bdi className="cr-amount">{formatMinorAmount(goal.earmarkedMinor, props.currency, props.locale)}</bdi></div>
                  <div><span className="cr-helper">{t(props.locale, 'Target', 'الهدف')}</span><bdi className="cr-amount">{formatMinorAmount(goal.targetMinor, props.currency, props.locale)}</bdi></div>
                </div>
                {progress === null ? <p className="cr-helper">{t(props.locale, 'Cash coverage is unavailable.', 'التغطية النقدية غير متاحة.')}</p> : <div className="goal-card-progress">
                  <div className="goal-progress" aria-hidden="true"><span style={{ inlineSize: `${progress}%` }} /></div>
                  <span className="cr-helper"><bdi>{new Intl.NumberFormat(props.locale === 'ar' ? 'ar-LB' : 'en-US', { maximumFractionDigits: 0 }).format(progress)}%</bdi> {t(props.locale, 'toward target', 'نحو الهدف')}</span>
                </div>}
                <dl className="goal-card-meta">
                  <div><dt>{t(props.locale, 'Cash-covered', 'مُغطّى نقدًا')}</dt><dd><bdi>{goal.coveredMinor === null ? t(props.locale, 'Unknown', 'غير معروف') : formatMinorAmount(goal.coveredMinor, props.currency, props.locale)}</bdi></dd></div>
                  {goal.dueDate && <div><dt>{t(props.locale, 'Target date', 'تاريخ الهدف')}</dt><dd>{goal.dueDate}</dd></div>}
                  {goal.monthlyTargetMinor !== null && <div><dt>{t(props.locale, 'Monthly target', 'الهدف الشهري')}</dt><dd><bdi>{formatMinorAmount(goal.monthlyTargetMinor, props.currency, props.locale)}</bdi></dd></div>}
                </dl>
                <button type="button" className="cr-button cr-button--block" onClick={() => setSelectedGoalId(goal.id)}>{t(props.locale, 'View', 'عرض')}</button>
              </li>;
            })}
        </ul><aside className="cr-card goal-help" aria-label={t(props.locale, 'How goals use cash', 'كيف تستخدم الأهداف السيولة')}>
          <h3>{t(props.locale, 'How goals use cash', 'كيف تستخدم الأهداف السيولة')}</h3>
          <p className="cr-helper">{t(props.locale, 'Money set aside for a goal stays in your wallet, but is excluded from available cash.', 'تبقى الأموال المحجوزة للهدف في محفظتك، لكنها تُستبعد من السيولة المتاحة.')}</p>
          <p className="cr-helper">{t(props.locale, 'Cash-covered shows how much of the amount set aside is backed by cash right now.', 'يُظهر المغطّى نقدًا مقدار المبلغ المحجوز الذي تدعمه السيولة الآن.')}</p>
        </aside></div>
    )}

    {creating && <GoalEditor locale={props.locale} mode="create" plannedIncomeMinor={props.plannedIncomeMinor}
      pending={goals.pending} ambiguous={goals.ambiguous !== null}
      onClose={() => setCreating(false)} onClearAmbiguous={goals.clearAmbiguous} onRetry={goals.retryAmbiguous}
      onCreate={goals.create} onRevise={goals.revise} />}
  </section>;
}
