import { describe, expect, it, vi } from 'vitest';
import { createFirstPlanSaver } from './first-plan-save.js';
import { InMemoryPlanClient } from '../../test/in-memory-plan-client.js';
import type { BudgetCategoryRow } from '../plan/types.js';
import type { CategoriesGateway, Category } from '../categories/types.js';

function fixture() {
  const plan = new InMemoryPlanClient();
  const records: Category[] = [];
  const categories = {
    listCategories: vi.fn(async () => ({ categories: records, nextCursor: null })),
    createCategory: vi.fn(async () => ({ id: 'category-1' })),
    getCommandResult: vi.fn(async () => null),
  } as unknown as CategoriesGateway;
  const save = createFirstPlanSaver(plan, categories);
  const input = { spaceId: 'space-1', month: '2026-10-01', currency: 'USD' as const, incomeMinor: '250000', rows: [{ nameEn: 'Groceries', nameAr: 'البقالة', amountMinor: '35000' }] };
  return { plan, categories, records, save, input };
}

describe('first plan saving', () => {
  it('saves income and category targets using protected clients', async () => {
    const { save, input, plan, categories } = fixture();
    await save(input);
    expect(categories.createCategory).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'space-1', kind: 'expense', nameEn: 'Groceries' }));
    expect(plan.calls[0]?.input).toMatchObject({ amountMinor: '250000', expectedRevisionId: null });
    expect(plan.calls[1]?.input).toMatchObject({ categoryId: 'category-1', amountMinor: '35000', expectedRevisionId: null });
  });
  it('reuses exact requests after partial failure and does not create a category twice', async () => {
    const { save, input, plan, categories } = fixture();
    const target = vi.spyOn(plan, 'setCategoryTarget').mockRejectedValueOnce(new Error('Network timeout'));
    await expect(save(input)).rejects.toThrow('Network timeout');
    await save(input);
    expect(categories.createCategory).toHaveBeenCalledOnce();
    expect(target.mock.calls[0]?.[0]).toEqual(target.mock.calls[1]?.[0]);
    const incomeCalls = plan.calls.filter(c => c.name === 'setIncomePlan');
    expect(incomeCalls[0]?.input).toEqual(incomeCalls[1]?.input);
  });
  it('reconciles category commands after an ambiguous response', async () => {
    const { save, input, categories } = fixture();
    vi.mocked(categories.createCategory).mockRejectedValueOnce(new Error('Network timeout'));
    vi.mocked(categories.getCommandResult).mockResolvedValue({ categoryId: 'recovered', commandKind: 'create_category', createdAt: '2026-10-02T00:00:00Z' });
    await save(input);
    expect(categories.createCategory).toHaveBeenCalledOnce();
    expect(categories.getCommandResult).toHaveBeenCalledOnce();
  });
  it('reuses an existing root instead of creating the same name', async () => {
    const { save, input, categories, records, plan } = fixture();
    records.push({ id: 'existing', nameEn: 'Groceries', nameAr: null, kind: 'expense', spaceId: 'space-1', parentCategoryId: null, archivedAt: null, createdAt: '' });
    await save(input);
    expect(categories.createCategory).not.toHaveBeenCalled();
    expect(plan.calls[1]?.input).toMatchObject({ categoryId: 'existing' });
  });
  it('refreshes revisions and creates a new identity when the amount changes', async () => {
    const { save, input, plan } = fixture();
    await save(input);
    await save({ ...input, incomeMinor: '300000' });
    const calls = plan.calls.filter(c => c.name === 'setIncomePlan');
    expect(calls[0]?.input).not.toEqual(calls[1]?.input);
  });
  it('does not replay an obsolete income command after editing back to an earlier value', async () => {
    const { save, input, plan } = fixture();
    await save(input);
    await save({ ...input, incomeMinor: '300000' });
    await save(input);
    const calls = plan.calls.filter(c => c.name === 'setIncomePlan').map(c => c.input as { requestId: string });
    expect(calls[0]?.requestId).not.toBe(calls[2]?.requestId);
  });
  it('retains the exact request and revision across a reload after a timeout', async () => {
    sessionStorage.clear();
    const { input, plan, categories } = fixture();
    const income = vi.spyOn(plan, 'setIncomePlan').mockRejectedValueOnce(new Error('timeout'));
    await expect(createFirstPlanSaver(plan, categories, 'test-journal')(input)).rejects.toThrow('timeout');
    await createFirstPlanSaver(plan, categories, 'test-journal')(input);
    expect(income.mock.calls[0]?.[0]).toEqual(income.mock.calls[1]?.[0]);
    sessionStorage.clear();
  });

  it.each([false, true])('clears only setup targets removed after a partial save, with cleanup conflict=%s', async (cleanupConflict) => {
    const { save, input, plan, categories } = fixture();
    vi.mocked(categories.createCategory).mockImplementation(async row => ({ id: row.nameEn! }));
    const targets: BudgetCategoryRow[] = [];
    vi.spyOn(plan, 'loadCategoryRows').mockImplementation(async () => targets);
    let revision = 0;
    let fail = true;
    let conflict = cleanupConflict;
    const setTarget = vi.spyOn(plan, 'setCategoryTarget').mockImplementation(async row => {
      if (row.categoryId === 'Groceries' && fail) { fail = false; throw new Error('timeout'); }
      if (row.categoryId === 'Rent' && row.amountMinor === '0' && conflict) { conflict = false; throw new Error('the monthly budget plan has changed; refresh and try again'); }
      const target = targets.find(target => target.categoryId === row.categoryId);
      if (target) { target.targetMinor = row.amountMinor; target.targetRevisionId = String(++revision); }
      else targets.push({ categoryId: row.categoryId, nameEn: row.categoryId, nameAr: null, currency: 'USD', archivedAt: null, targetMinor: row.amountMinor, targetRevisionId: String(++revision), actualSpentMinor: '0', remainingMinor: row.amountMinor, overspentMinor: '0' });
      return { revisionId: String(revision) };
    });
    await expect(save({ ...input, incomeMinor: '10000', rows: [
      { nameEn: 'Rent', nameAr: null, amountMinor: '9000' },
      { nameEn: 'Groceries', nameAr: null, amountMinor: '1000' },
    ] })).rejects.toThrow('timeout');
    targets.push({ categoryId: 'unrelated', nameEn: 'Unrelated', nameAr: null, currency: 'USD', archivedAt: null, targetMinor: '500', targetRevisionId: '3', actualSpentMinor: '0', remainingMinor: '500', overspentMinor: '0' });
    const retry = { ...input, incomeMinor: '10000', rows: [{ nameEn: 'Groceries', nameAr: null, amountMinor: '10000' }] };
    if (cleanupConflict) await expect(save(retry)).rejects.toThrow('has changed');
    await save(retry);
    expect(targets.find(row => row.categoryId === 'Rent')?.targetMinor).toBe('0');
    expect(targets.find(row => row.categoryId === 'Groceries')?.targetMinor).toBe('10000');
    expect(targets.find(row => row.categoryId === 'unrelated')?.targetMinor).toBe('500');
    expect(setTarget).toHaveBeenLastCalledWith(expect.objectContaining({ categoryId: 'Rent', amountMinor: '0', expectedRevisionId: '1' }));
  });

});
