import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './app.js';
import type { AuthGateway, AuthUser } from './features/auth/types.js';
import { InMemoryLoansGateway } from './test/in-memory-loans-gateway.js';
import type { WorkspaceGateway } from './features/workspace/types.js';
import { personalSpace } from './test/in-memory-loans-gateway.js';

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
    render(<App authGateway={authGateway(null, new Promise(() => undefined))} workspaceGateway={workspaceGateway()} loansGateway={new InMemoryLoansGateway()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
    expect(screen.queryByRole('heading', { name: 'Loans' })).not.toBeInTheDocument();
    expect(screen.queryByText('Maya')).not.toBeInTheDocument();
  });

  it('shows the signed-out experience when no browser session exists', async () => {
    render(<App authGateway={authGateway(null)} workspaceGateway={workspaceGateway()} loansGateway={new InMemoryLoansGateway()} />);
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('mounts the existing Loans workspace only for an authenticated session', async () => {
    render(<App authGateway={authGateway({ id: 'user-1', email: 'owner@example.com' })} workspaceGateway={workspaceGateway()} loansGateway={new InMemoryLoansGateway()} />);
    await waitFor(() => expect(screen.getByText('Maya')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Loans' })).toBeInTheDocument();
  });

  it('shows onboarding instead of a Loans membership error when no spaces are visible', async () => {
    render(<App authGateway={authGateway({ id: 'user-1', email: 'owner@example.com' })} workspaceGateway={workspaceGateway([])} loansGateway={new InMemoryLoansGateway()} />);
    expect(await screen.findByRole('dialog', { name: 'Create your first space' })).toBeInTheDocument();
    expect(screen.queryByText('You no longer have access to this space')).not.toBeInTheDocument();
  });
});
