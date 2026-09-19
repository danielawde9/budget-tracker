import { describe, expect, it, vi } from 'vitest';

import {
  createHttpInvitationDelivery,
  HouseholdInvitationDeliveryError,
} from './invitation-delivery.js';

const SPACE_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';
const INVITATION_ID = '55555555-5555-4555-8555-555555555555';
const EXPIRES_AT = '2026-09-26T10:00:00.000Z';

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly authorization: string | null;
  readonly contentType: string | null;
  readonly body: unknown;
  readonly signal: AbortSignal | null;
}

function recordingFetch(response: Response) {
  const requests: RecordedRequest[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      authorization: headers.get('authorization'),
      contentType: headers.get('content-type'),
      body: init?.body ? JSON.parse(String(init.body)) : null,
      signal: init?.signal instanceof AbortSignal ? init.signal : null,
    });
    return response;
  });
  return { fetch, requests };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function delivery(fetch: typeof globalThis.fetch, getAccessToken = async () => 'session-token') {
  return createHttpInvitationDelivery({ fetch, getAccessToken, timeoutMs: 5_000 });
}

describe('HTTP invitation delivery', () => {
  it('posts the deliver request with the bearer token and locale and maps the accepted result', async () => {
    const { fetch, requests } = recordingFetch(jsonResponse(200, {
      invitationId: INVITATION_ID,
      expiresAt: EXPIRES_AT,
      delivery: 'accepted',
    }));
    const result = await delivery(fetch).deliverInvitation({
      spaceId: SPACE_ID,
      requestId: REQUEST_ID,
      email: 'person@example.com',
      locale: 'en',
    });
    expect(result).toEqual({ invitationId: INVITATION_ID, expiresAt: EXPIRES_AT });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: '/api/household-invitations/deliver',
      method: 'POST',
      authorization: 'Bearer session-token',
      contentType: 'application/json',
      body: {
        spaceId: SPACE_ID,
        requestId: REQUEST_ID,
        inviteeEmail: 'person@example.com',
        locale: 'en',
      },
    });
    expect(requests[0]?.signal).not.toBeNull();
  });

  it('honours an explicit delivery base URL', async () => {
    const { fetch, requests } = recordingFetch(jsonResponse(200, {
      invitationId: INVITATION_ID,
      expiresAt: EXPIRES_AT,
      delivery: 'accepted',
    }));
    const client = createHttpInvitationDelivery({
      fetch,
      getAccessToken: async () => 'session-token',
      baseUrl: 'https://worker.example.test',
    });
    await client.deliverInvitation({
      spaceId: SPACE_ID,
      requestId: REQUEST_ID,
      email: 'person@example.com',
      locale: 'ar',
    });
    expect(requests[0]?.url).toBe('https://worker.example.test/api/household-invitations/deliver');
  });

  it.each([
    [jsonResponse(429, { error: 'rate_limited' }), 'rate_limited', 429],
    [jsonResponse(409, { error: 'delivery_status_ambiguous' }), 'delivery_status_ambiguous', 409],
    [jsonResponse(404, { error: 'not_found' }), 'not_found', 404],
    [jsonResponse(401, { error: 'invalid_authorization' }), 'invalid_authorization', 401],
    [jsonResponse(400, { error: 'invitation_command_rejected' }), 'invitation_command_rejected', 400],
  ])('maps worker rejection %o to a safe delivery error', async (response, code, status) => {
    const { fetch } = recordingFetch(response);
    const failure = await delivery(fetch).deliverInvitation({
      spaceId: SPACE_ID,
      requestId: REQUEST_ID,
      email: 'person@example.com',
      locale: 'en',
    }).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(HouseholdInvitationDeliveryError);
    expect((failure as HouseholdInvitationDeliveryError).code).toBe(code);
    expect((failure as HouseholdInvitationDeliveryError).status).toBe(status);
    expect(String(failure)).not.toContain('person@example.com');
  });

  it.each([
    [jsonResponse(502, { error: 'delivery_failed' }), 'delivery_failed'],
    [jsonResponse(403, { error: 'origin_rejected' }), 'origin_rejected'],
    [jsonResponse(500, { error: 'unexpected' }), 'delivery_unavailable'],
    [new Response('<html>not json</html>', { status: 404, headers: { 'content-type': 'text/html' } }), 'not_found'],
    [jsonResponse(503, { error: 'unknown_future_code' }), 'delivery_unavailable'],
  ])('fails closed for rejection %o with code %s', async (response, code) => {
    const { fetch } = recordingFetch(response);
    const failure = await delivery(fetch).deliverInvitation({
      spaceId: SPACE_ID,
      requestId: REQUEST_ID,
      email: 'person@example.com',
      locale: 'en',
    }).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(HouseholdInvitationDeliveryError);
    expect((failure as HouseholdInvitationDeliveryError).code).toBe(code);
  });

  it('rejects malformed success payloads without exposing their contents', async () => {
    const { fetch } = recordingFetch(jsonResponse(200, {
      invitationId: 'not-a-uuid',
      expiresAt: EXPIRES_AT,
      delivery: 'accepted',
    }));
    const failure = await delivery(fetch).deliverInvitation({
      spaceId: SPACE_ID,
      requestId: REQUEST_ID,
      email: 'person@example.com',
      locale: 'en',
    }).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(HouseholdInvitationDeliveryError);
    expect((failure as HouseholdInvitationDeliveryError).code).toBe('upstream_response_invalid');
  });

  it('rejects invitations when no access token is available', async () => {
    const { fetch } = recordingFetch(jsonResponse(200, {}));
    const failure = await delivery(fetch, async () => {
      throw new Error('not_authenticated');
    }).deliverInvitation({
      spaceId: SPACE_ID,
      requestId: REQUEST_ID,
      email: 'person@example.com',
      locale: 'en',
    }).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(HouseholdInvitationDeliveryError);
    expect((failure as HouseholdInvitationDeliveryError).code).toBe('invalid_authorization');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('turns network failures into a retryable network error', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const failure = await delivery(fetch).deliverInvitation({
      spaceId: SPACE_ID,
      requestId: REQUEST_ID,
      email: 'person@example.com',
      locale: 'en',
    }).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(HouseholdInvitationDeliveryError);
    expect((failure as HouseholdInvitationDeliveryError).code).toBe('network_error');
  });
});
