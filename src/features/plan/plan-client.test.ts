import { describe, expect, it, vi } from 'vitest';
import { createPlanClient } from './plan-client.js';

function rpcClient(impl: (name: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }) {
  return { rpc: vi.fn((name: string, args: Record<string, unknown>) => Promise.resolve(impl(name, args))) };
}

function v3Row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    category_id: 'cat-1', category_created_at: 'seed-0000',
    name_en: 'Groceries', name_ar: 'بقالة', archived_at: null,
    target_minor: 30000, actual_spent_minor: 21000, remaining_minor: 9000,
    overspent_minor: 0, target_revision_id: 11, has_more: false,
    ...overrides,
  };
}

describe('createPlanClient', () => {
  it('maps monthly_budget_currency_summary rows to minor-unit strings', async () => {
    const client = createPlanClient(rpcClient(() => ({
      data: [{
        currency: 'USD', planned_income_minor: 210000, actual_income_minor: 210000,
        category_target_total_minor: 80000, category_actual_spent_minor: 30500,
        uncategorized_spent_minor: 1200, category_overspent_minor: 0,
        actual_loan_repayment_minor: 15000, remaining_loan_reservation_minor: 5000,
        loan_commitment_minor: 20000, unallocated_minor: 108300, overallocated_minor: 0,
        income_plan_revision_id: 7,
      }],
      error: null,
    })));
    const rows = await client.loadCurrencySummary('space-1', '2026-09-01');
    expect(rows).toEqual([{
      currency: 'USD', plannedIncomeMinor: '210000', actualIncomeMinor: '210000',
      categoryTargetTotalMinor: '80000', categoryActualSpentMinor: '30500',
      uncategorizedSpentMinor: '1200', categoryOverspentMinor: '0',
      actualLoanRepaymentMinor: '15000', remainingLoanReservationMinor: '5000',
      loanCommitmentMinor: '20000', unallocatedMinor: '108300', overallocatedMinor: '0',
      incomePlanRevisionId: '7',
    }]);
  });

  it('posts set_monthly_income_plan with snake_case args and returns the revision id', async () => {
    const rpc = rpcClient(() => ({ data: [{ id: 42, month_start: '2026-09-01' }], error: null }));
    const client = createPlanClient(rpc);
    await expect(client.setIncomePlan({
      spaceId: 'space-1', requestId: 'req-1', month: '2026-09-01',
      currency: 'USD', amountMinor: '210000', expectedRevisionId: '6',
    })).resolves.toEqual({ revisionId: '42' });
    expect(rpc.rpc).toHaveBeenCalledWith('set_monthly_income_plan', {
      p_space_id: 'space-1', p_request_id: 'req-1', p_month: '2026-09-01',
      p_currency: 'USD', p_amount_minor: '210000', p_expected_revision_id: 6,
    });
  });

  it('rejects a non-numeric expected revision id before calling the rpc', async () => {
    const rpc = rpcClient(() => ({ data: [{ id: 42, month_start: '2026-09-01' }], error: null }));
    const client = createPlanClient(rpc);
    await expect(client.setIncomePlan({
      spaceId: 'space-1', requestId: 'req-1', month: '2026-09-01',
      currency: 'USD', amountMinor: '210000', expectedRevisionId: 'abc',
    })).rejects.toThrow('The expected revision id is invalid.');
    expect(rpc.rpc).not.toHaveBeenCalled();
  });

  it('posts set_monthly_category_target with null expected revision when omitted', async () => {
    const rpc = rpcClient(() => ({ data: [{ id: 3, month_start: '2026-09-01' }], error: null }));
    const client = createPlanClient(rpc);
    await client.setCategoryTarget({
      spaceId: 'space-1', requestId: 'req-2', categoryId: 'cat-1',
      month: '2026-09-01', currency: 'LBP', amountMinor: '5000000',
    });
    expect(rpc.rpc).toHaveBeenCalledWith('set_monthly_category_target', {
      p_space_id: 'space-1', p_request_id: 'req-2', p_category_id: 'cat-1',
      p_month: '2026-09-01', p_currency: 'LBP', p_amount_minor: '5000000',
      p_expected_revision_id: null,
    });
  });

  it('throws on rpc error and on malformed rows', async () => {
    const failing = createPlanClient(rpcClient(() => ({ data: null, error: { message: 'an active space membership is required' } })));
    await expect(failing.loadCurrencySummary('space-1', '2026-09-01')).rejects.toThrow('an active space membership is required');
    const malformed = createPlanClient(rpcClient(() => ({ data: [{ currency: 'EUR' }], error: null })));
    await expect(malformed.loadCurrencySummary('space-1', '2026-09-01')).rejects.toThrow();
  });

  it('pages monthly_budget_category_page_v3 until has_more is false', async () => {
    const pages = [
      Array.from({ length: 100 }, (_, i) => v3Row({
        category_id: `cat-${i}`, category_created_at: `seed-${String(i).padStart(4, '0')}`, has_more: true,
      })),
      [v3Row({ category_id: 'cat-100', category_created_at: 'seed-0100', has_more: false })],
    ];
    let callIndex = 0;
    const rpc = rpcClient(() => ({ data: pages[callIndex++], error: null }));
    const client = createPlanClient(rpc);
    const rows = await client.loadCategoryRows('space-1', '2026-09-01', 'USD');
    expect(rows).toHaveLength(101);
    expect(rpc.rpc).toHaveBeenCalledTimes(2);
    expect(rpc.rpc).toHaveBeenNthCalledWith(1, 'monthly_budget_category_page_v3', {
      p_space_id: 'space-1', p_month: '2026-09-01', p_currency: 'USD',
      p_after_created_at: null, p_after_category_id: null, p_limit: 100,
    });
    expect(rpc.rpc).toHaveBeenNthCalledWith(2, 'monthly_budget_category_page_v3', {
      p_space_id: 'space-1', p_month: '2026-09-01', p_currency: 'USD',
      p_after_created_at: 'seed-0099', p_after_category_id: 'cat-99', p_limit: 100,
    });
  });

  it('rejects once the category page cap is exceeded', async () => {
    let callCount = 0;
    const rpc = rpcClient(() => {
      callCount += 1;
      return { data: [v3Row({ category_id: `cat-${callCount}`, category_created_at: `seed-${callCount}`, has_more: true })], error: null };
    });
    const client = createPlanClient(rpc);
    await expect(client.loadCategoryRows('space-1', '2026-09-01', 'USD'))
      .rejects.toThrow('Too many categories to plan at once.');
    expect(callCount).toBe(20);
  });

  it('maps monthly_budget_category_page_v3 rows to BudgetCategoryRow with the requested currency', async () => {
    const rpc = rpcClient(() => ({ data: [v3Row()], error: null }));
    const client = createPlanClient(rpc);
    const rows = await client.loadCategoryRows('space-1', '2026-09-01', 'USD');
    expect(rows).toEqual([{
      categoryId: 'cat-1', nameEn: 'Groceries', nameAr: 'بقالة', archivedAt: null,
      currency: 'USD', targetMinor: '30000', actualSpentMinor: '21000',
      remainingMinor: '9000', overspentMinor: '0', targetRevisionId: '11',
    }]);
    expect(rpc.rpc).toHaveBeenCalledWith('monthly_budget_category_page_v3', {
      p_space_id: 'space-1', p_month: '2026-09-01', p_currency: 'USD',
      p_after_created_at: null, p_after_category_id: null, p_limit: 100,
    });
  });

  it('maps a v3 category row with no Arabic name to a null nameAr instead of throwing', async () => {
    const rpc = rpcClient(() => ({ data: [v3Row({ name_ar: null })], error: null }));
    const client = createPlanClient(rpc);
    const rows = await client.loadCategoryRows('space-1', '2026-09-01', 'USD');
    expect(rows[0]).toMatchObject({ categoryId: 'cat-1', nameEn: 'Groceries', nameAr: null });
  });

  it('maps a v3 category row with no English name to a null nameEn instead of throwing', async () => {
    const rpc = rpcClient(() => ({ data: [v3Row({ name_en: null, name_ar: 'تنظيف' })], error: null }));
    const client = createPlanClient(rpc);
    const rows = await client.loadCategoryRows('space-1', '2026-09-01', 'USD');
    expect(rows[0]).toMatchObject({ categoryId: 'cat-1', nameEn: null, nameAr: 'تنظيف' });
  });

  it('throws when a v3 category row has neither an English nor an Arabic name', async () => {
    const rpc = rpcClient(() => ({ data: [v3Row({ name_en: null, name_ar: null })], error: null }));
    const client = createPlanClient(rpc);
    await expect(client.loadCategoryRows('space-1', '2026-09-01', 'USD')).rejects.toThrow('The database row has no display name.');
  });
});
