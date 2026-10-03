import { Car, Gamepad2, House, Receipt, ShoppingBag, ShoppingCart, Tag, Utensils } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { categoryIcon } from './category-icons.js';

describe('categoryIcon', () => {
  it.each([
    ['Shopping', 'التسوق', ShoppingBag], ['Fun', 'الترفيه', Gamepad2],
    ['Transport', 'المواصلات', Car], ['Eating out', 'المطاعم', Utensils],
    ['Groceries', 'البقالة', ShoppingCart], ['Rent', 'الإيجار', House], ['Bills', 'الفواتير', Receipt],
  ] as const)('uses the same distinct icon for %s in either language', (nameEn, nameAr, Icon) => {
    expect(categoryIcon({ nameEn, nameAr: null, kind: 'expense' })).toBe(Icon);
    expect(categoryIcon({ nameEn: null, nameAr, kind: 'expense' })).toBe(Icon);
  });

  it('uses a tag for custom and income categories without fuzzy name matches', () => {
    expect(categoryIcon({ nameEn: 'Shopping for gifts', nameAr: null, kind: 'expense' })).toBe(Tag);
    expect(categoryIcon({ nameEn: 'Rent', nameAr: null, kind: 'income' })).toBe(Tag);
    expect(categoryIcon({ nameEn: 'Personal', nameAr: 'شخصي', kind: 'expense' })).toBe(Tag);
  });
});
