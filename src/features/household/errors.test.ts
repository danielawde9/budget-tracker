import { describe, expect, it } from 'vitest';

import { classifyHouseholdError, localizeHouseholdError } from './errors.js';
import { HouseholdInvitationDeliveryError } from './invitation-delivery.js';

describe('household errors', () => {
  it.each([
    [{ code: '42501', message: 'not_authorized' }, 'access-lost'],
    [{ code: 'P0001', message: 'invitation_unavailable' }, 'invitation-unavailable'],
    [{ code: 'P0001', message: 'last_owner_required' }, 'last-owner'],
    [{ code: 'P0001', message: 'idempotency_conflict' }, 'request-conflict'],
    [{ code: 'P0001', message: 'invalid_input' }, 'invalid-input'],
  ] as const)('maps %s to %s without exposing database internals', (cause, kind) => {
    const result = classifyHouseholdError(cause);
    expect(result.kind).toBe(kind);
    expect(`${result.message} ${result.recovery}`).not.toMatch(/fingerprint|digest|constraint|token/i);
  });

  it('fails closed for unknown rejections', () => {
    expect(classifyHouseholdError(new Error('household_invitation_token_digest leaked'))).toEqual({
      kind: 'request-failed',
      message: 'The household request was not accepted.',
      recovery: 'Check the current household access and try again.',
    });
  });

  it.each([
    ['invalid_authorization', 401, 'access-lost'],
    ['rate_limited', 429, 'rate-limited'],
    ['delivery_status_ambiguous', 409, 'invitation-ambiguous'],
    ['invitation_command_rejected', 400, 'invitation-conflict'],
    ['not_found', 404, 'delivery-unavailable'],
    ['invalid_configuration', 500, 'delivery-unavailable'],
    ['origin_rejected', 403, 'delivery-unavailable'],
    ['network_error', 0, 'request-failed'],
    ['delivery_unavailable', 503, 'request-failed'],
    ['upstream_response_invalid', 502, 'request-failed'],
  ] as const)('maps delivery error %s to %s without exposing transport detail', (code, status, kind) => {
    const result = classifyHouseholdError(new HouseholdInvitationDeliveryError(code, status));
    expect(result.kind).toBe(kind);
    expect(`${result.message} ${result.recovery}`).not.toMatch(new RegExp(code, 'i'));
    expect(`${result.message} ${result.recovery}`).not.toMatch(/fingerprint|digest|constraint|token/i);
  });

  it.each(['access-lost', 'invitation-unavailable', 'last-owner', 'request-conflict', 'invalid-input', 'request-failed', 'rate-limited', 'invitation-ambiguous', 'invitation-conflict', 'delivery-unavailable'] as const)(
    'provides complete Arabic copy for %s',
    (kind) => {
      const localized = localizeHouseholdError({ kind, message: 'English', recovery: 'English' }, 'ar');
      expect(localized.message).toMatch(/[\u0600-\u06ff]/);
      expect(localized.recovery).toMatch(/[\u0600-\u06ff]/);
      expect(`${localized.message} ${localized.recovery}`).not.toContain('English');
    },
  );
});
