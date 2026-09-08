import { useCallback, useEffect, useRef, useState } from 'react';

import { classifyCategoryError, isAmbiguousTransportFailure, type CategoryErrorView } from './errors.js';
import type {
  ArchiveCategoryInput,
  CategoriesGateway,
  Category,
  CategoryKind,
  CreateCategoryInput,
} from './types.js';

export interface CategoryCommandOutcome {
  status: 'success' | 'ambiguous' | 'refresh-required';
  reconciled: boolean;
}

export interface CreateCategoryDraft {
  kind: CategoryKind;
  nameEn: string | null;
  nameAr: string | null;
}

type RetryCommand =
  | { kind: 'create'; requestId: string; input: CreateCategoryInput }
  | { kind: 'archive'; requestId: string; input: ArchiveCategoryInput };

interface CategoriesView {
  loadedSpaceId: string;
  status: 'loading' | 'ready' | 'error';
  incomeCategories: readonly Category[];
  expenseCategories: readonly Category[];
  incomeNextCursor: string | null;
  expenseNextCursor: string | null;
  error: CategoryErrorView | null;
  paginationError: { kind: CategoryKind; error: CategoryErrorView } | null;
}

function emptyView(spaceId: string): CategoriesView {
  return {
    loadedSpaceId: spaceId,
    status: 'loading',
    incomeCategories: [],
    expenseCategories: [],
    incomeNextCursor: null,
    expenseNextCursor: null,
    error: null,
    paginationError: null,
  };
}

function normalizeDraft(draft: CreateCategoryDraft): CreateCategoryDraft {
  const nameEn = draft.nameEn?.trim() || null;
  const nameAr = draft.nameAr?.trim() || null;
  if (!nameEn && !nameAr) throw new Error('Enter at least one category name.');
  if ((nameEn?.length ?? 0) > 120 || (nameAr?.length ?? 0) > 120) {
    throw new Error('Category names must be 120 characters or fewer.');
  }
  return { ...draft, nameEn, nameAr };
}

function inaccessible(error: CategoryErrorView): boolean {
  return error.code === 'missing_membership';
}

export function useCategories(
  gateway: CategoriesGateway,
  spaceId: string,
  onSpaceUnavailable?: () => void,
  createRequestId: () => string = () => globalThis.crypto.randomUUID(),
) {
  const [view, setView] = useState<CategoriesView>(() => emptyView(spaceId));
  const [pending, setPending] = useState(false);
  const [loadingMore, setLoadingMore] = useState<CategoryKind | null>(null);
  const [retry, setRetry] = useState<RetryCommand | null>(null);
  const requestSequence = useRef(0);
  const commandPending = useRef(false);
  const currentSpace = useRef(spaceId);
  currentSpace.current = spaceId;

  const load = useCallback(async (preserveCurrent = false, surfaceFailure = true): Promise<boolean> => {
    const targetSpaceId = spaceId;
    const sequence = ++requestSequence.current;
    if (!preserveCurrent) setView(emptyView(targetSpaceId));
    try {
      const [income, expense] = await Promise.all([
        gateway.listCategories(targetSpaceId, 'income'),
        gateway.listCategories(targetSpaceId, 'expense'),
      ]);
      if (sequence !== requestSequence.current || currentSpace.current !== targetSpaceId) return false;
      setView({
        loadedSpaceId: targetSpaceId,
        status: 'ready',
        incomeCategories: income.categories,
        expenseCategories: expense.categories,
        incomeNextCursor: income.nextCursor,
        expenseNextCursor: expense.nextCursor,
        error: null,
        paginationError: null,
      });
      return true;
    } catch (cause) {
      if (sequence !== requestSequence.current || currentSpace.current !== targetSpaceId) return false;
      const error = classifyCategoryError(cause);
      if (surfaceFailure) setView({ ...emptyView(targetSpaceId), status: 'error', error });
      if (inaccessible(error)) onSpaceUnavailable?.();
      return false;
    }
  }, [gateway, onSpaceUnavailable, spaceId]);

  useEffect(() => {
    setRetry(null);
    commandPending.current = false;
    setPending(false);
    setLoadingMore(null);
    void load();
    return () => { requestSequence.current += 1; };
  }, [load]);

  const withPending = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    if (commandPending.current) throw new Error('A category command is already pending.');
    commandPending.current = true;
    setPending(true);
    try {
      return await action();
    } finally {
      commandPending.current = false;
      setPending(false);
    }
  }, []);

  const reconcile = useCallback(async (command: RetryCommand): Promise<CategoryCommandOutcome> => {
    try {
      if (command.kind === 'create') await gateway.createCategory(command.input);
      else await gateway.archiveCategory(command.input);
    } catch (cause) {
      if (!isAmbiguousTransportFailure(cause)) throw cause;
      const result = await gateway.getCommandResult(command.input.spaceId, command.requestId);
      const expectedKind = command.kind === 'create' ? 'create_category' : 'archive_category';
      const matchingCategory = command.kind === 'create' || result?.categoryId === command.input.categoryId;
      if (!result) {
        if (currentSpace.current === command.input.spaceId) setRetry(command);
        return { status: 'ambiguous', reconciled: false };
      }
      if (result.commandKind !== expectedKind || !matchingCategory) {
        throw new Error('The recovered category command does not match the submitted request.');
      }
      if (currentSpace.current !== command.input.spaceId) {
        throw new Error('The selected space changed before category reconciliation completed.');
      }
      const refreshed = await load(true, false);
      setRetry(null);
      return { status: refreshed ? 'success' : 'refresh-required', reconciled: true };
    }
    if (currentSpace.current !== command.input.spaceId) {
      throw new Error('The selected space changed before the category command completed.');
    }
    const refreshed = await load(true, false);
    setRetry(null);
    return { status: refreshed ? 'success' : 'refresh-required', reconciled: false };
  }, [gateway, load]);

  const createCategory = useCallback(async (draft: CreateCategoryDraft): Promise<CategoryCommandOutcome> => {
    const normalized = normalizeDraft(draft);
    const requestId = createRequestId();
    const command: RetryCommand = {
      kind: 'create',
      requestId,
      input: { ...normalized, spaceId, requestId },
    };
    setRetry(null);
    return withPending(() => reconcile(command));
  }, [createRequestId, reconcile, spaceId, withPending]);

  const archiveCategory = useCallback(async (categoryId: string): Promise<CategoryCommandOutcome> => {
    const requestId = createRequestId();
    const command: RetryCommand = {
      kind: 'archive',
      requestId,
      input: { spaceId, requestId, categoryId },
    };
    setRetry(null);
    return withPending(() => reconcile(command));
  }, [createRequestId, reconcile, spaceId, withPending]);

  const retryAmbiguous = useCallback(async (): Promise<CategoryCommandOutcome> => {
    if (!retry) throw new Error('There is no unchanged category command to retry.');
    return withPending(() => reconcile(retry));
  }, [reconcile, retry, withPending]);

  const loadMore = useCallback(async (kind: CategoryKind) => {
    const targetSpaceId = spaceId;
    const cursor = kind === 'income' ? view.incomeNextCursor : view.expenseNextCursor;
    if (!cursor || loadingMore || view.loadedSpaceId !== targetSpaceId) return;
    const sequence = requestSequence.current;
    setLoadingMore(kind);
    setView((current) => ({
      ...current,
      paginationError: current.paginationError?.kind === kind ? null : current.paginationError,
    }));
    try {
      const page = await gateway.listCategories(targetSpaceId, kind, cursor);
      if (sequence !== requestSequence.current || currentSpace.current !== targetSpaceId) return;
      setView((current) => {
        if (current.loadedSpaceId !== targetSpaceId) return current;
        const existing = kind === 'income' ? current.incomeCategories : current.expenseCategories;
        const byId = new Map(existing.map((category) => [category.id, category]));
        for (const category of page.categories) byId.set(category.id, category);
        return kind === 'income'
          ? { ...current, incomeCategories: [...byId.values()], incomeNextCursor: page.nextCursor }
          : { ...current, expenseCategories: [...byId.values()], expenseNextCursor: page.nextCursor };
      });
    } catch (cause) {
      if (sequence === requestSequence.current && currentSpace.current === targetSpaceId) {
        setView((current) => ({ ...current, paginationError: { kind, error: classifyCategoryError(cause) } }));
      }
    } finally {
      if (currentSpace.current === targetSpaceId) setLoadingMore(null);
    }
  }, [gateway, loadingMore, spaceId, view.expenseNextCursor, view.incomeNextCursor, view.loadedSpaceId]);

  const visible = view.loadedSpaceId === spaceId;
  return {
    status: visible ? view.status : 'loading' as const,
    incomeCategories: visible ? view.incomeCategories : [],
    expenseCategories: visible ? view.expenseCategories : [],
    incomeNextCursor: visible ? view.incomeNextCursor : null,
    expenseNextCursor: visible ? view.expenseNextCursor : null,
    error: visible ? view.error : null,
    paginationError: visible ? view.paginationError : null,
    pending,
    loadingMore,
    ambiguous: retry ? { kind: retry.kind, requestId: retry.requestId } : null,
    refresh: () => load(),
    recoverRefresh: () => load(true, false),
    loadMore,
    createCategory,
    archiveCategory,
    retryAmbiguous,
    clearAmbiguous: () => setRetry(null),
  };
}
