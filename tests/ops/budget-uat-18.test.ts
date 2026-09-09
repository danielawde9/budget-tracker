import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';

const releaseHead = '6af62c1b0105b75a9796cfb299791f4c26a7dd2e';
const scriptPath = 'scripts/ops/budget-uat-18.sh';
const remoteScriptPath = 'ops/uat/remote-budget-uat-18.sh';
const composePath = 'ops/uat/docker-compose.yml';
const environmentExamplePath = 'ops/uat/budget-uat-18.env.example';
const manifestPath = 'ops/uat/budget-uat-18-migrations.sha256';

function trackedText(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Budget exact-schema UAT static contract', () => {
  it('pins the one approved host, release, root, project, and marker', () => {
    const script = trackedText(scriptPath);

    expect(script).toContain(`readonly UAT_RELEASE_HEAD='${releaseHead}'`);
    expect(script).toContain("readonly UAT_REMOTE_HOST='lelabo@100.76.160.91'");
    expect(script).toContain("readonly UAT_REMOTE_NAME='lelabo'");
    expect(script).toContain("readonly UAT_REMOTE_IP='100.76.160.91'");
    expect(script).toContain("readonly UAT_REMOTE_ROOT='/home/lelabo/budget-uat-18'");
    expect(script).toContain("readonly UAT_PROJECT='budget-uat-18'");
    expect(script).toContain("readonly UAT_MARKER='.budget-uat-18-project'");
    expect(script).toContain(
      'git -C "${UAT_REPO_ROOT}" merge-base --is-ancestor "${UAT_RELEASE_HEAD}" HEAD',
    );
    expect(script).toContain(
      'git -C "${UAT_REPO_ROOT}" diff --quiet "${UAT_RELEASE_HEAD}" -- supabase/migrations',
    );
    expect(script).not.toContain(
      '[[ "${actual_head}" == "${UAT_RELEASE_HEAD}" ]]',
    );
  });

  it('defines only four digest-pinned, unprivileged, restart-disabled services', () => {
    const compose = trackedText(composePath);
    const servicesBlock = compose.split('\nnetworks:\n', 1)[0] ?? '';
    const serviceNames = [
      ...servicesBlock.matchAll(/^  ([a-z][a-z0-9_-]+):$/gm),
    ].map(([, name]) => name);

    expect(serviceNames).toEqual(['db', 'auth', 'rest', 'kong']);
    expect(compose.match(/^    image: .+@sha256:[a-f0-9]{64}$/gm)).toHaveLength(4);
    expect(compose.match(/^    restart: "no"$/gm)).toHaveLength(4);
    expect(compose).not.toMatch(/^\s+privileged:/m);
    expect(compose).not.toMatch(/^\s+network_mode:\s*(host|service:)/m);
    expect(compose).toContain('127.0.0.1:54521:8000');
    expect(compose).toContain('127.0.0.1:54522:5432');
    expect(compose).not.toMatch(/0\.0\.0\.0:5452[0-9]/);
    expect(compose).toContain('name: budget-uat-18-net');
    expect(compose).toContain('name: budget-uat-18-db-data');
  });

  it('exposes only the bounded lifecycle and forbids existing-stack commands', () => {
    const script = trackedText(scriptPath);

    expect(script).toContain('case "${1:-}" in');
    for (const command of ['preflight', 'sync', 'provision', 'verify', 'stop', 'cleanup']) {
      expect(script).toMatch(new RegExp(`^  ${command}\\)$`, 'm'));
    }
    expect(script).toContain('ConnectTimeout=10');
    expect(script).toContain('ConnectionAttempts=2');
    expect(script).toContain('ServerAliveInterval=15');
    expect(script).toContain('ServerAliveCountMax=2');
    expect(script).toContain('readonly UAT_SSH_WALL_SECONDS=45');
    expect(script).toContain('alarm shift @ARGV; exec @ARGV');
    expect(script).toContain('bounded_ssh');
    expect(script).toContain('bounded_scp');
    expect(script).toContain('validate_cleanup_entrypoint');
    expect(script).toContain('UAT_MAX_HEALTH_POLLS=60');
    expect(script).toContain('UAT_HEALTH_POLL_SECONDS=5');
    expect(script).not.toMatch(/supabase\s+(?:start|stop|db\s+reset|nuke)/);
    expect(script).not.toContain('budget-supabase.sh');
    expect(script).not.toMatch(/docker\s+(?:stop|restart|rm).*budget-supabase/);
  });

  it('keeps secret values out of the tracked environment contract', () => {
    const example = trackedText(environmentExamplePath);
    const secretNames = [
      'POSTGRES_PASSWORD',
      'JWT_SECRET',
      'ANON_KEY',
      'SERVICE_ROLE_KEY',
    ];

    for (const name of secretNames) {
      expect(example).toContain(`${name}=`);
      expect(example).not.toMatch(new RegExp(`^${name}=.+$`, 'm'));
    }
    expect(example).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  });

  it('requires exact marker and compose labels before cleanup', () => {
    const remoteScript = trackedText(remoteScriptPath);

    expect(remoteScript).toContain('require_exact_marker');
    expect(remoteScript).toContain('require_exact_project_labels');
    expect(remoteScript).toContain('reject_unknown_uat_resources');
    expect(remoteScript).toContain("readonly UAT_PROJECT='budget-uat-18'");
    expect(remoteScript).toContain("readonly UAT_MARKER='.budget-uat-18-project'");
    expect(remoteScript).not.toMatch(/docker\s+system\s+prune/);
    expect(remoteScript).not.toMatch(/docker\s+volume\s+prune/);
    expect(remoteScript).not.toMatch(/rm\s+-rf/);
  });

  it('wires the focused UAT gate into the existing ops entrypoint', () => {
    const packageJson = JSON.parse(trackedText('package.json')) as {
      scripts: Record<string, string>;
    };
    const opsCheck = trackedText('scripts/ops/check-budget.sh');

    expect(packageJson.scripts['check:uat:infra']).toBe(
      'pnpm exec vitest run tests/ops/budget-uat-18.test.ts --pool=forks --no-file-parallelism',
    );
    expect(opsCheck).toContain('budget-uat-18.sh');
    expect(opsCheck).toContain('remote-budget-uat-18.sh');
  });

  it('pins exactly the release candidate migration tree in canonical order', () => {
    const rows = trackedText(manifestPath).trimEnd().split('\n');
    const migrationRows = rows.slice(2);
    const localMigrationNames = migrationRows.map((row) => row.split('|')[1]);

    expect(rows[0]).toBe('budget_uat_migration_manifest_version=1');
    expect(rows[1]).toBe(`source_sha=${releaseHead}`);
    expect(migrationRows).toHaveLength(18);
    expect(localMigrationNames).toEqual([...localMigrationNames].sort());

    for (const row of migrationRows) {
      const [version, filename, expectedHash] = row.split('|');
      const migration = trackedText(join('supabase/migrations', filename));

      expect(filename).toBe(`${version}_${basename(filename).split('_').slice(1).join('_')}`);
      expect(createHash('sha256').update(migration).digest('hex')).toBe(expectedHash);
    }
  });

  it('generates secrets only on Ubuntu through an exclusive no-follow mode-0600 file', () => {
    const localScript = trackedText(scriptPath);
    const remoteScript = trackedText(remoteScriptPath);

    expect(localScript).not.toMatch(/(?:JWT_SECRET|POSTGRES_PASSWORD|ANON_KEY|SERVICE_ROLE_KEY)=/);
    expect(remoteScript).toContain('generate_secret_environment');
    expect(remoteScript).toContain('os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW');
    expect(remoteScript).toContain('0o600');
    expect(remoteScript).not.toContain('run.sh secrets');
    expect(remoteScript).not.toContain('docker compose config');
    expect(remoteScript).not.toMatch(/set\s+-x/);
  });

  it('verifies all hashes before startup and journals each migration transactionally', () => {
    const localScript = trackedText(scriptPath);
    const remoteScript = trackedText(remoteScriptPath);

    expect(localScript).toContain('validate_local_manifest');
    expect(localScript).toContain('run_remote verify-sync');
    expect(remoteScript).toContain('verify_migration_bundle');
    expect(remoteScript).toContain('[[ "${migration_count}" -eq 18 ]]');
    expect(remoteScript).toContain('apply_migrations');
    expect(remoteScript).toContain("printf '%s\\n' 'begin;'");
    expect(remoteScript).toContain('supabase_migrations.schema_migrations');
    expect(remoteScript).toContain("printf '%s\\n' 'commit;'");
  });

  it('bounds health and cleanup to exact UAT resources', () => {
    const remoteScript = trackedText(remoteScriptPath);

    expect(remoteScript).toContain('wait_for_health');
    expect(remoteScript).toContain('readonly UAT_DOCKER_WALL_SECONDS=30');
    expect(remoteScript).toContain('/usr/bin/timeout --signal=TERM');
    expect(remoteScript).toContain('for ((poll = 1; poll <= UAT_MAX_HEALTH_POLLS; poll += 1))');
    expect(remoteScript).toContain('sleep "${UAT_HEALTH_POLL_SECONDS}"');
    expect(remoteScript).toContain('snapshot_budget_development');
    expect(remoteScript).toContain('compare_budget_development_snapshots');
    expect(remoteScript).toContain('docker compose --project-name "${UAT_PROJECT}"');
    expect(remoteScript).toContain('compose down');
    expect(remoteScript).toContain('docker volume rm "${UAT_VOLUME}"');
    expect(remoteScript).toContain('docker network rm "${UAT_NETWORK}"');
    expect(remoteScript).not.toMatch(/docker\s+(?:system|container|network|volume)\s+prune/);
  });
});
