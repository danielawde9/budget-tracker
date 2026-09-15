import { useCallback, useEffect, useRef, useState } from 'react';
import type { Currency } from '../loans/types.js';
import { classifyCashControlError, type CashControlErrorView } from './errors.js';
import type {
  AvailableCashSummary,
  CashControlGateway,
  CashOutlook,
  CashOutlookScenario,
} from './types.js';

/** Exactly loading/ready/error -- this gateway never mutates anything, so
 * none of the saving/accepted-refresh-pending/ambiguous machinery the
 * recurring/goals hooks need for their command retries belongs here. */
export type CashControlStatus = 'loading' | 'ready' | 'error';

export const defaultAvailableCashSummary: AvailableCashSummary = {
  currency: 'USD', asOf: '', state: 'unplanned', needsReview: false, snapshotId: null,
  cashMinor: '0', goalClaimsMinor: '0',
  expenseCommitmentsMinor: null, debtCommitmentsMinor: null, goalTopupsMinor: null, futureHeadroomMinor: null,
  availableMinor: null, deficitMinor: null, spendableMinor: null, dailyExtraGuideMinor: null,
  daysRemaining: 0, receivedIncomeMinor: '0', ordinarySpendingMinor: '0', incomeMinusSpendingMinor: '0',
  uncategorizedMinor: '0', unmaterializedCount: 0, groups: [],
};

export const defaultCashOutlook: CashOutlook = {
  currency: 'USD', startDate: '', scenario: 'expected', assumption: '', days: [],
  firstNegativeDate: null, state: 'ready', overdueCount: 0, overdueMinor: '0',
};

interface ReadView<T> {
  loadedKey: string;
  status: CashControlStatus;
  data: T;
  error: CashControlErrorView | null;
}

function initialView<T>(key: string, empty: T): ReadView<T> {
  return { loadedKey: key, status: 'loading', data: empty, error: null };
}

export interface CashReadSlice<T> {
  readonly status: CashControlStatus;
  readonly data: T;
  readonly error: CashControlErrorView | null;
  readonly refresh: () => void;
}

/** One independently keyed read slice. `loadAvailable` and `loadOutlook` are
 * two unrelated reads that can change key on different triggers (e.g. only
 * the scenario changes, or only the as-of date), so each tracks its own
 * request generation/AbortController and discards its own stale response --
 * generalizing the single-list `loadedKey`/generation guard `useRecurring`/
 * `useGoals` use, to two independent lists here. Membership loss clears this
 * slice's own visible data and delegates to `onSpaceUnavailable`, same as
 * those hooks. A failed read is left in `error` state; calling `refresh()`
 * retries with the same captured parameters -- there is no UUID or receipt
 * to reconcile since no command was ever sent. */
function useCashReadSlice<T>(
  key: string,
  empty: T,
  load: (signal: AbortSignal) => Promise<T>,
  onSpaceUnavailable?: () => void,
): CashReadSlice<T> {
  const [view, setView] = useState<ReadView<T>>(() => initialView(key, empty));
  const currentKey = useRef(key);
  currentKey.current = key;
  const controllerRef = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const run = useCallback(async (): Promise<boolean> => {
    const targetKey = key;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const myGeneration = ++generation.current;
    setView(initialView(targetKey, empty));
    try {
      const data = await load(controller.signal);
      if (generation.current !== myGeneration || currentKey.current !== targetKey) return false;
      setView({ loadedKey: targetKey, status: 'ready', data, error: null });
      return true;
    } catch (cause) {
      if (controller.signal.aborted) return false;
      if (generation.current !== myGeneration || currentKey.current !== targetKey) return false;
      const errorView = classifyCashControlError(cause);
      if (errorView.code === 'missing_membership') {
        setView(initialView(targetKey, empty));
        onSpaceUnavailable?.();
        return false;
      }
      setView((current) => ({ ...current, loadedKey: targetKey, status: 'error', error: errorView }));
      return false;
    }
  }, [key, empty, load, onSpaceUnavailable]);

  useEffect(() => {
    void run();
    return () => {
      controllerRef.current?.abort();
      generation.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const visible = view.loadedKey === currentKey.current;
  return {
    status: visible ? view.status : 'loading',
    data: visible ? view.data : empty,
    error: visible ? view.error : null,
    refresh: () => void run(),
  };
}

/** Read-only cash-control hook: `loadAvailable`'s
 * `(spaceId,currency,asOfDate)` and `loadOutlook`'s
 * `(spaceId,currency,asOfDate,outlookDays,scenario)` are tracked as two
 * independent slices, so switching the forecast `scenario` alone reloads
 * only the outlook -- it is just a different read parameter, never a
 * mutation, so it creates no journal row and never touches the summary
 * slice's own state. */
export function useCashControl(
  gateway: CashControlGateway,
  spaceId: string,
  currency: Currency,
  asOfDate: string,
  outlookDays: number,
  scenario: CashOutlookScenario,
  onSpaceUnavailable?: () => void,
) {
  const availableKey = `${spaceId}|${currency}|${asOfDate}`;
  const outlookKey = `${spaceId}|${currency}|${asOfDate}|${outlookDays}|${scenario}`;

  const loadAvailable = useCallback(
    (signal: AbortSignal) => gateway.loadAvailable({ spaceId, currency, asOfDate }, signal),
    [gateway, spaceId, currency, asOfDate],
  );
  const loadOutlook = useCallback(
    (signal: AbortSignal) => gateway.loadOutlook({ spaceId, currency, startDate: asOfDate, days: outlookDays, scenario }, signal),
    [gateway, spaceId, currency, asOfDate, outlookDays, scenario],
  );

  const available = useCashReadSlice(availableKey, defaultAvailableCashSummary, loadAvailable, onSpaceUnavailable);
  const outlook = useCashReadSlice(outlookKey, defaultCashOutlook, loadOutlook, onSpaceUnavailable);

  return { available, outlook };
}

export type CashControlState = ReturnType<typeof useCashControl>;
