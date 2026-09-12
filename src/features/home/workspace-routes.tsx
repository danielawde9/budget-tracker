import { lazy, Suspense } from 'react';

import type { CategoriesGateway } from '../categories/types.js';
import type { HouseholdGateway } from '../household/types.js';
import type { LoansGateway, Locale, Space } from '../loans/types.js';
import type { ApplicationDestination } from '../shell/application-shell.js';
import type { WalletsGateway } from '../wallets/types.js';
import { useWallets } from '../wallets/use-wallets.js';
import { HomePage } from './home-page.js';

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

const WalletsPage = lazy(async () => {
  const module = await import('../wallets/wallets-page.js');
  return { default: module.WalletsPage };
});

const LoansPage = lazy(async () => {
  const module = await import('../loans/loans-page.js');
  return { default: module.LoansPage };
});

const CategoriesPage = lazy(async () => {
  const module = await import('../categories/categories-page.js');
  return { default: module.CategoriesPage };
});

const HouseholdPage = lazy(async () => {
  const module = await import('../household/household-page.js');
  return { default: module.HouseholdPage };
});

interface WorkspaceRoutesProps {
  activeDestination: ApplicationDestination;
  categoriesGateway: CategoriesGateway;
  householdGateway: HouseholdGateway;
  loansGateway: LoansGateway;
  walletsGateway: WalletsGateway;
  locale: Locale;
  spaceId: string;
  spaceName: string;
  spaces: readonly Space[];
  userId: string;
  openTransaction: boolean;
  onDestinationChange(destination: ApplicationDestination): void;
  onSpaceChange(spaceId: string): void;
  onSpaceUnavailable(): void;
  onRecordTransaction(): void;
  onTransactionDialogOpened(): void;
}

export function WorkspaceRoutes(props: WorkspaceRoutesProps) {
  const walletState = useWallets(props.walletsGateway, props.spaceId, props.onSpaceUnavailable, undefined, props.categoriesGateway);
  if (props.activeDestination === 'home' && walletState.status === 'loading') return <div className="state-panel" role="status" aria-label={t(props.locale, 'Loading financial overview', 'جارٍ تحميل النظرة المالية')}>{t(props.locale, 'Loading your financial overview…', 'جارٍ تحميل نظرتك المالية…')}</div>;
  if (props.activeDestination === 'home' && walletState.status === 'error') return <section className="state-panel error-notice" role="alert"><strong>{t(props.locale, 'Wallets are unavailable', 'المحافظ غير متاحة')}</strong><p>{walletState.error}</p><button type="button" onClick={() => void walletState.refresh()}>{t(props.locale, 'Try again', 'المحاولة مجددًا')}</button></section>;
  if (props.activeDestination === 'home') return <HomePage
    locale={props.locale}
    wallets={walletState.wallets}
    recentEvents={walletState.initialEvents}
    onOpenWallets={() => props.onDestinationChange('wallets')}
    onRecordTransaction={() => {
      props.onDestinationChange('wallets');
      props.onRecordTransaction();
    }}
  />;
  if (props.activeDestination === 'loans') return <Suspense fallback={<div className="state-panel" role="status">{props.locale === 'ar' ? 'جارٍ تحميل القروض…' : 'Loading Loans…'}</div>}><LoansPage embedded gateway={props.loansGateway} locale={props.locale} spaces={props.spaces} spaceId={props.spaceId} onSpaceChange={props.onSpaceChange} onSpaceUnavailable={props.onSpaceUnavailable} /></Suspense>;
  if (props.activeDestination === 'wallets') return <Suspense fallback={<div className="state-panel" role="status">{props.locale === 'ar' ? 'جارٍ تحميل المحافظ…' : 'Loading Wallets…'}</div>}><WalletsPage categoriesGateway={props.categoriesGateway} locale={props.locale} spaceId={props.spaceId} onSpaceUnavailable={props.onSpaceUnavailable} walletState={walletState} openTransaction={props.openTransaction} onTransactionDialogOpened={props.onTransactionDialogOpened} onOpenLoans={() => props.onDestinationChange('loans')} /></Suspense>;
  if (props.activeDestination === 'categories') return <Suspense fallback={<div className="state-panel" role="status">{props.locale === 'ar' ? 'جارٍ تحميل الفئات…' : 'Loading Categories…'}</div>}><CategoriesPage gateway={props.categoriesGateway} locale={props.locale} spaceId={props.spaceId} onSpaceUnavailable={props.onSpaceUnavailable} /></Suspense>;
  return <Suspense fallback={<div className="state-panel" role="status">{props.locale === 'ar' ? 'جارٍ تحميل الأسرة…' : 'Loading Household…'}</div>}><HouseholdPage gateway={props.householdGateway} locale={props.locale} spaceId={props.spaceId} spaceName={props.spaceName} userId={props.userId} onSpaceUnavailable={props.onSpaceUnavailable} /></Suspense>;
}
