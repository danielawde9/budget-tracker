import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Wallet } from '../loans/types.js';
import { personalSpace, householdSpace } from '../../test/in-memory-loans-gateway.js';
import type { SpaceClock } from './space-clock.js';
import type { WorkspaceGateway } from './types.js';
import { useWorkspace } from './use-workspace.js';

class FakeWorkspaceGateway implements WorkspaceGateway {
  spaces = [personalSpace, householdSpace];
  error: Error | null = null;
  mutationError: unknown = null;
  wallets: readonly Wallet[] = [];
  walletError: Error | null = null;
  clock: SpaceClock = { timezone: 'Asia/Beirut', today: '2026-09-15', currentMonth: '2026-09-01' };
  clockError: Error | null = null;
  /** Successive responses for `listWallets`, consumed before `wallets`. */
  walletReads: Array<readonly Wallet[]> = [];
  calls: string[] = [];

  async listSpaces() {
    this.calls.push('listSpaces');
    if (this.error) throw this.error;
    return this.spaces;
  }

  async loadSpaceClock(spaceId: string) {
    this.calls.push(`loadSpaceClock:${spaceId}`);
    if (this.clockError) throw this.clockError;
    return this.clock;
  }

  async listWallets(spaceId: string) {
    this.calls.push(`listWallets:${spaceId}`);
    if (this.walletError) throw this.walletError;
    const queued = this.walletReads.shift();
    return queued ?? this.wallets;
  }

  async createSpace() {
    this.calls.push('createSpace');
    if (this.mutationError) throw this.mutationError;
    return { id: 'new-space' };
  }

  async createWallet() {
    this.calls.push('createWallet');
    if (this.mutationError) throw this.mutationError;
    return { id: 'new-wallet' };
  }
}

const spaceWallet = (id: string, name: string, currency: Wallet['currency'] = 'USD'): Wallet => ({
  id, spaceId: personalSpace.id, name, currency, archivedAt: null,
});

function seedProgress(userId: string, spaceId: string, balanceRequestId = 'req-1') {
  localStorage.setItem(`budget:onboarding:${userId}`, JSON.stringify({ spaceId, balanceRequestId }));
}

describe('useWorkspace', () => {
  beforeEach(() => localStorage.clear());

  it('preserves a stored selection only while it remains visible', async () => {
    const gateway = new FakeWorkspaceGateway();
    localStorage.setItem('budget:selected-space:user-1', householdSpace.id);
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.selectedSpaceId).toBe(householdSpace.id);

    gateway.spaces = [personalSpace];
    await act(async () => result.current.refresh());
    expect(result.current.selectedSpaceId).toBe(personalSpace.id);
    expect(localStorage.getItem('budget:selected-space:user-1')).toBe(personalSpace.id);
  });

  it('shows onboarding for no spaces and recovers after a network retry', async () => {
    const gateway = new FakeWorkspaceGateway();
    gateway.error = new Error('Network request failed');
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toContain('could not load');

    gateway.error = null;
    gateway.spaces = [];
    await act(async () => result.current.refresh());
    expect(result.current.status).toBe('empty');
    expect(result.current.selectedSpaceId).toBe('');
  });

  it('revalidates a disappearing membership and never carries selection to another user', async () => {
    const gateway = new FakeWorkspaceGateway();
    const { result, rerender } = renderHook(({ userId }) => useWorkspace(gateway, userId), { initialProps: { userId: 'user-1' } });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.selectSpace(householdSpace.id));
    expect(result.current.selectedSpaceId).toBe(householdSpace.id);

    gateway.spaces = [personalSpace];
    await act(async () => result.current.refresh());
    expect(result.current.selectedSpaceId).toBe(personalSpace.id);

    localStorage.setItem('budget:selected-space:user-2', householdSpace.id);
    gateway.spaces = [householdSpace];
    rerender({ userId: 'user-2' });
    await waitFor(() => expect(result.current.selectedSpaceId).toBe(householdSpace.id));
    expect(localStorage.getItem('budget:selected-space:user-1')).toBe(personalSpace.id);
  });

  it('prefers a newly accepted household during the authoritative refresh', async () => {
    const gateway = new FakeWorkspaceGateway();
    gateway.spaces = [personalSpace];
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));
    await waitFor(() => expect(result.current.selectedSpaceId).toBe(personalSpace.id));

    gateway.spaces = [personalSpace, householdSpace];
    await act(async () => result.current.refresh(householdSpace.id));

    expect(result.current.selectedSpaceId).toBe(householdSpace.id);
    expect(localStorage.getItem('budget:selected-space:user-1')).toBe(householdSpace.id);
  });

  it('reconciles an ambiguous space failure before returning a deliberate retry error', async () => {
    const gateway = new FakeWorkspaceGateway();
    gateway.spaces = [];
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));
    await waitFor(() => expect(result.current.status).toBe('empty'));
    gateway.mutationError = new Error('Network request failed');

    await expect(result.current.createFirstSpace({ name: 'My money', kind: 'personal' })).rejects.toThrow('We checked your visible spaces');
    expect(gateway.calls.filter((call) => call === 'createSpace')).toHaveLength(1);
    expect(gateway.calls.filter((call) => call === 'listSpaces')).toHaveLength(2);
  });

  it('recovers an ambiguously-created space from a newly visible space of the same name', async () => {
    const gateway = new FakeWorkspaceGateway();
    gateway.spaces = [];
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));
    await waitFor(() => expect(result.current.status).toBe('empty'));
    gateway.mutationError = { message: 'upstream timeout' };
    gateway.spaces = [{ id: 'recovered-space', name: 'Our home', kind: 'household' }];

    await expect(result.current.createFirstSpace({ name: 'Our home', kind: 'household' })).resolves.toEqual({ id: 'recovered-space' });
    expect(gateway.calls.filter((call) => call === 'createSpace')).toHaveLength(1);
  });

  it('recovers an ambiguously-created wallet from a newly visible wallet of the same name and currency', async () => {
    const gateway = new FakeWorkspaceGateway();
    gateway.spaces = [personalSpace];
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    gateway.mutationError = { message: 'upstream timeout' };
    // The pre-read sees no wallet; the recovery read sees only the one just created.
    gateway.walletReads = [[], [spaceWallet('recovered-wallet', 'Home USD')]];

    await expect(result.current.createFirstWallet({ spaceId: personalSpace.id, name: 'Home USD', currency: 'USD' })).resolves.toEqual({ id: 'recovered-wallet' });
    expect(gateway.calls.filter((call) => call === 'createWallet')).toHaveLength(1);
  });

  it('does not recover an ambiguous space from a same-named space that was already visible', async () => {
    const gateway = new FakeWorkspaceGateway();
    gateway.spaces = [personalSpace];
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    gateway.mutationError = new Error('Network request failed');

    await expect(result.current.createFirstSpace({ name: personalSpace.name, kind: personalSpace.kind })).rejects.toThrow('Nothing matched');
  });

  it('does not recover an ambiguous wallet from a same-named wallet that was already visible', async () => {
    const gateway = new FakeWorkspaceGateway();
    gateway.spaces = [personalSpace];
    gateway.wallets = [spaceWallet('existing-wallet', 'Cash')];
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    gateway.mutationError = new Error('Network request failed');

    await expect(result.current.createFirstWallet({ spaceId: personalSpace.id, name: 'Cash', currency: 'USD' })).rejects.toThrow('Nothing matched');
  });

  it('resumes an unfinished first run at the wallet step', async () => {
    const gateway = new FakeWorkspaceGateway();
    gateway.spaces = [personalSpace];
    gateway.wallets = [];
    seedProgress('user-1', personalSpace.id);
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));

    await waitFor(() => expect(result.current.status).toBe('onboarding'));
    expect(result.current.onboardingSetup).toEqual({ spaceId: personalSpace.id, balanceRequestId: 'req-1' });
    expect(result.current.selectedSpaceId).toBe('');
  });

  it('resumes at the starting-balance step and clears progress when finished', async () => {
    const gateway = new FakeWorkspaceGateway();
    gateway.spaces = [personalSpace];
    gateway.wallets = [spaceWallet('w1', 'Cash')];
    seedProgress('user-1', personalSpace.id);
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));

    await waitFor(() => expect(result.current.status).toBe('onboarding'));
    expect(result.current.onboardingSetup).toEqual({ spaceId: personalSpace.id, balanceRequestId: 'req-1', wallet: { id: 'w1', currency: 'USD' } });

    await act(async () => { await result.current.finishOnboarding(personalSpace.id); });
    expect(result.current.status).toBe('ready');
    expect(result.current.onboardingSetup).toBeNull();
    expect(result.current.selectedSpaceId).toBe(personalSpace.id);
    expect(localStorage.getItem('budget:onboarding:user-1')).toBeNull();
  });

  it('shows the welcome tour once for an existing user and never again', async () => {
    const gateway = new FakeWorkspaceGateway();
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.showWelcome).toBe(true);

    act(() => result.current.dismissWelcome());
    expect(result.current.showWelcome).toBe(false);
    expect(localStorage.getItem('budget:welcome-seen:user-1')).toBe('1');

    await act(async () => result.current.refresh());
    expect(result.current.showWelcome).toBe(false);
  });

  it('replays the welcome tour after it was seen', async () => {
    localStorage.setItem('budget:welcome-seen:user-1', '1');
    const gateway = new FakeWorkspaceGateway();
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.showWelcome).toBe(false);

    act(() => result.current.replayWelcome());
    expect(result.current.showWelcome).toBe(true);
  });

  it('marks the tour seen when the first run finishes so new users skip it', async () => {
    const gateway = new FakeWorkspaceGateway();
    gateway.spaces = [personalSpace];
    gateway.wallets = [spaceWallet('w1', 'Cash')];
    seedProgress('user-1', personalSpace.id);
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));
    await waitFor(() => expect(result.current.status).toBe('onboarding'));
    expect(result.current.showWelcome).toBe(false);

    await act(async () => { await result.current.finishOnboarding(personalSpace.id); });
    expect(result.current.status).toBe('ready');
    expect(localStorage.getItem('budget:welcome-seen:user-1')).toBe('1');
    expect(result.current.showWelcome).toBe(false);
  });

  it('never offers the welcome tour before the workspace is ready', async () => {
    const gateway = new FakeWorkspaceGateway();
    gateway.error = new Error('Network request failed');
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.showWelcome).toBe(false);

    gateway.error = null;
    gateway.spaces = [];
    await act(async () => result.current.refresh());
    expect(result.current.status).toBe('empty');
    expect(result.current.showWelcome).toBe(false);
  });

  it('persists progress for the first run and drops it once no space can match', async () => {
    const gateway = new FakeWorkspaceGateway();
    gateway.spaces = [];
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));
    await waitFor(() => expect(result.current.status).toBe('empty'));
    act(() => result.current.saveOnboardingProgress({ spaceId: 'new-space', balanceRequestId: 'req-9' }));
    expect(JSON.parse(localStorage.getItem('budget:onboarding:user-1') ?? 'null')).toEqual({ spaceId: 'new-space', balanceRequestId: 'req-9' });

    gateway.spaces = [personalSpace];
    await act(async () => result.current.refresh());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(localStorage.getItem('budget:onboarding:user-1')).toBeNull();
  });

  it('ignores malformed or foreign-user setup progress', async () => {
    localStorage.setItem('budget:onboarding:user-1', '{not json');
    localStorage.setItem('budget:onboarding:user-2', JSON.stringify({ spaceId: householdSpace.id, balanceRequestId: 'req-2' }));
    const gateway = new FakeWorkspaceGateway();
    gateway.spaces = [personalSpace];
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.onboardingSetup).toBeNull();
  });

  it('never invokes the create_wallet mutation when the visible-wallet baseline is unknown', async () => {
    const gateway = new FakeWorkspaceGateway();
    gateway.spaces = [personalSpace];
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    gateway.walletError = new Error('Failed to fetch');

    await expect(result.current.createFirstWallet({ spaceId: personalSpace.id, name: 'Cash', currency: 'USD' })).rejects.toThrow('connection is still unavailable');
    expect(gateway.calls.filter((call) => call === 'createWallet')).toHaveLength(0);
  });
});
