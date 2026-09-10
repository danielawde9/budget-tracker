import type { Page, Route } from '@playwright/test';

export interface HouseholdFixtureOptions {
  readonly emptyInvitations?: boolean;
  readonly failHouseholdOnce?: boolean;
  readonly memberAccess?: boolean;
  readonly invitationAcceptance?: boolean;
}

const SPACE_ID = '10000000-0000-4000-8000-000000000001';
const OWNER_ID = '20000000-0000-4000-8000-000000000001';
const MEMBER_ID = '30000000-0000-4000-8000-000000000001';
const SECOND_OWNER_ID = '30000000-0000-4000-8000-000000000002';
const INVITATION_ID = '40000000-0000-4000-8000-000000000001';

interface FixtureMembership {
  user_id: string;
  role: 'owner' | 'member';
  status: 'active' | 'revoked';
  created_at: string;
  activated_at: string;
  ended_at: string | null;
  is_self: boolean;
}

interface FixtureInvitation {
  invitation_id: string;
  effective_status: 'pending' | 'cancelled';
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  cancelled_at: string | null;
}

const protectedMutationNames = new Set([
  'accept_household_invitation',
  'cancel_household_invitation',
  'create_household_invitation',
  'leave_household_space',
  'remove_household_member',
  'set_household_member_role',
]);

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
    headers: { 'access-control-allow-origin': '*' },
  });
}

function authUser() {
  return {
    id: OWNER_ID,
    email: 'manager@example.test',
    aud: 'authenticated',
    role: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
  };
}

function authSession() {
  return {
    access_token: 'household-fixture-session',
    refresh_token: 'household-fixture-refresh',
    token_type: 'bearer',
    expires_in: 7200,
    expires_at: 4_102_444_800,
    user: authUser(),
  };
}

export async function installHouseholdApiFixture(page: Page, options: HouseholdFixtureOptions = {}) {
  const space = { id: SPACE_ID, name: 'Home budget', kind: 'household', created_at: '2026-01-02T00:00:00Z' };
  const visibleSpaces = options.invitationAcceptance ? [] : [space];
  const selfRole = options.memberAccess ? 'member' : 'owner';
  const members: FixtureMembership[] = [
    {
      user_id: OWNER_ID,
      role: selfRole,
      status: 'active',
      created_at: '2026-01-02T08:00:00Z',
      activated_at: '2026-01-02T08:00:00Z',
      ended_at: null,
      is_self: true,
    },
    {
      user_id: MEMBER_ID,
      role: 'member',
      status: 'active',
      created_at: '2026-02-11T09:30:00Z',
      activated_at: '2026-02-11T09:30:00Z',
      ended_at: null,
      is_self: false,
    },
    {
      user_id: SECOND_OWNER_ID,
      role: 'owner',
      status: 'active',
      created_at: '2026-03-04T11:15:00Z',
      activated_at: '2026-03-04T11:15:00Z',
      ended_at: null,
      is_self: false,
    },
  ];
  const invitations: FixtureInvitation[] = options.emptyInvitations ? [] : [
    {
      invitation_id: INVITATION_ID,
      effective_status: 'pending',
      created_at: '2026-09-08T10:00:00Z',
      expires_at: '2026-09-15T10:00:00Z',
      accepted_at: null,
      cancelled_at: null,
    },
  ];
  const protectedMutationCalls = new Set<string>();
  let householdFailuresRemaining = options.failHouseholdOnce ? 1 : 0;
  let invitationSequence = 1;

  await page.addInitScript((value) => localStorage.setItem('sb-127-auth-token', JSON.stringify(value)), authSession());

  await page.route('http://127.0.0.1:55432/auth/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    }
    if (path.endsWith('/user')) return json(route, authUser());
    if (path.endsWith('/logout')) return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    return json(route, authSession());
  });

  await page.route('http://127.0.0.1:55432/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const rpcName = path.includes('/rpc/') ? path.slice(path.lastIndexOf('/') + 1) : null;
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    }
    if (request.method() === 'POST' && rpcName && protectedMutationNames.has(rpcName)) protectedMutationCalls.add(rpcName);
    if (path.endsWith('/__fixture_audit')) {
      return json(route, {
        boundary: 'simulated-local-http',
        database: 'in-memory-fixture-state',
        protectedMutationCalls: [...protectedMutationCalls],
      });
    }
    if (path.endsWith('/spaces')) return json(route, visibleSpaces);
    if (path.endsWith('/space_memberships')) {
      if (visibleSpaces.length === 0) return json(route, []);
      return json(route, [members[0]]);
    }
    if (path.endsWith('/rpc/list_household_members')) {
      if (householdFailuresRemaining > 0) {
        householdFailuresRemaining -= 1;
        return json(route, { code: 'XX000', message: 'fixture household read failed' }, 503);
      }
      return json(route, members);
    }
    if (path.endsWith('/rpc/list_household_invitations')) return json(route, invitations);
    if (path.endsWith('/rpc/create_household_invitation')) {
      invitationSequence += 1;
      const invitationId = `40000000-0000-4000-8000-${String(invitationSequence).padStart(12, '0')}`;
      invitations.unshift({
        invitation_id: invitationId,
        effective_status: 'pending',
        created_at: '2026-09-10T10:00:00Z',
        expires_at: '2026-09-17T10:00:00Z',
        accepted_at: null,
        cancelled_at: null,
      });
      return json(route, [{ invitation_id: invitationId, expires_at: '2026-09-17T10:00:00Z' }]);
    }
    if (path.endsWith('/rpc/cancel_household_invitation')) {
      const body = request.postDataJSON() as { p_invitation_id: string };
      const invitation = invitations.find((value) => value.invitation_id === body.p_invitation_id);
      if (invitation) {
        invitation.effective_status = 'cancelled';
        invitation.cancelled_at = '2026-09-10T11:00:00Z';
      }
      return json(route, [{ invitation_id: body.p_invitation_id, status: 'cancelled' }]);
    }
    if (path.endsWith('/rpc/set_household_member_role')) {
      const body = request.postDataJSON() as { p_member_user_id: string; p_role: 'owner' | 'member' };
      const membership = members.find((value) => value.user_id === body.p_member_user_id);
      if (membership) membership.role = body.p_role;
      return json(route, [{ user_id: body.p_member_user_id, role: body.p_role, status: 'active' }]);
    }
    if (path.endsWith('/rpc/remove_household_member')) {
      const body = request.postDataJSON() as { p_member_user_id: string };
      const membership = members.find((value) => value.user_id === body.p_member_user_id);
      if (membership) membership.status = 'revoked';
      return json(route, [{ user_id: body.p_member_user_id, status: 'revoked' }]);
    }
    if (path.endsWith('/rpc/leave_household_space')) {
      return json(route, [{ user_id: OWNER_ID, status: 'left' }]);
    }
    if (path.endsWith('/rpc/accept_household_invitation')) {
      if (!visibleSpaces.some((value) => value.id === SPACE_ID)) visibleSpaces.push(space);
      const self = members[0];
      if (self) self.role = 'member';
      return json(route, [{ space_id: SPACE_ID, membership_status: 'active', role: 'member' }]);
    }
    return json(route, []);
  });
}

export const householdFixtureIds = { invitation: INVITATION_ID, member: MEMBER_ID } as const;
