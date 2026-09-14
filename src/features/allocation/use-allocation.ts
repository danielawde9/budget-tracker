import { useCallback, useEffect, useRef, useState } from 'react';
import type { Currency } from '../loans/types.js';
import { classifyAllocationError, isAmbiguousTransportFailure, type AllocationErrorView } from './errors.js';
import type {
  AllocationCategoryPage,
  AllocationGateway,
  AllocationHistoryPage,
  AllocationMonthState,
  AllocationTrend,
  LoadCategoryPageInput,
  LoadHistoryPageInput,
  LoadTrendInput,
  PublishMonthInput,
  PublishMonthResult,
  SaveTemplateInput,
  SaveTemplateResult,
} from './types.js';

export type AllocationStatus = 'loading' | 'ready' | 'saving' | 'accepted-refresh-pending' | 'ambiguous' | 'error';
export interface CommandOutcome {
  status: 'success' | 'ambiguous' | 'refresh-required';
  reconciled: boolean;
  /** The command's own result (e.g. the new templateRevisionId), present on
   * 'success'/'refresh-required' -- absent while 'ambiguous', since nothing
   * confirmed happened yet. Lets a caller chain saveTemplate -> publishMonth
   * as one logical "Confirm" without the hook itself bundling the two SQL
   * commands into a single non-idempotent unit. */
  result?: SaveTemplateResult | PublishMonthResult;
}

export const defaultMonthState: AllocationMonthState = {
  snapshotId: null, templateRevisionId: null, incomeRevisionId: null, hasPlan: false,
  plannedIncomeMinor: null, actualIncomeMinor: '0', expenseMinor: '0', incomeAfterSpendingMinor: '0',
  ownDebtPaidMinor: '0', remainingDebtMinor: '0', leftToAllocateMinor: null, childPlanChanged: false,
  asOf: '',
  groups: [],
};

type SaveTemplateDraft = Omit<SaveTemplateInput, 'spaceId' | 'requestId'>;
type PublishMonthDraft = Omit<PublishMonthInput, 'spaceId' | 'requestId' | 'month' | 'currency'>;

type RetryCommand =
  | { kind: 'saveTemplate'; requestId: string; input: SaveTemplateInput }
  | { kind: 'publishMonth'; requestId: string; input: PublishMonthInput };

interface AllocationView {
  loadedKey: string;
  status: AllocationStatus;
  month: AllocationMonthState;
  error: AllocationErrorView | null;
}

const defaultCreateRequestId = () => globalThis.crypto.randomUUID();

function viewKey(spaceId: string, month: string, currency: Currency): string {
  return `${spaceId}|${month}|${currency}`;
}

function initialView(spaceId: string, month: string, currency: Currency): AllocationView {
  return { loadedKey: viewKey(spaceId, month, currency), status: 'loading', month: defaultMonthState, error: null };
}

export function useAllocation(
  gateway: AllocationGateway,
  spaceId: string,
  month: string,
  currency: Currency,
  onSpaceUnavailable?: () => void,
  createRequestId: () => string = defaultCreateRequestId,
) {
  const [view, setView] = useState<AllocationView>(() => initialView(spaceId, month, currency));
  const [retry, setRetry] = useState<RetryCommand | null>(null);
  const commandPending = useRef(false);
  const currentKey = useRef(viewKey(spaceId, month, currency));
  currentKey.current = viewKey(spaceId, month, currency);
  const controllerRef = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const load = useCallback(async (preserveCurrent = false): Promise<boolean> => {
    const targetKey = viewKey(spaceId, month, currency);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const myGeneration = ++generation.current;
    if (!preserveCurrent) setView(initialView(spaceId, month, currency));
    try {
      const data = await gateway.loadMonth({ spaceId, month, currency, snapshotId: null }, controller.signal);
      if (generation.current !== myGeneration || currentKey.current !== targetKey) return false;
      setView({ loadedKey: targetKey, status: 'ready', month: data, error: null });
      return true;
    } catch (cause) {
      if (controller.signal.aborted) return false;
      if (generation.current !== myGeneration || currentKey.current !== targetKey) return false;
      const errorView = classifyAllocationError(cause);
      if (errorView.code === 'missing_membership') {
        setView(initialView(spaceId, month, currency));
        onSpaceUnavailable?.();
        return false;
      }
      setView((current) => ({ ...current, loadedKey: targetKey, status: 'error', error: errorView }));
      return false;
    }
  }, [gateway, spaceId, month, currency, onSpaceUnavailable]);

  useEffect(() => {
    setRetry(null);
    commandPending.current = false;
    void load();
    return () => {
      controllerRef.current?.abort();
      generation.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const refreshAfterCommand = useCallback(async (): Promise<boolean> => {
    setRetry(null);
    return load(true);
  }, [load]);

  const withPending = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    if (commandPending.current) throw new Error('An allocation command is already pending.');
    commandPending.current = true;
    setView((current) => ({ ...current, status: 'saving' }));
    try {
      return await action();
    } finally {
      commandPending.current = false;
    }
  }, []);

  const settleOutcome = useCallback((outcome: CommandOutcome) => {
    setView((current) => ({
      ...current,
      status: outcome.status === 'ambiguous'
        ? 'ambiguous'
        : outcome.status === 'refresh-required' ? 'accepted-refresh-pending' : current.status,
    }));
  }, []);

  const reconcileCommand = useCallback(async (command: RetryCommand): Promise<CommandOutcome> => {
    try {
      const result = command.kind === 'saveTemplate' ? await gateway.saveTemplate(command.input) : await gateway.publishMonth(command.input);
      const refreshed = await refreshAfterCommand();
      const outcome: CommandOutcome = { status: refreshed ? 'success' : 'refresh-required', reconciled: false, result };
      settleOutcome(outcome);
      return outcome;
    } catch (cause) {
      if (!isAmbiguousTransportFailure(cause)) throw cause;
      const commandName = command.kind === 'saveTemplate' ? 'save_allocation_template' : 'publish_allocation_month';
      let receipt;
      try {
        receipt = await gateway.findCommand(command.input.spaceId, command.requestId);
      } catch (lookupCause) {
        if (currentKey.current === viewKey(command.input.spaceId, month, currency)) setRetry(command);
        setView((current) => ({ ...current, status: 'ambiguous' }));
        throw lookupCause;
      }
      if (receipt && receipt.command === commandName) {
        const refreshed = await refreshAfterCommand();
        const outcome: CommandOutcome = {
          status: refreshed ? 'success' : 'refresh-required', reconciled: true,
          result: receipt.result as SaveTemplateResult | PublishMonthResult,
        };
        settleOutcome(outcome);
        return outcome;
      }
      setRetry(command);
      const outcome: CommandOutcome = { status: 'ambiguous', reconciled: false };
      settleOutcome(outcome);
      return outcome;
    }
  }, [gateway, refreshAfterCommand, settleOutcome, month, currency]);

  const runCommand = useCallback(async (command: RetryCommand): Promise<CommandOutcome> => {
    if (retry) throw new Error('Resolve the pending ambiguous command before starting a new one.');
    setRetry(null);
    try {
      return await withPending(() => reconcileCommand(command));
    } catch (cause) {
      const errorView = classifyAllocationError(cause);
      if (errorView.code === 'missing_membership') {
        setView(initialView(spaceId, month, currency));
        onSpaceUnavailable?.();
      } else if (errorView.code !== 'timeout') {
        setView((current) => ({ ...current, status: 'ready', error: errorView }));
      }
      throw cause;
    }
  }, [retry, withPending, reconcileCommand, spaceId, month, currency, onSpaceUnavailable]);

  const saveTemplate = useCallback((draft: SaveTemplateDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    return runCommand({ kind: 'saveTemplate', requestId, input: { ...draft, spaceId, requestId } });
  }, [createRequestId, runCommand, spaceId]);

  const publishMonth = useCallback((draft: PublishMonthDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    return runCommand({ kind: 'publishMonth', requestId, input: { ...draft, spaceId, requestId, month, currency } });
  }, [createRequestId, runCommand, spaceId, month, currency]);

  const retryAmbiguous = useCallback(async (): Promise<CommandOutcome> => {
    if (!retry) throw new Error('There is no unresolved command to retry.');
    return withPending(() => reconcileCommand(retry));
  }, [reconcileCommand, retry, withPending]);

  const clearAmbiguous = useCallback(() => {
    setRetry(null);
    setView((current) => (current.status === 'ambiguous' ? { ...current, status: 'ready' } : current));
  }, []);

  const loadCategoryPage = useCallback((draft: Omit<LoadCategoryPageInput, 'spaceId' | 'month' | 'currency'>, signal?: AbortSignal): Promise<AllocationCategoryPage> =>
    gateway.loadCategoryPage({ ...draft, spaceId, month, currency }, signal), [gateway, spaceId, month, currency]);

  const loadHistoryPage = useCallback((draft: Omit<LoadHistoryPageInput, 'spaceId' | 'month' | 'currency'>, signal?: AbortSignal): Promise<AllocationHistoryPage> =>
    gateway.loadHistoryPage({ ...draft, spaceId, month, currency }, signal), [gateway, spaceId, month, currency]);

  const loadTrend = useCallback((draft: Omit<LoadTrendInput, 'spaceId' | 'currency'>, signal?: AbortSignal): Promise<AllocationTrend> =>
    gateway.loadTrend({ ...draft, spaceId, currency }, signal), [gateway, spaceId, currency]);

  const visible = view.loadedKey === currentKey.current;
  return {
    status: visible ? view.status : ('loading' as const),
    month: visible ? view.month : defaultMonthState,
    error: visible ? view.error : null,
    pending: view.status === 'saving',
    ambiguous: retry ? { kind: retry.kind, requestId: retry.requestId } : null,
    refresh: () => load(),
    saveTemplate,
    publishMonth,
    retryAmbiguous,
    clearAmbiguous,
    loadCategoryPage,
    loadHistoryPage,
    loadTrend,
  };
}

export type AllocationState = ReturnType<typeof useAllocation>;
export type { SaveTemplateResult, PublishMonthResult };
