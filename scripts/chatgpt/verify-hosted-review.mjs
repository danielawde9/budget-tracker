import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const privateDir = resolve(repo, '.wrangler/chatgpt-review');
const output = resolve(repo, 'artifacts/chatgpt');
await mkdir(output, { recursive: true });
const demo = JSON.parse(await readFile(resolve(privateDir, 'reviewer.json'), 'utf8'));
const isolation = JSON.parse(await readFile(resolve(privateDir, 'isolation.json'), 'utf8'));
assert.equal(demo.synthetic, true);
assert.equal(isolation.synthetic, true);
assert.notEqual(demo.userId, isolation.userId);
const env = await readFile(resolve(repo, '.dev.vars'), 'utf8');
const publicKey = env.match(/^SUPABASE_PUBLISHABLE_KEY=(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
assert.ok(publicKey);
const budget = createClient('https://dfuxxzlhmxscgvxdmwti.supabase.co', publicKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const login = await budget.auth.signInWithPassword({ email: demo.email, password: demo.password });
assert.equal(login.error, null);
assert.equal(login.data.user.id, demo.userId);
async function rpc(name, args) {
  const result = await budget.rpc(name, args);
  if (result.error) throw new Error(`${name}: ${result.error.message}`);
  return result.data;
}
const origin = 'https://mcp.openbudgetracker.app';
const resource = `${origin}/mcp`;
const appOrigin = 'https://openbudgetracker.app';
const report = { executedAt: new Date().toISOString(), syntheticDataOnly: true, demoSpaceId: demo.spaceId, checks: [], receipts: [] };
async function check(name, run) { await run(); report.checks.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
const reg = await fetch(`${origin}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Open Budget Tracker review harness', redirect_uris: ['http://127.0.0.1:43197/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
assert.equal(reg.status, 201);
const { client_id: clientId } = await reg.json();
const verifier = randomBytes(48).toString('base64url');
const state = randomBytes(24).toString('base64url');
const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: 'http://127.0.0.1:43197/callback', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource, scope: 'budget:read budget:write offline_access', state });
const authorization = await fetch(`${origin}/authorize?${params}`, { redirect: 'manual' });
assert.equal(authorization.status, 302);
const cookie = authorization.headers.get('set-cookie').split(';')[0];
const connectionId = new URL(authorization.headers.get('location')).searchParams.get('connection_id');
const grantToken = randomBytes(32).toString('hex');
const code = randomBytes(32).toString('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
await rpc('mcp_grant_client', { p_client: clientId, p_space: demo.spaceId, p_name: 'Synthetic review harness', p_token_hash: hash(grantToken), p_code_hash: hash(code) });
const consent = await fetch(`${origin}/connection/${connectionId}`, { method: 'POST', headers: { Origin: appOrigin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'approve', code, grantToken }) });
assert.equal(consent.status, 200, 'One-time code exchange must succeed');
const callback = new URL((await consent.json()).redirectTo);
assert.equal(callback.searchParams.get('state'), state);
const tokenResponse = await fetch(`${origin}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code: callback.searchParams.get('code'), redirect_uri: 'http://127.0.0.1:43197/callback', code_verifier: verifier, resource }) });
assert.equal(tokenResponse.status, 200);
let tokens = await tokenResponse.json();
assert.ok(tokens.access_token && tokens.refresh_token);
assert.ok(!JSON.stringify(tokens).includes(grantToken));
let sequence = 0;
async function mcp(method, params = {}, accessToken = tokens.access_token) {
  const response = await fetch(resource, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }) });
  const text = await response.text();
  if (!response.ok) return { status: response.status, message: { error: { message: `HTTP ${response.status}` } } };
  const message = text.startsWith('event:') || text.startsWith('data:') ? JSON.parse(text.split('\n').find(line => line.startsWith('data:')).slice(5)) : JSON.parse(text);
  return { status: response.status, message };
}
async function call(name, args) {
  const result = await mcp('tools/call', { name, arguments: args });
  const content = result.message.result?.content?.find(c => c.type === 'text');
  const error = !!result.message.error || !!result.message.result?.isError;
  let value = null;
  if (content) { try { value = JSON.parse(content.text); } catch { assert.ok(error, 'Successful tool content must be valid JSON'); } }
  return { ...result, error, value };
}
let context;
await check('OAuth DCR, PKCE, browser-bound consent and opaque tokens', async () => {
  const result = await call('get_context', {});
  assert.equal(result.status, 200); assert.equal(result.error, false); context = result.value;
  assert.equal(context.spaceId, demo.spaceId);
  assert.ok(context.wallets.every(w => [demo.usdWalletId, demo.lbpWalletId].includes(w.id)));
  assert.ok(!JSON.stringify(context).match(/balance|email|password|entries/));
});
const itemId = context.items.find(i => i.nameEn === 'Groceries')?.id;
assert.ok(itemId);
const entry = { requestId: randomUUID(), kind: 'expense', walletId: demo.usdWalletId, currency: 'USD', amountMinor: '2000', on: context.today, itemId, memo: 'Synthetic review groceries' };
await check('Exact USD expense, funding coverage and a posted receipt', async () => {
  const result = await call('record_entry', entry);
  assert.equal(result.error, false); assert.equal(result.value.status, 'posted'); assert.equal(result.value.amountMinor, '2000');
  report.receipts.push(result.value);
});
await check('Income omits the expense category', async () => {
  const result = await call('record_entry', { requestId: randomUUID(), kind: 'income', walletId: demo.usdWalletId, currency: 'USD', amountMinor: '50000', on: context.today, memo: 'Synthetic review income' });
  assert.equal(result.error, false); assert.equal(result.value.status, 'posted'); report.receipts.push(result.value);
});
await check('Whole-lira LBP expense with an Arabic memo', async () => {
  const result = await call('record_entry', { ...entry, requestId: randomUUID(), walletId: demo.lbpWalletId, currency: 'LBP', amountMinor: '150000', memo: 'مشتريات تجريبية' });
  assert.equal(result.error, false); assert.equal(result.value.amountMinor, '150000'); assert.equal(result.value.memo, 'مشتريات تجريبية'); report.receipts.push(result.value);
});
await check('Receipt reconciliation and identical retry do not duplicate the save', async () => {
  const status = await call('get_entry_status', { requestId: entry.requestId });
  const retry = await call('record_entry', entry);
  assert.deepEqual(status.value, report.receipts[0]); assert.deepEqual(retry.value, report.receipts[0]);
});
await check('Another user’s wallet is rejected', async () => {
  const result = await call('record_entry', { ...entry, requestId: randomUUID(), walletId: isolation.usdWalletId });
  assert.equal(result.error, true);
});
await check('Missing amount, unsupported transfer and changed retry are refused', async () => {
  const { amountMinor, ...missing } = entry;
  assert.equal((await call('record_entry', { ...missing, requestId: randomUUID() })).error, true);
  assert.equal((await call('transfer_money', {})).error, true);
  assert.equal((await call('record_entry', { ...entry, amountMinor: '2001' })).error, true);
});
await check('Refresh token works and native Budget login JWT is not an MCP credential', async () => {
  const refreshed = await fetch(`${origin}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.refresh_token, resource }) });
  assert.equal(refreshed.status, 200); tokens = await refreshed.json(); assert.ok(tokens.access_token);
  assert.equal((await call('get_context', {})).error, false);
  assert.equal((await mcp('tools/list', {}, login.data.session.access_token)).status, 401);
});
await check('All three tools declare explicit read, destructive and open-world annotations', async () => {
  const listed = await mcp('tools/list');
  const tools = listed.message.result.tools;
  assert.deepEqual(tools.map(t => t.name).sort(), ['get_context', 'get_entry_status', 'record_entry']);
  for (const tool of tools) for (const flag of ['readOnlyHint', 'destructiveHint', 'openWorldHint']) assert.equal(typeof tool.annotations[flag], 'boolean');
});
await check('Revocation immediately stops context and writes', async () => {
  await rpc('mcp_revoke_client', { p_client: clientId });
  assert.equal((await call('get_context', {})).error, true);
  assert.equal((await call('record_entry', { ...entry, requestId: randomUUID() })).error, true);
});
await budget.auth.signOut();
await writeFile(resolve(output, 'hosted-review-report.json'), JSON.stringify(report, null, 2));
console.log(`Verified ${report.checks.length} live transport/data checks against synthetic accounts. Review prompts still require conversational testing in ChatGPT.`);
