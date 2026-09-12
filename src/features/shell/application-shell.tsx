import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CircleUserRound, Languages } from 'lucide-react';
import type { Locale, Space } from '../loans/types.js';
import { SpaceSwitcher } from './space-switcher.js';
import { WorkspaceNavigation, type ApplicationDestination } from './workspace-navigation.js';

export type { ApplicationDestination } from './workspace-navigation.js';

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
    product: 'Budget ledger',
    language: 'العربية',
    account: 'Account', signOut: 'Sign out', navigation: 'Primary navigation', workspace: 'Workspace',
    menu: 'Menu', navigationMenu: 'Navigation menu', closeMenu: 'Close menu',
    backupReadiness: 'Backup readiness',
    backupWarning: 'Do not enter real financial data until an encrypted off-site backup and a measured scratch restore are verified.',
    backupRunbookReference: 'Operator repository reference',
  },
  ar: {
    product: 'دفتر الميزانية',
    language: 'English',
    account: 'الحساب', signOut: 'تسجيل الخروج', navigation: 'التنقل الرئيسي', workspace: 'مساحة العمل',
    menu: 'القائمة', navigationMenu: 'قائمة التنقل', closeMenu: 'إغلاق القائمة',
    backupReadiness: 'جاهزية النسخ الاحتياطي',
    backupWarning: 'لا تُدخل بيانات مالية حقيقية قبل التحقق من نسخة احتياطية مشفّرة خارج الجهاز واستعادة تجريبية مقاسة.',
    backupRunbookReference: 'مرجع المستودع للمشغّل',
  },
} as const;

type ShellText = (typeof copy)[Locale];

interface ShellUtilitiesProps {
  text: ShellText;
  userEmail: string | null;
  onLocaleChange(): void;
  onSignOut(): void;
}

function ShellUtilities({ text, userEmail, onLocaleChange, onSignOut }: ShellUtilitiesProps) {
  return <div className="shell-utilities">
    <button type="button" className="locale-button" onClick={onLocaleChange}><Languages aria-hidden="true" />{text.language}</button>
    <details className="account-menu">
      <summary><CircleUserRound aria-hidden="true" />{text.account}</summary>
      <div className="account-popover">
        <bdi>{userEmail ?? ''}</bdi>
        <details className="backup-details">
          <summary>{text.backupReadiness}</summary>
          <aside className="backup-readiness" role="note" aria-label={text.backupReadiness}>
            <p>{text.backupWarning}</p>
            <span>{text.backupRunbookReference}</span>
            <bdi>docs/operations/backup-restore-runbook.md</bdi>
          </aside>
        </details>
        <button type="button" onClick={onSignOut}>{text.signOut}</button>
      </div>
    </details>
  </div>;
}

export function ApplicationShell(props: ApplicationShellProps) {
  const text = copy[props.locale];
  const activeDestination = props.activeDestination ?? 'home';
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const closeMenuRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (mobileMenuOpen) closeMenuRef.current?.focus();
  }, [mobileMenuOpen]);

  function closeMobileMenu() {
    setMobileMenuOpen(false);
    requestAnimationFrame(() => menuTriggerRef.current?.focus());
  }

  function handleDrawerKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMobileMenu();
      return;
    }

    if (event.key !== 'Tab') return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), summary')];
    const first = focusable.at(0);
    const last = focusable.at(-1);
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return <div className="budget-layout">
    <header className="mobile-shell-bar">
      <div className="product-lockup"><span className="product-mark" aria-hidden="true">B</span><strong>{text.product}</strong></div>
      <SpaceSwitcher locale={props.locale} spaces={props.spaces} selectedSpace={props.selectedSpace} onSpaceChange={props.onSpaceChange} onAddSpace={props.onAddSpace} />
      <button ref={menuTriggerRef} type="button" className="mobile-menu-trigger" aria-expanded={mobileMenuOpen} aria-haspopup="dialog" onClick={() => setMobileMenuOpen(true)}>{text.menu}</button>
    </header>
    <aside className="app-rail app-rail--light">
      <div className="product-lockup"><span className="product-mark" aria-hidden="true">B</span><strong>{text.product}</strong></div>
      <SpaceSwitcher locale={props.locale} spaces={props.spaces} selectedSpace={props.selectedSpace} onSpaceChange={props.onSpaceChange} onAddSpace={props.onAddSpace} />
      <WorkspaceNavigation activeDestination={activeDestination} idPrefix="desktop-navigation" locale={props.locale} spaceKind={props.selectedSpace.kind} onDestinationChange={(destination) => props.onDestinationChange?.(destination)} />
      <div className="rail-footer">
        <ShellUtilities text={text} userEmail={props.userEmail} onLocaleChange={props.onLocaleChange} onSignOut={props.onSignOut} />
      </div>
    </aside>
    <main className="shell-main" aria-label={text.workspace}>{props.children}</main>
    {mobileMenuOpen ? <div className="mobile-navigation-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeMobileMenu();
    }}>
      <section className="mobile-navigation-drawer" role="dialog" aria-modal="true" aria-label={text.navigationMenu} onKeyDown={handleDrawerKeyDown}>
        <div className="mobile-drawer-heading">
          <h2 id="mobile-navigation-heading">{text.navigation}</h2>
          <button ref={closeMenuRef} type="button" className="text-button" onClick={closeMobileMenu}>{text.closeMenu}</button>
        </div>
        <WorkspaceNavigation activeDestination={activeDestination} idPrefix="mobile-navigation" locale={props.locale} spaceKind={props.selectedSpace.kind} onDestinationChange={(destination) => {
          props.onDestinationChange?.(destination);
          closeMobileMenu();
        }} />
        <SpaceSwitcher locale={props.locale} spaces={props.spaces} selectedSpace={props.selectedSpace} onSpaceChange={props.onSpaceChange} onAddSpace={props.onAddSpace} />
        <ShellUtilities text={text} userEmail={props.userEmail} onLocaleChange={props.onLocaleChange} onSignOut={props.onSignOut} />
      </section>
    </div> : null}
  </div>;
}
