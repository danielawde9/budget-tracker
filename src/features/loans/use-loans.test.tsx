import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { householdSpace, loansFixture, personalSpace } from '../../test/in-memory-loans-gateway.js';
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
});
