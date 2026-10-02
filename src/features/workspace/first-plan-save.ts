import type { CategoriesGateway, Category } from '../categories/types.js';
import type { Currency } from '../loans/types.js';
import type { PlanClient } from '../plan/types.js';

export interface FirstPlanInput {
  spaceId: string;
  month: string;
  currency: Currency;
  incomeMinor: string;
  rows: readonly { nameEn: string | null; nameAr: string | null; amountMinor: string }[];
}
interface Receipt { requestId: string; expectedRevisionId: string | null }

/** Retain exact command identities across partial failure, including a browser reload. */
export function createFirstPlanSaver(plan: PlanClient, categories: CategoriesGateway, journalKey?: string) {
  const receipts = new Map<string, Receipt>();
  const createdCategories = new Map<string, string>();
  const managedTargets = new Set<string>();
  if (journalKey) {
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(journalKey) ?? '[]');
      if (Array.isArray(stored)) for (const entry of stored) {
        if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !entry[1] || typeof entry[1] !== 'object') continue;
        const keyParts: unknown = JSON.parse(entry[0]);
        if (!Array.isArray(keyParts) || !['income', 'target', 'category'].includes(String(keyParts[0]))) continue;
        const receipt = entry[1] as Partial<Receipt>;
        if (typeof receipt.requestId === 'string' && /^[\da-f-]{36}$/i.test(receipt.requestId)
          && (receipt.expectedRevisionId === null || typeof receipt.expectedRevisionId === 'string' && /^\d+$/.test(receipt.expectedRevisionId))) {
          receipts.set(entry[0], receipt as Receipt);
        }
      }
    } catch { /* In-memory retries still work when session storage is unavailable. */ }
  }
  if (journalKey) {
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(`${journalKey}:targets`) ?? '[]');
      if (Array.isArray(stored)) for (const key of stored) {
        if (typeof key !== 'string') continue;
        const parts: unknown = JSON.parse(key);
        if (Array.isArray(parts) && parts.length === 2 && typeof parts[1] === 'string'
          && parts[0] && typeof parts[0] === 'object' && typeof parts[0].spaceId === 'string'
          && typeof parts[0].month === 'string' && ['USD', 'LBP'].includes(parts[0].currency)) managedTargets.add(key);
      }
    } catch { /* In-memory ownership still protects retries. */ }
  }
  const persist = () => {
    if (journalKey) try {
      sessionStorage.setItem(journalKey, JSON.stringify([...receipts]));
      sessionStorage.setItem(`${journalKey}:targets`, JSON.stringify([...managedTargets]));
    } catch { /* optional storage */ }
  };
  const command = (key: string, expectedRevisionId: string | null) => {
    const parts = JSON.parse(key) as unknown[];
    if (parts[0] === 'income' || parts[0] === 'target') {
      const entity = JSON.stringify(parts.slice(0, -1));
      for (const oldKey of receipts.keys()) {
        if (oldKey !== key && JSON.stringify((JSON.parse(oldKey) as unknown[]).slice(0, -1)) === entity) receipts.delete(oldKey);
      }
    }
    let receipt = receipts.get(key);
    if (!receipt) {
      receipt = { requestId: crypto.randomUUID(), expectedRevisionId };
      receipts.set(key, receipt);
      persist();
    }
    return receipt;
  };
  const post = async (key: string, revision: string | null, action: (receipt: Receipt) => Promise<unknown>) => {
    try { await action(command(key, revision)); }
    catch (cause) {
      // A definite optimistic-concurrency rejection did not write. Next attempt
      // rereads revisions and starts a fresh command; ambiguous errors retain it.
      if (cause instanceof Error && /has changed|refresh and try again/i.test(cause.message)) {
        receipts.delete(key);
        persist();
      }
      throw cause;
    }
  };
  return async (input: FirstPlanInput) => {
    const [summaries, targets] = await Promise.all([
      plan.loadCurrencySummary(input.spaceId, input.month),
      plan.loadCategoryRows(input.spaceId, input.month, input.currency),
    ]);
    const existing: Category[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await categories.listCategories(input.spaceId, 'expense', cursor, 100);
      existing.push(...result.categories);
      if (!result.nextCursor) break;
      if (page === 19) throw new Error('Too many categories to load. Plan later from the Plan page.');
      cursor = result.nextCursor;
    }
    const base = { spaceId: input.spaceId, month: input.month, currency: input.currency };
    const incomeKey = JSON.stringify(['income', base, input.incomeMinor]);
    await post(incomeKey, summaries.find(row => row.currency === input.currency)?.incomePlanRevisionId ?? null,
      receipt => plan.setIncomePlan({ ...base, ...receipt, amountMinor: input.incomeMinor }));
    const selectedCategoryIds = new Set<string>();
    for (const row of input.rows) {
      const names = { nameEn: row.nameEn?.trim() || null, nameAr: row.nameAr?.trim() || null };
      const categoryKey = JSON.stringify(['category', input.spaceId, names]);
      let categoryId = createdCategories.get(categoryKey) ?? existing.find(category =>
        category.archivedAt === null && category.parentCategoryId === null &&
        (names.nameEn !== null && category.nameEn?.toLowerCase() === names.nameEn.toLowerCase()
          || names.nameAr !== null && category.nameAr === names.nameAr))?.id;
      if (!categoryId) {
        const receipt = command(categoryKey, null);
        try {
          const result = await categories.createCategory({ spaceId: input.spaceId, requestId: receipt.requestId, kind: 'expense', ...names });
          categoryId = result.id;
        } catch (cause) {
          const recovered = await categories.getCommandResult(input.spaceId, receipt.requestId);
          if (recovered?.commandKind !== 'create_category') throw cause;
          categoryId = recovered.categoryId;
        }
        if (!categoryId) throw new Error('The category could not be confirmed. Please try saving again.');
        createdCategories.set(categoryKey, categoryId);
      }
      selectedCategoryIds.add(categoryId);
      managedTargets.add(JSON.stringify([base, categoryId]));
      persist();
      const targetKey = JSON.stringify(['target', base, categoryId, row.amountMinor]);
      await post(targetKey, targets.find(target => target.categoryId === categoryId)?.targetRevisionId ?? null,
        receipt => plan.setCategoryTarget({ ...base, ...receipt, categoryId, amountMinor: row.amountMinor }));
    }
    // Only targets attempted by this setup belong to us. A cleared/renamed row
    // may already have reached the server before a later command timed out.
    const removedCategoryIds = new Set<string>();
    for (const key of managedTargets) {
      const parts = JSON.parse(key) as unknown[];
      if (JSON.stringify(parts[0]) === JSON.stringify(base)
        && typeof parts[1] === 'string' && !selectedCategoryIds.has(parts[1])) removedCategoryIds.add(parts[1]);
    }
    for (const categoryId of removedCategoryIds) {
      const targetKey = JSON.stringify(['target', base, categoryId, '0']);
      await post(targetKey, targets.find(target => target.categoryId === categoryId)?.targetRevisionId ?? null,
        receipt => plan.setCategoryTarget({ ...base, ...receipt, categoryId, amountMinor: '0' }));
    }
  };
}
