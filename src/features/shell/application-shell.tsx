import type { ReactNode } from 'react';
import type { Locale, Space } from '../loans/types.js';

export type ApplicationDestination = 'loans' | 'wallets' | 'categories' | 'household';

interface ApplicationShellProps {
  locale: Locale;
  userEmail: string | null;
  spaces: readonly Space[];
  selectedSpace: Space;
  activeDestination?: ApplicationDestination;
  onDestinationChange?(destination: ApplicationDestination): void;
  onSpaceChange(spaceId: string): void;
  onLocaleChange(): void;
  onSignOut(): void;
  children: ReactNode;
}

const copy = {
  en: {
    product: 'Budget ledger', currentSpace: 'Current space', personal: 'Personal space', household: 'Household space',
    loans: 'Loans', wallets: 'Wallets', categories: 'Categories', householdNav: 'Household', reports: 'Reports — coming later', language: 'العربية',
    account: 'Account', signOut: 'Sign out', navigation: 'Primary navigation', workspace: 'Workspace',
    backupReadiness: 'Backup readiness',
    backupWarning: 'Do not enter real financial data until an encrypted off-site backup and a measured scratch restore are verified.',
    backupRunbookReference: 'Operator repository reference',
  },
  ar: {
    product: 'دفتر الميزانية', currentSpace: 'المساحة الحالية', personal: 'مساحة شخصية', household: 'مساحة منزلية',
    loans: 'القروض', wallets: 'المحافظ', categories: 'الفئات', householdNav: 'المنزل', reports: 'التقارير — قريبًا', language: 'English',
    account: 'الحساب', signOut: 'تسجيل الخروج', navigation: 'التنقل الرئيسي', workspace: 'مساحة العمل',
    backupReadiness: 'جاهزية النسخ الاحتياطي',
    backupWarning: 'لا تُدخل بيانات مالية حقيقية قبل التحقق من نسخة احتياطية مشفّرة خارج الجهاز واستعادة تجريبية مقاسة.',
    backupRunbookReference: 'مرجع المستودع للمشغّل',
  },
} as const;

export function ApplicationShell(props: ApplicationShellProps) {
  const text = copy[props.locale];
  const activeDestination = props.activeDestination ?? 'loans';
  return <div className="budget-layout">
    <aside className="app-rail">
      <div className="product-lockup"><span className="product-mark" aria-hidden="true">B</span><strong>{text.product}</strong></div>
      <div className="rail-space">
        <label>{text.currentSpace}<select value={props.selectedSpace.id} onChange={(event) => props.onSpaceChange(event.target.value)}>{props.spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>
        <div className="space-current-name"><bdi>{props.selectedSpace.name}</bdi><span>{props.selectedSpace.kind === 'personal' ? text.personal : text.household}</span></div>
      </div>
      <nav className="primary-nav" aria-label={text.navigation}>
        <button type="button" className={activeDestination === 'loans' ? 'nav-active' : ''} aria-current={activeDestination === 'loans' ? 'page' : undefined} onClick={() => props.onDestinationChange?.('loans')}><span aria-hidden="true">◒</span>{text.loans}</button>
        <button type="button" className={activeDestination === 'wallets' ? 'nav-active' : ''} aria-current={activeDestination === 'wallets' ? 'page' : undefined} onClick={() => props.onDestinationChange?.('wallets')}><span aria-hidden="true">□</span>{text.wallets}</button>
        <button type="button" className={activeDestination === 'categories' ? 'nav-active' : ''} aria-current={activeDestination === 'categories' ? 'page' : undefined} onClick={() => props.onDestinationChange?.('categories')}><span aria-hidden="true">≡</span>{text.categories}</button>
        {props.selectedSpace.kind === 'household' ? <button type="button" className={activeDestination === 'household' ? 'nav-active' : ''} aria-current={activeDestination === 'household' ? 'page' : undefined} onClick={() => props.onDestinationChange?.('household')}><span aria-hidden="true">⌂</span>{text.householdNav}</button> : null}
        <button type="button" disabled aria-label={text.reports}><span aria-hidden="true">⌁</span>{text.reports}</button>
      </nav>
      <div className="rail-footer">
        <button type="button" className="locale-button" onClick={props.onLocaleChange}>{text.language}</button>
        <details className="account-menu">
          <summary>{text.account}</summary>
          <div className="account-popover">
            <bdi>{props.userEmail ?? ''}</bdi>
            <aside className="backup-readiness" role="note" aria-label={text.backupReadiness}>
              <strong>{text.backupReadiness}</strong>
              <p>{text.backupWarning}</p>
              <span>{text.backupRunbookReference}</span>
              <bdi>docs/operations/backup-restore-runbook.md</bdi>
            </aside>
            <button type="button" onClick={props.onSignOut}>{text.signOut}</button>
          </div>
        </details>
      </div>
    </aside>
    <main className="shell-main" aria-label={text.workspace}>{props.children}</main>
  </div>;
}
