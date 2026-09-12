import { BarChart3, HandCoins, House, Tags, UsersRound, WalletCards, type LucideIcon } from 'lucide-react';

import type { Locale, SpaceKind } from '../loans/types.js';

export type ApplicationDestination = 'home' | 'loans' | 'wallets' | 'categories' | 'reports' | 'household';

interface NavigationItem {
  destination: ApplicationDestination;
  icon: LucideIcon;
  label: string;
}

interface NavigationGroup {
  id: string;
  label: string;
  items: readonly NavigationItem[];
}

interface WorkspaceNavigationProps {
  activeDestination: ApplicationDestination;
  idPrefix: string;
  locale: Locale;
  spaceKind: SpaceKind;
  onDestinationChange(destination: ApplicationDestination): void;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

function navigationGroups(locale: Locale, spaceKind: SpaceKind): readonly NavigationGroup[] {
  const items = {
    overview: { destination: 'home' as const, icon: House, label: t(locale, 'Overview', 'النظرة العامة') },
    wallets: { destination: 'wallets' as const, icon: WalletCards, label: t(locale, 'Wallets', 'المحافظ') },
    loans: { destination: 'loans' as const, icon: HandCoins, label: t(locale, 'Loans', 'القروض') },
    reports: { destination: 'reports' as const, icon: BarChart3, label: t(locale, 'Reports', 'التقارير') },
    categories: { destination: 'categories' as const, icon: Tags, label: t(locale, 'Categories', 'الفئات') },
    household: { destination: 'household' as const, icon: UsersRound, label: t(locale, 'Household', 'المنزل') },
  };

  return [
    { id: 'daily', label: t(locale, 'Daily money', 'المال اليومي'), items: [items.overview, items.wallets] },
    { id: 'review', label: t(locale, 'Review', 'المراجعة'), items: [items.loans, items.reports] },
    { id: 'setup', label: t(locale, 'Setup', 'الإعداد'), items: spaceKind === 'household' ? [items.categories, items.household] : [items.categories] },
  ];
}

export function WorkspaceNavigation({ activeDestination, idPrefix, locale, spaceKind, onDestinationChange }: WorkspaceNavigationProps) {
  return <nav className="primary-nav" aria-label={t(locale, 'Primary navigation', 'التنقل الرئيسي')}>
    {navigationGroups(locale, spaceKind).map((group) => <section key={group.id} className="navigation-group" aria-labelledby={`${idPrefix}-${group.id}`}>
      <h2 id={`${idPrefix}-${group.id}`}>{group.label}</h2>
      {group.items.map((item) => {
        const Icon = item.icon;
        const selected = item.destination === activeDestination;
        return <button key={item.destination} type="button" className={selected ? 'nav-active' : ''} aria-current={selected ? 'page' : undefined} onClick={() => onDestinationChange(item.destination)}>
          <span className="navigation-icon" data-testid="navigation-icon" aria-hidden="true"><Icon /></span><span>{item.label}</span>
        </button>;
      })}
    </section>)}
  </nav>;
}
