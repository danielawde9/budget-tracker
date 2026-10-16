export class BackendError extends Error {
  constructor(readonly code: string) { super(code); }
}

export async function boundedBody(body: ReadableStream<Uint8Array> | null, maximum: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new Error('Body too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export type ConnectorRpc = (name: 'mcp_context' | 'mcp_record_entry' | 'mcp_entry_status' | 'mcp_exchange_code', args: Record<string, unknown>) => Promise<unknown>;

export function createRpc(url: string, key: string, token: string): ConnectorRpc {
  return async (name, args) => {
    let response: Response;
    try {
      response = await fetch(`${url}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
        body: JSON.stringify(name === 'mcp_exchange_code' ? args : { ...args, p_token: token }), signal: AbortSignal.timeout(10000), redirect: 'manual',
      });
    } catch (error) {
      console.warn(JSON.stringify({ event: 'mcp_request_failed', stage: 'backend_fetch', kind: error instanceof Error ? error.name : 'unknown' }));
      throw new BackendError('STATUS_UNKNOWN');
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new BackendError('REQUEST_FAILED');
    }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(await boundedBody(response.body, 65536))); }
    catch (error) {
      console.warn(JSON.stringify({ event: 'mcp_request_failed', stage: 'backend_decode', status: response.status, contentType: response.headers.get('content-type'), kind: error instanceof Error ? error.name : 'unknown' }));
      throw new BackendError('STATUS_UNKNOWN');
    }
    if (!response.ok) {
      const message = typeof value === 'object' && value !== null && 'message' in value ? value.message : null;
      throw new BackendError(typeof message === 'string' && /^BUDGET_[A-Z_]+$/.test(message) ? message : 'REQUEST_FAILED');
    }
    return value;
  };
}
