import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './app.js';
import type { AuthGateway, AuthUser } from './features/auth/types.js';
import { InMemoryCategoriesGateway } from './test/in-memory-categories-gateway.js';
import { InMemoryLoansGateway } from './test/in-memory-loans-gateway.js';
import type { WorkspaceGateway } from './features/workspace/types.js';
import { personalSpace } from './test/in-memory-loans-gateway.js';
import { InMemoryWalletsGateway } from './test/in-memory-wallets-gateway.js';

function authGateway(initial: AuthUser | null, session?: Promise<AuthUser | null>): AuthGateway {
  return {
    getSession: vi.fn(async () => session ? session : initial),
    subscribe: vi.fn(() => () => undefined),
    signIn: vi.fn(async (email: string) => ({ id: 'signed-in', email })),
    signUp: vi.fn(async (email: string) => ({ confirmationRequired: true, user: { id: 'pending', email } })),
    signOut: vi.fn(async () => undefined),
  };
}

function workspaceGateway(spaces = [personalSpace]): WorkspaceGateway {
  return {
    listSpaces: vi.fn(async () => spaces),
    listWallets: vi.fn(async () => []),
    createSpace: vi.fn(async () => ({ id: 'new-space' })),
    createWallet: vi.fn(async () => ({ id: 'new-wallet' })),
  };
}

describe('App', () => {
  it('shows a safe configuration state when Supabase settings are absent', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Configuration needed' })).toBeInTheDocument();
    expect(screen.queryByText('Maya')).not.toBeInTheDocument();
  });

  it('never exposes financial content while the initial session is loading', () => {
    render(<App authGateway={authGateway(null, new Promise(() => undefined))} workspaceGateway={workspaceGateway()} loansGateway={new InMemoryLoansGateway()} walletsGateway={new InMemoryWalletsGateway()} categoriesGateway={new InMemoryCategoriesGateway()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
    expect(screen.queryByRole('heading', { name: 'Loans' })).not.toBeInTheDocument();
    expect(screen.queryByText('Maya')).not.toBeInTheDocument();
  });

  it('shows the signed-out experience when no browser session exists', async () => {
    render(<App authGateway={authGateway(null)} workspaceGateway={workspaceGateway()} loansGateway={new InMemoryLoansGateway()} walletsGateway={new InMemoryWalletsGateway()} categoriesGateway={new InMemoryCategoriesGateway()} />);
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('mounts the existing Loans workspace only for an authenticated session', async () => {
    render(<App authGateway={authGateway({ id: 'user-1', email: 'owner@example.com' })} workspaceGateway={workspaceGateway()} loansGateway={new InMemoryLoansGateway()} walletsGateway={new InMemoryWalletsGateway()} categoriesGateway={new InMemoryCategoriesGateway()} />);
    await waitFor(() => expect(screen.getByText('Maya')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Loans' })).toBeInTheDocument();
  });

  it('switches between Loans, Wallets, and Categories inside one authenticated shell', async () => {
    const user = userEvent.setup();
    const categoriesGateway = new InMemoryCategoriesGateway();
    categoriesGateway.categories = categoriesGateway.categories.map((category) => ({ ...category, spaceId: 'personal-space' }));
    render(<App authGateway={authGateway({ id: 'user-1', email: 'owner@example.com' })} workspaceGateway={workspaceGateway()} loansGateway={new InMemoryLoansGateway()} walletsGateway={new InMemoryWalletsGateway()} categoriesGateway={categoriesGateway} />);
    expect(await screen.findByRole('heading', { name: 'Loans' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Wallets' }));
    expect(await screen.findByRole('heading', { name: 'Wallets' })).toBeInTheDocument();
    expect(await screen.findByText('$1,250.50')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Categories' }));
    expect(await screen.findByRole('heading', { name: 'Categories' })).toBeInTheDocument();
    expect(await screen.findByText('Salary')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Loans' }));
    expect(await screen.findByRole('heading', { name: 'Loans' })).toBeInTheDocument();
  });

  it('shows onboarding instead of a Loans membership error when no spaces are visible', async () => {
    render(<App authGateway={authGateway({ id: 'user-1', email: 'owner@example.com' })} workspaceGateway={workspaceGateway([])} loansGateway={new InMemoryLoansGateway()} walletsGateway={new InMemoryWalletsGateway()} categoriesGateway={new InMemoryCategoriesGateway()} />);
    expect(await screen.findByRole('dialog', { name: 'Create your first space' })).toBeInTheDocument();
    expect(screen.queryByText('You no longer have access to this space')).not.toBeInTheDocument();
  });
});
