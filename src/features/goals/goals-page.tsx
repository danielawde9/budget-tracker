import { useState } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import { GoalDetail } from './goal-detail.js';
import { GoalEditor } from './goal-editor.js';
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

function goalRowSubtitle(locale: Locale, currency: Currency, goal: GoalSummary): string {
  const covered = goal.coveredMinor === null ? t(locale, 'unknown', 'غير معروف') : formatMinorAmount(goal.coveredMinor, currency, locale);
  return `${t(locale, 'Earmarked', 'المحجوز')} ${formatMinorAmount(goal.earmarkedMinor, currency, locale)} · ${t(locale, 'Covered', 'مُغطّى')} ${covered}`;
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

  return <section className="goal-page" aria-label={t(props.locale, 'Goals', 'الأهداف')}>
    <div className="goal-row">
      <h2 className="goal-heading">{t(props.locale, 'Goals', 'الأهداف')}</h2>
      <button type="button" className="cr-button" onClick={() => setCreating(true)}>{t(props.locale, 'New goal', 'هدف جديد')}</button>
    </div>

    <div className="goal-row goal-filter-tabs" role="tablist" aria-label={t(props.locale, 'Filter goals', 'تصفية الأهداف')}>
      {FILTERS.map((filter) => <button key={filter} type="button" role="tab" aria-selected={stateFilter === filter}
        className="cr-button" onClick={() => setStateFilter(filter)}>{filterLabel(props.locale, filter)}</button>)}
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
      <button type="button" className="button-secondary" onClick={goals.clearAmbiguous}>{t(props.locale, 'Dismiss', 'تجاهل')}</button>
    </div>}

    {(goals.status === 'ready' || goals.status === 'saving' || goals.status === 'accepted-refresh-pending' || goals.status === 'ambiguous') && (
      goals.page.rows.filter((goal) => stateFilter === 'all' || (stateFilter === 'needs_review' ? goal.state === 'closed' : goal.state === stateFilter)).length === 0
        ? <p className="goal-label-muted">{t(props.locale, 'No goals yet in this view.', 'لا توجد أهداف بعد في هذا العرض.')}</p>
        : <ul className="goal-list">
          {goals.page.rows
            .filter((goal) => stateFilter === 'all' || (stateFilter === 'needs_review' ? goal.state === 'closed' : goal.state === stateFilter))
            .map((goal) => {
              const name = props.locale === 'ar' ? (goal.nameAr ?? goal.nameEn) : (goal.nameEn ?? goal.nameAr);
              return <li key={goal.id} className="cr-card goal-list-row">
                <div className="goal-row">
                  <span><bdi>{name}</bdi>{goal.needsReview && <span className="goal-complete-badge">{t(props.locale, 'Needs review', 'يحتاج مراجعة')}</span>}</span>
                  <button type="button" className="cr-button" onClick={() => setSelectedGoalId(goal.id)}>{t(props.locale, 'View', 'عرض')}</button>
                </div>
                <p className="goal-label-muted">{goalRowSubtitle(props.locale, props.currency, goal)}</p>
              </li>;
            })}
        </ul>
    )}

    {creating && <GoalEditor locale={props.locale} mode="create" plannedIncomeMinor={props.plannedIncomeMinor}
      pending={goals.pending} ambiguous={goals.ambiguous !== null}
      onClose={() => setCreating(false)} onClearAmbiguous={goals.clearAmbiguous} onRetry={goals.retryAmbiguous}
      onCreate={goals.create} onRevise={goals.revise} />}
  </section>;
}
