import { useEffect, useState } from 'react';
import type { Currency } from '../loans/types.js';
import { loadGoalMonthlyTargetLines } from './monthly-target.js';
import type { GoalMonthlyTargetLine, GoalsGateway } from './types.js';

/** Loads the current month's goal monthly targets for a currency, so the
 * allocation setup can carry them on `publishMonthV2` (audit C3/B6). Returns
 * an empty list (never throws) while loading, when the goals service is
 * unavailable, or when a read fails -- publishing then stays on v1, exactly as
 * before this wiring existed. Re-reads when the space, currency or month
 * changes. */
export function useGoalMonthlyTargetLines(
  gateway: GoalsGateway | null, spaceId: string, currency: Currency, month: string,
): readonly GoalMonthlyTargetLine[] {
  const [lines, setLines] = useState<readonly GoalMonthlyTargetLine[]>([]);
  useEffect(() => {
    if (!gateway) {
      setLines([]);
      return;
    }
    const controller = new AbortController();
    let active = true;
    void loadGoalMonthlyTargetLines(gateway, spaceId, currency, month, controller.signal)
      .then((next) => { if (active) setLines(next); })
      .catch(() => { if (active) setLines([]); });
    return () => { active = false; controller.abort(); };
  }, [gateway, spaceId, currency, month]);
  return lines;
}
