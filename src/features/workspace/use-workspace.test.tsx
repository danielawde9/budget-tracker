import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { personalSpace, householdSpace } from '../../test/in-memory-loans-gateway.js';
import type { WorkspaceGateway } from './types.js';
import { useWorkspace } from './use-workspace.js';

class FakeWorkspaceGateway implements WorkspaceGateway {
  spaces = [personalSpace, householdSpace];
  error: Error | null = null;
  mutationError: Error | null = null;
  wallets: Awaited<ReturnType<WorkspaceGateway['listWallets']>> = [];
  calls: string[] = [];

  async listSpaces() {
    this.calls.push('listSpaces');
    if (this.error) throw this.error;
    return this.spaces;
  }

  async listWallets(spaceId: string) {
    this.calls.push(`listWallets:${spaceId}`);
    return this.wallets;
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

  it('recovers an ambiguously-created space or wallet from safe reads without resubmitting', async () => {
    const gateway = new FakeWorkspaceGateway();
    gateway.spaces = [];
    const { result } = renderHook(() => useWorkspace(gateway, 'user-1'));
    await waitFor(() => expect(result.current.status).toBe('empty'));
    gateway.mutationError = new Error('Failed to fetch');
    gateway.spaces = [{ id: 'recovered-space', name: 'Our home', kind: 'household' }];

    await expect(result.current.createFirstSpace({ name: 'Our home', kind: 'household' })).resolves.toEqual({ id: 'recovered-space' });
    gateway.wallets = [{ id: 'recovered-wallet', spaceId: 'recovered-space', name: 'Home USD', currency: 'USD', archivedAt: null }];
    await expect(result.current.createFirstWallet({ spaceId: 'recovered-space', name: 'Home USD', currency: 'USD' })).resolves.toEqual({ id: 'recovered-wallet' });
    expect(gateway.calls.filter((call) => call === 'createSpace')).toHaveLength(1);
    expect(gateway.calls.filter((call) => call === 'createWallet')).toHaveLength(1);
  });
});
