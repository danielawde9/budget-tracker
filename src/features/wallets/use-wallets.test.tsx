import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { JournalEvent, WalletsGateway, WalletsSnapshot } from './types.js';
import { useWallets } from './use-wallets.js';

const emptySnapshot: WalletsSnapshot = { wallets: [], history: { events: [], nextCursor: null } };
const walletSnapshot: WalletsSnapshot = {
  wallets: [{ id: 'wallet-1', spaceId: 'space-1', name: 'Daily', currency: 'USD', archivedAt: null, balanceMinor: '1000' }],
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
    recordEvent: vi.fn(async () => ({ eventId: 'event-new' })),
    reverseEvent: vi.fn(async () => ({ eventId: 'reversal-new' })),
    findEventByRequestId: vi.fn(async () => null),
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
    second.resolve({ wallets: [{ ...walletSnapshot.wallets[0]!, id: 'wallet-2', spaceId: 'space-2', name: 'Home' }], history: { events: [], nextCursor: null } });
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

  it('reports inaccessible space failures to the application shell', async () => {
    const unavailable = vi.fn();
    const service = gateway({ loadSnapshot: vi.fn(async () => { throw new Error('an active space membership is required'); }) });
    const { result } = renderHook(() => useWallets(service, 'space-1', unavailable));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(unavailable).toHaveBeenCalledOnce();
    expect(result.current.wallets).toEqual([]);
  });
});
