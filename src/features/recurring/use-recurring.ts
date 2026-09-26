import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyRecurringError, isAmbiguousTransportFailure, type RecurringErrorView } from './errors.js';
import { loadAllPages, mergeOverdueFirst, PAGE_LIMIT } from './load-all-pages.js';
import type {
  ConfirmInput,
  ConfirmResult,
  LinkExistingInput,
  LinkExistingResult,
  MaterializeInput,
  MaterializeResult,
  OccurrenceStateAction,
  RecurringGateway,
  SaveScheduleInput,
  SaveScheduleResult,
  ScheduledOccurrencePage,
  SetOccurrenceStateInput,
  SetOccurrenceStateResult,
} from './types.js';

export type RecurringStatus = 'loading' | 'ready' | 'saving' | 'accepted-refresh-pending' | 'ambiguous' | 'error';

export type CommandResult =
  | SaveScheduleResult | MaterializeResult | SetOccurrenceStateResult | ConfirmResult | LinkExistingResult;

export interface CommandOutcome {
  status: 'success' | 'ambiguous' | 'refresh-required';
  reconciled: boolean;
  result?: CommandResult;
}

export const defaultOccurrencePage: ScheduledOccurrencePage = { rows: [], hasMore: false, nextCursor: null, asOf: '' };

type SaveScheduleDraft = Omit<SaveScheduleInput, 'spaceId' | 'requestId'>;
type MaterializeDraft = Omit<MaterializeInput, 'spaceId' | 'requestId'>;
type SetOccurrenceStateDraft = Omit<SetOccurrenceStateInput, 'spaceId' | 'requestId'>;
type ConfirmDraft = Omit<ConfirmInput, 'spaceId' | 'requestId'>;
type LinkExistingDraft = Omit<LinkExistingInput, 'spaceId' | 'requestId'>;

type RetryCommand =
  | { kind: 'saveSchedule'; requestId: string; input: SaveScheduleInput }
  | { kind: 'materialize'; requestId: string; input: MaterializeInput }
  | { kind: 'setOccurrenceState'; requestId: string; input: SetOccurrenceStateInput }
  | { kind: 'confirm'; requestId: string; input: ConfirmInput }
  | { kind: 'linkExisting'; requestId: string; input: LinkExistingInput };

const COMMAND_NAME: Record<RetryCommand['kind'], string> = {
  saveSchedule: 'save_schedule',
  materialize: 'materialize_schedule_occurrences',
  setOccurrenceState: 'set_occurrence_state',
  confirm: 'confirm_scheduled_occurrence',
  linkExisting: 'link_scheduled_payment',
};

export interface AmbiguousCommand {
  readonly kind: RetryCommand['kind'];
  readonly requestId: string;
  /** The retried `setOccurrenceState` request's own action ('skip' |
   * 'reopen'), present only for that command kind. A caller that needs to
   * know what a retry actually resolves must read it from here, not from its
   * own local bookkeeping of "what I last started" -- an unrelated command
   * that gets refused outright in the meantime (e.g. `runCommand`'s "a
   * command is already pending" guard) can reset that local state before the
   * retry ever runs (N2). */
  readonly occurrenceAction?: OccurrenceStateAction;
}

function ambiguousFromRetry(command: RetryCommand | null): AmbiguousCommand | null {
  if (!command) return null;
  if (command.kind === 'setOccurrenceState') {
    return { kind: command.kind, requestId: command.requestId, occurrenceAction: command.input.action };
  }
  return { kind: command.kind, requestId: command.requestId };
}

interface RecurringView {
  loadedKey: string;
  status: RecurringStatus;
  page: ScheduledOccurrencePage;
  /** True once either the overdue or the upcoming-window load hit `MAX_PAGES`
   * without exhausting its cursor -- the list is real but incomplete. */
  truncated: boolean;
  error: RecurringErrorView | null;
}

const defaultCreateRequestId = () => globalThis.crypto.randomUUID();

function viewKey(spaceId: string, fromDate: string, toDate: string): string {
  return `${spaceId}|${fromDate}|${toDate}`;
}

function initialView(spaceId: string, fromDate: string, toDate: string): RecurringView {
  return {
    loadedKey: viewKey(spaceId, fromDate, toDate), status: 'loading',
    page: defaultOccurrencePage, truncated: false, error: null,
  };
}

function runCommandByKind(gateway: RecurringGateway, command: RetryCommand): Promise<CommandResult> {
  switch (command.kind) {
    case 'saveSchedule': return gateway.saveSchedule(command.input);
    case 'materialize': return gateway.materialize(command.input);
    case 'setOccurrenceState': return gateway.setOccurrenceState(command.input);
    case 'confirm': return gateway.confirm(command.input);
    case 'linkExisting': return gateway.linkExisting(command.input);
  }
}

export function useRecurring(
  gateway: RecurringGateway,
  spaceId: string,
  fromDate: string,
  toDate: string,
  onSpaceUnavailable?: () => void,
  createRequestId: () => string = defaultCreateRequestId,
) {
  const [view, setView] = useState<RecurringView>(() => initialView(spaceId, fromDate, toDate));
  const [retry, setRetry] = useState<RetryCommand | null>(null);
  const commandPending = useRef(false);
  const currentKey = useRef(viewKey(spaceId, fromDate, toDate));
  currentKey.current = viewKey(spaceId, fromDate, toDate);
  const controllerRef = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const load = useCallback(async (preserveCurrent = false): Promise<boolean> => {
    const targetKey = viewKey(spaceId, fromDate, toDate);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const myGeneration = ++generation.current;
    if (!preserveCurrent) setView(initialView(spaceId, fromDate, toDate));
    try {
      // Overdue bills (before "today", no lower bound) and the forward
      // window are two independent keyset-paged lists -- loaded concurrently,
      // each read in full through the shared bounded pager (`loadAllPages`:
      // MAX_PAGES pages of PAGE_LIMIT rows, stalled-cursor guard), so one
      // huge list can't starve the other and a list past the bound shows the
      // truncation alert rather than silently dropping bills (audit D10).
      let windowAsOf = defaultOccurrencePage.asOf;
      const [overdueResult, windowResult] = await Promise.all([
        loadAllPages((cursor) => gateway.loadOverdue(
          { spaceId, afterDueDate: cursor?.dueDate ?? null, afterId: cursor?.id ?? null, limit: PAGE_LIMIT },
          controller.signal,
        )),
        loadAllPages(async (cursor) => {
          const page = await gateway.loadOccurrences(
            { spaceId, fromDate, toDate, afterDueDate: cursor?.dueDate ?? null, afterId: cursor?.id ?? null, limit: PAGE_LIMIT },
            controller.signal,
          );
          windowAsOf = page.asOf;
          return page;
        }),
      ]);
      if (generation.current !== myGeneration || currentKey.current !== targetKey) return false;
      // Overdue first; a window row already served by the overdue load is
      // dropped rather than shown twice -- a device clock a day off from the
      // server's UTC "today" would otherwise straddle both lists.
      const rows = mergeOverdueFirst(overdueResult.rows, windowResult.rows);
      const data: ScheduledOccurrencePage = { rows, hasMore: false, nextCursor: null, asOf: windowAsOf };
      const truncated = overdueResult.truncated || windowResult.truncated;
      setView({ loadedKey: targetKey, status: 'ready', page: data, truncated, error: null });
      return true;
    } catch (cause) {
      if (controller.signal.aborted) return false;
      if (generation.current !== myGeneration || currentKey.current !== targetKey) return false;
      const errorView = classifyRecurringError(cause);
      if (errorView.code === 'missing_membership') {
        setView(initialView(spaceId, fromDate, toDate));
        onSpaceUnavailable?.();
        return false;
      }
      setView((current) => ({ ...current, loadedKey: targetKey, status: 'error', error: errorView }));
      return false;
    }
  }, [gateway, spaceId, fromDate, toDate, onSpaceUnavailable]);

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
    if (commandPending.current) throw new Error('A recurring command is already pending.');
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
      const result = await runCommandByKind(gateway, command);
      const refreshed = await refreshAfterCommand();
      const outcome: CommandOutcome = { status: refreshed ? 'success' : 'refresh-required', reconciled: false, result };
      settleOutcome(outcome);
      return outcome;
    } catch (cause) {
      if (!isAmbiguousTransportFailure(cause)) throw cause;
      const commandName = COMMAND_NAME[command.kind];
      let receipt;
      try {
        receipt = await gateway.findCommand(command.input.spaceId, command.requestId);
      } catch (lookupCause) {
        if (currentKey.current === viewKey(command.input.spaceId, fromDate, toDate)) setRetry(command);
        setView((current) => ({ ...current, status: 'ambiguous' }));
        throw lookupCause;
      }
      if (receipt && receipt.command === commandName) {
        const refreshed = await refreshAfterCommand();
        const outcome: CommandOutcome = {
          status: refreshed ? 'success' : 'refresh-required', reconciled: true,
          result: receipt.result as CommandResult,
        };
        settleOutcome(outcome);
        return outcome;
      }
      setRetry(command);
      const outcome: CommandOutcome = { status: 'ambiguous', reconciled: false };
      settleOutcome(outcome);
      return outcome;
    }
  }, [gateway, refreshAfterCommand, settleOutcome, fromDate, toDate]);

  const runCommand = useCallback(async (command: RetryCommand): Promise<CommandOutcome> => {
    if (retry) throw new Error('Resolve the pending ambiguous command before starting a new one.');
    setRetry(null);
    try {
      return await withPending(() => reconcileCommand(command));
    } catch (cause) {
      const errorView = classifyRecurringError(cause);
      if (errorView.code === 'missing_membership') {
        setView(initialView(spaceId, fromDate, toDate));
        onSpaceUnavailable?.();
      } else if (errorView.code !== 'timeout') {
        setView((current) => ({ ...current, status: 'ready', error: errorView }));
      }
      throw cause;
    }
  }, [retry, withPending, reconcileCommand, spaceId, fromDate, toDate, onSpaceUnavailable]);

  const saveSchedule = useCallback((draft: SaveScheduleDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    return runCommand({ kind: 'saveSchedule', requestId, input: { ...draft, spaceId, requestId } });
  }, [createRequestId, runCommand, spaceId]);

  const materialize = useCallback((draft: MaterializeDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    return runCommand({ kind: 'materialize', requestId, input: { ...draft, spaceId, requestId } });
  }, [createRequestId, runCommand, spaceId]);

  const setOccurrenceState = useCallback((draft: SetOccurrenceStateDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    return runCommand({ kind: 'setOccurrenceState', requestId, input: { ...draft, spaceId, requestId } });
  }, [createRequestId, runCommand, spaceId]);

  const confirm = useCallback((draft: ConfirmDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    return runCommand({ kind: 'confirm', requestId, input: { ...draft, spaceId, requestId } });
  }, [createRequestId, runCommand, spaceId]);

  const linkExisting = useCallback((draft: LinkExistingDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    return runCommand({ kind: 'linkExisting', requestId, input: { ...draft, spaceId, requestId } });
  }, [createRequestId, runCommand, spaceId]);

  const retryAmbiguous = useCallback(async (): Promise<CommandOutcome> => {
    if (!retry) throw new Error('There is no unresolved command to retry.');
    return withPending(() => reconcileCommand(retry));
  }, [reconcileCommand, retry, withPending]);

  const clearAmbiguous = useCallback(() => {
    setRetry(null);
    setView((current) => (current.status === 'ambiguous' ? { ...current, status: 'ready' } : current));
  }, []);

  const visible = view.loadedKey === currentKey.current;
  return {
    status: visible ? view.status : ('loading' as const),
    page: visible ? view.page : defaultOccurrencePage,
    truncated: visible ? view.truncated : false,
    error: visible ? view.error : null,
    pending: view.status === 'saving',
    ambiguous: ambiguousFromRetry(retry),
    refresh: () => load(),
    saveSchedule,
    materialize,
    setOccurrenceState,
    confirm,
    linkExisting,
    retryAmbiguous,
    clearAmbiguous,
  };
}

export type RecurringState = ReturnType<typeof useRecurring>;
