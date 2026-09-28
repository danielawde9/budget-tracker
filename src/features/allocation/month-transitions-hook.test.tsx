import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { coreMonthStateFixture, InMemoryAllocationGateway } from '../../test/in-memory-allocation-gateway.js';
import type { AllocationGateway, MonthCopyPreview } from './types.js';
import { useAllocation } from './use-allocation.js';

const rootId = '00000000-0000-4000-8000-000000000010';

function copyDraft() {
  return {
    sourceSnapshotId: '12',
    targetMonth: '2026-10-01',
    expectedTargetSnapshotId: null,
    acceptedPreviewHash: 'a'.repeat(64),
  };
}

function closeDraft() {
  return { month: '2026-09-01', expectedCloseId: null, acceptedPreviewHash: 'b'.repeat(64) };
}

describe('useAllocation: month transitions', () => {
  it('previewCopy/loadMonthFor pass through the current space and currency and return the parsed preview', async () => {
    const gateway = new InMemoryAllocationGateway();
    gateway.monthState = coreMonthStateFixture;
    const { result } = renderHook(() => useAllocation(gateway, 'space-1', '2026-09-01', 'USD'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const preview = await result.current.previewCopy({ sourceSnapshotId: '12', targetMonth: '2026-10-01' });
    expect(preview.targetMonth).toBe('2026-10-01');
    const previous = await result.current.loadMonthFor('2026-08-01');
    expect(previous.snapshotId).toBe(coreMonthStateFixture.snapshotId);
    const call = gateway.calls.find((entry) => entry.name === 'previewCopy')!;
    expect(call.input).toMatchObject({ spaceId: 'space-1', currency: 'USD', sourceSnapshotId: '12', targetMonth: '2026-10-01' });
  });

  it('copyMonth posts once with the generated request id, refreshes, and never reposts', async () => {
    const gateway = new InMemoryAllocationGateway();
    const { result } = renderHook(() => useAllocation(gateway, 'space-1', '2026-09-01', 'USD', undefined, () => 'req-fixed'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    gateway.monthState = coreMonthStateFixture;
    await act(async () => {
      const outcome = await result.current.copyMonth(copyDraft());
      expect(outcome).toMatchObject({ status: 'success', reconciled: false });
    });
    expect(gateway.calls.filter((call) => call.name === 'copyMonth')).toHaveLength(1);
    expect((gateway.calls.find((call) => call.name === 'copyMonth')!.input as { requestId: string }).requestId).toBe('req-fixed');
    expect(result.current.status).toBe('ready');
  });

  it('U22-02 rejects a stale preview: a changed target head between preview and confirm is a stale_revision, not a silent copy', async () => {
    const gateway = new InMemoryAllocationGateway();
    const { result } = renderHook(() => useAllocation(gateway, 'space-1', '2026-09-01', 'USD'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await expect(result.current.copyMonth({
      sourceSnapshotId: '12', targetMonth: '2026-10-01', expectedTargetSnapshotId: '99', acceptedPreviewHash: 'a'.repeat(64),
    })).rejects.toMatchObject({ code: '40001' });
    expect(result.current.status).toBe('ready');
    expect(gateway.calls.filter((call) => call.name === 'copyMonth')).toHaveLength(1);
  });

  it('goes ambiguous on a timeout-shaped copy failure, then allows one explicit identical-UUID retry', async () => {
    const gateway = new InMemoryAllocationGateway();
    let attempt = 0;
    gateway.copyMonth = vi.fn(async (input) => {
      attempt += 1;
      if (attempt === 1) throw new Error('network timeout');
      return { snapshotId: '13', sourceSnapshotId: input.sourceSnapshotId, previewHash: input.acceptedPreviewHash };
    });
    const { result } = renderHook(() => useAllocation(gateway, 'space-1', '2026-09-01', 'USD', undefined, () => 'req-fixed'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      const outcome = await result.current.copyMonth(copyDraft());
      expect(outcome).toMatchObject({ status: 'ambiguous', reconciled: false });
    });
    expect(result.current.status).toBe('ambiguous');
    expect(result.current.ambiguous).toEqual({ kind: 'copyMonth', requestId: 'req-fixed' });
    await act(async () => {
      const outcome = await result.current.retryAmbiguous();
      expect(outcome).toMatchObject({ status: 'success' });
    });
    const calls = (gateway.copyMonth as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as { requestId: string });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.requestId).toBe(calls[1]!.requestId);
  });

  it('treats an ambiguous close as already accepted once its receipt is visible, without retrying it', async () => {
    const gateway = new InMemoryAllocationGateway();
    gateway.closeMonth = vi.fn(async () => { throw new Error('connection timeout'); });
    gateway.findCommand = vi.fn(async () => ({ command: 'close_budget_month', sequenceId: '1', result: { closeId: '8', previewHash: 'b'.repeat(64), restatesCloseId: null } }));
    const { result } = renderHook(() => useAllocation(gateway, 'space-1', '2026-09-01', 'USD'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      const outcome = await result.current.closeMonth(closeDraft());
      expect(outcome).toMatchObject({ status: 'success', reconciled: true });
    });
    expect(gateway.closeMonth).toHaveBeenCalledTimes(1);
    expect(result.current.ambiguous).toBeNull();
  });

  it('an accepted close whose follow-up read fails is accepted-refresh-pending, never reposted', async () => {
    const gateway = new InMemoryAllocationGateway();
    let failNextLoad = false;
    gateway.loadMonth = vi.fn(async (input, signal) => {
      if (failNextLoad) { failNextLoad = false; throw new Error('read failed after commit'); }
      return InMemoryAllocationGateway.prototype.loadMonth.call(gateway, input, signal);
    });
    const { result } = renderHook(() => useAllocation(gateway, 'space-1', '2026-09-01', 'USD'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    failNextLoad = true;
    await act(async () => {
      const outcome = await result.current.closeMonth(closeDraft());
      expect(outcome).toMatchObject({ status: 'refresh-required', reconciled: false });
    });
    expect(result.current.status).toBe('accepted-refresh-pending');
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(gateway.calls.filter((call) => call.name === 'closeMonth')).toHaveLength(1);
  });

  it('setRollover reuses the close preview policy head and reconciles by receipt without reposting', async () => {
    const gateway = new InMemoryAllocationGateway();
    gateway.policyHeadByRoot.set(rootId, '4');
    const { result } = renderHook(() => useAllocation(gateway, 'space-1', '2026-09-01', 'USD'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      const outcome = await result.current.setRollover({ rootId, enabled: true, expectedRevisionId: '4' });
      expect(outcome).toMatchObject({ status: 'success', reconciled: false });
    });
    expect(gateway.policyHeadByRoot.get(rootId)).toBe('100');
    expect(gateway.calls.filter((call) => call.name === 'setRollover')).toHaveLength(1);
  });

  it('disables starting a new month-transition command while ambiguous, until reconciled or cleared', async () => {
    const gateway = new InMemoryAllocationGateway();
    gateway.setRollover = vi.fn(async () => { throw new Error('network timeout'); });
    const { result } = renderHook(() => useAllocation(gateway, 'space-1', '2026-09-01', 'USD'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.setRollover({ rootId, enabled: true, expectedRevisionId: null });
    });
    expect(result.current.status).toBe('ambiguous');
    await expect(result.current.copyMonth(copyDraft())).rejects.toThrow();
    act(() => { result.current.clearAmbiguous(); });
    expect(result.current.ambiguous).toBeNull();
  });

  it('exposes a preview read that a caller can retry after a stale confirmation', async () => {
    const gateway = new InMemoryAllocationGateway();
    const preview: MonthCopyPreview = gateway.copyPreview;
    gateway.previewCopy = vi.fn(async () => preview);
    const { result } = renderHook(() => useAllocation(gateway, 'space-1', '2026-09-01', 'USD'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const first = await result.current.previewCopy({ sourceSnapshotId: '12', targetMonth: '2026-10-01' });
    const second = await result.current.previewCopy({ sourceSnapshotId: '12', targetMonth: '2026-10-01' });
    expect(first.previewHash).toBe(second.previewHash);
  });
});
