import { useCallback, useEffect, useRef, useState } from 'react';
import type { Currency } from '../loans/types.js';
import { classifyGoalsError, isAmbiguousTransportFailure, type GoalsErrorView } from './errors.js';
import type {
  CreateGoalInput,
  CreateGoalResult,
  GoalDetail,
  GoalHistoryPage,
  GoalPage,
  GoalStateFilter,
  GoalsGateway,
  LinkPurchaseInput,
  LinkPurchaseResult,
  LoadGoalDetailInput,
  LoadGoalHistoryInput,
  MoveEarmarkInput,
  MoveEarmarkResult,
  ReserveOrReleaseInput,
  ReserveOrReleaseResult,
  ReverseEarmarkInput,
  ReverseEarmarkResult,
  ReviseGoalInput,
  ReviseGoalResult,
  SetMilestoneInput,
  SetMilestoneResult,
  SetMonthlyTargetInput,
  SetMonthlyTargetResult,
} from './types.js';

export type GoalsStatus = 'loading' | 'ready' | 'saving' | 'accepted-refresh-pending' | 'ambiguous' | 'error';

export type CommandResult =
  | CreateGoalResult | ReviseGoalResult | ReserveOrReleaseResult | MoveEarmarkResult
  | ReverseEarmarkResult | LinkPurchaseResult | SetMonthlyTargetResult | SetMilestoneResult;

export interface CommandOutcome {
  status: 'success' | 'ambiguous' | 'refresh-required';
  reconciled: boolean;
  result?: CommandResult;
}

export const defaultGoalPage: GoalPage = { rows: [], hasMore: false, nextCursor: null, asOf: '' };

type CreateDraft = Omit<CreateGoalInput, 'spaceId' | 'requestId'>;
type ReviseDraft = Omit<ReviseGoalInput, 'spaceId' | 'requestId'>;
type ReserveOrReleaseDraft = Omit<ReserveOrReleaseInput, 'spaceId' | 'requestId'>;
type MoveDraft = Omit<MoveEarmarkInput, 'spaceId' | 'requestId'>;
type ReverseDraft = Omit<ReverseEarmarkInput, 'spaceId' | 'requestId'>;
type LinkPurchaseDraft = Omit<LinkPurchaseInput, 'spaceId' | 'requestId'>;
type SetMonthlyTargetDraft = Omit<SetMonthlyTargetInput, 'spaceId' | 'requestId'>;
type SetMilestoneDraft = Omit<SetMilestoneInput, 'spaceId' | 'requestId'>;

type RetryCommand =
  | { kind: 'create'; requestId: string; input: CreateGoalInput }
  | { kind: 'revise'; requestId: string; input: ReviseGoalInput }
  | { kind: 'reserveOrRelease'; requestId: string; input: ReserveOrReleaseInput }
  | { kind: 'move'; requestId: string; input: MoveEarmarkInput }
  | { kind: 'reverse'; requestId: string; input: ReverseEarmarkInput }
  | { kind: 'linkPurchase'; requestId: string; input: LinkPurchaseInput }
  | { kind: 'setMonthlyTarget'; requestId: string; input: SetMonthlyTargetInput }
  | { kind: 'setMilestone'; requestId: string; input: SetMilestoneInput };

const COMMAND_NAME: Record<RetryCommand['kind'], string> = {
  create: 'create_goal_plan',
  revise: 'revise_goal_plan',
  reserveOrRelease: 'record_goal_earmark',
  move: 'move_goal_earmark',
  reverse: 'reverse_goal_earmark',
  linkPurchase: 'link_goal_purchase',
  setMonthlyTarget: 'set_goal_monthly_target',
  setMilestone: 'set_goal_milestone_state',
};

interface GoalsView {
  loadedKey: string;
  status: GoalsStatus;
  page: GoalPage;
  error: GoalsErrorView | null;
}

const defaultCreateRequestId = () => globalThis.crypto.randomUUID();

function viewKey(spaceId: string, currency: Currency, stateFilter: GoalStateFilter): string {
  return `${spaceId}|${currency}|${stateFilter}`;
}

function initialView(spaceId: string, currency: Currency, stateFilter: GoalStateFilter): GoalsView {
  return { loadedKey: viewKey(spaceId, currency, stateFilter), status: 'loading', page: defaultGoalPage, error: null };
}

function runCommandByKind(gateway: GoalsGateway, command: RetryCommand): Promise<CommandResult> {
  switch (command.kind) {
    case 'create': return gateway.create(command.input);
    case 'revise': return gateway.revise(command.input);
    case 'reserveOrRelease': return gateway.reserveOrRelease(command.input);
    case 'move': return gateway.move(command.input);
    case 'reverse': return gateway.reverse(command.input);
    case 'linkPurchase': return gateway.linkPurchase(command.input);
    case 'setMonthlyTarget': return gateway.setMonthlyTarget(command.input);
    case 'setMilestone': return gateway.setMilestone(command.input);
  }
}

export function useGoals(
  gateway: GoalsGateway,
  spaceId: string,
  currency: Currency,
  stateFilter: GoalStateFilter,
  onSpaceUnavailable?: () => void,
  createRequestId: () => string = defaultCreateRequestId,
) {
  const [view, setView] = useState<GoalsView>(() => initialView(spaceId, currency, stateFilter));
  const [retry, setRetry] = useState<RetryCommand | null>(null);
  const commandPending = useRef(false);
  const currentKey = useRef(viewKey(spaceId, currency, stateFilter));
  currentKey.current = viewKey(spaceId, currency, stateFilter);
  const controllerRef = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const load = useCallback(async (preserveCurrent = false): Promise<boolean> => {
    const targetKey = viewKey(spaceId, currency, stateFilter);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const myGeneration = ++generation.current;
    if (!preserveCurrent) setView(initialView(spaceId, currency, stateFilter));
    try {
      const data = await gateway.loadPage(
        { spaceId, currency, stateFilter, afterCreatedAt: null, afterId: null, limit: 25 }, controller.signal,
      );
      if (generation.current !== myGeneration || currentKey.current !== targetKey) return false;
      setView({ loadedKey: targetKey, status: 'ready', page: data, error: null });
      return true;
    } catch (cause) {
      if (controller.signal.aborted) return false;
      if (generation.current !== myGeneration || currentKey.current !== targetKey) return false;
      const errorView = classifyGoalsError(cause);
      if (errorView.code === 'missing_membership') {
        setView(initialView(spaceId, currency, stateFilter));
        onSpaceUnavailable?.();
        return false;
      }
      setView((current) => ({ ...current, loadedKey: targetKey, status: 'error', error: errorView }));
      return false;
    }
  }, [gateway, spaceId, currency, stateFilter, onSpaceUnavailable]);

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
    if (commandPending.current) throw new Error('A goal command is already pending.');
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
        if (currentKey.current === viewKey(command.input.spaceId, currency, stateFilter)) setRetry(command);
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
  }, [gateway, refreshAfterCommand, settleOutcome, currency, stateFilter]);

  const runCommand = useCallback(async (command: RetryCommand): Promise<CommandOutcome> => {
    if (retry) throw new Error('Resolve the pending ambiguous command before starting a new one.');
    setRetry(null);
    try {
      return await withPending(() => reconcileCommand(command));
    } catch (cause) {
      const errorView = classifyGoalsError(cause);
      if (errorView.code === 'missing_membership') {
        setView(initialView(spaceId, currency, stateFilter));
        onSpaceUnavailable?.();
      } else if (errorView.code !== 'timeout') {
        setView((current) => ({ ...current, status: 'ready', error: errorView }));
      }
      throw cause;
    }
  }, [retry, withPending, reconcileCommand, spaceId, currency, stateFilter, onSpaceUnavailable]);

  const create = useCallback((draft: CreateDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    return runCommand({ kind: 'create', requestId, input: { ...draft, spaceId, requestId } });
  }, [createRequestId, runCommand, spaceId]);

  const revise = useCallback((draft: ReviseDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    return runCommand({ kind: 'revise', requestId, input: { ...draft, spaceId, requestId } });
  }, [createRequestId, runCommand, spaceId]);

  const reserveOrRelease = useCallback((draft: ReserveOrReleaseDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    return runCommand({ kind: 'reserveOrRelease', requestId, input: { ...draft, spaceId, requestId } });
  }, [createRequestId, runCommand, spaceId]);

  const move = useCallback((draft: MoveDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    return runCommand({ kind: 'move', requestId, input: { ...draft, spaceId, requestId } });
  }, [createRequestId, runCommand, spaceId]);

  const reverse = useCallback((draft: ReverseDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    return runCommand({ kind: 'reverse', requestId, input: { ...draft, spaceId, requestId } });
  }, [createRequestId, runCommand, spaceId]);

  const linkPurchase = useCallback((draft: LinkPurchaseDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    return runCommand({ kind: 'linkPurchase', requestId, input: { ...draft, spaceId, requestId } });
  }, [createRequestId, runCommand, spaceId]);

  const setMonthlyTarget = useCallback((draft: SetMonthlyTargetDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    return runCommand({ kind: 'setMonthlyTarget', requestId, input: { ...draft, spaceId, requestId } });
  }, [createRequestId, runCommand, spaceId]);

  const setMilestone = useCallback((draft: SetMilestoneDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    return runCommand({ kind: 'setMilestone', requestId, input: { ...draft, spaceId, requestId } });
  }, [createRequestId, runCommand, spaceId]);

  const retryAmbiguous = useCallback(async (): Promise<CommandOutcome> => {
    if (!retry) throw new Error('There is no unresolved command to retry.');
    return withPending(() => reconcileCommand(retry));
  }, [reconcileCommand, retry, withPending]);

  const clearAmbiguous = useCallback(() => {
    setRetry(null);
    setView((current) => (current.status === 'ambiguous' ? { ...current, status: 'ready' } : current));
  }, []);

  const loadDetail = useCallback((draft: Omit<LoadGoalDetailInput, 'spaceId'>, signal?: AbortSignal): Promise<GoalDetail> =>
    gateway.loadDetail({ ...draft, spaceId }, signal), [gateway, spaceId]);

  const loadHistory = useCallback((draft: Omit<LoadGoalHistoryInput, 'spaceId'>, signal?: AbortSignal): Promise<GoalHistoryPage> =>
    gateway.loadHistory({ ...draft, spaceId }, signal), [gateway, spaceId]);

  const loadMore = useCallback((cursor: { afterCreatedAt: string; afterId: string }, limit = 25, signal?: AbortSignal): Promise<GoalPage> =>
    gateway.loadPage({ spaceId, currency, stateFilter, afterCreatedAt: cursor.afterCreatedAt, afterId: cursor.afterId, limit }, signal),
  [gateway, spaceId, currency, stateFilter]);

  const visible = view.loadedKey === currentKey.current;
  return {
    status: visible ? view.status : ('loading' as const),
    page: visible ? view.page : defaultGoalPage,
    error: visible ? view.error : null,
    pending: view.status === 'saving',
    ambiguous: retry ? { kind: retry.kind, requestId: retry.requestId } : null,
    refresh: () => load(),
    create,
    revise,
    reserveOrRelease,
    move,
    reverse,
    linkPurchase,
    setMonthlyTarget,
    setMilestone,
    retryAmbiguous,
    clearAmbiguous,
    loadDetail,
    loadHistory,
    loadMore,
  };
}

export type GoalsState = ReturnType<typeof useGoals>;
