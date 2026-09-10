import { describe, expect, it, vi } from 'vitest';

import type { AuditEvent } from '../../worker/household-invitations/contracts.js';
import { createWorkerHandler } from '../../worker/handler.js';

const actorId = '32345678-9abc-4def-8123-456789abcdef';
const requestBody = {
  spaceId: '01234567-89ab-4def-8123-456789abcdef',
  requestId: '12345678-9abc-4def-8123-456789abcdef',
  inviteeEmail: 'person@example.com',
  locale: 'en',
};
const invitationRow = {
  invitation_id: '22345678-9abc-4def-8123-456789abcdef',
  invitation_token: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ABCDE',
  expires_at: '2026-09-17T12:00:00.000Z',
};

function jwtFor(subject = actorId): string {
  const payload = btoa(JSON.stringify({ sub: subject }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  return `header.${payload}.signature`;
}

function createEnvironment(overrides: Record<string, unknown> = {}) {
  return {
    APP_ORIGIN: 'https://budget.example.com',
    SUPABASE_URL: 'https://budget-project.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_example_value',
    RESEND_API_KEY: 're_example_value',
    HOUSEHOLD_INVITATION_FROM: 'Budget <invitations@updates.example.com>',
    HOUSEHOLD_INVITATION_REPLY_TO: 'support@example.com',
    HOUSEHOLD_INVITATION_IP_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    HOUSEHOLD_INVITATION_ACTOR_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('asset')) },
    ...overrides,
  };
}

function apiRequest(overrides: {
  body?: string;
  method?: string;
  origin?: string;
  authorization?: string;
  contentType?: string;
  ip?: string;
  path?: string;
} = {}): Request {
  const method = overrides.method ?? 'POST';
  const headers = new Headers({
    origin: overrides.origin ?? 'https://budget.example.com',
    authorization: overrides.authorization ?? `Bearer ${jwtFor()}`,
    'content-type': overrides.contentType ?? 'application/json',
    'cf-connecting-ip': overrides.ip ?? '203.0.113.4',
  });
  return new Request(
    `https://budget.example.com${overrides.path ?? '/api/household-invitations/deliver'}`,
    {
      method,
      headers,
      ...(method === 'GET' || method === 'HEAD'
        ? {}
        : { body: overrides.body ?? JSON.stringify(requestBody) }),
    },
  );
}

function harness(fetchImplementation?: typeof globalThis.fetch) {
  const events: AuditEvent[] = [];
  const fetch = fetchImplementation ?? vi.fn<typeof globalThis.fetch>().mockImplementation((url) => {
    if (String(url).includes('supabase.co')) {
      return Promise.resolve(new Response(JSON.stringify([invitationRow]), { status: 200 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ id: '4f82c0f1-f7f3-44d2-b917-b066eb341a45' }), {
        status: 200,
      }),
    );
  });
  const handler = createWorkerHandler({
    fetch,
    audit: { async record(event) { events.push(event); } },
    clock: { now: () => new Date('2026-09-10T12:00:00.000Z') },
    sleep: vi.fn().mockResolvedValue(undefined),
    jitter: () => 0,
  });
  return { handler, fetch, events };
}

describe('invitation delivery Worker handler', () => {
  it('applies IP then actor-space throttles and returns only safe delivery data', async () => {
    const environment = createEnvironment();
    const { handler, fetch } = harness();

    const response = await handler.fetch(apiRequest(), environment);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      invitationId: invitationRow.invitation_id,
      expiresAt: invitationRow.expires_at,
      delivery: 'accepted',
    });
    expect(environment.HOUSEHOLD_INVITATION_IP_LIMITER.limit).toHaveBeenCalledOnce();
    expect(environment.HOUSEHOLD_INVITATION_ACTOR_LIMITER.limit).toHaveBeenCalledOnce();
    const ipKey = environment.HOUSEHOLD_INVITATION_IP_LIMITER.limit.mock.calls[0]![0].key;
    const actorKey = environment.HOUSEHOLD_INVITATION_ACTOR_LIMITER.limit.mock.calls[0]![0].key;
    expect(ipKey).toMatch(/^[a-f0-9]{64}$/);
    expect(actorKey).toMatch(/^[a-f0-9]{64}$/);
    expect(ipKey).not.toContain('203.0.113.4');
    expect(actorKey).not.toContain(actorId);
    expect(actorKey).not.toContain(requestBody.spaceId);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://budget.example.com');
  });

  it.each([
    [{ method: 'GET' }, 405, 'method_not_allowed'],
    [{ path: '/api/not-supported' }, 404, 'not_found'],
    [{ origin: 'https://evil.example.com' }, 403, 'origin_rejected'],
    [{ contentType: 'text/plain' }, 415, 'content_type_rejected'],
    [{ authorization: 'Basic secret' }, 401, 'invalid_authorization'],
    [{ authorization: `Bearer ${jwtFor('not-a-uuid')}` }, 401, 'invalid_authorization'],
    [{ body: 'not-json' }, 400, 'invalid_request'],
    [{ body: 'x'.repeat(4_097) }, 400, 'request_too_large'],
  ])('rejects an invalid request before any upstream call', async (overrides, status, code) => {
    const environment = createEnvironment();
    const { handler, fetch } = harness();

    const response = await handler.fetch(apiRequest(overrides), environment);

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: code });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('handles exact-origin preflight without contacting dependencies', async () => {
    const environment = createEnvironment();
    const { handler, fetch } = harness();

    const response = await handler.fetch(apiRequest({ method: 'OPTIONS' }), environment);

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://budget.example.com');
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stops after the IP limiter rejects', async () => {
    const ipLimit = vi.fn().mockResolvedValue({ success: false });
    const environment = createEnvironment({
      HOUSEHOLD_INVITATION_IP_LIMITER: { limit: ipLimit },
    });
    const { handler, fetch } = harness();

    const response = await handler.fetch(apiRequest(), environment);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: 'rate_limited' });
    expect(environment.HOUSEHOLD_INVITATION_ACTOR_LIMITER.limit).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stops after the actor-space limiter rejects', async () => {
    const actorLimit = vi.fn().mockResolvedValue({ success: false });
    const environment = createEnvironment({
      HOUSEHOLD_INVITATION_ACTOR_LIMITER: { limit: actorLimit },
    });
    const { handler, fetch } = harness();

    const response = await handler.fetch(apiRequest(), environment);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: 'rate_limited' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed when a limiter is unavailable', async () => {
    const environment = createEnvironment({
      HOUSEHOLD_INVITATION_IP_LIMITER: {
        limit: vi.fn().mockRejectedValue(new Error('limiter backend details')),
      },
    });
    const { handler, fetch } = harness();

    const response = await handler.fetch(apiRequest(), environment);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'rate_limit_unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps provider failure without exposing request or provider details', async () => {
    const marker = 'DO_NOT_DISCLOSE_PROVIDER_person@example.com';
    const upstream = vi.fn<typeof globalThis.fetch>().mockImplementation((url) => {
      if (String(url).includes('supabase.co')) {
        return Promise.resolve(new Response(JSON.stringify([invitationRow]), { status: 200 }));
      }
      return Promise.resolve(new Response(marker, { status: 403 }));
    });
    const environment = createEnvironment();
    const { handler } = harness(upstream);

    const response = await handler.fetch(apiRequest(), environment);
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(502);
    expect(body).toBe('{"error":"delivery_failed"}');
    expect(body).not.toContain(marker);
    expect(body).not.toContain(requestBody.inviteeEmail);
    expect(body).not.toContain(invitationRow.invitation_token);
  });

  it('fails safely before upstream work when a required binding is absent', async () => {
    const environment = createEnvironment({ RESEND_API_KEY: '' });
    const { handler, fetch } = harness();

    const response = await handler.fetch(apiRequest(), environment);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_configuration' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('delegates every non-API request to the static assets binding', async () => {
    const environment = createEnvironment();
    const { handler, fetch } = harness();
    const request = new Request('https://budget.example.com/loans');

    const response = await handler.fetch(request, environment);

    expect(await response.text()).toBe('asset');
    expect(environment.ASSETS.fetch).toHaveBeenCalledWith(request);
    expect(fetch).not.toHaveBeenCalled();
  });
});
