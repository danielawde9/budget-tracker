import { describe, expect, it, vi } from 'vitest';
import { createInvitationFunction } from '../../supabase/functions/household-invitations/handler.ts';
import type { AuditEvent } from '../../worker/household-invitations/contracts.js';

const actor = '32345678-9abc-4def-8123-456789abcdef';
const input = { spaceId: '01234567-89ab-4def-8123-456789abcdef', requestId: '12345678-9abc-4def-8123-456789abcdef', inviteeEmail: 'delivered@resend.dev', locale: 'en' };
const invitation = { invitation_id: '22345678-9abc-4def-8123-456789abcdef', invitation_token: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ABCDE', expires_at: '2026-10-10T12:00:00.000Z' };
const environment = {
  APP_ORIGIN: 'https://budget.example.com', SUPABASE_URL: 'https://budget.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_public_key', RESEND_API_KEY: 're_private_key',
  HOUSEHOLD_INVITATION_FROM: 'Budget <invitations@example.com>', HOUSEHOLD_INVITATION_REPLY_TO: 'support@example.com',
};
function request(overrides: { method?: string; origin?: string; body?: unknown } = {}) {
  const method = overrides.method ?? 'POST';
  return new Request('https://budget.supabase.co/functions/v1/household-invitations', {
    method, headers: { origin: overrides.origin ?? environment.APP_ORIGIN, authorization: 'Bearer signed-user-token', 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(overrides.body ?? input) } : {}),
  });
}
function harness(overrides: { auth?: number; limit?: boolean | string; provider?: number } = {}) {
  const events: AuditEvent[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === '/auth/v1/user') return Response.json({ id: actor }, { status: overrides.auth ?? 200 });
    if (path.endsWith('/consume_household_invitation_delivery_limit')) return Response.json(overrides.limit ?? true);
    if (path.endsWith('/create_household_invitation')) return Response.json([invitation]);
    if (String(url) === 'https://api.resend.com/emails') return Response.json({ id: 'provider-id' }, { status: overrides.provider ?? 200 });
    throw new Error('Unexpected upstream call');
  });
  const handler = createInvitationFunction({ fetch, audit: { async record(event) { events.push(event); } }, clock: { now: () => new Date('2026-10-03T12:00:00.000Z') }, sleep: vi.fn(), jitter: () => 0 });
  return { handler, fetch, events };
}
describe('Supabase invitation Edge Function', () => {
  it('authenticates and consumes durable limits before creating and sending, returning no token', async () => {
    const { handler, fetch, events } = harness();
    const result = await handler(request(), environment);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ invitationId: invitation.invitation_id, expiresAt: invitation.expires_at, delivery: 'accepted' });
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      `${environment.SUPABASE_URL}/auth/v1/user`, `${environment.SUPABASE_URL}/rest/v1/rpc/consume_household_invitation_delivery_limit`,
      `${environment.SUPABASE_URL}/rest/v1/rpc/create_household_invitation`, 'https://api.resend.com/emails',
    ]);
    const commandHeaders = new Headers(fetch.mock.calls[2]![1]!.headers);
    expect(commandHeaders.get('authorization')).toBe('Bearer signed-user-token');
    expect(commandHeaders.get('apikey')).toBe(environment.SUPABASE_ANON_KEY);
    const email = JSON.parse(String(fetch.mock.calls[3]![1]!.body));
    expect(email.to).toEqual([input.inviteeEmail]);
    expect(email.text).toContain('#household-invitation=');
    expect(new Headers(fetch.mock.calls[3]![1]!.headers).get('idempotency-key')).toBe(`household-invitation/${invitation.invitation_id}`);
    expect(JSON.stringify(events)).not.toMatch(/signed-user-token|delivered@resend.dev|re_private_key|AbCdEfGh/);
    expect(result.headers.get('access-control-allow-origin')).toBe(environment.APP_ORIGIN);
  });
  it.each([[false, 429, 'rate_limited'], ['invalid', 503, 'rate_limit_unavailable']] as const)('does not create or send when limits return %s', async (limit, status, code) => {
    const { handler, fetch } = harness({ limit });
    const result = await handler(request(), environment);
    expect(result.status).toBe(status);
    expect(await result.json()).toEqual({ error: code });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects invalid user tokens before rate limits or email creation', async () => {
    const { handler, fetch } = harness({ auth: 401 });
    const result = await handler(request(), environment);
    expect(result.status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('allows preflight even before provider secrets are configured', async () => {
    const { handler, fetch } = harness();
    const result = await handler(request({ method: 'OPTIONS' }), { ...environment, RESEND_API_KEY: '' });
    expect(result.status).toBe(204);
    expect(result.headers.get('access-control-allow-headers')).toContain('apikey');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('allows an explicitly configured HTTPS deployment alias while email links use the canonical origin', async () => {
    const { handler, fetch } = harness();
    const alias = 'https://budget.example.workers.dev';
    const result = await handler(request({ origin: alias }), { ...environment, APP_ALLOWED_ORIGINS: alias });
    expect(result.status).toBe(200);
    expect(result.headers.get('access-control-allow-origin')).toBe(alias);
    const email = JSON.parse(String(fetch.mock.calls[3]![1]!.body));
    expect(email.text).toContain(environment.APP_ORIGIN);
  });
  it('rejects other origins before upstream work', async () => {
    const { handler, fetch } = harness();
    const result = await handler(request({ origin: 'https://other.example.com' }), environment);
    expect(result.status).toBe(403);
    expect(result.headers.get('access-control-allow-origin')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not consume limits or send for malformed invitation requests', async () => {
    const { handler, fetch } = harness();
    const result = await handler(request({ body: { ...input, extra: 'invalid' } }), environment);
    expect(result.status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps provider failures sanitized', async () => {
    const { handler } = harness({ provider: 403 });
    const result = await handler(request(), environment);
    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({ error: 'delivery_failed' });
  });
});
