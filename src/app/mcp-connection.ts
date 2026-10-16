import { z } from 'zod';

const MCP_ORIGIN = 'https://mcp.openbudgetracker.app';
const details = z.object({ clientId: z.string().min(1).max(256), clientName: z.string(), redirectUri: z.string(), redirectIsLoopback: z.boolean(), scope: z.array(z.string()) });
export type ConnectionDetails = z.infer<typeof details>;

async function connectionRequest(id: string, input?: Record<string,string>) {
  if (!z.uuid().safeParse(id).success) throw new Error('Invalid connection');
  const response = await fetch(`${MCP_ORIGIN}/connection/${id}`, {
    credentials: 'include', signal: AbortSignal.timeout(15000),
    ...(input ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {}),
  });
  if (!response.ok) throw new Error('Connection failed');
  return response.json() as Promise<unknown>;
}
export async function loadConnection(id: string) { return details.parse(await connectionRequest(id)); }
export async function completeConnection(id: string, input: Record<string,string>) {
  return z.object({ redirectTo: z.string().url() }).parse(await connectionRequest(id,input)).redirectTo;
}
export async function createCredentials() {
  const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2,'0')).join('');
  const digest = async (v:string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))));
  const grantToken = hex(crypto.getRandomValues(new Uint8Array(32)));
  const code = hex(crypto.getRandomValues(new Uint8Array(32)));
  return { grantToken, code, tokenHash: await digest(grantToken), codeHash: await digest(code) };
}
