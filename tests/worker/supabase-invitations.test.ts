import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSupabaseInvitationCommand } from '../../worker/household-invitations/supabase-invitations.js';

const input = {
  bearerToken: 'header.payload.signature',
  spaceId: '01234567-89ab-4def-8123-456789abcdef',
  requestId: '12345678-9abc-4def-8123-456789abcdef',
  inviteeEmail: 'person@example.com',
};

const row = {
  invitation_id: '22345678-9abc-4def-8123-456789abcdef',
  invitation_token: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ABCDE',
  expires_at: '2026-09-17T12:00:00.000Z',
};

function clientWith(fetch: typeof globalThis.fetch, timeoutMs = 10_000) {
  return createSupabaseInvitationCommand({
    fetch,
    baseUrl: 'https://budget-project.supabase.co',
    anonKey: 'sb_publishable_example_value',
    timeoutMs,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Supabase household invitation command adapter', () => {
  it('calls only the protected RPC with the caller JWT and exact parameters', async () => {
    const requestSpy = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify([row]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(clientWith(requestSpy).create(input)).resolves.toEqual({
      invitationId: row.invitation_id,
      invitationToken: row.invitation_token,
      expiresAt: row.expires_at,
    });

    expect(requestSpy).toHaveBeenCalledTimes(1);
    const [url, init] = requestSpy.mock.calls[0]!;
    expect(url).toBe(
      'https://budget-project.supabase.co/rest/v1/rpc/create_household_invitation',
    );
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        apikey: 'sb_publishable_example_value',
        authorization: `Bearer ${input.bearerToken}`,
        'content-type': 'application/json',
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      p_space_id: input.spaceId,
      p_request_id: input.requestId,
      p_invitee_email: input.inviteeEmail,
    });
    expect(String(url)).not.toContain('household_invitations?');
    expect(JSON.stringify(init?.headers)).not.toContain('service_role');
  });

  it('aborts the single command attempt at its deadline', async () => {
    vi.useFakeTimers();
    const requestSpy = vi.fn<typeof globalThis.fetch>().mockImplementation((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('marker', 'AbortError')));
      }),
    );
    const pending = clientWith(requestSpy).create(input);
    const rejection = expect(pending).rejects.toMatchObject({
      code: 'invitation_command_unavailable',
      status: 503,
    });

    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, 400, 'invitation_command_rejected'],
    [401, 401, 'invitation_command_rejected'],
    [403, 403, 'invitation_command_rejected'],
    [409, 409, 'invitation_command_rejected'],
    [429, 503, 'invitation_command_unavailable'],
    [500, 503, 'invitation_command_unavailable'],
  ])('maps upstream %i without copying its response body', async (upstream, status, code) => {
    const marker = 'DO_NOT_DISCLOSE_person@example.com_raw_token';
    const requestSpy = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(marker, { status: upstream }));

    const pending = clientWith(requestSpy).create(input);

    await expect(pending).rejects.toMatchObject({ code, status });
    await expect(pending).rejects.not.toThrow(marker);
  });

  it.each([
    [JSON.stringify({ ...row }), 'response'],
    [JSON.stringify([]), 'response'],
    [JSON.stringify([{ ...row, invitation_id: 'not-a-uuid' }]), 'response'],
    [JSON.stringify([{ ...row, invitation_token: 'short' }]), 'response'],
    [JSON.stringify([{ ...row, expires_at: 'not-a-time' }]), 'response'],
    ['not-json', 'response'],
    [JSON.stringify([row]).padEnd(4_097, ' '), 'response'],
  ])('rejects malformed or oversized success responses', async (body, safeField) => {
    const requestSpy = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(body, { status: 200 }));

    await expect(clientWith(requestSpy).create(input)).rejects.toThrow(safeField);
  });

  it('maps network failures without disclosing thrown exception text', async () => {
    const marker = 'DO_NOT_DISCLOSE_NETWORK_person@example.com';
    const requestSpy = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error(marker));

    const pending = clientWith(requestSpy).create(input);

    await expect(pending).rejects.toMatchObject({
      code: 'invitation_command_unavailable',
      status: 503,
    });
    await expect(pending).rejects.not.toThrow(marker);
  });
});
