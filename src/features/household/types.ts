export type MemberRole = 'owner' | 'member';
export type MembershipStatus = 'active' | 'revoked' | 'left';
export type InvitationStatus = 'pending' | 'accepted' | 'cancelled' | 'expired';

export interface HouseholdMembership {
  readonly userId: string;
  readonly role: MemberRole;
  readonly status: MembershipStatus;
  readonly createdAt: string;
  readonly activatedAt: string;
  readonly endedAt: string | null;
  readonly isSelf: boolean;
}

export interface HouseholdInvitation {
  readonly invitationId: string;
  readonly effectiveStatus: InvitationStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly acceptedAt: string | null;
  readonly cancelledAt: string | null;
}

export interface InvitationCursor {
  readonly createdAt: string;
  readonly invitationId: string;
}

export interface HouseholdGateway {
  getSelfMembership(spaceId: string, userId: string): Promise<HouseholdMembership | null>;
  listMembers(spaceId: string, afterUserId?: string, limit?: number): Promise<readonly HouseholdMembership[]>;
  listInvitations(spaceId: string, cursor?: InvitationCursor, limit?: number): Promise<readonly HouseholdInvitation[]>;
  createInvitation(input: { readonly spaceId: string; readonly requestId: string; readonly email: string }): Promise<{ readonly invitationId: string; readonly expiresAt: string }>;
  acceptInvitation(input: { readonly requestId: string; readonly token: string }): Promise<{ readonly spaceId: string; readonly status: 'active'; readonly role: 'member' }>;
  cancelInvitation(input: { readonly spaceId: string; readonly requestId: string; readonly invitationId: string }): Promise<void>;
  setMemberRole(input: { readonly spaceId: string; readonly requestId: string; readonly userId: string; readonly role: MemberRole }): Promise<void>;
  removeMember(input: { readonly spaceId: string; readonly requestId: string; readonly userId: string }): Promise<void>;
  leaveHousehold(input: { readonly spaceId: string; readonly requestId: string }): Promise<void>;
}
