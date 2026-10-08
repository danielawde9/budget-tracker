import { expect, it, vi } from 'vitest';
import { createBudgetApi, type RpcClient } from './budget-api.ts';
it('reads a historical wallet balance as exact signed minor units without sending an observed balance', async () => {
  const rpc = vi.fn(() => ({ abortSignal: async () => ({ data: { walletId: 'w', on: '2026-09-30', currency: 'USD', balance: '-9007199254740993' }, error: null }) }));
  const api = createBudgetApi({ rpc } as RpcClient);
  expect((await api.walletBalanceOn('s', 'w', '2026-09-30')).balance).toBe(-9007199254740993n);
  expect(rpc).toHaveBeenCalledExactlyOnceWith('wallet_balance_on', { p_space: 's', p_wallet: 'w', p_on: '2026-09-30' });
});
