import { useId, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Globe, HandCoins, LogOut, Tags, Users, Wallet } from 'lucide-react';
import { CategoriesPage } from '../categories/categories-page.js';
import type { CategoriesGateway } from '../categories/types.js';
import { HouseholdPage } from '../household/household-page.js';
import type { HouseholdGateway } from '../household/types.js';
import type { Locale, SpaceKind } from '../loans/types.js';
import type { LoansGateway } from '../loans/types.js';
import { LoansPage } from '../loans/loans-page.js';
import { WalletsPage } from '../wallets/wallets-page.js';
import type { WalletsState } from '../wallets/use-wallets.js';
import './manage-hub.css';

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

const SECTIONS: readonly { id: ManageSection; en: string; ar: string; descEn: string; descAr: string; icon: typeof Wallet }[] = [
  { id: 'wallets', en: 'Wallets', ar: 'المحافظ', descEn: 'Balances, transactions and history', descAr: 'الأرصدة والمعاملات والسجل', icon: Wallet },
  { id: 'categories', en: 'Categories', ar: 'الفئات', descEn: 'Income and expense labels', descAr: 'تسميات الدخل والمصروف', icon: Tags },
  { id: 'loans', en: 'Loans', ar: 'القروض', descEn: 'Money borrowed and lent', descAr: 'أموال مقترضة ومُقرضة', icon: HandCoins },
  { id: 'household', en: 'Household', ar: 'المنزل', descEn: 'Members and invitations', descAr: 'الأعضاء والدعوات', icon: Users },
];

interface HubRowProps {
  name: string;
  description: string | null;
  icon: ReactNode;
  trail: ReactNode;
  onClick(): void;
}

function ManageHubRow(props: HubRowProps) {
  const descriptionId = useId();
  return (
    <button
      type="button"
      className="cr-button cr-manage-row mg-hub-row"
      aria-label={props.name}
      aria-describedby={props.description ? descriptionId : undefined}
      onClick={props.onClick}
    >
      <span className="mg-hub-icon" aria-hidden="true">{props.icon}</span>
      <span className="mg-hub-text">
        <span className="mg-hub-label">{props.name}</span>
        {props.description ? <span className="mg-hub-desc" id={descriptionId}>{props.description}</span> : null}
      </span>
      <span className="mg-hub-trail">{props.trail}</span>
    </button>
  );
}

export function ManageScreen(props: ManageScreenProps) {
  const { locale, spaceId, spaceKind } = props;
  const [section, setSection] = useState<ManageSection | null>(null);

  if (section === null) {
    const sections = SECTIONS.filter((item) => item.id !== 'household' || spaceKind === 'household');
    return (
      <>
        <header className="cr-header">
          <h1>{t(locale, 'Manage', 'الإدارة')}</h1>
        </header>
        <nav className="cr-manage-menu mg-hub" aria-label={t(locale, 'Manage sections', 'أقسام الإدارة')}>
          <div className="cr-card mg-hub-group">
            {sections.map((item) => (
              <ManageHubRow
                key={item.id}
                name={t(locale, item.en, item.ar)}
                description={t(locale, item.descEn, item.descAr)}
                icon={<item.icon size={19} strokeWidth={2} />}
                trail={locale === 'ar' ? <ChevronLeft aria-hidden size={18} /> : <ChevronRight aria-hidden size={18} />}
                onClick={() => setSection(item.id)}
              />
            ))}
          </div>
          <div className="cr-card mg-hub-group">
            <h2 className="mg-hub-heading">{t(locale, 'Preferences', 'التفضيلات')}</h2>
            <ManageHubRow
              name={t(locale, 'Language', 'اللغة')}
              description={null}
              icon={<Globe size={19} strokeWidth={2} />}
              trail={<span className="cr-label">{locale === 'ar' ? 'العربية' : 'English'}</span>}
              onClick={props.onLocaleChange}
            />
          </div>
          <div className="cr-card mg-hub-group">
            <h2 className="mg-hub-heading">{t(locale, 'Account', 'الحساب')}</h2>
            <div className="cr-manage-row cr-manage-account mg-hub-account" role="group" aria-label={t(locale, 'Account', 'الحساب')}>
              <span className="cr-manage-identity mg-hub-identity">
                <span className="cr-label">{props.userEmail ?? t(locale, 'No email on file', 'لا يوجد بريد مسجّل')}</span>
              </span>
              <button type="button" className="cr-button mg-hub-signout" onClick={props.onSignOut}>
                <LogOut aria-hidden size={16} />
                {t(locale, 'Sign out', 'تسجيل الخروج')}
              </button>
            </div>
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
          spaceId={spaceId}
          locale={locale}
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
          userEmail={props.userEmail}
          onSpaceUnavailable={() => props.onSpaceUnavailable?.()}
        />
      )}
    </>
  );
}
