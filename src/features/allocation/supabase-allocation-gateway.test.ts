import { describe, expect, it } from 'vitest';
import type { RpcBuilder, RpcResult } from '../planning-shared/rpc.js';
import { createSupabaseAllocationGateway, type AllocationDataClient } from './supabase-allocation-gateway.js';

interface RecordedCall { name: string; args: Record<string, unknown>; signal: AbortSignal | undefined }

function fakeClient(response: (call: RecordedCall) => RpcResult): { client: AllocationDataClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client: AllocationDataClient = {
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

const monthStateFixture = {
  snapshotId: '12', templateRevisionId: '9', incomeRevisionId: '30001',
  hasPlan: true, plannedIncomeMinor: '200000', actualIncomeMinor: '180000',
  expenseMinor: '161000', incomeAfterSpendingMinor: '19000',
  ownDebtPaidMinor: '15000', remainingDebtMinor: '0', leftToAllocateMinor: '0',
  childPlanChanged: false, asOf: '2026-09-14T12:00:00Z',
  groups: [
    {
      groupId: '00000000-0000-4000-8000-000000000001', rowKind: 'spending', nameEn: 'Essentials', nameAr: null,
      order: 0, targetMinor: '112000', actualMinor: '118000', varianceMinor: '-6000', basisPoints: 5600,
      actualShareOfIncomeBps: '6555', hasPlan: true,
    },
    {
      groupId: null, rowKind: 'unmapped', nameEn: null, nameAr: null, order: null,
      targetMinor: '0', actualMinor: '0', varianceMinor: '0', basisPoints: null,
      actualShareOfIncomeBps: '0', hasPlan: false,
    },
    {
      groupId: null, rowKind: 'uncategorized', nameEn: null, nameAr: null, order: null,
      targetMinor: null, actualMinor: '0', varianceMinor: null, basisPoints: null,
      actualShareOfIncomeBps: '0', hasPlan: false,
    },
  ],
};

describe('createSupabaseAllocationGateway: loadMonth', () => {
  it('maps camelCase input to p_snake_case args and parses a complete valid response', async () => {
    const { client, calls } = fakeClient(() => ({ data: monthStateFixture, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    const result = await gateway.loadMonth({ spaceId: 'space-1', month: '2026-09-01', currency: 'USD', snapshotId: '12' });
    expect(calls[0]).toMatchObject({
      name: 'allocation_month_state',
      args: { p_space_id: 'space-1', p_month: '2026-09-01', p_currency: 'USD', p_snapshot_id: 12 },
    });
    expect(result.incomeAfterSpendingMinor).toBe('19000');
    expect(result.plannedIncomeMinor).toBe('200000');
    expect(result.groups).toHaveLength(3);
  });

  it('sends a null p_snapshot_id when none is requested', async () => {
    const { client, calls } = fakeClient(() => ({ data: monthStateFixture, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    await gateway.loadMonth({ spaceId: 'space-1', month: '2026-09-01', currency: 'USD', snapshotId: null });
    expect(calls[0]!.args['p_snapshot_id']).toBeNull();
  });

  it('forwards the caller AbortSignal into the transport', async () => {
    const { client, calls } = fakeClient(() => ({ data: monthStateFixture, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    const controller = new AbortController();
    await gateway.loadMonth({ spaceId: 'space-1', month: '2026-09-01', currency: 'USD', snapshotId: null }, controller.signal);
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it('preserves a bigint identifier beyond Number.MAX_SAFE_INTEGER as text', async () => {
    const { client } = fakeClient(() => ({ data: { ...monthStateFixture, snapshotId: '9007199254740993' }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    const result = await gateway.loadMonth({ spaceId: 'space-1', month: '2026-09-01', currency: 'USD', snapshotId: null });
    expect(result.snapshotId).toBe('9007199254740993');
  });

  it('rejects an unsafe money number in the response', async () => {
    const { client } = fakeClient(() => ({ data: { ...monthStateFixture, actualIncomeMinor: 9_007_199_254_740_993 }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    await expect(gateway.loadMonth({ spaceId: 'space-1', month: '2026-09-01', currency: 'USD', snapshotId: null })).rejects.toThrow();
  });

  it('rejects a null required money field, never defaulting to zero', async () => {
    const { client } = fakeClient(() => ({ data: { ...monthStateFixture, expenseMinor: null }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    await expect(gateway.loadMonth({ spaceId: 'space-1', month: '2026-09-01', currency: 'USD', snapshotId: null })).rejects.toThrow();
  });

  it('rejects an unknown rowKind even though the field is typed as a string', async () => {
    const { client } = fakeClient(() => ({
      data: { ...monthStateFixture, groups: [{ ...monthStateFixture.groups[0], rowKind: 'archived' }] },
      error: null,
    }));
    const gateway = createSupabaseAllocationGateway(client);
    await expect(gateway.loadMonth({ spaceId: 'space-1', month: '2026-09-01', currency: 'USD', snapshotId: null })).rejects.toThrow();
  });

  it('rejects a real group row missing its groupId', async () => {
    const { client } = fakeClient(() => ({
      data: { ...monthStateFixture, groups: [{ ...monthStateFixture.groups[0], groupId: null }] },
      error: null,
    }));
    const gateway = createSupabaseAllocationGateway(client);
    await expect(gateway.loadMonth({ spaceId: 'space-1', month: '2026-09-01', currency: 'USD', snapshotId: null })).rejects.toThrow();
  });

  it('rejects a duplicate real group id', async () => {
    const duplicated = [monthStateFixture.groups[0], monthStateFixture.groups[0]];
    const { client } = fakeClient(() => ({ data: { ...monthStateFixture, groups: duplicated }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    await expect(gateway.loadMonth({ spaceId: 'space-1', month: '2026-09-01', currency: 'USD', snapshotId: null })).rejects.toThrow();
  });

  it('accepts two distinct synthetic rows even though both carry groupId null', async () => {
    const { client } = fakeClient(() => ({ data: monthStateFixture, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    const result = await gateway.loadMonth({ spaceId: 'space-1', month: '2026-09-01', currency: 'USD', snapshotId: null });
    expect(result.groups.filter((g) => g.groupId === null)).toHaveLength(2);
  });

  it('rejects a duplicate synthetic rowKind', async () => {
    const duplicated = [monthStateFixture.groups[1], monthStateFixture.groups[1]];
    const { client } = fakeClient(() => ({ data: { ...monthStateFixture, groups: duplicated }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    await expect(gateway.loadMonth({ spaceId: 'space-1', month: '2026-09-01', currency: 'USD', snapshotId: null })).rejects.toThrow();
  });

  it('rejects a response beyond the 14-row group cap (12 real + 2 synthetic)', async () => {
    const groups = Array.from({ length: 15 }, (_v, index) => ({
      ...monthStateFixture.groups[0],
      groupId: `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
      order: index,
    }));
    const { client } = fakeClient(() => ({ data: { ...monthStateFixture, groups }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    await expect(gateway.loadMonth({ spaceId: 'space-1', month: '2026-09-01', currency: 'USD', snapshotId: null })).rejects.toThrow();
  });

  it('parses the signed actualShareOfIncomeBps as text, not as a coerced number', async () => {
    const { client } = fakeClient(() => ({
      data: { ...monthStateFixture, groups: [{ ...monthStateFixture.groups[0], actualShareOfIncomeBps: '999999999999999999999' }] },
      error: null,
    }));
    const gateway = createSupabaseAllocationGateway(client);
    const result = await gateway.loadMonth({ spaceId: 'space-1', month: '2026-09-01', currency: 'USD', snapshotId: null });
    expect(result.groups[0]!.actualShareOfIncomeBps).toBe('999999999999999999999');
  });

  it('propagates an RPC error', async () => {
    const { client } = fakeClient(() => ({ data: null, error: { code: 'P0001', message: 'the requested snapshot does not belong to this space, currency, and month' } }));
    const gateway = createSupabaseAllocationGateway(client);
    await expect(gateway.loadMonth({ spaceId: 'space-1', month: '2026-09-01', currency: 'USD', snapshotId: '999' }))
      .rejects.toMatchObject({ code: 'P0001' });
  });
});

const categoryPageFixture = {
  rows: [
    { rootId: '00000000-0000-4000-8000-000000000010', nameEn: 'Groceries', nameAr: null, targetMinor: '10000', actualMinor: '8000', varianceMinor: '2000', hasPlan: true, groupId: '00000000-0000-4000-8000-000000000001' },
  ],
  nextRootId: null,
  hasMore: false,
};

describe('createSupabaseAllocationGateway: loadCategoryPage', () => {
  it('maps every input field and parses a valid page', async () => {
    const { client, calls } = fakeClient(() => ({ data: categoryPageFixture, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    const result = await gateway.loadCategoryPage({
      spaceId: 'space-1', month: '2026-09-01', currency: 'USD', snapshotId: '12',
      groupId: '00000000-0000-4000-8000-000000000001', afterRootId: null, limit: 50,
    });
    expect(calls[0]).toMatchObject({
      name: 'allocation_category_page',
      args: {
        p_space_id: 'space-1', p_month: '2026-09-01', p_currency: 'USD', p_snapshot_id: 12,
        p_group_id: '00000000-0000-4000-8000-000000000001', p_after_root_id: null, p_limit: 50,
      },
    });
    expect(result.rows).toHaveLength(1);
  });

  it('rejects a response beyond the requested page bound (101 rows)', async () => {
    const rows = Array.from({ length: 101 }, (_v, index) => ({
      ...categoryPageFixture.rows[0],
      rootId: `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
    }));
    const { client } = fakeClient(() => ({ data: { ...categoryPageFixture, rows }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    await expect(gateway.loadCategoryPage({
      spaceId: 'space-1', month: '2026-09-01', currency: 'USD', snapshotId: '12', groupId: null, afterRootId: null, limit: 100,
    })).rejects.toThrow();
  });

  it('rejects a duplicate rootId across the page', async () => {
    const { client } = fakeClient(() => ({ data: { ...categoryPageFixture, rows: [categoryPageFixture.rows[0], categoryPageFixture.rows[0]] }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    await expect(gateway.loadCategoryPage({
      spaceId: 'space-1', month: '2026-09-01', currency: 'USD', snapshotId: '12', groupId: null, afterRootId: null, limit: 50,
    })).rejects.toThrow();
  });
});

const historyPageFixture = {
  rows: [{ snapshotId: '12', createdAt: '2026-09-14T12:00:00Z', actorId: '11111111-1111-4111-8111-111111111111', plannedIncomeMinor: '200000', templateRevisionId: '9' }],
  nextId: null,
  hasMore: false,
};

describe('createSupabaseAllocationGateway: loadHistoryPage', () => {
  it('maps input fields and parses a valid page', async () => {
    const { client, calls } = fakeClient(() => ({ data: historyPageFixture, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    const result = await gateway.loadHistoryPage({ spaceId: 'space-1', month: '2026-09-01', currency: 'USD', beforeId: '13', limit: 20 });
    expect(calls[0]).toMatchObject({
      name: 'allocation_history_page',
      args: { p_space_id: 'space-1', p_month: '2026-09-01', p_currency: 'USD', p_before_id: 13, p_limit: 20 },
    });
    expect(result.rows[0]!.snapshotId).toBe('12');
  });
});

const trendFixture = {
  months: [
    { month: '2026-09-01', incomeMinor: '180000', expenseMinor: '161000', ownDebtPaidMinor: '15000', hasPlan: true, plannedIncomeMinor: '200000' },
    { month: '2026-10-01', incomeMinor: '0', expenseMinor: '0', ownDebtPaidMinor: '0', hasPlan: false, plannedIncomeMinor: null },
  ],
};

describe('createSupabaseAllocationGateway: loadTrend', () => {
  it('maps input fields and parses a valid trend, including an empty hasPlan=false month', async () => {
    const { client, calls } = fakeClient(() => ({ data: trendFixture, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    const result = await gateway.loadTrend({ spaceId: 'space-1', currency: 'USD', firstMonth: '2026-09-01', monthCount: 2 });
    expect(calls[0]).toMatchObject({
      name: 'allocation_trend',
      args: { p_space_id: 'space-1', p_currency: 'USD', p_first_month: '2026-09-01', p_month_count: 2 },
    });
    expect(result.months[1]).toEqual({ month: '2026-10-01', incomeMinor: '0', expenseMinor: '0', ownDebtPaidMinor: '0', hasPlan: false, plannedIncomeMinor: null });
  });

  it('rejects an invalid leap-date month in the response', async () => {
    const { client } = fakeClient(() => ({ data: { months: [{ ...trendFixture.months[0], month: '2025-02-29' }] }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    await expect(gateway.loadTrend({ spaceId: 'space-1', currency: 'USD', firstMonth: '2025-02-01', monthCount: 1 })).rejects.toThrow();
  });

  it('rejects a response beyond the 12-month cap', async () => {
    const months = Array.from({ length: 13 }, (_v, index) => ({ ...trendFixture.months[0], month: `2026-${String((index % 12) + 1).padStart(2, '0')}-01` }));
    const { client } = fakeClient(() => ({ data: { months }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    await expect(gateway.loadTrend({ spaceId: 'space-1', currency: 'USD', firstMonth: '2026-01-01', monthCount: 12 })).rejects.toThrow();
  });
});

describe('createSupabaseAllocationGateway: saveTemplate', () => {
  it('maps groups/root mappings and the expected revision id, and parses the result', async () => {
    const { client, calls } = fakeClient(() => ({ data: { templateRevisionId: '9' }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    const result = await gateway.saveTemplate({
      spaceId: 'space-1', requestId: 'req-1', currency: 'USD', expectedRevisionId: '8',
      groups: [{ id: '00000000-0000-4000-8000-000000000001', purpose: 'spending', nameEn: 'Essentials', nameAr: null, order: 0, basisPoints: 5600 }],
      rootMappings: [{ categoryId: '00000000-0000-4000-8000-000000000010', groupId: '00000000-0000-4000-8000-000000000001' }],
    });
    expect(calls[0]).toMatchObject({
      name: 'save_allocation_template',
      args: {
        p_space_id: 'space-1', p_request_id: 'req-1', p_currency: 'USD', p_expected_revision_id: 8,
        p_groups: [{ id: '00000000-0000-4000-8000-000000000001', purpose: 'spending', nameEn: 'Essentials', nameAr: null, order: 0, basisPoints: 5600 }],
        p_root_mappings: [{ categoryId: '00000000-0000-4000-8000-000000000010', groupId: '00000000-0000-4000-8000-000000000001' }],
      },
    });
    expect(result.templateRevisionId).toBe('9');
  });

  it('sends a null p_expected_revision_id for a first save', async () => {
    const { client, calls } = fakeClient(() => ({ data: { templateRevisionId: '1' }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    await gateway.saveTemplate({ spaceId: 'space-1', requestId: 'req-1', currency: 'USD', expectedRevisionId: null, groups: [], rootMappings: [] });
    expect(calls[0]!.args['p_expected_revision_id']).toBeNull();
  });

  it('rejects more than 12 groups before calling the RPC', async () => {
    const { client, calls } = fakeClient(() => ({ data: { templateRevisionId: '1' }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    const groups = Array.from({ length: 13 }, (_v, index) => ({
      id: `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`, purpose: 'spending' as const, nameEn: 'x', nameAr: null, order: index, basisPoints: 1,
    }));
    await expect(gateway.saveTemplate({ spaceId: 'space-1', requestId: 'req-1', currency: 'USD', expectedRevisionId: null, groups, rootMappings: [] }))
      .rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('createSupabaseAllocationGateway: publishMonth', () => {
  it('maps root targets, income, and every expected head, then parses the result', async () => {
    const { client, calls } = fakeClient(() => ({ data: { snapshotId: '12', incomeRevisionId: '30001' }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    const result = await gateway.publishMonth({
      spaceId: 'space-1', requestId: 'req-1', month: '2026-09-01', currency: 'USD',
      expectedSnapshotId: null, templateRevisionId: '9', expectedIncomeRevisionId: null,
      incomeMinor: '200000', rootTargets: [{ categoryId: '00000000-0000-4000-8000-000000000010', amountMinor: '112000', expectedRevisionId: null }],
      loanGroupId: '00000000-0000-4000-8000-000000000003',
    });
    expect(calls[0]).toMatchObject({
      name: 'publish_allocation_month',
      args: {
        p_space_id: 'space-1', p_request_id: 'req-1', p_month: '2026-09-01', p_currency: 'USD',
        p_expected_snapshot_id: null, p_template_revision_id: 9, p_expected_income_revision_id: null,
        p_income_minor: '200000', p_loan_group_id: '00000000-0000-4000-8000-000000000003',
      },
    });
    expect(calls[0]!.args['p_root_targets']).toEqual([{ categoryId: '00000000-0000-4000-8000-000000000010', amountMinor: '112000', expectedRevisionId: null }]);
    expect(result.snapshotId).toBe('12');
  });

  it('rejects a negative income amount before calling the RPC (mutation input is nonnegative-only)', async () => {
    const { client, calls } = fakeClient(() => ({ data: { snapshotId: '1', incomeRevisionId: '1' }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    await expect(gateway.publishMonth({
      spaceId: 'space-1', requestId: 'req-1', month: '2026-09-01', currency: 'USD',
      expectedSnapshotId: null, templateRevisionId: '9', expectedIncomeRevisionId: null,
      incomeMinor: '-1', rootTargets: [], loanGroupId: null,
    })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('createSupabaseAllocationGateway: findCommand', () => {
  it('returns null when no receipt exists', async () => {
    const { client } = fakeClient(() => ({ data: null, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    await expect(gateway.findCommand('space-1', 'req-1')).resolves.toBeNull();
  });

  it('parses an existing receipt, passing its result through unmodified', async () => {
    const { client } = fakeClient(() => ({ data: { command: 'publish_allocation_month', sequenceId: '77', result: { snapshotId: '12', incomeRevisionId: '30001' } }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    const receipt = await gateway.findCommand('space-1', 'req-1');
    expect(receipt).toEqual({ command: 'publish_allocation_month', sequenceId: '77', result: { snapshotId: '12', incomeRevisionId: '30001' } });
  });
});
