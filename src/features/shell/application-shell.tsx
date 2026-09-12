import type { ReactNode } from 'react';
import { CircleUserRound, Languages } from 'lucide-react';
import type { Locale, Space } from '../loans/types.js';
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
    product: 'Budget ledger', currentSpace: 'Current space', addSpace: 'Add another space', personal: 'Personal space', household: 'Household space',
    language: 'العربية',
    account: 'Account', signOut: 'Sign out', navigation: 'Primary navigation', workspace: 'Workspace',
    backupReadiness: 'Backup readiness',
    backupWarning: 'Do not enter real financial data until an encrypted off-site backup and a measured scratch restore are verified.',
    backupRunbookReference: 'Operator repository reference',
  },
  ar: {
    product: 'دفتر الميزانية', currentSpace: 'المساحة الحالية', addSpace: 'إضافة مساحة أخرى', personal: 'مساحة شخصية', household: 'مساحة منزلية',
    language: 'English',
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
    <aside className="app-rail app-rail--light">
      <div className="product-lockup"><span className="product-mark" aria-hidden="true">B</span><strong>{text.product}</strong></div>
      <div className="rail-space">
        <label>{text.currentSpace}<select value={props.selectedSpace.id} onChange={(event) => props.onSpaceChange(event.target.value)}>{props.spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>
        <div className="space-current-name"><bdi>{props.selectedSpace.name}</bdi><span>{props.selectedSpace.kind === 'personal' ? text.personal : text.household}</span></div>
        <button type="button" className="text-button" onClick={props.onAddSpace}>{text.addSpace}</button>
      </div>
      <WorkspaceNavigation activeDestination={activeDestination} idPrefix="desktop-navigation" locale={props.locale} spaceKind={props.selectedSpace.kind} onDestinationChange={(destination) => props.onDestinationChange?.(destination)} />
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
