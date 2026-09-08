import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  CreateWalletInput,
  JournalEvent,
  RecordEventInput,
  ReverseEventInput,
  WalletProjection,
  WalletsGateway,
  WalletsSnapshot,
} from './types.js';

export type WalletsStatus = 'loading' | 'ready' | 'error';
export interface CommandOutcome { status: 'success' | 'ambiguous'; reconciled: boolean }

type RecordDraft = Omit<RecordEventInput, 'spaceId' | 'requestId'>;
type ReverseDraft = Omit<ReverseEventInput, 'spaceId' | 'requestId'>;
type RetryCommand =
  | { kind: 'record'; requestId: string; input: RecordEventInput }
  | { kind: 'reverse'; requestId: string; input: ReverseEventInput };

interface WalletsView {
  loadedSpaceId: string;
  status: WalletsStatus;
  wallets: readonly WalletProjection[];
  events: readonly JournalEvent[];
  nextCursor: string | null;
  error: string | null;
}

const emptyView = (spaceId: string): WalletsView => ({
  loadedSpaceId: spaceId,
  status: 'loading',
  wallets: [],
  events: [],
  nextCursor: null,
  error: null,
});

function isAmbiguousTransportFailure(cause: unknown): boolean {
  const message = cause instanceof Error
    ? cause.message
    : cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string'
      ? cause.message
      : '';
  return /network|failed to fetch|load failed|connection|timeout/i.test(message);
}

function isSpaceUnavailable(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : '';
  return /active space membership|selected space is not available|permission denied/i.test(message);
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  return 'We could not load this wallet journal. Check your connection and try again.';
}

export function useWallets(
  gateway: WalletsGateway,
  spaceId: string,
  onSpaceUnavailable?: () => void,
  createRequestId: () => string = () => globalThis.crypto.randomUUID(),
) {
  const [view, setView] = useState<WalletsView>(() => emptyView(spaceId));
  const [pending, setPending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retry, setRetry] = useState<RetryCommand | null>(null);
  const requestSequence = useRef(0);
  const commandPending = useRef(false);
  const currentSpace = useRef(spaceId);
  currentSpace.current = spaceId;

  const applySnapshot = useCallback((targetSpaceId: string, snapshot: WalletsSnapshot) => {
    setView({
      loadedSpaceId: targetSpaceId,
      status: 'ready',
      wallets: snapshot.wallets,
      events: snapshot.history.events,
      nextCursor: snapshot.history.nextCursor,
      error: null,
    });
  }, []);

  const load = useCallback(async () => {
    const targetSpaceId = spaceId;
    const requestId = ++requestSequence.current;
    setView(emptyView(targetSpaceId));
    try {
      const snapshot = await gateway.loadSnapshot(targetSpaceId);
      if (requestSequence.current !== requestId || currentSpace.current !== targetSpaceId) return;
      applySnapshot(targetSpaceId, snapshot);
    } catch (cause) {
      if (requestSequence.current !== requestId || currentSpace.current !== targetSpaceId) return;
      setView({ ...emptyView(targetSpaceId), status: 'error', error: errorMessage(cause) });
      if (isSpaceUnavailable(cause)) onSpaceUnavailable?.();
    }
  }, [applySnapshot, gateway, onSpaceUnavailable, spaceId]);

  useEffect(() => {
    setRetry(null);
    commandPending.current = false;
    setPending(false);
    void load();
    return () => { requestSequence.current += 1; };
  }, [load]);

  const withPending = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    if (commandPending.current) throw new Error('A wallet command is already pending.');
    commandPending.current = true;
    setPending(true);
    try {
      return await action();
    } finally {
      commandPending.current = false;
      setPending(false);
    }
  }, []);

  const refreshAfterCommand = useCallback(async () => {
    setRetry(null);
    await load();
  }, [load]);

  const createWallet = useCallback(async (
    input: Omit<CreateWalletInput, 'spaceId'>,
  ): Promise<CommandOutcome> => withPending(async () => {
    const targetSpaceId = spaceId;
    const normalized = { spaceId: targetSpaceId, name: input.name.trim(), currency: input.currency };
    if (!normalized.name) throw new Error('Enter a wallet name.');
    try {
      await gateway.createWallet(normalized);
      await refreshAfterCommand();
      return { status: 'success', reconciled: false };
    } catch (cause) {
      if (!isAmbiguousTransportFailure(cause)) throw cause;
      const snapshot = await gateway.loadSnapshot(targetSpaceId);
      if (currentSpace.current !== targetSpaceId) throw new Error('The selected space changed before wallet reconciliation completed.');
      applySnapshot(targetSpaceId, snapshot);
      const match = snapshot.wallets.find((wallet) =>
        wallet.spaceId === targetSpaceId
        && wallet.name === normalized.name
        && wallet.currency === normalized.currency,
      );
      if (!match) throw new Error('We checked the visible wallets and found no match. Review the wallet before submitting again.');
      return { status: 'success', reconciled: true };
    }
  }), [applySnapshot, gateway, refreshAfterCommand, spaceId, withPending]);

  const reconcileCommand = useCallback(async (
    command: RetryCommand,
  ): Promise<CommandOutcome> => {
    try {
      if (command.kind === 'record') await gateway.recordEvent(command.input);
      else await gateway.reverseEvent(command.input);
      await refreshAfterCommand();
      return { status: 'success', reconciled: false };
    } catch (cause) {
      if (!isAmbiguousTransportFailure(cause)) throw cause;
      const event = await gateway.findEventByRequestId(command.input.spaceId, command.requestId);
      if (event) {
        await refreshAfterCommand();
        return { status: 'success', reconciled: true };
      }
      setRetry(command);
      return { status: 'ambiguous', reconciled: false };
    }
  }, [gateway, refreshAfterCommand]);

  const recordEvent = useCallback(async (input: RecordDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    const command: RetryCommand = {
      kind: 'record',
      requestId,
      input: { ...input, spaceId, requestId },
    };
    setRetry(null);
    return withPending(() => reconcileCommand(command));
  }, [createRequestId, reconcileCommand, spaceId, withPending]);

  const reverseEvent = useCallback(async (input: ReverseDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    const command: RetryCommand = {
      kind: 'reverse',
      requestId,
      input: { ...input, spaceId, requestId },
    };
    setRetry(null);
    return withPending(() => reconcileCommand(command));
  }, [createRequestId, reconcileCommand, spaceId, withPending]);

  const retryAmbiguous = useCallback(async (): Promise<CommandOutcome> => {
    if (!retry) throw new Error('There is no unchanged command to retry.');
    return withPending(() => reconcileCommand(retry));
  }, [reconcileCommand, retry, withPending]);

  const loadMore = useCallback(async () => {
    if (loadingMore || view.loadedSpaceId !== spaceId || !view.nextCursor) return;
    const cursor = view.nextCursor;
    const targetSpaceId = spaceId;
    const requestId = requestSequence.current;
    setLoadingMore(true);
    try {
      const page = await gateway.loadHistoryPage(targetSpaceId, cursor);
      if (requestSequence.current !== requestId || currentSpace.current !== targetSpaceId) return;
      setView((current) => {
        if (current.loadedSpaceId !== targetSpaceId || current.nextCursor !== cursor) return current;
        const byId = new Map(current.events.map((event) => [event.id, event]));
        for (const event of page.events) byId.set(event.id, event);
        return { ...current, events: [...byId.values()], nextCursor: page.nextCursor };
      });
    } finally {
      if (currentSpace.current === targetSpaceId) setLoadingMore(false);
    }
  }, [gateway, loadingMore, spaceId, view.loadedSpaceId, view.nextCursor]);

  const visible = view.loadedSpaceId === spaceId;
  return {
    status: visible ? view.status : 'loading' as const,
    wallets: visible ? view.wallets : [],
    events: visible ? view.events : [],
    nextCursor: visible ? view.nextCursor : null,
    error: visible ? view.error : null,
    pending,
    loadingMore,
    ambiguous: retry ? { kind: retry.kind, requestId: retry.requestId } : null,
    refresh: load,
    loadMore,
    createWallet,
    recordEvent,
    reverseEvent,
    retryAmbiguous,
    clearAmbiguous: () => setRetry(null),
  };
}
