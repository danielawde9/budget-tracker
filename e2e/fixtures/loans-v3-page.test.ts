import { describe, expect, it } from 'vitest';
import { orderedV3Roots, pageV3Roots } from './loans.js';

function seedRow(categoryId: string, currency: 'USD' | 'LBP', overrides: Record<string, unknown> = {}) {
  return { category_id: categoryId, currency, name_en: categoryId, ...overrides };
}

// Task 8 review finding 2: the monthly_budget_category_page_v3 fixture route
// used to ignore the cursor and always return roots.slice(0, limit), so a
// seed of more than one page for a single currency would hand the client the
// identical first page forever. These tests exercise orderedV3Roots/pageV3Roots
// directly (no browser, no Playwright) at a tractable size (5 rows, 2 per
// page) instead of seeding >100 rows in a slow e2e spec -- the pure paging
// logic is the same regardless of how many rows feed it.
describe('monthly_budget_category_page_v3 fixture: orderedV3Roots', () => {
  it('keeps only the requested currency, in seed order, and assigns a stable created-at per root', () => {
    const budgetRows = [seedRow('a', 'USD'), seedRow('b', 'LBP'), seedRow('c', 'USD')];
    const roots = orderedV3Roots(budgetRows, 'USD');
    expect(roots.map((root) => root.categoryId)).toEqual(['a', 'c']);
    expect(roots.map((root) => root.createdAt)).toEqual(['seed-0000', 'seed-0001']);
  });

  it('excludes subcategories (rows carrying a parent_category_id)', () => {
    const budgetRows = [seedRow('parent', 'USD'), seedRow('child', 'USD', { parent_category_id: 'parent' })];
    const roots = orderedV3Roots(budgetRows, 'USD');
    expect(roots.map((root) => root.categoryId)).toEqual(['parent']);
  });
});

describe('monthly_budget_category_page_v3 fixture: pageV3Roots', () => {
  it('returns everything with hasMore false when nothing exceeds the limit', () => {
    const roots = orderedV3Roots([seedRow('a', 'USD'), seedRow('b', 'USD')], 'USD');
    const { page, hasMore } = pageV3Roots(roots, null, 100);
    expect(page.map((root) => root.categoryId)).toEqual(['a', 'b']);
    expect(hasMore).toBe(false);
  });

  it('pages strictly after the cursor pair across three pages and terminates', () => {
    const budgetRows = Array.from({ length: 5 }, (_, i) => seedRow(`cat-${i}`, 'USD'));
    const roots = orderedV3Roots(budgetRows, 'USD');

    const first = pageV3Roots(roots, null, 2);
    expect(first.page.map((root) => root.categoryId)).toEqual(['cat-0', 'cat-1']);
    expect(first.hasMore).toBe(true);

    const firstLast = first.page.at(-1)!;
    const second = pageV3Roots(roots, { createdAt: firstLast.createdAt, categoryId: firstLast.categoryId }, 2);
    expect(second.page.map((root) => root.categoryId)).toEqual(['cat-2', 'cat-3']);
    expect(second.hasMore).toBe(true);

    const secondLast = second.page.at(-1)!;
    const third = pageV3Roots(roots, { createdAt: secondLast.createdAt, categoryId: secondLast.categoryId }, 2);
    expect(third.page.map((root) => root.categoryId)).toEqual(['cat-4']);
    expect(third.hasMore).toBe(false);
  });

  it('returns nothing once the cursor is past the last row', () => {
    const roots = orderedV3Roots([seedRow('only', 'USD')], 'USD');
    const first = pageV3Roots(roots, null, 100);
    const only = first.page[0]!;
    const after = pageV3Roots(roots, { createdAt: only.createdAt, categoryId: only.categoryId }, 100);
    expect(after.page).toEqual([]);
    expect(after.hasMore).toBe(false);
  });
});
