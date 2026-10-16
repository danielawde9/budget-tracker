import { fireEvent, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { planMonth, type PlanMonth } from '../api/schemas.ts';
import { AccountsScreen } from '../screens/accounts/accounts.tsx';
import { PlanScreen } from '../screens/plan/plan.tsx';
import { fakeApi, fixtures, renderWithWorkspace } from '../test/harness.tsx';

function fundingPlan() {
  const base = fixtures.plan.groups[0]!;
  const item = base.flex!;
  const groups = [
    ['Essentials', 246600n, 81550n, 'expense'],
    ['Guilt free', 20550n, 20550n, 'expense'],
    ['Short-term goals', 61650n, 63000n, 'savings'],
    ['Savings', 41100n, 28200n, 'savings'],
    ['Investments', 41100n, 0n, 'savings'],
  ] as const;
  const plan = {
    ...fixtures.plan, groupsTotal: 411000n, funded: 326000n, stillToFund: 85000n,
    assignedFunding: 193300n, spentFromReady: 132700n,
    groups: groups.map(([nameEn, planned, funded, purpose], i) => ({
      ...base, groupId: `group-${i}`, nameEn, purpose, planned, funded, items: [],
      flex: { ...item, itemId: `item-${i}`, nameEn, planned, funded, stillToFund: planned > funded ? planned - funded : 0n },
    })),
  };
  return planMonth.parse(JSON.parse(JSON.stringify(plan, (_, v: unknown) => typeof v === 'bigint' ? v.toString() : v)));
}

describe('money breakdowns', () => {
  it('retains the server funding components needed to explain the overall shortfall', () => {
    expect(fundingPlan()).toMatchObject({ assignedFunding: 193300n, spentFromReady: 132700n, stillToFund: 85000n });
  });

  it('opens the wallet allocation breakdown without counting investments or changing money', async () => {
    const usd = fixtures.overview.currencies[0]!;
    const overview = { ...fixtures.overview, currencies: [{
      ...usd, currency: 'USD' as const, cashHeld: 165750n, ready: 0n, setAside: 165750n,
      wallets: [{ walletId: 'cash', name: 'Cash', balance: 165750n }],
      setAsideByGroup: [
        ['Short-term goals', 90000n], ['Savings', 28200n], ['Insurance', 10000n],
        ['Mazout', 10000n], ['Essentials', 12000n], ['Guilt free', 15550n],
      ].map(([nameEn, amount], i) => ({ groupId: `g-${i}`, nameEn: nameEn as string, nameAr: null, amount: amount as bigint })),
    }] };
    const api = fakeApi({ overview: async () => overview });
    renderWithWorkspace(<AccountsScreen onRecord={vi.fn()} />, api);
    await userEvent.click(await screen.findByRole('button', { name: /Wallet balance.*USD/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Wallet balance breakdown' });
    const allocations = within(dialog).getByRole('region', { name: 'Where your money is assigned' });
    expect(within(allocations).getByText('Short-term goals')).toBeVisible();
    expect(within(allocations).getByText('$900.00')).toBeVisible();
    expect(within(allocations).getByText('$155.50')).toBeVisible();
    expect(within(allocations).getByText('$1,657.50')).toBeVisible();
    expect(within(dialog).queryByText('$12,971.00')).not.toBeInTheDocument();
    expect(api.assignMoney).not.toHaveBeenCalled();
    expect(api.recordWalletOpening).not.toHaveBeenCalled();
    expect(api.savePlan).not.toHaveBeenCalled();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Wallet balance.*USD/ })).toHaveFocus();
  });

  it('explains the $850 with monthly assignments and direct Ready coverage, separate from savings balances', async () => {
    const plan = fundingPlan();
    const api = fakeApi({ planMonth: async () => plan });
    renderWithWorkspace(<PlanScreen month={plan.month} onRecord={vi.fn()} />, api);
    await userEvent.click(await screen.findByRole('button', { name: /Still to fund.*850/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Still to fund breakdown' });
    expect(within(dialog).getByText('$4,110.00')).toBeVisible();
    expect(within(dialog).getByText('$1,933.00')).toBeVisible();
    expect(within(dialog).getByText('$1,327.00')).toBeVisible();
    expect(within(dialog).getByText('$850.00')).toBeVisible();
    const goals = within(dialog).getByRole('row', { name: /Short-term goals/ });
    expect(within(goals).getByText('$616.50')).toBeVisible();
    expect(within(goals).getByText('$630.00')).toBeVisible();
    expect(within(goals).getByText('-$13.50')).toBeVisible();
    expect(api.assignMoney).not.toHaveBeenCalled();
    expect(api.savePlan).not.toHaveBeenCalled();
  });

  it('explains legacy category-based totals without fabricating direct Ready spending', async () => {
    const plan: PlanMonth = { ...fixtures.plan, stillToFund: 0n };
    renderWithWorkspace(<PlanScreen month={plan.month} onRecord={vi.fn()} />, fakeApi({ planMonth: async () => plan }));
    await userEvent.click(await screen.findByRole('button', { name: /Still to fund/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Spending covered directly from Ready to assign')).not.toBeInTheDocument();
  });
});
