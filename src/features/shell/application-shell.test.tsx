import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { householdSpace, personalSpace } from '../../test/in-memory-loans-gateway.js';
import { ApplicationShell } from './application-shell.js';

describe('ApplicationShell', () => {
  it('shows identity, visible-space context, honest navigation, language, and account actions', async () => {
    const user = userEvent.setup();
    const changeSpace = vi.fn();
    const signOut = vi.fn();
    const changeDestination = vi.fn();
    const addSpace = vi.fn();
    render(<ApplicationShell locale="en" userEmail="owner@example.com" spaces={[personalSpace, householdSpace]} selectedSpace={householdSpace} activeDestination="loans" onDestinationChange={changeDestination} onSpaceChange={changeSpace} onAddSpace={addSpace} onLocaleChange={vi.fn()} onSignOut={signOut}><div>Loans workspace</div></ApplicationShell>);

    const rail = screen.getByRole('complementary');
    const railScreen = within(rail);
    expect(railScreen.getByText('Budget ledger')).toBeInTheDocument();
    const space = railScreen.getByRole('button', { name: 'Current space: Home budget' });
    expect(space).toHaveAttribute('aria-expanded', 'false');
    expect(railScreen.getAllByText('Home budget').some((element) => element.closest('bdi') !== null)).toBe(true);
    expect(railScreen.getByText('Household space')).toBeInTheDocument();
    const navigation = railScreen.getByRole('navigation', { name: 'Primary navigation' });
    expect(rail).toHaveClass('app-rail', 'app-rail--light');
    expect(within(navigation).getAllByRole('button').at(0)).toHaveAccessibleName('Overview');
    expect(within(navigation).getByRole('button', { name: 'Reports' })).toBeInTheDocument();
    expect(within(navigation).getAllByTestId('navigation-icon')).toHaveLength(6);
    for (const icon of within(navigation).getAllByTestId('navigation-icon')) {
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
    expect(railScreen.getByRole('button', { name: 'Loans' })).toHaveAttribute('aria-current', 'page');
    const wallets = railScreen.getByRole('button', { name: 'Wallets' });
    const categories = railScreen.getByRole('button', { name: 'Categories' });
    expect(wallets).not.toBeDisabled();
    expect(categories).not.toBeDisabled();

    await user.click(railScreen.getByRole('button', { name: 'Overview' }));
    expect(changeDestination).toHaveBeenCalledWith('home');
    await user.click(wallets);
    expect(changeDestination).toHaveBeenCalledWith('wallets');
    await user.click(categories);
    expect(changeDestination).toHaveBeenCalledWith('categories');
    await user.click(railScreen.getByRole('button', { name: 'Reports' }));
    expect(changeDestination).toHaveBeenCalledWith('reports');

    await user.click(space);
    await user.click(railScreen.getByRole('menuitem', { name: 'Switch to My money' }));
    expect(changeSpace).toHaveBeenCalledWith(personalSpace.id);
    await user.click(space);
    await user.click(railScreen.getByRole('menuitem', { name: 'Add another space' }));
    expect(addSpace).toHaveBeenCalledOnce();
    await user.click(railScreen.getByText('Account'));
    expect(railScreen.getByText('owner@example.com').closest('bdi')).not.toBeNull();
    const backupDetails = rail.querySelector<HTMLDetailsElement>('details.backup-details');
    expect(backupDetails).not.toBeNull();
    expect(backupDetails).not.toHaveAttribute('open');
    expect(railScreen.getByRole('note', { name: 'Backup readiness' })).toHaveTextContent(
      'Do not enter real financial data',
    );
    expect(railScreen.getByRole('note', { name: 'Backup readiness' })).toHaveTextContent(
      'Operator repository reference',
    );
    expect(railScreen.getByRole('note', { name: 'Backup readiness' })).toHaveTextContent(
      'docs/operations/backup-restore-runbook.md',
    );
    await user.click(railScreen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('groups available destinations by task and exposes Reports', () => {
    render(<ApplicationShell locale="en" userEmail="owner@example.com" spaces={[householdSpace]} selectedSpace={householdSpace} activeDestination="home" onDestinationChange={vi.fn()} onSpaceChange={vi.fn()} onAddSpace={vi.fn()} onLocaleChange={vi.fn()} onSignOut={vi.fn()}><div>Overview</div></ApplicationShell>);

    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(navigation).getByRole('heading', { name: 'Daily money' })).toBeInTheDocument();
    expect(within(navigation).getByRole('heading', { name: 'Review' })).toBeInTheDocument();
    expect(within(navigation).getByRole('heading', { name: 'Setup' })).toBeInTheDocument();
    expect(within(navigation).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Overview', 'Wallets', 'Loans', 'Reports', 'Categories', 'Household',
    ]);
  });

  it('uses one space switcher for changing the selected space', async () => {
    const user = userEvent.setup();
    const changeSpace = vi.fn();
    render(<ApplicationShell locale="en" userEmail="owner@example.com" spaces={[personalSpace, householdSpace]} selectedSpace={householdSpace} activeDestination="home" onDestinationChange={vi.fn()} onSpaceChange={changeSpace} onAddSpace={vi.fn()} onLocaleChange={vi.fn()} onSignOut={vi.fn()}><div>Overview</div></ApplicationShell>);

    const rail = screen.getByRole('complementary');
    const railScreen = within(rail);
    const switcher = railScreen.getByRole('button', { name: /Current space: Home budget/ });
    await user.click(switcher);
    await user.click(railScreen.getByRole('menuitem', { name: 'Switch to My money' }));
    expect(changeSpace).toHaveBeenCalledWith(personalSpace.id);
    expect(railScreen.getAllByText('Home budget').filter((element) => element.closest('bdi'))).toHaveLength(1);
  });

  it('closes the mobile navigation drawer with Escape and restores Menu focus', async () => {
    const user = userEvent.setup();
    render(<ApplicationShell locale="en" userEmail="owner@example.com" spaces={[householdSpace]} selectedSpace={householdSpace} activeDestination="home" onDestinationChange={vi.fn()} onSpaceChange={vi.fn()} onAddSpace={vi.fn()} onLocaleChange={vi.fn()} onSignOut={vi.fn()}><div>Overview</div></ApplicationShell>);

    const menu = screen.getByRole('button', { name: 'Menu' });
    await user.click(menu);
    expect(screen.getByRole('dialog', { name: 'Navigation menu' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Navigation menu' })).not.toBeInTheDocument();
    await waitFor(() => expect(menu).toHaveFocus());
  });

  it('dispatches a destination and closes the mobile navigation drawer', async () => {
    const user = userEvent.setup();
    const changeDestination = vi.fn();
    render(<ApplicationShell locale="en" userEmail="owner@example.com" spaces={[householdSpace]} selectedSpace={householdSpace} activeDestination="home" onDestinationChange={changeDestination} onSpaceChange={vi.fn()} onAddSpace={vi.fn()} onLocaleChange={vi.fn()} onSignOut={vi.fn()}><div>Overview</div></ApplicationShell>);

    await user.click(screen.getByRole('button', { name: 'Menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Navigation menu' });
    await user.click(within(dialog).getByRole('button', { name: 'Wallets' }));
    expect(changeDestination).toHaveBeenCalledWith('wallets');
    expect(screen.queryByRole('dialog', { name: 'Navigation menu' })).not.toBeInTheDocument();
  });

  it('provides equivalent Arabic labels and keeps sourced names isolated', () => {
    render(<ApplicationShell locale="ar" userEmail="owner@example.com" spaces={[householdSpace]} selectedSpace={householdSpace} activeDestination="wallets" onDestinationChange={vi.fn()} onSpaceChange={vi.fn()} onAddSpace={vi.fn()} onLocaleChange={vi.fn()} onSignOut={vi.fn()}><div>مساحة المحافظ</div></ApplicationShell>);
    const railScreen = within(screen.getByRole('complementary'));
    expect(railScreen.getByRole('button', { name: 'المساحة الحالية: Home budget' })).toBeInTheDocument();
    expect(railScreen.getByText('مساحة منزلية')).toBeInTheDocument();
    expect(railScreen.getByRole('button', { name: 'المحافظ' })).toHaveAttribute('aria-current', 'page');
    expect(railScreen.getByRole('button', { name: 'القروض' })).not.toHaveAttribute('aria-current');
    expect(railScreen.getByRole('button', { name: 'الفئات' })).not.toHaveAttribute('aria-current');
    expect(railScreen.getByRole('button', { name: 'التقارير' })).not.toHaveAttribute('aria-current');
    expect(railScreen.getByRole('button', { name: 'English' })).toBeInTheDocument();
    expect(railScreen.getByRole('note', { name: 'جاهزية النسخ الاحتياطي' })).toHaveTextContent(
      'لا تُدخل بيانات مالية حقيقية',
    );
    expect(railScreen.getByRole('button', { name: 'المنزل' })).not.toHaveAttribute('aria-current');
  });

  it('marks each visible active destination as the current page', () => {
    const destinations = ['home', 'loans', 'wallets', 'categories', 'reports', 'household'] as const;
    for (const activeDestination of destinations) {
      const { unmount } = render(<ApplicationShell locale="en" userEmail="owner@example.com" spaces={[householdSpace]} selectedSpace={householdSpace} activeDestination={activeDestination} onDestinationChange={vi.fn()} onSpaceChange={vi.fn()} onAddSpace={vi.fn()} onLocaleChange={vi.fn()} onSignOut={vi.fn()}><div>Workspace</div></ApplicationShell>);
      expect(screen.getByRole('button', { current: 'page' })).toBeInTheDocument();
      unmount();
    }
  });

  it('exposes Household navigation only for a selected household space', async () => {
    const user = userEvent.setup();
    const changeDestination = vi.fn();
    const { rerender } = render(<ApplicationShell locale="en" userEmail="owner@example.com" spaces={[personalSpace, householdSpace]} selectedSpace={householdSpace} activeDestination="household" onDestinationChange={changeDestination} onSpaceChange={vi.fn()} onAddSpace={vi.fn()} onLocaleChange={vi.fn()} onSignOut={vi.fn()}><div>Household workspace</div></ApplicationShell>);
    const household = screen.getByRole('button', { name: 'Household' });
    expect(household).toHaveAttribute('aria-current', 'page');
    await user.click(household);
    expect(changeDestination).toHaveBeenCalledWith('household');

    rerender(<ApplicationShell locale="en" userEmail="owner@example.com" spaces={[personalSpace, householdSpace]} selectedSpace={personalSpace} activeDestination="loans" onDestinationChange={changeDestination} onSpaceChange={vi.fn()} onAddSpace={vi.fn()} onLocaleChange={vi.fn()} onSignOut={vi.fn()}><div>Loans workspace</div></ApplicationShell>);
    expect(screen.queryByRole('button', { name: 'Household' })).not.toBeInTheDocument();
  });
});
