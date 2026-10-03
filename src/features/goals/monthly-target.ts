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

/** Finds the month head even when later funding/checklist entries bury it. */
export async function loadGoalMonthlyTargetRevisionId(
  loadHistory: (input: Omit<import('./types.js').LoadGoalHistoryInput, 'spaceId'>) => Promise<import('./types.js').GoalHistoryPage>,
  goalId: string, month: string,
): Promise<string | null> {
  let cursor: import('./types.js').GoalHistoryCursor | null = null;
  const seen = new Set<string>();
  do {
    const history = await loadHistory({ goalId,
      beforeCreatedAt: cursor?.createdAt ?? null, beforeSourceKind: cursor?.sourceKind ?? null,
      beforeSourceId: cursor?.sourceId ?? null, limit: 100 });
    const head = latestMonthlyTargetRevisionId(history.rows, month);
    if (head !== null) return head;
    cursor = history.hasMore ? history.nextCursor : null;
    if (cursor) {
      const key = JSON.stringify(cursor);
      if (seen.has(key)) throw new Error('Goal history cursor did not advance.');
      seen.add(key);
    }
  } while (cursor);
  return null;
}

/** Enumerate goals, but obtain each amount from the selected month detail.
 * List projections describe the current month and must not supply amounts
 * for a historical or future allocation. Page both identities and heads. */
export async function loadGoalMonthlyTargetLines(
  gateway: GoalsGateway, spaceId: string, currency: Currency, month: string, signal?: AbortSignal,
): Promise<readonly GoalMonthlyTargetLine[]> {
  const lines: GoalMonthlyTargetLine[] = [];
  let cursor: import('./types.js').GoalPageCursor | null = null;
  const seen = new Set<string>();
  do {
    const page = await gateway.loadPage({ spaceId, currency, stateFilter: 'all',
      afterCreatedAt: cursor?.createdAt ?? null, afterId: cursor?.id ?? null, limit: 100 }, signal);
    for (const identity of page.rows) {
      const detail = await gateway.loadDetail({ spaceId, goalId: identity.id, month }, signal);
      const goal = detail.summary;
      if (goal.monthlyTargetMinor === null) continue;
      const expectedRevisionId = await loadGoalMonthlyTargetRevisionId(input => gateway.loadHistory({ ...input, spaceId }, signal), goal.id, month);
      lines.push({ goalId: goal.id, nameEn: goal.nameEn, nameAr: goal.nameAr,
        amountMinor: goal.monthlyTargetMinor, expectedRevisionId });
    }
    cursor = page.hasMore ? page.nextCursor : null;
    if (cursor) {
      const key = JSON.stringify(cursor);
      if (seen.has(key)) throw new Error('Goal page cursor did not advance.');
      seen.add(key);
    }
  } while (cursor);
  return lines;
}
