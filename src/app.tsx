import { useEffect, useMemo, useState } from 'react';
import { AuthScreen } from './features/auth/auth-screen.js';
import { createSupabaseAuthGateway } from './features/auth/supabase-auth-gateway.js';
import type { AuthGateway } from './features/auth/types.js';
import { useAuthSession } from './features/auth/use-auth-session.js';
import { LoansPage } from './features/loans/loans-page.js';
import { createSupabaseLoansGateway } from './features/loans/supabase-loans-gateway.js';
import type { LoansGateway, Locale } from './features/loans/types.js';
import { ApplicationShell } from './features/shell/application-shell.js';
import { OnboardingDialog } from './features/workspace/onboarding-dialog.js';
import { createSupabaseWorkspaceGateway } from './features/workspace/supabase-workspace-gateway.js';
import type { WorkspaceGateway } from './features/workspace/types.js';
import { useWorkspace } from './features/workspace/use-workspace.js';
import { createBrowserDataClient } from './lib/supabase.js';

interface AppProps {
  authGateway?: AuthGateway;
  loansGateway?: LoansGateway;
  workspaceGateway?: WorkspaceGateway;
}

interface AuthenticatedWorkspaceProps {
  userId: string;
  userEmail: string | null;
  locale: Locale;
  workspaceGateway: WorkspaceGateway;
  loansGateway: LoansGateway;
  onLocaleChange(): void;
  onSignOut(): void;
}

function AuthenticatedWorkspace(props: AuthenticatedWorkspaceProps) {
  const workspace = useWorkspace(props.workspaceGateway, props.userId);

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
    onSpaceChange={workspace.selectSpace}
    onLocaleChange={props.onLocaleChange}
    onSignOut={props.onSignOut}
  >
    <LoansPage
      embedded
      gateway={props.loansGateway}
      locale={props.locale}
      spaces={workspace.spaces}
      spaceId={workspace.selectedSpaceId}
      onSpaceChange={workspace.selectSpace}
      onSpaceUnavailable={() => void workspace.refresh()}
    />
  </ApplicationShell>;
}

function ConfiguredApp({ authGateway, loansGateway, workspaceGateway }: Required<AppProps>) {
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
    loansGateway={loansGateway}
    onLocaleChange={() => setLocale((current) => current === 'en' ? 'ar' : 'en')}
    onSignOut={() => void auth.signOut()}
  />;
}

export function App({ authGateway, loansGateway, workspaceGateway }: AppProps = {}) {
  const client = useMemo(() => createBrowserDataClient(), []);
  const activeAuthGateway = useMemo(() => authGateway ?? (client ? createSupabaseAuthGateway(client) : null), [authGateway, client]);
  const activeLoansGateway = useMemo(() => loansGateway ?? (client ? createSupabaseLoansGateway(client) : null), [loansGateway, client]);
  const activeWorkspaceGateway = useMemo(() => workspaceGateway ?? (client ? createSupabaseWorkspaceGateway(client) : null), [workspaceGateway, client]);

  if (!activeAuthGateway || !activeLoansGateway || !activeWorkspaceGateway) {
    return <main className="configuration-page"><section><span className="brand">Budget ledger</span><h1>Configuration needed</h1><p>Connect this browser to the dedicated Budget development stack before continuing.</p></section></main>;
  }

  return <ConfiguredApp authGateway={activeAuthGateway} loansGateway={activeLoansGateway} workspaceGateway={activeWorkspaceGateway} />;
}
