import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createSupabaseHouseholdGateway,
  type HouseholdDataClient,
  type HouseholdQueryBuilder,
} from './supabase-household-gateway.js';

const SPACE_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';
const INVITATION_ID = '55555555-5555-4555-8555-555555555555';

type Result = { data: unknown[] | null; error: { code?: string; message: string } | null };
type Operation = { relation: string; name: string; args: readonly unknown[] };

class RecordingBuilder implements HouseholdQueryBuilder {
  constructor(
    private readonly relation: string,
    private readonly result: Result,
    private readonly operations: Operation[],
  ) {}

  private record(name: string, ...args: unknown[]): this {
    this.operations.push({ relation: this.relation, name, args });
    return this;
  }

  select(columns: string) { return this.record('select', columns); }
  eq(column: string, value: unknown) { return this.record('eq', column, value); }
  async maybeSingle() {
    this.record('maybeSingle');
    return { data: this.result.data?.[0] ?? null, error: this.result.error };
  }
}

const membershipRow = {
  user_id: OWNER_ID,
  role: 'owner',
  status: 'active',
  created_at: '2026-09-08T10:00:00.000Z',
  activated_at: '2026-09-08T10:00:00.000Z',
  ended_at: null,
  is_self: true,
};

const invitationRow = {
  invitation_id: INVITATION_ID,
  effective_status: 'pending',
  created_at: '2026-09-10T10:00:00.000Z',
  expires_at: '2026-09-17T10:00:00.000Z',
  accepted_at: null,
  cancelled_at: null,
};

function recordingClient(overrides: Partial<Record<string, unknown[] | null>> = {}) {
  const operations: Operation[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rows: Record<string, unknown[] | null> = {
    self: [membershipRow],
    list_household_members: [membershipRow, { ...membershipRow, user_id: MEMBER_ID, role: 'member', is_self: false }],
    list_household_invitations: [invitationRow],
    create_household_invitation: [{ invitation_id: INVITATION_ID, invitation_token: 'secret-token-must-disappear', expires_at: invitationRow.expires_at }],
    accept_household_invitation: [{ space_id: SPACE_ID, membership_status: 'active', role: 'member' }],
    cancel_household_invitation: [{ invitation_id: INVITATION_ID, status: 'cancelled' }],
    set_household_member_role: [{ user_id: MEMBER_ID, status: 'active', role: 'owner' }],
    remove_household_member: [{ user_id: MEMBER_ID, status: 'revoked' }],
    leave_household_space: [{ user_id: OWNER_ID, status: 'left' }],
    ...overrides,
  };
  const client: HouseholdDataClient = {
    from(relation) {
      return new RecordingBuilder(relation, { data: rows.self ?? null, error: null }, operations);
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: rows[name] ?? null, error: null };
    },
  };
  return { client, operations, rpcCalls };
}

describe('Supabase Household gateway', () => {
  it('reads only the authenticated user membership through the existing RLS projection', async () => {
    const { client, operations } = recordingClient();
    const self = await createSupabaseHouseholdGateway(client).getSelfMembership(SPACE_ID, OWNER_ID);
    expect(self).toMatchObject({ userId: OWNER_ID, role: 'owner', status: 'active', isSelf: true });
    expect(operations).toEqual([
      { relation: 'space_memberships', name: 'select', args: ['user_id,role,status,created_at,activated_at,ended_at'] },
      { relation: 'space_memberships', name: 'eq', args: ['space_id', SPACE_ID] },
      { relation: 'space_memberships', name: 'eq', args: ['user_id', OWNER_ID] },
      { relation: 'space_memberships', name: 'maybeSingle', args: [] },
    ]);
  });

  it('forwards bounded owner projection cursors exactly', async () => {
    const { client, rpcCalls } = recordingClient();
    const gateway = createSupabaseHouseholdGateway(client);
    const members = await gateway.listMembers(SPACE_ID, MEMBER_ID, 50);
    const invitations = await gateway.listInvitations(SPACE_ID, {
      createdAt: invitationRow.created_at,
      invitationId: INVITATION_ID,
    }, 50);
    expect(members).toHaveLength(2);
    expect(invitations).toEqual([expect.objectContaining({ invitationId: INVITATION_ID, effectiveStatus: 'pending' })]);
    expect(rpcCalls).toContainEqual({
      name: 'list_household_members',
      args: { p_space_id: SPACE_ID, p_limit: 50, p_after_user_id: MEMBER_ID },
    });
    expect(rpcCalls).toContainEqual({
      name: 'list_household_invitations',
      args: {
        p_space_id: SPACE_ID,
        p_limit: 50,
        p_after_created_at: invitationRow.created_at,
        p_after_id: INVITATION_ID,
      },
    });
    await expect(gateway.listMembers(SPACE_ID, undefined, 101)).rejects.toThrow('between 1 and 100');
  });

  it('uses only approved mutation RPCs and discards invitation tokens', async () => {
    const { client, rpcCalls } = recordingClient();
    const gateway = createSupabaseHouseholdGateway(client);
    const created = await gateway.createInvitation({ spaceId: SPACE_ID, requestId: REQUEST_ID, email: 'member@example.com' });
    expect(created).toEqual({ invitationId: INVITATION_ID, expiresAt: invitationRow.expires_at });
    expect(JSON.stringify(created)).not.toContain('secret-token');
    await gateway.acceptInvitation({ requestId: REQUEST_ID, token: 'A'.repeat(43) });
    await gateway.cancelInvitation({ spaceId: SPACE_ID, requestId: REQUEST_ID, invitationId: INVITATION_ID });
    await gateway.setMemberRole({ spaceId: SPACE_ID, requestId: REQUEST_ID, userId: MEMBER_ID, role: 'owner' });
    await gateway.removeMember({ spaceId: SPACE_ID, requestId: REQUEST_ID, userId: MEMBER_ID });
    await gateway.leaveHousehold({ spaceId: SPACE_ID, requestId: REQUEST_ID });
    expect(rpcCalls).toEqual(expect.arrayContaining([
      { name: 'create_household_invitation', args: { p_space_id: SPACE_ID, p_request_id: REQUEST_ID, p_invitee_email: 'member@example.com' } },
      { name: 'accept_household_invitation', args: { p_request_id: REQUEST_ID, p_invitation_token: 'A'.repeat(43) } },
      { name: 'cancel_household_invitation', args: { p_space_id: SPACE_ID, p_request_id: REQUEST_ID, p_invitation_id: INVITATION_ID } },
      { name: 'set_household_member_role', args: { p_space_id: SPACE_ID, p_request_id: REQUEST_ID, p_member_user_id: MEMBER_ID, p_role: 'owner' } },
      { name: 'remove_household_member', args: { p_space_id: SPACE_ID, p_request_id: REQUEST_ID, p_member_user_id: MEMBER_ID } },
      { name: 'leave_household_space', args: { p_space_id: SPACE_ID, p_request_id: REQUEST_ID } },
    ]));
  });

  it.each([
    ['member UUID', { list_household_members: [{ ...membershipRow, user_id: 'bad' }] }],
    ['member role', { list_household_members: [{ ...membershipRow, role: 'viewer' }] }],
    ['member timestamp', { list_household_members: [{ ...membershipRow, activated_at: 'yesterday' }] }],
    ['invitation status', { list_household_invitations: [{ ...invitationRow, effective_status: 'sent' }] }],
    ['invitation timestamp', { list_household_invitations: [{ ...invitationRow, expires_at: 'later' }] }],
  ])('rejects malformed %s projection rows', async (_label, overrides) => {
    const { client } = recordingClient(overrides);
    const gateway = createSupabaseHouseholdGateway(client);
    if ('list_household_members' in overrides) {
      await expect(gateway.listMembers(SPACE_ID)).rejects.toThrow(/invalid|missing/i);
    } else {
      await expect(gateway.listInvitations(SPACE_ID)).rejects.toThrow(/invalid|missing/i);
    }
  });

  it.each([null, [], [{ invitation_id: INVITATION_ID, expires_at: invitationRow.expires_at }, { invitation_id: INVITATION_ID, expires_at: invitationRow.expires_at }]])(
    'rejects non-singleton creation results: %s',
    async (response) => {
      const { client } = recordingClient({ create_household_invitation: response });
      await expect(createSupabaseHouseholdGateway(client).createInvitation({
        spaceId: SPACE_ID,
        requestId: REQUEST_ID,
        email: 'member@example.com',
      })).rejects.toThrow('exactly one');
    },
  );

  it('contains no browser direct-write call sites', () => {
    const source = readFileSync(resolve('src/features/household/supabase-household-gateway.ts'), 'utf8');
    expect(source).not.toMatch(/\.(?:insert|update|delete|upsert)\s*\(/);
    expect(source).not.toMatch(/console\.|localStorage|sessionStorage/);
  });
});
