import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CategoriesGateway } from '../categories/types.js';
import { createSupabaseWalletsGateway } from './supabase-wallets-gateway.js';
import type { JournalEvent, WalletsGateway, WalletsSnapshot } from './types.js';
import { useWallets } from './use-wallets.js';

const emptySnapshot: WalletsSnapshot = { wallets: [], archivedWallets: [], history: { events: [], nextCursor: null } };
const walletSnapshot: WalletsSnapshot = {
  wallets: [{ id: 'wallet-1', spaceId: 'space-1', name: 'Daily', currency: 'USD', archivedAt: null, balanceMinor: '1000' }],
  archivedWallets: [],
  history: { events: [], nextCursor: null },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function gateway(overrides: Partial<WalletsGateway> = {}): WalletsGateway {
  return {
    loadSnapshot: vi.fn(async () => emptySnapshot),
    loadHistoryPage: vi.fn(async () => ({ events: [], nextCursor: null })),
    createWallet: vi.fn(async () => ({ id: 'wallet-new' })),
    renameWallet: vi.fn(async () => ({ id: 'wallet-1' })),
    archiveWallet: vi.fn(async () => ({ id: 'wallet-1' })),
    restoreWallet: vi.fn(async () => ({ id: 'wallet-1' })),
    getWalletCommandResult: vi.fn(async () => null),
    recordEvent: vi.fn(async () => ({ eventId: 'event-new' })),
    reverseEvent: vi.fn(async () => ({ eventId: 'reversal-new' })),
    findEventByRequestId: vi.fn(async () => null),
    ...overrides,
  };
}

function categoriesGateway(overrides: Partial<CategoriesGateway> = {}): CategoriesGateway {
  return {
    listCategories: vi.fn(async () => ({ categories: [], nextCursor: null })),
    createCategory: vi.fn(async () => ({ id: 'category-new' })),
    createSubcategory: vi.fn(async () => ({ id: 'subcategory-new' })),
    archiveCategory: vi.fn(async () => ({ id: 'category-1' })),
    getCommandResult: vi.fn(async () => null),
    recordCategorizedEvent: vi.fn(async () => ({ eventId: 'event-new' })),
    findCategorizedEventByRequestId: vi.fn(async () => null),
    resolveEventCategories: vi.fn(async () => []),
    ...overrides,
  };
}

describe('useWallets', () => {
  it('clears the prior projection immediately and ignores its late response when spaces change', async () => {
    const first = deferred<WalletsSnapshot>();
    const second = deferred<WalletsSnapshot>();
    const service = gateway({ loadSnapshot: vi.fn((spaceId) => spaceId === 'space-1' ? first.promise : second.promise) });
    const { result, rerender } = renderHook(({ spaceId }) => useWallets(service, spaceId), { initialProps: { spaceId: 'space-1' } });
    rerender({ spaceId: 'space-2' });
    expect(result.current.status).toBe('loading');
    expect(result.current.wallets).toEqual([]);
    second.resolve({ wallets: [{ ...walletSnapshot.wallets[0]!, id: 'wallet-2', spaceId: 'space-2', name: 'Home' }], archivedWallets: [], history: { events: [], nextCursor: null } });
    await waitFor(() => expect(result.current.wallets[0]?.name).toBe('Home'));
    first.resolve(walletSnapshot);
    await act(async () => { await Promise.resolve(); });
    expect(result.current.wallets[0]?.name).toBe('Home');
  });

  it('reconciles an ambiguous wallet creation by normalized name and currency without retrying', async () => {
    const loadSnapshot = vi.fn().mockResolvedValueOnce(emptySnapshot).mockResolvedValueOnce(walletSnapshot);
    const createWallet = vi.fn(async () => { throw new Error('Network request failed'); });
    const service = gateway({ loadSnapshot, createWallet });
    const { result } = renderHook(() => useWallets(service, 'space-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await expect(result.current.createWallet({ name: '  Daily  ', currency: 'USD' })).resolves.toEqual({ status: 'success', reconciled: true });
    });
    expect(createWallet).toHaveBeenCalledOnce();
    expect(result.current.wallets[0]?.name).toBe('Daily');
  });

  describe.each(['wallet creation', 'event posting', 'event reversal'] as const)('%s command boundary', (command) => {
    it.each([
      ['null data', null, /exactly one result/],
      ['zero rows', [], /exactly one result/],
      ['multiple rows', [
        { id: '11111111-1111-4111-8111-111111111111' },
        { id: '22222222-2222-4222-8222-222222222222' },
      ], /exactly one result/],
      ['a null row', [null], /invalid row/],
      ['a missing identifier', [{}], /missing id/],
      ['a null identifier', [{ id: null }], /missing id/],
      ['a malformed identifier', [{ id: 'wallet-new' }], /invalid id/],
    ] as const)('does not refresh or report success when the RPC returns %s', async (_label, response, message) => {
      const adapter = createSupabaseWalletsGateway({
        from() { throw new Error('Wallet query access is not used by this command test.'); },
        async rpc() { return { data: response === null ? null : [...response], error: null }; },
      });
      const loadSnapshot = vi.fn(async () => emptySnapshot);
      const service = gateway({
        loadSnapshot,
        createWallet: adapter.createWallet,
        recordEvent: adapter.recordEvent,
        reverseEvent: adapter.reverseEvent,
      });
      const { result } = renderHook(() => useWallets(service, 'space-1', undefined, () => 'request-fixed'));
      await waitFor(() => expect(result.current.status).toBe('ready'));

      const invoke = command === 'wallet creation'
        ? () => result.current.createWallet({ name: 'Daily', currency: 'USD' })
        : command === 'event posting'
          ? () => result.current.recordEvent({
              kind: 'income', effectiveDate: '2026-09-08',
              movements: [{ walletId: 'wallet-1', amountMinor: '500' }],
            })
          : () => result.current.reverseEvent({ eventId: 'event-1', effectiveDate: '2026-09-09' });
      await act(async () => {
        await expect(invoke()).rejects.toThrow(message);
      });
      expect(loadSnapshot).toHaveBeenCalledOnce();
      expect(result.current.ambiguous).toBeNull();
    });
  });

  it('enriches categorized history while reconciling an ambiguous wallet creation without replaying it', async () => {
    const event = {
      id: 'event-income',
      spaceId: 'space-1',
      requestId: 'request-income',
      kind: 'income',
      effectiveDate: '2026-09-08',
      createdAt: '2026-09-08T10:00:00Z',
      reversalOf: null,
      reversedBy: null,
      loanLinked: false,
      movements: [],
    } satisfies JournalEvent;
    const loadSnapshot = vi.fn()
      .mockResolvedValueOnce(emptySnapshot)
      .mockResolvedValueOnce({ wallets: walletSnapshot.wallets, history: { events: [event], nextCursor: null } });
    const createWallet = vi.fn(async () => { throw new Error('Network request failed'); });
    const categories = categoriesGateway({
      resolveEventCategories: vi.fn(async () => [{
        eventId: event.id,
        categoryId: 'category-salary',
        categoryKind: 'income' as const,
        nameEn: 'Salary',
        nameAr: 'راتب',
        archivedAt: null,
      }]),
    });
    const wallets = gateway({ loadSnapshot, createWallet });
    const { result } = renderHook(() => useWallets(
      wallets,
      'space-1',
      undefined,
      undefined,
      categories,
    ));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await expect(result.current.createWallet({ name: 'Daily', currency: 'USD' }))
        .resolves.toEqual({ status: 'success', reconciled: true });
    });

    expect(createWallet).toHaveBeenCalledOnce();
    expect(categories.resolveEventCategories).toHaveBeenCalledWith('space-1', [event.id]);
    expect(result.current.events[0]?.category).toEqual({
      id: 'category-salary',
      kind: 'income',
      nameEn: 'Salary',
      nameAr: 'راتب',
      archivedAt: null,
    });
  });

  it('accepts an ambiguously created new wallet before failed category enrichment and recovers by refresh only', async () => {
    const existingWallet = { ...walletSnapshot.wallets[0]!, id: 'wallet-existing' };
    const createdWallet = { ...walletSnapshot.wallets[0]!, id: 'wallet-created' };
    const event = {
      id: 'event-income',
      spaceId: 'space-1',
      requestId: 'request-income',
      kind: 'income',
      effectiveDate: '2026-09-08',
      createdAt: '2026-09-08T10:00:00Z',
      reversalOf: null,
      reversedBy: null,
      loanLinked: false,
      movements: [],
    } satisfies JournalEvent;
    const reconciledSnapshot = {
      wallets: [existingWallet, createdWallet],
      history: { events: [event], nextCursor: null },
    };
    const loadSnapshot = vi.fn()
      .mockResolvedValueOnce({ wallets: [existingWallet], history: { events: [], nextCursor: null } })
      .mockResolvedValueOnce(reconciledSnapshot)
      .mockResolvedValueOnce(reconciledSnapshot);
    const createWallet = vi.fn(async () => { throw new Error('Network request failed'); });
    const resolveEventCategories = vi.fn()
      .mockRejectedValueOnce(new Error('raw category history failure'))
      .mockResolvedValueOnce([{
        eventId: event.id,
        categoryId: 'category-salary',
        categoryKind: 'income' as const,
        nameEn: 'Salary',
        nameAr: 'راتب',
        archivedAt: null,
      }]);
    const wallets = gateway({ loadSnapshot, createWallet });
    const categories = categoriesGateway({ resolveEventCategories });
    const { result } = renderHook(() => useWallets(wallets, 'space-1', undefined, undefined, categories));
    await waitFor(() => expect(result.current.wallets.map((wallet) => wallet.id)).toEqual(['wallet-existing']));

    await act(async () => {
      await expect(result.current.createWallet({ name: 'Daily', currency: 'USD' }))
        .resolves.toEqual({ status: 'refresh-required', reconciled: true });
    });

    expect(result.current.wallets.map((wallet) => wallet.id)).toEqual(['wallet-existing', 'wallet-created']);
    expect(result.current.events).toEqual([]);
    expect(createWallet).toHaveBeenCalledOnce();

    await act(async () => {
      await expect(result.current.recoverRefresh()).resolves.toBe(true);
    });

    expect(result.current.events[0]?.category?.nameEn).toBe('Salary');
    expect(createWallet).toHaveBeenCalledOnce();
  });

  it('requires an explicit unchanged resubmission when ambiguous wallet creation adds no matching wallet', async () => {
    const existingWallet = { ...walletSnapshot.wallets[0]!, id: 'wallet-existing' };
    const createdWallet = { ...walletSnapshot.wallets[0]!, id: 'wallet-created' };
    const loadSnapshot = vi.fn()
      .mockResolvedValueOnce({ wallets: [existingWallet], history: { events: [], nextCursor: null } })
      .mockResolvedValueOnce({ wallets: [existingWallet], history: { events: [], nextCursor: null } })
      .mockResolvedValueOnce({ wallets: [existingWallet, createdWallet], history: { events: [], nextCursor: null } });
    const createWallet = vi.fn()
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce({ id: createdWallet.id });
    const wallets = gateway({ loadSnapshot, createWallet });
    const { result } = renderHook(() => useWallets(wallets, 'space-1'));
    await waitFor(() => expect(result.current.wallets.map((wallet) => wallet.id)).toEqual(['wallet-existing']));

    await act(async () => {
      await expect(result.current.createWallet({ name: ' Daily ', currency: 'USD' }))
        .rejects.toThrow('found no match');
    });
    expect(createWallet).toHaveBeenCalledOnce();

    await act(async () => {
      await expect(result.current.createWallet({ name: ' Daily ', currency: 'USD' }))
        .resolves.toEqual({ status: 'success', reconciled: false });
    });

    expect(createWallet).toHaveBeenCalledTimes(2);
    expect(createWallet.mock.calls[1]?.[0]).toEqual(createWallet.mock.calls[0]?.[0]);
  });

  it('offers an explicit identical retry after an ambiguous posting is absent', async () => {
    const recordEvent = vi.fn().mockRejectedValueOnce(new Error('Connection timeout')).mockResolvedValueOnce({ eventId: 'event-1' });
    const service = gateway({ recordEvent });
    const { result } = renderHook(() => useWallets(service, 'space-1', undefined, () => 'request-fixed'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await expect(result.current.recordEvent({ kind: 'income', effectiveDate: '2026-09-08', movements: [{ walletId: 'wallet-1', amountMinor: '500' }] })).resolves.toEqual({ status: 'ambiguous', reconciled: false });
    });
    expect(result.current.ambiguous?.requestId).toBe('request-fixed');
    await act(async () => { await result.current.retryAmbiguous(); });
    expect(recordEvent).toHaveBeenCalledTimes(2);
    expect(recordEvent.mock.calls[0]?.[0]).toEqual(recordEvent.mock.calls[1]?.[0]);
  });

  it('treats an ambiguous post as successful when its request ID is visible', async () => {
    const found = { id: 'event-1', spaceId: 'space-1', requestId: 'request-fixed' } as JournalEvent;
    const service = gateway({
      recordEvent: vi.fn(async () => { throw new Error('Failed to fetch'); }),
      findEventByRequestId: vi.fn(async () => found),
    });
    const { result } = renderHook(() => useWallets(service, 'space-1', undefined, () => 'request-fixed'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await expect(result.current.recordEvent({ kind: 'expense', effectiveDate: '2026-09-08', movements: [{ walletId: 'wallet-1', amountMinor: '-500' }] })).resolves.toEqual({ status: 'success', reconciled: true });
    });
    expect(result.current.ambiguous).toBeNull();
  });

  it('keeps uncategorized income on the existing wallet command path', async () => {
    const wallets = gateway();
    const categories = categoriesGateway();
    const { result } = renderHook(() => useWallets(wallets, 'space-1', undefined, () => 'request-fixed', categories));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.recordEvent({
        kind: 'income',
        effectiveDate: '2026-09-08',
        movements: [{ walletId: 'wallet-1', amountMinor: '500' }],
      });
    });

    expect(wallets.recordEvent).toHaveBeenCalledWith({
      spaceId: 'space-1',
      requestId: 'request-fixed',
      kind: 'income',
      effectiveDate: '2026-09-08',
      movements: [{ walletId: 'wallet-1', amountMinor: '500' }],
    });
    expect(categories.recordCategorizedEvent).not.toHaveBeenCalled();
  });

  it('routes a categorized expense through the protected categories command', async () => {
    const wallets = gateway();
    const categories = categoriesGateway();
    const { result } = renderHook(() => useWallets(wallets, 'space-1', undefined, () => 'request-fixed', categories));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.recordEvent({
        kind: 'expense',
        effectiveDate: '2026-09-08',
        movements: [{ walletId: 'wallet-1', amountMinor: '-500' }],
        categoryId: 'category-groceries',
      });
    });

    expect(categories.recordCategorizedEvent).toHaveBeenCalledWith({
      spaceId: 'space-1',
      requestId: 'request-fixed',
      kind: 'expense',
      effectiveDate: '2026-09-08',
      movements: [{ walletId: 'wallet-1', amountMinor: '-500' }],
      categoryId: 'category-groceries',
    });
    expect(wallets.recordEvent).not.toHaveBeenCalled();
  });

  it('requires refresh-only recovery when a successful categorized post cannot refresh', async () => {
    const loadSnapshot = vi.fn()
      .mockResolvedValueOnce(walletSnapshot)
      .mockRejectedValueOnce(new Error('Refresh failed'))
      .mockResolvedValueOnce(walletSnapshot);
    const wallets = gateway({ loadSnapshot });
    const categories = categoriesGateway();
    const { result } = renderHook(() => useWallets(wallets, 'space-1', undefined, () => 'request-fixed', categories));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await expect(result.current.recordEvent({
        kind: 'income',
        effectiveDate: '2026-09-08',
        movements: [{ walletId: 'wallet-1', amountMinor: '500' }],
        categoryId: 'category-salary',
      })).resolves.toEqual({ status: 'refresh-required', reconciled: false });
    });
    expect(result.current.status).toBe('ready');
    expect(categories.recordCategorizedEvent).toHaveBeenCalledOnce();

    await act(async () => {
      await expect(result.current.recoverRefresh()).resolves.toBe(true);
    });
    expect(categories.recordCategorizedEvent).toHaveBeenCalledOnce();
  });

  it('reconciles an ambiguous categorized post only when the category also matches', async () => {
    const recordCategorizedEvent = vi.fn(async () => { throw new Error('Connection timeout'); });
    const findCategorizedEventByRequestId = vi.fn(async () => ({ eventId: 'event-1', categoryId: 'category-salary' }));
    const wallets = gateway();
    const categories = categoriesGateway({ recordCategorizedEvent, findCategorizedEventByRequestId });
    const { result } = renderHook(() => useWallets(wallets, 'space-1', undefined, () => 'request-fixed', categories));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await expect(result.current.recordEvent({
        kind: 'income',
        effectiveDate: '2026-09-08',
        movements: [{ walletId: 'wallet-1', amountMinor: '500' }],
        categoryId: 'category-salary',
      })).resolves.toEqual({ status: 'success', reconciled: true });
    });

    expect(recordCategorizedEvent).toHaveBeenCalledOnce();
    expect(findCategorizedEventByRequestId).toHaveBeenCalledWith('space-1', 'request-fixed');
    expect(result.current.ambiguous).toBeNull();
  });

  it('requires refresh-only recovery when reconciled categorized success cannot refresh', async () => {
    const loadSnapshot = vi.fn()
      .mockResolvedValueOnce(walletSnapshot)
      .mockRejectedValueOnce(new Error('Refresh failed'))
      .mockResolvedValueOnce(walletSnapshot);
    const wallets = gateway({ loadSnapshot });
    const categories = categoriesGateway({
      recordCategorizedEvent: vi.fn(async () => { throw new Error('Connection timeout'); }),
      findCategorizedEventByRequestId: vi.fn(async () => ({ eventId: 'event-1', categoryId: 'category-salary' })),
    });
    const { result } = renderHook(() => useWallets(wallets, 'space-1', undefined, () => 'request-fixed', categories));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await expect(result.current.recordEvent({
        kind: 'income',
        effectiveDate: '2026-09-08',
        movements: [{ walletId: 'wallet-1', amountMinor: '500' }],
        categoryId: 'category-salary',
      })).resolves.toEqual({ status: 'refresh-required', reconciled: true });
    });
    expect(result.current.status).toBe('ready');
    expect(categories.recordCategorizedEvent).toHaveBeenCalledOnce();

    await act(async () => {
      await expect(result.current.recoverRefresh()).resolves.toBe(true);
    });
    expect(categories.recordCategorizedEvent).toHaveBeenCalledOnce();
  });

  it('retains the identical categorized command when its reconciliation read fails', async () => {
    const record = vi.fn()
      .mockRejectedValueOnce(new Error('Connection timeout'))
      .mockResolvedValueOnce({ eventId: 'event-1' });
    const categories = categoriesGateway({
      recordCategorizedEvent: record,
      findCategorizedEventByRequestId: vi.fn(async () => { throw new Error('Reconciliation read failed'); }),
    });
    const wallets = gateway();
    const { result } = renderHook(() => useWallets(wallets, 'space-1', undefined, () => 'request-fixed', categories));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await expect(result.current.recordEvent({
        kind: 'income',
        effectiveDate: '2026-09-08',
        movements: [{ walletId: 'wallet-1', amountMinor: '500' }],
        categoryId: 'category-salary',
      })).rejects.toThrow('Reconciliation read failed');
    });
    expect(result.current.ambiguous).toEqual({ kind: 'record', requestId: 'request-fixed' });

    await act(async () => { await result.current.retryAmbiguous(); });
    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[0]?.[0]).toEqual(record.mock.calls[1]?.[0]);
  });

  it('fails loudly when categorized reconciliation finds a different category', async () => {
    const categories = categoriesGateway({
      recordCategorizedEvent: vi.fn(async () => { throw new Error('Connection timeout'); }),
      findCategorizedEventByRequestId: vi.fn(async () => ({ eventId: 'event-1', categoryId: 'category-other' })),
    });
    const wallets = gateway();
    const { result } = renderHook(() => useWallets(wallets, 'space-1', undefined, () => 'request-fixed', categories));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await expect(result.current.recordEvent({
        kind: 'income',
        effectiveDate: '2026-09-08',
        movements: [{ walletId: 'wallet-1', amountMinor: '500' }],
        categoryId: 'category-salary',
    })).rejects.toThrow('different category');
  });

  it('reuses the identical request and payload for an explicit ambiguous reversal retry', async () => {
    const reverseEvent = vi.fn()
      .mockRejectedValueOnce(new Error('Connection timeout'))
      .mockResolvedValueOnce({ eventId: 'reversal-1' });
    const service = gateway({ reverseEvent });
    const { result } = renderHook(() => useWallets(service, 'space-1', undefined, () => 'reverse-request'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await expect(result.current.reverseEvent({ eventId: 'event-1', effectiveDate: '2026-09-08' }))
        .resolves.toEqual({ status: 'ambiguous', reconciled: false });
    });
    expect(result.current.ambiguous).toEqual({ kind: 'reverse', requestId: 'reverse-request' });
    await act(async () => { await result.current.retryAmbiguous(); });
    expect(reverseEvent).toHaveBeenCalledTimes(2);
    expect(reverseEvent.mock.calls[0]?.[0]).toEqual(reverseEvent.mock.calls[1]?.[0]);
  });

  it('appends a bounded history page once and advances its cursor', async () => {
    const event = { id: 'event-2', requestId: 'request-2' } as JournalEvent;
    const service = gateway({
      loadSnapshot: vi.fn(async () => ({ ...emptySnapshot, history: { events: [], nextCursor: '20' } })),
      loadHistoryPage: vi.fn(async () => ({ events: [event], nextCursor: null })),
    });
    const { result } = renderHook(() => useWallets(service, 'space-1'));
    await waitFor(() => expect(result.current.nextCursor).toBe('20'));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.events).toEqual([event]);
    expect(result.current.nextCursor).toBeNull();
  });

  it('preserves loaded history and retries only the failed older category page', async () => {
    const currentEvent = { id: 'event-current', requestId: 'request-current' } as JournalEvent;
    const olderEvent = { id: 'event-older', requestId: 'request-older' } as JournalEvent;
    const loadHistoryPage = vi.fn(async () => ({ events: [olderEvent], nextCursor: null }));
    const recordEvent = vi.fn(async () => ({ eventId: 'event-new' }));
    const wallets = gateway({
      loadSnapshot: vi.fn(async () => ({
        wallets: walletSnapshot.wallets,
        archivedWallets: [],
        history: { events: [currentEvent], nextCursor: 'older-page' },
      })),
      loadHistoryPage,
      recordEvent,
    });
    const resolveEventCategories = vi.fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('category page lookup failed'))
      .mockResolvedValueOnce([{
        eventId: olderEvent.id,
        categoryId: 'category-older',
        categoryKind: 'expense' as const,
        nameEn: 'Older expense',
        nameAr: 'مصروف أقدم',
        archivedAt: null,
      }]);
    const categories = categoriesGateway({ resolveEventCategories });
    const { result } = renderHook(() => useWallets(wallets, 'space-1', undefined, undefined, categories));
    await waitFor(() => expect(result.current.nextCursor).toBe('older-page'));

    await act(async () => {
      await expect(result.current.loadMore()).resolves.toBeUndefined();
    });

    expect(result.current.events).toEqual([{ ...currentEvent, category: null }]);
    expect(result.current.nextCursor).toBe('older-page');
    expect(result.current.historyPaginationError).not.toBeNull();

    await act(async () => {
      await result.current.loadMore();
    });

    expect(loadHistoryPage).toHaveBeenCalledTimes(2);
    expect(result.current.events.map((event) => event.id)).toEqual([currentEvent.id, olderEvent.id]);
    expect(result.current.events[1]?.category?.nameEn).toBe('Older expense');
    expect(result.current.historyPaginationError).toBeNull();
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it('enriches each bounded history page with active or archived category labels', async () => {
    const event = {
      id: 'event-1',
      spaceId: 'space-1',
      requestId: 'request-1',
      kind: 'expense',
      effectiveDate: '2026-09-08',
      createdAt: '2026-09-08T10:00:00Z',
      reversalOf: null,
      reversedBy: null,
      loanLinked: false,
      movements: [],
    } satisfies JournalEvent;
    const wallets = gateway({
      loadSnapshot: vi.fn(async () => ({ wallets: [], archivedWallets: [], history: { events: [event], nextCursor: null } })),
    });
    const categories = categoriesGateway({
      resolveEventCategories: vi.fn(async () => [{
        eventId: 'event-1',
        categoryId: 'category-groceries',
        categoryKind: 'expense' as const,
        nameEn: 'Groceries',
        nameAr: 'بقالة',
        archivedAt: '2026-09-08T11:00:00Z',
      }]),
    });

    const { result } = renderHook(() => useWallets(wallets, 'space-1', undefined, undefined, categories));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(categories.resolveEventCategories).toHaveBeenCalledWith('space-1', ['event-1']);
    expect(result.current.events[0]?.category).toEqual({
      id: 'category-groceries',
      kind: 'expense',
      nameEn: 'Groceries',
      nameAr: 'بقالة',
      archivedAt: '2026-09-08T11:00:00Z',
    });
  });

  it('reports inaccessible space failures to the application shell', async () => {
    const unavailable = vi.fn();
    const service = gateway({ loadSnapshot: vi.fn(async () => { throw new Error('an active space membership is required'); }) });
    const { result } = renderHook(() => useWallets(service, 'space-1', unavailable));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(unavailable).toHaveBeenCalledOnce();
    expect(result.current.wallets).toEqual([]);
  });
});
