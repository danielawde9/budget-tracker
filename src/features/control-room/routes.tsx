import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useCategories } from '../categories/use-categories.js';
import type { CategoriesGateway } from '../categories/types.js';
import { useExchange } from '../exchange/use-exchange.js';
import type { ExchangeClient } from '../exchange/types.js';
import type { HouseholdGateway } from '../household/types.js';
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

export interface ControlRoomGateways {
  wallets: WalletsGateway;
  loans: LoansGateway;
  categories: CategoriesGateway;
  reports: ReportsGateway;
  household: HouseholdGateway;
  plan: PlanClient | null;
  insights: InsightsClient | null;
  exchange: ExchangeClient | null;
}

export interface ControlRoomRoutesProps {
  locale: Locale;
  spaceId: string;
  spaceKind: SpaceKind;
  destination: ControlRoomDestination;
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
  loans: ReturnType<typeof useLoans>;
  month: string;
  onMonthChange(month: string): void;
  onSpaceUnavailable?: (() => void) | undefined;
  onOpenRecord?: (() => void) | undefined;
}

function HomeRoutes(props: HomeRoutesProps) {
  const { locale, spaceId, spaceKind, gateways } = props;
  const month = props.month;
  const insightsClient = gateways.insights ?? unavailableInsightsClient;

  const wallets = props.wallets;
  const loans = props.loans;

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

  const loansOutstanding = useMemo(() => {
    const active = (loans.dashboard?.loans ?? []).filter((loan) => BigInt(loan.outstandingMinor) > 0n);
    return active.map((loan) => ({
      loanId: loan.id,
      personName: loan.personName,
      currency: loan.currency,
      outstandingMinor: loan.outstandingMinor,
    }));
  }, [loans.dashboard]);

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
      loansOutstanding={loansOutstanding}
      recentEvents={wallets.events}
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
}

function PlanRoutes(props: PlanRoutesProps) {
  const { locale, spaceId, gateways } = props;
  const plan = usePlan(gateways.plan ?? unavailablePlanClient, spaceId, props.month);

  if (plan.status === 'loading') {
    return <PlanSkeleton locale={locale} />;
  }
  if (plan.status === 'error') {
    return (
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
  }
  return (
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

export function ControlRoomRoutes(props: ControlRoomRoutesProps) {
  const { locale, spaceId, gateways } = props;
  const [month, setMonth] = useState(currentMonthStart);
  const wallets = useWallets(gateways.wallets, spaceId, props.onSpaceUnavailable, undefined, gateways.categories);
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
  if (props.destination === 'home') {
    destinationRoutes = (
      <HomeRoutes
        locale={locale}
        spaceId={spaceId}
        spaceKind={props.spaceKind}
        gateways={gateways}
        wallets={wallets}
        loans={loans}
        month={month}
        onMonthChange={setMonth}
        onSpaceUnavailable={props.onSpaceUnavailable}
        onOpenRecord={props.onOpenRecord}
      />
    );
  } else if (props.destination === 'journal') {
    destinationRoutes = (
      <JournalRoutes
        locale={locale}
        wallets={wallets}
        onSpaceUnavailable={props.onSpaceUnavailable}
      />
    );
  } else if (props.destination === 'plan') {
    destinationRoutes = (
      <PlanRoutes
        locale={locale}
        spaceId={spaceId}
        gateways={gateways}
        loans={loans}
        month={month}
      />
    );
  } else if (props.destination === 'manage') {
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
  } else {
    destinationRoutes = <p>{props.destination} coming soon</p>;
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
      />
    </>
  );
}
