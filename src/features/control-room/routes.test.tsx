import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { InsightsClient, CategoryBudgetRow } from '../insights/types.js';
import type { MonthlyCashSummary, ReportsGateway } from '../reports/types.js';
import { InMemoryCategoriesGateway } from '../../test/in-memory-categories-gateway.js';
import { InMemoryHouseholdGateway } from '../../test/in-memory-household-gateway.js';
import { InMemoryLoansGateway } from '../../test/in-memory-loans-gateway.js';
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
