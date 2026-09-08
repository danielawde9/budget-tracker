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
    render(<ApplicationShell locale="en" userEmail="owner@example.com" spaces={[personalSpace, householdSpace]} selectedSpace={householdSpace} activeDestination="loans" onDestinationChange={changeDestination} onSpaceChange={changeSpace} onLocaleChange={vi.fn()} onSignOut={signOut}><div>Loans workspace</div></ApplicationShell>);

    expect(screen.getByText('Budget ledger')).toBeInTheDocument();
    const space = screen.getByRole('combobox', { name: 'Current space' });
    expect(within(space).getByRole('option', { name: 'Home budget' })).toBeInTheDocument();
    expect(screen.getAllByText('Home budget').some((element) => element.closest('bdi') !== null)).toBe(true);
    expect(screen.getByText('Household space')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Loans' })).toHaveAttribute('aria-current', 'page');
    const wallets = screen.getByRole('button', { name: 'Wallets' });
    const categories = screen.getByRole('button', { name: 'Categories' });
    expect(wallets).not.toBeDisabled();
    expect(categories).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reports — coming later' })).toBeDisabled();

    await user.click(wallets);
    expect(changeDestination).toHaveBeenCalledWith('wallets');
    await user.click(categories);
    expect(changeDestination).toHaveBeenCalledWith('categories');

    await user.selectOptions(space, personalSpace.id);
    expect(changeSpace).toHaveBeenCalledWith(personalSpace.id);
    await user.click(screen.getByText('Account'));
    expect(screen.getByText('owner@example.com').closest('bdi')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('provides equivalent Arabic labels and keeps sourced names isolated', () => {
    render(<ApplicationShell locale="ar" userEmail="owner@example.com" spaces={[householdSpace]} selectedSpace={householdSpace} activeDestination="wallets" onDestinationChange={vi.fn()} onSpaceChange={vi.fn()} onLocaleChange={vi.fn()} onSignOut={vi.fn()}><div>مساحة المحافظ</div></ApplicationShell>);
    expect(screen.getByRole('combobox', { name: 'المساحة الحالية' })).toBeInTheDocument();
    expect(screen.getByText('مساحة منزلية')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'المحافظ' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'القروض' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'الفئات' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument();
  });
});
