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
  | 'invitation_command_rejected'
  | 'invitation_command_unavailable'
  | 'upstream_response_invalid';

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
