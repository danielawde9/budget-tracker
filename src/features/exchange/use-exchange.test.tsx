import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryExchangeClient } from '../../test/in-memory-exchange-client.js';
import { useExchange, type ExchangeDraft } from './use-exchange.js';

const draft: ExchangeDraft = {
  usdWalletId: 'wallet-usd',
  lbpWalletId: 'wallet-lbp',
  usdAmountMinor: '100000',
  lbpAmountMinor: '895000000',
  effectiveDate: '2026-09-12',
};

function makeReceipts(findEventByRequestId: ReturnType<typeof vi.fn<(spaceId: string, requestId: string) => Promise<unknown | null>>>) {
  return { findEventByRequestId };
}

describe('useExchange', () => {
  it('records an exchange, awaits onRecorded, and reports success without reconciliation', async () => {
    const client = new InMemoryExchangeClient();
    const onRecorded = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useExchange(client, makeReceipts(vi.fn()), 'space-1', onRecorded, () => 'req-fixed'));

    let outcome;
    await act(async () => {
      outcome = await result.current.recordExchange(draft);
    });

    expect(outcome).toEqual({ status: 'success', reconciled: false });
    expect(onRecorded).toHaveBeenCalledTimes(1);
    expect(client.calls[0]).toMatchObject({
      name: 'recordExchange',
      input: { spaceId: 'space-1', requestId: 'req-fixed', ...draft },
    });
    expect(result.current.ambiguous).toBeNull();
  });

  it('returns ambiguous on transport failure without a receipt and retries with the same request id', async () => {
    const client = new InMemoryExchangeClient();
    client.error = new TypeError('Failed to fetch');
    const findEventByRequestId = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useExchange(client, makeReceipts(findEventByRequestId), 'space-1', vi.fn(), () => 'req-fixed'));

    let outcome;
    await act(async () => {
      outcome = await result.current.recordExchange(draft);
    });

    expect(outcome).toEqual({ status: 'ambiguous', reconciled: false });
    expect(result.current.ambiguous).toEqual({ requestId: 'req-fixed' });
    expect(findEventByRequestId).toHaveBeenCalledWith('space-1', 'req-fixed');

    client.error = null;
    await act(async () => {
      outcome = await result.current.retryAmbiguous();
    });

    expect(outcome).toEqual({ status: 'success', reconciled: false });
    expect(client.calls).toHaveLength(1);
    expect((client.calls[0]?.input as { requestId: string }).requestId).toBe('req-fixed');
    expect(result.current.ambiguous).toBeNull();
  });

  it('reconciles via findEventByRequestId after a transport failure when the receipt exists', async () => {
    const client = new InMemoryExchangeClient();
    client.error = new TypeError('Failed to fetch');
    const findEventByRequestId = vi.fn().mockResolvedValue({ id: 'evt-1', kind: 'exchange' });
    const onRecorded = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useExchange(client, makeReceipts(findEventByRequestId), 'space-1', onRecorded, () => 'req-fixed'));

    let firstOutcome;
    await act(async () => {
      firstOutcome = await result.current.recordExchange(draft);
    });
    expect(firstOutcome).toEqual({ status: 'success', reconciled: true });
    expect(onRecorded).toHaveBeenCalledTimes(1);
    expect(result.current.ambiguous).toBeNull();
  });

  it('reconciles a retried ambiguous exchange when the transport fails again but the receipt exists', async () => {
    const client = new InMemoryExchangeClient();
    client.error = new TypeError('Failed to fetch');
    const findEventByRequestId = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'evt-1', kind: 'exchange' });
    const onRecorded = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useExchange(client, makeReceipts(findEventByRequestId), 'space-1', onRecorded, () => 'req-fixed'));

    let firstOutcome;
    await act(async () => {
      firstOutcome = await result.current.recordExchange(draft);
    });
    expect(firstOutcome).toEqual({ status: 'ambiguous', reconciled: false });

    let retryOutcome;
    await act(async () => {
      retryOutcome = await result.current.retryAmbiguous();
    });
    expect(retryOutcome).toEqual({ status: 'success', reconciled: true });
    expect(onRecorded).toHaveBeenCalledTimes(1);
    expect(findEventByRequestId).toHaveBeenNthCalledWith(2, 'space-1', 'req-fixed');
  });

  it('rethrows non-transport errors to the caller', async () => {
    const client = new InMemoryExchangeClient();
    client.error = new Error('an active space membership is required');
    const { result } = renderHook(() => useExchange(client, makeReceipts(vi.fn()), 'space-1', vi.fn(), () => 'req-fixed'));

    await act(async () => {
      await expect(result.current.recordExchange(draft)).rejects.toThrow('an active space membership is required');
    });
    expect(result.current.ambiguous).toBeNull();
  });
});
