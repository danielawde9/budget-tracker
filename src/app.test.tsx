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
import { InMemoryWalletsGateway, journalFixtures } from './test/in-memory-wallets-gateway.js';
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
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

  it('mounts the Home workspace only for an authenticated session', async () => {
    render(<App authGateway={authGateway({ id: 'user-1', email: 'owner@example.com' })} workspaceGateway={workspaceGateway()} householdGateway={new InMemoryHouseholdGateway()} loansGateway={new InMemoryLoansGateway()} walletsGateway={new InMemoryWalletsGateway()} categoriesGateway={new InMemoryCategoriesGateway()} />);
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });

  it('switches between Loans, Wallets, and Categories inside one authenticated shell', async () => {
    const user = userEvent.setup();
    const categoriesGateway = new InMemoryCategoriesGateway();
    categoriesGateway.categories = categoriesGateway.categories.map((category) => ({ ...category, spaceId: 'personal-space' }));
    render(<App authGateway={authGateway({ id: 'user-1', email: 'owner@example.com' })} workspaceGateway={workspaceGateway()} householdGateway={new InMemoryHouseholdGateway()} loansGateway={new InMemoryLoansGateway()} walletsGateway={new InMemoryWalletsGateway()} categoriesGateway={categoriesGateway} />);
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Wallets' }));
    expect(await screen.findByRole('heading', { name: 'Wallets' })).toBeInTheDocument();
    expect(await screen.findByText('$1,250.50')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Categories' }));
    expect(await screen.findByRole('heading', { name: 'Categories' })).toBeInTheDocument();
    expect(await screen.findByText('Salary')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Loans' }));
    expect(await screen.findByRole('heading', { name: 'Loans' })).toBeInTheDocument();
  });

  it('opens the existing transaction dialog from Home without recording a transaction', async () => {
    const user = userEvent.setup();
    const walletsGateway = new InMemoryWalletsGateway();
    render(<App authGateway={authGateway({ id: 'user-1', email: 'owner@example.com' })} workspaceGateway={workspaceGateway()} householdGateway={new InMemoryHouseholdGateway()} loansGateway={new InMemoryLoansGateway()} walletsGateway={walletsGateway} categoriesGateway={new InMemoryCategoriesGateway()} />);
    await screen.findByRole('heading', { name: 'Welcome back' });

    await user.click(screen.getByRole('button', { name: 'Record transaction' }));

    expect(await screen.findByRole('dialog', { name: 'Add a transaction' })).toBeInTheDocument();
    expect(walletsGateway.calls.some((call) => call.name === 'recordEvent')).toBe(false);
    expect(walletsGateway.calls.filter((call) => call.name === 'loadSnapshot')).toHaveLength(1);
  });

  it('shows a Home loading state instead of the first-wallet empty state while wallet data is pending', async () => {
    const snapshot = deferred<Awaited<ReturnType<InMemoryWalletsGateway['loadSnapshot']>>>();
    const walletsGateway = new InMemoryWalletsGateway();
    walletsGateway.loadSnapshot = vi.fn(() => snapshot.promise);
    render(<App authGateway={authGateway({ id: 'user-1', email: 'owner@example.com' })} workspaceGateway={workspaceGateway()} householdGateway={new InMemoryHouseholdGateway()} loansGateway={new InMemoryLoansGateway()} walletsGateway={walletsGateway} categoriesGateway={new InMemoryCategoriesGateway()} />);

    expect(await screen.findByRole('status', { name: 'Loading financial overview' })).toHaveTextContent('Loading your financial overview');
    expect(screen.queryByText('Create your first wallet to start tracking this space.')).not.toBeInTheDocument();
  });

  it('shows a Home retry state when the wallet read is rejected', async () => {
    const walletsGateway = new InMemoryWalletsGateway();
    walletsGateway.error = new Error('Network unavailable');
    render(<App authGateway={authGateway({ id: 'user-1', email: 'owner@example.com' })} workspaceGateway={workspaceGateway()} householdGateway={new InMemoryHouseholdGateway()} loansGateway={new InMemoryLoansGateway()} walletsGateway={walletsGateway} categoriesGateway={new InMemoryCategoriesGateway()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Wallets are unavailable');
    walletsGateway.error = null;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });

  it('keeps Home recent activity bounded to the initial journal page after pagination', async () => {
    const user = userEvent.setup();
    const walletsGateway = new InMemoryWalletsGateway();
    const initialEvent = journalFixtures[0]!;
    const olderEvent = { ...journalFixtures[1]!, id: 'older-event', requestId: 'older-request', effectiveDate: '2026-09-01' };
    walletsGateway.loadSnapshot = vi.fn(async (spaceId) => ({
      wallets: walletsGateway.wallets.filter((wallet) => wallet.spaceId === spaceId),
      archivedWallets: [],
      history: { events: [initialEvent], nextCursor: 'older-page' },
    }));
    walletsGateway.loadHistoryPage = vi.fn(async () => ({ events: [olderEvent], nextCursor: null }));
    render(<App authGateway={authGateway({ id: 'user-1', email: 'owner@example.com' })} workspaceGateway={workspaceGateway()} householdGateway={new InMemoryHouseholdGateway()} loansGateway={new InMemoryLoansGateway()} walletsGateway={walletsGateway} categoriesGateway={new InMemoryCategoriesGateway()} />);
    await screen.findByRole('heading', { name: 'Welcome back' });

    await user.click(screen.getByRole('button', { name: 'Wallets' }));
    await user.click(await screen.findByRole('button', { name: 'Load older entries' }));
    expect(await screen.findByText('2026-09-01')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Home' }));

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByText('2026-09-07')).toBeInTheDocument();
    expect(screen.queryByText('2026-09-01')).not.toBeInTheDocument();
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
    render(<App authGateway={authGateway({ id: 'user-1', email: 'owner@example.com' })} workspaceGateway={gateway} householdGateway={new InMemoryHouseholdGateway()} loansGateway={new InMemoryLoansGateway()} walletsGateway={new InMemoryWalletsGateway()} categoriesGateway={new InMemoryCategoriesGateway()} />);
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add another space' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add another space' });
    await user.click(within(dialog).getByRole('radio', { name: 'Household space' }));
    await user.type(within(dialog).getByLabelText('Space name'), 'Our home');
    await user.click(within(dialog).getByRole('button', { name: 'Create household space' }));
    await user.type(screen.getByLabelText('Wallet name'), 'Home cash');
    await user.click(screen.getByRole('button', { name: 'Create USD wallet' }));

    expect(gateway.createSpace).toHaveBeenCalledWith({ name: 'Our home', kind: 'household' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add another space' })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Current space' })).toHaveValue('household-space'));
  });

  it('shows onboarding instead of a Loans membership error when no spaces are visible', async () => {
    render(<App authGateway={authGateway({ id: 'user-1', email: 'owner@example.com' })} workspaceGateway={workspaceGateway([])} householdGateway={new InMemoryHouseholdGateway()} loansGateway={new InMemoryLoansGateway()} walletsGateway={new InMemoryWalletsGateway()} categoriesGateway={new InMemoryCategoriesGateway()} />);
    expect(await screen.findByRole('dialog', { name: 'Create your first space' })).toBeInTheDocument();
    expect(screen.queryByText('You no longer have access to this space')).not.toBeInTheDocument();
  });

  it('mounts Household for a selected household and returns to Loans after selecting personal space', async () => {
    const user = userEvent.setup();
    render(<App
      authGateway={authGateway({ id: householdOwnerId, email: 'owner@example.com' })}
      workspaceGateway={workspaceGateway([householdSpace, personalSpace])}
      householdGateway={new InMemoryHouseholdGateway()}
      loansGateway={new InMemoryLoansGateway()}
      walletsGateway={new InMemoryWalletsGateway()}
      categoriesGateway={new InMemoryCategoriesGateway()}
    />);
    await user.click(await screen.findByRole('button', { name: 'Household' }));
    expect(await screen.findByRole('heading', { name: 'Household access' })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Current space' }), personalSpace.id);
    expect(await screen.findByRole('heading', { name: 'Loans' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Household' })).not.toBeInTheDocument();
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
    expect(await screen.findByRole('combobox', { name: 'Current space' })).toHaveValue(householdSpace.id);
    expect(screen.getAllByText('Home budget').some((element) => element.closest('bdi') !== null)).toBe(true);
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
