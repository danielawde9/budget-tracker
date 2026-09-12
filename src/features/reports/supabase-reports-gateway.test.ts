import { describe, expect, it } from 'vitest';

import { createSupabaseReportsGateway } from './supabase-reports-gateway.js';

describe('Supabase reports gateway', () => {
  it('keeps monthly comparison currencies separate and exact', async () => {
    const gateway = createSupabaseReportsGateway({
      rpc: async () => ({
        data: [
          { period_month: '2026-08-01', period_role: 'previous', currency: 'USD', income_net_minor: '1200', expense_net_minor: '500', wallet_delta_net_minor: '700' },
          { period_month: '2026-09-01', period_role: 'current', currency: 'USD', income_net_minor: 3000, expense_net_minor: 900, wallet_delta_net_minor: 2100 },
          { period_month: '2026-08-01', period_role: 'previous', currency: 'LBP', income_net_minor: 0, expense_net_minor: 0, wallet_delta_net_minor: 0 },
          { period_month: '2026-09-01', period_role: 'current', currency: 'LBP', income_net_minor: 0, expense_net_minor: 0, wallet_delta_net_minor: 0 },
        ], error: null,
      }),
    });

    await expect(gateway.loadMonthlyComparison('00000000-0000-4000-8000-000000000001', '2026-09-01')).resolves.toEqual([
      { periodMonth: '2026-08-01', periodRole: 'previous', currency: 'USD', incomeNetMinor: '1200', expenseNetMinor: '500', walletDeltaNetMinor: '700' },
      { periodMonth: '2026-09-01', periodRole: 'current', currency: 'USD', incomeNetMinor: '3000', expenseNetMinor: '900', walletDeltaNetMinor: '2100' },
      { periodMonth: '2026-08-01', periodRole: 'previous', currency: 'LBP', incomeNetMinor: '0', expenseNetMinor: '0', walletDeltaNetMinor: '0' },
      { periodMonth: '2026-09-01', periodRole: 'current', currency: 'LBP', incomeNetMinor: '0', expenseNetMinor: '0', walletDeltaNetMinor: '0' },
    ]);
  });

  it('rejects a report response with an unsafe money value', async () => {
    const gateway = createSupabaseReportsGateway({
      rpc: async () => ({ data: [
        { period_month: '2026-08-01', period_role: 'previous', currency: 'USD', income_net_minor: 0, expense_net_minor: 0, wallet_delta_net_minor: 0 },
        { period_month: '2026-09-01', period_role: 'current', currency: 'USD', income_net_minor: 1.5, expense_net_minor: 0, wallet_delta_net_minor: 0 },
        { period_month: '2026-08-01', period_role: 'previous', currency: 'LBP', income_net_minor: 0, expense_net_minor: 0, wallet_delta_net_minor: 0 },
        { period_month: '2026-09-01', period_role: 'current', currency: 'LBP', income_net_minor: 0, expense_net_minor: 0, wallet_delta_net_minor: 0 },
      ], error: null }),
    });

    await expect(gateway.loadMonthlyComparison('00000000-0000-4000-8000-000000000001', '2026-09-01')).rejects.toThrow('unsafe income_net_minor');
  });
});
