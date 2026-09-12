import { useCallback, useEffect, useRef, useState } from 'react';

import { classifyCategoryError, type CategoryErrorView } from '../categories/errors.js';
import type { CategoriesGateway, CategorizedEventInput, EventCategory } from '../categories/types.js';
import type {
  CreateWalletInput,
  JournalEvent,
  RecordEventInput,
  RenameWalletInput,
  ReverseEventInput,
  WalletCommandRecord,
  WalletLifecycleInput,
  WalletProjection,
  WalletsGateway,
  WalletsSnapshot,
} from './types.js';

export type WalletsStatus = 'loading' | 'ready' | 'error';
export interface CommandOutcome { status: 'success' | 'ambiguous' | 'refresh-required'; reconciled: boolean }

type RecordDraft = Omit<RecordEventInput, 'spaceId' | 'requestId'> & { categoryId?: string | null };
type ReverseDraft = Omit<ReverseEventInput, 'spaceId' | 'requestId'>;
type RenameDraft = Omit<RenameWalletInput, 'spaceId' | 'requestId'>;
type LifecycleDraft = Omit<WalletLifecycleInput, 'spaceId' | 'requestId'>;
type RetryCommand =
  | { kind: 'record'; requestId: string; input: RecordEventInput; categoryId: string | null }
  | { kind: 'reverse'; requestId: string; input: ReverseEventInput }
  | { kind: 'rename'; requestId: string; input: RenameWalletInput }
  | { kind: 'archive'; requestId: string; input: WalletLifecycleInput }
  | { kind: 'restore'; requestId: string; input: WalletLifecycleInput };

interface WalletsView {
  loadedSpaceId: string;
  status: WalletsStatus;
  wallets: readonly WalletProjection[];
  archivedWallets: readonly WalletProjection[];
  initialEvents: readonly JournalEvent[];
  events: readonly JournalEvent[];
  nextCursor: string | null;
  error: string | null;
  categoryError: CategoryErrorView | null;
}

interface HistoryPaginationError {
  error: string;
  categoryError: CategoryErrorView | null;
}

const emptyView = (spaceId: string): WalletsView => ({
  loadedSpaceId: spaceId,
  status: 'loading',
  wallets: [],
  archivedWallets: [],
  initialEvents: [],
  events: [],
  nextCursor: null,
  error: null,
  categoryError: null,
});

const defaultCreateRequestId = () => globalThis.crypto.randomUUID();

class CategoryProjectionFailure extends Error {
  constructor(readonly categoryError: CategoryErrorView) {
    super(categoryError.message);
  }
}

function isCategoryKind(kind: RecordEventInput['kind']): kind is CategorizedEventInput['kind'] {
  return kind === 'income' || kind === 'expense';
}

function addCategoryLabels(
  events: readonly JournalEvent[],
  associations: readonly EventCategory[],
): readonly JournalEvent[] {
  const byEventId = new Map(associations.map((association) => [association.eventId, association]));
  return events.map((event) => {
    const association = byEventId.get(event.id);
    if (!association) return { ...event, category: null };
    return {
      ...event,
      category: {
        id: association.categoryId,
        kind: association.categoryKind,
        nameEn: association.nameEn,
        nameAr: association.nameAr,
        archivedAt: association.archivedAt,
      },
    };
  });
}

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
  createRequestId: () => string = defaultCreateRequestId,
  categoriesGateway?: CategoriesGateway,
) {
  const [view, setView] = useState<WalletsView>(() => emptyView(spaceId));
  const [pending, setPending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [historyPaginationError, setHistoryPaginationError] = useState<HistoryPaginationError | null>(null);
  const [retry, setRetry] = useState<RetryCommand | null>(null);
  const requestSequence = useRef(0);
  const commandPending = useRef(false);
  const currentSpace = useRef(spaceId);
  currentSpace.current = spaceId;

  const enrichEvents = useCallback(async (
    targetSpaceId: string,
    events: readonly JournalEvent[],
  ): Promise<readonly JournalEvent[]> => {
    if (!categoriesGateway || events.length === 0) return events;
    if (events.length > 20) throw new Error('Wallet history pages must contain at most 20 events.');
    let associations: readonly EventCategory[];
    try {
      associations = await categoriesGateway.resolveEventCategories(
        targetSpaceId,
        events.map((event) => event.id),
      );
    } catch (cause) {
      throw new CategoryProjectionFailure(classifyCategoryError(cause));
    }
    return addCategoryLabels(events, associations);
  }, [categoriesGateway]);

  const applySnapshot = useCallback((targetSpaceId: string, snapshot: WalletsSnapshot) => {
    setHistoryPaginationError(null);
    setView({
      loadedSpaceId: targetSpaceId,
      status: 'ready',
      wallets: snapshot.wallets,
      archivedWallets: snapshot.archivedWallets,
      initialEvents: snapshot.history.events,
      events: snapshot.history.events,
      nextCursor: snapshot.history.nextCursor,
      error: null,
      categoryError: null,
    });
  }, []);

  const load = useCallback(async (preserveCurrent = false, surfaceFailure = true): Promise<boolean> => {
    const targetSpaceId = spaceId;
    const requestId = ++requestSequence.current;
    setHistoryPaginationError(null);
    if (!preserveCurrent) setView(emptyView(targetSpaceId));
    try {
      const snapshot = await gateway.loadSnapshot(targetSpaceId);
      const events = await enrichEvents(targetSpaceId, snapshot.history.events);
      if (requestSequence.current !== requestId || currentSpace.current !== targetSpaceId) return false;
      applySnapshot(targetSpaceId, {
        ...snapshot,
        history: { ...snapshot.history, events },
      });
      return true;
    } catch (cause) {
      if (requestSequence.current !== requestId || currentSpace.current !== targetSpaceId) return false;
      const categoryError = cause instanceof CategoryProjectionFailure ? cause.categoryError : null;
      if (surfaceFailure) setView({
        ...emptyView(targetSpaceId),
        status: 'error',
        error: categoryError?.message ?? errorMessage(cause),
        categoryError,
      });
      if (categoryError?.code === 'missing_membership' || isSpaceUnavailable(cause)) onSpaceUnavailable?.();
      return false;
    }
  }, [applySnapshot, enrichEvents, gateway, onSpaceUnavailable, spaceId]);

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

  const refreshAfterCommand = useCallback(async (preserveOnFailure = false): Promise<boolean> => {
    setRetry(null);
    return load(preserveOnFailure, !preserveOnFailure);
  }, [load]);

  const createWallet = useCallback(async (
    input: Omit<CreateWalletInput, 'spaceId'>,
  ): Promise<CommandOutcome> => withPending(async () => {
    const targetSpaceId = spaceId;
    const normalized = { spaceId: targetSpaceId, name: input.name.trim(), currency: input.currency };
    const knownWalletIds = new Set(
      view.loadedSpaceId === targetSpaceId ? view.wallets.map((wallet) => wallet.id) : [],
    );
    if (!normalized.name) throw new Error('Enter a wallet name.');
    try {
      await gateway.createWallet(normalized);
      const refreshed = await refreshAfterCommand(true);
      return { status: refreshed ? 'success' : 'refresh-required', reconciled: false };
    } catch (cause) {
      if (!isAmbiguousTransportFailure(cause)) throw cause;
      const snapshot = await gateway.loadSnapshot(targetSpaceId);
      if (currentSpace.current !== targetSpaceId) throw new Error('The selected space changed before wallet reconciliation completed.');
      const match = snapshot.wallets.find((wallet) =>
        !knownWalletIds.has(wallet.id)
        && wallet.spaceId === targetSpaceId
        && wallet.name === normalized.name
        && wallet.currency === normalized.currency,
      );
      if (!match) throw new Error('We checked the visible wallets and found no match. Review the wallet before submitting again.');
      setRetry(null);
      setView((current) => current.loadedSpaceId === targetSpaceId
        ? { ...current, wallets: snapshot.wallets, error: null, categoryError: null }
        : current);
      let events: readonly JournalEvent[];
      try {
        events = await enrichEvents(targetSpaceId, snapshot.history.events);
      } catch {
        return { status: 'refresh-required', reconciled: true };
      }
      applySnapshot(targetSpaceId, {
        ...snapshot,
        history: { ...snapshot.history, events },
      });
      return { status: 'success', reconciled: true };
    }
  }), [applySnapshot, enrichEvents, gateway, refreshAfterCommand, spaceId, view.loadedSpaceId, view.wallets, withPending]);

  const walletLifecycleKind = (kind: 'rename' | 'archive' | 'restore') =>
    kind === 'rename' ? 'rename_wallet' as const : kind === 'archive' ? 'archive_wallet' as const : 'restore_wallet' as const;

  const reconcileCommand = useCallback(async (
    command: RetryCommand,
  ): Promise<CommandOutcome> => {
    const categorized = command.kind === 'record' && command.categoryId !== null;
    if (command.kind === 'rename' || command.kind === 'archive' || command.kind === 'restore') {
      try {
        if (command.kind === 'rename') await gateway.renameWallet(command.input);
        else if (command.kind === 'archive') await gateway.archiveWallet(command.input);
        else await gateway.restoreWallet(command.input);
        await refreshAfterCommand(false);
        return { status: 'success', reconciled: false };
      } catch (cause) {
        if (!isAmbiguousTransportFailure(cause)) throw cause;
        let record: WalletCommandRecord | null;
        try {
          record = await gateway.getWalletCommandResult(command.input.spaceId, command.requestId);
        } catch (reconciliationCause) {
          if (currentSpace.current === command.input.spaceId) setRetry(command);
          throw reconciliationCause;
        }
        if (record && record.commandKind === walletLifecycleKind(command.kind) && record.walletId === command.input.walletId) {
          await refreshAfterCommand(false);
          return { status: 'success', reconciled: true };
        }
        setRetry(command);
        return { status: 'ambiguous', reconciled: false };
      }
    }
    try {
      if (command.kind === 'reverse') {
        await gateway.reverseEvent(command.input);
      } else if (command.categoryId) {
        if (!categoriesGateway) throw new Error('Categorized posting is not available.');
        if (!isCategoryKind(command.input.kind)) throw new Error('Only income and expense events can be categorized.');
        await categoriesGateway.recordCategorizedEvent({
          spaceId: command.input.spaceId,
          requestId: command.input.requestId,
          kind: command.input.kind,
          effectiveDate: command.input.effectiveDate,
          movements: command.input.movements,
          categoryId: command.categoryId,
        });
      } else {
        await gateway.recordEvent(command.input);
      }
      const refreshed = await refreshAfterCommand(categorized);
      return { status: categorized && !refreshed ? 'refresh-required' : 'success', reconciled: false };
    } catch (cause) {
      if (!isAmbiguousTransportFailure(cause)) throw cause;
      let event;
      try {
        event = command.kind === 'record' && command.categoryId && categoriesGateway
          ? await categoriesGateway.findCategorizedEventByRequestId(command.input.spaceId, command.requestId)
          : await gateway.findEventByRequestId(command.input.spaceId, command.requestId);
      } catch (reconciliationCause) {
        if (currentSpace.current === command.input.spaceId) setRetry(command);
        throw reconciliationCause;
      }
      if (event) {
        if (command.kind === 'record' && command.categoryId && 'categoryId' in event && event.categoryId !== command.categoryId) {
          throw new Error('The request ID resolved to an event with a different category. Refresh before trying again.');
        }
        const refreshed = await refreshAfterCommand(categorized);
        return { status: categorized && !refreshed ? 'refresh-required' : 'success', reconciled: true };
      }
      setRetry(command);
      return { status: 'ambiguous', reconciled: false };
    }
  }, [categoriesGateway, gateway, refreshAfterCommand]);

  const recordEvent = useCallback(async (input: RecordDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    const { categoryId = null, ...recordInput } = input;
    const command: RetryCommand = {
      kind: 'record',
      requestId,
      input: { ...recordInput, spaceId, requestId },
      categoryId,
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

  const renameWallet = useCallback(async (input: RenameDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    const command: RetryCommand = { kind: 'rename', requestId, input: { ...input, spaceId, requestId } };
    setRetry(null);
    return withPending(() => reconcileCommand(command));
  }, [createRequestId, reconcileCommand, spaceId, withPending]);

  const archiveWallet = useCallback(async (input: LifecycleDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    const command: RetryCommand = { kind: 'archive', requestId, input: { ...input, spaceId, requestId } };
    setRetry(null);
    return withPending(() => reconcileCommand(command));
  }, [createRequestId, reconcileCommand, spaceId, withPending]);

  const restoreWallet = useCallback(async (input: LifecycleDraft): Promise<CommandOutcome> => {
    const requestId = createRequestId();
    const command: RetryCommand = { kind: 'restore', requestId, input: { ...input, spaceId, requestId } };
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
    setHistoryPaginationError(null);
    try {
      const page = await gateway.loadHistoryPage(targetSpaceId, cursor);
      const events = await enrichEvents(targetSpaceId, page.events);
      if (requestSequence.current !== requestId || currentSpace.current !== targetSpaceId) return;
      setView((current) => {
        if (current.loadedSpaceId !== targetSpaceId || current.nextCursor !== cursor) return current;
        const byId = new Map(current.events.map((event) => [event.id, event]));
        for (const event of events) byId.set(event.id, event);
        return { ...current, events: [...byId.values()], nextCursor: page.nextCursor };
      });
    } catch (cause) {
      if (requestSequence.current !== requestId || currentSpace.current !== targetSpaceId) return;
      const categoryError = cause instanceof CategoryProjectionFailure ? cause.categoryError : null;
      setHistoryPaginationError({
        error: categoryError?.message ?? errorMessage(cause),
        categoryError,
      });
      if (categoryError?.code === 'missing_membership' || isSpaceUnavailable(cause)) onSpaceUnavailable?.();
    } finally {
      if (currentSpace.current === targetSpaceId) setLoadingMore(false);
    }
  }, [enrichEvents, gateway, loadingMore, onSpaceUnavailable, spaceId, view.loadedSpaceId, view.nextCursor]);

  const visible = view.loadedSpaceId === spaceId;
  return {
    status: visible ? view.status : 'loading' as const,
    wallets: visible ? view.wallets : [],
    archivedWallets: visible ? view.archivedWallets : [],
    initialEvents: visible ? view.initialEvents : [],
    events: visible ? view.events : [],
    nextCursor: visible ? view.nextCursor : null,
    error: visible ? view.error : null,
    categoryError: visible ? view.categoryError : null,
    historyPaginationError: visible ? historyPaginationError : null,
    pending,
    loadingMore,
    ambiguous: retry ? { kind: retry.kind, requestId: retry.requestId } : null,
    refresh: () => load(),
    recoverRefresh: () => load(true, false),
    loadMore,
    createWallet,
    recordEvent,
    reverseEvent,
    renameWallet,
    archiveWallet,
    restoreWallet,
    retryAmbiguous,
    clearAmbiguous: () => setRetry(null),
  };
}

export type WalletsState = ReturnType<typeof useWallets>;
