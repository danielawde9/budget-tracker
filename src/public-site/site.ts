import type { Locale } from '../lib/money.ts';

export const SITE_URL = 'https://openbudgetracker.app/';
export const BRAND_NAME = 'Open Budget Tracker';
export const BRAND_MARK_URL = '/brand/logo-mark.png';
export const GITHUB_URL = 'https://github.com/danielawde9/budget-tracker';
export const PUBLIC_PAGE_IDS = ['about', 'how-it-works', 'budgeting-usd-lbp', 'contribute'] as const;
export type PublicPage = typeof PUBLIC_PAGE_IDS[number];

export const publicLabels: Record<PublicPage, Record<Locale, string>> = {
  about: { en: 'About', ar: 'عن التطبيق' },
  'how-it-works': { en: 'How it works', ar: 'كيف يعمل' },
  'budgeting-usd-lbp': { en: 'USD & LBP guide', ar: 'دليل الدولار والليرة' },
  contribute: { en: 'Contribute', ar: 'ساهم معنا' },
};

export function publicPath(page: PublicPage, locale: Locale): string {
  return `${locale === 'ar' ? '/ar' : ''}/${page}`;
}
