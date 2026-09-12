import { useEffect, useMemo, useRef, useState } from 'react';
import type { CategoriesGateway } from '../categories/types.js';
import type { ExchangeClient } from '../exchange/types.js';
import type { HouseholdGateway } from '../household/types.js';
import type { InsightsClient, CategoryBudgetRow } from '../insights/types.js';
import type { Currency, Locale, SpaceKind } from '../loans/types.js';
import type { LoansGateway } from '../loans/types.js';
import { useLoans } from '../loans/use-loans.js';
import type { PlanClient } from '../plan/types.js';
import { usePlan } from '../plan/use-plan.js';
import type { MonthlyCashSummary, ReportsGateway } from '../reports/types.js';
import { useWallets } from '../wallets/use-wallets.js';
import type { WalletsGateway } from '../wallets/types.js';
import { sumMinorAmounts } from '../wallets/money.js';
import { HomeScreen } from './home-screen.js';
import type { ControlRoomDestination } from './types.js';

const unavailablePlanClient: PlanClient = {
  async loadCurrencySummary() { throw new Error('Planning is unavailable until this browser is connected to its data service.'); },
  async loadCategoryPage() { throw new Error('Planning is unavailable until this browser is connected to its data service.'); },
  async setIncomePlan() { throw new Error('Planning is unavailable until this browser is connected to its data service.'); },
  async setCategoryTarget() { throw new Error('Planning is unavailable until this browser is connected to its data service.'); },
};

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
}

function currentMonthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export function ControlRoomRoutes(props: ControlRoomRoutesProps) {
  const { locale, spaceId, spaceKind, destination, gateways } = props;
  const [month, setMonth] = useState(currentMonthStart);
  const planClient = gateways.plan ?? unavailablePlanClient;
  const insightsClient = gateways.insights ?? unavailableInsightsClient;

  const wallets = useWallets(gateways.wallets, spaceId, props.onSpaceUnavailable, undefined, gateways.categories);
  const plan = usePlan(planClient, spaceId, month);
  const loans = useLoans(gateways.loans, { spaceId, ...(props.onSpaceUnavailable ? { onSpaceUnavailable: props.onSpaceUnavailable } : {}) });

  const [budgets, setBudgets] = useState<readonly CategoryBudgetRow[]>([]);
  const [trend, setTrend] = useState<readonly MonthlyCashSummary[]>([]);
  const requestSequence = useRef(0);

  useEffect(() => {
    const request = ++requestSequence.current;
    void insightsClient.categoryActualVsBudget(spaceId, month)
      .then((rows) => { if (requestSequence.current === request) setBudgets(rows); })
      .catch(() => { if (requestSequence.current === request) setBudgets([]); });
    void gateways.reports.loadMonthlyComparison(spaceId, month)
      .then((rows) => { if (requestSequence.current === request) setTrend(rows); })
      .catch(() => { if (requestSequence.current === request) setTrend([]); });
  }, [insightsClient, gateways.reports, spaceId, month]);

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

  if (destination === 'journal' || destination === 'plan' || destination === 'manage') {
    // TODO(tasks 8-11): journal, plan, and manage screens replace these placeholders.
    return <p>{destination} coming soon</p>;
  }

  // Task 9 mounts the record sheet here when recordOpen is true.
  void props.recordOpen;
  void props.onCloseRecord;
  void plan;

  return (
    <HomeScreen
      locale={locale}
      spaceKind={spaceKind}
      month={month}
      onMonthChange={setMonth}
      onRecord={() => undefined}
      totals={totals}
      budgets={budgets}
      trend={trend}
      loansOutstanding={loansOutstanding}
      recentEvents={wallets.events.slice(0, 5)}
    />
  );
}
