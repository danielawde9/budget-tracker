import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { InsightsClient, CategoryBudgetRow } from '../insights/types.js';
import type { MonthlyCashSummary, ReportsGateway } from '../reports/types.js';
import { InMemoryCategoriesGateway } from '../../test/in-memory-categories-gateway.js';
import { InMemoryHouseholdGateway } from '../../test/in-memory-household-gateway.js';
import { InMemoryLoansGateway } from '../../test/in-memory-loans-gateway.js';
import { InMemoryPlanClient } from '../../test/in-memory-plan-client.js';
import { InMemoryWalletsGateway } from '../../test/in-memory-wallets-gateway.js';
import { ControlRoomRoutes } from './routes.js';
import type { ControlRoomGateways } from './routes.js';

const BUDGET_ROW: CategoryBudgetRow = {
  categoryKey: 'groceries', nameEn: 'Groceries', nameAr: 'بقالة', kind: 'expense',
  currency: 'USD', actualNetMinor: '21000', budgetMinor: '30000', remainingMinor: '9000',
};

function insights(implementation: InsightsClient['categoryActualVsBudget']): InsightsClient {
  return { walletActivity: vi.fn(async () => []), categoryActualVsBudget: vi.fn(implementation) };
}

function reports(implementation: ReportsGateway['loadMonthlyComparison']): ReportsGateway {
  return { loadMonthlyComparison: vi.fn(implementation) };
}

function gateways(overrides: {
  insights?: InsightsClient;
  reports?: ReportsGateway;
  wallets?: ControlRoomGateways['wallets'];
  categories?: ControlRoomGateways['categories'];
}): ControlRoomGateways {
  return {
    wallets: overrides.wallets ?? new InMemoryWalletsGateway(),
    loans: new InMemoryLoansGateway(),
    categories: overrides.categories ?? new InMemoryCategoriesGateway(),
    reports: overrides.reports ?? reports(async () => []),
    household: new InMemoryHouseholdGateway(),
    plan: null,
    insights: overrides.insights ?? insights(async () => []),
    exchange: null,
  };
}

function renderHome(gatewaysBag: ControlRoomGateways, extra: Partial<Parameters<typeof ControlRoomRoutes>[0]> = {}) {
  return render(
    <ControlRoomRoutes
      locale="en"
      spaceId="personal-space"
      spaceKind="personal"
      destination="home"
      gateways={gatewaysBag}
      recordOpen={false}
      onCloseRecord={() => undefined}
      {...extra}
    />,
  );
}

describe('ControlRoomRoutes home data loading', () => {
  it('shows an error note with retry when insights fails, and retry recovers', async () => {
    const user = userEvent.setup();
    let fail = true;
    const insightsClient = insights(async () => {
      if (fail) throw new Error('insights backend exploded');
      return [BUDGET_ROW];
    });
    renderHome(gateways({ insights: insightsClient }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the latest data.');
    expect(alert).toHaveTextContent('insights backend exploded');
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument();

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Groceries')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('treats a membership failure as space unavailable and reports it', async () => {
    const onSpaceUnavailable = vi.fn();
    const insightsClient = insights(async () => { throw new Error('active space membership is required'); });
    renderHome(gateways({ insights: insightsClient }), { onSpaceUnavailable });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await waitFor(() => expect(onSpaceUnavailable).toHaveBeenCalled());
  });

  it('renders trend bars from the reports gateway', async () => {
    const trend: MonthlyCashSummary[] = [
      { periodMonth: '2026-08-01', periodRole: 'previous', currency: 'USD', incomeNetMinor: '0', expenseNetMinor: '-20000', walletDeltaNetMinor: '0' },
    ];
    renderHome(gateways({ reports: reports(async () => trend) }));
    expect(await screen.findByText('Personal space')).toBeInTheDocument();
    expect(document.querySelector('.cr-bars [data-role="previous"]')).not.toBeNull();
  });
});

describe('ControlRoomRoutes skeleton loading states', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
  }

  it('home shows an aria-hidden skeleton with visually-hidden loading text, then swaps to content', async () => {
    const gate = deferred<readonly CategoryBudgetRow[]>();
    renderHome(gateways({ insights: insights(() => gate.promise) }));

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    const skeletons = document.querySelectorAll('.cr-skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
    for (const block of skeletons) expect(block).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('region', { name: 'Net position' })).not.toBeInTheDocument();

    gate.resolve([BUDGET_ROW]);
    expect(await screen.findByRole('region', { name: 'Net position' })).toBeInTheDocument();
    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(document.querySelector('.cr-skeleton')).toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('journal shows skeleton rows while the wallet snapshot loads, then renders entries', async () => {
    const base = new InMemoryWalletsGateway();
    const gate = deferred<unknown>();
    const wallets: ControlRoomGateways['wallets'] = new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === 'loadSnapshot') {
          return (spaceId: string) => gate.promise.then(() => target.loadSnapshot(spaceId));
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    render(
      <ControlRoomRoutes
        locale="en"
        spaceId="personal-space"
        spaceKind="personal"
        destination="journal"
        gateways={gateways({ wallets })}
        recordOpen={false}
        onCloseRecord={() => undefined}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(document.querySelectorAll('.cr-skeleton--row').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Load more|All/ })).not.toBeInTheDocument();

    gate.resolve(null);
    expect(await screen.findByRole('group', { name: 'Filter by type' })).toBeInTheDocument();
    expect(document.querySelector('.cr-skeleton')).toBeNull();
  });

  it('plan shows a skeleton while the plan loads, then renders the plan page', async () => {
    const base = new InMemoryPlanClient();
    base.summaries = [{
      currency: 'USD', plannedIncomeMinor: '300000', actualIncomeMinor: '0',
      categoryTargetTotalMinor: '0', categoryActualSpentMinor: '0', uncategorizedSpentMinor: '0',
      categoryOverspentMinor: '0', actualLoanRepaymentMinor: '0', remainingLoanReservationMinor: '0',
      loanCommitmentMinor: '0', unallocatedMinor: '300000', overallocatedMinor: '0',
      incomePlanRevisionId: 'rev-income-1',
    }];
    const gate = deferred<unknown>();
    const plan: ControlRoomGateways['plan'] = new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === 'loadCurrencySummary') {
          return () => gate.promise.then(() => target.loadCurrencySummary());
        }
        if (prop === 'loadCategoryPage') {
          return () => gate.promise.then(() => target.loadCategoryPage());
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const gatewaysBag = gateways({});
    gatewaysBag.plan = plan;
    render(
      <ControlRoomRoutes
        locale="en"
        spaceId="personal-space"
        spaceKind="personal"
        destination="plan"
        gateways={gatewaysBag}
        recordOpen={false}
        onCloseRecord={() => undefined}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(document.querySelectorAll('.cr-skeleton').length).toBeGreaterThan(0);

    gate.resolve(null);
    expect(await screen.findByRole('region', { name: 'Planned income USD' })).toBeInTheDocument();
    expect(document.querySelector('.cr-skeleton')).toBeNull();
  });
});

describe('ControlRoomRoutes record sheet', () => {
  it('mounts the record sheet when recordOpen is true', async () => {
    renderHome(gateways({}), { recordOpen: true });
    expect(await screen.findByRole('dialog', { name: 'Record' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expense' })).toBeInTheDocument();
  });

  it('keeps the record sheet available on non-home destinations', async () => {
    render(
      <ControlRoomRoutes
        locale="en"
        spaceId="personal-space"
        spaceKind="personal"
        destination="journal"
        gateways={gateways({})}
        recordOpen
        onCloseRecord={() => undefined}
      />,
    );
    expect(await screen.findByRole('dialog', { name: 'Record' })).toBeInTheDocument();
  });

  it('requests the record sheet when the home Record action is pressed', async () => {
    const user = userEvent.setup();
    const onOpenRecord = vi.fn();
    renderHome(gateways({}), { onOpenRecord });
    await user.click(await screen.findByRole('button', { name: 'Record' }));
    expect(onOpenRecord).toHaveBeenCalled();
  });

  it('disables the Exchange tile when no exchange client is configured', async () => {
    renderHome(gateways({}), { recordOpen: true });
    expect(await screen.findByRole('button', { name: 'Exchange' })).toBeDisabled();
  });

  it('keeps the sheet open with a message when the event records but refreshing balances fails', async () => {
    const user = userEvent.setup();
    const onCloseRecord = vi.fn();
    const base = new InMemoryWalletsGateway();
    let snapshotCalls = 0;
    const wallets: ControlRoomGateways['wallets'] = new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === 'loadSnapshot') {
          return (spaceId: string) => {
            snapshotCalls += 1;
            if (snapshotCalls > 1) return Promise.reject(new Error('network down'));
            return target.loadSnapshot(spaceId);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    // refresh-required is only reported for categorized events, so seed a category.
    const categories = new InMemoryCategoriesGateway();
    categories.categories = [{
      id: 'category-groceries', spaceId: 'personal-space', kind: 'expense',
      nameEn: 'Groceries', nameAr: 'بقالة', parentCategoryId: null,
      createdAt: '2026-09-08T10:00:00Z', archivedAt: null,
    }];
    renderHome(gateways({ wallets, categories }), { recordOpen: true, onCloseRecord });

    await user.click(await screen.findByRole('button', { name: 'Expense' }));
    for (const key of ['1', '0']) await user.click(screen.getByRole('button', { name: key }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: /Daily USD/ }));
    await user.click(screen.getByRole('button', { name: 'Groceries' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Recorded, but refreshing balances failed — check your connection.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onCloseRecord).not.toHaveBeenCalled();
  });
});

describe('ControlRoomRoutes plan destination', () => {
  it('renders the plan screen from the plan client and saves income through usePlan', async () => {
    const user = userEvent.setup();
    const plan = new InMemoryPlanClient();
    plan.summaries = [{
      currency: 'USD', plannedIncomeMinor: '300000', actualIncomeMinor: '0',
      categoryTargetTotalMinor: '0', categoryActualSpentMinor: '0', uncategorizedSpentMinor: '0',
      categoryOverspentMinor: '0', actualLoanRepaymentMinor: '0', remainingLoanReservationMinor: '0',
      loanCommitmentMinor: '0', unallocatedMinor: '300000', overallocatedMinor: '0',
      incomePlanRevisionId: 'rev-income-1',
    }];
    const gatewaysBag = gateways({});
    gatewaysBag.plan = plan;
    render(
      <ControlRoomRoutes
        locale="en"
        spaceId="personal-space"
        spaceKind="personal"
        destination="plan"
        gateways={gatewaysBag}
        recordOpen={false}
        onCloseRecord={() => undefined}
      />,
    );

    const card = await screen.findByRole('region', { name: 'Planned income USD' });
    expect(within(card).getByText('$3,000.00')).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Edit planned income USD' }));
    const dialog = screen.getByRole('dialog');
    await user.clear(within(dialog).getByRole('textbox'));
    await user.type(within(dialog).getByRole('textbox'), '2100.00');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(plan.calls).toHaveLength(1));
    expect(plan.calls[0]).toEqual({
      name: 'setIncomePlan',
      input: expect.objectContaining({
        spaceId: 'personal-space',
        currency: 'USD',
        amountMinor: '210000',
        expectedRevisionId: 'rev-income-1',
      }),
    });
  });

  it('shows an error card with retry when the plan fails to load', async () => {
    const plan = new InMemoryPlanClient();
    plan.error = new Error('plan backend exploded');
    const gatewaysBag = gateways({});
    gatewaysBag.plan = plan;
    render(
      <ControlRoomRoutes
        locale="en"
        spaceId="personal-space"
        spaceKind="personal"
        destination="plan"
        gateways={gatewaysBag}
        recordOpen={false}
        onCloseRecord={() => undefined}
      />,
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the monthly plan.');
    expect(alert).toHaveTextContent('plan backend exploded');
  });
});

describe('ControlRoomRoutes plan save failure and retry', () => {
  it('surfaces a page-level message on failure and a retry after reopening succeeds', async () => {
    const user = userEvent.setup();
    const base = new InMemoryPlanClient();
    base.summaries = [{
      currency: 'USD', plannedIncomeMinor: '300000', actualIncomeMinor: '0',
      categoryTargetTotalMinor: '0', categoryActualSpentMinor: '0', uncategorizedSpentMinor: '0',
      categoryOverspentMinor: '0', actualLoanRepaymentMinor: '0', remainingLoanReservationMinor: '0',
      loanCommitmentMinor: '0', unallocatedMinor: '300000', overallocatedMinor: '0',
      incomePlanRevisionId: 'rev-income-1',
    }];
    let failSave = true;
    const plan: ControlRoomGateways['plan'] = new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === 'setIncomePlan') {
          return (input: Parameters<InMemoryPlanClient['setIncomePlan']>[0]) => {
            if (failSave) return Promise.reject(new Error('Revision conflict detected'));
            return Reflect.get(target, 'setIncomePlan', receiver).call(target, input);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const gatewaysBag = gateways({});
    gatewaysBag.plan = plan;
    render(
      <ControlRoomRoutes
        locale="en"
        spaceId="personal-space"
        spaceKind="personal"
        destination="plan"
        gateways={gatewaysBag}
        recordOpen={false}
        onCloseRecord={() => undefined}
      />,
    );

    const card = await screen.findByRole('region', { name: 'Planned income USD' });
    await user.click(within(card).getByRole('button', { name: 'Edit planned income USD' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('The plan changed elsewhere — refreshed, please review')).toBeInTheDocument();

    failSave = false;
    await user.click(within(card).getByRole('button', { name: 'Edit planned income USD' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('The plan changed elsewhere — refreshed, please review')).not.toBeInTheDocument();
    await waitFor(() => expect(base.calls).toHaveLength(1));
    expect(base.calls[0]).toEqual({
      name: 'setIncomePlan',
      input: expect.objectContaining({ amountMinor: '300000', expectedRevisionId: 'rev-income-1' }),
    });
  });
});
