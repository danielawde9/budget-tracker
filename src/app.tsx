import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { WorkspaceRoutes } from './features/home/workspace-routes.js';
import { createSupabaseReportsGateway } from './features/reports/supabase-reports-gateway.js';
import type { ReportsGateway } from './features/reports/types.js';

const unavailableReportsGateway: ReportsGateway = {
  async loadMonthlyComparison() { throw new Error('Reports are unavailable until this browser is connected to its data service.'); },
};

interface AppProps {
  householdInvitationBootstrap?: HouseholdInvitationBootstrap | null;
  authGateway?: AuthGateway;
  categoriesGateway?: CategoriesGateway;
  householdGateway?: HouseholdGateway;
  loansGateway?: LoansGateway;
  walletsGateway?: WalletsGateway;
  reportsGateway?: ReportsGateway;
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
  reportsGateway: ReportsGateway;
  onLocaleChange(): void;
  onHouseholdInvitationConsumed(): void;
  onSignOut(): void;
}

function AuthenticatedWorkspace(props: AuthenticatedWorkspaceProps) {
  const workspace = useWorkspace(props.workspaceGateway, props.userId);
  const [activeDestination, setActiveDestination] = useState<ApplicationDestination>('home');
  const [openTransaction, setOpenTransaction] = useState(false);
  const [addingSpace, setAddingSpace] = useState(false);
  const [acceptPending, setAcceptPending] = useState(false);
  const [acceptError, setAcceptError] = useState<HouseholdErrorView | null>(null);
  const [terminalAcceptance, setTerminalAcceptance] = useState(false);
  const acceptRequestId = useState(() => crypto.randomUUID())[0];
  const onSpaceUnavailable = useCallback(() => { void workspace.refresh(); }, [workspace.refresh]);

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
    <WorkspaceRoutes
      activeDestination={activeDestination}
      categoriesGateway={props.categoriesGateway}
      householdGateway={props.householdGateway}
      loansGateway={props.loansGateway}
      walletsGateway={props.walletsGateway}
      reportsGateway={props.reportsGateway}
      locale={props.locale}
      spaceId={workspace.selectedSpaceId}
      spaceName={workspace.selectedSpace.name}
      spaces={workspace.spaces}
      userId={props.userId}
      openTransaction={openTransaction}
      onDestinationChange={setActiveDestination}
      onSpaceChange={workspace.selectSpace}
      onSpaceUnavailable={onSpaceUnavailable}
      onRecordTransaction={() => setOpenTransaction(true)}
      onTransactionDialogOpened={() => setOpenTransaction(false)}
    />
    </ApplicationShell>
  </>;
}

interface ConfiguredAppProps extends Omit<Required<AppProps>, 'householdInvitationBootstrap'> {
  readonly householdInvitationBootstrap: HouseholdInvitationBootstrap | null;
}

function ConfiguredApp({ authGateway, categoriesGateway, householdGateway, householdInvitationBootstrap, loansGateway, walletsGateway, reportsGateway, workspaceGateway }: ConfiguredAppProps) {
  const auth = useAuthSession(authGateway);
  const [locale, setLocale] = useState<Locale>('en');
  const [householdInvitationToken, setHouseholdInvitationToken] = useState(() => householdInvitationBootstrap?.take() ?? null);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);

  if (auth.status === 'loading') {
    return <main className="workspace-state-page auth-page"><div className="state-panel auth-loading" role="status">Checking your session…</div></main>;
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
    reportsGateway={reportsGateway}
    onLocaleChange={() => setLocale((current) => current === 'en' ? 'ar' : 'en')}
    onHouseholdInvitationConsumed={() => setHouseholdInvitationToken(null)}
    onSignOut={() => void auth.signOut()}
  />;
}

export function App({ householdInvitationBootstrap = null, authGateway, categoriesGateway, householdGateway, loansGateway, walletsGateway, reportsGateway, workspaceGateway }: AppProps = {}) {
  const client = useMemo(() => createBrowserDataClient(), []);
  const activeAuthGateway = useMemo(() => authGateway ?? (client ? createSupabaseAuthGateway(client) : null), [authGateway, client]);
  const activeCategoriesGateway = useMemo(() => categoriesGateway ?? (client ? createSupabaseCategoriesGateway(client) : null), [categoriesGateway, client]);
  const activeHouseholdGateway = useMemo(() => householdGateway ?? (client ? createSupabaseHouseholdGateway(client) : null), [householdGateway, client]);
  const activeLoansGateway = useMemo(() => loansGateway ?? (client ? createSupabaseLoansGateway(client) : null), [loansGateway, client]);
  const activeWalletsGateway = useMemo(() => walletsGateway ?? (client ? createSupabaseWalletsGateway(client) : null), [walletsGateway, client]);
  const activeReportsGateway = useMemo(() => reportsGateway ?? (client ? createSupabaseReportsGateway(client) : unavailableReportsGateway), [reportsGateway, client]);
  const activeWorkspaceGateway = useMemo(() => workspaceGateway ?? (client ? createSupabaseWorkspaceGateway(client) : null), [workspaceGateway, client]);

  if (!activeAuthGateway || !activeCategoriesGateway || !activeHouseholdGateway || !activeLoansGateway || !activeWalletsGateway || !activeWorkspaceGateway) {
    return <main className="workspace-state-page configuration-page"><section className="state-panel"><span className="brand">Budget ledger</span><h1>Configuration needed</h1><p>This installation needs its data service before the financial workspace can open.</p><details className="configuration-detail"><summary>Operator setup details</summary><p>Connect this browser to the dedicated Budget development stack before continuing.</p></details></section></main>;
  }

  return <ConfiguredApp householdInvitationBootstrap={householdInvitationBootstrap} authGateway={activeAuthGateway} categoriesGateway={activeCategoriesGateway} householdGateway={activeHouseholdGateway} loansGateway={activeLoansGateway} walletsGateway={activeWalletsGateway} reportsGateway={activeReportsGateway} workspaceGateway={activeWorkspaceGateway} />;
}
