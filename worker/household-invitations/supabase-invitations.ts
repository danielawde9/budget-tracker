import {
  SafeDeliveryError,
  type CreatedInvitation,
  type FetchLike,
  type InvitationCommand,
} from './contracts.js';

interface SupabaseInvitationCommandOptions {
  readonly fetch: FetchLike;
  readonly baseUrl: string;
  readonly anonKey: string;
  readonly timeoutMs: number;
}

interface SupabaseInvitationRow {
  readonly invitation_id: unknown;
  readonly invitation_token: unknown;
  readonly expires_at: unknown;
}

const RESPONSE_MAX_BYTES = 4_096;
const RESPONSE_MAX_CHUNKS = 4_097;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INVITATION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function invalidResponse(): never {
  throw new SafeDeliveryError('upstream_response_invalid', 502, 'response');
}

async function readSuccessBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > RESPONSE_MAX_BYTES) {
      invalidResponse();
    }
  }
  if (!response.body) invalidResponse();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (let index = 0; index < RESPONSE_MAX_CHUNKS; index += 1) {
      const result = await reader.read();
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
          invalidResponse();
        }
      }
      totalBytes += result.value.byteLength;
      if (totalBytes > RESPONSE_MAX_BYTES) {
        await reader.cancel();
        invalidResponse();
      }
      chunks.push(result.value);
    }
    await reader.cancel();
    invalidResponse();
  } finally {
    reader.releaseLock();
  }
}

function parseCreatedInvitation(body: string): CreatedInvitation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    invalidResponse();
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) invalidResponse();
  const row = parsed[0] as Partial<SupabaseInvitationRow> | undefined;
  if (
    !row ||
    typeof row.invitation_id !== 'string' ||
    !UUID_V4.test(row.invitation_id) ||
    typeof row.invitation_token !== 'string' ||
    !INVITATION_TOKEN.test(row.invitation_token) ||
    typeof row.expires_at !== 'string' ||
    !Number.isFinite(Date.parse(row.expires_at))
  ) {
    invalidResponse();
  }
  return {
    invitationId: row.invitation_id,
    invitationToken: row.invitation_token,
    expiresAt: row.expires_at,
  };
}

function commandFailure(status: number): SafeDeliveryError {
  if ([400, 401, 403, 409].includes(status)) {
    return new SafeDeliveryError('invitation_command_rejected', status);
  }
  return new SafeDeliveryError('invitation_command_unavailable', 503);
}

export function createSupabaseInvitationCommand(
  options: SupabaseInvitationCommandOptions,
): InvitationCommand {
  return {
    async create(input) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const response = await options.fetch(
          `${options.baseUrl}/rest/v1/rpc/create_household_invitation`,
          {
            method: 'POST',
            headers: {
              apikey: options.anonKey,
              authorization: `Bearer ${input.bearerToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              p_space_id: input.spaceId,
              p_request_id: input.requestId,
              p_invitee_email: input.inviteeEmail,
            }),
            signal: controller.signal,
          },
        );
        if (!response.ok) throw commandFailure(response.status);
        return parseCreatedInvitation(await readSuccessBody(response));
      } catch (error) {
        if (error instanceof SafeDeliveryError) throw error;
        throw new SafeDeliveryError('invitation_command_unavailable', 503);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
