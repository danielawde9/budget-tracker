import { useEffect, useMemo, useState } from 'react';
import { AuthScreen } from './features/auth/auth-screen.js';
import { createSupabaseAuthGateway } from './features/auth/supabase-auth-gateway.js';
import type { AuthGateway } from './features/auth/types.js';
import { useAuthSession } from './features/auth/use-auth-session.js';
import { createSupabaseCategoriesGateway } from './features/categories/supabase-categories-gateway.js';
import type { CategoriesGateway } from './features/categories/types.js';
import { ControlRoomShell } from './features/control-room/control-room-shell.js';
import { ControlRoomRoutes } from './features/control-room/routes.js';
import type { ControlRoomDestination } from './features/control-room/types.js';
import { createExchangeClient } from './features/exchange/exchange-client.js';
import type { ExchangeClient } from './features/exchange/types.js';
import { createInsightsClient } from './features/insights/insights-client.js';
import type { InsightsClient } from './features/insights/types.js';
import { createSupabaseLoansGateway } from './features/loans/supabase-loans-gateway.js';
import type { LoansGateway, Locale } from './features/loans/types.js';
import { createPlanClient } from './features/plan/plan-client.js';
import type { PlanClient } from './features/plan/types.js';
import { SpaceSwitcher } from './features/shell/space-switcher.js';
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
  planClient?: PlanClient;
  insightsClient?: InsightsClient;
  exchangeClient?: ExchangeClient;
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
  planClient: PlanClient | null;
  insightsClient: InsightsClient | null;
  exchangeClient: ExchangeClient | null;
  onLocaleChange(): void;
  onHouseholdInvitationConsumed(): void;
  onSignOut(): void;
}

function AuthenticatedWorkspace(props: AuthenticatedWorkspaceProps) {
  const workspace = useWorkspace(props.workspaceGateway, props.userId);
  const [activeDestination, setActiveDestination] = useState<ControlRoomDestination>('home');
  const [recordOpen, setRecordOpen] = useState(false);
  const [addingSpace, setAddingSpace] = useState(false);
  const [acceptPending, setAcceptPending] = useState(false);
  const [acceptError, setAcceptError] = useState<HouseholdErrorView | null>(null);
  const [terminalAcceptance, setTerminalAcceptance] = useState(false);
  const acceptRequestId = useState(() => crypto.randomUUID())[0];

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
    <ControlRoomShell
      locale={props.locale}
      userEmail={props.userEmail}
      activeDestination={activeDestination}
      onDestinationChange={setActiveDestination}
      onLocaleChange={props.onLocaleChange}
      onSignOut={props.onSignOut}
      onRecord={() => setRecordOpen(true)}
      spaceControls={
        <SpaceSwitcher
          locale={props.locale}
          spaces={workspace.spaces}
          selectedSpace={workspace.selectedSpace}
          onSpaceChange={workspace.selectSpace}
          onAddSpace={() => setAddingSpace(true)}
        />
      }
    >
    <ControlRoomRoutes
      locale={props.locale}
      spaceId={workspace.selectedSpaceId}
      spaceKind={workspace.selectedSpace.kind}
      destination={activeDestination}
      gateways={{ wallets: props.walletsGateway, loans: props.loansGateway, categories: props.categoriesGateway, reports: props.reportsGateway, household: props.householdGateway, plan: props.planClient, insights: props.insightsClient, exchange: props.exchangeClient }}
      recordOpen={recordOpen}
      onCloseRecord={() => setRecordOpen(false)}
      onSpaceUnavailable={() => void workspace.refresh()}
    />
    </ControlRoomShell>
  </>;
}

interface ConfiguredAppProps extends Omit<Required<AppProps>, 'householdInvitationBootstrap' | 'planClient' | 'insightsClient' | 'exchangeClient'> {
  readonly householdInvitationBootstrap: HouseholdInvitationBootstrap | null;
  readonly planClient: PlanClient | null;
  readonly insightsClient: InsightsClient | null;
  readonly exchangeClient: ExchangeClient | null;
}

function ConfiguredApp({ authGateway, categoriesGateway, householdGateway, householdInvitationBootstrap, loansGateway, walletsGateway, reportsGateway, workspaceGateway, planClient, insightsClient, exchangeClient }: ConfiguredAppProps) {
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
    planClient={planClient}
    insightsClient={insightsClient}
    exchangeClient={exchangeClient}
    onLocaleChange={() => setLocale((current) => current === 'en' ? 'ar' : 'en')}
    onHouseholdInvitationConsumed={() => setHouseholdInvitationToken(null)}
    onSignOut={() => void auth.signOut()}
  />;
}

export function App({ householdInvitationBootstrap = null, authGateway, categoriesGateway, householdGateway, loansGateway, walletsGateway, reportsGateway, workspaceGateway, planClient, insightsClient, exchangeClient }: AppProps = {}) {
  const client = useMemo(() => createBrowserDataClient(), []);
  const activeAuthGateway = useMemo(() => authGateway ?? (client ? createSupabaseAuthGateway(client) : null), [authGateway, client]);
  const activeCategoriesGateway = useMemo(() => categoriesGateway ?? (client ? createSupabaseCategoriesGateway(client) : null), [categoriesGateway, client]);
  const activeHouseholdGateway = useMemo(() => householdGateway ?? (client ? createSupabaseHouseholdGateway(client) : null), [householdGateway, client]);
  const activeLoansGateway = useMemo(() => loansGateway ?? (client ? createSupabaseLoansGateway(client) : null), [loansGateway, client]);
  const activeWalletsGateway = useMemo(() => walletsGateway ?? (client ? createSupabaseWalletsGateway(client) : null), [walletsGateway, client]);
  const activeReportsGateway = useMemo(() => reportsGateway ?? (client ? createSupabaseReportsGateway(client) : unavailableReportsGateway), [reportsGateway, client]);
  const activeWorkspaceGateway = useMemo(() => workspaceGateway ?? (client ? createSupabaseWorkspaceGateway(client) : null), [workspaceGateway, client]);
  const activePlanClient = useMemo(() => planClient ?? (client ? createPlanClient(client) : null), [planClient, client]);
  const activeInsightsClient = useMemo(() => insightsClient ?? (client ? createInsightsClient(client) : null), [insightsClient, client]);
  const activeExchangeClient = useMemo(() => exchangeClient ?? (client ? createExchangeClient(client) : null), [exchangeClient, client]);

  if (!activeAuthGateway || !activeCategoriesGateway || !activeHouseholdGateway || !activeLoansGateway || !activeWalletsGateway || !activeWorkspaceGateway) {
    return <main className="workspace-state-page configuration-page"><section className="state-panel"><span className="brand">Budget ledger</span><h1>Configuration needed</h1><p>This installation needs its data service before the financial workspace can open.</p><details className="configuration-detail"><summary>Operator setup details</summary><p>Connect this browser to the dedicated Budget development stack before continuing.</p></details></section></main>;
  }

  return <ConfiguredApp householdInvitationBootstrap={householdInvitationBootstrap} authGateway={activeAuthGateway} categoriesGateway={activeCategoriesGateway} householdGateway={activeHouseholdGateway} loansGateway={activeLoansGateway} walletsGateway={activeWalletsGateway} reportsGateway={activeReportsGateway} workspaceGateway={activeWorkspaceGateway} planClient={activePlanClient} insightsClient={activeInsightsClient} exchangeClient={activeExchangeClient} />;
}
