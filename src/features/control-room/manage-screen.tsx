import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CategoriesPage } from '../categories/categories-page.js';
import type { CategoriesGateway } from '../categories/types.js';
import { HouseholdPage } from '../household/household-page.js';
import type { HouseholdGateway } from '../household/types.js';
import type { Locale, SpaceKind } from '../loans/types.js';
import type { LoansGateway } from '../loans/types.js';
import { LoansPage } from '../loans/loans-page.js';
import { WalletsPage } from '../wallets/wallets-page.js';
import type { WalletsState } from '../wallets/use-wallets.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

export type ManageSection = 'wallets' | 'categories' | 'loans' | 'household';

export interface ManageScreenProps {
  locale: Locale;
  spaceId: string;
  spaceName: string;
  spaceKind: SpaceKind;
  userId: string;
  userEmail: string | null;
  gateways: {
    loans: LoansGateway;
    categories: CategoriesGateway;
    household: HouseholdGateway;
  };
  walletState: WalletsState;
  onLocaleChange(): void;
  onSignOut(): void;
  onSpaceUnavailable?: (() => void) | undefined;
}

const SECTIONS: readonly { id: ManageSection; en: string; ar: string }[] = [
  { id: 'wallets', en: 'Wallets', ar: 'المحافظ' },
  { id: 'categories', en: 'Categories', ar: 'الفئات' },
  { id: 'loans', en: 'Loans', ar: 'القروض' },
  { id: 'household', en: 'Household', ar: 'المنزل' },
];

export function ManageScreen(props: ManageScreenProps) {
  const { locale, spaceId, spaceKind } = props;
  const [section, setSection] = useState<ManageSection | null>(null);

  if (section === null) {
    const sections = SECTIONS.filter((item) => item.id !== 'household' || spaceKind === 'household');
    return (
      <>
        <header className="cr-row">
          <h1>{t(locale, 'Manage', 'الإدارة')}</h1>
        </header>
        <nav className="cr-card cr-manage-menu" aria-label={t(locale, 'Manage sections', 'أقسام الإدارة')}>
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              className="cr-button cr-manage-row"
              onClick={() => setSection(item.id)}
            >
              <span>{t(locale, item.en, item.ar)}</span>
              {locale === 'ar' ? <ChevronLeft aria-hidden size={18} /> : <ChevronRight aria-hidden size={18} />}
            </button>
          ))}
          <button type="button" className="cr-button cr-manage-row" onClick={props.onLocaleChange}>
            <span>{t(locale, 'Language', 'اللغة')}</span>
            <span className="cr-label">{locale === 'ar' ? 'العربية' : 'English'}</span>
          </button>
          <div className="cr-manage-row cr-manage-account">
            <span>{t(locale, 'Account', 'الحساب')}</span>
            <span className="cr-label">{props.userEmail ?? t(locale, 'No email on file', 'لا يوجد بريد مسجّل')}</span>
            <button type="button" className="cr-button" onClick={props.onSignOut}>
              {t(locale, 'Sign out', 'تسجيل الخروج')}
            </button>
          </div>
        </nav>
      </>
    );
  }

  return (
    <>
      <button type="button" className="cr-button cr-manage-back" onClick={() => setSection(null)}>
        {locale === 'ar' ? <ChevronRight aria-hidden size={18} /> : <ChevronLeft aria-hidden size={18} />}
        {t(locale, 'Back to manage sections', 'عودة إلى أقسام الإدارة')}
      </button>
      {section === 'wallets' ? (
        <WalletsPage
          categoriesGateway={props.gateways.categories}
          spaceId={spaceId}
          userId={props.userId}
          walletState={props.walletState}
          locale={locale}
          onSpaceUnavailable={() => props.onSpaceUnavailable?.()}
          onOpenLoans={() => setSection('loans')}
        />
      ) : section === 'categories' ? (
        <CategoriesPage
          gateway={props.gateways.categories}
          spaceId={spaceId}
          locale={locale}
          onSpaceUnavailable={() => props.onSpaceUnavailable?.()}
        />
      ) : section === 'loans' ? (
        <LoansPage
          gateway={props.gateways.loans}
          locale={locale}
          spaceId={spaceId}
          onSpaceUnavailable={() => props.onSpaceUnavailable?.()}
          embedded
        />
      ) : (
        <HouseholdPage
          gateway={props.gateways.household}
          locale={locale}
          spaceId={spaceId}
          spaceName={props.spaceName}
          userId={props.userId}
          onSpaceUnavailable={() => props.onSpaceUnavailable?.()}
        />
      )}
    </>
  );
}
