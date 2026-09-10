import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { classifyHouseholdError, type HouseholdErrorView } from './errors.js';
import type {
  HouseholdGateway,
  HouseholdInvitation,
  HouseholdMembership,
  MemberRole,
} from './types.js';

type HouseholdStatus = 'loading' | 'error' | 'member-ready' | 'owner-ready';

interface Snapshot {
  readonly key: string;
  readonly status: HouseholdStatus;
  readonly self: HouseholdMembership | null;
  readonly members: readonly HouseholdMembership[];
  readonly invitations: readonly HouseholdInvitation[];
  readonly membersHasMore: boolean;
  readonly invitationsHasMore: boolean;
  readonly error: HouseholdErrorView | null;
}

interface UseHouseholdInput {
  readonly gateway: HouseholdGateway;
  readonly spaceId: string;
  readonly userId: string;
  onSpaceUnavailable(): void;
  readonly pageSize?: number;
  readonly requestId?: () => string;
}

const emptySnapshot = (key: string): Snapshot => ({
  key,
  status: 'loading',
  self: null,
  members: [],
  invitations: [],
  membersHasMore: false,
  invitationsHasMore: false,
  error: null,
});

function newRequestId(): string {
  return crypto.randomUUID();
}

export function useHousehold({
  gateway,
  spaceId,
  userId,
  onSpaceUnavailable,
  pageSize = 50,
  requestId = newRequestId,
}: UseHouseholdInput) {
  const key = `${userId}:${spaceId}`;
  const [snapshot, setSnapshot] = useState<Snapshot>(() => emptySnapshot(key));
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<HouseholdErrorView | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const generation = useRef(0);
  const retryIntent = useRef<{ readonly key: string; readonly requestId: string } | null>(null);
  const unavailable = useRef(onSpaceUnavailable);
  unavailable.current = onSpaceUnavailable;

  const load = useCallback(async () => {
    const activeGeneration = ++generation.current;
    setSnapshot(emptySnapshot(key));
    setActionError(null);
    setActionSuccess(null);
    try {
      const self = await gateway.getSelfMembership(spaceId, userId);
      if (activeGeneration !== generation.current) return;
      if (!self || self.status !== 'active') {
        unavailable.current();
        setSnapshot({ ...emptySnapshot(key), status: 'error', error: classifyHouseholdError({ code: '42501', message: 'not_authorized' }) });
        return;
      }
      if (self.role === 'member') {
        setSnapshot({ ...emptySnapshot(key), status: 'member-ready', self });
        return;
      }
      const [members, invitations] = await Promise.all([
        gateway.listMembers(spaceId, undefined, pageSize),
        gateway.listInvitations(spaceId, undefined, pageSize),
      ]);
      if (activeGeneration !== generation.current) return;
      setSnapshot({
        key,
        status: 'owner-ready',
        self,
        members,
        invitations,
        membersHasMore: members.length === pageSize,
        invitationsHasMore: invitations.length === pageSize,
        error: null,
      });
    } catch (cause) {
      if (activeGeneration !== generation.current) return;
      const error = classifyHouseholdError(cause);
      if (error.kind === 'access-lost') unavailable.current();
      setSnapshot({ ...emptySnapshot(key), status: 'error', error });
    }
  }, [gateway, key, pageSize, spaceId, userId]);

  useEffect(() => {
    void load();
    return () => { generation.current += 1; };
  }, [load]);

  const visible = snapshot.key === key ? snapshot : emptySnapshot(key);

  const refreshOwner = useCallback(async () => {
    const [members, invitations] = await Promise.all([
      gateway.listMembers(spaceId, undefined, pageSize),
      gateway.listInvitations(spaceId, undefined, pageSize),
    ]);
    setSnapshot((current) => current.key !== key ? current : {
      ...current,
      status: 'owner-ready',
      members,
      invitations,
      membersHasMore: members.length === pageSize,
      invitationsHasMore: invitations.length === pageSize,
      error: null,
    });
  }, [gateway, key, pageSize, spaceId]);

  const runMutation = useCallback(async (
    intentKey: string,
    label: string,
    operation: (activeRequestId: string) => Promise<void>,
    afterSuccess?: () => Promise<void>,
  ): Promise<boolean> => {
    if (actionPending) return false;
    const activeRequestId = retryIntent.current?.key === intentKey
      ? retryIntent.current.requestId
      : requestId();
    retryIntent.current = { key: intentKey, requestId: activeRequestId };
    setActionPending(label);
    setActionError(null);
    setActionSuccess(null);
    try {
      await operation(activeRequestId);
      await afterSuccess?.();
      retryIntent.current = null;
      setActionSuccess(label);
      return true;
    } catch (cause) {
      const error = classifyHouseholdError(cause);
      setActionError(error);
      if (error.kind === 'access-lost') unavailable.current();
      return false;
    } finally {
      setActionPending(null);
    }
  }, [actionPending, requestId]);

  const loadMoreMembers = useCallback(async () => {
    if (visible.status !== 'owner-ready' || !visible.membersHasMore || actionPending) return;
    setActionPending('members-page');
    setActionError(null);
    try {
      const afterUserId = visible.members.at(-1)?.userId;
      if (!afterUserId) return;
      const next = await gateway.listMembers(spaceId, afterUserId, pageSize);
      setSnapshot((current) => current.key !== key ? current : {
        ...current,
        members: [...current.members, ...next],
        membersHasMore: next.length === pageSize,
      });
    } catch (cause) {
      setActionError(classifyHouseholdError(cause));
    } finally {
      setActionPending(null);
    }
  }, [actionPending, gateway, key, pageSize, spaceId, visible]);

  const loadMoreInvitations = useCallback(async () => {
    if (visible.status !== 'owner-ready' || !visible.invitationsHasMore || actionPending) return;
    setActionPending('invitations-page');
    setActionError(null);
    try {
      const last = visible.invitations.at(-1);
      if (!last) return;
      const next = await gateway.listInvitations(spaceId, { createdAt: last.createdAt, invitationId: last.invitationId }, pageSize);
      setSnapshot((current) => current.key !== key ? current : {
        ...current,
        invitations: [...current.invitations, ...next],
        invitationsHasMore: next.length === pageSize,
      });
    } catch (cause) {
      setActionError(classifyHouseholdError(cause));
    } finally {
      setActionPending(null);
    }
  }, [actionPending, gateway, key, pageSize, spaceId, visible]);

  return useMemo(() => ({
    ...visible,
    actionPending,
    actionError,
    actionSuccess,
    retry: load,
    loadMoreMembers,
    loadMoreInvitations,
    clearActionState() {
      retryIntent.current = null;
      setActionError(null);
      setActionSuccess(null);
    },
    createInvitation(email: string) {
      const normalized = email.trim();
      return runMutation(`create:${normalized}`, 'invitation-created', async (activeRequestId) => {
        await gateway.createInvitation({ spaceId, requestId: activeRequestId, email: normalized });
      }, refreshOwner);
    },
    cancelInvitation(invitationId: string) {
      return runMutation(`cancel:${invitationId}`, 'invitation-cancelled', async (activeRequestId) => {
        await gateway.cancelInvitation({ spaceId, requestId: activeRequestId, invitationId });
      }, refreshOwner);
    },
    setMemberRole(targetUserId: string, role: MemberRole) {
      return runMutation(`role:${targetUserId}:${role}`, 'role-updated', async (activeRequestId) => {
        await gateway.setMemberRole({ spaceId, requestId: activeRequestId, userId: targetUserId, role });
      }, refreshOwner);
    },
    removeMember(targetUserId: string) {
      return runMutation(`remove:${targetUserId}`, 'member-removed', async (activeRequestId) => {
        await gateway.removeMember({ spaceId, requestId: activeRequestId, userId: targetUserId });
      }, refreshOwner);
    },
    leave() {
      return runMutation('leave', 'household-left', async (activeRequestId) => {
        await gateway.leaveHousehold({ spaceId, requestId: activeRequestId });
      }, async () => unavailable.current());
    },
  }), [actionError, actionPending, actionSuccess, gateway, load, loadMoreInvitations, loadMoreMembers, refreshOwner, runMutation, spaceId, visible]);
}
