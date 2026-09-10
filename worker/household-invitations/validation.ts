import {
  SafeDeliveryError,
  type DeliveryConfiguration,
  type DeliveryRequest,
  type InvitationLocale,
} from './contracts.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EMAIL_MAX_BYTES = 254;
const MAX_BODY_CHUNKS = 4_097;
const configurationFields = [
  'appOrigin',
  'supabaseUrl',
  'supabaseAnonKey',
  'resendApiKey',
  'invitationFrom',
  'invitationReplyTo',
] as const;

const bindingNames: Record<(typeof configurationFields)[number], string> = {
  appOrigin: 'APP_ORIGIN',
  supabaseUrl: 'SUPABASE_URL',
  supabaseAnonKey: 'SUPABASE_ANON_KEY',
  resendApiKey: 'RESEND_API_KEY',
  invitationFrom: 'HOUSEHOLD_INVITATION_FROM',
  invitationReplyTo: 'HOUSEHOLD_INVITATION_REPLY_TO',
};

function invalidRequest(field: string): never {
  throw new SafeDeliveryError('invalid_request', 400, field);
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value);
}

function normalizedEmail(value: unknown): string {
  if (typeof value !== 'string') invalidRequest('inviteeEmail');
  const normalized = value.trim();
  const bytes = new TextEncoder().encode(normalized).byteLength;
  const atCount = [...normalized].filter((character) => character === '@').length;
  const [local, domain] = normalized.split('@');

  if (
    bytes < 3 ||
    bytes > EMAIL_MAX_BYTES ||
    /[\s\p{Cc}]/u.test(normalized) ||
    atCount !== 1 ||
    !local ||
    !domain
  ) {
    invalidRequest('inviteeEmail');
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateDeliveryRequest(value: unknown): DeliveryRequest {
  if (!isRecord(value)) invalidRequest('request');
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'inviteeEmail,locale,requestId,spaceId') invalidRequest('request');
  if (!validUuid(value.spaceId)) invalidRequest('spaceId');
  if (!validUuid(value.requestId)) invalidRequest('requestId');
  if (value.locale !== 'en' && value.locale !== 'ar') invalidRequest('locale');

  return {
    spaceId: value.spaceId,
    requestId: value.requestId,
    inviteeEmail: normalizedEmail(value.inviteeEmail),
    locale: value.locale as InvitationLocale,
  };
}

export function parseBearerToken(value: string | null): string {
  const match = value?.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
  if (!match?.[1]) {
    throw new SafeDeliveryError('invalid_authorization', 401, 'authorization');
  }
  return match[1];
}

export async function readBoundedBody(
  request: Request,
  maxBytes: number,
  timeoutMs = 5_000,
): Promise<string> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
      throw new SafeDeliveryError('request_too_large', 400, 'body');
    }
  }
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const bodyReadTimedOut = Symbol('body-read-timed-out');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof bodyReadTimedOut>((resolve) => {
    timeout = setTimeout(() => resolve(bodyReadTimedOut), timeoutMs);
  });

  try {
    for (let chunkIndex = 0; chunkIndex < MAX_BODY_CHUNKS; chunkIndex += 1) {
      const result = await Promise.race([reader.read(), deadline]);
      if (result === bodyReadTimedOut) {
        await reader.cancel().catch(() => undefined);
        throw new SafeDeliveryError('request_timeout', 408, 'body');
      }
      if (result.done) {
        const body = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }
        try {
          return new TextDecoder('utf-8', { fatal: true }).decode(body);
        } catch {
          throw new SafeDeliveryError('invalid_request', 400, 'body');
        }
      }

      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new SafeDeliveryError('request_too_large', 400, 'body');
      }
      chunks.push(result.value);
    }
    await reader.cancel();
    throw new SafeDeliveryError('request_too_large', 400, 'body');
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}

function validateOrigin(value: string, bindingName: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SafeDeliveryError('invalid_configuration', 500, bindingName);
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.origin !== value
  ) {
    throw new SafeDeliveryError('invalid_configuration', 500, bindingName);
  }
  return value;
}

function validateEmailConfiguration(value: string, bindingName: string): string {
  try {
    return normalizedEmail(value);
  } catch {
    throw new SafeDeliveryError('invalid_configuration', 500, bindingName);
  }
}

export function validateDeliveryConfiguration(value: DeliveryConfiguration): DeliveryConfiguration {
  for (const field of configurationFields) {
    const candidate = value[field];
    if (!candidate || candidate !== candidate.trim() || /[\p{Cc}]/u.test(candidate)) {
      throw new SafeDeliveryError('invalid_configuration', 500, bindingNames[field]);
    }
  }

  return {
    appOrigin: validateOrigin(value.appOrigin, 'APP_ORIGIN'),
    supabaseUrl: validateOrigin(value.supabaseUrl, 'SUPABASE_URL'),
    supabaseAnonKey: value.supabaseAnonKey,
    resendApiKey: value.resendApiKey,
    invitationFrom: value.invitationFrom,
    invitationReplyTo: validateEmailConfiguration(
      value.invitationReplyTo,
      'HOUSEHOLD_INVITATION_REPLY_TO',
    ),
  };
}

export async function hashRateLimitKey(scope: string, values: readonly string[]): Promise<string> {
  const encoded = new TextEncoder().encode(
    ['budget-household-invitation-rate-v1', scope, ...values].join('|'),
  );
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoded));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
