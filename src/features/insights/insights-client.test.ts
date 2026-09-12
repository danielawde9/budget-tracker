import { describe, expect, it, vi } from 'vitest';
import { createInsightsClient } from './insights-client.js';

function rpcClient(impl: (name: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }) {
  return { rpc: vi.fn((name: string, args: Record<string, unknown>) => Promise.resolve(impl(name, args))) };
}

describe('createInsightsClient', () => {
  it('maps report_wallet_activity rows and passes all five args with defaults', async () => {
    const rpc = rpcClient(() => ({
      data: [{
        event_id: 'evt-1', kind: 'expense', effective_date: '2026-09-02',
        created_at: '2026-09-02T10:00:00Z', reversal_of: null,
        wallet_id: 'wallet-1', wallet_name: 'Cash', currency: 'USD',
        amount_minor: -12000, has_more: false,
      }],
      error: null,
    }));
    const client = createInsightsClient(rpc);
    const rows = await client.walletActivity({
      spaceId: 'space-1', fromDate: '2026-09-01', toDate: '2026-09-30',
    });
    expect(rpc.rpc).toHaveBeenCalledWith('report_wallet_activity', {
      p_space_id: 'space-1', p_from_date: '2026-09-01', p_to_date: '2026-09-30',
      p_wallet_id: null, p_currency: null, p_event_limit: 50,
    });
    expect(rows).toEqual([{
      eventId: 'evt-1', kind: 'expense', effectiveDate: '2026-09-02',
      createdAt: '2026-09-02T10:00:00Z', reversalOf: null,
      walletId: 'wallet-1', walletName: 'Cash', currency: 'USD',
      amountMinor: '-12000', hasMore: false,
    }]);
  });

  it('forwards wallet and currency filters and the event limit', async () => {
    const rpc = rpcClient(() => ({ data: [], error: null }));
    const client = createInsightsClient(rpc);
    await client.walletActivity({
      spaceId: 'space-1', fromDate: '2026-09-01', toDate: '2026-09-30',
      walletId: 'wallet-2', currency: 'LBP', limit: 10,
    });
    expect(rpc.rpc).toHaveBeenCalledWith('report_wallet_activity', {
      p_space_id: 'space-1', p_from_date: '2026-09-01', p_to_date: '2026-09-30',
      p_wallet_id: 'wallet-2', p_currency: 'LBP', p_event_limit: 10,
    });
  });

  it('maps report_category_actual_vs_budget rows', async () => {
    const rpc = rpcClient(() => ({
      data: [{
        category_key: 'cat-1', category_name_en: 'Groceries', category_name_ar: 'بقالة',
        category_kind: 'expense', currency: 'USD', actual_net_minor: 21000,
        budget_minor: 30000, remaining_minor: 9000,
      }, {
        category_key: 'uncategorized:expense', category_name_en: null, category_name_ar: null,
        category_kind: 'expense', currency: 'USD', actual_net_minor: 1200,
        budget_minor: null, remaining_minor: null,
      }],
      error: null,
    }));
    const client = createInsightsClient(rpc);
    const rows = await client.categoryActualVsBudget('space-1', '2026-09-01');
    expect(rpc.rpc).toHaveBeenCalledWith('report_category_actual_vs_budget', {
      p_space_id: 'space-1', p_month: '2026-09-01',
    });
    expect(rows).toEqual([{
      categoryKey: 'cat-1', nameEn: 'Groceries', nameAr: 'بقالة',
      kind: 'expense', currency: 'USD', actualNetMinor: '21000',
      budgetMinor: '30000', remainingMinor: '9000',
    }, {
      categoryKey: 'uncategorized:expense', nameEn: null, nameAr: null,
      kind: 'expense', currency: 'USD', actualNetMinor: '1200',
      budgetMinor: null, remainingMinor: null,
    }]);
  });

  it('throws on rpc error and on malformed kind', async () => {
    const failing = createInsightsClient(rpcClient(() => ({ data: null, error: { message: 'a visible space and bounded report window are required' } })));
    await expect(failing.walletActivity({
      spaceId: 'space-1', fromDate: '2026-09-01', toDate: '2026-09-30',
    })).rejects.toThrow('a visible space and bounded report window are required');
    const malformed = createInsightsClient(rpcClient(() => ({
      data: [{
        event_id: 'evt-1', kind: 'mystery', effective_date: '2026-09-02',
        created_at: '2026-09-02T10:00:00Z', reversal_of: null,
        wallet_id: 'wallet-1', wallet_name: 'Cash', currency: 'USD',
        amount_minor: -12000, has_more: false,
      }],
      error: null,
    })));
    await expect(malformed.walletActivity({
      spaceId: 'space-1', fromDate: '2026-09-01', toDate: '2026-09-30',
    })).rejects.toThrow();
  });
});
