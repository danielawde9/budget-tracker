import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { InMemoryPlanClient } from './test/in-memory-plan-client.js';

// These tests inject their own gateways. Avoid creating a real Supabase auth
// client for each mounted App, which leaves browser-context timers behind.
vi.mock('./lib/supabase.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/supabase.js')>(),
  createBrowserDataClient: () => null,
}));

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
    loadSpaceClock: vi.fn(async () => currentSpaceClock()),
    createSpace: vi.fn(async () => ({ id: 'new-space' })),
    createWallet: vi.fn(async () => ({ id: 'new-wallet' })),
  };
}

/** The server clock the fake workspace gateway reports; mirrors the browser
 * month/UTC-today shape the pre-W4a-1 shell used, so existing assertions hold. */
function currentSpaceClock(): { timezone: string; today: string; currentMonth: string } {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  return { timezone: 'UTC', today: now.toISOString().slice(0, 10), currentMonth };
}

function unconfiguredPlanClient(): InMemoryPlanClient {
  const client = new InMemoryPlanClient();
  client.error = new Error('plan backend not configured for this test shell');
  return client;
}

function seedWelcomeSeen(userId = 'user-1') {
  localStorage.setItem(`budget:welcome-seen:${userId}`, '1');
}

function renderApp(props: Parameters<typeof App>[0] = {}, options: { allowWelcomeTour?: boolean } = {}) {
  if (!options.allowWelcomeTour) seedWelcomeSeen();
  return render(<App
    authGateway={authGateway({ id: 'user-1', email: 'owner@example.com' })}
    workspaceGateway={workspaceGateway()}
    householdGateway={new InMemoryHouseholdGateway()}
    loansGateway={new InMemoryLoansGateway()}
    walletsGateway={new InMemoryWalletsGateway()}
    categoriesGateway={new InMemoryCategoriesGateway()}
    planClient={unconfiguredPlanClient()}
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
    const home = await screen.findByRole('heading', { name: 'Home' });
    expect(within(home.parentElement as HTMLElement).getByText('Personal space')).toBeInTheDocument();
    for (const name of ['Home', 'Journal', 'Plan', 'Manage', 'Record']) {
      expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole('button', { name: 'Home' })[0]).toHaveAttribute('aria-current', 'page');
  });

  it('switches destinations inside one authenticated shell', async () => {
    const user = userEvent.setup();
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();

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
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Record' })[0]!);

    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Home' })[0]).toHaveAttribute('aria-current', 'page');
  });

  it('lets a signed-in owner add another space from the shell and selects it', async () => {
    const user = userEvent.setup();
    const spaces: Space[] = [personalSpace];
    const gateway: WorkspaceGateway = {
      listSpaces: vi.fn(async () => spaces),
      listWallets: vi.fn(async () => []),
      loadSpaceClock: vi.fn(async () => currentSpaceClock()),
      createSpace: vi.fn(async (input) => {
        spaces.push({ id: 'household-space', name: input.name, kind: input.kind });
        return { id: 'household-space' };
      }),
      createWallet: vi.fn(async () => ({ id: 'new-wallet' })),
    };
    renderApp({ workspaceGateway: gateway });
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();

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
    seedWelcomeSeen(householdOwnerId);
    render(<App
      authGateway={authGateway({ id: householdOwnerId, email: 'owner@example.com' })}
      workspaceGateway={workspaceGateway([householdSpace, personalSpace])}
      householdGateway={new InMemoryHouseholdGateway()}
      loansGateway={new InMemoryLoansGateway()}
      walletsGateway={new InMemoryWalletsGateway()}
      categoriesGateway={new InMemoryCategoriesGateway()}
    />);
    const householdHome = await screen.findByRole('heading', { name: 'Home' });
    expect(within(householdHome.parentElement as HTMLElement).getByText('Household space')).toBeInTheDocument();

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
    seedWelcomeSeen(householdMemberId);
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

describe('App quick-add link', () => {
  function visit(path: string) {
    window.history.replaceState(null, '', path);
  }

  it('opens the Record sheet on Expense from ?add=expense, then removes the link', async () => {
    visit('/?add=expense');
    try {
      renderApp();
      const sheet = await screen.findByRole('dialog', { name: 'Record' });
      expect(within(sheet).getByLabelText('Amount')).toBeInTheDocument();
      expect(within(sheet).queryByRole('button', { name: 'Transfer' })).not.toBeInTheDocument();
      expect(window.location.search).toBe('');
    } finally {
      visit('/');
    }
  });

  it('opens the ordinary type grid from the Record button after a quick add was used', async () => {
    const user = userEvent.setup();
    visit('/?add=income');
    try {
      renderApp();
      const sheet = await screen.findByRole('dialog', { name: 'Record' });
      await user.keyboard('{Escape}');
      await waitFor(() => expect(sheet).not.toBeInTheDocument());
      await user.click(screen.getAllByRole('button', { name: 'Record' })[0]!);
      const reopened = await screen.findByRole('dialog', { name: 'Record' });
      expect(within(reopened).getByRole('button', { name: 'Transfer' })).toBeInTheDocument();
    } finally {
      visit('/');
    }
  });

  it('ignores an unknown quick-add value', async () => {
    visit('/?add=transfer');
    try {
      renderApp();
      expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: 'Record' })).not.toBeInTheDocument();
    } finally {
      visit('/');
    }
  });
});

describe('App welcome tour', () => {
  // Earlier tests in this file (and earlier cases in this block) can leave the
  // flag behind; each tour test starts from a clean "never seen" state.
  beforeEach(() => localStorage.removeItem('budget:welcome-seen:user-1'));

  it('shows the tour once over the shell and never again after dismissal', async () => {
    const user = userEvent.setup();
    const view = renderApp({}, { allowWelcomeTour: true });
    const tour = await screen.findByRole('dialog', { name: 'Welcome back!' });
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();

    await user.click(within(tour).getByRole('button', { name: 'Skip tour' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Welcome back!' })).not.toBeInTheDocument());
    expect(localStorage.getItem('budget:welcome-seen:user-1')).toBe('1');

    view.unmount();
    renderApp({}, { allowWelcomeTour: true });
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Welcome back!' })).not.toBeInTheDocument();
  });

  it('opens the record sheet from the Quick add step', async () => {
    const user = userEvent.setup();
    renderApp({}, { allowWelcomeTour: true });
    const tour = await screen.findByRole('dialog', { name: 'Welcome back!' });

    await user.click(within(tour).getByRole('button', { name: 'Try it →' }));
    // A string ByRole `name` is already a strict full-string match (no `exact`
    // option exists on ByRoleOptions in @testing-library/dom v10).
    expect(await screen.findByRole('dialog', { name: 'Record' })).toBeInTheDocument();
    expect(localStorage.getItem('budget:welcome-seen:user-1')).toBe('1');
  });

  it('deep-links into Plan goals from the third step', async () => {
    const user = userEvent.setup();
    renderApp({}, { allowWelcomeTour: true });
    const tour = await screen.findByRole('dialog', { name: 'Welcome back!' });

    await user.click(within(tour).getByRole('button', { name: 'Next' }));
    await user.click(within(tour).getByRole('button', { name: 'Next' }));
    await user.click(within(tour).getByRole('button', { name: 'Try it →' }));

    expect(screen.getAllByRole('button', { name: 'Plan' })[0]).toHaveAttribute('aria-current', 'page');
    const sections = await screen.findByRole('navigation', { name: 'Plan sections' });
    expect(within(sections).getByRole('button', { name: 'Goals' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('replays the tour from Manage preferences and deep-links into Household', async () => {
    const user = userEvent.setup();
    // [AMENDED] Household is only eligible in a household space (Task 3's
    // eligibility gate); the default personal-space gateway would fall back to the hub.
    renderApp({ workspaceGateway: workspaceGateway([householdSpace]) });
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Welcome back!' })).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Manage' })[0]!);
    await user.click(await screen.findByRole('button', { name: /Replay welcome tour/ }));
    const tour = await screen.findByRole('dialog', { name: 'Welcome back!' });

    await user.click(within(tour).getByRole('button', { name: 'Next' }));
    await user.click(within(tour).getByRole('button', { name: 'Next' }));
    await user.click(within(tour).getByRole('button', { name: 'Next' }));
    await user.click(within(tour).getByRole('button', { name: 'Try it →' }));

    expect(await screen.findByRole('button', { name: 'Back to manage sections' })).toBeInTheDocument();
  });

  it('defers the tour when a quick-add link opens the app', async () => {
    window.history.replaceState(null, '', '/?add=expense');
    try {
      renderApp({}, { allowWelcomeTour: true });
      expect(await screen.findByRole('dialog', { name: 'Record' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: 'Welcome back!' })).not.toBeInTheDocument();
      expect(localStorage.getItem('budget:welcome-seen:user-1')).toBeNull();
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });
});
