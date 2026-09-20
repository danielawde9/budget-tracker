import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AllocationSetup } from '../allocation/allocation-setup.js';
import type { CategoryOption } from '../allocation/allocation-month-editor.js';
import type { AllocationGateway } from '../allocation/types.js';
import { useAllocation } from '../allocation/use-allocation.js';
import { CashControlSummary } from '../cash-control/cash-control-summary.js';
import { CashOutlookChart } from '../cash-control/cash-outlook-chart.js';
import { CommitmentBreakdown } from '../cash-control/commitment-breakdown.js';
import type { CashControlGateway, CashOutlookScenario } from '../cash-control/types.js';
import { useCashControl } from '../cash-control/use-cash-control.js';
import { useCategories } from '../categories/use-categories.js';
import type { CategoriesGateway } from '../categories/types.js';
import { useExchange } from '../exchange/use-exchange.js';
import type { ExchangeClient } from '../exchange/types.js';
import { GoalsPage } from '../goals/goals-page.js';
import type { GoalsGateway } from '../goals/types.js';
import { useGoals } from '../goals/use-goals.js';
import type { HouseholdGateway } from '../household/types.js';
import type { RecurringGateway } from '../recurring/types.js';
import { autoSettleExpense } from '../recurring/auto-settle.js';
import { useRecurring } from '../recurring/use-recurring.js';
import { UpcomingPage } from '../recurring/upcoming-page.js';
import type { InsightsClient, CategoryBudgetRow } from '../insights/types.js';
import type { Currency, Locale, SpaceKind } from '../loans/types.js';
import type { LoansGateway } from '../loans/types.js';
import { useLoans } from '../loans/use-loans.js';
import { PlanPage } from '../plan/plan-page.js';
import { usePlan } from '../plan/use-plan.js';
import type { PlanClient } from '../plan/types.js';
import type { MonthlyCashSummary, ReportsGateway } from '../reports/types.js';
import { useWallets } from '../wallets/use-wallets.js';
import type { WalletsState } from '../wallets/use-wallets.js';
import type { WalletsGateway } from '../wallets/types.js';
import { sumMinorAmounts } from '../wallets/money.js';
import { AmbiguousBanner } from './ambiguous-banner.js';
import { HomeScreen } from './home-screen.js';
import { eventLabel } from './home-screen.js';
import { JournalScreen } from './journal-screen.js';
import { ManageScreen } from './manage-screen.js';
import { RecordSheet } from './record-sheet.js';
import { HomeSkeleton, JournalSkeleton, PlanSkeleton } from './skeletons.js';
import type { ControlRoomDestination } from './types.js';

const unavailableInsightsClient: InsightsClient = {
  async walletActivity() { throw new Error('Insights are unavailable until this browser is connected to its data service.'); },
  async categoryActualVsBudget() { throw new Error('Insights are unavailable until this browser is connected to its data service.'); },
};

const unavailableExchangeClient: ExchangeClient = {
  async recordExchange() { throw new Error('Exchange is unavailable until this browser is connected to its data service.'); },
};

const unavailablePlanClient: PlanClient = {
  async loadCurrencySummary() { throw new Error('Planning is unavailable until this browser is connected to its data service.'); },
  async loadCategoryPage() { throw new Error('Planning is unavailable until this browser is connected to its data service.'); },
  async setIncomePlan() { throw new Error('Planning is unavailable until this browser is connected to its data service.'); },
  async setCategoryTarget() { throw new Error('Planning is unavailable until this browser is connected to its data service.'); },
};

const unavailableAllocationGateway: AllocationGateway = {
  async loadMonth() { throw new Error('Allocation is unavailable until this browser is connected to its data service.'); },
  async loadCategoryPage() { throw new Error('Allocation is unavailable until this browser is connected to its data service.'); },
  async loadHistoryPage() { throw new Error('Allocation is unavailable until this browser is connected to its data service.'); },
  async loadTrend() { throw new Error('Allocation is unavailable until this browser is connected to its data service.'); },
  async saveTemplate() { throw new Error('Allocation is unavailable until this browser is connected to its data service.'); },
  async publishMonth() { throw new Error('Allocation is unavailable until this browser is connected to its data service.'); },
  async publishMonthV2() { throw new Error('Allocation is unavailable until this browser is connected to its data service.'); },
  async findCommand() { throw new Error('Allocation is unavailable until this browser is connected to its data service.'); },
};

const unavailableGoalsGateway: GoalsGateway = {
  async loadPage() { throw new Error('Goals are unavailable until this browser is connected to its data service.'); },
  async loadDetail() { throw new Error('Goals are unavailable until this browser is connected to its data service.'); },
  async loadHistory() { throw new Error('Goals are unavailable until this browser is connected to its data service.'); },
  async create() { throw new Error('Goals are unavailable until this browser is connected to its data service.'); },
  async revise() { throw new Error('Goals are unavailable until this browser is connected to its data service.'); },
  async reserveOrRelease() { throw new Error('Goals are unavailable until this browser is connected to its data service.'); },
  async move() { throw new Error('Goals are unavailable until this browser is connected to its data service.'); },
  async reverse() { throw new Error('Goals are unavailable until this browser is connected to its data service.'); },
  async linkPurchase() { throw new Error('Goals are unavailable until this browser is connected to its data service.'); },
  async setMonthlyTarget() { throw new Error('Goals are unavailable until this browser is connected to its data service.'); },
  async setMilestone() { throw new Error('Goals are unavailable until this browser is connected to its data service.'); },
  async findCommand() { throw new Error('Goals are unavailable until this browser is connected to its data service.'); },
};

const unavailableCashControlGateway: CashControlGateway = {
  async loadAvailable() { throw new Error('Available cash is unavailable until this browser is connected to its data service.'); },
  async loadOutlook() { throw new Error('The cash outlook is unavailable until this browser is connected to its data service.'); },
};

const unavailableRecurringGateway: RecurringGateway = {
  async loadOccurrences() { throw new Error('Recurring bills are unavailable until this browser is connected to its data service.'); },
  async saveSchedule() { throw new Error('Recurring bills are unavailable until this browser is connected to its data service.'); },
  async materialize() { throw new Error('Recurring bills are unavailable until this browser is connected to its data service.'); },
  async setOccurrenceState() { throw new Error('Recurring bills are unavailable until this browser is connected to its data service.'); },
  async confirm() { throw new Error('Recurring bills are unavailable until this browser is connected to its data service.'); },
  async linkExisting() { throw new Error('Recurring bills are unavailable until this browser is connected to its data service.'); },
  async findCommand() { throw new Error('Recurring bills are unavailable until this browser is connected to its data service.'); },
};

export interface ControlRoomGateways {
  wallets: WalletsGateway;
  loans: LoansGateway;
  categories: CategoriesGateway;
  reports: ReportsGateway;
  household: HouseholdGateway;
  plan: PlanClient | null;
  insights: InsightsClient | null;
  exchange: ExchangeClient | null;
  allocation: AllocationGateway | null;
  goals: GoalsGateway | null;
  recurring: RecurringGateway | null;
  cashControl: CashControlGateway | null;
}

export interface ControlRoomRoutesProps {
  locale: Locale;
  spaceId: string;
  spaceKind: SpaceKind;
  destination: ControlRoomDestination;
  onDestinationChange?(destination: ControlRoomDestination): void;
  gateways: ControlRoomGateways;
  recordOpen: boolean;
  onCloseRecord(): void;
  /** Restores membership-revocation handling: hooks call this when the active space disappears. */
  onSpaceUnavailable?(): void;
  /** Opens the record sheet (Task 9 mounts it); the home screen's Record action calls this. */
  onOpenRecord?(): void;
  /** Manage screen plumbing (Task 11): account, language, and household section wiring. */
  userId?: string;
  spaceName?: string;
  userEmail?: string | null;
  onLocaleChange?(): void;
  onSignOut?(): void;
}

function currentMonthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Window-bound arithmetic only (never an occurrence's own `dueDate`, which
 * this feature always displays as the server's plain string, unshifted) --
 * safe, ordinary `Date` use for picking the materialize/load range. */
function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isSpaceUnavailable(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : '';
  return /active space membership|selected space is not available|permission denied|missing_membership/i.test(message);
}

interface HomeDataState {
  status: 'loading' | 'ready' | 'error';
  budgets: readonly CategoryBudgetRow[];
  trend: readonly MonthlyCashSummary[];
  error: string | null;
}

interface HomeRoutesProps {
  locale: Locale;
  spaceId: string;
  spaceKind: SpaceKind;
  gateways: ControlRoomGateways;
  wallets: WalletsState;
  loansOutstanding: readonly { loanId: string; personName: string; currency: Currency; outstandingMinor: string }[];
  month: string;
  onMonthChange(month: string): void;
  onSpaceUnavailable?: (() => void) | undefined;
  onOpenRecord?: (() => void) | undefined;
  onSeeAll?: (() => void) | undefined;
}

/** Home's own (USD, LBP) compact summary -- shares `useCashControl` with
 * `CashControlSection` below rather than calling `loadAvailable` directly,
 * reusing its proven stale-response/generation/membership-loss guards
 * instead of reimplementing that request lifecycle a second time here. This
 * does issue an unused `cash_outlook` read on Home too (the compact variant
 * only reads `available`); accepted as a bounded, cheap read-only RPC --
 * see `docs/decisions.md`. */
function useCashControlHomeSummary(
  gateway: CashControlGateway, spaceId: string, onSpaceUnavailable: (() => void) | undefined,
): readonly { currency: Currency; available: ReturnType<typeof useCashControl>['available'] }[] {
  const today = todayIso();
  const usd = useCashControl(gateway, spaceId, 'USD', today, 60, 'expected', onSpaceUnavailable);
  const lbp = useCashControl(gateway, spaceId, 'LBP', today, 60, 'expected', onSpaceUnavailable);
  return [
    { currency: 'USD', available: usd.available },
    { currency: 'LBP', available: lbp.available },
  ];
}

function HomeRoutes(props: HomeRoutesProps) {
  const { locale, spaceId, spaceKind, gateways } = props;
  const month = props.month;
  const insightsClient = gateways.insights ?? unavailableInsightsClient;
  const cashControlByCurrency = useCashControlHomeSummary(gateways.cashControl ?? unavailableCashControlGateway, spaceId, props.onSpaceUnavailable);

  const wallets = props.wallets;

  const [data, setData] = useState<HomeDataState>({ status: 'loading', budgets: [], trend: [], error: null });
  const [attempt, setAttempt] = useState(0);
  const requestSequence = useRef(0);

  useEffect(() => {
    const request = ++requestSequence.current;
    setData((current) => ({ ...current, status: 'loading', error: null }));
    let failureMessage: string | null = null;
    let unavailable = false;
    const capture = (cause: unknown) => {
      if (failureMessage === null) {
        failureMessage = cause instanceof Error && cause.message.trim() ? cause.message : 'Could not load this section.';
      }
      if (isSpaceUnavailable(cause)) unavailable = true;
    };
    void Promise.all([
      insightsClient.categoryActualVsBudget(spaceId, month)
        .catch((cause: unknown) => { capture(cause); return [] as readonly CategoryBudgetRow[]; }),
      gateways.reports.loadMonthlyComparison(spaceId, month)
        .catch((cause: unknown) => { capture(cause); return [] as readonly MonthlyCashSummary[]; }),
    ]).then(([budgetRows, trendRows]) => {
      if (requestSequence.current !== request) return;
      if (unavailable) props.onSpaceUnavailable?.();
      if (failureMessage !== null) {
        setData((current) => ({ ...current, status: 'error', error: failureMessage }));
      } else {
        setData({ status: 'ready', budgets: budgetRows, trend: trendRows, error: null });
      }
    });
  }, [insightsClient, gateways.reports, spaceId, month, attempt, props.onSpaceUnavailable]);

  const totals = useMemo(() => {
    const byCurrency = new Map<Currency, string>();
    for (const wallet of wallets.wallets) {
      byCurrency.set(wallet.currency, sumMinorAmounts([
        byCurrency.get(wallet.currency) ?? '0',
        wallet.balanceMinor,
      ]));
    }
    return [...byCurrency.entries()].map(([currency, balanceMinor]) => ({ currency, balanceMinor }));
  }, [wallets.wallets]);

  return (
    <HomeScreen
      locale={locale}
      spaceKind={spaceKind}
      month={month}
      onMonthChange={props.onMonthChange}
      onRecord={() => props.onOpenRecord?.()}
      totals={totals}
      budgets={data.budgets}
      trend={data.trend}
      dataStatus={data.status}
      dataError={data.error}
      onRetryLoad={() => setAttempt((current) => current + 1)}
      loansOutstanding={props.loansOutstanding}
      recentEvents={wallets.events}
      cashControlByCurrency={cashControlByCurrency}
      onSeeAll={() => props.onSeeAll?.()}
    />
  );
}

interface JournalRoutesProps {
  locale: Locale;
  wallets: WalletsState;
  onSpaceUnavailable?: (() => void) | undefined;
}

function JournalRoutes(props: JournalRoutesProps) {
  const { locale } = props;
  const wallets = props.wallets;
  if (wallets.status === 'loading') {
    return (
      <>
        <header className="cr-row">
          <h1>{locale === 'ar' ? 'القيود' : 'Journal'}</h1>
        </header>
        <JournalSkeleton locale={locale} />
      </>
    );
  }
  return (
    <>
      <JournalScreen
        locale={locale}
        events={wallets.events}
        nextCursor={wallets.nextCursor}
        loadingMore={wallets.loadingMore}
        onLoadMore={() => void wallets.loadMore()}
        onReverse={(id) => wallets.reverseEvent({ eventId: id, effectiveDate: todayIso() })}
        reversePending={wallets.pending}
        search={wallets.journalSearch}
        onSearchQueryChange={wallets.searchJournal}
        onLoadMoreSearch={() => void wallets.loadMoreJournalSearch()}
        onExportCsv={() => wallets.exportJournalCsv(locale, (event) => eventLabel(event, locale))}
      />
      <AmbiguousBanner
        locale={locale}
        ambiguous={wallets.ambiguous}
        onRetry={() => void wallets.retryAmbiguous()}
        onDismiss={wallets.clearAmbiguous}
      />
    </>
  );
}

interface PlanRoutesProps {
  locale: Locale;
  spaceId: string;
  gateways: ControlRoomGateways;
  loans: ReturnType<typeof useLoans>;
  month: string;
  expenseRootCategories: readonly CategoryOption[];
  onSpaceUnavailable?: (() => void) | undefined;
}

function AllocationCurrencySection(props: {
  locale: Locale;
  spaceId: string;
  month: string;
  currency: 'USD' | 'LBP';
  gateway: AllocationGateway;
  categories: readonly CategoryOption[];
  categoryTargets: ReadonlyMap<string, { amountMinor: string; revisionId: string | null }>;
  onSpaceUnavailable?: (() => void) | undefined;
}) {
  const allocation = useAllocation(props.gateway, props.spaceId, props.month, props.currency, props.onSpaceUnavailable);
  return (
    <section className="cr-card" aria-label={`${props.locale === 'ar' ? 'التخصيص' : 'Allocation'} ${props.currency}`}>
      <span className="cr-chip">{props.currency}</span>
      <AllocationSetup
        locale={props.locale}
        currency={props.currency}
        month={props.month}
        categories={props.categories}
        categoryTargets={props.categoryTargets}
        allocation={allocation}
        gateway={props.gateway}
      />
    </section>
  );
}

function GoalsCurrencySection(props: {
  locale: Locale;
  spaceId: string;
  currency: 'USD' | 'LBP';
  gateway: GoalsGateway;
  onSpaceUnavailable?: (() => void) | undefined;
}) {
  // Filtering by state happens client-side inside GoalsPage over this one
  // fetch of the full relevant set (bounded to 200 goals by the DB layer),
  // rather than re-querying goal_page per filter tab.
  const goals = useGoals(props.gateway, props.spaceId, props.currency, 'all', props.onSpaceUnavailable);
  return (
    <section className="cr-card" aria-label={`${props.locale === 'ar' ? 'الأهداف' : 'Goals'} ${props.currency}`}>
      <span className="cr-chip">{props.currency}</span>
      <GoalsPage locale={props.locale} currency={props.currency} goals={goals} />
    </section>
  );
}

function UpcomingBillsSection(props: {
  locale: Locale;
  spaceId: string;
  currency: Currency;
  gateway: RecurringGateway;
  onSpaceUnavailable?: (() => void) | undefined;
}) {
  // A fixed 60-day-ahead window, re-derived every render off "today" rather
  // than stored in state -- occurrences never need a wider client-chosen
  // range in this task's scope, and materialize (explicit-refresh only,
  // never on mount) reuses this exact same bound.
  const fromDate = todayIso();
  const toDate = addDaysIso(fromDate, 60);
  const recurring = useRecurring(props.gateway, props.spaceId, fromDate, toDate, props.onSpaceUnavailable);
  return (
    <section className="cr-card" aria-label={props.locale === 'ar' ? 'الفواتير القادمة' : 'Upcoming bills'}>
      <UpcomingPage locale={props.locale} recurring={recurring} fromDate={fromDate} toDate={toDate} />
    </section>
  );
}

/** "Available after commitments": the full read-only detail -- headline
 * figures, the per-group reservation breakdown, and the 60-day outlook with
 * its own expected/conservative scenario switch. The scenario is local UI
 * state, never persisted: changing it is a different read parameter on the
 * same `useCashControl` hook (task 18's own contract), never a command, so
 * it creates no journal row. */
function CashControlSection(props: {
  locale: Locale;
  spaceId: string;
  currency: 'USD' | 'LBP';
  gateway: CashControlGateway;
  onSpaceUnavailable?: (() => void) | undefined;
}) {
  const [scenario, setScenario] = useState<CashOutlookScenario>('expected');
  const cashControl = useCashControl(props.gateway, props.spaceId, props.currency, todayIso(), 60, scenario, props.onSpaceUnavailable);
  return (
    <section className="cr-card" aria-label={`${props.locale === 'ar' ? 'المتاح بعد الالتزامات' : 'Available after commitments'} ${props.currency}`}>
      <span className="cr-chip">{props.currency}</span>
      <CashControlSummary locale={props.locale} currency={props.currency} available={cashControl.available} variant="full" />
      {cashControl.available.status === 'ready' && cashControl.available.data.state === 'ready' && (
        <>
          <h4 className="cc-subheading">{props.locale === 'ar' ? 'الحجوزات' : 'Reservations'}</h4>
          <CommitmentBreakdown locale={props.locale} currency={props.currency} groups={cashControl.available.data.groups} />
        </>
      )}
      <CashOutlookChart locale={props.locale} currency={props.currency} outlook={cashControl.outlook} scenario={scenario} onScenarioChange={setScenario} />
    </section>
  );
}

const ALLOCATION_CURRENCIES = ['USD', 'LBP'] as const;
const GOAL_CURRENCIES = ['USD', 'LBP'] as const;
const CASH_CONTROL_CURRENCIES = ['USD', 'LBP'] as const;
const PLAN_CURRENCY_OPTIONS = ['USD', 'LBP'] as const;

type PlanSection = 'plan' | 'allocation' | 'goals' | 'cash' | 'bills';

const PLAN_SECTIONS: readonly { id: PlanSection; en: string; ar: string }[] = [
  { id: 'plan', en: 'Plan', ar: 'الخطة' },
  { id: 'allocation', en: 'Allocation', ar: 'التخصيص' },
  { id: 'goals', en: 'Goals', ar: 'الأهداف' },
  { id: 'cash', en: 'Available cash', ar: 'السيولة المتاحة' },
  { id: 'bills', en: 'Upcoming bills', ar: 'الفواتير القادمة' },
];

function PlanRoutes(props: PlanRoutesProps) {
  const { locale, spaceId, gateways } = props;
  const [section, setSection] = useState<PlanSection>('plan');
  const [planCurrency, setPlanCurrency] = useState<Currency>('USD');
  const plan = usePlan(gateways.plan ?? unavailablePlanClient, spaceId, props.month);

  const categoryTargetsByCurrency = useMemo(() => {
    const map = new Map<'USD' | 'LBP', Map<string, { amountMinor: string; revisionId: string | null }>>([
      ['USD', new Map()], ['LBP', new Map()],
    ]);
    if (plan.status === 'ready') {
      for (const row of plan.categoryRows) {
        if (row.targetMinor === null) continue;
        map.get(row.currency)?.set(row.categoryId, { amountMinor: row.targetMinor, revisionId: row.targetRevisionId });
      }
    }
    return map;
  }, [plan.status, plan.categoryRows]);

  let planSection: ReactNode;
  if (plan.status === 'loading') {
    planSection = <PlanSkeleton locale={locale} />;
  } else if (plan.status === 'error') {
    planSection = (
      <div className="cr-card" role="alert">
        <div className="cr-row">
          <span>{locale === 'ar' ? 'تعذر تحميل الخطة الشهرية.' : 'Could not load the monthly plan.'}</span>
          <button type="button" className="cr-button" onClick={() => void plan.refresh()}>
            {locale === 'ar' ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
        {plan.error ? <small>{plan.error}</small> : null}
      </div>
    );
  } else {
    planSection = (
      <PlanPage
        locale={locale}
        month={props.month}
        summaries={plan.summaries}
        categoryRows={plan.categoryRows}
        pending={plan.pending}
        error={plan.saveError}
        loansSummary={props.loans.dashboard?.summaries ?? []}
        onSaveIncome={plan.setIncomePlan}
        onSaveTarget={plan.setCategoryTarget}
      />
    );
  }

  return (
    <>
      <nav className="cr-plan-nav" aria-label={locale === 'ar' ? 'أقسام الخطة' : 'Plan sections'}>
        {PLAN_SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={section === item.id ? 'cr-chip cr-chip--active' : 'cr-chip'}
            aria-pressed={section === item.id}
            onClick={() => setSection(item.id)}
          >
            {locale === 'ar' ? item.ar : item.en}
          </button>
        ))}
      </nav>
      {section === 'allocation' || section === 'goals' || section === 'cash' || section === 'bills' ? (
        <div className="cr-tabs" role="tablist" aria-label={locale === 'ar' ? 'العملة' : 'Currency'}>
          {PLAN_CURRENCY_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={planCurrency === option}
              className={planCurrency === option ? 'cr-tab cr-tab--active' : 'cr-tab'}
              onClick={() => setPlanCurrency(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
      {section === 'plan' ? planSection : null}
      {section === 'allocation' ? [planCurrency].map((currency) => (
        <AllocationCurrencySection
          key={currency}
          locale={locale}
          spaceId={spaceId}
          month={props.month}
          currency={currency}
          gateway={gateways.allocation ?? unavailableAllocationGateway}
          categories={props.expenseRootCategories}
          categoryTargets={categoryTargetsByCurrency.get(currency) ?? new Map()}
          onSpaceUnavailable={props.onSpaceUnavailable}
        />
      )) : null}
      {section === 'goals' ? [planCurrency].map((currency) => (
        <GoalsCurrencySection
          key={currency}
          locale={locale}
          spaceId={spaceId}
          currency={currency}
          gateway={gateways.goals ?? unavailableGoalsGateway}
          onSpaceUnavailable={props.onSpaceUnavailable}
        />
      )) : null}
      {section === 'cash' ? [planCurrency].map((currency) => (
        <CashControlSection
          key={currency}
          locale={locale}
          spaceId={spaceId}
          currency={currency}
          gateway={gateways.cashControl ?? unavailableCashControlGateway}
          onSpaceUnavailable={props.onSpaceUnavailable}
        />
      )) : null}
      {section === 'bills' ? (
        <UpcomingBillsSection
          locale={locale}
          spaceId={spaceId}
          currency={planCurrency}
          gateway={gateways.recurring ?? unavailableRecurringGateway}
          onSpaceUnavailable={props.onSpaceUnavailable}
        />
      ) : null}
    </>
  );
}

export function ControlRoomRoutes(props: ControlRoomRoutesProps) {
  const { locale, spaceId, gateways } = props;
  const [month, setMonth] = useState(currentMonthStart);
  const walletListRef = useRef<readonly { id: string; currency: Currency }[]>([]);
  const settleRecordedExpense = useCallback(async (info: { eventId: string; kind: string; effectiveDate: string; movements: readonly { walletId: string; amountMinor: string }[]; categoryId: string | null }) => {
    if (info.kind !== 'expense' || !gateways.recurring) return;
    const wallet = walletListRef.current.find((candidate) => candidate.id === info.movements[0]?.walletId);
    if (!wallet) return;
    const totalMinor = info.movements.reduce((sum, movement) => sum + BigInt(movement.amountMinor), 0n);
    const amountMinor = (totalMinor < 0n ? -totalMinor : totalMinor).toString();
    await autoSettleExpense(gateways.recurring, spaceId, {
      eventId: info.eventId,
      categoryId: info.categoryId,
      amountMinor,
      currency: wallet.currency,
      effectiveDate: info.effectiveDate,
    });
  }, [gateways.recurring, spaceId]);
  const wallets = useWallets(gateways.wallets, spaceId, props.onSpaceUnavailable, undefined, gateways.categories, { onExpenseRecorded: settleRecordedExpense });
  walletListRef.current = wallets.wallets;
  const loans = useLoans(gateways.loans, { spaceId, ...(props.onSpaceUnavailable ? { onSpaceUnavailable: props.onSpaceUnavailable } : {}) });
  const categories = useCategories(gateways.categories, spaceId, props.onSpaceUnavailable);
  const exchangeReceipts = useMemo(() => ({
    findEventByRequestId: (targetSpaceId: string, requestId: string) =>
      gateways.wallets.findEventByRequestId(targetSpaceId, requestId),
  }), [gateways.wallets]);
  const onExchangeRecorded = useMemo(() => async () => { await wallets.refresh(); }, [wallets]);
  const exchange = useExchange(gateways.exchange ?? unavailableExchangeClient, exchangeReceipts, spaceId, onExchangeRecorded);

  const loansOutstanding = useMemo(() => {
    const active = (loans.dashboard?.loans ?? []).filter((loan) => BigInt(loan.outstandingMinor) > 0n);
    return active.map((loan) => ({
      loanId: loan.id,
      personName: loan.personName,
      currency: loan.currency,
      outstandingMinor: loan.outstandingMinor,
    }));
  }, [loans.dashboard]);

  const expenseRootCategoryOptions = useMemo(() => categories.expenseCategories
    .filter((category) => category.parentCategoryId === null && category.archivedAt === null)
    .map((category) => ({ id: category.id, nameEn: category.nameEn ?? '', nameAr: category.nameAr ?? '' })),
  [categories.expenseCategories]);

  const categoryTree = useMemo(() => {
    const all = [...categories.incomeCategories, ...categories.expenseCategories];
    const active = all.filter((category) => !category.archivedAt);
    return active
      .filter((category) => category.parentCategoryId === null)
      .map((root) => ({
        id: root.id,
        nameEn: root.nameEn ?? '',
        nameAr: root.nameAr ?? '',
        kind: root.kind,
        children: active
          .filter((category) => category.parentCategoryId === root.id)
          .map((child) => ({ id: child.id, nameEn: child.nameEn ?? '', nameAr: child.nameAr ?? '' })),
      }));
  }, [categories.incomeCategories, categories.expenseCategories]);

  const [sheetError, setSheetError] = useState<string | null>(null);

  let destinationRoutes: ReactNode;
  switch (props.destination) {
    case 'home':
      destinationRoutes = (
        <HomeRoutes
          locale={locale}
          spaceId={spaceId}
          spaceKind={props.spaceKind}
          gateways={gateways}
          wallets={wallets}
          loansOutstanding={loansOutstanding}
          month={month}
          onMonthChange={setMonth}
          onSpaceUnavailable={props.onSpaceUnavailable}
          onOpenRecord={props.onOpenRecord}
          onSeeAll={() => props.onDestinationChange?.('journal')}
        />
      );
      break;
    case 'journal':
      destinationRoutes = (
        <JournalRoutes
          locale={locale}
          wallets={wallets}
          onSpaceUnavailable={props.onSpaceUnavailable}
        />
      );
      break;
    case 'plan':
      destinationRoutes = (
        <PlanRoutes
          locale={locale}
          spaceId={spaceId}
          gateways={gateways}
          loans={loans}
          month={month}
          expenseRootCategories={expenseRootCategoryOptions}
          onSpaceUnavailable={props.onSpaceUnavailable}
        />
      );
      break;
    case 'manage':
      destinationRoutes = (
        <ManageScreen
          key={spaceId}
          locale={locale}
          spaceId={spaceId}
          spaceName={props.spaceName ?? ''}
          spaceKind={props.spaceKind}
          userId={props.userId ?? ''}
          userEmail={props.userEmail ?? null}
          gateways={{
            loans: gateways.loans,
            categories: gateways.categories,
            household: gateways.household,
          }}
          walletState={wallets}
          onLocaleChange={() => props.onLocaleChange?.()}
          onSignOut={() => props.onSignOut?.()}
          onSpaceUnavailable={props.onSpaceUnavailable}
        />
      );
      break;
  }

  return (
    <>
      {destinationRoutes}
      <RecordSheet
        open={props.recordOpen}
        locale={locale}
        wallets={wallets.wallets.filter((wallet) => wallet.archivedAt === null)}
        loans={loansOutstanding}
        payees={wallets.payees.map((payee) => payee.name)}
        categoryTree={categoryTree}
        exchangeAvailable={gateways.exchange !== null}
        pending={wallets.pending || exchange.pending}
        error={sheetError}
        walletAmbiguous={wallets.ambiguous}
        exchangeAmbiguous={exchange.ambiguous}
        onRetryWalletAmbiguous={() => void wallets.retryAmbiguous()}
        onDismissWalletAmbiguous={wallets.clearAmbiguous}
        onRetryExchangeAmbiguous={() => void exchange.retryAmbiguous()}
        onDismissExchangeAmbiguous={exchange.clearAmbiguous}
        onClose={() => {
          setSheetError(null);
          props.onCloseRecord();
        }}
        onSubmitRecord={async (draft) => {
          setSheetError(null);
          const outcome = await wallets.recordEvent(draft);
          if (outcome.status === 'ambiguous') return;
          if (outcome.status === 'refresh-required') {
            setSheetError(props.locale === 'ar'
              ? 'تم التسجيل لكن تعذر تحديث الأرصدة — تحقق من الاتصال.'
              : 'Recorded, but refreshing balances failed — check your connection.');
            return;
          }
          props.onCloseRecord();
        }}
        onSubmitExchange={async (draft) => {
          const outcome = await exchange.recordExchange(draft);
          if (outcome.status === 'success') {
            await wallets.refresh();
            props.onCloseRecord();
          }
        }}
        onSubmitLoan={async (draft) => {
          await loans.createLoan({ mode: 'cash', spaceId, ...draft });
          props.onCloseRecord();
        }}
        onSubmitRepayment={async (draft) => {
          await loans.recordRepayment({ spaceId, ...draft });
          props.onCloseRecord();
        }}
        onCreateCategory={async (draft) => {
          const requestId = crypto.randomUUID();
          if ('parentCategoryId' in draft) {
            const result = await gateways.categories.createSubcategory({
              spaceId,
              requestId,
              parentCategoryId: draft.parentCategoryId,
              nameEn: draft.nameEn || null,
              nameAr: draft.nameAr || null,
            });
            return { id: result.id ?? requestId };
          }
          const result = await gateways.categories.createCategory({
            spaceId,
            requestId,
            kind: draft.kind,
            nameEn: draft.nameEn || null,
            nameAr: draft.nameAr || null,
          });
          return { id: result.id ?? requestId };
        }}
      />
    </>
  );
}
