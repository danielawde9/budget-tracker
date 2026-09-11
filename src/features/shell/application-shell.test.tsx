import { render, screen, within } from '@testing-library/react';
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

    expect(screen.getByText('Budget ledger')).toBeInTheDocument();
    const space = screen.getByRole('combobox', { name: 'Current space' });
    expect(within(space).getByRole('option', { name: 'Home budget' })).toBeInTheDocument();
    expect(screen.getAllByText('Home budget').some((element) => element.closest('bdi') !== null)).toBe(true);
    expect(screen.getByText('Household space')).toBeInTheDocument();
    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(navigation).getAllByRole('button').at(0)).toHaveAccessibleName('Home');
    expect(within(navigation).queryByRole('button', { name: /Reports/i })).not.toBeInTheDocument();
    expect(within(navigation).getAllByTestId('navigation-icon')).toHaveLength(5);
    for (const icon of within(navigation).getAllByTestId('navigation-icon')) {
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
    expect(screen.getByRole('button', { name: 'Loans' })).toHaveAttribute('aria-current', 'page');
    const wallets = screen.getByRole('button', { name: 'Wallets' });
    const categories = screen.getByRole('button', { name: 'Categories' });
    expect(wallets).not.toBeDisabled();
    expect(categories).not.toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Home' }));
    expect(changeDestination).toHaveBeenCalledWith('home');
    await user.click(wallets);
    expect(changeDestination).toHaveBeenCalledWith('wallets');
    await user.click(categories);
    expect(changeDestination).toHaveBeenCalledWith('categories');

    await user.selectOptions(space, personalSpace.id);
    expect(changeSpace).toHaveBeenCalledWith(personalSpace.id);
    await user.click(screen.getByRole('button', { name: 'Add another space' }));
    expect(addSpace).toHaveBeenCalledOnce();
    await user.click(screen.getByText('Account'));
    expect(screen.getByText('owner@example.com').closest('bdi')).not.toBeNull();
    expect(screen.getByRole('note', { name: 'Backup readiness' })).toHaveTextContent(
      'Do not enter real financial data',
    );
    expect(screen.getByRole('note', { name: 'Backup readiness' })).toHaveTextContent(
      'Operator repository reference',
    );
    expect(screen.getByRole('note', { name: 'Backup readiness' })).toHaveTextContent(
      'docs/operations/backup-restore-runbook.md',
    );
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('provides equivalent Arabic labels and keeps sourced names isolated', () => {
    render(<ApplicationShell locale="ar" userEmail="owner@example.com" spaces={[householdSpace]} selectedSpace={householdSpace} activeDestination="wallets" onDestinationChange={vi.fn()} onSpaceChange={vi.fn()} onAddSpace={vi.fn()} onLocaleChange={vi.fn()} onSignOut={vi.fn()}><div>مساحة المحافظ</div></ApplicationShell>);
    expect(screen.getByRole('combobox', { name: 'المساحة الحالية' })).toBeInTheDocument();
    expect(screen.getByText('مساحة منزلية')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'المحافظ' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'القروض' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'الفئات' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument();
    expect(screen.getByRole('note', { name: 'جاهزية النسخ الاحتياطي' })).toHaveTextContent(
      'لا تُدخل بيانات مالية حقيقية',
    );
    expect(screen.getByRole('button', { name: 'المنزل' })).not.toHaveAttribute('aria-current');
  });

  it('marks each visible active destination as the current page', () => {
    const destinations = ['home', 'loans', 'wallets', 'categories', 'household'] as const;
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
