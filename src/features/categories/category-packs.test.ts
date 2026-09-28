import { describe, expect, it } from 'vitest';

import { CATEGORY_PACKS, MAX_PACK_SELECTION, flatSuggestions } from './category-packs.js';

describe('category suggestion packs', () => {
  it('exposes version-1 bilingual Essentials and Lifestyle suggestion roots', () => {
    expect(CATEGORY_PACKS.map((pack) => ({ id: pack.id, version: pack.version }))).toEqual([
      { id: 'essentials', version: 1 },
      { id: 'lifestyle', version: 1 },
    ]);

    const [essentials, lifestyle] = CATEGORY_PACKS;
    expect(essentials?.nameEn).toBe('Essentials');
    expect(essentials?.nameAr).toBe('الأساسيات');
    expect(essentials?.suggestions.map((suggestion) => [suggestion.nameEn, suggestion.nameAr])).toEqual([
      ['Housing', 'السكن'],
      ['Food', 'الطعام'],
      ['Transport', 'المواصلات'],
    ]);

    expect(lifestyle?.nameEn).toBe('Lifestyle');
    expect(lifestyle?.suggestions.map((suggestion) => [suggestion.nameEn, suggestion.nameAr])).toEqual([
      ['Dining', 'المطاعم'],
      ['Leisure', 'الترفيه'],
    ]);
  });

  it('keeps every suggestion a bilingual expense root with a unique id', () => {
    const suggestions = flatSuggestions(CATEGORY_PACKS);
    expect(suggestions).toHaveLength(5);
    expect(suggestions.every((suggestion) => suggestion.kind === 'expense')).toBe(true);
    expect(suggestions.every((suggestion) => suggestion.nameEn.length > 0 && suggestion.nameAr.length > 0)).toBe(true);
    expect(new Set(suggestions.map((suggestion) => suggestion.id)).size).toBe(suggestions.length);
  });

  it('caps one run at ten selected suggestions', () => {
    expect(MAX_PACK_SELECTION).toBe(10);
  });
});
