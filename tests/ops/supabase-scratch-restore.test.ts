import { execFile, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { assertTestcontainersDialsDockerHost } from './testcontainers-endpoint.js';

// public.ecr.aws and Docker Hub publish supabase/postgres:17.6.1.166 under the
// same index digest; it is the exact image Budget Production runs.
const supabasePostgresImage = 'public.ecr.aws/supabase/postgres:17.6.1.166';
const scratchLabel = { 'budget.restore-target': 'supabase-scratch' };
const testLabel = { 'budget.restore-test': 'supabase-scratch-restore' };
const script = join(process.cwd(), 'scripts/ops/supabase-scratch-restore.sh');
const fixtures = join(process.cwd(), 'tests/ops/fixtures/supabase-restore');
const fingerprintSql = join(process.cwd(), 'ops/supabase-restore/fingerprint.sql');

const bundleDumps = [
  ['roles.sql', 'roles'],
  ['auth-schema.sql', 'auth-schema'],
  ['supabase-migrations-schema.sql', 'supabase-migrations-schema'],
  ['schema.sql', 'schema'],
  ['data.sql', 'data'],
  ['migration-history.sql', 'migration-history'],
  ['auth-schema-migrations.txt', 'auth-schema-migrations'],
] as const;
type BundleFile = (typeof bundleDumps)[number][0];

// Containers stop as soon as their test ends so a shared Docker host carries
// at most one test's containers at a time.
const started: StartedTestContainer[] = [];

async function stopStartedContainers(): Promise<void> {
  await Promise.all(started.splice(0).map((container) => container.stop()));
}

afterEach(stopStartedContainers, 300_000);
afterAll(stopStartedContainers, 300_000);

function privateDirectory(prefix: string): string {
  return mkdtempSync(join(realpathSync(tmpdir()), prefix));
}

function runRestoreScript(
  args: readonly string[],
  options: { container?: StartedTestContainer; env?: Record<string, string> } = {},
): SpawnSyncReturns<string> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...options.env };
  if (options.container) env.BUDGET_SCRATCH_CONTAINER = options.container.getId();
  return spawnSync('/bin/bash', [script, ...args], {
    encoding: 'utf8',
    env,
    timeout: 900_000,
  });
}

function minimalBundle(overrides: Partial<Record<BundleFile, string>> = {}): string {
  const directory = privateDirectory('budget-supabase-preflight-');
  const files: Record<BundleFile, string> = {
    'roles.sql': 'SET default_transaction_read_only = off;\nRESET ALL;\n',
    'auth-schema.sql': 'CREATE SCHEMA IF NOT EXISTS "auth";\n',
    'supabase-migrations-schema.sql': 'CREATE SCHEMA IF NOT EXISTS "supabase_migrations";\n',
    'schema.sql': [
      'CREATE OR REPLACE FUNCTION "public"."touch"() RETURNS "trigger"',
      '    LANGUAGE "plpgsql"',
      '    AS $$',
      'BEGIN',
      '  RETURN NEW;',
      'END',
      '$$;',
      '',
    ].join('\n'),
    'data.sql': [
      'SET session_replication_role = replica;',
      '',
      '-- \\restrict synthetic',
      'COPY "public"."categories" ("name_en", "name_ar") FROM stdin;',
      '\\N\tبقالة',
      '\\.',
      '',
      'COPY "storage"."buckets" ("id", "name") FROM stdin;',
      '\\.',
      '',
      'RESET ALL;',
      '',
    ].join('\n'),
    'migration-history.sql': 'SET session_replication_role = replica;\nRESET ALL;\n',
    'auth-schema-migrations.txt': '00\n20240729123726\n',
    ...overrides,
  };
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(directory, name), content, { mode: 0o600 });
  }
  return directory;
}

function copyBundle(source: string): string {
  const copy = privateDirectory('budget-supabase-bundle-');
  for (const [file] of bundleDumps) {
    copyFileSync(join(source, file), join(copy, file));
    chmodSync(join(copy, file), 0o600);
  }
  return copy;
}

function segmentNames(stream: string): string[] {
  return [...stream.matchAll(/^-- budget-restore segment begin: (\S+)$/gm)].map(
    (match) => match[1] ?? '',
  );
}

function removeSegments(stream: string, names: readonly string[]): string {
  return names.reduce((remaining, name) => {
    const begin = `-- budget-restore segment begin: ${name}\n`;
    const end = `-- budget-restore segment end: ${name}\n`;
    const start = remaining.indexOf(begin);
    const stop = remaining.indexOf(end, start);
    if (start < 0 || stop < 0) throw new Error(`rendered restore lacks segment ${name}`);
    return remaining.slice(0, start) + remaining.slice(stop + end.length);
  }, stream);
}

async function execOk(container: StartedTestContainer, command: string[]): Promise<string> {
  const result = await container.exec(command);
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(' ')} exited ${result.exitCode}: ${result.stderr}`);
  }
  return result.stdout;
}

async function sql(container: StartedTestContainer, statement: string): Promise<string> {
  const output = await execOk(container, [
    'psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres',
    '-c', statement,
  ]);
  return output.trim();
}

async function startSupabasePostgres(
  labels: Record<string, string>,
): Promise<StartedTestContainer> {
  const container = await new GenericContainer(supabasePostgresImage)
    .withLabels({ ...testLabel, ...labels })
    .withEnvironment({ POSTGRES_PASSWORD: randomBytes(18).toString('hex') })
    .withWaitStrategy(
      Wait.forSuccessfulCommand(
        "psql -X -h 127.0.0.1 -U supabase_admin -d postgres -Atc 'select 1'",
      ),
    )
    .withStartupTimeout(600_000)
    .start();
  started.push(container);
  return container;
}

// Idle containers never start PostgreSQL, so a published test port has
// nothing listening behind it while the refusal is exercised.
async function startIdleContainer(
  labels: Record<string, string>,
  publishPostgresPort: boolean,
): Promise<StartedTestContainer> {
  const definition = new GenericContainer(supabasePostgresImage)
    .withLabels({ ...testLabel, ...labels })
    .withCommand(['sleep', '900'])
    .withWaitStrategy(Wait.forSuccessfulCommand('true'));
  const container = await (
    publishPostgresPort ? definition.withExposedPorts(5432) : definition
  ).start();
  started.push(container);
  return container;
}

function restoreInto(container: StartedTestContainer, bundle: string): void {
  const restored = runRestoreScript(['restore', bundle], { container });
  expect(restored.status, restored.stderr).toBe(0);
}

function fingerprintOf(container: StartedTestContainer): { path: string; content: string } {
  const path = join(privateDirectory('budget-supabase-fingerprint-'), 'scratch.fingerprint');
  const result = runRestoreScript(['fingerprint', path], { container });
  expect(result.status, result.stderr).toBe(0);
  return { path, content: readFileSync(path, 'utf8') };
}

async function anonymousAccess(container: StartedTestContainer) {
  const [spacesSelect, leaveExecute] = (
    await sql(
      container,
      `SELECT has_table_privilege('anon', 'public.spaces', 'SELECT'),
              has_function_privilege('anon', 'public.leave_household_space(uuid, uuid)', 'EXECUTE')`,
    )
  ).split('|');
  return { spacesSelect, leaveExecute };
}

const endpointAssertion = join(process.cwd(), 'tests/ops/testcontainers-endpoint.ts');
// Testcontainers caches the first client it resolves for the life of the
// process, so every probe runs in a fresh Node process with a minimal env.
const endpointProbe =
  'const { assertTestcontainersDialsDockerHost } = await import(process.argv[1]);' +
  ' await assertTestcontainersDialsDockerHost(process.env.DOCKER_HOST);';
const fakeDockerApis: Server[] = [];

async function closeFakeDockerApis(): Promise<void> {
  await Promise.all(
    fakeDockerApis.splice(0).map((server) => {
      server.closeAllConnections();
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }),
  );
}

// Answers GET /info like a Docker daemon, which is all Testcontainers needs to
// accept an endpoint, and records every request it receives.
async function startFakeDockerApi(
  listen: (server: Server) => void,
): Promise<{ server: Server; requests: string[] }> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method ?? ''} ${request.url ?? ''}`);
    if (request.method !== 'GET' || request.url !== '/info') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({ OperatingSystem: 'fake', OSType: 'linux', Architecture: 'x86_64' }),
    );
  });
  fakeDockerApis.push(server);
  listen(server);
  await once(server, 'listening');
  return { server, requests };
}

function startFakeDockerSocket(socketPath: string) {
  return startFakeDockerApi((server) => server.listen(socketPath));
}

async function startFakeDockerLoopback(): Promise<{ port: number; requests: string[] }> {
  const { server, requests } = await startFakeDockerApi((listener) =>
    listener.listen(0, '127.0.0.1'),
  );
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('fake Docker API is not listening on TCP');
  }
  return { port: address.port, requests };
}

function runEndpointProbe(
  env: Record<string, string>,
): Promise<{ status: number | string | null; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--input-type=module', '--eval', endpointProbe, endpointAssertion],
      { env, encoding: 'utf8', timeout: 20_000 },
      (error, _stdout, stderr) => {
        resolve({ status: error === null ? 0 : (error.code ?? error.signal ?? null), stderr });
      },
    );
  });
}

describe('Testcontainers Docker endpoint assertion', () => {
  afterEach(closeFakeDockerApis);

  it('passes when Testcontainers dials the DOCKER_HOST socket', async () => {
    const home = privateDirectory('budget-tc-');
    const socket = join(home, 'docker.sock');
    const api = await startFakeDockerSocket(socket);

    const probe = await runEndpointProbe({ HOME: home, DOCKER_HOST: `unix://${socket}` });

    expect(probe.status, probe.stderr).toBe(0);
    expect(api.requests).toContain('GET /info');
  });

  it('fails instead of letting Testcontainers fall back from a dead DOCKER_HOST socket', async () => {
    const home = privateDirectory('budget-tc-');
    const dead = join(home, 'dead.sock');
    // XDG_RUNTIME_DIR/docker.sock is a later Testcontainers fallback; a live
    // /var/run/docker.sock would be chosen before it, and must fail the same way.
    await startFakeDockerSocket(join(home, 'docker.sock'));

    const probe = await runEndpointProbe({
      HOME: home,
      XDG_RUNTIME_DIR: home,
      DOCKER_HOST: `unix://${dead}`,
    });

    expect(probe.status).not.toBe(0);
    expect(probe.stderr).toContain('Testcontainers dials "unix://');
    expect(probe.stderr).toContain(`", not DOCKER_HOST "unix://${dead}"`);
  });

  it('fails when tc.host in ~/.testcontainers.properties takes precedence over DOCKER_HOST', async () => {
    const home = privateDirectory('budget-tc-');
    const socket = join(home, 'docker.sock');
    const socketApi = await startFakeDockerSocket(socket);
    const loopback = await startFakeDockerLoopback();
    writeFileSync(
      join(home, '.testcontainers.properties'),
      `tc.host=tcp://127.0.0.1:${loopback.port}\n`,
      { mode: 0o600 },
    );

    const probe = await runEndpointProbe({ HOME: home, DOCKER_HOST: `unix://${socket}` });

    expect(probe.status).not.toBe(0);
    expect(probe.stderr).toContain(
      `Testcontainers dials "http://127.0.0.1:${loopback.port}", not DOCKER_HOST "unix://${socket}"`,
    );
    expect(loopback.requests).toContain('GET /info');
    expect(socketApi.requests).toEqual([]);
  });

  it('refuses a DOCKER_HOST that is not a unix socket before Testcontainers dials it', async () => {
    const loopback = await startFakeDockerLoopback();
    const dockerHost = `tcp://127.0.0.1:${loopback.port}`;

    const probe = await runEndpointProbe({
      HOME: privateDirectory('budget-tc-'),
      DOCKER_HOST: dockerHost,
    });

    expect(probe.status).not.toBe(0);
    expect(probe.stderr).toContain(`cannot verify DOCKER_HOST "${dockerHost}"`);
    expect(loopback.requests).toEqual([]);
  });

  it('refuses an empty DOCKER_HOST, which Testcontainers treats as unset', async () => {
    const probe = await runEndpointProbe({ HOME: privateDirectory('budget-tc-'), DOCKER_HOST: '' });

    expect(probe.status).not.toBe(0);
    expect(probe.stderr).toContain('cannot verify DOCKER_HOST ""');
  });

  it('leaves endpoint selection to Testcontainers when DOCKER_HOST is unset', async () => {
    const probe = await runEndpointProbe({ HOME: privateDirectory('budget-tc-') });

    expect(probe.status, probe.stderr).toBe(0);
  });
});

describe('Supabase scratch restore preflight', () => {
  it('renders the reviewed restore order and drops only empty storage COPY blocks', () => {
    const plain = runRestoreScript(['render', minimalBundle()]);

    expect(plain.status, plain.stderr).toBe(0);
    expect(segmentNames(plain.stdout)).toEqual([
      'prepare-target',
      'neutralize-default-privileges',
      'roles.sql',
      'auth-schema.sql',
      'supabase-migrations-schema.sql',
      'schema.sql',
      'data.sql',
      'migration-history.sql',
      'auth-schema-migrations.txt',
      'reinstate-default-privileges',
      'complete-restore',
    ]);
    expect(plain.stdout).not.toContain('COPY "storage"');
    expect(plain.stdout).toContain(
      'COPY "public"."categories" ("name_en", "name_ar") FROM stdin;\n\\N\tبقالة\n\\.\n',
    );
    expect(plain.stdout).toContain("('20240729123726')");

    const referencing = runRestoreScript([
      'render',
      minimalBundle({
        'roles.sql':
          'GRANT SET ON PARAMETER "log_min_messages" TO "supabase_realtime_admin";\nRESET ALL;\n',
      }),
    ]);
    expect(referencing.status, referencing.stderr).toBe(0);
    expect(segmentNames(referencing.stdout).slice(0, 3)).toEqual([
      'prepare-target',
      'platform-role:supabase_realtime_admin',
      'neutralize-default-privileges',
    ]);
  });

  it.each([
    [
      'storage rows',
      { 'data.sql': 'COPY "storage"."objects" ("id") FROM stdin;\n00000000-0000-4000-8000-000000000001\n\\.\n' },
      'restore bundle contains storage rows',
    ],
    ['a psql shell escape', { 'schema.sql': '\\! id\n' }, 'restore bundle contains a psql meta-command'],
    [
      'an uncommented restrict key',
      { 'roles.sql': '\\restrict synthetic\n' },
      'restore bundle contains a psql meta-command',
    ],
    ['a reconnect', { 'data.sql': '\\connect postgres\n' }, 'restore bundle contains a psql meta-command'],
    ['a COMMIT', { 'schema.sql': 'COMMIT;\n' }, 'restore bundle contains transaction control'],
    [
      'a START TRANSACTION',
      { 'migration-history.sql': 'start transaction;\n' },
      'restore bundle contains transaction control',
    ],
    [
      'an unterminated COPY block',
      { 'data.sql': 'COPY "public"."categories" ("id") FROM stdin;\n1\n' },
      'restore bundle has an unterminated COPY block',
    ],
    [
      'an injected auth version',
      { 'auth-schema-migrations.txt': "20240729123726'); DROP SCHEMA auth; --\n" },
      'auth schema migration versions are invalid',
    ],
    [
      'a duplicated auth version',
      { 'auth-schema-migrations.txt': '00\n00\n' },
      'auth schema migration versions are invalid',
    ],
  ] as const)('refuses a bundle with %s before contacting any target', (_case, overrides, message) => {
    const result = runRestoreScript(['render', minimalBundle(overrides)]);

    expect(result.status).toBe(65);
    expect(result.stderr).toContain(message);
    expect(result.stdout).toBe('');
  });

  it('refuses a bundle file that group or other can read', () => {
    const bundle = minimalBundle();
    chmodSync(join(bundle, 'schema.sql'), 0o640);

    const result = runRestoreScript(['render', bundle]);

    expect(result.status).toBe(65);
    expect(result.stderr).toContain('restore bundle file is missing or unsafe: schema.sql');
  });

  it('refuses a Docker endpoint that is neither a local socket nor SSH', () => {
    const output = join(privateDirectory('budget-supabase-fingerprint-'), 'scratch.fingerprint');

    const result = runRestoreScript(['fingerprint', output], {
      env: { DOCKER_HOST: 'tcp://192.0.2.10:2375', BUDGET_SCRATCH_CONTAINER: 'budget-restore-scratch' },
    });

    expect(result.status).toBe(66);
    expect(result.stderr).toContain('docker endpoint must be a local unix socket or ssh');
  });
});

describe('Supabase scratch restore on supabase/postgres 17.6.1.166', () => {
  let bundle = '';
  let productionFingerprint = '';

  beforeAll(async () => {
    // Before any container: the restore script's docker CLI uses DOCKER_HOST, so
    // Testcontainers must not have fallen back to another daemon.
    await assertTestcontainersDialsDockerHost(process.env.DOCKER_HOST);
    const source = await startSupabasePostgres({ 'budget.restore-fixture': 'synthetic-source' });
    await source.copyContentToContainer([
      { content: readFileSync(join(fixtures, 'source.sql')), target: '/tmp/budget-source.sql' },
      { content: readFileSync(join(fixtures, 'cli-2.109.1-dump.sh')), target: '/tmp/budget-cli-dump.sh' },
      { content: readFileSync(fingerprintSql), target: '/tmp/budget-fingerprint.sql' },
    ]);
    await execOk(source, [
      'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres',
      '-f', '/tmp/budget-source.sql',
    ]);

    bundle = privateDirectory('budget-supabase-bundle-');
    for (const [file, mode] of bundleDumps) {
      const dump = await execOk(source, ['bash', '/tmp/budget-cli-dump.sh', mode]);
      writeFileSync(join(bundle, file), dump, { mode: 0o600 });
    }

    // Production is fingerprinted as `postgres`, the role a hosted project exposes.
    productionFingerprint = join(
      privateDirectory('budget-supabase-production-'),
      'production.fingerprint',
    );
    const fingerprint = await execOk(source, [
      'psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres',
      '-d', 'postgres', '-f', '/tmp/budget-fingerprint.sql',
    ]);
    writeFileSync(productionFingerprint, fingerprint, { mode: 0o600 });
    await stopStartedContainers();
  }, 900_000);

  it('refuses a container without the scratch label', async () => {
    const unlabelled = await startIdleContainer({}, false);

    const result = runRestoreScript(['restore', bundle], { container: unlabelled });

    expect(result.status).toBe(66);
    expect(result.stderr).toContain(
      'scratch target must be a running container labelled budget.restore-target=supabase-scratch',
    );
  });

  it('refuses a scratch container that publishes a port beyond loopback', async () => {
    const published = await startIdleContainer(scratchLabel, true);

    const result = runRestoreScript(['restore', bundle], { container: published });

    expect(result.status).toBe(66);
    expect(result.stderr).toContain('scratch target publishes a port beyond loopback');
  });

  it('restores the CLI bundle in one transaction and verifies it against production', async () => {
    const scratch = await startSupabasePostgres(scratchLabel);

    const restored = runRestoreScript(['restore', bundle], { container: scratch });
    expect(restored.status, restored.stderr).toBe(0);
    expect(restored.stdout).toContain('supabase scratch restore committed');

    const verified = runRestoreScript(['verify', productionFingerprint], { container: scratch });
    expect(verified.status, verified.stderr).toBe(0);
    expect(verified.stdout).toMatch(/fingerprint matches production: \d+ lines/);
    expect(verified.stdout).toMatch(/foreign keys checked: [1-9]\d* constraints, 0 orphan rows/);
    expect(verified.stdout).toContain('privilege probes denied: 5/5');
    expect(verified.stdout).toContain('supabase scratch restore verified');

    expect(
      await sql(
        scratch,
        `SELECT rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication,
                rolbypassrls
         FROM pg_roles WHERE rolname = 'supabase_realtime_admin'`,
      ),
    ).toBe('f|f|f|f|f|f|f');
    expect(
      await sql(
        scratch,
        `SELECT string_agg(roleid::regrole::text, ',' ORDER BY roleid::regrole::text)
         FROM pg_auth_members WHERE member = 'supabase_realtime_admin'::regrole`,
      ),
    ).toBe('anon,authenticated,service_role');
    expect(
      await sql(
        scratch,
        "SELECT string_agg(coalesce(name_en, name_ar), ' / ' ORDER BY id) FROM public.categories",
      ),
    ).toBe("Groceries / دخل اضافي / O'Brien's rent");
    expect(await sql(scratch, 'SELECT count(*) FROM auth.sessions')).toBe('0');

    const repeated = runRestoreScript(['restore', bundle], { container: scratch });
    expect(repeated.status).toBe(67);
    expect(repeated.stderr).toContain('scratch target is not pristine');
  });

  it('grants anon SELECT and SECURITY DEFINER EXECUTE without neutralizing default privileges, and denies anon with it', async () => {
    const rendered = runRestoreScript(['render', bundle]);
    expect(rendered.status, rendered.stderr).toBe(0);
    const unneutralized = removeSegments(rendered.stdout, [
      'neutralize-default-privileges',
      'reinstate-default-privileges',
    ]);

    const widened = await startSupabasePostgres(scratchLabel);
    await widened.copyContentToContainer([
      { content: unneutralized, target: '/tmp/budget-unneutralized.sql' },
    ]);
    await execOk(widened, [
      'psql', '-X', '-q', '-o', '/dev/null', '-v', 'ON_ERROR_STOP=1', '--single-transaction',
      '-U', 'supabase_admin', '-d', 'postgres', '-f', '/tmp/budget-unneutralized.sql',
    ]);
    expect(await anonymousAccess(widened)).toEqual({ spacesSelect: 't', leaveExecute: 't' });
    const widenedVerification = runRestoreScript(['verify', productionFingerprint], {
      container: widened,
    });
    expect(widenedVerification.status).toBe(68);
    expect(widenedVerification.stderr).toContain(
      'privilege probe was not denied: anon select public.spaces',
    );
    expect(widenedVerification.stderr).toContain(
      'privilege probe was not denied: anon execute public.leave_household_space(uuid,uuid)',
    );

    const neutralized = await startSupabasePostgres(scratchLabel);
    restoreInto(neutralized, bundle);
    expect(await anonymousAccess(neutralized)).toEqual({ spacesSelect: 'f', leaveExecute: 'f' });
    const denied = await neutralized.exec([
      'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-U', 'supabase_admin',
      '-d', 'postgres', '-c', 'SET ROLE anon', '-c', 'SELECT count(*) FROM public.spaces',
    ]);
    expect(denied.exitCode).not.toBe(0);
    expect(denied.stderr).toContain('42501');
  });

  it('rolls back everything when the role dump needs a platform role the target lacks', async () => {
    const scratch = await startSupabasePostgres(scratchLabel);
    const pristine = fingerprintOf(scratch).content;

    // Defect 1: without the platform-role segment the CLI role dump cannot restore.
    const rendered = runRestoreScript(['render', bundle]);
    expect(rendered.status, rendered.stderr).toBe(0);
    await scratch.copyContentToContainer([
      {
        content: removeSegments(rendered.stdout, ['platform-role:supabase_realtime_admin']),
        target: '/tmp/budget-without-platform-role.sql',
      },
    ]);
    const withoutRole = await scratch.exec([
      'psql', '-X', '-q', '-o', '/dev/null', '-v', 'ON_ERROR_STOP=1', '--single-transaction',
      '-U', 'supabase_admin', '-d', 'postgres', '-f', '/tmp/budget-without-platform-role.sql',
    ]);
    expect(withoutRole.exitCode).not.toBe(0);
    expect(withoutRole.stderr).toContain('role "supabase_realtime_admin" does not exist');
    expect(fingerprintOf(scratch).content).toBe(pristine);

    // A platform role with no reviewed definition fails the scripted restore the same way.
    const incomplete = copyBundle(bundle);
    appendFileSync(
      join(incomplete, 'roles.sql'),
      'GRANT SET ON PARAMETER "log_min_messages" TO "supabase_unprovisioned_admin";\n',
    );

    const failed = runRestoreScript(['restore', incomplete], { container: scratch });

    expect(failed.status).toBe(67);
    expect(failed.stderr).toContain('role "supabase_unprovisioned_admin" does not exist');
    expect(failed.stderr).toContain('scratch restore transaction failed and was rolled back');
    expect(fingerprintOf(scratch).content).toBe(pristine);
    expect(
      await sql(scratch, "SELECT count(*) FROM pg_roles WHERE rolname = 'supabase_realtime_admin'"),
    ).toBe('0');
    restoreInto(scratch, bundle);
  });

  it('refuses a target whose Auth placeholder has moved past the image seed', async () => {
    const scratch = await startSupabasePostgres(scratchLabel);
    await sql(scratch, "INSERT INTO auth.schema_migrations (version) VALUES ('20990101000000')");

    const advanced = runRestoreScript(['restore', bundle], { container: scratch });

    expect(advanced.status).toBe(67);
    expect(advanced.stderr).toContain('scratch target is not pristine');
    await sql(scratch, "DELETE FROM auth.schema_migrations WHERE version = '20990101000000'");
    restoreInto(scratch, bundle);
  });

  it('commits nothing when the restore stream ends before its completion segment', async () => {
    const rendered = runRestoreScript(['render', bundle]);
    expect(rendered.status, rendered.stderr).toBe(0);
    const scratch = await startSupabasePostgres(scratchLabel);
    await scratch.copyContentToContainer([
      {
        content: removeSegments(rendered.stdout, ['complete-restore']),
        target: '/tmp/budget-truncated.sql',
      },
    ]);

    const result = await scratch.exec([
      'psql', '-X', '-q', '-o', '/dev/null', '-v', 'ON_ERROR_STOP=1', '--single-transaction',
      '-U', 'supabase_admin', '-d', 'postgres', '-f', '/tmp/budget-truncated.sql',
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('restore stream ended before its completion segment');
    expect(
      await sql(
        scratch,
        "SELECT to_regclass('public.spaces') IS NULL, to_regclass('auth.instances') IS NOT NULL",
      ),
    ).toBe('t|t');
  });

  it('normalizes a NULL ACL to its default and flags an ACL difference', async () => {
    const scratch = await startSupabasePostgres(scratchLabel);
    restoreInto(scratch, bundle);
    const aclIsNull =
      "SELECT relacl IS NULL FROM pg_class WHERE oid = 'private.household_invitation_keys'::regclass";
    expect(await sql(scratch, aclIsNull)).toBe('t');
    const restored = fingerprintOf(scratch).content;

    await sql(
      scratch,
      `GRANT SELECT ON private.household_invitation_keys TO anon;
       REVOKE SELECT ON private.household_invitation_keys FROM anon`,
    );
    expect(await sql(scratch, aclIsNull)).toBe('f');
    expect(fingerprintOf(scratch).content).toBe(restored);

    await sql(scratch, 'GRANT SELECT ON public.space_members TO anon');
    const drifted = fingerprintOf(scratch);
    const compared = runRestoreScript(['compare', productionFingerprint, drifted.path]);

    expect(compared.status).toBe(68);
    expect(compared.stderr).toMatch(/missing in scratch: relation\|public\.space_members\|/);
    expect(compared.stderr).toMatch(
      /unexpected in scratch: relation\|public\.space_members\|.*anon=r\/postgres/,
    );
  });

  it('fails verification on foreign-key orphans that replica-mode loading let through', async () => {
    const scratch = await startSupabasePostgres(scratchLabel);
    restoreInto(scratch, bundle);
    await sql(
      scratch,
      `SET session_replication_role = replica;
       INSERT INTO public.space_members (space_id, user_id)
       VALUES ('60000000-0000-4000-8000-00000000dead', '00000000-0000-4000-8000-000000000001')`,
    );

    const verified = runRestoreScript(['verify', productionFingerprint], { container: scratch });

    expect(verified.status).toBe(68);
    expect(verified.stderr).toContain('foreign-key orphan rows found');
    expect(verified.stderr).toContain('fk|public.space_members|space_members_space_id_fkey|1');
  });
});
