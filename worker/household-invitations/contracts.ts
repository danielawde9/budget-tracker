export type InvitationLocale = 'en' | 'ar';

export interface DeliveryRequest {
  readonly spaceId: string;
  readonly requestId: string;
  readonly inviteeEmail: string;
  readonly locale: InvitationLocale;
}

export interface DeliveryConfiguration {
  readonly appOrigin: string;
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly resendApiKey: string;
  readonly invitationFrom: string;
  readonly invitationReplyTo: string;
}

export type SafeDeliveryErrorCode =
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
  | 'rate_limit_unavailable';

export class SafeDeliveryError extends Error {
  readonly code: SafeDeliveryErrorCode;
  readonly status: number;

  constructor(code: SafeDeliveryErrorCode, status: number, field?: string) {
    super(field ? `${code}:${field}` : code);
    this.name = 'SafeDeliveryError';
    this.code = code;
    this.status = status;
  }
}

export interface CreateInvitationInput {
  readonly bearerToken: string;
  readonly spaceId: string;
  readonly requestId: string;
  readonly inviteeEmail: string;
}

export interface CreatedInvitation {
  readonly invitationId: string;
  readonly invitationToken: string;
  readonly expiresAt: string;
}

export interface InvitationCommand {
  create(input: CreateInvitationInput): Promise<CreatedInvitation>;
}

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface SendInvitationEmailInput {
  readonly from: string;
  readonly replyTo: string;
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly locale: InvitationLocale;
  readonly idempotencyKey: string;
}

export interface SentInvitationEmail {
  readonly providerMessageId: string;
}

export interface InvitationEmailProvider {
  send(input: SendInvitationEmailInput): Promise<SentInvitationEmail>;
}

export type ProviderErrorCategory =
  | 'invalid_request'
  | 'unauthorized'
  | 'forbidden'
  | 'idempotency_conflict'
  | 'rate_limited'
  | 'server_error'
  | 'network'
  | 'invalid_response'
  | 'unexpected';

export class ProviderError extends Error {
  readonly category: ProviderErrorCategory;
  readonly retryable: boolean;

  constructor(category: ProviderErrorCategory, retryable: boolean) {
    super(`resend:${category}`);
    this.name = 'ProviderError';
    this.category = category;
    this.retryable = retryable;
  }
}

export type AuditEventName =
  | 'request_rejected'
  | 'request_rate_limited'
  | 'invitation_command_accepted'
  | 'invitation_command_rejected'
  | 'provider_attempt_started'
  | 'provider_retry_scheduled'
  | 'provider_accepted'
  | 'provider_failed';

export type AuditReason =
  | SafeDeliveryErrorCode
  | ProviderErrorCategory
  | 'idempotency_window_closed'
  | 'ip'
  | 'actor_space';

export interface AuditEvent {
  readonly at: string;
  readonly event: AuditEventName;
  readonly correlationKey: string;
  readonly attempt?: number;
  readonly reason?: AuditReason;
}

export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}

export interface Clock {
  now(): Date;
}
