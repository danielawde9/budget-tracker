import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { InsightsClient, CategoryBudgetRow } from '../insights/types.js';
import type { Currency } from '../loans/types.js';
import type { PublishMonthInput } from '../allocation/types.js';
import type { LinkExistingInput } from '../recurring/types.js';
import type { MonthlyCashSummary, ReportsGateway } from '../reports/types.js';
import { InMemoryAllocationGateway } from '../../test/in-memory-allocation-gateway.js';
import { coreAvailableCashSummaryFixture, coreCashOutlookFixture, InMemoryCashControlGateway } from '../../test/in-memory-cash-control-gateway.js';
import { InMemoryCategoriesGateway } from '../../test/in-memory-categories-gateway.js';
import { InMemoryHouseholdGateway } from '../../test/in-memory-household-gateway.js';
import { InMemoryLoansGateway } from '../../test/in-memory-loans-gateway.js';
import { InMemoryPlanClient } from '../../test/in-memory-plan-client.js';
import { coreOccurrenceRowFixture, InMemoryRecurringGateway } from '../../test/in-memory-recurring-gateway.js';
import { InMemoryWalletsGateway } from '../../test/in-memory-wallets-gateway.js';
import { ControlRoomRoutes } from './routes.js';
import type { ControlRoomGateways } from './routes.js';
import type { ControlRoomDestination } from './types.js';

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
  recurring?: ControlRoomGateways['recurring'];
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
    allocation: null,
    goals: null,
    recurring: overrides.recurring ?? null,
    cashControl: null,
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
  it('includes receivables and debts in Home net position by direction', async () => {
    renderHome(gateways({}));

    const netPosition = await screen.findByRole('region', { name: 'Net position' });
    expect(await within(netPosition).findByText('$1,300.50')).toBeInTheDocument();
  });

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
        if (prop === 'loadCategoryRows') {
          return (spaceId: string, month: string, currency: Currency) =>
            gate.promise.then(() => target.loadCategoryRows(spaceId, month, currency));
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
    // The plan and its skeleton are mutually exclusive branches of the same
    // component, so finding the ready plan content below already proves the
    // plan's own skeleton is gone. (The allocation/goals sections further
    // down the screen load from their own, separate gateways — which this
    // test leaves unresolved — so they keep their own skeleton regardless.)
    expect(await screen.findByRole('region', { name: 'Planned income USD' })).toBeInTheDocument();
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

  it('requests the record sheet from the empty Home activity action', async () => {
    const user = userEvent.setup();
    const onOpenRecord = vi.fn();
    const wallets = new InMemoryWalletsGateway();
    wallets.events = [];
    renderHome(gateways({ wallets }), { onOpenRecord });
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
    await user.click(screen.getByRole('button', { name: 'Continue' }));
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

describe('ControlRoomRoutes auto-settle notice', () => {
  it('shows the "Marked … as paid." status when a recorded expense settles a matching occurrence', async () => {
    const user = userEvent.setup();
    // A wallet remembered by an earlier test in this file (real localStorage,
    // shared across tests) would otherwise skip the Wallet step below.
    window.localStorage.removeItem('budget:last-wallet:personal-space');
    const today = new Date();
    const dueDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const categories = new InMemoryCategoriesGateway();
    categories.categories = [{
      id: 'category-groceries', spaceId: 'personal-space', kind: 'expense',
      nameEn: 'Groceries', nameAr: 'بقالة', parentCategoryId: null,
      createdAt: '2026-09-08T10:00:00Z', archivedAt: null,
    }];
    const recurring = new InMemoryRecurringGateway();
    recurring.page = {
      rows: [{
        ...coreOccurrenceRowFixture,
        dueDate,
        asOf: dueDate,
        categoryId: 'category-groceries',
        expectedMinor: '1000',
        settledMinor: '0',
        remainingMinor: '1000',
        state: 'pending',
      }],
      hasMore: false,
      nextCursor: null,
      asOf: dueDate,
    };
    renderHome(gateways({ categories, recurring }), { recordOpen: true });

    await user.click(await screen.findByRole('button', { name: 'Expense' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    for (const key of ['1', '0']) await user.click(screen.getByRole('button', { name: key }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: /Daily USD/ }));
    await user.click(screen.getByRole('button', { name: 'Groceries' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    const notice = await screen.findByText(/Marked/);
    const banner = notice.closest('p');
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner).toHaveTextContent('Marked "Rent" as paid.');
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('links a recorded income entry to a matching pending income occurrence', async () => {
    const user = userEvent.setup();
    // A wallet remembered by an earlier test in this file (real localStorage,
    // shared across tests) would otherwise skip the Wallet step below.
    window.localStorage.removeItem('budget:last-wallet:personal-space');
    const today = new Date();
    const dueDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const categories = new InMemoryCategoriesGateway();
    categories.categories = [{
      id: 'category-salary', spaceId: 'personal-space', kind: 'income',
      nameEn: 'Salary', nameAr: 'راتب', parentCategoryId: null,
      createdAt: '2026-09-08T10:00:00Z', archivedAt: null,
    }];
    const recurring = new InMemoryRecurringGateway();
    recurring.page = {
      rows: [{
        ...coreOccurrenceRowFixture,
        kind: 'income',
        nameEn: 'Salary',
        dueDate,
        asOf: dueDate,
        categoryId: 'category-salary',
        expectedMinor: '1000',
        settledMinor: '0',
        remainingMinor: '1000',
        state: 'pending',
      }],
      hasMore: false,
      nextCursor: null,
      asOf: dueDate,
    };
    renderHome(gateways({ categories, recurring }), { recordOpen: true });

    await user.click(await screen.findByRole('button', { name: 'Income' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    for (const key of ['1', '0']) await user.click(screen.getByRole('button', { name: key }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: /Daily USD/ }));
    await user.click(screen.getByRole('button', { name: 'Salary' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await screen.findByText(/Marked/);
    const linkCall = recurring.calls.find((call) => call.name === 'linkExisting');
    expect(linkCall).toBeDefined();
    expect((linkCall?.input as LinkExistingInput).eventId).toEqual(expect.any(String));
  });

  // Final review I2: Task 9's parent/child rule must hold through the real
  // wiring. `useWallets`' memoized reconcileCommand used to keep the FIRST
  // render's `onExpenseRecorded`, whose `parentOf` was built before
  // `useCategories` had loaded anything -- so a child-category expense never
  // matched a parent-category bill in the running app.
  async function recordAgainstUtilitiesBill(pick: 'Utilities' | 'Internet') {
    const user = userEvent.setup();
    window.localStorage.removeItem('budget:last-wallet:personal-space');
    const today = new Date();
    const dueDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const categories = new InMemoryCategoriesGateway();
    categories.categories = [
      { id: 'category-utilities', spaceId: 'personal-space', kind: 'expense', nameEn: 'Utilities', nameAr: 'مرافق',
        parentCategoryId: null, createdAt: '2026-09-08T10:00:00Z', archivedAt: null },
      { id: 'category-internet', spaceId: 'personal-space', kind: 'expense', nameEn: 'Internet', nameAr: 'إنترنت',
        parentCategoryId: 'category-utilities', createdAt: '2026-09-08T10:01:00Z', archivedAt: null },
    ];
    const recurring = new InMemoryRecurringGateway();
    recurring.page = {
      rows: [{
        ...coreOccurrenceRowFixture, nameEn: 'Utilities bill', dueDate, asOf: dueDate, categoryId: 'category-utilities',
        expectedMinor: '1000', settledMinor: '0', remainingMinor: '1000', state: 'pending',
      }],
      hasMore: false, nextCursor: null, asOf: dueDate,
    };
    renderHome(gateways({ categories, recurring }), { recordOpen: true });

    await user.click(await screen.findByRole('button', { name: 'Expense' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    for (const key of ['1', '0']) await user.click(screen.getByRole('button', { name: key }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: /Daily USD/ }));
    if (pick === 'Internet') await user.click(await screen.findByRole('button', { name: 'Expand Utilities' }));
    await user.click(await screen.findByRole('button', { name: pick }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    return recurring;
  }

  it('links a same-category expense to its bill (control)', async () => {
    const recurring = await recordAgainstUtilitiesBill('Utilities');
    expect((await screen.findByText(/Marked/)).closest('p')).toHaveTextContent('Marked "Utilities bill" as paid.');
    expect(recurring.calls.filter((call) => call.name === 'linkExisting')).toHaveLength(1);
  });

  it('links an expense on the child "Internet" to the bill on its parent "Utilities"', async () => {
    const recurring = await recordAgainstUtilitiesBill('Internet');
    expect((await screen.findByText(/Marked/)).closest('p')).toHaveTextContent('Marked "Utilities bill" as paid.');
    expect(recurring.calls.filter((call) => call.name === 'linkExisting')).toHaveLength(1);
  });
});

/** Settles the linked row, the way the server's next read would show it. */
class SettlingRecurringGateway extends InMemoryRecurringGateway {
  override async linkExisting(input: LinkExistingInput) {
    const result = await super.linkExisting(input);
    this.page = {
      ...this.page,
      rows: this.page.rows.map((row) => (row.id === input.occurrenceId
        ? { ...row, state: 'settled' as const, settledMinor: row.expectedMinor, remainingMinor: '0' }
        : row)),
    };
    return result;
  }
}

// Final review M7: a settle notice must not sit above a mounted list or cash
// section that still shows the bill as unpaid.
describe('ControlRoomRoutes refreshes mounted Plan sections after a settle', () => {
  function groceriesSetup() {
    window.localStorage.removeItem('budget:last-wallet:personal-space');
    const today = new Date();
    const dueDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const categories = new InMemoryCategoriesGateway();
    categories.categories = [{
      id: 'category-groceries', spaceId: 'personal-space', kind: 'expense',
      nameEn: 'Groceries', nameAr: 'بقالة', parentCategoryId: null,
      createdAt: '2026-09-08T10:00:00Z', archivedAt: null,
    }];
    const recurring = new SettlingRecurringGateway();
    recurring.page = {
      rows: [{
        ...coreOccurrenceRowFixture, nameEn: 'Groceries bill', dueDate, asOf: dueDate, categoryId: 'category-groceries',
        expectedMinor: '1000', settledMinor: '0', remainingMinor: '1000', state: 'pending',
      }],
      hasMore: false, nextCursor: null, asOf: dueDate,
    };
    const cashControl = new InMemoryCashControlGateway();
    const gatewaysBag = gateways({ categories, recurring });
    gatewaysBag.cashControl = cashControl;
    const props = {
      locale: 'en' as const, spaceId: 'personal-space', spaceKind: 'personal' as const, destination: 'plan' as const,
      gateways: gatewaysBag, onCloseRecord: () => undefined,
    };
    return { recurring, cashControl, props };
  }

  async function recordTenDollarGroceries(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Expense' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    for (const key of ['1', '0']) await user.click(screen.getByRole('button', { name: key }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: /Daily USD/ }));
    await user.click(screen.getByRole('button', { name: 'Groceries' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByText(/Marked/);
  }

  it('reloads a mounted Upcoming bills list, so the settled bill reads Paid under the notice', async () => {
    const user = userEvent.setup();
    const { props } = groceriesSetup();
    const { rerender } = render(<ControlRoomRoutes {...props} recordOpen={false} />);
    await user.click(await screen.findByRole('button', { name: 'Upcoming bills' }));
    const bills = await screen.findByRole('region', { name: 'Upcoming bills' });
    expect(await within(bills).findByText('Due', { selector: '.rec-badge' })).toBeInTheDocument();

    rerender(<ControlRoomRoutes {...props} recordOpen />);
    await recordTenDollarGroceries(user);

    expect(await within(bills).findByText('Paid', { selector: '.rec-badge' })).toBeInTheDocument();
  });

  it('reloads a mounted Available cash section after a settle', async () => {
    const user = userEvent.setup();
    const { props, cashControl } = groceriesSetup();
    const { rerender } = render(<ControlRoomRoutes {...props} recordOpen={false} />);
    await user.click(await screen.findByRole('button', { name: 'Available cash' }));
    await waitFor(() => expect(cashControl.calls.filter((call) => call.name === 'loadAvailable')).toHaveLength(1));

    rerender(<ControlRoomRoutes {...props} recordOpen />);
    await recordTenDollarGroceries(user);

    await waitFor(() => expect(cashControl.calls.filter((call) => call.name === 'loadAvailable')).toHaveLength(2));
    expect(cashControl.calls.filter((call) => call.name === 'loadOutlook')).toHaveLength(2);
  });
});

/** `publish_allocation_month` writes a new income revision through
 * `set_monthly_income_plan`, so the Plan summary reports it on its next
 * read -- linked here the way the two server reads are. */
class PlanLinkedAllocationGateway extends InMemoryAllocationGateway {
  readonly plan: InMemoryPlanClient;

  constructor(plan: InMemoryPlanClient) {
    super();
    this.plan = plan;
  }

  override async publishMonth(input: PublishMonthInput) {
    const result = await super.publishMonth(input);
    this.plan.summaries = this.plan.summaries.map((summary) => (summary.currency === input.currency
      ? { ...summary, incomePlanRevisionId: result.incomeRevisionId }
      : summary));
    return result;
  }
}

// Final review M5: the Plan heads a publish consumed go stale the moment it
// succeeds; a second Confirm in the same visit must send the new ones.
describe('ControlRoomRoutes allocation publish, twice in one visit', () => {
  it('sends the refreshed Plan income head on the second publish, which succeeds', async () => {
    const user = userEvent.setup();
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const plan = new InMemoryPlanClient();
    plan.summaries = [{
      currency: 'USD', plannedIncomeMinor: '300000', actualIncomeMinor: '0',
      categoryTargetTotalMinor: '0', categoryActualSpentMinor: '0', uncategorizedSpentMinor: '0',
      categoryOverspentMinor: '0', actualLoanRepaymentMinor: '0', remainingLoanReservationMinor: '0',
      loanCommitmentMinor: '0', unallocatedMinor: '300000', overallocatedMinor: '0',
      incomePlanRevisionId: 'rev-income-0',
    }];
    const allocation = new PlanLinkedAllocationGateway(plan);
    allocation.incomeHeads.set(`${month}|USD`, 'rev-income-0');
    const gatewaysBag = gateways({});
    gatewaysBag.plan = plan;
    gatewaysBag.allocation = allocation;
    render(
      <ControlRoomRoutes locale="en" spaceId="personal-space" spaceKind="personal" destination="plan"
        gateways={gatewaysBag} recordOpen={false} onCloseRecord={() => undefined} />,
    );
    await user.click(await screen.findByRole('button', { name: 'Allocation' }));

    async function publishOnce() {
      await user.click(await screen.findByRole('button', { name: 'Set up' }));
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await user.click(screen.getByRole('button', { name: 'Confirm' }));
      await screen.findByRole('button', { name: 'Set up' });
    }
    await publishOnce();
    await publishOnce();

    const publishes = allocation.calls.filter((call) => call.name === 'publishMonth').map((call) => call.input as PublishMonthInput);
    expect(publishes.map((input) => input.expectedIncomeRevisionId)).toEqual(['rev-income-0', '1']);
    expect(allocation.incomeHeads.get(`${month}|USD`)).toBe('2');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ControlRoomRoutes plan destination', () => {
  it('shows available cash, reservations, and forecast in separate cards', async () => {
    const user = userEvent.setup();
    const cashControl = new InMemoryCashControlGateway();
    cashControl.available = coreAvailableCashSummaryFixture;
    cashControl.outlook = coreCashOutlookFixture;
    const gatewaysBag = gateways({});
    gatewaysBag.cashControl = cashControl;
    renderHome(gatewaysBag, { destination: 'plan' });

    await user.click(within(screen.getByRole('navigation', { name: 'Plan sections' }))
      .getByRole('button', { name: 'Available cash' }));

    const summary = await screen.findByRole('region', { name: 'Available after commitments USD' });
    const reservations = await screen.findByRole('region', { name: 'Reservations by group USD' });
    const outlook = await screen.findByRole('region', { name: 'Expected outlook USD' });
    for (const card of [summary, reservations, outlook]) {
      expect(card.closest('.cr-card')).toBe(card);
    }
    expect(summary).not.toContainElement(reservations);
    expect(summary).not.toContainElement(outlook);
    expect(within(reservations).getByText('Essentials')).toBeInTheDocument();
    expect(within(outlook).getByRole('tablist', { name: 'Forecast scenario' })).toBeInTheDocument();
  });

  it('opens Plan Loans from a loan-linked wallet entry', async () => {
    const user = userEvent.setup();
    const gatewaysBag = gateways({});
    function ControlledRoutes() {
      const [destination, setDestination] = useState<ControlRoomDestination>('manage');
      return (
        <ControlRoomRoutes
          locale="en"
          spaceId="personal-space"
          spaceKind="personal"
          destination={destination}
          onDestinationChange={setDestination}
          gateways={gatewaysBag}
          recordOpen={false}
          onCloseRecord={() => undefined}
        />
      );
    }
    render(<ControlledRoutes />);

    await user.click(screen.getByRole('button', { name: 'Wallets' }));
    await user.click(await screen.findByRole('button', { name: 'View in Loans' }));

    const sections = await screen.findByRole('navigation', { name: 'Plan sections' });
    expect(within(sections).getByRole('button', { name: 'Loans' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('heading', { name: 'Loans' })).toBeInTheDocument();
  });

  it('switches the Plan loan register between USD and LBP', async () => {
    const user = userEvent.setup();
    renderHome(gateways({}), { destination: 'plan' });

    const sections = screen.getByRole('navigation', { name: 'Plan sections' });
    await user.click(within(sections).getByRole('button', { name: 'Loans' }));

    expect(await screen.findByRole('heading', { name: 'Loans' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Maya loan' })).toBeInTheDocument();
    const currencies = screen.getByRole('tablist', { name: 'Currency' });
    expect(screen.getByTestId('summary-USD')).toBeInTheDocument();
    await user.click(within(currencies).getByRole('tab', { name: 'LBP' }));
    expect(await screen.findByTestId('summary-LBP')).toBeInTheDocument();
    expect(screen.queryByTestId('summary-USD')).not.toBeInTheDocument();
    expect(within(sections).getByRole('button', { name: 'Loans' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('uses one header currency control across Plan overview and Loans', async () => {
    const user = userEvent.setup();
    const plan = new InMemoryPlanClient();
    plan.summaries = (['USD', 'LBP'] as const).map((currency) => ({
      currency, plannedIncomeMinor: '300000', actualIncomeMinor: '0',
      categoryTargetTotalMinor: '0', categoryActualSpentMinor: '0', uncategorizedSpentMinor: '0',
      categoryOverspentMinor: '0', actualLoanRepaymentMinor: '0', remainingLoanReservationMinor: '0',
      loanCommitmentMinor: '0', unallocatedMinor: '300000', overallocatedMinor: '0',
      incomePlanRevisionId: `rev-income-${currency}`,
    }));
    const gatewaysBag = gateways({});
    gatewaysBag.plan = plan;
    renderHome(gatewaysBag, { destination: 'plan' });

    const currencyTabs = within(screen.getByRole('banner')).getByRole('tablist', { name: 'Currency' });
    expect(screen.getAllByRole('tablist', { name: 'Currency' })).toHaveLength(1);
    await user.click(within(currencyTabs).getByRole('tab', { name: 'LBP' }));
    expect(await screen.findByRole('region', { name: 'Planned income LBP' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Planned income USD' })).not.toBeInTheDocument();

    const sections = screen.getByRole('navigation', { name: 'Plan sections' });
    await user.click(within(sections).getByRole('button', { name: 'Loans' }));
    expect(screen.getAllByRole('tablist', { name: 'Currency' })).toHaveLength(1);
    expect(within(currencyTabs).getByRole('tab', { name: 'LBP' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByTestId('summary-LBP')).toBeInTheDocument();
    expect(screen.queryByTestId('summary-USD')).not.toBeInTheDocument();
  });

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

describe('ControlRoomRoutes journal undo', () => {
  it('reverses an entry on its own date, never on today', async () => {
    const user = userEvent.setup();
    const walletsGateway = new InMemoryWalletsGateway();
    walletsGateway.events = [{
      id: 'evt-old', spaceId: 'personal-space', requestId: 'req-old', kind: 'expense',
      effectiveDate: '2026-08-15', createdAt: '2026-08-15T09:00:00Z', reversalOf: null, reversedBy: null,
      loanLinked: false, payeeName: 'Market',
      movements: [{ walletId: walletsGateway.wallets[0]!.id, walletName: 'Cash', currency: 'USD', amountMinor: '-2500', walletArchived: false }],
    }];
    const reverse = vi.spyOn(walletsGateway, 'reverseEvent');
    renderHome(gateways({ wallets: walletsGateway }), { destination: 'journal' });
    await user.click(await screen.findByRole('button', { name: /Market/ }));
    await user.click(screen.getByRole('button', { name: 'Reverse' }));
    await waitFor(() => expect(reverse).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'evt-old', effectiveDate: '2026-08-15' })));
  });
});
