import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './app.js';
import type { AuthGateway, AuthUser } from './features/auth/types.js';
import type { Space } from './features/loans/types.js';
import { InMemoryCategoriesGateway } from './test/in-memory-categories-gateway.js';
import { InMemoryLoansGateway } from './test/in-memory-loans-gateway.js';
import type { WorkspaceGateway } from './features/workspace/types.js';
import { householdSpace, personalSpace } from './test/in-memory-loans-gateway.js';
import { InMemoryWalletsGateway } from './test/in-memory-wallets-gateway.js';
import { householdMemberId, householdOwnerId, InMemoryHouseholdGateway } from './test/in-memory-household-gateway.js';
import { createHouseholdInvitationBootstrap } from './features/household/invitation-fragment.js';

function authGateway(initial: AuthUser | null, session?: Promise<AuthUser | null>): AuthGateway {
  return {
    getSession: vi.fn(async () => session ? session : initial),
    subscribe: vi.fn(() => () => undefined),
    signIn: vi.fn(async (email: string) => ({ id: 'signed-in', email })),
    signUp: vi.fn(async (email: string) => ({ confirmationRequired: true, user: { id: 'pending', email } })),
    signOut: vi.fn(async () => undefined),
    resendConfirmation: vi.fn(async () => undefined),
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

function renderApp(props: Parameters<typeof App>[0] = {}) {
  return render(<App
    authGateway={authGateway({ id: 'user-1', email: 'owner@example.com' })}
    workspaceGateway={workspaceGateway()}
    householdGateway={new InMemoryHouseholdGateway()}
    loansGateway={new InMemoryLoansGateway()}
    walletsGateway={new InMemoryWalletsGateway()}
    categoriesGateway={new InMemoryCategoriesGateway()}
    {...props}
  />);
}

function rail() {
  return within(screen.getAllByRole('navigation', { name: 'Workspace' })[0]!);
}

describe('App', () => {
  it('shows a safe configuration state when Supabase settings are absent', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    try {
      render(<App />);
      expect(screen.getByRole('heading', { name: 'Configuration needed' })).toBeInTheDocument();
      expect(screen.queryByText('Maya')).not.toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('never exposes financial content while the initial session is loading', () => {
    render(<App authGateway={authGateway(null, new Promise(() => undefined))} workspaceGateway={workspaceGateway()} householdGateway={new InMemoryHouseholdGateway()} loansGateway={new InMemoryLoansGateway()} walletsGateway={new InMemoryWalletsGateway()} categoriesGateway={new InMemoryCategoriesGateway()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
    expect(screen.getByRole('main')).toHaveClass('workspace-state-page');
    expect(screen.queryByRole('heading', { name: 'Loans' })).not.toBeInTheDocument();
    expect(screen.queryByText('Maya')).not.toBeInTheDocument();
  });

  it('shows the signed-out experience when no browser session exists', async () => {
    render(<App authGateway={authGateway(null)} workspaceGateway={workspaceGateway()} householdGateway={new InMemoryHouseholdGateway()} loansGateway={new InMemoryLoansGateway()} walletsGateway={new InMemoryWalletsGateway()} categoriesGateway={new InMemoryCategoriesGateway()} />);
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('mounts the control room shell only for an authenticated session', async () => {
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Personal space' })).toBeInTheDocument();
    for (const name of ['Home', 'Journal', 'Plan', 'Manage', 'Record']) {
      expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole('button', { name: 'Home' })[0]).toHaveAttribute('aria-current', 'page');
  });

  it('switches destinations inside one authenticated shell', async () => {
    const user = userEvent.setup();
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Personal space' })).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Journal' })[0]!);
    expect(await screen.findByRole('heading', { name: 'Journal' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Journal' })[0]).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByRole('button', { name: 'Home' })[0]).not.toHaveAttribute('aria-current');

    await user.click(screen.getAllByRole('button', { name: 'Plan' })[0]!);
    expect(await screen.findByText('Could not load the monthly plan.')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Manage' })[0]!);
    expect(await screen.findByRole('navigation', { name: 'Manage sections' })).toBeInTheDocument();
  });

  it('record action does not navigate away from the active destination', async () => {
    const user = userEvent.setup();
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Personal space' })).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Record' })[0]!);

    expect(screen.getByRole('heading', { name: 'Personal space' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Home' })[0]).toHaveAttribute('aria-current', 'page');
  });

  it('lets a signed-in owner add another space from the shell and selects it', async () => {
    const user = userEvent.setup();
    const spaces: Space[] = [personalSpace];
    const gateway: WorkspaceGateway = {
      listSpaces: vi.fn(async () => spaces),
      listWallets: vi.fn(async () => []),
      createSpace: vi.fn(async (input) => {
        spaces.push({ id: 'household-space', name: input.name, kind: input.kind });
        return { id: 'household-space' };
      }),
      createWallet: vi.fn(async () => ({ id: 'new-wallet' })),
    };
    renderApp({ workspaceGateway: gateway });
    expect(await screen.findByRole('heading', { name: 'Personal space' })).toBeInTheDocument();

    const nav = rail();
    await user.click(nav.getByRole('button', { name: 'Current space: My money' }));
    await user.click(nav.getByRole('menuitem', { name: 'Add another space' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add another space' });
    await user.click(within(dialog).getByRole('radio', { name: 'Household space' }));
    await user.type(within(dialog).getByLabelText('Space name'), 'Our home');
    await user.click(within(dialog).getByRole('button', { name: 'Create household space' }));
    await user.type(screen.getByLabelText('Wallet name'), 'Home cash');
    await user.click(screen.getByRole('button', { name: 'Create USD wallet' }));

    expect(gateway.createSpace).toHaveBeenCalledWith({ name: 'Our home', kind: 'household' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add another space' })).not.toBeInTheDocument());
    expect(await rail().findByRole('button', { name: 'Current space: Our home' })).toBeInTheDocument();
  });

  it('shows onboarding instead of a Loans membership error when no spaces are visible', async () => {
    render(<App authGateway={authGateway({ id: 'user-1', email: 'owner@example.com' })} workspaceGateway={workspaceGateway([])} householdGateway={new InMemoryHouseholdGateway()} loansGateway={new InMemoryLoansGateway()} walletsGateway={new InMemoryWalletsGateway()} categoriesGateway={new InMemoryCategoriesGateway()} />);
    expect(await screen.findByRole('dialog', { name: 'Create your first space' })).toBeInTheDocument();
    expect(screen.queryByText('You no longer have access to this space')).not.toBeInTheDocument();
  });

  it('keeps the shell stable when switching from a household space to a personal space', async () => {
    const user = userEvent.setup();
    render(<App
      authGateway={authGateway({ id: householdOwnerId, email: 'owner@example.com' })}
      workspaceGateway={workspaceGateway([householdSpace, personalSpace])}
      householdGateway={new InMemoryHouseholdGateway()}
      loansGateway={new InMemoryLoansGateway()}
      walletsGateway={new InMemoryWalletsGateway()}
      categoriesGateway={new InMemoryCategoriesGateway()}
    />);
    expect(await screen.findByRole('heading', { name: 'Household space' })).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Manage' })[0]!);
    expect(await screen.findByRole('navigation', { name: 'Manage sections' })).toBeInTheDocument();

    const nav = rail();
    await user.click(nav.getByRole('button', { name: 'Current space: Home budget' }));
    await user.click(nav.getByRole('menuitem', { name: 'Switch to My money' }));
    expect(await screen.findByRole('navigation', { name: 'Manage sections' })).toBeInTheDocument();
    expect(await nav.findByRole('button', { name: 'Current space: My money' })).toBeInTheDocument();
  });

  it('accepts a fragment invitation before no-space onboarding and selects the new household', async () => {
    const user = userEvent.setup();
    let accepted = false;
    const householdGateway = new InMemoryHouseholdGateway();
    const originalAccept = householdGateway.acceptInvitation.bind(householdGateway);
    householdGateway.acceptInvitation = vi.fn(async (input) => {
      const result = await originalAccept(input);
      accepted = true;
      return result;
    });
    const workspace: WorkspaceGateway = {
      ...workspaceGateway([]),
      listSpaces: vi.fn(async () => accepted ? [householdSpace] : []),
    };
    const token = 'A'.repeat(43);
    const invitationBootstrap = createHouseholdInvitationBootstrap(token);
    render(<App
      householdInvitationBootstrap={invitationBootstrap}
      authGateway={authGateway({ id: householdMemberId, email: 'member@example.com' })}
      workspaceGateway={workspace}
      householdGateway={householdGateway}
      loansGateway={new InMemoryLoansGateway()}
      walletsGateway={new InMemoryWalletsGateway()}
      categoriesGateway={new InMemoryCategoriesGateway()}
    />);

    const dialog = await screen.findByRole('dialog', { name: 'Accept household invitation' });
    expect(invitationBootstrap.take()).toBeNull();
    expect(document.body).not.toHaveTextContent(token);
    expect(screen.queryByRole('dialog', { name: 'Create your first space' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Accept invitation' }));
    expect(await rail().findByRole('button', { name: 'Current space: Home budget' })).toBeInTheDocument();
    expect(rail().getAllByText('Home budget').some((element) => element.closest('bdi') !== null)).toBe(true);
  });

  it('shows one generic transport failure and retries with the same request ID', async () => {
    const user = userEvent.setup();
    const householdGateway = new InMemoryHouseholdGateway();
    householdGateway.failOnce = new Error('Failed to fetch');
    render(<App
      householdInvitationBootstrap={createHouseholdInvitationBootstrap('B'.repeat(43))}
      authGateway={authGateway({ id: householdMemberId, email: 'member@example.com' })}
      workspaceGateway={workspaceGateway([])}
      householdGateway={householdGateway}
      loansGateway={new InMemoryLoansGateway()}
      walletsGateway={new InMemoryWalletsGateway()}
      categoriesGateway={new InMemoryCategoriesGateway()}
    />);
    const dialog = await screen.findByRole('dialog', { name: 'Accept household invitation' });
    await user.click(within(dialog).getByRole('button', { name: 'Accept invitation' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('household request was not accepted');
    await user.click(within(dialog).getByRole('button', { name: 'Accept invitation' }));
    const requests = householdGateway.calls.filter((call) => call.name === 'acceptInvitation').map((call) => (call.input as { requestId: string }).requestId);
    expect(requests).toHaveLength(2);
    expect(new Set(requests).size).toBe(1);
  });
});
