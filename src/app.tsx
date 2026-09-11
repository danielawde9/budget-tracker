import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { AuthScreen } from './features/auth/auth-screen.js';
import { createSupabaseAuthGateway } from './features/auth/supabase-auth-gateway.js';
import type { AuthGateway } from './features/auth/types.js';
import { useAuthSession } from './features/auth/use-auth-session.js';
import { createSupabaseCategoriesGateway } from './features/categories/supabase-categories-gateway.js';
import type { CategoriesGateway } from './features/categories/types.js';
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
import { createSupabaseHouseholdGateway } from './features/household/supabase-household-gateway.js';
import type { HouseholdGateway } from './features/household/types.js';
import { AcceptHouseholdInvitationDialog } from './features/household/household-dialogs.js';
import { classifyHouseholdError, localizeHouseholdError, type HouseholdErrorView } from './features/household/errors.js';
import type { HouseholdInvitationBootstrap } from './features/household/invitation-fragment.js';

const WalletsPage = lazy(async () => {
  const module = await import('./features/wallets/wallets-page.js');
  return { default: module.WalletsPage };
});

const LoansPage = lazy(async () => {
  const module = await import('./features/loans/loans-page.js');
  return { default: module.LoansPage };
});

const CategoriesPage = lazy(async () => {
  const module = await import('./features/categories/categories-page.js');
  return { default: module.CategoriesPage };
});

const HouseholdPage = lazy(async () => {
  const module = await import('./features/household/household-page.js');
  return { default: module.HouseholdPage };
});

interface AppProps {
  householdInvitationBootstrap?: HouseholdInvitationBootstrap | null;
  authGateway?: AuthGateway;
  categoriesGateway?: CategoriesGateway;
  householdGateway?: HouseholdGateway;
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
  householdGateway: HouseholdGateway;
  householdInvitationToken: string | null;
  loansGateway: LoansGateway;
  walletsGateway: WalletsGateway;
  onLocaleChange(): void;
  onHouseholdInvitationConsumed(): void;
  onSignOut(): void;
}

function AuthenticatedWorkspace(props: AuthenticatedWorkspaceProps) {
  const workspace = useWorkspace(props.workspaceGateway, props.userId);
  const [activeDestination, setActiveDestination] = useState<ApplicationDestination>('loans');
  const [addingSpace, setAddingSpace] = useState(false);
  const [acceptPending, setAcceptPending] = useState(false);
  const [acceptError, setAcceptError] = useState<HouseholdErrorView | null>(null);
  const [terminalAcceptance, setTerminalAcceptance] = useState(false);
  const acceptRequestId = useState(() => crypto.randomUUID())[0];

  useEffect(() => {
    if (activeDestination === 'household' && workspace.selectedSpace?.kind !== 'household') {
      setActiveDestination('loans');
    }
  }, [activeDestination, workspace.selectedSpace?.kind]);

  const showAcceptance = props.householdInvitationToken !== null || terminalAcceptance;
  if (showAcceptance) {
    const localized = acceptError ? localizeHouseholdError(acceptError, props.locale) : null;
    return <AcceptHouseholdInvitationDialog
      locale={props.locale}
      pending={acceptPending}
      terminal={terminalAcceptance}
      error={localized ? <div className="error-notice" role="alert"><strong>{localized.message}</strong><p>{localized.recovery}</p></div> : null}
      onDismiss={() => {
        props.onHouseholdInvitationConsumed();
        setTerminalAcceptance(false);
        setAcceptError(null);
      }}
      onAccept={async () => {
        const token = props.householdInvitationToken;
        if (!token || acceptPending) return;
        setAcceptPending(true);
        setAcceptError(null);
        try {
          const result = await props.householdGateway.acceptInvitation({ requestId: acceptRequestId, token });
          props.onHouseholdInvitationConsumed();
          await workspace.refresh(result.spaceId);
        } catch (cause) {
          const error = classifyHouseholdError(cause);
          setAcceptError(error);
          if (error.kind === 'invitation-unavailable' || error.kind === 'access-lost' || error.kind === 'invalid-input') {
            props.onHouseholdInvitationConsumed();
            setTerminalAcceptance(true);
          }
        } finally {
          setAcceptPending(false);
        }
      }}
    />;
  }

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

  return <>
    {addingSpace ? <OnboardingDialog
      locale={props.locale}
      mode="additional"
      createSpace={workspace.createFirstSpace}
      createWallet={workspace.createFirstWallet}
      onComplete={(spaceId) => {
        setAddingSpace(false);
        void workspace.refresh(spaceId);
      }}
    /> : null}
    <ApplicationShell
      locale={props.locale}
      userEmail={props.userEmail}
      spaces={workspace.spaces}
      selectedSpace={workspace.selectedSpace}
      activeDestination={activeDestination}
      onDestinationChange={setActiveDestination}
      onSpaceChange={workspace.selectSpace}
      onAddSpace={() => setAddingSpace(true)}
      onLocaleChange={props.onLocaleChange}
      onSignOut={props.onSignOut}
    >
    {activeDestination === 'loans' ? <Suspense fallback={<div className="state-panel" role="status">{props.locale === 'ar' ? 'جارٍ تحميل القروض…' : 'Loading Loans…'}</div>}><LoansPage
      embedded
      gateway={props.loansGateway}
      locale={props.locale}
      spaces={workspace.spaces}
      spaceId={workspace.selectedSpaceId}
      onSpaceChange={workspace.selectSpace}
      onSpaceUnavailable={() => void workspace.refresh()}
    /></Suspense> : activeDestination === 'wallets' ? <Suspense fallback={<div className="state-panel" role="status">{props.locale === 'ar' ? 'جارٍ تحميل المحافظ…' : 'Loading Wallets…'}</div>}><WalletsPage
      gateway={props.walletsGateway}
      categoriesGateway={props.categoriesGateway}
      locale={props.locale}
      spaceId={workspace.selectedSpaceId}
      onSpaceUnavailable={() => void workspace.refresh()}
      onOpenLoans={() => setActiveDestination('loans')}
    /></Suspense> : activeDestination === 'categories' ? <Suspense fallback={<div className="state-panel" role="status">{props.locale === 'ar' ? 'جارٍ تحميل الفئات…' : 'Loading Categories…'}</div>}><CategoriesPage
      gateway={props.categoriesGateway}
      locale={props.locale}
      spaceId={workspace.selectedSpaceId}
      onSpaceUnavailable={() => void workspace.refresh()}
    /></Suspense> : <Suspense fallback={<div className="state-panel" role="status">{props.locale === 'ar' ? 'جارٍ تحميل الأسرة…' : 'Loading Household…'}</div>}><HouseholdPage
      gateway={props.householdGateway}
      locale={props.locale}
      spaceId={workspace.selectedSpaceId}
      spaceName={workspace.selectedSpace.name}
      userId={props.userId}
      onSpaceUnavailable={() => void workspace.refresh()}
    /></Suspense>}
    </ApplicationShell>
  </>;
}

interface ConfiguredAppProps extends Omit<Required<AppProps>, 'householdInvitationBootstrap'> {
  readonly householdInvitationBootstrap: HouseholdInvitationBootstrap | null;
}

function ConfiguredApp({ authGateway, categoriesGateway, householdGateway, householdInvitationBootstrap, loansGateway, walletsGateway, workspaceGateway }: ConfiguredAppProps) {
  const auth = useAuthSession(authGateway);
  const [locale, setLocale] = useState<Locale>('en');
  const [householdInvitationToken, setHouseholdInvitationToken] = useState(() => householdInvitationBootstrap?.take() ?? null);

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
      onBack={auth.dismissConfirmation}
      onResendConfirmation={auth.resendConfirmation}
    />;
  }

  return <AuthenticatedWorkspace
    key={auth.user.id}
    userId={auth.user.id}
    userEmail={auth.user.email}
    locale={locale}
    workspaceGateway={workspaceGateway}
    categoriesGateway={categoriesGateway}
    householdGateway={householdGateway}
    householdInvitationToken={householdInvitationToken}
    loansGateway={loansGateway}
    walletsGateway={walletsGateway}
    onLocaleChange={() => setLocale((current) => current === 'en' ? 'ar' : 'en')}
    onHouseholdInvitationConsumed={() => setHouseholdInvitationToken(null)}
    onSignOut={() => void auth.signOut()}
  />;
}

export function App({ householdInvitationBootstrap = null, authGateway, categoriesGateway, householdGateway, loansGateway, walletsGateway, workspaceGateway }: AppProps = {}) {
  const client = useMemo(() => createBrowserDataClient(), []);
  const activeAuthGateway = useMemo(() => authGateway ?? (client ? createSupabaseAuthGateway(client) : null), [authGateway, client]);
  const activeCategoriesGateway = useMemo(() => categoriesGateway ?? (client ? createSupabaseCategoriesGateway(client) : null), [categoriesGateway, client]);
  const activeHouseholdGateway = useMemo(() => householdGateway ?? (client ? createSupabaseHouseholdGateway(client) : null), [householdGateway, client]);
  const activeLoansGateway = useMemo(() => loansGateway ?? (client ? createSupabaseLoansGateway(client) : null), [loansGateway, client]);
  const activeWalletsGateway = useMemo(() => walletsGateway ?? (client ? createSupabaseWalletsGateway(client) : null), [walletsGateway, client]);
  const activeWorkspaceGateway = useMemo(() => workspaceGateway ?? (client ? createSupabaseWorkspaceGateway(client) : null), [workspaceGateway, client]);

  if (!activeAuthGateway || !activeCategoriesGateway || !activeHouseholdGateway || !activeLoansGateway || !activeWalletsGateway || !activeWorkspaceGateway) {
    return <main className="configuration-page"><section><span className="brand">Budget ledger</span><h1>Configuration needed</h1><p>Connect this browser to the dedicated Budget development stack before continuing.</p></section></main>;
  }

  return <ConfiguredApp householdInvitationBootstrap={householdInvitationBootstrap} authGateway={activeAuthGateway} categoriesGateway={activeCategoriesGateway} householdGateway={activeHouseholdGateway} loansGateway={activeLoansGateway} walletsGateway={activeWalletsGateway} workspaceGateway={activeWorkspaceGateway} />;
}
