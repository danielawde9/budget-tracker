import { expect, it, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import worker from './index.ts';

function setup() {
  const data = new Map<string,string>();
  const kv = {
    async get(key:string, type?:string | {type:string}) { const v=data.get(key)??null; return (type==='json' || (typeof type==='object' && type.type==='json')) && v ? JSON.parse(v) : v; },
    async put(key:string,value:string) { data.set(key,value); }, async delete(key:string) {data.delete(key);},
    async list({prefix=''}={}) {return {keys:[...data.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true};},
  };
  const env:Env={SUPABASE_URL:'https://dfuxxzlhmxscgvxdmwti.supabase.co',MCP_RESOURCE:'https://mcp.openbudgetracker.app/mcp',APP_ORIGIN:'https://openbudgetracker.app',SUPABASE_PUBLISHABLE_KEY:'public-key',MCP_RATE_LIMITER:{limit:async()=>({success:true})},OAUTH_KV:kv as unknown as KVNamespace};
  const ctx={waitUntil:(_:Promise<unknown>)=>{},passThroughOnException:()=>{}} as unknown as ExecutionContext;
  const request=(path:string,init:RequestInit={})=>worker.fetch(new Request(`https://mcp.openbudgetracker.app${path}`,{...init,headers:{Host:'mcp.openbudgetracker.app',...init.headers}}),env,ctx);
  return {request,env};
}
afterEach(()=>vi.unstubAllGlobals());
it('returns a safe readable connection error with credentialed CORS when the backend rejects a code', async () => {
  const { request, env } = setup();
  const id = '459d692d-4ab6-45ca-8d9c-7b189005e35d';
  await env.OAUTH_KV.put(`budget:pending:${id}`, JSON.stringify({ handle: 'not-consumed', details: { clientId: 'client' } }));
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: 'BUDGET_MCP_UNAUTHORIZED' }, { status: 401 })));
  const response = await request(`/connection/${id}`, { method: 'POST', headers: { Origin: env.APP_ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'approve', code: 'a'.repeat(64), grantToken: 'b'.repeat(64) }) });
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe(env.APP_ORIGIN);
  expect(await response.json()).toMatchObject({ error: 'BUDGET_MCP_UNAUTHORIZED', stage: 'code_exchange' });
});
it('publishes discovery, denies missing tokens and hostile origins',async()=>{
  const {request}=setup();
  const discovery=await request('/.well-known/oauth-protected-resource/mcp');
  expect(await discovery.json()).toMatchObject({resource:'https://mcp.openbudgetracker.app/mcp',authorization_servers:['https://mcp.openbudgetracker.app']});
  const missing=await request('/mcp',{method:'POST'});
  expect(missing.status).toBe(401);
  expect(missing.headers.get('WWW-Authenticate')).toContain('resource_metadata');
  expect((await request('/mcp',{headers:{Origin:'https://evil.test'}})).status).toBe(403);
  expect((await request('/mcp',{headers:{Authorization:'Bearer native.supabase.jwt'}})).status).toBe(401);
});
it('performs browser-bound OAuth and a direct save without exposing any Supabase login or connection secret',async()=>{
  const {request,env}=setup();
  const registration=await request('/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Codex',redirect_uris:['http://localhost:1455/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});
  const registered=await registration.json() as {client_id:string};
  expect(registration.status,JSON.stringify(registered)).toBe(201);
  const verifier='a'.repeat(64),challenge=createHash('sha256').update(verifier).digest('base64url');
  const params=new URLSearchParams({response_type:'code',client_id:registered.client_id,redirect_uri:'http://localhost:1455/callback',code_challenge:challenge,code_challenge_method:'S256',resource:env.MCP_RESOURCE,scope:'budget:read budget:write offline_access',state:'original-state'});
  const authorization=await request(`/authorize?${params}`);
  expect(authorization.status,await authorization.clone().text()).toBe(302);
  const cookie=authorization.headers.get('Set-Cookie')!.split(';')[0]!;
  const id=new URL(authorization.headers.get('Location')!).searchParams.get('connection_id');
  const details=await request(`/connection/${id}`,{headers:{Origin:env.APP_ORIGIN}});
  expect(await details.json()).toMatchObject({clientId:registered.client_id,clientName:'Codex',redirectIsLoopback:true});
  const grantToken='b'.repeat(64);
  const backendCalls:Record<string,unknown>[]=[];
  vi.stubGlobal('fetch',vi.fn(async (url:string,init:RequestInit)=>{
    const args=JSON.parse(String(init.body));backendCalls.push({url,args,headers:init.headers});
    return Response.json(url.endsWith('mcp_exchange_code')?{userId:'359d692d-4ab6-45ca-8d9c-7b189005e35d',clientId:registered.client_id,spaceId:'259d692d-4ab6-45ca-8d9c-7b189005e35d'}:{status:'posted',entryId:'saved'});
  }));
  const completed=await request(`/connection/${id}`,{method:'POST',headers:{Origin:env.APP_ORIGIN,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({decision:'approve',code:'c'.repeat(64),grantToken})});
  const approved=await completed.json() as {redirectTo:string};
  expect(completed.status,JSON.stringify(approved)).toBe(200);
  const callback=new URL(approved.redirectTo);
  expect(callback.searchParams.get('state')).toBe('original-state');
  const exchange=await request('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:registered.client_id,code:callback.searchParams.get('code')!,redirect_uri:'http://localhost:1455/callback',code_verifier:verifier,resource:env.MCP_RESOURCE}).toString()});
  const tokens=await exchange.json() as {access_token:string};
  expect(exchange.status,JSON.stringify(tokens)).toBe(200);
  expect(JSON.stringify(tokens)).not.toContain(grantToken);
  const result=await request('/mcp',{method:'POST',headers:{Authorization:`Bearer ${tokens.access_token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'record_entry',arguments:{requestId:'459d692d-4ab6-45ca-8d9c-7b189005e35d',kind:'income',walletId:'559d692d-4ab6-45ca-8d9c-7b189005e35d',currency:'USD',amountMinor:'2000',on:'2026-10-16'}}})});
  const body=await result.text();expect(result.status,body).toBe(200);expect(body).toContain('saved');expect(body).not.toContain(grantToken);
  expect(backendCalls.at(-1)).toMatchObject({url:`${env.SUPABASE_URL}/rest/v1/rpc/mcp_record_entry`,args:{p_token:grantToken,p_amount:'2000',p_request:'459d692d-4ab6-45ca-8d9c-7b189005e35d'}});
  expect(backendCalls.every(c=>!JSON.stringify(c.headers).includes('Authorization'))).toBe(true);
});
