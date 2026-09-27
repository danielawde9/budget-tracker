import type { Currency } from '../loans/types.js';
import type { GoalHistoryRow, GoalMonthlyTargetLine, GoalSummary, GoalsGateway } from './types.js';

/** The `goal_monthly_target_revisions` head for a goal and month, derived from
 * `goal_history_page`'s `monthly_target` rows (which carry the revision id as
 * `sourceId` and the month as `detail.monthStart`). The goal read projections
 * do not expose this head directly, and it is exactly the value
 * `set_goal_monthly_target` needs as `p_expected_revision_id` -- both for the
 * goal's own "Monthly target" control and for `publish_allocation_month_v2`'s
 * complete-set goal lines. Rows are newest-first, so the first match wins. */
export function latestMonthlyTargetRevisionId(rows: readonly GoalHistoryRow[], month: string): string | null {
  for (const row of rows) {
    if (row.sourceKind !== 'monthly_target') continue;
    if (row.detail['monthStart'] === month) return row.sourceId;
  }
  return null;
}

/** A goal's monthly-target line for the plan month, or null when the goal has
 * no target in that month (nothing for the publish to carry). */
export function goalMonthlyTargetLine(goal: GoalSummary, expectedRevisionId: string | null): GoalMonthlyTargetLine | null {
  if (goal.monthlyTargetMinor === null) return null;
  return { goalId: goal.id, nameEn: goal.nameEn, nameAr: goal.nameAr, amountMinor: goal.monthlyTargetMinor, expectedRevisionId };
}

/** The current month's goal monthly targets for a currency, as the allocation
 * publish needs them. `goal_page`/`goal_detail` return each goal's
 * `monthlyTargetMinor` for the *current UTC month* (the same month
 * `GoalDetail` edits), so this loader's `month` is expected to be that month.
 * Only goals with a target are returned; goals without one are omitted so the
 * publish's complete-set rule is satisfied without inventing zero revisions. */
export async function loadGoalMonthlyTargetLines(
  gateway: GoalsGateway, spaceId: string, currency: Currency, month: string, signal?: AbortSignal,
): Promise<readonly GoalMonthlyTargetLine[]> {
  const page = await gateway.loadPage(
    { spaceId, currency, stateFilter: 'all', afterCreatedAt: null, afterId: null, limit: 100 }, signal,
  );
  const lines: GoalMonthlyTargetLine[] = [];
  for (const goal of page.rows) {
    if (goal.monthlyTargetMinor === null) continue;
    const history = await gateway.loadHistory(
      { spaceId, goalId: goal.id, beforeCreatedAt: null, beforeSourceKind: null, beforeSourceId: null, limit: 100 }, signal,
    );
    lines.push({
      goalId: goal.id,
      nameEn: goal.nameEn,
      nameAr: goal.nameAr,
      amountMinor: goal.monthlyTargetMinor,
      expectedRevisionId: latestMonthlyTargetRevisionId(history.rows, month),
    });
  }
  return lines;
}
