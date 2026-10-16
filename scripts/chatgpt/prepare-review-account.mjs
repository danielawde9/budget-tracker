import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const privateDir = resolve(repo, '.wrangler/chatgpt-review');
await mkdir(privateDir, { recursive: true, mode: 0o700 });
const project = 'dfuxxzlhmxscgvxdmwti';
const url = `https://${project}.supabase.co`;
// Capture keys only in this server process; never write or log an administrative key.
const keys = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', project, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const adminKey = keys.find(k => k.name === 'service_role')?.api_key;
const publicKey = keys.find(k => k.type === 'publishable')?.api_key;
assert.ok(adminKey && publicKey, 'Project administrative and publishable keys are required');
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(url, adminKey, options);

async function prepare(label, email, spaceName) {
  const path = resolve(privateDir, `${label}.json`);
  let account;
  try { account = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!account) {
    const password = `Bt!${randomBytes(24).toString('base64url')}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: 'Synthetic plugin review' } });
    if (error) throw new Error(`Demo account creation failed (${error.code ?? error.status}); existing accounts are never reset`);
    account = { email, password, userId: data.user.id, synthetic: true, createdAt: new Date().toISOString() };
    await writeFile(path, JSON.stringify(account, null, 2), { mode: 0o600, flag: 'wx' });
  }
  assert.equal(account.email, email);
  assert.equal(account.synthetic, true);
  const client = createClient(url, publicKey, options);
  const { data, error } = await client.auth.signInWithPassword({ email, password: account.password });
  assert.equal(error, null, 'Demo login must work without email, OTP or MFA approval');
  assert.equal(data.user?.id, account.userId);
  const rpc = async (name, args = {}) => {
    const result = await client.rpc(name, args);
    if (result.error) throw new Error(`${name}: ${result.error.message}`);
    return result.data;
  };
  const checkpoint = async () => writeFile(path, JSON.stringify(account, null, 2), { mode: 0o600 });
  if (!account.spaceId) {
    const created = await rpc('create_space', { p_request: randomUUID(), p_name: spaceName, p_expected_income_minor: '250000', p_timezone: 'Asia/Beirut' });
    account.spaceId = created.spaceId;
    await checkpoint();
  }
  const spaces = await rpc('my_spaces');
  assert.ok(spaces.every(s => s.id === account.spaceId), 'Reviewer must not belong to any personal budget');
  assert.equal(spaces[0]?.role, 'owner');
  account.today = spaces[0].today;
  for (const [field, name, currency, opening] of [
    ['usdWalletId', 'Cash USD', 'USD', '200000'],
    ['lbpWalletId', 'Cash LBP', 'LBP', '10000000'],
  ]) {
    if (!account[field]) {
      const wallet = await rpc('create_wallet', { p_space: account.spaceId, p_request: randomUUID(), p_name: name, p_kind: 'cash', p_currency: currency, p_opening_minor: opening, p_opened_on: account.today });
      account[field] = wallet.walletId;
      await checkpoint();
    }
  }
  await checkpoint();
  await client.auth.signOut();
  return { userId: account.userId, spaceId: account.spaceId, synthetic: true };
}

const reviewer = await prepare('reviewer', 'chatgpt-review@openbudgetracker.app', 'Plugin review — synthetic data');
const isolation = await prepare('isolation', 'chatgpt-isolation@openbudgetracker.app', 'Isolation test — synthetic data');
assert.notEqual(reviewer.userId, isolation.userId);
assert.notEqual(reviewer.spaceId, isolation.spaceId);
console.log(JSON.stringify({ reviewer, isolation, credentialsDirectory: privateDir, note: 'Dedicated synthetic accounts only. No personal account was changed. Credentials were not printed.' }));
