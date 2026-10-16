import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const root = resolve(repo, 'plugins/open-budget-tracker');
const manifest = JSON.parse(await readFile(resolve(root, 'plugin.json'), 'utf8'));
const mcp = JSON.parse(await readFile(resolve(root, 'mcp.json'), 'utf8'));
const endpoint = 'https://mcp.openbudgetracker.app/mcp';
assert.equal(manifest.name, 'open-budget-tracker');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
assert.equal(mcp.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
assert.deepEqual(Object.keys(mcp.mcpServers), ['budget_tracker']);
const server = mcp.mcpServers.budget_tracker;
assert.equal(server.type, 'streamable-http');
assert.equal(server.url, endpoint);
assert.equal(server.headers, undefined, 'Do not package bearer credentials');
const auth = server.extensions['com.openai'].auth;
assert.equal(auth.type, 'oauth');
assert.deepEqual(auth.client, { mode: 'dcr' });
assert.equal(auth.resource, endpoint);
assert.deepEqual(auth.baseScopes, ['budget:read', 'budget:write', 'offline_access']);
const overlay = manifest.extensions['com.openai'];
const listing = overlay.interface;
for (const field of ['displayName', 'shortDescription']) {
  assert.ok(listing[field]?.length > 0 && listing[field].length <= 30, `${field} must fit the listing limit`);
}
assert.equal(overlay.review.demo_recording_url, 'https://openbudgetracker.app/review/');
assert.equal(overlay.review.test_cases.positive.length, 5);
assert.equal(overlay.review.test_cases.negative.length, 3);
for (const [kind, cases] of Object.entries(overlay.review.test_cases)) {
  for (const item of cases) {
    for (const field of ['description', 'prompt', 'expected_behavior', ...(kind === 'positive' ? ['tools_triggered'] : [])]) {
      assert.ok(item[field]?.trim(), `Missing review case ${field}`);
    }
  }
}

// Explicit files only: never include environment files, real account data, or local OAuth state.
const files = ['plugin.json', 'mcp.json', 'assets/icon.png'];
for (const file of files) {
  assert.equal(await realpath(resolve(root, file)), resolve(root, file), 'Package files must not be symlinks');
}
assert.equal(listing.logo, './assets/icon.png');
assert.equal(listing.composerIcon, './assets/icon.png');
const icon = await readFile(resolve(root, 'assets/icon.png'));
assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
assert.equal(icon.readUInt32BE(16), icon.readUInt32BE(20), 'Icon must be square');
assert.ok(icon.readUInt32BE(16) >= 48 && icon.readUInt32BE(16) <= 4096);
assert.ok(icon.length <= 5 * 1024 * 1024);

const output = resolve(repo, 'artifacts/chatgpt');
await mkdir(output, { recursive: true });
const archive = resolve(output, `${manifest.name}-${manifest.version}.zip`);
await rm(archive, { force: true });
execFileSync('zip', ['-X', '-q', archive, ...files], { cwd: root });
const contents = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim().split('\n');
assert.deepEqual(contents, files);
const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(`${archive}.sha256`, `${sha256}  ${manifest.name}-${manifest.version}.zip\n`);
console.log(`Created ${archive}\nSHA-256 ${sha256}`);
console.log('Upload package built. OpenAI portal validation, domain verification and final review submission remain portal steps.');
