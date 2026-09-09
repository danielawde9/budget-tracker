import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts/ops/budget-common.sh');

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'budget-ops-environment-'));
  const root = join(base, 'budget-live');
  const marker = join(root, '.budget-ops-marker');
  const operationLog = join(base, 'operation.log');
  const env = {
    ...process.env,
    BUDGET_ENV: 'live',
    BUDGET_ROOT: root,
    BUDGET_MARKER_PATH: marker,
    BUDGET_PROJECT_ID: 'budget-live',
    BUDGET_HOSTNAME: 'budget-live.tailnet.example',
    BUDGET_VOLUME: 'budget-live-db',
    BUDGET_NETWORK: 'budget-live-net',
    BUDGET_PORT_RANGE: '54620-54629',
    BUDGET_EXPECTED_SYSTEM_ID: '7000000000000000001',
    BUDGET_ACTUAL_SYSTEM_ID: '7000000000000000001',
    BUDGET_OPERATION_LOG: operationLog,
  };

  mkdirSync(root, { mode: 0o700 });
  writeFileSync(
    marker,
    [
      'budget-ops-marker-v1',
      'environment=live',
      'project=budget-live',
      'system_id=7000000000000000001',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );

  return { base, env, marker, operationLog, root };
}

function run(command: string, env: NodeJS.ProcessEnv) {
  return spawnSync('bash', [script, command], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
  });
}

describe('Budget operations environment contract', () => {
  it.each(['', 'production', 'LIVE', 'scratch'])(
    'rejects empty or unknown environment %j',
    (environment) => {
      const { env } = fixture();
      const result = run('validate-environment', {
        ...env,
        BUDGET_ENV: environment,
      });

      expect(result.status).toBe(64);
      expect(result.stderr).toContain(
        'environment must be exactly development, uat, or live',
      );
    },
  );

  it.each([
    ['BUDGET_PROJECT_ID', 'sandooq-supabase'],
    ['BUDGET_HOSTNAME', 'pos.internal'],
    ['BUDGET_VOLUME', 'supabase_db_pos'],
    ['BUDGET_NETWORK', 'sandooq_default'],
  ])('rejects protected %s before any operation', (key, value) => {
    const { env, operationLog } = fixture();
    const result = run('validate-environment', { ...env, [key]: value });

    expect(result.status).toBe(65);
    expect(result.stderr).toContain('protected Sandooq/POS identifier');
    expect(() => readFileSync(operationLog, 'utf8')).toThrow();
  });

  it('does not reject benign Budget identifiers containing ordinary letter sequences', () => {
    const { env } = fixture();
    const result = run('validate-environment', {
      ...env,
      BUDGET_HOSTNAME: 'budget-deposit.tailnet.example',
      BUDGET_VOLUME: 'budget-composition-db',
    });

    expect(result.status).toBe(0);
  });

  it.each([
    '/',
    '/home/lelabo',
    '~',
    '$UNRESOLVED/backups',
    '/tmp/budget-*',
    '/tmp/budget/../shared',
    process.cwd(),
  ])('rejects unresolved or broad root %s', (root) => {
    const { env } = fixture();
    const result = run('validate-environment', { ...env, BUDGET_ROOT: root });

    expect(result.status).toBe(66);
    expect(result.stderr).toContain('unsafe Budget root');
  });

  it('rejects a missing marker and a marker with the wrong identity', () => {
    const { env, marker } = fixture();
    unlinkSync(marker);
    const missing = run('validate-environment', env);
    writeFileSync(marker, 'budget-ops-marker-v1\nenvironment=uat\n');
    const wrong = run('validate-environment', env);

    expect(missing.status).toBe(67);
    expect(missing.stderr).toContain('marker is missing');
    expect(wrong.status).toBe(67);
    expect(wrong.stderr).toContain('marker identity mismatch');
  });

  it('rejects the wrong database system identifier', () => {
    const { env } = fixture();
    const result = run('validate-environment', {
      ...env,
      BUDGET_ACTUAL_SYSTEM_ID: '7000000000000000999',
    });

    expect(result.status).toBe(68);
    expect(result.stderr).toContain('database system identifier mismatch');
  });

  it('accepts an exact, marked, isolated Budget target without executing an operation', () => {
    const { env, operationLog } = fixture();
    const result = run('validate-environment', env);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('validated Budget live target');
    expect(() => readFileSync(operationLog, 'utf8')).toThrow();
  });

  it('reports secret findings without printing the discovered value', () => {
    const { base } = fixture();
    const candidate = join(base, 'candidate.log');
    const secret = 'fixture_service_role_secret_DO_NOT_PRINT';
    writeFileSync(candidate, `SUPABASE_SERVICE_ROLE_KEY=${secret}\n`);
    const result = spawnSync(
      'bash',
      [script, 'scan-secrets', candidate],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, BUDGET_DISCOVERED_SECRETS: secret },
      },
    );

    expect(result.status).toBe(69);
    expect(`${result.stdout}${result.stderr}`).toContain(
      'secret material detected in candidate.log',
    );
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
  });
});
