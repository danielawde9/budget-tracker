import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  ArchiveCategoryInput,
  CategoriesGateway,
  Category,
  CategoryCommandResult,
  CategoryKind,
  CategoryPage,
  CategorizedEventInput,
  CreateCategoryInput,
} from './types.js';
import { useCategories } from './use-categories.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const salary: Category = {
  id: 'category-income', spaceId: 'space-1', kind: 'income', nameEn: 'Salary', nameAr: 'راتب',
  createdAt: '2026-09-08T10:00:00Z', archivedAt: null,
};
const groceries: Category = {
  id: 'category-expense', spaceId: 'space-1', kind: 'expense', nameEn: 'Groceries', nameAr: 'بقالة',
  createdAt: '2026-09-08T11:00:00Z', archivedAt: null,
};

class FakeCategoriesGateway implements CategoriesGateway {
  categories = [salary, groceries];
  error: Error | null = null;
  commandResult: CategoryCommandResult | null = null;
  calls: Array<{ name: string; input: unknown }> = [];

  async listCategories(spaceId: string, kind: CategoryKind, cursor?: string): Promise<CategoryPage> {
    this.calls.push({ name: 'listCategories', input: { spaceId, kind, cursor } });
    if (this.error) throw this.error;
    return { categories: this.categories.filter((category) => category.spaceId === spaceId && category.kind === kind), nextCursor: null };
  }

  async createCategory(input: CreateCategoryInput) {
    this.calls.push({ name: 'createCategory', input });
    if (this.error) throw this.error;
    return { id: 'created-category' };
  }

  async archiveCategory(input: ArchiveCategoryInput) {
    this.calls.push({ name: 'archiveCategory', input });
    if (this.error) throw this.error;
    return { id: input.categoryId };
  }

  async getCommandResult(spaceId: string, requestId: string) {
    this.calls.push({ name: 'getCommandResult', input: { spaceId, requestId } });
    return this.commandResult;
  }

  async recordCategorizedEvent(input: CategorizedEventInput) {
    this.calls.push({ name: 'recordCategorizedEvent', input });
    if (this.error) throw this.error;
    return { eventId: 'event-new' };
  }

  async findCategorizedEventByRequestId(spaceId: string, requestId: string) {
    this.calls.push({ name: 'findCategorizedEventByRequestId', input: { spaceId, requestId } });
    return null;
  }

  async resolveEventCategories() { return []; }
}

describe('useCategories', () => {
  it('loads income and expense lists independently and exposes empty states', async () => {
    const gateway = new FakeCategoriesGateway();
    const { result } = renderHook(() => useCategories(gateway, 'space-1'));
    expect(result.current.status).toBe('loading');
    expect(result.current.incomeCategories).toEqual([]);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.incomeCategories).toEqual([salary]);
    expect(result.current.expenseCategories).toEqual([groceries]);
  });

  it('clears old data immediately on space change and ignores late responses', async () => {
    const oldIncome = deferred<{ categories: readonly Category[]; nextCursor: string | null }>();
    const oldExpense = deferred<{ categories: readonly Category[]; nextCursor: string | null }>();
    const gateway = new FakeCategoriesGateway();
    gateway.listCategories = vi.fn(async (spaceId: string, kind: CategoryKind) => {
      if (spaceId === 'space-1') return kind === 'income' ? oldIncome.promise : oldExpense.promise;
      return { categories: [], nextCursor: null };
    });
    const { result, rerender } = renderHook(({ spaceId }) => useCategories(gateway, spaceId), { initialProps: { spaceId: 'space-1' } });
    rerender({ spaceId: 'space-2' });
    expect(result.current.status).toBe('loading');
    expect(result.current.incomeCategories).toEqual([]);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    oldIncome.resolve({ categories: [salary], nextCursor: null });
    oldExpense.resolve({ categories: [groceries], nextCursor: null });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.incomeCategories).toEqual([]);
    expect(result.current.expenseCategories).toEqual([]);
  });

  it('starts clean after an authenticated tree is unmounted and remounted', async () => {
    const gateway = new FakeCategoriesGateway();
    const first = renderHook(() => useCategories(gateway, 'space-1'));
    await waitFor(() => expect(first.result.current.incomeCategories).toEqual([salary]));
    first.unmount();
    gateway.categories = [];
    const second = renderHook(() => useCategories(gateway, 'space-1'));
    expect(second.result.current.incomeCategories).toEqual([]);
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    expect(second.result.current.incomeCategories).toEqual([]);
  });

  it('creates one request ID, refetches server rows, and validates names before submission', async () => {
    const gateway = new FakeCategoriesGateway();
    const ids = ['request-1', 'request-2'];
    const { result } = renderHook(() => useCategories(gateway, 'space-1', undefined, () => ids.shift()!));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await expect(result.current.createCategory({ kind: 'expense', nameEn: '  Food  ', nameAr: null }))
        .resolves.toEqual({ status: 'success', reconciled: false });
    });
    expect(gateway.calls.find((call) => call.name === 'createCategory')?.input).toEqual({
      spaceId: 'space-1', requestId: 'request-1', kind: 'expense', nameEn: 'Food', nameAr: null,
    });
    expect(gateway.calls.filter((call) => call.name === 'listCategories')).toHaveLength(4);

    await act(async () => {
      await expect(result.current.createCategory({ kind: 'income', nameEn: ' ', nameAr: ' ' })).rejects.toThrow('at least one');
      await expect(result.current.createCategory({ kind: 'income', nameEn: 'x'.repeat(121), nameAr: null })).rejects.toThrow('120');
    });
    expect(gateway.calls.filter((call) => call.name === 'createCategory')).toHaveLength(1);
  });

  it('reports an accepted create with a failed refresh without replaying the mutation', async () => {
    const gateway = new FakeCategoriesGateway();
    const listCategories = gateway.listCategories.bind(gateway);
    const createCategory = gateway.createCategory.bind(gateway);
    let readsFail = false;
    gateway.listCategories = vi.fn(async (spaceId, kind, cursor) => {
      if (readsFail) throw new Error('Network unavailable');
      return listCategories(spaceId, kind, cursor);
    });
    gateway.createCategory = vi.fn(async (input) => {
      const result = await createCategory(input);
      readsFail = true;
      return result;
    });
    const { result } = renderHook(() => useCategories(gateway, 'space-1', undefined, () => 'request-create'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await expect(result.current.createCategory({ kind: 'income', nameEn: 'Bonus', nameAr: null }))
        .resolves.toEqual({ status: 'refresh-required', reconciled: false });
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.incomeCategories).toEqual([salary]);
    expect(gateway.createCategory).toHaveBeenCalledOnce();

    readsFail = false;
    await act(async () => {
      await expect(result.current.recoverRefresh()).resolves.toBe(true);
    });
    expect(gateway.createCategory).toHaveBeenCalledOnce();
  });

  it('reconciles ambiguous create without a second mutation when the command result exists', async () => {
    const gateway = new FakeCategoriesGateway();
    gateway.createCategory = vi.fn(async () => { throw new Error('Connection timeout'); });
    gateway.commandResult = { commandKind: 'create_category', categoryId: 'created-category', createdAt: '2026-09-08T12:00:00Z' };
    const { result } = renderHook(() => useCategories(gateway, 'space-1', undefined, () => 'request-create'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await expect(result.current.createCategory({ kind: 'income', nameEn: 'Bonus', nameAr: null }))
        .resolves.toEqual({ status: 'success', reconciled: true });
    });
    expect(gateway.createCategory).toHaveBeenCalledOnce();
    expect(result.current.ambiguous).toBeNull();
  });

  it('offers only an explicit identical retry after ambiguous absence and clears it on edit', async () => {
    const gateway = new FakeCategoriesGateway();
    const create = vi.fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({ id: 'created-category' });
    gateway.createCategory = create;
    const ids = ['request-create', 'request-after-edit'];
    const { result } = renderHook(() => useCategories(gateway, 'space-1', undefined, () => ids.shift()!));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await expect(result.current.createCategory({ kind: 'income', nameEn: 'Bonus', nameAr: null }))
        .resolves.toEqual({ status: 'ambiguous', reconciled: false });
    });
    expect(create).toHaveBeenCalledOnce();
    expect(result.current.ambiguous).toMatchObject({ kind: 'create', requestId: 'request-create' });

    await act(async () => { await result.current.retryAmbiguous(); });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0]).toEqual(create.mock.calls[1]?.[0]);

    gateway.createCategory = vi.fn(async () => ({ id: 'newer' }));
    await act(async () => {
      result.current.clearAmbiguous();
      await result.current.createCategory({ kind: 'income', nameEn: 'Edited bonus', nameAr: null });
    });
    expect(gateway.createCategory).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'request-after-edit', nameEn: 'Edited bonus' }));
  });

  it('archives with matching reconciliation and retains no optimistic removal', async () => {
    const gateway = new FakeCategoriesGateway();
    gateway.archiveCategory = vi.fn(async () => { throw new Error('Network unavailable'); });
    gateway.commandResult = { commandKind: 'archive_category', categoryId: groceries.id, createdAt: '2026-09-08T12:00:00Z' };
    const { result } = renderHook(() => useCategories(gateway, 'space-1', undefined, () => 'archive-request'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let pending!: Promise<unknown>;
    act(() => { pending = result.current.archiveCategory(groceries.id); });
    expect(result.current.expenseCategories).toEqual([groceries]);
    await act(async () => { await pending; });
    expect(gateway.archiveCategory).toHaveBeenCalledWith({ spaceId: 'space-1', requestId: 'archive-request', categoryId: groceries.id });
  });

  it('appends a kind-specific bounded page and reports inaccessible spaces', async () => {
    const gateway = new FakeCategoriesGateway();
    gateway.listCategories = vi.fn(async (spaceId: string, kind: CategoryKind, cursor?: string) => {
      if (spaceId === 'blocked-space') throw new Error('an active space membership is required');
      if (kind === 'income' && !cursor) return { categories: [salary], nextCursor: 'income-next' };
      if (kind === 'income') return { categories: [{ ...salary, id: 'category-bonus', nameEn: 'Bonus' }], nextCursor: null };
      return { categories: [groceries], nextCursor: null };
    });
    const unavailable = vi.fn();
    const { result, rerender } = renderHook(({ spaceId }) => useCategories(gateway, spaceId, unavailable), { initialProps: { spaceId: 'space-1' } });
    await waitFor(() => expect(result.current.incomeNextCursor).toBe('income-next'));
    await act(async () => { await result.current.loadMore('income'); });
    expect(result.current.incomeCategories.map((category) => category.id)).toEqual(['category-income', 'category-bonus']);
    expect(result.current.incomeNextCursor).toBeNull();

    rerender({ spaceId: 'blocked-space' });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(unavailable).toHaveBeenCalledOnce();
    expect(result.current.incomeCategories).toEqual([]);
  });
});
