import type { Category, CategoryKind } from './types.js';

/**
 * A client-side mirror of the canonicalization the existing `create_category`
 * command and its `categories` table already apply server-side
 * (`private.canonical_category_name`, `private.english_category_key`,
 * `private.arabic_category_key` in `supabase/migrations/20260908100000_*`).
 *
 * The suggestions are still submitted through the existing create-category
 * command -- the database remains authoritative. These helpers only let the
 * opt-in dialog recognise when a suggestion would collide with an existing
 * category so it can surface that category instead of issuing a duplicate.
 */

// The Arabic fold the SQL `translate(..., 'آأإىة', 'ااايه')` performs.
const ARABIC_FOLD: ReadonlyMap<string, string> = new Map([
  ['آ', 'ا'], ['أ', 'ا'], ['إ', 'ا'], ['ى', 'ي'], ['ة', 'ه'],
]);

// The SQL `regexp_replace(..., '[ؐ-ؚـً-ٰٟۖ-ۭ]', '', 'g')` diacritic/tatweel class.
const ARABIC_MARK_PATTERN = /[\u0610-\u061A\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g;

export interface NamedCategoryInput {
  kind: CategoryKind;
  nameEn: string | null;
  nameAr: string | null;
}

export function canonicalCategoryName(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const collapsed = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return collapsed === '' ? null : collapsed;
}

export function englishCategoryKey(value: string | null | undefined): string | null {
  const canonical = canonicalCategoryName(value);
  return canonical === null ? null : canonical.toLowerCase();
}

export function arabicCategoryKey(value: string | null | undefined): string | null {
  const canonical = canonicalCategoryName(value);
  if (canonical === null) return null;
  let folded = '';
  for (const character of canonical) folded += ARABIC_FOLD.get(character) ?? character;
  const stripped = folded.replace(ARABIC_MARK_PATTERN, '');
  return stripped === '' ? null : stripped;
}

export function namesCollide(left: Pick<NamedCategoryInput, 'nameEn' | 'nameAr'>, right: Pick<NamedCategoryInput, 'nameEn' | 'nameAr'>): boolean {
  const leftEn = englishCategoryKey(left.nameEn);
  if (leftEn !== null && leftEn === englishCategoryKey(right.nameEn)) return true;
  const leftAr = arabicCategoryKey(left.nameAr);
  return leftAr !== null && leftAr === arabicCategoryKey(right.nameAr);
}

/**
 * The existing category a suggestion name would collide with, if any. The
 * match is scoped to active categories of the same kind, so an income category
 * is never treated as satisfying an expense suggestion (or the reverse).
 */
export function findMatchingCategory(suggestion: NamedCategoryInput, categories: readonly Category[]): Category | null {
  return categories.find((category) =>
    category.kind === suggestion.kind
    && category.archivedAt === null
    && namesCollide(suggestion, category),
  ) ?? null;
}
