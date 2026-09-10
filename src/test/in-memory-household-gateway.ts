import type {
  HouseholdGateway,
  HouseholdInvitation,
  HouseholdMembership,
  InvitationCursor,
  MemberRole,
} from '../features/household/types.js';

export const householdSpaceId = '11111111-1111-4111-8111-111111111111';
export const householdOwnerId = '22222222-2222-4222-8222-222222222222';
export const householdMemberId = '33333333-3333-4333-8333-333333333333';
export const householdInvitationId = '55555555-5555-4555-8555-555555555555';

const started = '2026-09-08T10:00:00.000Z';

export class InMemoryHouseholdGateway implements HouseholdGateway {
  memberships: HouseholdMembership[] = [
    { userId: householdOwnerId, role: 'owner', status: 'active', createdAt: started, activatedAt: started, endedAt: null, isSelf: true },
    { userId: householdMemberId, role: 'member', status: 'active', createdAt: started, activatedAt: started, endedAt: null, isSelf: false },
  ];
  invitations: HouseholdInvitation[] = [
    { invitationId: householdInvitationId, effectiveStatus: 'pending', createdAt: '2026-09-10T10:00:00.000Z', expiresAt: '2026-09-17T10:00:00.000Z', acceptedAt: null, cancelledAt: null },
  ];
  calls: Array<{ readonly name: string; readonly input?: unknown }> = [];
  error: Error | null = null;
  failOnce: Error | null = null;
  pageSize: number | null = null;

  private rejectIfNeeded(): void {
    if (this.failOnce) {
      const failure = this.failOnce;
      this.failOnce = null;
      throw failure;
    }
    if (this.error) throw this.error;
  }

  async getSelfMembership(spaceId: string, userId: string) {
    this.calls.push({ name: 'getSelfMembership', input: { spaceId, userId } });
    this.rejectIfNeeded();
    const found = this.memberships.find((entry) => entry.userId === userId) ?? null;
    return found ? { ...found, isSelf: true } : null;
  }

  async listMembers(spaceId: string, afterUserId?: string, limit = 50) {
    this.calls.push({ name: 'listMembers', input: { spaceId, afterUserId, limit } });
    this.rejectIfNeeded();
    const start = afterUserId ? this.memberships.findIndex((entry) => entry.userId === afterUserId) + 1 : 0;
    return this.memberships.slice(start, start + (this.pageSize ?? limit));
  }

  async listInvitations(spaceId: string, cursor?: InvitationCursor, limit = 50) {
    this.calls.push({ name: 'listInvitations', input: { spaceId, cursor, limit } });
    this.rejectIfNeeded();
    const start = cursor ? this.invitations.findIndex((entry) => entry.invitationId === cursor.invitationId) + 1 : 0;
    return this.invitations.slice(start, start + (this.pageSize ?? limit));
  }

  async createInvitation(input: { spaceId: string; requestId: string; email: string }) {
    this.calls.push({ name: 'createInvitation', input });
    this.rejectIfNeeded();
    const invitationId = `55555555-5555-4555-8555-${String(this.invitations.length + 1).padStart(12, '0')}`;
    const createdAt = new Date(Date.parse('2026-09-10T10:00:00.000Z') + this.invitations.length * 1000).toISOString();
    const expiresAt = new Date(Date.parse(createdAt) + 7 * 24 * 60 * 60 * 1000).toISOString();
    this.invitations = [{ invitationId, effectiveStatus: 'pending', createdAt, expiresAt, acceptedAt: null, cancelledAt: null }, ...this.invitations];
    return { invitationId, expiresAt };
  }

  async acceptInvitation(input: { requestId: string; token: string }) {
    this.calls.push({ name: 'acceptInvitation', input });
    this.rejectIfNeeded();
    return { spaceId: householdSpaceId, status: 'active' as const, role: 'member' as const };
  }

  async cancelInvitation(input: { spaceId: string; requestId: string; invitationId: string }) {
    this.calls.push({ name: 'cancelInvitation', input });
    this.rejectIfNeeded();
    this.invitations = this.invitations.map((entry) => entry.invitationId === input.invitationId ? { ...entry, effectiveStatus: 'cancelled', cancelledAt: started } : entry);
  }

  async setMemberRole(input: { spaceId: string; requestId: string; userId: string; role: MemberRole }) {
    this.calls.push({ name: 'setMemberRole', input });
    this.rejectIfNeeded();
    this.memberships = this.memberships.map((entry) => entry.userId === input.userId ? { ...entry, role: input.role } : entry);
  }

  async removeMember(input: { spaceId: string; requestId: string; userId: string }) {
    this.calls.push({ name: 'removeMember', input });
    this.rejectIfNeeded();
    this.memberships = this.memberships.map((entry) => entry.userId === input.userId ? { ...entry, status: 'revoked', endedAt: started } : entry);
  }

  async leaveHousehold(input: { spaceId: string; requestId: string }) {
    this.calls.push({ name: 'leaveHousehold', input });
    this.rejectIfNeeded();
    this.memberships = this.memberships.map((entry) => entry.isSelf ? { ...entry, status: 'left', endedAt: started } : entry);
  }
}
