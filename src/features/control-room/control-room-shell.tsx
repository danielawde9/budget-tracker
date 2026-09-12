import type { ReactNode } from 'react';
import { LayoutDashboard, ScrollText, Plus, Target, Settings2 } from 'lucide-react';
import type { Locale } from '../loans/types.js';
import type { ControlRoomDestination } from './types.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

const DESTINATIONS: readonly { id: ControlRoomDestination; icon: typeof LayoutDashboard; en: string; ar: string }[] = [
  { id: 'home', icon: LayoutDashboard, en: 'Home', ar: 'الرئيسية' },
  { id: 'journal', icon: ScrollText, en: 'Journal', ar: 'دفتر اليومية' },
  { id: 'plan', icon: Target, en: 'Plan', ar: 'الخطة' },
  { id: 'manage', icon: Settings2, en: 'Manage', ar: 'الإدارة' },
];

export interface ControlRoomShellProps {
  locale: Locale;
  userEmail: string | null;
  activeDestination: ControlRoomDestination;
  onDestinationChange(destination: ControlRoomDestination): void;
  onLocaleChange(): void;
  onSignOut(): void;
  onRecord(): void;
  /** Space switcher + month selector etc., supplied by the caller (reuses SpaceSwitcher from features/shell). */
  spaceControls: ReactNode;
  children: ReactNode;
}

export function ControlRoomShell(props: ControlRoomShellProps) {
  const { locale, activeDestination, onDestinationChange, onRecord } = props;
  const tabs = (
    <>
      {DESTINATIONS.slice(0, 2).map(renderTab)}
      <div className="cr-tab-fab">
        <button type="button" className="cr-fab" aria-label={t(locale, 'Record', 'سجل')} onClick={onRecord}>
          <Plus aria-hidden size={26} />
        </button>
      </div>
      {DESTINATIONS.slice(2).map(renderTab)}
    </>
  );
  function renderTab({ id, icon: Icon, en, ar }: (typeof DESTINATIONS)[number]) {
    const active = activeDestination === id;
    return (
      <button
        key={id}
        type="button"
        className={active ? 'cr-tab cr-tab--active' : 'cr-tab'}
        aria-current={active ? 'page' : undefined}
        onClick={() => onDestinationChange(id)}
      >
        <Icon aria-hidden size={20} />
        {t(locale, en, ar)}
      </button>
    );
  }
  return (
    <div className="cr-shell">
      <nav className="cr-rail" aria-label={t(locale, 'Workspace', 'مساحة العمل')}>
        {props.spaceControls}
        {tabs}
      </nav>
      <main className="cr-main">{props.children}</main>
      <nav className="cr-tabbar" aria-label={t(locale, 'Workspace', 'مساحة العمل')}>{tabs}</nav>
    </div>
  );
}
