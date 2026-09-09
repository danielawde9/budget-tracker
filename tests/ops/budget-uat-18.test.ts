import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const releaseHead = '6af62c1b0105b75a9796cfb299791f4c26a7dd2e';
const scriptPath = 'scripts/ops/budget-uat-18.sh';
const remoteScriptPath = 'ops/uat/remote-budget-uat-18.sh';
const composePath = 'ops/uat/docker-compose.yml';
const environmentExamplePath = 'ops/uat/budget-uat-18.env.example';

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
});
