import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { householdSpace, loansFixture, personalSpace } from '../../test/in-memory-loans-gateway.js';
import { createSupabaseLoansGateway } from './supabase-loans-gateway.js';
import type { CommandResult, CreateLoanInput, LoansDashboard, LoansGateway, MonthlyTargetInput, RepaymentInput, ReversalInput } from './types.js';
import { useLoans } from './use-loans.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

class DeferredLoansGateway implements LoansGateway {
  pending = new Map<string, ReturnType<typeof deferred<LoansDashboard>>>();
  listSpaces = vi.fn(async () => [personalSpace, householdSpace]);
  loadDashboard = vi.fn((spaceId: string) => {
    const request = deferred<LoansDashboard>();
    this.pending.set(spaceId, request);
    return request.promise;
  });
  createLoan = vi.fn(async (_input: CreateLoanInput): Promise<CommandResult> => ({}));
  recordRepayment = vi.fn(async (_input: RepaymentInput): Promise<CommandResult> => ({}));
  setMonthlyTarget = vi.fn(async (_input: MonthlyTargetInput): Promise<CommandResult> => ({}));
  reverseEvent = vi.fn(async (_input: ReversalInput): Promise<CommandResult> => ({}));
}

describe('useLoans controlled space loading', () => {
  it('clears previous-space data immediately during a switch', async () => {
    const gateway = new DeferredLoansGateway();
    const { result, rerender } = renderHook(({ spaceId }) => useLoans(gateway, { spaceId }), { initialProps: { spaceId: personalSpace.id } });
    await waitFor(() => expect(gateway.pending.has(personalSpace.id)).toBe(true));
    act(() => gateway.pending.get(personalSpace.id)?.resolve(loansFixture(personalSpace)));
    await waitFor(() => expect(result.current.dashboard?.space.id).toBe(personalSpace.id));

    rerender({ spaceId: householdSpace.id });
    expect(result.current.dashboard).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it('ignores a late response from the previously selected space', async () => {
    const gateway = new DeferredLoansGateway();
    const { result, rerender } = renderHook(({ spaceId }) => useLoans(gateway, { spaceId }), { initialProps: { spaceId: personalSpace.id } });
    await waitFor(() => expect(gateway.pending.has(personalSpace.id)).toBe(true));
    rerender({ spaceId: householdSpace.id });
    await waitFor(() => expect(gateway.pending.has(householdSpace.id)).toBe(true));

    act(() => gateway.pending.get(householdSpace.id)?.resolve(loansFixture(householdSpace)));
    await waitFor(() => expect(result.current.dashboard?.space.id).toBe(householdSpace.id));
    act(() => gateway.pending.get(personalSpace.id)?.resolve(loansFixture(personalSpace)));
    await waitFor(() => expect(result.current.dashboard?.space.id).toBe(householdSpace.id));
  });

  it.each([
    ['null data', null, /exactly one result/],
    ['zero rows', [], /exactly one result/],
    ['multiple rows', [
      { loan_id: '11111111-1111-4111-8111-111111111111', event_id: '22222222-2222-4222-8222-222222222222' },
      { loan_id: '33333333-3333-4333-8333-333333333333', event_id: '44444444-4444-4444-8444-444444444444' },
    ], /exactly one result/],
    ['a null row', [null], /invalid row/],
    ['a missing loan identifier', [{ event_id: '22222222-2222-4222-8222-222222222222' }], /missing loan_id/],
    ['a missing event identifier', [{ loan_id: '11111111-1111-4111-8111-111111111111' }], /missing event_id/],
    ['a null identifier', [{ loan_id: null, event_id: '22222222-2222-4222-8222-222222222222' }], /missing loan_id/],
    ['a malformed identifier', [{ loan_id: 'loan-1', event_id: '22222222-2222-4222-8222-222222222222' }], /invalid loan_id/],
  ] as const)('does not refresh or report success when loan creation returns %s', async (_label, response, message) => {
    const adapter = createSupabaseLoansGateway({
      from() { throw new Error('Loan query access is not used by this command test.'); },
      async rpc() { return { data: response === null ? null : [...response], error: null }; },
    });
    const loadDashboard = vi.fn(async () => loansFixture(personalSpace));
    const service: LoansGateway = {
      listSpaces: vi.fn(async () => [personalSpace]),
      loadDashboard,
      createLoan: adapter.createLoan,
      recordRepayment: adapter.recordRepayment,
      setMonthlyTarget: adapter.setMonthlyTarget,
      reverseEvent: adapter.reverseEvent,
    };
    const { result } = renderHook(() => useLoans(service, { spaceId: personalSpace.id }));
    await waitFor(() => expect(result.current.dashboard?.space.id).toBe(personalSpace.id));

    await act(async () => {
      await expect(result.current.createLoan({
        mode: 'opening', spaceId: personalSpace.id, direction: 'they_owe_me', personName: 'Maya',
        currency: 'USD', amountMinor: '12500', effectiveDate: '2026-09-01', dueDate: null, note: null,
      })).rejects.toThrow(message);
    });
    expect(loadDashboard).toHaveBeenCalledOnce();
  });
});
