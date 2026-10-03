import { Car, Gamepad2, House, Receipt, ShoppingBag, ShoppingCart, Tag, Utensils, type LucideIcon } from 'lucide-react';
import type { Category } from './types.js';

const DEFAULT_ICONS: Readonly<Record<string, LucideIcon>> = {
  shopping: ShoppingBag, 'التسوق': ShoppingBag,
  fun: Gamepad2, 'الترفيه': Gamepad2,
  transport: Car, 'المواصلات': Car, 'مواصلات': Car,
  'eating out': Utensils, 'المطاعم': Utensils, 'الأكل خارج المنزل': Utensils,
  groceries: ShoppingCart, 'البقالة': ShoppingCart, 'بقالة': ShoppingCart,
  rent: House, 'الإيجار': House, 'إيجار': House,
  bills: Receipt, 'الفواتير': Receipt, 'فواتير': Receipt,
};

/** Default names get familiar symbols; other user labels retain a neutral tag. */
export function categoryIcon(category: Pick<Category, 'kind' | 'nameEn' | 'nameAr'>): LucideIcon {
  if (category.kind !== 'expense') return Tag;
  for (const name of [category.nameEn, category.nameAr]) {
    const Icon = name ? DEFAULT_ICONS[name.trim().toLocaleLowerCase('en')] : undefined;
    if (Icon) return Icon;
  }
  return Tag;
}
