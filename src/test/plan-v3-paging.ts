// Pure keyset-paging helpers backing the e2e REST fixture's
// `monthly_budget_category_page_v3` mock (e2e/fixtures/loans.ts). Kept here,
// with no Playwright import, so they can be unit-tested by Vitest
// (picked up by vitest.ui.config.ts's `src/**/*.test.ts` include) instead of
// living under e2e/, where any `*.test.ts` file is also collected by
// Playwright's default `testDir: './e2e'` pattern and fails to load there
// (Task 8 review, fix round 2).
export interface V3Root {
  categoryId: string;
  createdAt: string;
  source: Record<string, unknown>;
}

/** Root (parent) categories for one currency, in a stable order, each given a
 *  synthetic but stable `createdAt` (the seed data carries no real category
 *  timestamp; the real RPC's cursor only needs a value that round-trips). */
export function orderedV3Roots(budgetRows: readonly Record<string, unknown>[], currency: 'USD' | 'LBP'): V3Root[] {
  return budgetRows
    .filter((row) => row['currency'] === currency && row['parent_category_id'] === undefined)
    .map((row, index) => ({
      categoryId: row['category_id'] as string,
      createdAt: `seed-${String(index).padStart(4, '0')}`,
      source: row,
    }));
}

/** Mirrors the real v3 SQL's keyset page: rows are ordered by
 *  `(createdAt, categoryId)`, `after` (when given) excludes everything at or
 *  before that pair, and `hasMore` reports whether more rows remain beyond
 *  the returned page -- never whether more rows exist overall. */
export function pageV3Roots(
  roots: readonly V3Root[],
  after: { createdAt: string; categoryId: string } | null,
  limit: number,
): { page: V3Root[]; hasMore: boolean } {
  const ordered = [...roots].sort((a, b) =>
    a.createdAt === b.createdAt ? a.categoryId.localeCompare(b.categoryId) : a.createdAt.localeCompare(b.createdAt));
  const remaining = after === null
    ? ordered
    : ordered.filter((root) =>
        root.createdAt > after.createdAt || (root.createdAt === after.createdAt && root.categoryId > after.categoryId));
  return { page: remaining.slice(0, limit), hasMore: remaining.length > limit };
}
