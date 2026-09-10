import {
  ProviderError,
  SafeDeliveryError,
  type AuditEvent,
  type AuditReason,
  type AuditSink,
  type Clock,
  type DeliveryRequest,
  type CreatedInvitation,
  type InvitationCommand,
  type InvitationEmailProvider,
  type SendInvitationEmailInput,
} from './contracts.js';
import { buildInvitationEmail } from './templates.js';

interface DeliveryServiceConfiguration {
  readonly appOrigin: string;
  readonly invitationFrom: string;
  readonly invitationReplyTo: string;
}

interface DeliveryServiceDependencies {
  readonly command: InvitationCommand;
  readonly provider: InvitationEmailProvider;
  readonly configuration: DeliveryServiceConfiguration;
  readonly audit: AuditSink;
  readonly clock: Clock;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly jitter: () => number;
}

interface DeliverInput {
  readonly request: DeliveryRequest;
  readonly bearerToken: string;
  readonly correlationKey: string;
}

interface DeliveryAccepted {
  readonly invitationId: string;
  readonly expiresAt: string;
  readonly delivery: 'accepted';
}

export interface HouseholdInvitationDelivery {
  deliver(input: DeliverInput): Promise<DeliveryAccepted>;
}

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const PROVIDER_RETRY_CUTOFF_MS = 23 * 60 * 60 * 1_000;
const MAX_PROVIDER_ATTEMPTS = 3;
const MAX_JITTER_MS = 100;

function nowIso(clock: Clock): string {
  return clock.now().toISOString();
}

async function emitAudit(
  audit: AuditSink,
  event: AuditEvent,
): Promise<void> {
  try {
    await audit.record(event);
  } catch {
    throw new SafeDeliveryError('audit_unavailable', 503);
  }
}

function boundedJitter(jitter: () => number): number {
  const value = jitter();
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_JITTER_MS, Math.floor(value)));
}

function commandReason(error: unknown): AuditReason {
  if (error instanceof SafeDeliveryError) return error.code;
  return 'invitation_command_unavailable';
}

function providerReason(error: unknown): AuditReason {
  if (error instanceof ProviderError) return error.category;
  return 'unexpected';
}

async function createInvitation(
  dependencies: DeliveryServiceDependencies,
  input: DeliverInput,
): Promise<CreatedInvitation> {
  let invitation: CreatedInvitation;
  try {
    invitation = await dependencies.command.create({
      bearerToken: input.bearerToken,
      spaceId: input.request.spaceId,
      requestId: input.request.requestId,
      inviteeEmail: input.request.inviteeEmail,
    });
  } catch (error) {
    await emitAudit(dependencies.audit, {
      at: nowIso(dependencies.clock),
      event: 'invitation_command_rejected',
      correlationKey: input.correlationKey,
      reason: commandReason(error),
    });
    if (error instanceof SafeDeliveryError) throw error;
    throw new SafeDeliveryError('invitation_command_unavailable', 503);
  }
  await emitAudit(dependencies.audit, {
    at: nowIso(dependencies.clock),
    event: 'invitation_command_accepted',
    correlationKey: input.correlationKey,
  });
  return invitation;
}

async function assertProviderWindow(
  dependencies: DeliveryServiceDependencies,
  invitation: CreatedInvitation,
  correlationKey: string,
): Promise<void> {
  const createdAt = Date.parse(invitation.expiresAt) - INVITATION_LIFETIME_MS;
  if (dependencies.clock.now().getTime() - createdAt < PROVIDER_RETRY_CUTOFF_MS) return;
  await emitAudit(dependencies.audit, {
    at: nowIso(dependencies.clock),
    event: 'provider_failed',
    correlationKey,
    reason: 'idempotency_window_closed',
  });
  throw new SafeDeliveryError('delivery_status_ambiguous', 409);
}

function buildProviderEmail(
  dependencies: DeliveryServiceDependencies,
  input: DeliverInput,
  invitation: CreatedInvitation,
): SendInvitationEmailInput {
  const content = buildInvitationEmail({
    locale: input.request.locale,
    appOrigin: dependencies.configuration.appOrigin,
    invitationToken: invitation.invitationToken,
    expiresAt: invitation.expiresAt,
  });
  return {
    from: dependencies.configuration.invitationFrom,
    replyTo: dependencies.configuration.invitationReplyTo,
    to: input.request.inviteeEmail,
    subject: content.subject,
    html: content.html,
    text: content.text,
    locale: input.request.locale,
    idempotencyKey: `household-invitation/${invitation.invitationId}`,
  };
}

async function sendWithRetry(
  dependencies: DeliveryServiceDependencies,
  email: SendInvitationEmailInput,
  correlationKey: string,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt += 1) {
    await emitAudit(dependencies.audit, {
      at: nowIso(dependencies.clock), event: 'provider_attempt_started', correlationKey, attempt,
    });
    try {
      await dependencies.provider.send(email);
    } catch (error) {
      const retryable = error instanceof ProviderError && error.retryable;
      if (!retryable || attempt === MAX_PROVIDER_ATTEMPTS) {
        await emitAudit(dependencies.audit, {
          at: nowIso(dependencies.clock), event: 'provider_failed', correlationKey,
          attempt, reason: providerReason(error),
        });
        throw new SafeDeliveryError(
          retryable ? 'delivery_unavailable' : 'delivery_failed',
          retryable ? 503 : 502,
        );
      }
      await emitAudit(dependencies.audit, {
        at: nowIso(dependencies.clock), event: 'provider_retry_scheduled', correlationKey,
        attempt, reason: providerReason(error),
      });
      const delay = 250 * 2 ** (attempt - 1) + boundedJitter(dependencies.jitter);
      await dependencies.sleep(delay);
      continue;
    }
    await emitAudit(dependencies.audit, {
      at: nowIso(dependencies.clock), event: 'provider_accepted', correlationKey, attempt,
    });
    return;
  }
}

export function createHouseholdInvitationDelivery(
  dependencies: DeliveryServiceDependencies,
): HouseholdInvitationDelivery {
  return {
    async deliver(input) {
      const invitation = await createInvitation(dependencies, input);
      await assertProviderWindow(dependencies, invitation, input.correlationKey);
      await sendWithRetry(
        dependencies,
        buildProviderEmail(dependencies, input, invitation),
        input.correlationKey,
      );
      return {
        invitationId: invitation.invitationId,
        expiresAt: invitation.expiresAt,
        delivery: 'accepted',
      };
    },
  };
}
