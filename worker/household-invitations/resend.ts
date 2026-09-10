import {
  ProviderError,
  type FetchLike,
  type InvitationEmailProvider,
} from './contracts.js';

interface ResendProviderOptions {
  readonly fetch: FetchLike;
  readonly apiKey: string;
  readonly timeoutMs: number;
}

const RESPONSE_MAX_BYTES = 1_024;
const RESPONSE_MAX_CHUNKS = 1_025;
const PROVIDER_MESSAGE_ID = /^[A-Za-z0-9_-]{1,256}$/;

function invalidResponse(): never {
  throw new ProviderError('invalid_response', false);
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

function parseMessageId(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    invalidResponse();
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('id' in parsed) ||
    typeof parsed.id !== 'string' ||
    !PROVIDER_MESSAGE_ID.test(parsed.id)
  ) {
    invalidResponse();
  }
  return parsed.id;
}

function httpError(status: number): ProviderError {
  if (status === 400 || status === 422) return new ProviderError('invalid_request', false);
  if (status === 401) return new ProviderError('unauthorized', false);
  if (status === 403) return new ProviderError('forbidden', false);
  if (status === 409) return new ProviderError('idempotency_conflict', false);
  if (status === 429) return new ProviderError('rate_limited', true);
  if (status >= 500) return new ProviderError('server_error', true);
  return new ProviderError('unexpected', false);
}

export function createResendProvider(options: ResendProviderOptions): InvitationEmailProvider {
  return {
    async send(input) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const response = await options.fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            'content-type': 'application/json',
            'idempotency-key': input.idempotencyKey,
          },
          body: JSON.stringify({
            from: input.from,
            reply_to: input.replyTo,
            to: [input.to],
            subject: input.subject,
            html: input.html,
            text: input.text,
            tags: [
              { name: 'email_type', value: 'household_invitation' },
              { name: 'locale', value: input.locale },
            ],
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw httpError(response.status);
        return { providerMessageId: parseMessageId(await readSuccessBody(response)) };
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError('network', true);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
