import { BudgetError, createBudgetApi, type RpcClient } from './budget-api.ts';

interface Call {
  name: string;
  args: Record<string, unknown>;
}

function fakeClient(response: { data?: unknown; error?: unknown }): { client: RpcClient; calls: Call[] } {
  const calls: Call[] = [];
  const client: RpcClient = {
    rpc(name, args) {
      calls.push({ name, args: args ?? {} });
      return {
        abortSignal: () => Promise.resolve({ data: response.data ?? null, error: response.error ?? null }),
      };
    },
  };
  return { client, calls };
}

describe('createBudgetApi', () => {
  it('turns PostgREST plain-object errors into BudgetError with the server code', async () => {
    const { client } = fakeClient({ error: { code: 'P0001', message: 'BUDGET_INSUFFICIENT_READY', details: '{"currency":"USD","available":"1200"}', hint: null } });
    const api = createBudgetApi(client);
    const failure = await api.assignMoney({ spaceId: 's', requestId: 'r', on: '2026-10-03', moves: [] }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BudgetError);
    expect(failure).toMatchObject({ code: 'BUDGET_INSUFFICIENT_READY', detail: { currency: 'USD', available: '1200' } });
  });

  it('reports a permission failure as BUDGET_NOT_MEMBER', async () => {
    const { client } = fakeClient({ error: { code: '42501', message: 'BUDGET_NOT_MEMBER', details: null, hint: null } });
    await expect(createBudgetApi(client).overview('s')).rejects.toMatchObject({ code: 'BUDGET_NOT_MEMBER' });
  });

  it('classifies an unknown failure without leaking the raw message', async () => {
    const { client } = fakeClient({ error: { code: 'XX000', message: 'internal detail', details: null, hint: null } });
    await expect(createBudgetApi(client).overview('s')).rejects.toMatchObject({ code: 'UNKNOWN' });
  });

  it('sends money as exact strings and parses money back into bigint', async () => {
    const { client, calls } = fakeClient({ data: { entryId: 'e1', covered: '1550' } });
    const result = await createBudgetApi(client).recordExpense({
      spaceId: 's', requestId: 'r', walletId: 'w', itemId: 'i', amount: 13550n, on: '2026-10-03', coverFrom: 'f',
    });
    expect(calls[0]).toEqual({
      name: 'record_expense',
      args: { p_space: 's', p_request: 'r', p_wallet: 'w', p_item: 'i', p_amount: '13550', p_on: '2026-10-03', p_memo: null, p_cover_from: 'f', p_bill: null, p_bill_due: null },
    });
    expect(result).toEqual({ entryId: 'e1', covered: 1550n });
  });

  it('fails loudly on a malformed read payload', async () => {
    const { client } = fakeClient({ data: { today: '2026-10-03', currencies: 'nope' } });
    await expect(createBudgetApi(client).overview('s')).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('parses the plan month into bigint amounts', async () => {
    const item = {
      itemId: 'i', kind: 'spending', nameEn: 'Rent', nameAr: null, inPlan: true, planned: '100000', stillToFund: '0',
      broughtForward: '0', opening: '0', funded: '100000', movedIn: '0', movedOut: '0', coveredIn: '0', coveredOut: '0',
      spent: '100000', otherOut: '0', exchanged: '0', available: '0', balances: { USD: '0', LBP: '0' },
      targetMinor: null, targetDate: null, walletId: null,
    };
    const { client } = fakeClient({
      data: {
        month: '2026-10-01', planCurrency: 'USD', versionId: 'v', revision: 2, effectiveMonth: '2026-09-01',
        expectedIncome: '411000', groupsTotal: '411000', notPlanned: '0', overPlanned: '0', received: '411000',
        otherIncome: '0', funded: '411000', stillToFund: '0', ready: '132000', readyAtMonthEnd: '120000', today: '2026-10-03', isCurrent: true, isPast: false,
        groups: [{ groupId: 'g', nameEn: 'Essentials', nameAr: 'الأساسيات', percentBps: 6000, planned: '246600', itemsPlanned: '245000',
          over: '0', funded: '246600', spent: '100000', otherOut: '0', available: '146600', items: [item], flex: { ...item, itemId: 'f', kind: 'flex' } }],
      },
    });
    const plan = await createBudgetApi(client).planMonth('s', '2026-10-01');
    expect(plan.groups[0]?.items[0]?.planned).toBe(100000n);
    expect(plan.ready).toBe(132000n);
    expect(plan.readyAtMonthEnd).toBe(120000n);
  });
});
