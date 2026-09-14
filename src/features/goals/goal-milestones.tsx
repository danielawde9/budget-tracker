import { useState } from 'react';
import type { Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import { classifyGoalsError, localizeGoalsError } from './errors.js';
import type { CommandOutcome } from './use-goals.js';
import type { GoalMilestoneRow } from './types.js';

interface GoalMilestonesProps {
  locale: Locale;
  currency: 'USD' | 'LBP';
  milestones: readonly GoalMilestoneRow[];
  pending: boolean;
  onSetMilestone(input: { milestoneId: string; action: 'complete' | 'reopen'; expectedEventId: string | null }): Promise<CommandOutcome>;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

/** `goal_detail`'s milestone row carries no event id (task 11's own exact
 * field list: id,kind,labelEn,labelAr,thresholdMinor,dueDate,ordinal,
 * currentState) -- there is no SQL change in scope for this task to add
 * one. This component tracks the event id returned by its own successful
 * actions for the life of the page; a milestone touched only in an earlier
 * session still starts from `null`, and a genuinely stale attempt surfaces
 * as an ordinary recoverable error asking to reload the goal. See
 * docs/decisions.md for the follow-up this leaves for a future task. */
export function GoalMilestones(props: GoalMilestonesProps) {
  const [knownEventIds, setKnownEventIds] = useState<Record<string, string | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(milestone: GoalMilestoneRow, action: 'complete' | 'reopen') {
    setErrors((current) => ({ ...current, [milestone.id]: '' }));
    setBusyId(milestone.id);
    try {
      const expectedEventId = milestone.id in knownEventIds ? knownEventIds[milestone.id]! : null;
      const outcome = await props.onSetMilestone({ milestoneId: milestone.id, action, expectedEventId });
      if (outcome.status === 'ambiguous') return;
      const result = outcome.result as { eventId: string } | undefined;
      if (result) setKnownEventIds((current) => ({ ...current, [milestone.id]: result.eventId }));
    } catch (cause) {
      const view = localizeGoalsError(classifyGoalsError(cause), props.locale);
      setErrors((current) => ({ ...current, [milestone.id]: `${view.message} ${view.recovery}` }));
    } finally {
      setBusyId(null);
    }
  }

  if (props.milestones.length === 0) {
    return <p className="goal-label-muted">{t(props.locale, 'No milestones yet.', 'لا توجد معالم بعد.')}</p>;
  }

  return <ol className="goal-milestone-list">
    {[...props.milestones].sort((a, b) => a.ordinal - b.ordinal).map((milestone) => {
      const label = props.locale === 'ar' ? (milestone.labelAr ?? milestone.labelEn) : (milestone.labelEn ?? milestone.labelAr);
      const complete = milestone.currentState === 'complete';
      const busy = busyId === milestone.id || props.pending;
      return <li key={milestone.id} className="goal-milestone-row" data-state={milestone.currentState}>
        <div className="goal-row">
          <span className="goal-milestone-label"><bdi>{label}</bdi></span>
          {milestone.kind === 'amount'
            ? <span className="goal-label-muted">{t(props.locale, 'Target', 'الهدف')}: <bdi>{formatMinorAmount(milestone.thresholdMinor ?? '0', props.currency, props.locale)}</bdi></span>
            : <span className={complete ? 'goal-complete-badge' : 'goal-label-muted'}>
              {complete ? t(props.locale, 'Complete', 'مكتمل') : t(props.locale, 'Incomplete', 'غير مكتمل')}
            </span>}
        </div>
        {milestone.dueDate && <p className="goal-label-muted">{t(props.locale, 'Due', 'الاستحقاق')}: {milestone.dueDate}</p>}
        {milestone.kind === 'checklist' && <div className="goal-milestone-actions">
          <button type="button" className="cr-button" disabled={busy}
            onClick={() => void act(milestone, complete ? 'reopen' : 'complete')}>
            {complete ? t(props.locale, 'Reopen', 'إعادة فتح') : t(props.locale, 'Mark complete', 'وضع علامة مكتمل')}
          </button>
        </div>}
        {errors[milestone.id] && <div className="error-notice" role="alert">{errors[milestone.id]}</div>}
      </li>;
    })}
  </ol>;
}
