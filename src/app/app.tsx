import { SaveRecoveryStore } from '../api/save-recovery.ts';
import { SaveRecoveryProvider, SaveRecoveryNotice } from './save-recovery.tsx';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBudgetApi, type BudgetApi } from '../api/budget-api.ts';
import type { SpaceSummary } from '../api/schemas.ts';
import { I18nProvider, useI18n } from '../lib/i18n.tsx';
import type { Locale } from '../lib/money.ts';
import { createBrowserBackend } from '../lib/supabase.ts';
import { DemoTourProvider, DemoTourPanel } from '../preview/tour.tsx';
import { IS_DEMO, isLoopbackUrl } from '../preview/demo-mode.ts';
import { RecordDialog, type RecordIntent } from '../record/record-dialog.tsx';
import { AccountsScreen } from '../screens/accounts/accounts.tsx';
import { ActivityScreen } from '../screens/activity/activity.tsx';
import { HomeScreen } from '../screens/home/home.tsx';
import { Onboarding } from '../screens/onboarding/onboarding.tsx';
import { PlanScreen } from '../screens/plan/plan.tsx';
import { SettingsScreen } from '../screens/settings/settings.tsx';
import { ErrorNotice } from '../ui/async.tsx';
import { PageMetadata } from './page-metadata.tsx';
import { AuthScreen } from './auth-screen.tsx';
import { InviteAcceptance } from './invite-acceptance.tsx';
import { navigate, useRoute } from './router.ts';
import { useSpaces } from './use-spaces.ts';
import { Shell } from './shell.tsx';
import { useSession } from './use-session.ts';
import { WorkspaceProvider } from './workspace.tsx';

const LOCALE_KEY = 'budget:locale';
const SPACE_KEY = 'budget:space';

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A blocked storage only loses a convenience (language or last space).
  }
}

export function App() {
  const [locale, setLocale] = useState<Locale>(() => (readStored(LOCALE_KEY) === 'ar' ? 'ar' : 'en'));
  const toggleLocale = useCallback(() => {
    setLocale((current) => {
      const next = current === 'ar' ? 'en' : 'ar';
      writeStored(LOCALE_KEY, next);
      return next;
    });
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);
  const backend = useMemo(createBrowserBackend, []);
  const recovery = useMemo(() => new SaveRecoveryStore(), []);
  const api = useMemo(() => (backend ? createBudgetApi(backend.rpc, recovery) : null), [backend, recovery]);
  return (
    <I18nProvider locale={locale}>
      {backend === null || api === null ? (
        <StatePage titleKey="app.configTitle" bodyKey="app.configBody" />
      ) : IS_DEMO && !isLoopbackUrl(backend.url) ? (
        <StatePage titleKey="demo.refusedTitle" bodyKey="demo.refusedBody" />
      ) : (
        <SaveRecoveryProvider store={recovery}><SignedInGate recovery={recovery} client={backend.client} api={api} onToggleLocale={toggleLocale} /></SaveRecoveryProvider>
      )}
    </I18nProvider>
  );
}

function StatePage({ titleKey, bodyKey }: { readonly titleKey: 'app.configTitle' | 'demo.refusedTitle'; readonly bodyKey: 'app.configBody' | 'demo.refusedBody' }) {
  const { t } = useI18n();
  return (
    <main className="auth-page">
      <section className="auth-boundary" role="alert"><PageMetadata page="onboarding" />
        <h1>{t(titleKey)}</h1>
        <p>{t(bodyKey)}</p>
      </section>
    </main>
  );
}

function SignedInGate({ client, api, onToggleLocale, recovery }: { readonly recovery: SaveRecoveryStore; readonly client: SupabaseClient; readonly api: BudgetApi; readonly onToggleLocale: () => void }) {
  const session = useSession(client);
  const userId = session.status === 'signed-in' ? session.session.user.id : null;
  useEffect(() => recovery.clear(), [recovery, userId]);
  const route = useRoute();
  const { t } = useI18n();
  if (session.status === 'loading') return <main className="auth-page"><p role="status">{t('common.loading')}</p></main>;
  if (session.status === 'signed-out') return <><PageMetadata page={route.name === 'invite' ? 'invite' : 'public'} /><AuthScreen client={client} onToggleLocale={onToggleLocale} /></>;
  return <SpacesGate key={session.session.user.id} api={api} client={client} onToggleLocale={onToggleLocale} />;
}

function SpacesGate({ api, client, onToggleLocale }: { readonly api: BudgetApi; readonly client: SupabaseClient; readonly onToggleLocale: () => void }) {
  const { spaces, reload } = useSpaces(api);
  const route = useRoute();
  const [selected, setSelected] = useState<string | null>(() => readStored(SPACE_KEY));
  const select = useCallback((spaceId: string) => {
    writeStored(SPACE_KEY, spaceId);
    setSelected(spaceId);
  }, []);
  const { t } = useI18n();
  if (route.name === 'invite') return <InviteAcceptance key={route.token} api={api} token={route.token} onSignOut={() => void client.auth.signOut()} onAccepted={spaceId => { select(spaceId); reload(); navigate({ name: 'home' }); }} />;
  if (spaces.status === 'error' && spaces.data === null) {
    return <main className="auth-page"><ErrorNotice error={spaces.error} onRetry={spaces.reload} /></main>;
  }
  if (spaces.data === null) return <main className="auth-page"><p role="status">{t('common.loading')}</p></main>;
  const list = spaces.data;
  const space = list.find((candidate) => candidate.id === selected) ?? list[0];
  if (!space) {
    return (
      <>
      <PageMetadata page="onboarding" />
      <Onboarding
        api={api}
        onToggleLocale={onToggleLocale}
        onSignOut={() => void client.auth.signOut()}
        onFinished={(spaceId) => {
          select(spaceId);
          reload();
        }}
      /></>
    );
  }
  return (
    <WorkspaceProvider api={api} space={space} spaces={list} selectSpace={select}>
      <Routes space={space} spaces={list} onSelectSpace={select} onToggleLocale={onToggleLocale} onSignOut={() => void client.auth.signOut()} />
    </WorkspaceProvider>
  );
}

export function Routes({ space, spaces, onSelectSpace, onToggleLocale, onSignOut }: {
  readonly space: SpaceSummary;
  readonly spaces: readonly SpaceSummary[];
  readonly onSelectSpace: (spaceId: string) => void;
  readonly onToggleLocale: () => void;
  readonly onSignOut: () => void;
}) {
  const route = useRoute();
  const [record, setRecord] = useState<RecordIntent | null>(() => quickAddIntent());
  const previousSpace = useRef(space.id);
  useEffect(() => {
    if (previousSpace.current !== space.id) { previousSpace.current = space.id; setRecord(null); }
  }, [space.id]);
  const openRecord = useCallback((intent: RecordIntent) => setRecord(intent), []);
  return (
    <DemoTourProvider key={space.id}><PageMetadata page={route.name} /><Shell route={route} space={space} spaces={spaces} onSelectSpace={onSelectSpace} onRecord={() => openRecord({ kind: 'expense' })} onToggleLocale={onToggleLocale}>
      <SaveRecoveryNotice key={space.id} />
      {route.name === 'home' ? <HomeScreen onRecord={openRecord} /> : null}
      {route.name === 'plan' ? <PlanScreen month={route.month ?? space.currentMonth} onRecord={openRecord} /> : null}
      {route.name === 'activity' ? <ActivityScreen walletId={route.walletId ?? null} month={route.month ?? null} onRecord={openRecord} /> : null}
      {route.name === 'accounts' ? <AccountsScreen onRecord={openRecord} /> : null}
      {route.name === 'settings' ? <SettingsScreen onToggleLocale={onToggleLocale} onSignOut={onSignOut} /> : null}
      {IS_DEMO ? <DemoTourPanel /> : null}
      {record ? <RecordDialog intent={record} onClose={() => setRecord(null)} /> : null}
    </Shell></DemoTourProvider>
  );
}

/** The installed app's shortcuts open /?add=expense or /?add=income. */
function quickAddIntent(): RecordIntent | null {
  const add = new URLSearchParams(window.location.search).get('add');
  if (add !== 'expense' && add !== 'income') return null;
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
  return { kind: add };
}
