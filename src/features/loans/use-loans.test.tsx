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

  describe.each([
    ['opening loan', ['loan_id', 'event_id']],
    ['cash loan', ['loan_id', 'event_id']],
    ['repayment', ['event_id']],
    ['monthly target', ['id']],
    ['reversal', ['id']],
  ] as const)('%s command boundary', (command, requiredKeys) => {
    const validRow: Record<string, string> = Object.fromEntries(requiredKeys.map((key, index) => [
      key,
      `${index + 1}1111111-1111-4111-8111-111111111111`,
    ]));
    const identifierCases: Array<[string, readonly unknown[], RegExp]> = requiredKeys.flatMap((key) => {
      const missing = Object.fromEntries(Object.entries(validRow).filter(([candidate]) => candidate !== key));
      return [
        [`a missing ${key}`, [missing], new RegExp(`missing ${key}`)],
        [`a null ${key}`, [{ ...validRow, [key]: null }], new RegExp(`missing ${key}`)],
        [`a malformed ${key}`, [{ ...validRow, [key]: 'not-a-uuid' }], new RegExp(`invalid ${key}`)],
      ];
    });
    const responses: Array<[string, readonly unknown[] | null, RegExp]> = [
      ['null data', null, /exactly one result/],
      ['zero rows', [], /exactly one result/],
      ['multiple rows', [validRow, validRow], /exactly one result/],
      ['a null row', [null], /invalid row/],
      ...identifierCases,
    ];

    it.each(responses)('does not refresh or report success when the RPC returns %s', async (_label, response, message) => {
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

      const invoke = command === 'opening loan'
        ? () => result.current.createLoan({
            mode: 'opening', spaceId: personalSpace.id, direction: 'they_owe_me', personName: 'Maya',
            currency: 'USD', amountMinor: '12500', effectiveDate: '2026-09-01', dueDate: null, note: null,
          })
        : command === 'cash loan'
          ? () => result.current.createLoan({
              mode: 'cash', spaceId: personalSpace.id, direction: 'i_owe_them', personName: 'Omar',
              currency: 'USD', walletId: 'wallet-1', amountMinor: '12500', effectiveDate: '2026-09-01',
              dueDate: null, note: null,
            })
          : command === 'repayment'
            ? () => result.current.recordRepayment({
                spaceId: personalSpace.id, loanId: 'loan-1', walletId: 'wallet-1',
                amountMinor: '2500', effectiveDate: '2026-09-02',
              })
            : command === 'monthly target'
              ? () => result.current.setMonthlyTarget({
                  spaceId: personalSpace.id, loanId: 'loan-1', month: '2026-09-01', targetMinor: '5000',
                })
              : () => result.current.reverseEvent({
                  spaceId: personalSpace.id, eventId: 'event-1', effectiveDate: '2026-09-03',
                });
      await act(async () => {
        await expect(invoke()).rejects.toThrow(message);
      });
      expect(loadDashboard).toHaveBeenCalledOnce();
    });
  });
});
