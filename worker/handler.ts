import {
  SafeDeliveryError,
  type AuditEvent,
  type AuditSink,
  type Clock,
  type FetchLike,
} from './household-invitations/contracts.js';
import { createHouseholdInvitationDelivery } from './household-invitations/deliver.js';
import { createResendProvider } from './household-invitations/resend.js';
import { createSupabaseInvitationCommand } from './household-invitations/supabase-invitations.js';
import {
  hashRateLimitKey,
  parseBearerToken,
  readBoundedBody,
  validateDeliveryConfiguration,
  validateDeliveryRequest,
} from './household-invitations/validation.js';

const DELIVERY_PATH = '/api/household-invitations/deliver';
const BODY_MAX_BYTES = 4_096;
const BODY_READ_TIMEOUT_MS = 5_000;
const TOKEN_MAX_BYTES = 4_096;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface HandlerEnvironment {
  readonly APP_ORIGIN: string;
  readonly SUPABASE_URL: string;
  readonly SUPABASE_ANON_KEY: string;
  readonly RESEND_API_KEY: string;
  readonly HOUSEHOLD_INVITATION_FROM: string;
  readonly HOUSEHOLD_INVITATION_REPLY_TO: string;
  readonly HOUSEHOLD_INVITATION_IP_LIMITER: RateLimitBinding;
  readonly HOUSEHOLD_INVITATION_ACTOR_LIMITER: RateLimitBinding;
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
}

interface HandlerDependencies {
  readonly fetch: FetchLike;
  readonly audit: AuditSink;
  readonly clock: Clock;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly jitter: () => number;
}

interface WorkerHandler {
  fetch(request: Request, environment: HandlerEnvironment): Promise<Response>;
}

function corsHeaders(origin?: string): HeadersInit {
  return origin
    ? {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type',
        vary: 'Origin',
      }
    : {};
}

function jsonResponse(value: unknown, status: number, origin?: string): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
  });
}

function safeError(error: unknown): SafeDeliveryError {
  if (error instanceof SafeDeliveryError) return error;
  return new SafeDeliveryError('delivery_unavailable', 500);
}

async function recordRejectedRequest(
  request: Request,
  path: string,
  error: SafeDeliveryError,
  dependencies: HandlerDependencies,
): Promise<void> {
  if (error.code === 'rate_limited' || error.code === 'audit_unavailable') return;
  const correlationKey = await hashRateLimitKey('request-rejected', [
    path,
    request.method,
    request.headers.get('cf-connecting-ip') ?? 'unknown',
  ]);
  try {
    await dependencies.audit.record({
      at: dependencies.clock.now().toISOString(),
      event: 'request_rejected',
      correlationKey,
      reason: error.code,
    });
  } catch {
    throw new SafeDeliveryError('audit_unavailable', 503);
  }
}

function extractJwtSubject(token: string): string {
  if (new TextEncoder().encode(token).byteLength > TOKEN_MAX_BYTES) {
    throw new SafeDeliveryError('invalid_authorization', 401);
  }
  const parts = token.split('.');
  const payload = parts.length === 3 ? parts[1] : undefined;
  if (!payload || payload.length > 2_048 || !/^[A-Za-z0-9_-]+$/.test(payload)) {
    throw new SafeDeliveryError('invalid_authorization', 401);
  }
  try {
    const padded = `${payload}${'='.repeat((4 - (payload.length % 4)) % 4)}`
      .replaceAll('-', '+')
      .replaceAll('_', '/');
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('sub' in parsed) ||
      typeof parsed.sub !== 'string' ||
      !UUID_V4.test(parsed.sub)
    ) {
      throw new Error('invalid');
    }
    return parsed.sub;
  } catch {
    throw new SafeDeliveryError('invalid_authorization', 401);
  }
}

async function applyRateLimit(
  limiter: RateLimitBinding,
  key: string,
  audit: AuditSink,
  clock: Clock,
  scope: 'ip' | 'actor_space',
): Promise<void> {
  let allowed: boolean;
  try {
    allowed = (await limiter.limit({ key })).success;
  } catch {
    throw new SafeDeliveryError('rate_limit_unavailable', 503);
  }
  if (allowed) return;
  await audit.record({
    at: clock.now().toISOString(),
    event: 'request_rate_limited',
    correlationKey: key,
    reason: scope,
  });
  throw new SafeDeliveryError('rate_limited', 429);
}

function workerConfiguration(environment: HandlerEnvironment) {
  return validateDeliveryConfiguration({
    appOrigin: environment.APP_ORIGIN,
    supabaseUrl: environment.SUPABASE_URL,
    supabaseAnonKey: environment.SUPABASE_ANON_KEY,
    resendApiKey: environment.RESEND_API_KEY,
    invitationFrom: environment.HOUSEHOLD_INVITATION_FROM,
    invitationReplyTo: environment.HOUSEHOLD_INVITATION_REPLY_TO,
  });
}

async function handleDelivery(
  request: Request,
  environment: HandlerEnvironment,
  dependencies: HandlerDependencies,
): Promise<Response> {
  const configuration = workerConfiguration(environment);
  const origin = request.headers.get('origin');
  if (origin !== configuration.appOrigin) throw new SafeDeliveryError('origin_rejected', 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== 'POST') throw new SafeDeliveryError('method_not_allowed', 405);
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
    throw new SafeDeliveryError('content_type_rejected', 415);
  }

  const bearerToken = parseBearerToken(request.headers.get('authorization'));
  const subject = extractJwtSubject(bearerToken);
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip || ip.length > 45 || !/^[0-9A-Fa-f:.]+$/.test(ip)) {
    throw new SafeDeliveryError('invalid_request', 400, 'network');
  }
  const ipKey = await hashRateLimitKey('ip', [ip]);
  await applyRateLimit(
    environment.HOUSEHOLD_INVITATION_IP_LIMITER,
    ipKey,
    dependencies.audit,
    dependencies.clock,
    'ip',
  );

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(
      await readBoundedBody(request, BODY_MAX_BYTES, BODY_READ_TIMEOUT_MS),
    );
  } catch (error) {
    if (error instanceof SafeDeliveryError) throw error;
    throw new SafeDeliveryError('invalid_request', 400, 'body');
  }
  const deliveryRequest = validateDeliveryRequest(parsedBody);
  const actorKey = await hashRateLimitKey('actor-space', [subject, deliveryRequest.spaceId]);
  await applyRateLimit(
    environment.HOUSEHOLD_INVITATION_ACTOR_LIMITER,
    actorKey,
    dependencies.audit,
    dependencies.clock,
    'actor_space',
  );
  const correlationKey = await hashRateLimitKey('audit', [
    subject,
    deliveryRequest.spaceId,
    deliveryRequest.requestId,
  ]);

  const service = createHouseholdInvitationDelivery({
    command: createSupabaseInvitationCommand({
      fetch: dependencies.fetch,
      baseUrl: configuration.supabaseUrl,
      anonKey: configuration.supabaseAnonKey,
      timeoutMs: 10_000,
    }),
    provider: createResendProvider({
      fetch: dependencies.fetch,
      apiKey: configuration.resendApiKey,
      timeoutMs: 10_000,
    }),
    configuration,
    audit: dependencies.audit,
    clock: dependencies.clock,
    sleep: dependencies.sleep,
    jitter: dependencies.jitter,
  });
  const result = await service.deliver({ request: deliveryRequest, bearerToken, correlationKey });
  return jsonResponse(result, 200, origin);
}

export function createWorkerHandler(dependencies: HandlerDependencies): WorkerHandler {
  return {
    async fetch(request, environment) {
      const path = new URL(request.url).pathname;
      if (!path.startsWith('/api/')) return environment.ASSETS.fetch(request);
      const origin = request.headers.get('origin');
      if (path !== DELIVERY_PATH) return jsonResponse({ error: 'not_found' }, 404);
      try {
        return await handleDelivery(request, environment, dependencies);
      } catch (error) {
        let safe = safeError(error);
        try {
          await recordRejectedRequest(request, path, safe, dependencies);
        } catch (auditError) {
          safe = safeError(auditError);
        }
        return jsonResponse(
          { error: safe.code },
          safe.status,
          origin === environment.APP_ORIGIN ? origin : undefined,
        );
      }
    },
  };
}

export const runtimeDependencies: HandlerDependencies = {
  fetch: globalThis.fetch.bind(globalThis),
  audit: {
    async record(event: AuditEvent) {
      console.log(JSON.stringify(event));
    },
  },
  clock: { now: () => new Date() },
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  jitter: () => {
    const byte = new Uint8Array(1);
    crypto.getRandomValues(byte);
    return (byte[0] ?? 0) % 101;
  },
};
