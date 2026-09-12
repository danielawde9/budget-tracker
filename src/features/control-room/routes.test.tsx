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

function gateways(overrides: { insights?: InsightsClient; reports?: ReportsGateway }): ControlRoomGateways {
  return {
    wallets: new InMemoryWalletsGateway(),
    loans: new InMemoryLoansGateway(),
    categories: new InMemoryCategoriesGateway(),
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
