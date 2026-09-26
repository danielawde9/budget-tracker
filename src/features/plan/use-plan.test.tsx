import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InMemoryPlanClient } from '../../test/in-memory-plan-client.js';
import { usePlan } from './use-plan.js';
import type { BudgetCategoryRow } from './types.js';

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

  it('loads category rows for both currencies and keeps each tagged with its own currency', async () => {
    const client = new InMemoryPlanClient();
    const usdRow: BudgetCategoryRow = {
      categoryId: 'cat-usd', nameEn: 'Groceries', nameAr: 'بقالة', archivedAt: null,
      currency: 'USD', targetMinor: '30000', actualSpentMinor: '21000',
      remainingMinor: '9000', overspentMinor: '0', targetRevisionId: '1',
    };
    const lbpRow: BudgetCategoryRow = {
      categoryId: 'cat-lbp', nameEn: 'Fuel', nameAr: 'وقود', archivedAt: null,
      currency: 'LBP', targetMinor: '2000000', actualSpentMinor: '500000',
      remainingMinor: '1500000', overspentMinor: '0', targetRevisionId: '2',
    };
    // A typo'd currency literal, a dropped lbpRows, or a swapped concat in
    // usePlan's load() would either duplicate one currency, drop the other,
    // or hand back the wrong currency tag -- any of those fails one of the
    // assertions below, since each currency is only ever seeded once here.
    client.categoryRows = [usdRow, lbpRow];
    const { result } = renderHook(() => usePlan(client, 'space-1', '2026-09-01'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.categoryRows).toHaveLength(2);
    expect(result.current.categoryRows).toEqual(expect.arrayContaining([usdRow, lbpRow]));
    expect(result.current.categoryRows.find((row) => row.categoryId === 'cat-usd')?.currency).toBe('USD');
    expect(result.current.categoryRows.find((row) => row.categoryId === 'cat-lbp')?.currency).toBe('LBP');
  });

  it('setIncomePlan posts with a generated request id and refreshes', async () => {
    const client = new InMemoryPlanClient();
    const { result } = renderHook(() => usePlan(client, 'space-1', '2026-09-01', () => 'req-fixed'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    client.summaries = [{ ...client.summaries[0]!, plannedIncomeMinor: '999000' }];
    await act(async () => {
      await result.current.setIncomePlan({ currency: 'USD', amountMinor: '100000', expectedRevisionId: null });
    });
    expect(client.calls[0]).toMatchObject({ name: 'setIncomePlan' });
    expect((client.calls[0]?.input as { requestId: string }).requestId).toBe('req-fixed');
    expect(result.current.status).toBe('ready');
    expect(result.current.summaries[0]?.plannedIncomeMinor).toBe('999000');
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
