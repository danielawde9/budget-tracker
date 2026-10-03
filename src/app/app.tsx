import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createBudgetApi, type BudgetApi } from '../api/budget-api.ts';
import type { SpaceSummary } from '../api/schemas.ts';
import { I18nProvider, useI18n } from '../lib/i18n.tsx';
import type { Locale } from '../lib/money.ts';
import { createBrowserBackend } from '../lib/supabase.ts';
import { IS_DEMO, isLoopbackUrl } from '../preview/demo-mode.ts';
import { RecordDialog, type RecordIntent } from '../record/record-dialog.tsx';
import { AccountsScreen } from '../screens/accounts/accounts.tsx';
import { ActivityScreen } from '../screens/activity/activity.tsx';
import { HomeScreen } from '../screens/home/home.tsx';
import { Onboarding } from '../screens/onboarding/onboarding.tsx';
import { PlanScreen } from '../screens/plan/plan.tsx';
import { SettingsScreen } from '../screens/settings/settings.tsx';
import { ErrorNotice, useLoad } from '../ui/async.tsx';
import { AuthScreen } from './auth-screen.tsx';
import { useRoute } from './router.ts';
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
  const api = useMemo(() => (backend ? createBudgetApi(backend.rpc) : null), [backend]);
  return (
    <I18nProvider locale={locale}>
      {backend === null || api === null ? (
        <StatePage titleKey="app.configTitle" bodyKey="app.configBody" />
      ) : IS_DEMO && !isLoopbackUrl(backend.url) ? (
        <StatePage titleKey="demo.refusedTitle" bodyKey="demo.refusedBody" />
      ) : (
        <SignedInGate client={backend.client} api={api} onToggleLocale={toggleLocale} />
      )}
    </I18nProvider>
  );
}

function StatePage({ titleKey, bodyKey }: { readonly titleKey: 'app.configTitle' | 'demo.refusedTitle'; readonly bodyKey: 'app.configBody' | 'demo.refusedBody' }) {
  const { t } = useI18n();
  return (
    <main className="auth-page">
      <section className="auth-boundary" role="alert">
        <h1>{t(titleKey)}</h1>
        <p>{t(bodyKey)}</p>
      </section>
    </main>
  );
}

function SignedInGate({ client, api, onToggleLocale }: { readonly client: SupabaseClient; readonly api: BudgetApi; readonly onToggleLocale: () => void }) {
  const session = useSession(client);
  const { t } = useI18n();
  if (session.status === 'loading') return <main className="auth-page"><p role="status">{t('common.loading')}</p></main>;
  if (session.status === 'signed-out') return <AuthScreen client={client} onToggleLocale={onToggleLocale} />;
  return <SpacesGate key={session.session.user.id} api={api} client={client} onToggleLocale={onToggleLocale} />;
}

function SpacesGate({ api, client, onToggleLocale }: { readonly api: BudgetApi; readonly client: SupabaseClient; readonly onToggleLocale: () => void }) {
  const [version, setVersion] = useState(0);
  const spaces = useLoad(() => api.mySpaces(), [api, version]);
  const [selected, setSelected] = useState<string | null>(() => readStored(SPACE_KEY));
  const select = useCallback((spaceId: string) => {
    writeStored(SPACE_KEY, spaceId);
    setSelected(spaceId);
  }, []);
  const { t } = useI18n();
  if (spaces.status === 'error' && spaces.data === null) {
    return <main className="auth-page"><ErrorNotice error={spaces.error} onRetry={spaces.reload} /></main>;
  }
  if (spaces.data === null) return <main className="auth-page"><p role="status">{t('common.loading')}</p></main>;
  const list = spaces.data;
  const space = list.find((candidate) => candidate.id === selected) ?? list[0];
  if (!space) {
    return (
      <Onboarding
        api={api}
        onToggleLocale={onToggleLocale}
        onSignOut={() => void client.auth.signOut()}
        onFinished={(spaceId) => {
          select(spaceId);
          setVersion((value) => value + 1);
        }}
      />
    );
  }
  return (
    <WorkspaceProvider api={api} space={space} spaces={list} selectSpace={select}>
      <Routes space={space} spaces={list} onSelectSpace={select} onToggleLocale={onToggleLocale} onSignOut={() => void client.auth.signOut()} />
    </WorkspaceProvider>
  );
}

function Routes({ space, spaces, onSelectSpace, onToggleLocale, onSignOut }: {
  readonly space: SpaceSummary;
  readonly spaces: readonly SpaceSummary[];
  readonly onSelectSpace: (spaceId: string) => void;
  readonly onToggleLocale: () => void;
  readonly onSignOut: () => void;
}) {
  const route = useRoute();
  const [record, setRecord] = useState<RecordIntent | null>(() => quickAddIntent());
  const openRecord = useCallback((intent: RecordIntent) => setRecord(intent), []);
  return (
    <Shell route={route} space={space} spaces={spaces} onSelectSpace={onSelectSpace} onRecord={() => openRecord({ kind: 'expense' })} onToggleLocale={onToggleLocale}>
      {route.name === 'home' ? <HomeScreen onRecord={openRecord} /> : null}
      {route.name === 'plan' ? <PlanScreen month={route.month ?? space.currentMonth} onRecord={openRecord} /> : null}
      {route.name === 'activity' ? <ActivityScreen onRecord={openRecord} /> : null}
      {route.name === 'accounts' ? <AccountsScreen onRecord={openRecord} /> : null}
      {route.name === 'settings' ? <SettingsScreen onToggleLocale={onToggleLocale} onSignOut={onSignOut} /> : null}
      {record ? <RecordDialog intent={record} onClose={() => setRecord(null)} /> : null}
    </Shell>
  );
}

/** The installed app's shortcuts open /?add=expense or /?add=income. */
function quickAddIntent(): RecordIntent | null {
  const add = new URLSearchParams(window.location.search).get('add');
  if (add !== 'expense' && add !== 'income') return null;
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
  return { kind: add };
}
