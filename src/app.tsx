import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { AuthScreen } from './features/auth/auth-screen.js';
import { createSupabaseAuthGateway } from './features/auth/supabase-auth-gateway.js';
import type { AuthGateway } from './features/auth/types.js';
import { useAuthSession } from './features/auth/use-auth-session.js';
import { createSupabaseCategoriesGateway } from './features/categories/supabase-categories-gateway.js';
import type { CategoriesGateway } from './features/categories/types.js';
import { LoansPage } from './features/loans/loans-page.js';
import { createSupabaseLoansGateway } from './features/loans/supabase-loans-gateway.js';
import type { LoansGateway, Locale } from './features/loans/types.js';
import { ApplicationShell, type ApplicationDestination } from './features/shell/application-shell.js';
import { OnboardingDialog } from './features/workspace/onboarding-dialog.js';
import { createSupabaseWorkspaceGateway } from './features/workspace/supabase-workspace-gateway.js';
import type { WorkspaceGateway } from './features/workspace/types.js';
import { useWorkspace } from './features/workspace/use-workspace.js';
import { createSupabaseWalletsGateway } from './features/wallets/supabase-wallets-gateway.js';
import type { WalletsGateway } from './features/wallets/types.js';
import { createBrowserDataClient } from './lib/supabase.js';

const WalletsPage = lazy(async () => {
  const module = await import('./features/wallets/wallets-page.js');
  return { default: module.WalletsPage };
});

const CategoriesPage = lazy(async () => {
  const module = await import('./features/categories/categories-page.js');
  return { default: module.CategoriesPage };
});

interface AppProps {
  authGateway?: AuthGateway;
  categoriesGateway?: CategoriesGateway;
  loansGateway?: LoansGateway;
  walletsGateway?: WalletsGateway;
  workspaceGateway?: WorkspaceGateway;
}

interface AuthenticatedWorkspaceProps {
  userId: string;
  userEmail: string | null;
  locale: Locale;
  workspaceGateway: WorkspaceGateway;
  categoriesGateway: CategoriesGateway;
  loansGateway: LoansGateway;
  walletsGateway: WalletsGateway;
  onLocaleChange(): void;
  onSignOut(): void;
}

function AuthenticatedWorkspace(props: AuthenticatedWorkspaceProps) {
  const workspace = useWorkspace(props.workspaceGateway, props.userId);
  const [activeDestination, setActiveDestination] = useState<ApplicationDestination>('loans');

  if (workspace.status === 'loading') {
    return <main className="workspace-state-page"><div role="status">Loading your spaces…</div></main>;
  }
  if (workspace.status === 'error') {
    return <main className="workspace-state-page"><section className="state-panel error-notice" role="alert"><strong>Spaces are unavailable</strong><p>{workspace.error}</p><button type="button" onClick={() => void workspace.refresh()}>Try again</button></section></main>;
  }
  if (workspace.status === 'empty') {
    return <OnboardingDialog locale={props.locale} createSpace={workspace.createFirstSpace} createWallet={workspace.createFirstWallet} onComplete={() => undefined} />;
  }
  if (!workspace.selectedSpace) return null;

  return <ApplicationShell
    locale={props.locale}
    userEmail={props.userEmail}
    spaces={workspace.spaces}
    selectedSpace={workspace.selectedSpace}
    activeDestination={activeDestination}
    onDestinationChange={setActiveDestination}
    onSpaceChange={workspace.selectSpace}
    onLocaleChange={props.onLocaleChange}
    onSignOut={props.onSignOut}
  >
    {activeDestination === 'loans' ? <LoansPage
      embedded
      gateway={props.loansGateway}
      locale={props.locale}
      spaces={workspace.spaces}
      spaceId={workspace.selectedSpaceId}
      onSpaceChange={workspace.selectSpace}
      onSpaceUnavailable={() => void workspace.refresh()}
    /> : activeDestination === 'wallets' ? <Suspense fallback={<div className="state-panel" role="status">{props.locale === 'ar' ? 'جارٍ تحميل المحافظ…' : 'Loading Wallets…'}</div>}><WalletsPage
      gateway={props.walletsGateway}
      categoriesGateway={props.categoriesGateway}
      locale={props.locale}
      spaceId={workspace.selectedSpaceId}
      onSpaceUnavailable={() => void workspace.refresh()}
      onOpenLoans={() => setActiveDestination('loans')}
    /></Suspense> : <Suspense fallback={<div className="state-panel" role="status">{props.locale === 'ar' ? 'جارٍ تحميل الفئات…' : 'Loading Categories…'}</div>}><CategoriesPage
      gateway={props.categoriesGateway}
      locale={props.locale}
      spaceId={workspace.selectedSpaceId}
      onSpaceUnavailable={() => void workspace.refresh()}
    /></Suspense>}
  </ApplicationShell>;
}

function ConfiguredApp({ authGateway, categoriesGateway, loansGateway, walletsGateway, workspaceGateway }: Required<AppProps>) {
  const auth = useAuthSession(authGateway);
  const [locale, setLocale] = useState<Locale>('en');

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);

  if (auth.status === 'loading') {
    return <main className="auth-page"><div className="auth-loading" role="status">Checking your session…</div></main>;
  }

  if (auth.status !== 'authenticated' || !auth.user) {
    return <AuthScreen
      locale={locale}
      state={auth.status === 'confirmation-required' ? 'confirmation-required' : auth.status === 'expired' ? 'expired' : 'signed-out'}
      confirmationEmail={auth.confirmationEmail}
      error={auth.error}
      pending={auth.pending}
      onLocaleChange={() => setLocale((current) => current === 'en' ? 'ar' : 'en')}
      onSignIn={auth.signIn}
      onSignUp={auth.signUp}
    />;
  }

  return <AuthenticatedWorkspace
    key={auth.user.id}
    userId={auth.user.id}
    userEmail={auth.user.email}
    locale={locale}
    workspaceGateway={workspaceGateway}
    categoriesGateway={categoriesGateway}
    loansGateway={loansGateway}
    walletsGateway={walletsGateway}
    onLocaleChange={() => setLocale((current) => current === 'en' ? 'ar' : 'en')}
    onSignOut={() => void auth.signOut()}
  />;
}

export function App({ authGateway, categoriesGateway, loansGateway, walletsGateway, workspaceGateway }: AppProps = {}) {
  const client = useMemo(() => createBrowserDataClient(), []);
  const activeAuthGateway = useMemo(() => authGateway ?? (client ? createSupabaseAuthGateway(client) : null), [authGateway, client]);
  const activeCategoriesGateway = useMemo(() => categoriesGateway ?? (client ? createSupabaseCategoriesGateway(client) : null), [categoriesGateway, client]);
  const activeLoansGateway = useMemo(() => loansGateway ?? (client ? createSupabaseLoansGateway(client) : null), [loansGateway, client]);
  const activeWalletsGateway = useMemo(() => walletsGateway ?? (client ? createSupabaseWalletsGateway(client) : null), [walletsGateway, client]);
  const activeWorkspaceGateway = useMemo(() => workspaceGateway ?? (client ? createSupabaseWorkspaceGateway(client) : null), [workspaceGateway, client]);

  if (!activeAuthGateway || !activeCategoriesGateway || !activeLoansGateway || !activeWalletsGateway || !activeWorkspaceGateway) {
    return <main className="configuration-page"><section><span className="brand">Budget ledger</span><h1>Configuration needed</h1><p>Connect this browser to the dedicated Budget development stack before continuing.</p></section></main>;
  }

  return <ConfiguredApp authGateway={activeAuthGateway} categoriesGateway={activeCategoriesGateway} loansGateway={activeLoansGateway} walletsGateway={activeWalletsGateway} workspaceGateway={activeWorkspaceGateway} />;
}
