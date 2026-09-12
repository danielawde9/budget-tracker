import { useCallback, useEffect, useRef, useState } from 'react';
import type { BudgetCategoryRow, BudgetCurrencySummary, PlanClient } from './types.js';
import type { Currency } from '../loans/types.js';

const defaultCreateRequestId = () => crypto.randomUUID();

export interface PlanState {
  status: 'loading' | 'ready' | 'error';
  summaries: readonly BudgetCurrencySummary[];
  categoryRows: readonly BudgetCategoryRow[];
  pending: boolean;
  error: string | null;
  refresh(): Promise<void>;
  setIncomePlan(input: { currency: Currency; amountMinor: string; expectedRevisionId: string | null }): Promise<boolean>;
  setCategoryTarget(input: { categoryId: string; currency: Currency; amountMinor: string; expectedRevisionId: string | null }): Promise<boolean>;
}

export function usePlan(
  client: PlanClient,
  spaceId: string,
  month: string,
  createRequestId: () => string = defaultCreateRequestId,
): PlanState {
  const [status, setStatus] = useState<PlanState['status']>('loading');
  const [summaries, setSummaries] = useState<readonly BudgetCurrencySummary[]>([]);
  const [categoryRows, setCategoryRows] = useState<readonly BudgetCategoryRow[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const [summaryRows, categoryPage] = await Promise.all([
        client.loadCurrencySummary(spaceId, month),
        client.loadCategoryPage(spaceId, month),
      ]);
      if (sequence.current !== request) return;
      setSummaries(summaryRows);
      setCategoryRows(categoryPage.rows);
      setError(null);
      setStatus('ready');
    } catch (cause) {
      if (sequence.current !== request) return;
      setError(cause instanceof Error ? cause.message : 'Could not load the monthly plan.');
      setStatus('error');
    }
  }, [client, spaceId, month]);

  useEffect(() => {
    setStatus('loading');
    void load();
  }, [load]);

  const post = useCallback(async (fn: (requestId: string) => Promise<unknown>): Promise<boolean> => {
    // Plan commands replay idempotently by request id, so a caller may retry this
    // promise after an ambiguous transport failure without double-posting.
    setPending(true);
    try {
      await fn(createRequestId());
      await load();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the plan.');
      return false;
    } finally {
      setPending(false);
    }
  }, [createRequestId, load]);

  return {
    status, summaries, categoryRows, pending, error,
    refresh: load,
    setIncomePlan: (input) => post((requestId) => client.setIncomePlan({ spaceId, requestId, month, ...input })),
    setCategoryTarget: (input) => post((requestId) => client.setCategoryTarget({ spaceId, requestId, month, ...input })),
  };
}
