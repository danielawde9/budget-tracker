import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSupabaseAllocationGateway } from './features/allocation/supabase-allocation-gateway.js';
import type { AllocationGateway } from './features/allocation/types.js';
import { AuthScreen } from './features/auth/auth-screen.js';
import { createSupabaseCashControlGateway } from './features/cash-control/supabase-cash-control-gateway.js';
import type { CashControlGateway } from './features/cash-control/types.js';
import { createSupabaseAuthGateway } from './features/auth/supabase-auth-gateway.js';
import type { AuthGateway } from './features/auth/types.js';
import { useAuthSession } from './features/auth/use-auth-session.js';
import { createSupabaseCategoriesGateway } from './features/categories/supabase-categories-gateway.js';
import type { CategoriesGateway } from './features/categories/types.js';
import { createSupabaseGoalsGateway } from './features/goals/supabase-goals-gateway.js';
import type { GoalsGateway } from './features/goals/types.js';
import { createSupabaseRecurringGateway } from './features/recurring/supabase-recurring-gateway.js';
import type { RecurringGateway } from './features/recurring/types.js';
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
import { hrefWithoutQuickAdd, readQuickAddIntent, type QuickAddKind } from './features/quick-add/quick-add.js';
import { SpaceSwitcher } from './features/shell/space-switcher.js';
import { OnboardingDialog } from './features/workspace/onboarding-dialog.js';
import { createSupabaseWorkspaceGateway } from './features/workspace/supabase-workspace-gateway.js';
import type { WorkspaceGateway } from './features/workspace/types.js';
import { useWorkspace } from './features/workspace/use-workspace.js';
import { WelcomeTourDialog, type WelcomeTarget } from './features/workspace/welcome-tour.js';
import { createSupabaseWalletsGateway } from './features/wallets/supabase-wallets-gateway.js';
import type { WalletsGateway } from './features/wallets/types.js';
import { createBrowserDataClient, readBrowserAccessToken } from './lib/supabase.js';
import { createSupabaseHouseholdGateway } from './features/household/supabase-household-gateway.js';
import { createDeliveringHouseholdGateway } from './features/household/delivering-household-gateway.js';
import { createHttpInvitationDelivery } from './features/household/invitation-delivery.js';
import type { HouseholdGateway } from './features/household/types.js';
import { AcceptHouseholdInvitationDialog } from './features/household/household-dialogs.js';
import { classifyHouseholdError, localizeHouseholdError, type HouseholdErrorView } from './features/household/errors.js';
import type { HouseholdInvitationBootstrap } from './features/household/invitation-fragment.js';
import { createSupabaseReportsGateway } from './features/reports/supabase-reports-gateway.js';
import type { ReportsGateway } from './features/reports/types.js';
import { WorkspaceSkeleton } from './features/control-room/skeletons.js';

const LOCALE_STORAGE_KEY = 'budget:locale';

function readStoredLocale(): Locale {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY) === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage can be unavailable; the in-memory choice still applies.
  }
}

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
  allocationGateway?: AllocationGateway;
  goalsGateway?: GoalsGateway;
  recurringGateway?: RecurringGateway;
  cashControlGateway?: CashControlGateway;
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
  allocationGateway: AllocationGateway | null;
  goalsGateway: GoalsGateway | null;
  recurringGateway: RecurringGateway | null;
  cashControlGateway: CashControlGateway | null;
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

  // Stable across every render of this component -- `workspace.refresh` is
  // itself referentially stable (useWorkspace's own `load`/`refresh`
  // useCallbacks only depend on `gateway`/`storageKey`, and `gateway` is
  // memoized once at the top-level App). Without this useCallback, a fresh
  // closure was created here on every render (e.g. opening/closing the
  // record dialog toggles state in this same component), which sits
  // unchanged-looking but reference-unequal in the dependency array of
  // every downstream hook's mount effect it reaches
  // (use-cash-control.ts/use-recurring.ts/use-wallets.ts/use-goals.ts/
  // use-allocation.ts, via ControlRoomRoutes' unwrapped prop passthrough) --
  // re-running all of them, including useCashReadSlice's `run`, which
  // unconditionally blanks its view back to a loading skeleton at the start
  // of every run. That is the exact jitter class commit 5a5ee32 fixed
  // elsewhere in this release; see docs/decisions.md, "final review fix
  // wave" entry, finding 3.
  const onSpaceUnavailable = useCallback(() => { void workspace.refresh(); }, [workspace.refresh]);

  const showAcceptance = props.householdInvitationToken !== null || terminalAcceptance;

  // A quick-add link (`/?add=expense`, from an installed-app shortcut or a
  // phone Shortcuts action) opens the record sheet on that kind once a
  // space is ready, then drops the parameter so a reload doesn't reopen it.
  const [pendingQuickAdd, setPendingQuickAdd] = useState<QuickAddKind | null>(() => readQuickAddIntent(window.location.search));
  // A quick-add link owns this app open: the tour waits for the next one.
  const [tourSuppressed, setTourSuppressed] = useState(() => pendingQuickAdd !== null);
  // One-shot deep link for the tour's Try it (goals / household).
  const [pendingSection, setPendingSection] = useState<'goals' | 'household' | null>(null);
  const navigateTo = useCallback((destination: ControlRoomDestination) => {
    setActiveDestination(destination);
    setPendingSection(null);
  }, []);
  const onWelcomeTryIt = useCallback((target: WelcomeTarget) => {
    workspace.dismissWelcome();
    if (target === 'record') {
      setRecordInitialKind('expense');
      setRecordOpen(true);
      return;
    }
    if (target === 'reports') {
      navigateTo('home');
      return;
    }
    // navigateTo clears first; the section is set after, in the same batch.
    navigateTo(target === 'goals' ? 'plan' : 'manage');
    setPendingSection(target);
  }, [navigateTo, workspace.dismissWelcome]);
  const [recordInitialKind, setRecordInitialKind] = useState<QuickAddKind | null>(null);
  const workspaceReady = workspace.status === 'ready' && workspace.selectedSpace !== null && !showAcceptance;
  useEffect(() => {
    if (pendingQuickAdd === null || !workspaceReady) return;
    setRecordInitialKind(pendingQuickAdd);
    setRecordOpen(true);
    setPendingQuickAdd(null);
    window.history.replaceState(window.history.state, '', hrefWithoutQuickAdd(window.location.href));
  }, [pendingQuickAdd, workspaceReady]);
  const openRecord = useCallback(() => {
    setRecordInitialKind(null);
    setRecordOpen(true);
  }, []);
  const closeRecord = useCallback(() => {
    setRecordOpen(false);
    setRecordInitialKind(null);
  }, []);
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
    return <main className="workspace-state-page"><WorkspaceSkeleton locale={props.locale} /></main>;
  }
  if (workspace.status === 'error') {
    return <main className="workspace-state-page"><section className="state-panel error-notice" role="alert"><strong>Spaces are unavailable</strong><p>{workspace.error}</p><button type="button" onClick={() => void workspace.refresh()}>Try again</button></section></main>;
  }
  if (workspace.status === 'empty' || workspace.status === 'onboarding') {
    return <OnboardingDialog
      locale={props.locale}
      setup={workspace.onboardingSetup}
      createSpace={workspace.createFirstSpace}
      createWallet={workspace.createFirstWallet}
      onProgress={workspace.saveOnboardingProgress}
      recordOpeningBalance={async (input) => {
        await props.walletsGateway.recordEvent({
          spaceId: input.spaceId,
          requestId: input.requestId,
          kind: 'opening_balance',
          effectiveDate: new Date().toISOString().slice(0, 10),
          movements: [{ walletId: input.walletId, amountMinor: input.amountMinor }],
        });
      }}
      onComplete={(spaceId) => { void workspace.finishOnboarding(spaceId); }}
    />;
  }
  if (!workspace.selectedSpace) return null;

  return <>
    {addingSpace ? <OnboardingDialog
      locale={props.locale}
      mode="additional"
      createSpace={workspace.createFirstSpace}
      createWallet={workspace.createFirstWallet}
      onClose={() => setAddingSpace(false)}
      onComplete={(spaceId) => {
        setAddingSpace(false);
        void workspace.refresh(spaceId);
      }}
    /> : null}
    {workspace.showWelcome && !tourSuppressed ? (
      <WelcomeTourDialog
        locale={props.locale}
        onDismiss={workspace.dismissWelcome}
        onTryIt={onWelcomeTryIt}
      />
    ) : null}
    <ControlRoomShell
      locale={props.locale}
      userEmail={props.userEmail}
      activeDestination={activeDestination}
      onDestinationChange={setActiveDestination}
      onLocaleChange={props.onLocaleChange}
      onSignOut={props.onSignOut}
      onRecord={openRecord}
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
      onDestinationChange={navigateTo}
      pendingSection={pendingSection}
      onPendingSectionConsumed={() => setPendingSection(null)}
      onReplayWelcome={() => {
        setTourSuppressed(false);
        workspace.replayWelcome();
      }}
      gateways={{ wallets: props.walletsGateway, loans: props.loansGateway, categories: props.categoriesGateway, reports: props.reportsGateway, household: props.householdGateway, plan: props.planClient, insights: props.insightsClient, exchange: props.exchangeClient, allocation: props.allocationGateway, goals: props.goalsGateway, recurring: props.recurringGateway, cashControl: props.cashControlGateway }}
      recordOpen={recordOpen}
      recordInitialKind={recordInitialKind}
      onCloseRecord={closeRecord}
      onSpaceUnavailable={onSpaceUnavailable}
      onOpenRecord={openRecord}
      userId={props.userId}
      spaceName={workspace.selectedSpace.name}
      userEmail={props.userEmail}
      onLocaleChange={props.onLocaleChange}
      onSignOut={props.onSignOut}
    />
    </ControlRoomShell>
  </>;
}

interface ConfiguredAppProps extends Omit<Required<AppProps>, 'householdInvitationBootstrap' | 'planClient' | 'insightsClient' | 'exchangeClient' | 'allocationGateway' | 'goalsGateway' | 'recurringGateway' | 'cashControlGateway'> {
  readonly householdInvitationBootstrap: HouseholdInvitationBootstrap | null;
  readonly planClient: PlanClient | null;
  readonly insightsClient: InsightsClient | null;
  readonly exchangeClient: ExchangeClient | null;
  readonly allocationGateway: AllocationGateway | null;
  readonly goalsGateway: GoalsGateway | null;
  readonly recurringGateway: RecurringGateway | null;
  readonly cashControlGateway: CashControlGateway | null;
}

function ConfiguredApp({ authGateway, categoriesGateway, householdGateway, householdInvitationBootstrap, loansGateway, walletsGateway, reportsGateway, workspaceGateway, planClient, insightsClient, exchangeClient, allocationGateway, goalsGateway, recurringGateway, cashControlGateway }: ConfiguredAppProps) {
  const auth = useAuthSession(authGateway);
  const [locale, setLocale] = useState<Locale>(() => readStoredLocale());
  const [householdInvitationToken, setHouseholdInvitationToken] = useState(() => householdInvitationBootstrap?.take() ?? null);

  const onLocaleChange = useCallback(() => {
    setLocale((current) => {
      const next: Locale = current === 'en' ? 'ar' : 'en';
      persistLocale(next);
      return next;
    });
  }, []);

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
      onLocaleChange={onLocaleChange}
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
    allocationGateway={allocationGateway}
    goalsGateway={goalsGateway}
    recurringGateway={recurringGateway}
    cashControlGateway={cashControlGateway}
    onLocaleChange={onLocaleChange}
    onHouseholdInvitationConsumed={() => setHouseholdInvitationToken(null)}
    onSignOut={() => void auth.signOut()}
  />;
}

export function App({ householdInvitationBootstrap = null, authGateway, categoriesGateway, householdGateway, loansGateway, walletsGateway, reportsGateway, workspaceGateway, planClient, insightsClient, exchangeClient, allocationGateway, goalsGateway, recurringGateway, cashControlGateway }: AppProps = {}) {
  const client = useMemo(() => createBrowserDataClient(), []);
  const activeAuthGateway = useMemo(() => authGateway ?? (client ? createSupabaseAuthGateway(client) : null), [authGateway, client]);
  const activeCategoriesGateway = useMemo(() => categoriesGateway ?? (client ? createSupabaseCategoriesGateway(client) : null), [categoriesGateway, client]);
  const activeHouseholdGateway = useMemo(() => {
    if (householdGateway) return householdGateway;
    if (!client) return null;
    return createDeliveringHouseholdGateway(createSupabaseHouseholdGateway(client), createHttpInvitationDelivery({
      getAccessToken: async () => {
        const token = await readBrowserAccessToken(client);
        if (!token) throw new Error('not_authenticated');
        return token;
      },
    }));
  }, [householdGateway, client]);
  const activeLoansGateway = useMemo(() => loansGateway ?? (client ? createSupabaseLoansGateway(client) : null), [loansGateway, client]);
  const activeWalletsGateway = useMemo(() => walletsGateway ?? (client ? createSupabaseWalletsGateway(client) : null), [walletsGateway, client]);
  const activeReportsGateway = useMemo(() => reportsGateway ?? (client ? createSupabaseReportsGateway(client) : unavailableReportsGateway), [reportsGateway, client]);
  const activeWorkspaceGateway = useMemo(() => workspaceGateway ?? (client ? createSupabaseWorkspaceGateway(client) : null), [workspaceGateway, client]);
  const activePlanClient = useMemo(() => planClient ?? (client ? createPlanClient(client) : null), [planClient, client]);
  const activeInsightsClient = useMemo(() => insightsClient ?? (client ? createInsightsClient(client) : null), [insightsClient, client]);
  const activeExchangeClient = useMemo(() => exchangeClient ?? (client ? createExchangeClient(client) : null), [exchangeClient, client]);
  const activeAllocationGateway = useMemo(() => allocationGateway ?? (client ? createSupabaseAllocationGateway(client) : null), [allocationGateway, client]);
  const activeGoalsGateway = useMemo(() => goalsGateway ?? (client ? createSupabaseGoalsGateway(client) : null), [goalsGateway, client]);
  const activeRecurringGateway = useMemo(() => recurringGateway ?? (client ? createSupabaseRecurringGateway(client) : null), [recurringGateway, client]);
  const activeCashControlGateway = useMemo(() => cashControlGateway ?? (client ? createSupabaseCashControlGateway(client) : null), [cashControlGateway, client]);

  if (!activeAuthGateway || !activeCategoriesGateway || !activeHouseholdGateway || !activeLoansGateway || !activeWalletsGateway || !activeWorkspaceGateway) {
    return <main className="workspace-state-page configuration-page"><section className="state-panel"><span className="brand">Budget ledger</span><h1>Configuration needed</h1><p>This installation needs its data service before the financial workspace can open.</p><details className="configuration-detail"><summary>Operator setup details</summary><p>Connect this browser to the dedicated Budget development stack before continuing.</p></details></section></main>;
  }

  return <ConfiguredApp householdInvitationBootstrap={householdInvitationBootstrap} authGateway={activeAuthGateway} categoriesGateway={activeCategoriesGateway} householdGateway={activeHouseholdGateway} loansGateway={activeLoansGateway} walletsGateway={activeWalletsGateway} reportsGateway={activeReportsGateway} workspaceGateway={activeWorkspaceGateway} planClient={activePlanClient} insightsClient={activeInsightsClient} exchangeClient={activeExchangeClient} allocationGateway={activeAllocationGateway} goalsGateway={activeGoalsGateway} recurringGateway={activeRecurringGateway} cashControlGateway={activeCashControlGateway} />;
}
