import { useEffect, useMemo, useRef, useState } from 'react';
import type { CategoriesGateway } from '../categories/types.js';
import type { ExchangeClient } from '../exchange/types.js';
import type { HouseholdGateway } from '../household/types.js';
import type { InsightsClient, CategoryBudgetRow } from '../insights/types.js';
import type { Currency, Locale, SpaceKind } from '../loans/types.js';
import type { LoansGateway } from '../loans/types.js';
import { useLoans } from '../loans/use-loans.js';
import type { PlanClient } from '../plan/types.js';
import type { MonthlyCashSummary, ReportsGateway } from '../reports/types.js';
import { useWallets } from '../wallets/use-wallets.js';
import type { WalletsGateway } from '../wallets/types.js';
import { sumMinorAmounts } from '../wallets/money.js';
import { HomeScreen } from './home-screen.js';
import type { ControlRoomDestination } from './types.js';

const unavailableInsightsClient: InsightsClient = {
  async walletActivity() { throw new Error('Insights are unavailable until this browser is connected to its data service.'); },
  async categoryActualVsBudget() { throw new Error('Insights are unavailable until this browser is connected to its data service.'); },
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
}

function currentMonthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
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
  onSpaceUnavailable?: (() => void) | undefined;
  onOpenRecord?: (() => void) | undefined;
}

function HomeRoutes(props: HomeRoutesProps) {
  const { locale, spaceId, spaceKind, gateways } = props;
  const [month, setMonth] = useState(currentMonthStart);
  const insightsClient = gateways.insights ?? unavailableInsightsClient;

  const wallets = useWallets(gateways.wallets, spaceId, props.onSpaceUnavailable, undefined, gateways.categories);
  const loans = useLoans(gateways.loans, { spaceId, ...(props.onSpaceUnavailable ? { onSpaceUnavailable: props.onSpaceUnavailable } : {}) });

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
      onMonthChange={setMonth}
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

export function ControlRoomRoutes(props: ControlRoomRoutesProps) {
  if (props.destination === 'home') {
    return (
      <HomeRoutes
        locale={props.locale}
        spaceId={props.spaceId}
        spaceKind={props.spaceKind}
        gateways={props.gateways}
        onSpaceUnavailable={props.onSpaceUnavailable}
        onOpenRecord={props.onOpenRecord}
      />
    );
  }
  // TODO(tasks 8-11): journal, plan, and manage screens replace these placeholders.
  // Task 9 mounts the record sheet here when recordOpen is true.
  return <p>{props.destination} coming soon</p>;
}
