import type { ReactNode } from 'react';
import { House, BookText, Plus, ChartPie, Settings2, Leaf } from 'lucide-react';
import type { Locale } from '../loans/types.js';
import type { ControlRoomDestination } from './types.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

const DESTINATIONS: readonly { id: ControlRoomDestination; icon: typeof House; en: string; ar: string }[] = [
  { id: 'home', icon: House, en: 'Home', ar: 'الرئيسية' },
  { id: 'journal', icon: BookText, en: 'Journal', ar: 'دفتر اليومية' },
  { id: 'plan', icon: ChartPie, en: 'Plan', ar: 'الخطة' },
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
        <span className="cr-tab-fab-label" aria-hidden="true">{t(locale, 'Record', 'سجل')}</span>
      </div>
      {DESTINATIONS.slice(2).map(renderTab)}
    </>
  );
  const railRecord = (
    <button
      type="button"
      className="cr-rail-record"
      aria-label={t(locale, 'Record', 'سجل')}
      onClick={onRecord}
    >
      <Plus aria-hidden size={18} />
      {t(locale, 'Record', 'سجل')}
    </button>
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
        <div className="cr-brand"><Leaf aria-hidden size={22} /><span>{t(locale, 'Budget ledger', 'دفتر الميزانية')}</span></div>
        {props.spaceControls}
        {railRecord}
        {DESTINATIONS.map(renderTab)}
      </nav>
      <div className="cr-mobile-topbar">{props.spaceControls}</div>
      <main className="cr-main">{props.children}</main>
      <nav className="cr-tabbar" aria-label={t(locale, 'Workspace', 'مساحة العمل')}>{tabs}</nav>
    </div>
  );
}
