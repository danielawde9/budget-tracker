import { useEffect, useState } from 'react';
import type { Currency } from '../loans/types.js';
import { loadGoalMonthlyTargetLines } from './monthly-target.js';
import type { GoalMonthlyTargetLine, GoalsGateway } from './types.js';

/** Loads the selected month's targets and revision heads. Callers must block
 * publication while loading or on error, so failed reads cannot silently drop
 * existing goals. Refresh after publication to obtain the new heads. */
export function useGoalMonthlyTargets(
  gateway: GoalsGateway | null, spaceId: string, currency: Currency, month: string, refreshVersion = 0,
): { lines: readonly GoalMonthlyTargetLine[]; status: 'loading' | 'ready' | 'error' } {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(gateway ? 'loading' : 'ready');
  const [lines, setLines] = useState<readonly GoalMonthlyTargetLine[]>([]);
  useEffect(() => {
    if (!gateway) {
      setLines([]); setStatus('ready');
      return;
    }
    setLines([]); setStatus('loading');
    const controller = new AbortController();
    let active = true;
    void loadGoalMonthlyTargetLines(gateway, spaceId, currency, month, controller.signal)
      .then((next) => { if (active) { setLines(next); setStatus('ready'); } })
      .catch(() => { if (active) { setLines([]); setStatus('error'); } });
    return () => { active = false; controller.abort(); };
  }, [gateway, spaceId, currency, month, refreshVersion]);
  return { lines, status };
}

export function useGoalMonthlyTargetLines(gateway: GoalsGateway | null, spaceId: string, currency: Currency, month: string, refreshVersion = 0): readonly GoalMonthlyTargetLine[] {
  return useGoalMonthlyTargets(gateway, spaceId, currency, month, refreshVersion).lines;
}
