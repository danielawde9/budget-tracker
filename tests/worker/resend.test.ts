import { afterEach, describe, expect, it, vi } from 'vitest';

import { createResendProvider } from '../../worker/household-invitations/resend.js';

const email = {
  from: 'Budget <invitations@updates.example.com>',
  replyTo: 'support@example.com',
  to: 'person@example.com',
  subject: "You're invited to a household space",
  html: '<html><body><p>Invitation</p></body></html>',
  text: 'Invitation',
  locale: 'en' as const,
  idempotencyKey: 'household-invitation/22345678-9abc-4def-8123-456789abcdef',
};

function providerWith(fetch: typeof globalThis.fetch, timeoutMs = 10_000) {
  return createResendProvider({
    fetch,
    apiKey: 're_example_value',
    timeoutMs,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Resend provider adapter', () => {
  it('submits one complete transactional email with stable idempotency', async () => {
    const requestSpy = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: '4f82c0f1-f7f3-44d2-b917-b066eb341a45' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(providerWith(requestSpy).send(email)).resolves.toEqual({
      providerMessageId: '4f82c0f1-f7f3-44d2-b917-b066eb341a45',
    });

    expect(requestSpy).toHaveBeenCalledTimes(1);
    const [url, init] = requestSpy.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        authorization: 'Bearer re_example_value',
        'content-type': 'application/json',
        'idempotency-key': email.idempotencyKey,
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      from: email.from,
      reply_to: email.replyTo,
      to: [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
      tags: [
        { name: 'email_type', value: 'household_invitation' },
        { name: 'locale', value: 'en' },
      ],
    });
  });

  it('aborts an attempt at the configured deadline', async () => {
    vi.useFakeTimers();
    const requestSpy = vi.fn<typeof globalThis.fetch>().mockImplementation((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('marker', 'AbortError')));
      }),
    );
    const pending = providerWith(requestSpy).send(email);
    const rejection = expect(pending).rejects.toMatchObject({
      category: 'network',
      retryable: true,
    });

    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, 'invalid_request', false],
    [401, 'unauthorized', false],
    [403, 'forbidden', false],
    [409, 'idempotency_conflict', false],
    [422, 'invalid_request', false],
    [429, 'rate_limited', true],
    [500, 'server_error', true],
    [503, 'server_error', true],
  ])('classifies HTTP %i without copying the response body', async (status, category, retryable) => {
    const marker = 'DO_NOT_DISCLOSE_person@example.com_raw_token';
    const requestSpy = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(marker, { status }));

    const pending = providerWith(requestSpy).send(email);

    await expect(pending).rejects.toMatchObject({ category, retryable });
    await expect(pending).rejects.not.toThrow(marker);
  });

  it.each([
    ['not-json'],
    [JSON.stringify({})],
    [JSON.stringify({ id: '' })],
    [JSON.stringify({ id: 'contains whitespace' })],
    [JSON.stringify({ id: 'x'.repeat(257) })],
    [JSON.stringify({ id: 'valid-id' }).padEnd(1_025, ' ')],
  ])('rejects malformed or oversized success data', async (body) => {
    const requestSpy = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(body, { status: 200 }));

    await expect(providerWith(requestSpy).send(email)).rejects.toMatchObject({
      category: 'invalid_response',
      retryable: false,
    });
  });

  it('maps thrown network details to a fixed retryable error', async () => {
    const marker = 'DO_NOT_DISCLOSE_NETWORK_person@example.com';
    const requestSpy = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error(marker));

    const pending = providerWith(requestSpy).send(email);

    await expect(pending).rejects.toMatchObject({ category: 'network', retryable: true });
    await expect(pending).rejects.not.toThrow(marker);
  });
});
