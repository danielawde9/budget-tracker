import type { CategoryKind } from './types.js';

/**
 * Optional, static, version-1 starter suggestion packs (task 26c / X8).
 *
 * These are suggestions, not a mandatory universal hierarchy and never seeded
 * rows: nothing is written until the person explicitly opts in through the
 * create-category command. The owner's own earlier setup stays authoritative.
 */
export interface CategoryPackSuggestion {
  /** Stable id, unique across packs. */
  id: string;
  kind: CategoryKind;
  nameEn: string;
  nameAr: string;
}

export interface CategoryPack {
  id: string;
  version: number;
  nameEn: string;
  nameAr: string;
  suggestions: readonly CategoryPackSuggestion[];
}

/** The create-category command runs for at most this many selected entries. */
export const MAX_PACK_SELECTION = 10;

export const CATEGORY_PACKS: readonly CategoryPack[] = [
  {
    id: 'essentials',
    version: 1,
    nameEn: 'Essentials',
    nameAr: 'الأساسيات',
    suggestions: [
      { id: 'essentials.housing', kind: 'expense', nameEn: 'Housing', nameAr: 'السكن' },
      { id: 'essentials.food', kind: 'expense', nameEn: 'Food', nameAr: 'الطعام' },
      { id: 'essentials.transport', kind: 'expense', nameEn: 'Transport', nameAr: 'المواصلات' },
    ],
  },
  {
    id: 'lifestyle',
    version: 1,
    nameEn: 'Lifestyle',
    nameAr: 'نمط الحياة',
    suggestions: [
      { id: 'lifestyle.dining', kind: 'expense', nameEn: 'Dining', nameAr: 'المطاعم' },
      { id: 'lifestyle.leisure', kind: 'expense', nameEn: 'Leisure', nameAr: 'الترفيه' },
    ],
  },
];

export function flatSuggestions(packs: readonly CategoryPack[]): readonly CategoryPackSuggestion[] {
  return packs.flatMap((pack) => pack.suggestions);
}
