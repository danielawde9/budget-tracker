import { OAuthProvider, AuthorizationError, type OAuthHelpers, type ConsentDescription } from '@cloudflare/workers-oauth-provider';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { BackendError, boundedBody, createRpc } from './backend.ts';
import { createServer } from './tools.ts';

type AuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };
type Props = { userId: string; clientId: string; grantToken: string };
type Pending = { handle: string; details: ConsentDescription };
const scopes = ['budget:read', 'budget:write', 'offline_access'];
const securityHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "frame-ancestors 'none'", 'X-Frame-Options': 'DENY' };

export function createProvider(env: Env) {
  const resource = new URL(env.MCP_RESOURCE);
  const json = (value: unknown, status = 200, extra: HeadersInit = {}) => {
    const headers = new Headers(extra);
    Object.entries(securityHeaders).forEach(([key, value]) => headers.set(key, value));
    return Response.json(value, { status, headers });
  };
  return new OAuthProvider<AuthEnv>({
    apiRoute: '/mcp', authorizeEndpoint: '/authorize', tokenEndpoint: '/oauth/token', clientRegistrationEndpoint: '/oauth/register',
    scopesSupported: scopes, requiredScopes: ['budget:read', 'budget:write'],
    resourceMetadata: { resource: env.MCP_RESOURCE, authorization_servers: [resource.origin] },
    accessTokenTTL: 3600,
    clientIdMetadataDocumentEnabled: false,
    apiHandler: {
      async fetch(request, boundEnv, ctx) {
        const props = z.object({ userId: z.string(), clientId: z.string(), grantToken: z.string().regex(/^[a-f0-9]{64}$/) }).parse(ctx.props);
        const auth = z.object({ scope: z.array(z.string()) }).parse(Reflect.get(ctx, 'auth'));
        if (!['budget:read', 'budget:write'].every(scope => auth.scope.includes(scope))) return json({ error: 'insufficient_scope' }, 403);
        if (!props?.grantToken || !props.userId || !props.clientId) return json({ error: 'unauthorized' }, 401);
        if (!(await boundEnv.MCP_RATE_LIMITER.limit({ key: `${props.userId}:${props.clientId}` })).success) return json({ error: 'rate_limited' }, 429);
        const rpc = createRpc(boundEnv.SUPABASE_URL, boundEnv.SUPABASE_PUBLISHABLE_KEY, props.grantToken);
        const handler = createMcpHandler(() => createServer(rpc), { route: '/mcp', corsOptions: false,
          allowedHostnames: [resource.hostname, 'localhost', '127.0.0.1'], allowedOriginHostnames: [resource.hostname] });
        return handler.fetch(request);
      },
    },
    defaultHandler: {
      async fetch(request, boundEnv) {
        const url = new URL(request.url);
        const oauth = boundEnv.OAUTH_PROVIDER;
        const cors = { 'Access-Control-Allow-Origin': boundEnv.APP_ORIGIN, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' };
        if (url.pathname === '/authorize' && request.method === 'GET') {
          const authRequest = await oauth.parseAuthRequest(request);
          const details = await oauth.describeConsent(authRequest);
          const consent = await oauth.beginConsent(authRequest);
          const id = crypto.randomUUID();
          await boundEnv.OAUTH_KV.put(`budget:pending:${id}`, JSON.stringify({ handle: consent.handle, details }), { expirationTtl: 600 });
          consent.headers.set('Location', `${boundEnv.APP_ORIGIN}/oauth/consent?connection_id=${id}`);
          return new Response(null, { status: 302, headers: consent.headers });
        }
        if (url.pathname.startsWith('/connection/')) {
          if (request.headers.get('Origin') !== boundEnv.APP_ORIGIN) return json({ error: 'invalid_origin' }, 403);
          if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
          const id = url.pathname.slice('/connection/'.length);
          if (!z.uuid().safeParse(id).success) return json({ error: 'invalid_request' }, 400, cors);
          const pending = await boundEnv.OAUTH_KV.get<Pending>(`budget:pending:${id}`, 'json');
          if (!pending) return json({ error: 'expired_connection' }, 400, cors);
          if (request.method === 'GET') return json(pending.details, 200, cors);
          if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
          const input = z.discriminatedUnion('decision', [z.strictObject({ decision: z.literal('deny') }), z.strictObject({ decision: z.literal('approve'), code: z.string().regex(/^[a-f0-9]{64}$/), grantToken: z.string().regex(/^[a-f0-9]{64}$/) })]).parse(await request.json());
          if (input.decision === 'deny') {
            const denied = await oauth.denyConsent(request, pending.handle);
            await boundEnv.OAUTH_KV.delete(`budget:pending:${id}`);
            Object.entries(cors).forEach(([key,value]) => denied.headers.set(key,value));
            return json({ redirectTo: denied.redirectTo }, 200, denied.headers);
          }
          const rpc = createRpc(boundEnv.SUPABASE_URL, boundEnv.SUPABASE_PUBLISHABLE_KEY, '');
          const identity = z.object({ userId: z.uuid(), clientId: z.string(), spaceId: z.uuid() }).parse(await rpc('mcp_exchange_code', { p_client: pending.details.clientId, p_code: input.code, p_token: input.grantToken }));
          if (identity.clientId !== pending.details.clientId) return json({ error: 'invalid_identity' }, 403, cors);
          const approved = await oauth.approveConsent(request, pending.handle, { scope: scopes });
          const { redirectTo } = await oauth.completeAuthorization({ request: approved.request, userId: identity.userId,
            metadata: { name: pending.details.clientName }, scope: scopes,
            props: { userId: identity.userId, clientId: identity.clientId, grantToken: input.grantToken } satisfies Props });
          await boundEnv.OAUTH_KV.delete(`budget:pending:${id}`);
          Object.entries(cors).forEach(([key,value]) => approved.headers.set(key,value));
          return json({ redirectTo }, 200, approved.headers);
        }
        return json({ error: 'not_found' }, 404);
      },
    },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ status: 'ok', service: 'budget-tracker-mcp' }, { headers: securityHeaders });
    if (url.pathname.startsWith('/mcp') && request.headers.has('Origin') && request.headers.get('Origin') !== new URL(env.MCP_RESOURCE).origin) return Response.json({ error: 'invalid_origin' }, { status: 403, headers: securityHeaders });
    if (!(await env.MCP_RATE_LIMITER.limit({ key: `ip:${request.headers.get('CF-Connecting-IP') ?? 'local'}` })).success) return new Response('Rate limited', { status: 429 });
    if (request.method === 'POST') {
      try {
        const body = await boundedBody(request.body, 16384);
        request = new Request(request.url, { method: 'POST', headers: request.headers, body: new TextDecoder().decode(body) });
      } catch { return new Response('Request too large', { status: 413 }); }
    }
    try {
      const response = await createProvider(env).fetch(request, env as AuthEnv, ctx);
      const secured = new Response(response.body, response);
      Object.entries(securityHeaders).forEach(([key,value]) => secured.headers.set(key,value));
      return secured;
    } catch (error) {
      const code = error instanceof BackendError ? error.code : error instanceof AuthorizationError ? error.code : 'request_failed';
      const stage = error instanceof BackendError ? 'code_exchange' : error instanceof AuthorizationError ? 'consent_cookie' : 'request';
      const headers = new Headers(securityHeaders);
      if (url.pathname.startsWith('/connection/') && request.headers.get('Origin') === env.APP_ORIGIN) {
        headers.set('Access-Control-Allow-Origin', env.APP_ORIGIN);
        headers.set('Access-Control-Allow-Credentials', 'true');
        headers.set('Vary', 'Origin');
      }
      console.warn(JSON.stringify({ event: 'mcp_request_failed', code, stage, kind: error instanceof Error ? error.name : 'unknown' }));
      return Response.json({ error: code, stage }, { status: 400, headers });
    }
  },
} satisfies ExportedHandler<Env>;
