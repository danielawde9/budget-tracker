import { SafeDeliveryError, type AuditSink, type Clock, type DeliveryConfiguration, type FetchLike } from '../_shared/household-invitations/contracts.ts';
import { createHouseholdInvitationDelivery } from '../_shared/household-invitations/deliver.ts';
import { createResendProvider } from '../_shared/household-invitations/resend.ts';
import { createSupabaseInvitationCommand } from '../_shared/household-invitations/supabase-invitations.ts';
import { hashRateLimitKey, parseBearerToken, readBoundedBody, validateDeliveryConfiguration, validateDeliveryRequest } from '../_shared/household-invitations/validation.ts';

export interface InvitationEnvironment {
  readonly APP_ORIGIN: string;
  readonly APP_ALLOWED_ORIGINS?: string;
  readonly SUPABASE_URL: string;
  readonly SUPABASE_ANON_KEY: string;
  readonly RESEND_API_KEY: string;
  readonly HOUSEHOLD_INVITATION_FROM: string;
  readonly HOUSEHOLD_INVITATION_REPLY_TO: string;
}

export interface InvitationDependencies {
  readonly fetch: FetchLike;
  readonly audit: AuditSink;
  readonly clock: Clock;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly jitter: () => number;
}

const BODY_MAX_BYTES = 4_096;
const UPSTREAM_TIMEOUT_MS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(body: unknown, status: number, origin?: string): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(origin ? {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
        vary: 'Origin',
      } : {}),
    },
  });
}

function approvedOrigin(origin: string | null, environment: InvitationEnvironment): string | undefined {
  const origins = [environment.APP_ORIGIN, ...(environment.APP_ALLOWED_ORIGINS ?? '').split(',')];
  if (!origin || !origins.map((value) => value.trim()).includes(origin)) return undefined;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && !url.username && !url.password && url.origin === origin ? origin : undefined;
  } catch {
    return undefined;
  }
}

function configuration(environment: InvitationEnvironment): DeliveryConfiguration {
  return validateDeliveryConfiguration({
    appOrigin: environment.APP_ORIGIN,
    supabaseUrl: environment.SUPABASE_URL,
    supabaseAnonKey: environment.SUPABASE_ANON_KEY,
    resendApiKey: environment.RESEND_API_KEY,
    invitationFrom: environment.HOUSEHOLD_INVITATION_FROM,
    invitationReplyTo: environment.HOUSEHOLD_INVITATION_REPLY_TO,
  });
}

async function authenticatedJson(
  dependencies: InvitationDependencies,
  config: DeliveryConfiguration,
  token: string,
  path: string,
  failure: 'invalid_authorization' | 'rate_limit_unavailable',
  body?: unknown,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const result = await dependencies.fetch(`${config.supabaseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        apikey: config.supabaseAnonKey,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    if (!result.ok) {
      if (result.status === 401 || result.status === 403) throw new SafeDeliveryError('invalid_authorization', 401);
      throw new SafeDeliveryError(failure, failure === 'invalid_authorization' ? 401 : 503);
    }
    return JSON.parse(await readBoundedBody(result, path === '/auth/v1/user' ? 65_536 : 1_024));
  } catch (cause) {
    if (cause instanceof SafeDeliveryError) throw cause;
    throw new SafeDeliveryError(failure, failure === 'invalid_authorization' ? 401 : 503);
  } finally {
    clearTimeout(timeout);
  }
}

export function createInvitationFunction(dependencies: InvitationDependencies) {
  return async (request: Request, environment: InvitationEnvironment): Promise<Response> => {
    const origin = request.headers.get('origin');
    const allowedOrigin = approvedOrigin(origin, environment);
    let correlationKey = await hashRateLimitKey('rejected', [crypto.randomUUID()]);
    try {
      if (!allowedOrigin) throw new SafeDeliveryError('origin_rejected', 403);
      if (request.method === 'OPTIONS') return response(null, 204, allowedOrigin);
      if (request.method !== 'POST') throw new SafeDeliveryError('method_not_allowed', 405);
      if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
        throw new SafeDeliveryError('content_type_rejected', 415);
      }
      const config = configuration(environment);
      const token = parseBearerToken(request.headers.get('authorization'));
      if (token.length > 4_096) throw new SafeDeliveryError('invalid_authorization', 401);
      // Verify with Auth as well as the gateway: a publishable API key is never a user identity.
      const user = await authenticatedJson(dependencies, config, token, '/auth/v1/user', 'invalid_authorization');
      if (!user || typeof user !== 'object' || !('id' in user) || typeof user.id !== 'string' || !UUID.test(user.id)) {
        throw new SafeDeliveryError('invalid_authorization', 401);
      }
      let input: unknown;
      try {
        input = JSON.parse(await readBoundedBody(request, BODY_MAX_BYTES));
      } catch (cause) {
        if (cause instanceof SafeDeliveryError) throw cause;
        throw new SafeDeliveryError('invalid_request', 400);
      }
      const deliveryRequest = validateDeliveryRequest(input);
      correlationKey = await hashRateLimitKey('audit', [user.id, deliveryRequest.spaceId, deliveryRequest.requestId]);
      const allowed = await authenticatedJson(
        dependencies, config, token, '/rest/v1/rpc/consume_household_invitation_delivery_limit',
        'rate_limit_unavailable', { p_space_id: deliveryRequest.spaceId },
      );
      if (allowed !== true && allowed !== false) throw new SafeDeliveryError('rate_limit_unavailable', 503);
      if (!allowed) throw new SafeDeliveryError('rate_limited', 429);
      const service = createHouseholdInvitationDelivery({
        ...dependencies,
        configuration: config,
        command: createSupabaseInvitationCommand({ fetch: dependencies.fetch, baseUrl: config.supabaseUrl, anonKey: config.supabaseAnonKey, timeoutMs: UPSTREAM_TIMEOUT_MS }),
        provider: createResendProvider({ fetch: dependencies.fetch, apiKey: config.resendApiKey, timeoutMs: UPSTREAM_TIMEOUT_MS }),
      });
      const result = await service.deliver({ request: deliveryRequest, bearerToken: token, correlationKey });
      return response(result, 200, allowedOrigin);
    } catch (cause) {
      let safe = cause instanceof SafeDeliveryError ? cause : new SafeDeliveryError('delivery_unavailable', 503);
      try {
        await dependencies.audit.record({ at: dependencies.clock.now().toISOString(), event: 'request_rejected', correlationKey, reason: safe.code });
      } catch {
        safe = new SafeDeliveryError('audit_unavailable', 503);
      }
      return response({ error: safe.code }, safe.status, allowedOrigin);
    }
  };
}
