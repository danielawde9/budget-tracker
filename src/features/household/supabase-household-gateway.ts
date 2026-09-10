import type {
  HouseholdGateway,
  HouseholdInvitation,
  HouseholdMembership,
  InvitationCursor,
  InvitationStatus,
  MemberRole,
  MembershipStatus,
} from './types.js';

type DatabaseError = { readonly code?: string; readonly message: string };
type RpcResult = { readonly data: unknown[] | null; readonly error: DatabaseError | null };
type SingleResult = { readonly data: unknown | null; readonly error: DatabaseError | null };
type Row = Record<string, unknown>;

export interface HouseholdQueryBuilder {
  select(columns: string): HouseholdQueryBuilder;
  eq(column: string, value: unknown): HouseholdQueryBuilder;
  maybeSingle(): Promise<SingleResult>;
}

export interface HouseholdDataClient {
  from(relation: string): HouseholdQueryBuilder;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES = new Set<MemberRole>(['owner', 'member']);
const MEMBERSHIP_STATUSES = new Set<MembershipStatus>(['active', 'revoked', 'left']);
const INVITATION_STATUSES = new Set<InvitationStatus>(['pending', 'accepted', 'cancelled', 'expired']);

function record(value: unknown, label = 'row'): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`The database returned an invalid household ${label}.`);
  }
  return value as Row;
}

function uuid(value: unknown, key: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`The household row has invalid ${key}.`);
  return value;
}

function timestamp(value: unknown, key: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`The household row has invalid ${key}.`);
  }
  return value;
}

function nullableTimestamp(value: unknown, key: string): string | null {
  return value === null ? null : timestamp(value, key);
}

function boolean(value: unknown, key: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`The household row has invalid ${key}.`);
  return value;
}

function one(result: RpcResult, label: string): Row {
  if (result.error) throw result.error;
  if (!result.data || result.data.length !== 1) {
    throw new Error(`The ${label} command must return exactly one row.`);
  }
  return record(result.data[0], `${label} result`);
}

function rows(result: RpcResult, label: string, limit: number): Row[] {
  if (result.error) throw result.error;
  const values = result.data ?? [];
  if (values.length > limit) throw new Error(`The ${label} projection exceeded its ${limit}-row bound.`);
  return values.map((value) => record(value, `${label} row`));
}

function pageLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Household page size must be between 1 and 100.');
  }
  return limit;
}

function member(row: Row, selfOverride?: boolean): HouseholdMembership {
  const role = row.role;
  const status = row.status;
  if (typeof role !== 'string' || !ROLES.has(role as MemberRole)) throw new Error('The household row has invalid role.');
  if (typeof status !== 'string' || !MEMBERSHIP_STATUSES.has(status as MembershipStatus)) throw new Error('The household row has invalid status.');
  return {
    userId: uuid(row.user_id, 'user_id'),
    role: role as MemberRole,
    status: status as MembershipStatus,
    createdAt: timestamp(row.created_at, 'created_at'),
    activatedAt: timestamp(row.activated_at, 'activated_at'),
    endedAt: nullableTimestamp(row.ended_at, 'ended_at'),
    isSelf: selfOverride ?? boolean(row.is_self, 'is_self'),
  };
}

function invitation(row: Row): HouseholdInvitation {
  const status = row.effective_status;
  if (typeof status !== 'string' || !INVITATION_STATUSES.has(status as InvitationStatus)) {
    throw new Error('The household row has invalid effective_status.');
  }
  return {
    invitationId: uuid(row.invitation_id, 'invitation_id'),
    effectiveStatus: status as InvitationStatus,
    createdAt: timestamp(row.created_at, 'created_at'),
    expiresAt: timestamp(row.expires_at, 'expires_at'),
    acceptedAt: nullableTimestamp(row.accepted_at, 'accepted_at'),
    cancelledAt: nullableTimestamp(row.cancelled_at, 'cancelled_at'),
  };
}

function assertUuidInput(value: string, label: string): void {
  if (!UUID.test(value)) throw new Error(`${label} must be a UUID.`);
}

async function mutation(
  client: HouseholdDataClient,
  name: string,
  args: Record<string, unknown>,
  validate: (row: Row) => void,
): Promise<void> {
  validate(one(await client.rpc(name, args), name));
}

export function createSupabaseHouseholdGateway(client: HouseholdDataClient): HouseholdGateway {
  return {
    async getSelfMembership(spaceId, userId) {
      assertUuidInput(spaceId, 'spaceId');
      assertUuidInput(userId, 'userId');
      const result = await client.from('space_memberships')
        .select('user_id,role,status,created_at,activated_at,ended_at')
        .eq('space_id', spaceId)
        .eq('user_id', userId)
        .maybeSingle();
      if (result.error) throw result.error;
      return result.data === null ? null : member(record(result.data, 'self-membership row'), true);
    },

    async listMembers(spaceId, afterUserId, limit = 50) {
      const bounded = pageLimit(limit);
      const result = await client.rpc('list_household_members', {
        p_space_id: spaceId,
        p_limit: bounded,
        p_after_user_id: afterUserId ?? null,
      });
      return rows(result, 'member', bounded).map((value) => member(value));
    },

    async listInvitations(spaceId, cursor?: InvitationCursor, limit = 50) {
      const bounded = pageLimit(limit);
      const result = await client.rpc('list_household_invitations', {
        p_space_id: spaceId,
        p_limit: bounded,
        p_after_created_at: cursor?.createdAt ?? null,
        p_after_id: cursor?.invitationId ?? null,
      });
      return rows(result, 'invitation', bounded).map(invitation);
    },

    async createInvitation(input) {
      const result = await client.rpc('create_household_invitation', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_invitee_email: input.email,
      });
      const value = one(result, 'create_household_invitation');
      return {
        invitationId: uuid(value.invitation_id, 'invitation_id'),
        expiresAt: timestamp(value.expires_at, 'expires_at'),
      };
    },

    async acceptInvitation(input) {
      const value = one(await client.rpc('accept_household_invitation', {
        p_request_id: input.requestId,
        p_invitation_token: input.token,
      }), 'accept_household_invitation');
      if (value.membership_status !== 'active' || value.role !== 'member') {
        throw new Error('The household acceptance result is invalid.');
      }
      return { spaceId: uuid(value.space_id, 'space_id'), status: 'active', role: 'member' };
    },

    cancelInvitation(input) {
      return mutation(client, 'cancel_household_invitation', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_invitation_id: input.invitationId,
      }, (value) => {
        uuid(value.invitation_id, 'invitation_id');
        if (value.status !== 'cancelled') throw new Error('The household cancellation result is invalid.');
      });
    },

    setMemberRole(input) {
      return mutation(client, 'set_household_member_role', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_member_user_id: input.userId,
        p_role: input.role,
      }, (value) => {
        uuid(value.user_id, 'user_id');
        if (value.status !== 'active' || value.role !== input.role) throw new Error('The household role result is invalid.');
      });
    },

    removeMember(input) {
      return mutation(client, 'remove_household_member', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_member_user_id: input.userId,
      }, (value) => {
        uuid(value.user_id, 'user_id');
        if (value.status !== 'revoked') throw new Error('The household removal result is invalid.');
      });
    },

    leaveHousehold(input) {
      return mutation(client, 'leave_household_space', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
      }, (value) => {
        uuid(value.user_id, 'user_id');
        if (value.status !== 'left') throw new Error('The household leave result is invalid.');
      });
    },
  };
}
