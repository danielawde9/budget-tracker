import { useEffect } from 'react';
import { useI18n } from '../lib/i18n.tsx';

// This is the deployed address, not the product name (the custom domain is not configured).
export const SITE_URL = 'https://budget-tracker.danielawde9.workers.dev/';
const titles = {
  public: { en: 'Budget Tracker for USD & LBP', ar: 'تتبّع الميزانية بالدولار والليرة' },
  home: { en: 'Overview', ar: 'نظرة عامة' },
  plan: { en: 'Monthly Budget Plan', ar: 'خطة الميزانية الشهرية' },
  activity: { en: 'Income & Expense Activity', ar: 'حركة الدخل والمصروفات' },
  accounts: { en: 'Wallets, Investments & Loans', ar: 'المحافظ والاستثمارات والقروض' },
  settings: { en: 'Settings', ar: 'الإعدادات' },
  onboarding: { en: 'Set Up Your Budget', ar: 'إعداد ميزانيتك' },
  invite: { en: 'Space Invitation', ar: 'دعوة إلى المساحة' },
} as const;

const descriptions = {
  en: 'Plan your monthly budget in USD and track USD and LBP together. Manage expenses, income, wallets, bills, savings goals, investments and loans in English or Arabic.',
  ar: 'خطّط الميزانية الشهرية بالدولار وتابع الدولار والليرة معًا. نظّم المصروفات والدخل والمحافظ والفواتير وأهداف الادخار والاستثمارات والقروض بالعربية أو الإنجليزية.',
};

function meta(attribute: 'name' | 'property', key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.append(element);
  }
  element.content = content;
}

export function PageMetadata({ page }: { readonly page: keyof typeof titles }) {
  const { locale } = useI18n();
  useEffect(() => {
    const title = `${titles[page][locale]} · openbudgetracker.app`;
    const description = page === 'public' ? descriptions[locale] : titles[page][locale];
    document.title = title;
    meta('name', 'description', description);
    meta('name', 'robots', page === 'public' ? 'index, follow' : 'noindex, nofollow');
    meta('property', 'og:title', title);
    meta('property', 'og:description', description);
    meta('property', 'og:locale', locale === 'ar' ? 'ar_LB' : 'en_US');
    meta('property', 'og:locale:alternate', locale === 'ar' ? 'en_US' : 'ar_LB');
    meta('name', 'twitter:title', title);
    meta('name', 'twitter:description', description);
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.append(canonical);
    }
    canonical.href = SITE_URL;
  }, [locale, page]);
  return null;
}
