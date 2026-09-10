import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  householdMemberId,
  householdOwnerId,
  householdSpaceId,
  InMemoryHouseholdGateway,
} from '../../test/in-memory-household-gateway.js';
import { useHousehold } from './use-household.js';

describe('useHousehold', () => {
  it('loads the self row before bounded owner projections', async () => {
    const gateway = new InMemoryHouseholdGateway();
    const { result } = renderHook(() => useHousehold({ gateway, spaceId: householdSpaceId, userId: householdOwnerId, onSpaceUnavailable: vi.fn() }));
    await waitFor(() => expect(result.current.status).toBe('owner-ready'));
    expect(result.current.members).toHaveLength(2);
    expect(gateway.calls.slice(0, 3).map((call) => call.name)).toEqual(['getSelfMembership', 'listMembers', 'listInvitations']);
    expect(gateway.calls[1]?.input).toMatchObject({ limit: 50 });
  });

  it('does not call owner projections for an active member', async () => {
    const gateway = new InMemoryHouseholdGateway();
    gateway.memberships = gateway.memberships.map((entry) => ({ ...entry, isSelf: entry.userId === householdMemberId }));
    const { result } = renderHook(() => useHousehold({ gateway, spaceId: householdSpaceId, userId: householdMemberId, onSpaceUnavailable: vi.fn() }));
    await waitFor(() => expect(result.current.status).toBe('member-ready'));
    expect(gateway.calls.map((call) => call.name)).toEqual(['getSelfMembership']);
    expect(result.current.members).toEqual([]);
  });

  it('clears stale owner content while changing spaces', async () => {
    const gateway = new InMemoryHouseholdGateway();
    const props = { gateway, spaceId: householdSpaceId, userId: householdOwnerId, onSpaceUnavailable: vi.fn() };
    const { result, rerender } = renderHook(({ spaceId }) => useHousehold({ ...props, spaceId }), { initialProps: { spaceId: householdSpaceId } });
    await waitFor(() => expect(result.current.status).toBe('owner-ready'));
    rerender({ spaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    expect(result.current.status).toBe('loading');
    expect(result.current.members).toEqual([]);
  });

  it('paginates members and invitations with exact last-row cursors', async () => {
    const gateway = new InMemoryHouseholdGateway();
    gateway.pageSize = 1;
    const { result } = renderHook(() => useHousehold({ gateway, spaceId: householdSpaceId, userId: householdOwnerId, onSpaceUnavailable: vi.fn(), pageSize: 1 }));
    await waitFor(() => expect(result.current.status).toBe('owner-ready'));
    expect(result.current.membersHasMore).toBe(true);
    expect(result.current.invitationsHasMore).toBe(true);
    await act(() => result.current.loadMoreMembers());
    await act(() => result.current.loadMoreInvitations());
    expect(gateway.calls.findLast((call) => call.name === 'listMembers')?.input).toMatchObject({ afterUserId: householdOwnerId, limit: 1 });
    expect(gateway.calls.findLast((call) => call.name === 'listInvitations')?.input).toMatchObject({ cursor: expect.objectContaining({ invitationId: expect.any(String) }), limit: 1 });
  });

  it.each(['members', 'invitations'] as const)('clears owner data when %s pagination loses access', async (projection) => {
    const gateway = new InMemoryHouseholdGateway();
    gateway.pageSize = 1;
    const unavailable = vi.fn();
    const { result } = renderHook(() => useHousehold({
      gateway,
      spaceId: householdSpaceId,
      userId: householdOwnerId,
      onSpaceUnavailable: unavailable,
      pageSize: 1,
    }));
    await waitFor(() => expect(result.current.status).toBe('owner-ready'));
    gateway.failOnce = Object.assign(new Error('not_authorized'), { code: '42501' });

    await act(() => projection === 'members'
      ? result.current.loadMoreMembers()
      : result.current.loadMoreInvitations());

    expect(unavailable).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('error');
    expect(result.current.members).toEqual([]);
    expect(result.current.invitations).toEqual([]);
  });

  it('reuses a failed action request ID and creates a new ID after success', async () => {
    const gateway = new InMemoryHouseholdGateway();
    const firstId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const secondId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const ids = [firstId, secondId];
    const requestId = vi.fn(() => ids.shift()!);
    const { result } = renderHook(() => useHousehold({ gateway, spaceId: householdSpaceId, userId: householdOwnerId, onSpaceUnavailable: vi.fn(), requestId }));
    await waitFor(() => expect(result.current.status).toBe('owner-ready'));
    gateway.failOnce = new Error('Failed to fetch');
    await act(() => result.current.createInvitation('person@example.com'));
    await act(() => result.current.createInvitation('person@example.com'));
    await act(() => result.current.createInvitation('other@example.com'));
    const calls = gateway.calls.filter((call) => call.name === 'createInvitation').map((call) => call.input as { requestId: string });
    expect(calls.map((call) => call.requestId)).toEqual([firstId, firstId, secondId]);
  });

  it('reports inactive self membership as unavailable without retaining projections', async () => {
    const gateway = new InMemoryHouseholdGateway();
    gateway.memberships = gateway.memberships.map((entry) => entry.userId === householdOwnerId ? { ...entry, status: 'revoked' } : entry);
    const unavailable = vi.fn();
    const { result } = renderHook(() => useHousehold({ gateway, spaceId: householdSpaceId, userId: householdOwnerId, onSpaceUnavailable: unavailable }));
    await waitFor(() => expect(unavailable).toHaveBeenCalledOnce());
    expect(result.current.status).toBe('error');
    expect(result.current.members).toEqual([]);
  });
});
