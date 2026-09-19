import type { InvitationDelivery } from './invitation-delivery.js';
import type { HouseholdGateway } from './types.js';

export function createDeliveringHouseholdGateway(
  base: HouseholdGateway,
  delivery: InvitationDelivery,
): HouseholdGateway {
  return {
    getSelfMembership: (input, userId) => base.getSelfMembership(input, userId),
    listMembers: (spaceId, afterUserId, limit) => base.listMembers(spaceId, afterUserId, limit),
    listInvitations: (spaceId, cursor, limit) => base.listInvitations(spaceId, cursor, limit),
    createInvitation(input) {
      return delivery.deliverInvitation({
        spaceId: input.spaceId,
        requestId: input.requestId,
        email: input.email,
        locale: input.locale,
      });
    },
    acceptInvitation: (input) => base.acceptInvitation(input),
    cancelInvitation: (input) => base.cancelInvitation(input),
    setMemberRole: (input) => base.setMemberRole(input),
    removeMember: (input) => base.removeMember(input),
    leaveHousehold: (input) => base.leaveHousehold(input),
  };
}
