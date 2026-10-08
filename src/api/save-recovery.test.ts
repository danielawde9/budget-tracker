import { createBudgetApi, BudgetError, type RpcClient } from './budget-api.ts';
import { SaveRecoveryStore } from './save-recovery.ts';

const input = { spaceId: 's', requestId: 'r', walletId: 'w', itemId: 'i', amount: 2000n, on: '2026-10-08', memo: 'Private note' };
function client(reply: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error?: unknown }>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rpc: RpcClient = { rpc: (name, args = {}) => ({ abortSignal: async () => { calls.push({ name, args: structuredClone(args) }); return { error: null, ...await reply(name, args) }; } }) };
  return { rpc, calls };
}

it.each(['NETWORK', 'UNKNOWN', 'BAD_RESPONSE'])('retains exact private arguments after %s and replays after the form is gone', async (code) => {
  let attempt = 0;
  const { rpc, calls } = client(async () => { if (attempt++ === 0) throw new BudgetError(code); return { data: { entryId: 'e', covered: '0' } }; });
  const store = new SaveRecoveryStore();
  const api = createBudgetApi(rpc, store);
  const original = { ...input };
  await expect(api.recordExpense(original)).rejects.toMatchObject({ code });
  original.amount = 9999n; original.memo = 'changed';
  await expect(api.recordExpense({ ...input, requestId: 'new' })).rejects.toMatchObject({ code: 'SAVE_UNRESOLVED' });
  await store.retry('s');
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
  expect(calls[1]?.args).toMatchObject({ p_request: 'r', p_amount: '2000', p_memo: 'Private note' });
  expect(store.get('s')).toBeUndefined();
});

it('allows only the identical same-form retry and keeps each space independent', async () => {
  let fail = true;
  const { rpc } = client(async () => { if (fail) { fail = false; throw new BudgetError('NETWORK'); } return { data: { entryId: 'e', covered: '0' } }; });
  const store = new SaveRecoveryStore(); const api = createBudgetApi(rpc, store);
  await expect(api.recordExpense(input)).rejects.toThrow();
  await expect(api.recordExpense({ ...input, amount: 3000n })).rejects.toMatchObject({ code: 'SAVE_UNRESOLVED' });
  await api.recordExpense({ ...input, spaceId: 'other', requestId: 'other' });
  expect(store.get('s')).toBeDefined();
  await api.recordExpense(input);
  expect(store.get('s')).toBeUndefined();
});

it('clears a definitely rejected replay and never overwrites a running save', async () => {
  let complete!: () => void;
  const { rpc } = client(async () => { await new Promise<void>(resolve => { complete = resolve; }); return { data: null, error: { message: 'BUDGET_WALLET_BOUNDS' } }; });
  const store = new SaveRecoveryStore(); const api = createBudgetApi(rpc, store);
  const result = api.recordExpense(input).catch(error => error);
  await expect(api.recordExpense({ ...input, requestId: 'another' })).rejects.toMatchObject({ code: 'SAVE_PENDING' });
  complete(); expect(await result).toMatchObject({ code: 'BUDGET_WALLET_BOUNDS' });
  expect(store.get('s')).toBeUndefined();
});
