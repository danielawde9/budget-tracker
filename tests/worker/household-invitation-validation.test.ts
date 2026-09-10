import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  hashRateLimitKey,
  parseBearerToken,
  readBoundedBody,
  validateDeliveryConfiguration,
  validateDeliveryRequest,
} from '../../worker/household-invitations/validation.js';

const validRequest = {
  spaceId: '01234567-89ab-4def-8123-456789abcdef',
  requestId: '12345678-9abc-4def-8123-456789abcdef',
  inviteeEmail: 'person@example.com',
  locale: 'en',
};

const validConfiguration = {
  appOrigin: 'https://budget.example.com',
  supabaseUrl: 'https://budget-project.supabase.co',
  supabaseAnonKey: 'sb_publishable_example_value',
  resendApiKey: 're_example_value',
  invitationFrom: 'Budget <invitations@updates.example.com>',
  invitationReplyTo: 'support@example.com',
};

afterEach(() => {
  vi.useRealTimers();
});

describe('household invitation request validation', () => {
  it('accepts the exact bounded request contract', () => {
    expect(validateDeliveryRequest(validRequest)).toEqual(validRequest);
    expect(validateDeliveryRequest({ ...validRequest, locale: 'ar' })).toEqual({
      ...validRequest,
      locale: 'ar',
    });
  });

  it.each([
    [{ ...validRequest, spaceId: 'not-a-uuid' }, 'spaceId'],
    [{ ...validRequest, requestId: '01234567-89ab-7def-8123-456789abcdef' }, 'requestId'],
    [{ ...validRequest, inviteeEmail: 'missing-at.example.com' }, 'inviteeEmail'],
    [{ ...validRequest, inviteeEmail: 'two@@example.com' }, 'inviteeEmail'],
    [{ ...validRequest, inviteeEmail: 'person @example.com' }, 'inviteeEmail'],
    [{ ...validRequest, inviteeEmail: 'person@\nexample.com' }, 'inviteeEmail'],
    [{ ...validRequest, inviteeEmail: `${'é'.repeat(122)}@example.com` }, 'inviteeEmail'],
    [{ ...validRequest, locale: 'fr' }, 'locale'],
    [{ ...validRequest, extra: 'not-allowed' }, 'request'],
    [null, 'request'],
  ])('rejects invalid input using only a safe field name', (input, field) => {
    expect(() => validateDeliveryRequest(input)).toThrow(field);
    try {
      validateDeliveryRequest(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('missing-at.example.com');
      expect(message).not.toContain('two@@example.com');
      expect(message).not.toContain('é');
    }
  });

  it('trims email only to match the existing database transport boundary', () => {
    expect(
      validateDeliveryRequest({ ...validRequest, inviteeEmail: '  Person@Example.COM  ' }),
    ).toEqual({ ...validRequest, inviteeEmail: 'Person@Example.COM' });
  });
});

describe('bounded HTTP input', () => {
  it('accepts exactly one bearer token without returning its value in failures', () => {
    expect(parseBearerToken('Bearer header.payload.signature')).toBe('header.payload.signature');

    for (const value of [null, '', 'Basic secret', 'Bearer ', 'Bearer one two', 'Bearer a,b']) {
      expect(() => parseBearerToken(value)).toThrow('authorization');
    }
  });

  it('reads a streaming body only up to the byte limit', async () => {
    const accepted = new Request('https://budget.example.com/api', {
      method: 'POST',
      body: 'éé',
    });
    await expect(readBoundedBody(accepted, 4)).resolves.toBe('éé');

    const rejected = new Request('https://budget.example.com/api', {
      method: 'POST',
      body: 'ééa',
    });
    await expect(readBoundedBody(rejected, 4)).rejects.toThrow('body');
  });

  it('rejects an oversized declared body before reading it', async () => {
    const request = new Request('https://budget.example.com/api', {
      method: 'POST',
      headers: { 'content-length': '4097' },
      body: '{}',
    });

    await expect(readBoundedBody(request, 4096)).rejects.toThrow('body');
  });

  it('cancels a body stream that does not complete before the deadline', async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
      cancel: () => {
        cancelled = true;
      },
    });
    const request = new Request('https://budget.example.com/api', {
      method: 'POST',
      body,
      duplex: 'half',
    } as RequestInit);

    const result = expect(readBoundedBody(request, 4096, 25)).rejects.toMatchObject({
      code: 'request_timeout',
      status: 408,
    });
    await vi.advanceTimersByTimeAsync(25);

    await result;
    expect(cancelled).toBe(true);
  });
});

describe('server delivery configuration', () => {
  it('accepts only credential-free HTTPS origins and named nonempty bindings', () => {
    expect(validateDeliveryConfiguration(validConfiguration)).toEqual(validConfiguration);
  });

  it.each([
    [{ ...validConfiguration, appOrigin: 'http://budget.example.com' }, 'APP_ORIGIN'],
    [{ ...validConfiguration, appOrigin: 'https://user@budget.example.com' }, 'APP_ORIGIN'],
    [{ ...validConfiguration, appOrigin: 'https://budget.example.com/path' }, 'APP_ORIGIN'],
    [{ ...validConfiguration, supabaseUrl: 'https://budget.example.com/path' }, 'SUPABASE_URL'],
    [{ ...validConfiguration, supabaseAnonKey: ' ' }, 'SUPABASE_ANON_KEY'],
    [{ ...validConfiguration, resendApiKey: '' }, 'RESEND_API_KEY'],
    [{ ...validConfiguration, invitationFrom: '\n' }, 'HOUSEHOLD_INVITATION_FROM'],
    [{ ...validConfiguration, invitationReplyTo: 'not-an-email' }, 'HOUSEHOLD_INVITATION_REPLY_TO'],
  ])('fails closed without disclosing the invalid value', (configuration, field) => {
    expect(() => validateDeliveryConfiguration(configuration)).toThrow(field);
  });

  it('hashes limiter inputs deterministically with domain separation', async () => {
    const first = await hashRateLimitKey('ip', ['203.0.113.4']);
    const again = await hashRateLimitKey('ip', ['203.0.113.4']);
    const otherScope = await hashRateLimitKey('actor-space', ['203.0.113.4']);

    expect(first).toBe(again);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(otherScope).not.toBe(first);
    expect(first).not.toContain('203.0.113.4');
  });
});
