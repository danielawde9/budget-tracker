import { ChartPie, House, Languages, Leaf, List, Plus, Settings, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SpaceSummary } from '../api/schemas.ts';
import { useI18n, type MessageKey } from '../lib/i18n.tsx';
import { SelectField } from '../ui/select-field.tsx';
import { navigate, type Route, type RouteName } from './router.ts';

const DESTINATIONS: readonly { readonly name: RouteName; readonly label: MessageKey; readonly Icon: typeof House }[] = [
  { name: 'home', label: 'nav.home', Icon: House },
  { name: 'plan', label: 'nav.plan', Icon: ChartPie },
  { name: 'activity', label: 'nav.activity', Icon: List },
  { name: 'accounts', label: 'nav.accounts', Icon: Wallet },
  { name: 'settings', label: 'nav.settings', Icon: Settings },
];

export interface ShellProps {
  readonly route: Route;
  readonly space: SpaceSummary;
  readonly spaces: readonly SpaceSummary[];
  readonly onSelectSpace: (spaceId: string) => void;
  readonly onRecord: () => void;
  readonly onToggleLocale: () => void;
  readonly children: ReactNode;
}

function SpaceControl({ space, spaces, onSelectSpace }: Pick<ShellProps, 'space' | 'spaces' | 'onSelectSpace'>) {
  const { t } = useI18n();
  if (spaces.length < 2) return <p className="cr-space-name"><bdi>{space.name}</bdi></p>;
  return (
    <div className="cr-space-select">
      <SelectField label={t('shell.space')} hideLabel value={space.id} onChange={(event) => onSelectSpace(event.target.value)}>
        {spaces.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
      </SelectField>
    </div>
  );
}

export function Shell({ route, space, spaces, onSelectSpace, onRecord, onToggleLocale, children }: ShellProps) {
  const { t } = useI18n();
  const tab = ({ name, label, Icon }: (typeof DESTINATIONS)[number]) => {
    const active = route.name === name;
    return (
      <a
        key={name}
        href={`#/${name}`}
        className={active ? 'cr-tab cr-tab--active' : 'cr-tab'}
        aria-current={active ? 'page' : undefined}
        onClick={(event) => {
          event.preventDefault();
          navigate(name === 'plan' ? { name: 'plan', month: null } : ({ name } as Route));
        }}
      >
        <Icon aria-hidden size={20} />
        {t(label)}
      </a>
    );
  };
  const mobileTabs = DESTINATIONS.filter((destination) => destination.name !== 'settings');
  return (
    <div className="cr-shell">
      <nav className="cr-rail" aria-label={t('nav.main')}>
        <div className="cr-brand"><Leaf aria-hidden size={22} /><span>{t('app.name')}</span></div>
        <SpaceControl space={space} spaces={spaces} onSelectSpace={onSelectSpace} />
        <button type="button" className="cr-rail-record" onClick={onRecord}>
          <Plus aria-hidden size={18} />
          {t('nav.record')}
        </button>
        {DESTINATIONS.map(tab)}
        <button type="button" className="cr-rail-language" onClick={onToggleLocale} aria-label={t('shell.languageLabel')}>
          <Languages aria-hidden size={18} />
          {t('shell.language')}
        </button>
      </nav>
      <div className="cr-mobile-topbar">
        <SpaceControl space={space} spaces={spaces} onSelectSpace={onSelectSpace} />
        <div className="cr-row">
          <button type="button" className="cr-icon-button" onClick={onToggleLocale} aria-label={t('shell.languageLabel')}>
            <Languages aria-hidden size={20} />
          </button>
          <a className="cr-icon-button" href="#/settings" aria-label={t('nav.settings')}>
            <Settings aria-hidden size={20} />
          </a>
        </div>
      </div>
      <main className="cr-main cr-main--wide">{children}</main>
      <nav className="cr-tabbar" aria-label={t('nav.main')}>
        {mobileTabs.slice(0, 2).map(tab)}
        <div className="cr-tab-fab">
          <button type="button" className="cr-fab" aria-label={t('nav.record')} onClick={onRecord}>
            <Plus aria-hidden size={26} />
          </button>
          <span className="cr-tab-fab-label" aria-hidden="true">{t('nav.record')}</span>
        </div>
        {mobileTabs.slice(2).map(tab)}
      </nav>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { readonly title: string; readonly subtitle?: ReactNode; readonly actions?: ReactNode }) {
  return (
    <header className="cr-header">
      <div className="cr-header-text">
        <h1>{title}</h1>
        {subtitle ? <p className="cr-helper">{subtitle}</p> : null}
      </div>
      {actions ? <div className="cr-header-actions">{actions}</div> : null}
    </header>
  );
}
