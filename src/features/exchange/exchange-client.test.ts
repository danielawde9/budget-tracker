import { describe, expect, it, vi } from 'vitest';
import { createExchangeClient } from './exchange-client.js';

function rpcClient(impl: (name: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }) {
  return { rpc: vi.fn((name: string, args: Record<string, unknown>) => Promise.resolve(impl(name, args))) };
}

describe('createExchangeClient', () => {
  it('posts record_usd_to_lbp_exchange with snake_case args and returns the event id', async () => {
    const rpc = rpcClient(() => ({ data: [{ id: 'evt-1' }], error: null }));
    const client = createExchangeClient(rpc);
    await expect(client.recordExchange({
      spaceId: 'space-1',
      requestId: 'req-1',
      usdWalletId: 'wallet-usd',
      lbpWalletId: 'wallet-lbp',
      usdAmountMinor: '100000',
      lbpAmountMinor: '895000000',
      effectiveDate: '2026-09-12',
    })).resolves.toEqual({ eventId: 'evt-1' });
    expect(rpc.rpc).toHaveBeenCalledWith('record_usd_to_lbp_exchange', {
      p_space_id: 'space-1',
      p_request_id: 'req-1',
      p_usd_wallet_id: 'wallet-usd',
      p_lbp_wallet_id: 'wallet-lbp',
      p_usd_amount_minor: '100000',
      p_lbp_amount_minor: '895000000',
      p_effective_date: '2026-09-12',
    });
  });

  it('throws the rpc error message', async () => {
    const rpc = rpcClient(() => ({ data: null, error: { message: 'an active space membership is required' } }));
    const client = createExchangeClient(rpc);
    await expect(client.recordExchange({
      spaceId: 'space-1',
      requestId: 'req-1',
      usdWalletId: 'wallet-usd',
      lbpWalletId: 'wallet-lbp',
      usdAmountMinor: '100000',
      lbpAmountMinor: '895000000',
      effectiveDate: '2026-09-12',
    })).rejects.toThrow('an active space membership is required');
  });

  it('rejects malformed rows', async () => {
    const rpc = rpcClient(() => ({ data: [{ id: 7 }], error: null }));
    const client = createExchangeClient(rpc);
    await expect(client.recordExchange({
      spaceId: 'space-1',
      requestId: 'req-1',
      usdWalletId: 'wallet-usd',
      lbpWalletId: 'wallet-lbp',
      usdAmountMinor: '100000',
      lbpAmountMinor: '895000000',
      effectiveDate: '2026-09-12',
    })).rejects.toThrow('The database row is missing id.');
  });
});
