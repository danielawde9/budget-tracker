export type InvitationDeliveryLocale = 'en' | 'ar';

export interface DeliverInvitationInput {
  readonly spaceId: string;
  readonly requestId: string;
  readonly email: string;
  readonly locale: InvitationDeliveryLocale;
}

export interface DeliveredInvitation {
  readonly invitationId: string;
  readonly expiresAt: string;
}

export interface InvitationDelivery {
  deliverInvitation(input: DeliverInvitationInput): Promise<DeliveredInvitation>;
}

export type HouseholdDeliveryErrorCode =
  | 'invalid_request'
  | 'invalid_authorization'
  | 'invalid_configuration'
  | 'request_too_large'
  | 'request_timeout'
  | 'invitation_command_rejected'
  | 'invitation_command_unavailable'
  | 'upstream_response_invalid'
  | 'delivery_failed'
  | 'delivery_unavailable'
  | 'delivery_status_ambiguous'
  | 'audit_unavailable'
  | 'method_not_allowed'
  | 'not_found'
  | 'origin_rejected'
  | 'content_type_rejected'
  | 'rate_limited'
  | 'rate_limit_unavailable'
  | 'network_error';

const WORKER_ERROR_CODES = new Set<string>([
  'invalid_request',
  'invalid_authorization',
  'invalid_configuration',
  'request_too_large',
  'request_timeout',
  'invitation_command_rejected',
  'invitation_command_unavailable',
  'upstream_response_invalid',
  'delivery_failed',
  'delivery_unavailable',
  'delivery_status_ambiguous',
  'audit_unavailable',
  'method_not_allowed',
  'not_found',
  'origin_rejected',
  'content_type_rejected',
  'rate_limited',
  'rate_limit_unavailable',
]);

export class HouseholdInvitationDeliveryError extends Error {
  readonly code: HouseholdDeliveryErrorCode;
  readonly status: number;

  constructor(code: HouseholdDeliveryErrorCode, status: number) {
    super(code);
    this.name = 'HouseholdInvitationDeliveryError';
    this.code = code;
    this.status = status;
  }
}

export type InvitationFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface HttpInvitationDeliveryOptions {
  readonly fetch?: InvitationFetch;
  readonly getAccessToken: () => Promise<string>;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

const DELIVERY_PATH = '/api/household-invitations/deliver';
const RESPONSE_MAX_BYTES = 8_192;
const DEFAULT_TIMEOUT_MS = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function readBoundedBody(response: Response): Promise<string> {
  const body = await response.text();
  if (body.length > RESPONSE_MAX_BYTES) {
    throw new HouseholdInvitationDeliveryError('upstream_response_invalid', response.status);
  }
  return body;
}

function isJson(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').split(';')[0]?.trim() === 'application/json';
}

function parseErrorCode(body: string, status: number): HouseholdDeliveryErrorCode {
  if (body) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'error' in parsed &&
        typeof parsed.error === 'string' &&
        WORKER_ERROR_CODES.has(parsed.error)
      ) {
        return parsed.error as HouseholdDeliveryErrorCode;
      }
    } catch {
      // fall through to status-based mapping
    }
  }
  if (status === 401) return 'invalid_authorization';
  if (status === 403) return 'origin_rejected';
  if (status === 404) return 'not_found';
  if (status === 408) return 'request_timeout';
  if (status === 429) return 'rate_limited';
  return 'delivery_unavailable';
}

function parseDeliveredInvitation(body: string, status: number): DeliveredInvitation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new HouseholdInvitationDeliveryError('upstream_response_invalid', status);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('invitationId' in parsed) ||
    typeof parsed.invitationId !== 'string' ||
    !UUID.test(parsed.invitationId) ||
    !('expiresAt' in parsed) ||
    typeof parsed.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(parsed.expiresAt))
  ) {
    throw new HouseholdInvitationDeliveryError('upstream_response_invalid', status);
  }
  return { invitationId: parsed.invitationId, expiresAt: parsed.expiresAt };
}

export function createHttpInvitationDelivery(options: HttpInvitationDeliveryOptions): InvitationDelivery {
  const fetchImpl = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = options.baseUrl ?? '';
  return {
    async deliverInvitation(input) {
      let token: string;
      try {
        token = await options.getAccessToken();
      } catch {
        throw new HouseholdInvitationDeliveryError('invalid_authorization', 401);
      }
      if (!token) throw new HouseholdInvitationDeliveryError('invalid_authorization', 401);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}${DELIVERY_PATH}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            spaceId: input.spaceId,
            requestId: input.requestId,
            inviteeEmail: input.email,
            locale: input.locale,
          }),
          signal: controller.signal,
        });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') {
          throw new HouseholdInvitationDeliveryError('request_timeout', 408);
        }
        throw new HouseholdInvitationDeliveryError('network_error', 0);
      } finally {
        clearTimeout(timeout);
      }

      const body = await readBoundedBody(response);
      if (!response.ok || !isJson(response)) {
        throw new HouseholdInvitationDeliveryError(parseErrorCode(isJson(response) ? body : '', response.status), response.status);
      }
      return parseDeliveredInvitation(body, response.status);
    },
  };
}
