import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './app.js';
import type { AuthGateway, AuthUser } from './features/auth/types.js';
import { InMemoryLoansGateway } from './test/in-memory-loans-gateway.js';

function authGateway(initial: AuthUser | null, session?: Promise<AuthUser | null>): AuthGateway {
  return {
    getSession: vi.fn(async () => session ? session : initial),
    subscribe: vi.fn(() => () => undefined),
    signIn: vi.fn(async (email: string) => ({ id: 'signed-in', email })),
    signUp: vi.fn(async (email: string) => ({ confirmationRequired: true, user: { id: 'pending', email } })),
    signOut: vi.fn(async () => undefined),
  };
}

describe('App', () => {
  it('shows a safe configuration state when Supabase settings are absent', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Configuration needed' })).toBeInTheDocument();
    expect(screen.queryByText('Maya')).not.toBeInTheDocument();
  });

  it('never exposes financial content while the initial session is loading', () => {
    render(<App authGateway={authGateway(null, new Promise(() => undefined))} loansGateway={new InMemoryLoansGateway()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
    expect(screen.queryByRole('heading', { name: 'Loans' })).not.toBeInTheDocument();
    expect(screen.queryByText('Maya')).not.toBeInTheDocument();
  });

  it('shows the signed-out experience when no browser session exists', async () => {
    render(<App authGateway={authGateway(null)} loansGateway={new InMemoryLoansGateway()} />);
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('mounts the existing Loans workspace only for an authenticated session', async () => {
    render(<App authGateway={authGateway({ id: 'user-1', email: 'owner@example.com' })} loansGateway={new InMemoryLoansGateway()} />);
    await waitFor(() => expect(screen.getByText('Maya')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Loans' })).toBeInTheDocument();
  });
});
