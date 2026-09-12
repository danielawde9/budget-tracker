import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryCategoriesGateway } from '../../test/in-memory-categories-gateway.js';
import { InMemoryHouseholdGateway, householdOwnerId } from '../../test/in-memory-household-gateway.js';
import { InMemoryLoansGateway } from '../../test/in-memory-loans-gateway.js';
import { InMemoryWalletsGateway } from '../../test/in-memory-wallets-gateway.js';
import { ControlRoomRoutes } from './routes.js';
import type { ControlRoomGateways } from './routes.js';

function gateways(): ControlRoomGateways {
  return {
    wallets: new InMemoryWalletsGateway(),
    loans: new InMemoryLoansGateway(),
    categories: new InMemoryCategoriesGateway(),
    reports: { loadMonthlyComparison: vi.fn(async () => []) },
    household: new InMemoryHouseholdGateway(),
    plan: null,
    insights: { walletActivity: vi.fn(async () => []), categoryActualVsBudget: vi.fn(async () => []) },
    exchange: null,
  };
}

function renderManage(extra: Partial<Parameters<typeof ControlRoomRoutes>[0]> = {}) {
  return render(
    <ControlRoomRoutes
      locale="en"
      spaceId="personal-space"
      spaceKind="personal"
      destination="manage"
      gateways={gateways()}
      recordOpen={false}
      onCloseRecord={() => undefined}
      userId={householdOwnerId}
      spaceName="Test space"
      userEmail="dana@example.com"
      onLocaleChange={() => undefined}
      onSignOut={() => undefined}
      {...extra}
    />,
  );
}

describe('ManageScreen section menu', () => {
  it('lists Wallets, Categories, Loans, Language, and Account for a personal space', () => {
    renderManage();
    const menu = screen.getByRole('navigation', { name: 'Manage sections' });
    for (const name of ['Wallets', 'Categories', 'Loans', 'Language']) {
      expect(within(menu).getByRole('button', { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(within(menu).getByText('Account')).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(within(menu).queryByRole('button', { name: /Household/ })).not.toBeInTheDocument();
  });

  it('shows the Household section only for household spaces', () => {
    renderManage({ spaceKind: 'household' });
    const menu = screen.getByRole('navigation', { name: 'Manage sections' });
    for (const name of ['Wallets', 'Categories', 'Loans', 'Household']) {
      expect(within(menu).getByRole('button', { name: new RegExp(name) })).toBeInTheDocument();
    }
  });

  it('shows the current locale on the Language row and the email on the Account row', () => {
    renderManage();
    const menu = screen.getByRole('navigation', { name: 'Manage sections' });
    expect(within(menu).getByRole('button', { name: /Language/ })).toHaveTextContent('English');
    const account = within(menu).getByText('dana@example.com').closest('.cr-manage-account');
    expect(account).not.toBeNull();
    expect(within(account as HTMLElement).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('calls onLocaleChange from the Language row and onSignOut from the Account row', async () => {
    const user = userEvent.setup();
    const onLocaleChange = vi.fn();
    const onSignOut = vi.fn();
    renderManage({ onLocaleChange, onSignOut });
    const menu = screen.getByRole('navigation', { name: 'Manage sections' });
    await user.click(within(menu).getByRole('button', { name: /^Language/ }));
    expect(onLocaleChange).toHaveBeenCalled();
    await user.click(within(menu).getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalled();
  });
});

describe('ManageScreen section panels', () => {
  it('swaps to the wallets page and back to the section menu', async () => {
    const user = userEvent.setup();
    renderManage();
    await user.click(screen.getByRole('button', { name: /^Wallets/ }));
    expect(await screen.findByRole('heading', { name: 'Wallets' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back to manage sections' }));
    expect(screen.getByRole('navigation', { name: 'Manage sections' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Wallets' })).not.toBeInTheDocument();
  });

  it('swaps to the categories page', async () => {
    const user = userEvent.setup();
    renderManage();
    await user.click(screen.getByRole('button', { name: /^Categories/ }));
    expect(await screen.findByRole('heading', { name: 'Categories' })).toBeInTheDocument();
  });

  it('swaps to the loans page', async () => {
    const user = userEvent.setup();
    renderManage();
    await user.click(screen.getByRole('button', { name: /^Loans/ }));
    expect(await screen.findByRole('heading', { name: 'Loans' })).toBeInTheDocument();
  });

  it('swaps to the household page for household spaces', async () => {
    const user = userEvent.setup();
    renderManage({ spaceKind: 'household' });
    await user.click(screen.getByRole('button', { name: /^Household/ }));
    expect(await screen.findByRole('heading', { name: 'Household access' })).toBeInTheDocument();
  });

  it('resets to the section menu when the space switches away from a household space', async () => {
    const user = userEvent.setup();
    const bag = gateways();
    const props = {
      locale: 'en' as const,
      destination: 'manage' as const,
      gateways: bag,
      recordOpen: false,
      onCloseRecord: () => undefined,
      userId: householdOwnerId,
      spaceName: 'Test space',
      userEmail: 'dana@example.com',
      onLocaleChange: () => undefined,
      onSignOut: () => undefined,
    };
    const view = render(<ControlRoomRoutes {...props} spaceId="household-space" spaceKind="household" />);
    await user.click(screen.getByRole('button', { name: /^Household/ }));
    expect(await screen.findByRole('heading', { name: 'Household access' })).toBeInTheDocument();

    view.rerender(<ControlRoomRoutes {...props} spaceId="personal-space" spaceKind="personal" />);
    expect(await screen.findByRole('navigation', { name: 'Manage sections' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Household access' })).not.toBeInTheDocument();
  });
});
