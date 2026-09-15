import { describe, expect, it } from 'vitest';
import type { RpcBuilder, RpcResult } from '../planning-shared/rpc.js';
import { createSupabaseCashControlGateway, type CashControlDataClient } from './supabase-cash-control-gateway.js';

interface RecordedCall { name: string; args: Record<string, unknown>; signal: AbortSignal | undefined }

function fakeClient(response: (call: RecordedCall) => RpcResult): { client: CashControlDataClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client: CashControlDataClient = {
    rpc(name, args) {
      let signal: AbortSignal | undefined;
      const builder: RpcBuilder = {
        abortSignal(value) {
          signal = value;
          return builder;
        },
        then(onFulfilled, onRejected) {
          const call = { name, args, signal };
          calls.push(call);
          return Promise.resolve(response(call)).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  };
  return { client, calls };
}

const GROUP_ID = '00000000-0000-4000-8000-000000000901';

const readySummaryFixture = {
  currency: 'USD', asOf: '2026-09-15', state: 'ready', needsReview: false, snapshotId: '12',
  cashMinor: '100000', goalClaimsMinor: '0',
  expenseCommitmentsMinor: '50000', debtCommitmentsMinor: '0', goalTopupsMinor: '0', futureHeadroomMinor: '0',
  availableMinor: '50000', deficitMinor: '0', spendableMinor: '50000', dailyExtraGuideMinor: '3333',
  daysRemaining: 15, receivedIncomeMinor: '80000', ordinarySpendingMinor: '30000', incomeMinusSpendingMinor: '50000',
  uncategorizedMinor: '0', unmaterializedCount: 0,
  groups: [{
    id: GROUP_ID, nameEn: 'Essentials', nameAr: null,
    budgetRemainingMinor: '20000', unpaidBillsMinor: '30000', goalOverlapMinor: '0', commitmentMinor: '50000',
  }],
};

const outlookFixture = {
  currency: 'USD', startDate: '2026-09-15', scenario: 'expected',
  assumption: 'Projects only unpaid scheduled income and scheduled bills; unplanned day-to-day spending can still lower this line.',
  days: [{
    date: '2026-09-15', openingCashMinor: '100000', expectedIncomeMinor: '0', expectedOutflowMinor: '50000', closingCashMinor: '50000',
  }],
  firstNegativeDate: null, state: 'ready', overdueCount: 0, overdueMinor: '0',
};

describe('createSupabaseCashControlGateway: loadAvailable', () => {
  it('maps camelCase input to p_snake_case args and parses a complete ready response', async () => {
    const { client, calls } = fakeClient(() => ({ data: readySummaryFixture, error: null }));
    const gateway = createSupabaseCashControlGateway(client);
    const result = await gateway.loadAvailable({ spaceId: 'space-1', currency: 'USD', asOfDate: '2026-09-15' });
    expect(calls[0]).toMatchObject({
      name: 'available_cash_summary',
      args: { p_space_id: 'space-1', p_currency: 'USD', p_as_of_date: '2026-09-15' },
    });
    expect(result.availableMinor).toBe('50000');
    expect(result.state).toBe('ready');
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.commitmentMinor).toBe('50000');
  });

  it('parses the exact monetary subset from the brief unchanged', async () => {
    const { client } = fakeClient(() => ({
      data: { ...readySummaryFixture, cashMinor: '100000', availableMinor: '-10000', spendableMinor: '0', deficitMinor: '10000', state: 'ready' },
      error: null,
    }));
    const gateway = createSupabaseCashControlGateway(client);
    const result = await gateway.loadAvailable({ spaceId: 'space-1', currency: 'USD', asOfDate: '2026-09-15' });
    expect(result.availableMinor).toBe('-10000');
    expect(result.spendableMinor).toBe('0');
    expect(result.deficitMinor).toBe('10000');
  });

  it('preserves a bigint identifier beyond Number.MAX_SAFE_INTEGER as text', async () => {
    const { client } = fakeClient(() => ({
      data: { ...readySummaryFixture, snapshotId: '9007199254740993' }, error: null,
    }));
    const gateway = createSupabaseCashControlGateway(client);
    const result = await gateway.loadAvailable({ spaceId: 'space-1', currency: 'USD', asOfDate: '2026-09-15' });
    expect(result.snapshotId).toBe('9007199254740993');
  });

  it('rejects the equivalent unsafe money number in the response', async () => {
    const { client } = fakeClient(() => ({
      data: { ...readySummaryFixture, cashMinor: 9_007_199_254_740_993 }, error: null,
    }));
    const gateway = createSupabaseCashControlGateway(client);
    await expect(gateway.loadAvailable({ spaceId: 'space-1', currency: 'USD', asOfDate: '2026-09-15' })).rejects.toThrow();
  });

  it('rejects a null required money string', async () => {
    const { client } = fakeClient(() => ({ data: { ...readySummaryFixture, cashMinor: null }, error: null }));
    const gateway = createSupabaseCashControlGateway(client);
    await expect(gateway.loadAvailable({ spaceId: 'space-1', currency: 'USD', asOfDate: '2026-09-15' })).rejects.toThrow();
  });

  it('never defaults a missing required money field to zero', async () => {
    const { cashMinor, ...withoutCash } = readySummaryFixture;
    void cashMinor;
    const { client } = fakeClient(() => ({ data: withoutCash, error: null }));
    const gateway = createSupabaseCashControlGateway(client);
    await expect(gateway.loadAvailable({ spaceId: 'space-1', currency: 'USD', asOfDate: '2026-09-15' })).rejects.toThrow();
  });

  it('rejects an unknown state enum', async () => {
    const { client } = fakeClient(() => ({ data: { ...readySummaryFixture, state: 'reconciling' }, error: null }));
    const gateway = createSupabaseCashControlGateway(client);
    await expect(gateway.loadAvailable({ spaceId: 'space-1', currency: 'USD', asOfDate: '2026-09-15' })).rejects.toThrow();
  });

  it('rejects duplicate group rows', async () => {
    const { client } = fakeClient(() => ({
      data: { ...readySummaryFixture, groups: [readySummaryFixture.groups[0], readySummaryFixture.groups[0]] }, error: null,
    }));
    const gateway = createSupabaseCashControlGateway(client);
    await expect(gateway.loadAvailable({ spaceId: 'space-1', currency: 'USD', asOfDate: '2026-09-15' })).rejects.toThrow();
  });

  it('rejects more than 12 group rows', async () => {
    const groups = Array.from({ length: 13 }, (_unused, index) => ({
      ...readySummaryFixture.groups[0], id: `00000000-0000-4000-8000-00000000090${index}`,
    }));
    const { client } = fakeClient(() => ({ data: { ...readySummaryFixture, groups }, error: null }));
    const gateway = createSupabaseCashControlGateway(client);
    await expect(gateway.loadAvailable({ spaceId: 'space-1', currency: 'USD', asOfDate: '2026-09-15' })).rejects.toThrow();
  });

  it('rejects an invalid leap asOf date', async () => {
    const { client } = fakeClient(() => ({ data: { ...readySummaryFixture, asOf: '2025-02-29' }, error: null }));
    const gateway = createSupabaseCashControlGateway(client);
    await expect(gateway.loadAvailable({ spaceId: 'space-1', currency: 'USD', asOfDate: '2026-09-15' })).rejects.toThrow();
  });

  it('rejects a response whose currency the DTO does not recognize (another space\'s stale response)', async () => {
    const { client } = fakeClient(() => ({ data: { ...readySummaryFixture, currency: 'EUR' }, error: null }));
    const gateway = createSupabaseCashControlGateway(client);
    await expect(gateway.loadAvailable({ spaceId: 'space-1', currency: 'USD', asOfDate: '2026-09-15' })).rejects.toThrow();
  });

  it('parses an unplanned/incomplete state with every reservation field null and groups empty, never a guessed default', async () => {
    const { client } = fakeClient(() => ({
      data: {
        ...readySummaryFixture, state: 'unplanned', snapshotId: null,
        expenseCommitmentsMinor: null, debtCommitmentsMinor: null, goalTopupsMinor: null, futureHeadroomMinor: null,
        availableMinor: null, deficitMinor: null, spendableMinor: null, dailyExtraGuideMinor: null, groups: [],
      },
      error: null,
    }));
    const gateway = createSupabaseCashControlGateway(client);
    const result = await gateway.loadAvailable({ spaceId: 'space-1', currency: 'USD', asOfDate: '2026-09-15' });
    expect(result.state).toBe('unplanned');
    expect(result.availableMinor).toBeNull();
    expect(result.spendableMinor).toBeNull();
    expect(result.dailyExtraGuideMinor).toBeNull();
    expect(result.groups).toEqual([]);
  });

  it('forwards the caller AbortSignal into the transport', async () => {
    const { client, calls } = fakeClient(() => ({ data: readySummaryFixture, error: null }));
    const gateway = createSupabaseCashControlGateway(client);
    const controller = new AbortController();
    await gateway.loadAvailable({ spaceId: 'space-1', currency: 'USD', asOfDate: '2026-09-15' }, controller.signal);
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it('surfaces a transport error instead of swallowing it', async () => {
    const { client } = fakeClient(() => ({ data: null, error: { code: '22023', message: 'planning_invalid_input' } }));
    const gateway = createSupabaseCashControlGateway(client);
    await expect(gateway.loadAvailable({ spaceId: 'space-1', currency: 'USD', asOfDate: '2026-09-15' }))
      .rejects.toMatchObject({ code: '22023' });
  });
});

describe('createSupabaseCashControlGateway: loadOutlook', () => {
  it('maps camelCase input to p_snake_case args and parses a complete response', async () => {
    const { client, calls } = fakeClient(() => ({ data: outlookFixture, error: null }));
    const gateway = createSupabaseCashControlGateway(client);
    const result = await gateway.loadOutlook({
      spaceId: 'space-1', currency: 'USD', startDate: '2026-09-15', days: 60, scenario: 'expected',
    });
    expect(calls[0]).toMatchObject({
      name: 'cash_outlook',
      args: { p_space_id: 'space-1', p_currency: 'USD', p_start_date: '2026-09-15', p_days: 60, p_scenario: 'expected' },
    });
    expect(result.days).toHaveLength(1);
    expect(result.days[0]!.closingCashMinor).toBe('50000');
    expect(result.overdueMinor).toBe('0');
  });

  it('preserves a nonnull firstNegativeDate and a signed closing balance', async () => {
    const { client } = fakeClient(() => ({
      data: {
        ...outlookFixture, firstNegativeDate: '2026-09-20',
        days: [{ ...outlookFixture.days[0], closingCashMinor: '-5000' }],
      },
      error: null,
    }));
    const gateway = createSupabaseCashControlGateway(client);
    const result = await gateway.loadOutlook({
      spaceId: 'space-1', currency: 'USD', startDate: '2026-09-15', days: 60, scenario: 'expected',
    });
    expect(result.firstNegativeDate).toBe('2026-09-20');
    expect(result.days[0]!.closingCashMinor).toBe('-5000');
  });

  it('rejects days below 1 before calling the transport', async () => {
    const { client, calls } = fakeClient(() => ({ data: outlookFixture, error: null }));
    const gateway = createSupabaseCashControlGateway(client);
    await expect(gateway.loadOutlook({
      spaceId: 'space-1', currency: 'USD', startDate: '2026-09-15', days: 0, scenario: 'expected',
    })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('rejects days above 90 before calling the transport', async () => {
    const { client, calls } = fakeClient(() => ({ data: outlookFixture, error: null }));
    const gateway = createSupabaseCashControlGateway(client);
    await expect(gateway.loadOutlook({
      spaceId: 'space-1', currency: 'USD', startDate: '2026-09-15', days: 91, scenario: 'expected',
    })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('rejects an unsupported scenario before calling the transport', async () => {
    const { client, calls } = fakeClient(() => ({ data: outlookFixture, error: null }));
    const gateway = createSupabaseCashControlGateway(client);
    await expect(gateway.loadOutlook({
      spaceId: 'space-1', currency: 'USD', startDate: '2026-09-15', days: 60, scenario: 'best_case' as never,
    })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('rejects a response day beyond the 90-day cap', async () => {
    const days = Array.from({ length: 91 }, (_unused, index) => ({
      ...outlookFixture.days[0], date: `2026-${String(Math.floor(index / 28) + 9).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
    }));
    const { client } = fakeClient(() => ({ data: { ...outlookFixture, days }, error: null }));
    const gateway = createSupabaseCashControlGateway(client);
    await expect(gateway.loadOutlook({
      spaceId: 'space-1', currency: 'USD', startDate: '2026-09-15', days: 60, scenario: 'expected',
    })).rejects.toThrow();
  });

  it('rejects duplicate day dates in the response', async () => {
    const { client } = fakeClient(() => ({
      data: { ...outlookFixture, days: [outlookFixture.days[0], outlookFixture.days[0]] }, error: null,
    }));
    const gateway = createSupabaseCashControlGateway(client);
    await expect(gateway.loadOutlook({
      spaceId: 'space-1', currency: 'USD', startDate: '2026-09-15', days: 60, scenario: 'expected',
    })).rejects.toThrow();
  });

  it('rejects an incomplete state value the DTO does not recognize for outlook', async () => {
    const { client } = fakeClient(() => ({ data: { ...outlookFixture, state: 'unplanned' }, error: null }));
    const gateway = createSupabaseCashControlGateway(client);
    await expect(gateway.loadOutlook({
      spaceId: 'space-1', currency: 'USD', startDate: '2026-09-15', days: 60, scenario: 'expected',
    })).rejects.toThrow();
  });

  it('forwards the caller AbortSignal into the transport', async () => {
    const { client, calls } = fakeClient(() => ({ data: outlookFixture, error: null }));
    const gateway = createSupabaseCashControlGateway(client);
    const controller = new AbortController();
    await gateway.loadOutlook({
      spaceId: 'space-1', currency: 'USD', startDate: '2026-09-15', days: 60, scenario: 'expected',
    }, controller.signal);
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it('surfaces a transport error instead of swallowing it', async () => {
    const { client } = fakeClient(() => ({ data: null, error: { code: '42501', message: 'planning_not_authorized' } }));
    const gateway = createSupabaseCashControlGateway(client);
    await expect(gateway.loadOutlook({
      spaceId: 'space-1', currency: 'USD', startDate: '2026-09-15', days: 60, scenario: 'expected',
    })).rejects.toMatchObject({ code: '42501' });
  });
});
