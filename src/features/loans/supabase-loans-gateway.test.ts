import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSupabaseLoansGateway, type LoansDataClient } from './supabase-loans-gateway.js';

function recordingClient() {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const fromCalls: string[] = [];
  const client: LoansDataClient = {
    from(relation) {
      fromCalls.push(relation);
      const data = relation === 'spaces' ? [{ id: 'space-1', name: 'Personal', kind: 'personal' }] : [];
      const result = Promise.resolve({ data, error: null });
      const builder = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        order: () => builder,
        limit: () => result,
      };
      return builder;
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === 'loan_monthly_plan' || name === 'loan_monthly_currency_summary') {
        return { data: [], error: null };
      }
      return { data: [{ loan_id: 'loan-1', event_id: 'event-1', id: 'result-1' }], error: null };
    },
  };

  return { client, rpcCalls, fromCalls };
}

describe('Supabase loans command gateway', () => {
  it('uses the opening command without a wallet movement', async () => {
    const recorder = recordingClient();
    const gateway = createSupabaseLoansGateway(recorder.client);

    await gateway.createLoan({
      mode: 'opening',
      spaceId: 'space-1',
      requestId: 'request-1',
      direction: 'they_owe_me',
      personName: 'Maya',
      currency: 'USD',
      amountMinor: '12500',
      effectiveDate: '2026-09-01',
      dueDate: null,
      note: null,
    });

    expect(recorder.rpcCalls).toEqual([
      {
        name: 'open_loan_outstanding',
        args: {
          p_space_id: 'space-1',
          p_request_id: 'request-1',
          p_direction: 'they_owe_me',
          p_person_name: 'Maya',
          p_currency: 'USD',
          p_amount_minor: '12500',
          p_effective_date: '2026-09-01',
          p_due_date: null,
          p_note: null,
        },
      },
    ]);
  });

  it('uses cash, repayment, target, and reversal commands with exact payloads', async () => {
    const recorder = recordingClient();
    const gateway = createSupabaseLoansGateway(recorder.client);

    await gateway.createLoan({
      mode: 'cash',
      spaceId: 'space-1',
      requestId: 'request-2',
      direction: 'i_owe_them',
      personName: 'Omar',
      currency: 'LBP',
      walletId: 'wallet-1',
      amountMinor: '2000000',
      effectiveDate: '2026-09-02',
      dueDate: '2026-10-02',
      note: 'Family bridge',
    });
    await gateway.recordRepayment({
      spaceId: 'space-1', requestId: 'request-3', loanId: 'loan-1', walletId: 'wallet-1',
      amountMinor: '500000', effectiveDate: '2026-09-07',
    });
    await gateway.setMonthlyTarget({
      spaceId: 'space-1', requestId: 'request-4', loanId: 'loan-1', month: '2026-09-01', targetMinor: '300000',
    });
    await gateway.reverseEvent({
      spaceId: 'space-1', requestId: 'request-5', eventId: 'event-1', effectiveDate: '2026-09-07',
    });

    expect(recorder.rpcCalls.map(({ name }) => name)).toEqual([
      'record_cash_loan',
      'record_loan_repayment',
      'set_loan_monthly_target',
      'reverse_financial_event',
    ]);
    expect(recorder.rpcCalls[0]?.args).toMatchObject({ p_wallet_id: 'wallet-1', p_amount_minor: '2000000' });
    expect(recorder.rpcCalls[1]?.args).toEqual({
      p_space_id: 'space-1', p_request_id: 'request-3', p_loan_id: 'loan-1', p_wallet_id: 'wallet-1',
      p_amount_minor: '500000', p_effective_date: '2026-09-07',
    });
  });

  it('loads monthly values through the two approved projection commands', async () => {
    const recorder = recordingClient();
    const gateway = createSupabaseLoansGateway(recorder.client);

    await gateway.loadDashboard('space-1', '2026-09-01');

    expect(recorder.rpcCalls.map(({ name }) => name)).toEqual([
      'loan_monthly_plan',
      'loan_monthly_currency_summary',
    ]);
    expect(recorder.fromCalls).toEqual(['spaces', 'wallets', 'loans', 'loan_balances', 'financial_events', 'loan_postings', 'wallet_movements']);
  });

  it('normalizes populated PostgREST bigint money fields to exact domain strings', async () => {
    const relationRows: Record<string, unknown[]> = {
      spaces: [{ id: 'space-1', name: 'Personal', kind: 'personal' }],
      wallets: [{ id: 'wallet-1', space_id: 'space-1', name: 'Cash', currency: 'USD', archived_at: null }],
      loans: [{ id: 'loan-1', space_id: 'space-1', direction: 'they_owe_me', person_name: 'Maya', currency: 'USD', effective_date: '2026-09-01', due_date: null, note: null }],
      loan_balances: [{ loan_id: 'loan-1', outstanding_minor: 7500 }],
      financial_events: [{ id: 'event-1', kind: 'loan_lend', effective_date: '2026-09-01', created_at: '2026-09-01T00:00:00Z', reversal_of: null }],
      loan_postings: [{ event_id: 'event-1', loan_id: 'loan-1', principal_delta_minor: 10000, repayment_effect_minor: 2500 }],
      wallet_movements: [{ event_id: 'event-1', wallet_id: 'wallet-1', amount_minor: -10000 }],
    };
    const client: LoansDataClient = {
      from(relation) {
        const result = Promise.resolve({ data: relationRows[relation] ?? [], error: null });
        const builder = { select: () => builder, eq: () => builder, is: () => builder, order: () => builder, limit: () => result };
        return builder;
      },
      async rpc(name) {
        if (name === 'loan_monthly_plan') return { data: [{ loan_id: 'loan-1', target_minor: 5000, actual_repayment_minor: 2500, remaining_reservation_minor: 2500, due_amount_minor: 0, expected_collection_minor: 7500 }], error: null };
        return { data: [{ currency: 'USD', owed_to_me_minor: 7500, i_owe_minor: 0, due_amount_minor: 0, planned_repayment_minor: 5000, actual_repayment_minor: 2500, remaining_reservation_minor: 2500, expected_collection_minor: 7500 }], error: null };
      },
    };

    const dashboard = await createSupabaseLoansGateway(client).loadDashboard('space-1', '2026-09-01');

    expect(dashboard.loans[0]).toMatchObject({ outstandingMinor: '7500', originalPrincipalMinor: '10000', totalRepaidMinor: '2500' });
    expect(dashboard.summaries[0]).toMatchObject({ owedToMeMinor: '7500', targetMinor: '5000' });
  });

  it('contains no direct write builder and only the approved mutation RPCs', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/loans/supabase-loans-gateway.ts'), 'utf8');
    expect(source).not.toMatch(/\.(?:insert|update|delete|upsert)\s*\(/);

    const mutationNames = [...source.matchAll(/runCommand\('([^']+)'/g)].map((match) => match[1]);
    expect(new Set(mutationNames)).toEqual(new Set([
      'open_loan_outstanding',
      'record_cash_loan',
      'record_loan_repayment',
      'set_loan_monthly_target',
      'reverse_financial_event',
    ]));
  });
});
