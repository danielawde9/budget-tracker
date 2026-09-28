import { describe, expect, it } from 'vitest';

import {
  arabicCategoryKey,
  canonicalCategoryName,
  englishCategoryKey,
  findMatchingCategory,
  namesCollide,
} from './category-name-rules.js';
import type { Category } from './types.js';

function category(overrides: Partial<Category> & Pick<Category, 'id' | 'kind' | 'nameEn' | 'nameAr'>): Category {
  return {
    spaceId: 'space-1',
    parentCategoryId: null,
    createdAt: '2026-09-08T10:00:00Z',
    archivedAt: null,
    ...overrides,
  };
}

describe('category name rules (mirror of the existing create-category canonicalization)', () => {
  it('canonicalizes NFKC, collapses whitespace and trims, treating blank as absent', () => {
    expect(canonicalCategoryName('  Housing  ')).toBe('Housing');
    expect(canonicalCategoryName('Food\t\tOut')).toBe('Food Out');
    expect(canonicalCategoryName('A\u00A0B')).toBe('A B');
    expect(canonicalCategoryName('')).toBeNull();
    expect(canonicalCategoryName('   ')).toBeNull();
    expect(canonicalCategoryName(null)).toBeNull();
    expect(canonicalCategoryName(undefined)).toBeNull();
  });

  it('lowercases English keys and folds the Arabic forms the database folds', () => {
    expect(englishCategoryKey('  HoUsInG ')).toBe('housing');
    expect(englishCategoryKey('   ')).toBeNull();
    expect(arabicCategoryKey('السّكن')).toBe('السكن');
    expect(arabicCategoryKey('إيصال')).toBe('ايصال');
    expect(arabicCategoryKey('مطعمـة')).toBe('مطعمه');
    expect(arabicCategoryKey(null)).toBeNull();
  });

  it('treats a shared English or Arabic normalized key as a collision', () => {
    expect(namesCollide({ nameEn: 'Housing', nameAr: null }, { nameEn: ' housing ', nameAr: null })).toBe(true);
    expect(namesCollide({ nameEn: null, nameAr: 'السّكن' }, { nameEn: null, nameAr: 'السكن' })).toBe(true);
    expect(namesCollide({ nameEn: 'Housing', nameAr: null }, { nameEn: 'Food', nameAr: null })).toBe(false);
    expect(namesCollide({ nameEn: null, nameAr: null }, { nameEn: null, nameAr: null })).toBe(false);
  });

  it('matches only active categories of the same kind', () => {
    const expenseHousing = category({ id: 'expense-housing', kind: 'expense', nameEn: 'Housing', nameAr: 'السكن' });
    const incomeHousing = category({ id: 'income-housing', kind: 'income', nameEn: 'Housing', nameAr: null });
    const archivedExpense = category({ id: 'archived-housing', kind: 'expense', nameEn: 'Housing', nameAr: null, archivedAt: '2026-08-01T00:00:00Z' });

    expect(findMatchingCategory({ kind: 'expense', nameEn: ' housing ', nameAr: null }, [expenseHousing, incomeHousing, archivedExpense])?.id)
      .toBe('expense-housing');
    expect(findMatchingCategory({ kind: 'income', nameEn: 'Housing', nameAr: null }, [expenseHousing, incomeHousing])?.id)
      .toBe('income-housing');
    // Only an income category shares the expense suggestion's name: never a match.
    expect(findMatchingCategory({ kind: 'expense', nameEn: 'Housing', nameAr: null }, [incomeHousing])).toBeNull();
    expect(findMatchingCategory({ kind: 'expense', nameEn: 'Housing', nameAr: null }, [archivedExpense])).toBeNull();
  });
});
