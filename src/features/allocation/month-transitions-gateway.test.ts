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
        abortSignal(value) { signal = value; return builder; },
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

// The task 21 boundary fixture's monetary subset, embedded in a complete
// valid response (base 10000, carry -2500 -> effective 7500).
const monetaryFixture = { baseMinor: '10000', carryMinor: '-2500', effectiveMinor: '7500' };

const sourceSnapshotId = '12';
const rootId = '00000000-0000-4000-8000-000000000010';
const groupId = '00000000-0000-4000-8000-000000000001';
const goalId = '00000000-0000-4000-8000-000000000101';

function copyPreviewFixture(): Record<string, unknown> {
  return {
    previewHash: 'a'.repeat(64),
    sourceSnapshotId,
    sourceMonth: '2026-09-01',
    targetMonth: '2026-10-01',
    currency: 'USD',
    expectedTargetSnapshotId: null,
    templateRevisionId: '9',
    expectedIncomeRevisionId: null,
    incomeMinor: '200000',
    loanGroupId: groupId,
    carryCloseId: '7',
    groups: [
      { groupId, nameEn: 'Essentials', nameAr: null, purpose: 'spending', order: 0, basisPoints: 5600, targetMinor: '112000', carryMinor: '0', effectiveMinor: '112000' },
    ],
    roots: [
      {
        categoryId: rootId, nameEn: 'Groceries', nameAr: null, groupId,
        ...monetaryFixture, actualMinor: null, outgoingCarryMinor: null, expectedRevisionId: null,
      },
    ],
    goals: [{ goalId, groupId: null, targetMinor: '5000', expectedRevisionId: null }],
    omissions: [{ entityId: rootId, kind: 'root', reason: 'archived' }],
    carrySources: [{ rootId, sourceCloseId: '7', carryMinor: '-2500' }],
  };
}

describe('createSupabaseAllocationGateway: previewCopy', () => {
  it('maps camelCase input to p_snake_case args and parses a complete valid response', async () => {
    const { client, calls } = fakeClient(() => ({ data: copyPreviewFixture(), error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    const result = await gateway.previewCopy({ spaceId: 'space-1', currency: 'USD', sourceSnapshotId, targetMonth: '2026-10-01' });
    expect(calls[0]).toMatchObject({
      name: 'preview_month_copy',
      args: { p_space_id: 'space-1', p_currency: 'USD', p_source_snapshot_id: 12, p_target_month: '2026-10-01' },
    });
    expect(result.roots[0]?.carryMinor).toBe('-2500');
    expect(result.targetMonth).toBe('2026-10-01');
    expect(result.expectedTargetSnapshotId).toBeNull();
    expect(result.groups[0]?.purpose).toBe('spending');
    expect(result.carrySources[0]?.carryMinor).toBe('-2500');
  });

  it('forwards the caller AbortSignal into the transport', async () => {
    const { client, calls } = fakeClient(() => ({ data: copyPreviewFixture(), error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    const controller = new AbortController();
    await gateway.previewCopy({ spaceId: 'space-1', currency: 'USD', sourceSnapshotId, targetMonth: '2026-10-01' }, controller.signal);
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it('preserves a bigint source snapshot id beyond Number.MAX_SAFE_INTEGER as text and rejects the unsafe number', async () => {
    const { client } = fakeClient(() => ({ data: { ...copyPreviewFixture(), sourceSnapshotId: '9007199254740993' }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    const result = await gateway.previewCopy({ spaceId: 'space-1', currency: 'USD', sourceSnapshotId, targetMonth: '2026-10-01' });
    expect(result.sourceSnapshotId).toBe('9007199254740993');

    const unsafe = fakeClient(() => ({ data: { ...copyPreviewFixture(), expectedTargetSnapshotId: 9007199254740993 }, error: null }));
    const unsafeGateway = createSupabaseAllocationGateway(unsafe.client);
    await expect(unsafeGateway.previewCopy({ spaceId: 'space-1', currency: 'USD', sourceSnapshotId, targetMonth: '2026-10-01' })).rejects.toThrow();
  });

  it('rejects an invalid leap-date target month, a null required hash, an unknown omission kind, and a duplicate root id', async () => {
    const cases: Record<string, unknown>[] = [
      { ...copyPreviewFixture(), targetMonth: '2025-02-29' },
      { ...copyPreviewFixture(), previewHash: null },
      { ...copyPreviewFixture(), omissions: [{ entityId: rootId, kind: 'banana', reason: 'archived' }] },
      { ...copyPreviewFixture(), roots: [copyPreviewFixture()['roots'], copyPreviewFixture()['roots']] },
    ];
    for (const data of cases) {
      const { client } = fakeClient(() => ({ data, error: null }));
      const gateway = createSupabaseAllocationGateway(client);
      await expect(gateway.previewCopy({ spaceId: 'space-1', currency: 'USD', sourceSnapshotId, targetMonth: '2026-10-01' })).rejects.toThrow();
    }
  });

  it('rejects a response beyond the 200-root omission-safe bound', async () => {
    const root = (copyPreviewFixture()['roots'] as Record<string, unknown>[])[0]!;
    const roots = Array.from({ length: 201 }, (_v, index) => ({ ...root, categoryId: `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}` }));
    const { client } = fakeClient(() => ({ data: { ...copyPreviewFixture(), roots }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    await expect(gateway.previewCopy({ spaceId: 'space-1', currency: 'USD', sourceSnapshotId, targetMonth: '2026-10-01' })).rejects.toThrow();
  });

  it('propagates the source-not-found rejection', async () => {
    const { client } = fakeClient(() => ({ data: null, error: { code: 'P0001', message: 'month_copy_source_not_found' } }));
    const gateway = createSupabaseAllocationGateway(client);
    await expect(gateway.previewCopy({ spaceId: 'space-1', currency: 'USD', sourceSnapshotId, targetMonth: '2026-10-01' }))
      .rejects.toMatchObject({ code: 'P0001' });
  });
});

describe('createSupabaseAllocationGateway: copyMonth', () => {
  it('maps every mutation argument and parses the result', async () => {
    const { client, calls } = fakeClient(() => ({ data: { snapshotId: '13', sourceSnapshotId, previewHash: 'a'.repeat(64) }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    const result = await gateway.copyMonth({
      spaceId: 'space-1', requestId: 'req-1', currency: 'USD', sourceSnapshotId, targetMonth: '2026-10-01',
      expectedTargetSnapshotId: '11', acceptedPreviewHash: 'a'.repeat(64),
    });
    expect(calls[0]).toMatchObject({
      name: 'copy_allocation_month',
      args: {
        p_space_id: 'space-1', p_request_id: 'req-1', p_currency: 'USD', p_source_snapshot_id: 12,
        p_target_month: '2026-10-01', p_expected_target_snapshot_id: 11, p_accepted_preview_hash: 'a'.repeat(64),
      },
    });
    expect(result).toEqual({ snapshotId: '13', sourceSnapshotId: '12', previewHash: 'a'.repeat(64) });
  });

  it('rejects a malformed accepted preview hash before calling the RPC', async () => {
    const { client, calls } = fakeClient(() => ({ data: { snapshotId: '13', sourceSnapshotId, previewHash: 'a'.repeat(64) }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    await expect(gateway.copyMonth({
      spaceId: 'space-1', requestId: 'req-1', currency: 'USD', sourceSnapshotId, targetMonth: '2026-10-01',
      expectedTargetSnapshotId: null, acceptedPreviewHash: 'not-a-hash',
    })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

const closeRootFixture = {
  categoryId: rootId, nameEn: 'Groceries', nameAr: null, groupId,
  ...monetaryFixture, actualMinor: '12500', outgoingCarryMinor: '-2500',
  enabled: true, policyRevisionId: '4', carrySourceCloseId: null,
};

function closePreviewFixture(): Record<string, unknown> {
  return {
    previewHash: 'b'.repeat(64),
    month: '2026-09-01',
    currency: 'USD',
    snapshotId: sourceSnapshotId,
    expectedCloseId: null,
    incomeMinor: '180000',
    spendingMinor: '161000',
    factCount: '42',
    factDigest: 'c'.repeat(64),
    restatementRequired: false,
    roots: [closeRootFixture],
  };
}

describe('createSupabaseAllocationGateway: previewClose', () => {
  it('maps input and parses a complete valid response with a signed outgoing carry', async () => {
    const { client, calls } = fakeClient(() => ({ data: closePreviewFixture(), error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    const result = await gateway.previewClose({ spaceId: 'space-1', currency: 'USD', month: '2026-09-01', expectedCloseId: null });
    expect(calls[0]).toMatchObject({
      name: 'preview_budget_month_close',
      args: { p_space_id: 'space-1', p_currency: 'USD', p_month: '2026-09-01', p_expected_close_id: null },
    });
    expect(result.roots[0]?.outgoingCarryMinor).toBe('-2500');
    expect(result.roots[0]?.enabled).toBe(true);
    expect(result.restatementRequired).toBe(false);
  });

  it('carries the current close head through and reports a restatement', async () => {
    const { client, calls } = fakeClient(() => ({ data: { ...closePreviewFixture(), expectedCloseId: '7', restatementRequired: true }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    const result = await gateway.previewClose({ spaceId: 'space-1', currency: 'USD', month: '2026-09-01', expectedCloseId: '7' });
    expect(calls[0]!.args['p_expected_close_id']).toBe(7);
    expect(result.expectedCloseId).toBe('7');
    expect(result.restatementRequired).toBe(true);
  });

  it('rejects a non-boolean enabled flag and a null required money field', async () => {
    for (const data of [
      { ...closePreviewFixture(), roots: [{ ...closeRootFixture, enabled: 'yes' }] },
      { ...closePreviewFixture(), roots: [{ ...closeRootFixture, actualMinor: null }] },
    ]) {
      const { client } = fakeClient(() => ({ data, error: null }));
      const gateway = createSupabaseAllocationGateway(client);
      await expect(gateway.previewClose({ spaceId: 'space-1', currency: 'USD', month: '2026-09-01', expectedCloseId: null })).rejects.toThrow();
    }
  });
});

describe('createSupabaseAllocationGateway: closeMonth', () => {
  it('maps every mutation argument and parses the result', async () => {
    const { client, calls } = fakeClient(() => ({ data: { closeId: '8', previewHash: 'b'.repeat(64), restatesCloseId: '7' }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    const result = await gateway.closeMonth({
      spaceId: 'space-1', requestId: 'req-1', currency: 'USD', month: '2026-09-01', expectedCloseId: '7', acceptedPreviewHash: 'b'.repeat(64),
    });
    expect(calls[0]).toMatchObject({
      name: 'close_budget_month',
      args: {
        p_space_id: 'space-1', p_request_id: 'req-1', p_currency: 'USD', p_month: '2026-09-01',
        p_expected_close_id: 7, p_accepted_preview_hash: 'b'.repeat(64),
      },
    });
    expect(result).toEqual({ closeId: '8', previewHash: 'b'.repeat(64), restatesCloseId: '7' });
  });
});

describe('createSupabaseAllocationGateway: setRollover', () => {
  it('maps input including a null expected revision for the initial opt-in and parses the revision', async () => {
    const { client, calls } = fakeClient(() => ({ data: { revisionId: '4' }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    const result = await gateway.setRollover({
      spaceId: 'space-1', requestId: 'req-1', currency: 'USD', rootId, enabled: true, expectedRevisionId: null,
    });
    expect(calls[0]).toMatchObject({
      name: 'set_rollover_policy',
      args: { p_space_id: 'space-1', p_request_id: 'req-1', p_currency: 'USD', p_root_id: rootId, p_enabled: true, p_expected_revision_id: null },
    });
    expect(result).toEqual({ revisionId: '4' });
  });

  it('sends the current head as a numeric argument when disabling', async () => {
    const { client, calls } = fakeClient(() => ({ data: { revisionId: '5' }, error: null }));
    const gateway = createSupabaseAllocationGateway(client);
    await gateway.setRollover({ spaceId: 'space-1', requestId: 'req-1', currency: 'USD', rootId, enabled: false, expectedRevisionId: '4' });
    expect(calls[0]!.args['p_expected_revision_id']).toBe(4);
    expect(calls[0]!.args['p_enabled']).toBe(false);
  });
});
