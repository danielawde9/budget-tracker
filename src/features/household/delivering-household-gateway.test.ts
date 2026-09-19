import { describe, expect, it, vi } from 'vitest';

import {
  householdOwnerId,
  householdSpaceId,
  InMemoryHouseholdGateway,
} from '../../test/in-memory-household-gateway.js';
import { createDeliveringHouseholdGateway } from './delivering-household-gateway.js';
import { HouseholdInvitationDeliveryError } from './invitation-delivery.js';

const REQUEST_ID = '44444444-4444-4444-8444-444444444444';
const INVITATION_ID = '55555555-5555-4555-8555-555555555555';
const EXPIRES_AT = '2026-09-26T10:00:00.000Z';

function deliveringGateway() {
  const base = new InMemoryHouseholdGateway();
  const delivery = {
    deliverInvitation: vi.fn(async () => ({ invitationId: INVITATION_ID, expiresAt: EXPIRES_AT })),
  };
  const gateway = createDeliveringHouseholdGateway(base, delivery);
  return { base, delivery, gateway };
}

describe('delivering household gateway', () => {
  it('routes invitation creation through the delivery boundary with the locale', async () => {
    const { base, delivery, gateway } = deliveringGateway();
    const result = await gateway.createInvitation({
      spaceId: householdSpaceId,
      requestId: REQUEST_ID,
      email: 'person@example.com',
      locale: 'ar',
    });
    expect(result).toEqual({ invitationId: INVITATION_ID, expiresAt: EXPIRES_AT });
    expect(delivery.deliverInvitation).toHaveBeenCalledWith({
      spaceId: householdSpaceId,
      requestId: REQUEST_ID,
      email: 'person@example.com',
      locale: 'ar',
    });
    expect(base.calls.some((call) => call.name === 'createInvitation')).toBe(false);
  });

  it('delegates reads and other mutations to the base gateway unchanged', async () => {
    const { base, delivery, gateway } = deliveringGateway();
    await gateway.getSelfMembership(householdSpaceId, householdOwnerId);
    await gateway.listMembers(householdSpaceId);
    await gateway.listInvitations(householdSpaceId);
    await gateway.cancelInvitation({ spaceId: householdSpaceId, requestId: REQUEST_ID, invitationId: INVITATION_ID });
    await gateway.setMemberRole({ spaceId: householdSpaceId, requestId: REQUEST_ID, userId: householdOwnerId, role: 'member' });
    await gateway.removeMember({ spaceId: householdSpaceId, requestId: REQUEST_ID, userId: householdOwnerId });
    await gateway.leaveHousehold({ spaceId: householdSpaceId, requestId: REQUEST_ID });
    expect(base.calls.map((call) => call.name)).toEqual([
      'getSelfMembership',
      'listMembers',
      'listInvitations',
      'cancelInvitation',
      'setMemberRole',
      'removeMember',
      'leaveHousehold',
    ]);
    expect(delivery.deliverInvitation).not.toHaveBeenCalled();
  });

  it('propagates delivery failures without creating a local record', async () => {
    const { base, gateway } = deliveringGateway();
    const failing = createDeliveringHouseholdGateway(base, {
      deliverInvitation: vi.fn(async () => {
        throw new HouseholdInvitationDeliveryError('rate_limited', 429);
      }),
    });
    const failure = await failing.createInvitation({
      spaceId: householdSpaceId,
      requestId: REQUEST_ID,
      email: 'person@example.com',
      locale: 'en',
    }).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(HouseholdInvitationDeliveryError);
    expect(base.calls.some((call) => call.name === 'createInvitation')).toBe(false);
    await expect(gateway.listInvitations(householdSpaceId)).resolves.toHaveLength(1);
  });
});
