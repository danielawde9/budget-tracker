import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { personalSpace, householdSpace } from '../../test/in-memory-loans-gateway.js';
import type { WorkspaceGateway } from './types.js';
import { useWorkspace } from './use-workspace.js';

class FakeWorkspaceGateway implements WorkspaceGateway {
  spaces = [personalSpace, householdSpace];
  error: Error | null = null;
  calls: string[] = [];

  async listSpaces() {
    this.calls.push('listSpaces');
    if (this.error) throw this.error;
    return this.spaces;
  }

  async listWallets(spaceId: string) {
    this.calls.push(`listWallets:${spaceId}`);
    return [];
  }

  async createSpace() { return { id: 'new-space' }; }
  async createWallet() { return { id: 'new-wallet' }; }
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
});
