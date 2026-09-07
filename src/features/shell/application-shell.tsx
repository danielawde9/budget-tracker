import type { ReactNode } from 'react';
import type { Locale, Space } from '../loans/types.js';

interface ApplicationShellProps {
  locale: Locale;
  userEmail: string | null;
  spaces: readonly Space[];
  selectedSpace: Space;
  onSpaceChange(spaceId: string): void;
  onLocaleChange(): void;
  onSignOut(): void;
  children: ReactNode;
}

const copy = {
  en: {
    product: 'Budget ledger', currentSpace: 'Current space', personal: 'Personal space', household: 'Household space',
    loans: 'Loans', wallets: 'Wallets — coming later', reports: 'Reports — coming later', language: 'العربية',
    account: 'Account', signOut: 'Sign out', navigation: 'Primary navigation', workspace: 'Workspace',
  },
  ar: {
    product: 'دفتر الميزانية', currentSpace: 'المساحة الحالية', personal: 'مساحة شخصية', household: 'مساحة منزلية',
    loans: 'القروض', wallets: 'المحافظ — قريبًا', reports: 'التقارير — قريبًا', language: 'English',
    account: 'الحساب', signOut: 'تسجيل الخروج', navigation: 'التنقل الرئيسي', workspace: 'مساحة العمل',
  },
} as const;

export function ApplicationShell(props: ApplicationShellProps) {
  const text = copy[props.locale];
  return <div className="budget-layout">
    <aside className="app-rail">
      <div className="product-lockup"><span className="product-mark" aria-hidden="true">B</span><strong>{text.product}</strong></div>
      <div className="rail-space">
        <label>{text.currentSpace}<select value={props.selectedSpace.id} onChange={(event) => props.onSpaceChange(event.target.value)}>{props.spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>
        <div className="space-current-name"><bdi>{props.selectedSpace.name}</bdi><span>{props.selectedSpace.kind === 'personal' ? text.personal : text.household}</span></div>
      </div>
      <nav className="primary-nav" aria-label={text.navigation}>
        <span className="nav-active" aria-current="page"><span aria-hidden="true">◒</span>{text.loans}</span>
        <button type="button" disabled aria-label={text.wallets}><span aria-hidden="true">□</span>{text.wallets}</button>
        <button type="button" disabled aria-label={text.reports}><span aria-hidden="true">⌁</span>{text.reports}</button>
      </nav>
      <div className="rail-footer">
        <button type="button" className="locale-button" onClick={props.onLocaleChange}>{text.language}</button>
        <details className="account-menu">
          <summary>{text.account}</summary>
          <div className="account-popover"><bdi>{props.userEmail ?? ''}</bdi><button type="button" onClick={props.onSignOut}>{text.signOut}</button></div>
        </details>
      </div>
    </aside>
    <main className="shell-main" aria-label={text.workspace}>{props.children}</main>
  </div>;
}
