import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InMemoryPlanClient } from '../../test/in-memory-plan-client.js';
import { usePlan } from './use-plan.js';

describe('usePlan', () => {
  it('loads summary and category rows for the current month', async () => {
    const client = new InMemoryPlanClient();
    client.summaries = [{ currency: 'USD', plannedIncomeMinor: '210000', actualIncomeMinor: '0',
      categoryTargetTotalMinor: '0', categoryActualSpentMinor: '0', uncategorizedSpentMinor: '0',
      categoryOverspentMinor: '0', actualLoanRepaymentMinor: '0', remainingLoanReservationMinor: '0',
      loanCommitmentMinor: '0', unallocatedMinor: '210000', overallocatedMinor: '0', incomePlanRevisionId: '1' }];
    const { result } = renderHook(() => usePlan(client, 'space-1', '2026-09-01'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.summaries[0]?.plannedIncomeMinor).toBe('210000');
  });

  it('setIncomePlan posts with a generated request id and refreshes', async () => {
    const client = new InMemoryPlanClient();
    const { result } = renderHook(() => usePlan(client, 'space-1', '2026-09-01', () => 'req-fixed'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.setIncomePlan({ currency: 'USD', amountMinor: '100000', expectedRevisionId: null });
    });
    expect(client.calls[0]).toMatchObject({ name: 'setIncomePlan' });
    expect((client.calls[0]?.input as { requestId: string }).requestId).toBe('req-fixed');
    expect(result.current.status).toBe('ready');
  });

  it('surfaces load errors with retry', async () => {
    const client = new InMemoryPlanClient();
    client.error = new Error('connection timeout');
    const { result } = renderHook(() => usePlan(client, 'space-1', '2026-09-01'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    client.error = null;
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });
});
