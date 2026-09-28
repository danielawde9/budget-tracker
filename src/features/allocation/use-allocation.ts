import { useCallback, useEffect, useRef, useState } from 'react';
import type { Currency } from '../loans/types.js';
import { classifyAllocationError, isAmbiguousTransportFailure, type AllocationErrorView } from './errors.js';
import type {
  AllocationCategoryPage,
  AllocationGateway,
  AllocationHistoryPage,
  AllocationMonthState,
  AllocationTrend,
  CloseMonthInput,
  CloseMonthResult,
  ClosePreview,
  CopyMonthInput,
  CopyMonthResult,
  LoadCategoryPageInput,
  LoadHistoryPageInput,
  LoadTrendInput,
  MonthCopyPreview,
  PreviewCloseInput,
  PreviewCopyInput,
  PublishMonthInput,
  PublishMonthResult,
  PublishMonthV2Input,
  SaveTemplateInput,
  SaveTemplateResult,
  SetRolloverInput,
  SetRolloverResult,
  TemplateHeadResult,
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
  result?: SaveTemplateResult | PublishMonthResult | CopyMonthResult | CloseMonthResult | SetRolloverResult;
}

type CommandResult = NonNullable<CommandOutcome['result']>;

function runAllocationCommand(gateway: AllocationGateway, command: RetryCommand): Promise<CommandResult> {
  switch (command.kind) {
    case 'saveTemplate': return gateway.saveTemplate(command.input);
    case 'publishMonth': return gateway.publishMonth(command.input);
    case 'publishMonthV2': return gateway.publishMonthV2(command.input);
    case 'copyMonth': return gateway.copyMonth(command.input);
    case 'closeMonth': return gateway.closeMonth(command.input);
    case 'setRollover': return gateway.setRollover(command.input);
  }
}

const ALLOCATION_COMMAND_NAME: Record<RetryCommand['kind'], string> = {
  saveTemplate: 'save_allocation_template',
  publishMonth: 'publish_allocation_month',
  publishMonthV2: 'publish_allocation_month_v2',
  copyMonth: 'copy_allocation_month',
  closeMonth: 'close_budget_month',
  setRollover: 'set_rollover_policy',
};

export const defaultMonthState: AllocationMonthState = {
  snapshotId: null, templateRevisionId: null, incomeRevisionId: null, hasPlan: false,
  plannedIncomeMinor: null, actualIncomeMinor: '0', expenseMinor: '0', incomeAfterSpendingMinor: '0',
  ownDebtPaidMinor: '0', remainingDebtMinor: '0', leftToAllocateMinor: null, childPlanChanged: false,
  asOf: '',
  groups: [],
};

type SaveTemplateDraft = Omit<SaveTemplateInput, 'spaceId' | 'requestId'>;
type PublishMonthDraft = Omit<PublishMonthInput, 'spaceId' | 'requestId' | 'month' | 'currency'>;
type PublishMonthV2Draft = Omit<PublishMonthV2Input, 'spaceId' | 'requestId' | 'month' | 'currency'>;
type CopyMonthDraft = Omit<CopyMonthInput, 'spaceId' | 'requestId' | 'currency'>;
type CloseMonthDraft = Omit<CloseMonthInput, 'spaceId' | 'requestId' | 'currency' | 'month'>;
type SetRolloverDraft = Omit<SetRolloverInput, 'spaceId' | 'requestId' | 'currency'>;

type RetryCommand =
  | { kind: 'saveTemplate'; requestId: string; input: SaveTemplateInput }
  | { kind: 'publishMonth'; requestId: string; input: PublishMonthInput }
  | { kind: 'publishMonthV2'; requestId: string; input: PublishMonthV2Input }
  | { kind: 'copyMonth'; requestId: string; input: CopyMonthInput }
  | { kind: 'closeMonth'; requestId: string; input: CloseMonthInput }
  | { kind: 'setRollover'; requestId: string; input: SetRolloverInput };

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
      const result = await runAllocationCommand(gateway, command);
      const refreshed = await refreshAfterCommand();
      const outcome: CommandOutcome = { status: refreshed ? 'success' : 'refresh-required', reconciled: false, result };
      settleOutcome(outcome);
      return outcome;
    } catch (cause) {
      if (!isAmbiguousTransportFailure(cause)) throw cause;
      const commandName = ALLOCATION_COMMAND_NAME[command.kind];
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

  const publishMonthV2 = useCallback((draft: PublishMonthV2Draft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    return runCommand({ kind: 'publishMonthV2', requestId, input: { ...draft, spaceId, requestId, month, currency } });
  }, [createRequestId, runCommand, spaceId, month, currency]);

  const retryAmbiguous = useCallback(async (): Promise<CommandOutcome> => {
    if (!retry) throw new Error('There is no unresolved command to retry.');
    return withPending(() => reconcileCommand(retry));
  }, [reconcileCommand, retry, withPending]);
  const clearAmbiguous = useCallback(() => {
    setRetry(null);
    setView((current) => (current.status === 'ambiguous' ? { ...current, status: 'ready' } : current));
  }, []);

  // --- Month transitions (task 21). Reads pass through unchanged; the three
  // commands share the same accepted/ambiguous/retry machinery above, so a
  // copy, close or policy change is idempotent and never double-posts.
  const previewCopy = useCallback((draft: Omit<PreviewCopyInput, 'spaceId' | 'currency'>, signal?: AbortSignal): Promise<MonthCopyPreview> =>
    gateway.previewCopy({ ...draft, spaceId, currency }, signal), [gateway, spaceId, currency]);

  const copyMonth = useCallback((draft: CopyMonthDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    return runCommand({ kind: 'copyMonth', requestId, input: { ...draft, spaceId, requestId, currency } });
  }, [createRequestId, runCommand, spaceId, currency]);

  const previewClose = useCallback((draft: Omit<PreviewCloseInput, 'spaceId' | 'currency'>, signal?: AbortSignal): Promise<ClosePreview> =>
    gateway.previewClose({ ...draft, spaceId, currency }, signal), [gateway, spaceId, currency]);

  const closeMonth = useCallback((draft: CloseMonthDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    return runCommand({ kind: 'closeMonth', requestId, input: { ...draft, spaceId, requestId, currency, month } });
  }, [createRequestId, runCommand, spaceId, currency, month]);

  const setRollover = useCallback((draft: SetRolloverDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    return runCommand({ kind: 'setRollover', requestId, input: { ...draft, spaceId, requestId, currency } });
  }, [createRequestId, runCommand, spaceId, currency]);

  /** Reads another month's allocation state in this same space/currency -- used
   * to discover the previous month's latest snapshot id before a copy preview.
   * Never a command, so it carries no request id. */
  const loadMonthFor = useCallback((targetMonth: string, signal?: AbortSignal): Promise<AllocationMonthState> =>
    gateway.loadMonth({ spaceId, month: targetMonth, currency, snapshotId: null }, signal), [gateway, spaceId, currency]);

  const loadCategoryPage = useCallback((draft: Omit<LoadCategoryPageInput, 'spaceId' | 'month' | 'currency'>, signal?: AbortSignal): Promise<AllocationCategoryPage> =>
    gateway.loadCategoryPage({ ...draft, spaceId, month, currency }, signal), [gateway, spaceId, month, currency]);
  const loadHistoryPage = useCallback((draft: Omit<LoadHistoryPageInput, 'spaceId' | 'month' | 'currency'>, signal?: AbortSignal): Promise<AllocationHistoryPage> =>
    gateway.loadHistoryPage({ ...draft, spaceId, month, currency }, signal), [gateway, spaceId, month, currency]);

  const loadTrend = useCallback((draft: Omit<LoadTrendInput, 'spaceId' | 'currency'>, signal?: AbortSignal): Promise<AllocationTrend> =>
    gateway.loadTrend({ ...draft, spaceId, currency }, signal), [gateway, spaceId, currency]);

  /** The space's current template revision (audit B1) -- fetched fresh at
   * Confirm time, never read off the possibly-null-for-a-new-month snapshot
   * state in `month.templateRevisionId`. */
  const loadTemplateHead = useCallback((signal?: AbortSignal): Promise<TemplateHeadResult> =>
    gateway.loadTemplateHead({ spaceId, currency }, signal), [gateway, spaceId, currency]);

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
    publishMonthV2,
    previewCopy,
    copyMonth,
    previewClose,
    closeMonth,
    setRollover,
    loadMonthFor,
    retryAmbiguous,
    clearAmbiguous,
    loadCategoryPage,
    loadHistoryPage,
    loadTrend,
    loadTemplateHead,
  };
}

export type AllocationState = ReturnType<typeof useAllocation>;
export type { SaveTemplateResult, PublishMonthResult };
