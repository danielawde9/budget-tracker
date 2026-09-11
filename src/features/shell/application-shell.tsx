import type { ReactNode } from 'react';
import { CircleUserRound, HandCoins, House, Languages, Tags, UsersRound, WalletCards } from 'lucide-react';
import type { Locale, Space } from '../loans/types.js';

export type ApplicationDestination = 'home' | 'loans' | 'wallets' | 'categories' | 'household';

interface ApplicationShellProps {
  locale: Locale;
  userEmail: string | null;
  spaces: readonly Space[];
  selectedSpace: Space;
  activeDestination?: ApplicationDestination;
  onDestinationChange?(destination: ApplicationDestination): void;
  onSpaceChange(spaceId: string): void;
  onAddSpace(): void;
  onLocaleChange(): void;
  onSignOut(): void;
  children: ReactNode;
}

const copy = {
  en: {
    product: 'Budget ledger', currentSpace: 'Current space', addSpace: 'Add another space', personal: 'Personal space', household: 'Household space',
    home: 'Home', loans: 'Loans', wallets: 'Wallets', categories: 'Categories', householdNav: 'Household', language: 'العربية',
    account: 'Account', signOut: 'Sign out', navigation: 'Primary navigation', workspace: 'Workspace',
    backupReadiness: 'Backup readiness',
    backupWarning: 'Do not enter real financial data until an encrypted off-site backup and a measured scratch restore are verified.',
    backupRunbookReference: 'Operator repository reference',
  },
  ar: {
    product: 'دفتر الميزانية', currentSpace: 'المساحة الحالية', addSpace: 'إضافة مساحة أخرى', personal: 'مساحة شخصية', household: 'مساحة منزلية',
    home: 'الرئيسية', loans: 'القروض', wallets: 'المحافظ', categories: 'الفئات', householdNav: 'المنزل', language: 'English',
    account: 'الحساب', signOut: 'تسجيل الخروج', navigation: 'التنقل الرئيسي', workspace: 'مساحة العمل',
    backupReadiness: 'جاهزية النسخ الاحتياطي',
    backupWarning: 'لا تُدخل بيانات مالية حقيقية قبل التحقق من نسخة احتياطية مشفّرة خارج الجهاز واستعادة تجريبية مقاسة.',
    backupRunbookReference: 'مرجع المستودع للمشغّل',
  },
} as const;

export function ApplicationShell(props: ApplicationShellProps) {
  const text = copy[props.locale];
  const activeDestination = props.activeDestination ?? 'home';
  return <div className="budget-layout">
    <aside className="app-rail">
      <div className="product-lockup"><span className="product-mark" aria-hidden="true">B</span><strong>{text.product}</strong></div>
      <div className="rail-space">
        <label>{text.currentSpace}<select value={props.selectedSpace.id} onChange={(event) => props.onSpaceChange(event.target.value)}>{props.spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>
        <div className="space-current-name"><bdi>{props.selectedSpace.name}</bdi><span>{props.selectedSpace.kind === 'personal' ? text.personal : text.household}</span></div>
        <button type="button" className="text-button" onClick={props.onAddSpace}>{text.addSpace}</button>
      </div>
      <nav className="primary-nav" aria-label={text.navigation}>
        <button type="button" className={activeDestination === 'home' ? 'nav-active' : ''} aria-current={activeDestination === 'home' ? 'page' : undefined} onClick={() => props.onDestinationChange?.('home')}><span className="navigation-icon" data-testid="navigation-icon" aria-hidden="true"><House /></span>{text.home}</button>
        <button type="button" className={activeDestination === 'loans' ? 'nav-active' : ''} aria-current={activeDestination === 'loans' ? 'page' : undefined} onClick={() => props.onDestinationChange?.('loans')}><span className="navigation-icon" data-testid="navigation-icon" aria-hidden="true"><HandCoins /></span>{text.loans}</button>
        <button type="button" className={activeDestination === 'wallets' ? 'nav-active' : ''} aria-current={activeDestination === 'wallets' ? 'page' : undefined} onClick={() => props.onDestinationChange?.('wallets')}><span className="navigation-icon" data-testid="navigation-icon" aria-hidden="true"><WalletCards /></span>{text.wallets}</button>
        <button type="button" className={activeDestination === 'categories' ? 'nav-active' : ''} aria-current={activeDestination === 'categories' ? 'page' : undefined} onClick={() => props.onDestinationChange?.('categories')}><span className="navigation-icon" data-testid="navigation-icon" aria-hidden="true"><Tags /></span>{text.categories}</button>
        {props.selectedSpace.kind === 'household' ? <button type="button" className={activeDestination === 'household' ? 'nav-active' : ''} aria-current={activeDestination === 'household' ? 'page' : undefined} onClick={() => props.onDestinationChange?.('household')}><span className="navigation-icon" data-testid="navigation-icon" aria-hidden="true"><UsersRound /></span>{text.householdNav}</button> : null}
      </nav>
      <div className="rail-footer">
        <button type="button" className="locale-button" onClick={props.onLocaleChange}><Languages aria-hidden="true" />{text.language}</button>
        <details className="account-menu">
          <summary><CircleUserRound aria-hidden="true" />{text.account}</summary>
          <div className="account-popover">
            <bdi>{props.userEmail ?? ''}</bdi>
            <details className="backup-details">
              <summary>{text.backupReadiness}</summary>
              <aside className="backup-readiness" role="note" aria-label={text.backupReadiness}>
                <p>{text.backupWarning}</p>
                <span>{text.backupRunbookReference}</span>
                <bdi>docs/operations/backup-restore-runbook.md</bdi>
              </aside>
            </details>
            <button type="button" onClick={props.onSignOut}>{text.signOut}</button>
          </div>
        </details>
      </div>
    </aside>
    <main className="shell-main" aria-label={text.workspace}>{props.children}</main>
  </div>;
}
