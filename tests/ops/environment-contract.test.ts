import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts/ops/budget-common.sh');

function fixture() {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'budget-ops-environment-'));
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
    BUDGET_TRUSTED_PARENT: base,
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
  it('rechecks private marker metadata on the opened descriptor', () => {
    const source = readFileSync(script, 'utf8');

    expect(source).toContain('S_ISREG($opened[2])');
    expect(source).toContain('$opened[4] == $<');
    expect(source).toContain('(($opened[2] & 0777) == 0600)');
    expect(source).toContain('$opened[7] <= 4096');
  });

  it('routes executable hashes, version probes, and source checks through the operation deadline', () => {
    const source = readFileSync(script, 'utf8');

    expect(source).toContain('budget_run_internal_before_deadline');
    expect(source).not.toContain('output="$(/usr/bin/shasum');
    expect(source).not.toContain('actual="$(/usr/bin/git');
    expect(source).not.toContain("alarm 5; exec @ARGV");
  });

  it('uses a fresh bounded descendant validation for cleanup after the operation deadline', () => {
    const { base, root } = fixture();
    const outside = join(base, 'outside-cleanup.txt');
    const cleanupTarget = join(root, 'tmp', 'cleanup-target');
    mkdirSync(join(root, 'tmp'), { mode: 0o700 });
    mkdirSync(cleanupTarget, { mode: 0o700 });
    writeFileSync(join(cleanupTarget, 'payload.regular'), 'fixture\n', {
      mode: 0o600,
    });
    writeFileSync(outside, 'must remain\n', { mode: 0o600 });
    symlinkSync(outside, join(cleanupTarget, 'linked-artifact'));
    const fifo = spawnSync(
      '/usr/bin/mkfifo',
      [join(cleanupTarget, 'payload.fifo')],
      { encoding: 'utf8' },
    );
    expect(fifo.status, fifo.stderr).toBe(0);
    const result = spawnSync(
      'bash',
      [
        '-c',
        'source "$1"; operation_deadline=1; cleanup_deadline="$(budget_start_cleanup_deadline 66)"; budget_remove_private_descendant "$2" "tmp/cleanup-target" "$cleanup_deadline" 66',
        'cleanup-deadline-test',
        script,
        root,
      ],
      { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env } },
    );
    const backupSource = readFileSync(
      join(process.cwd(), 'scripts/ops/backup-budget.sh'),
      'utf8',
    );
    const restoreSource = readFileSync(
      join(process.cwd(), 'scripts/ops/restore-budget.sh'),
      'utf8',
    );
    const backupCleanup = backupSource.slice(
      backupSource.indexOf('backup_cleanup()'),
      backupSource.indexOf('backup_execute()'),
    );
    const restoreCleanup = restoreSource.slice(
      restoreSource.indexOf('restore_cleanup()'),
      restoreSource.indexOf('restore_manifest_value()'),
    );

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(cleanupTarget)).toBe(false);
    expect(readFileSync(outside, 'utf8')).toBe('must remain\n');
    expect(backupCleanup).toContain('budget_start_cleanup_deadline');
    expect(backupCleanup).toContain('budget_remove_private_descendant');
    expect(backupCleanup).not.toContain('rm -f');
    expect(backupCleanup).not.toContain('rmdir');
    expect(backupCleanup).toContain(
      'budget_cleanup_executable_snapshot_dir "${backup_exec_dir:-}"',
    );
    expect(backupCleanup).toContain('"${cleanup_deadline}" 66');
    expect(backupCleanup).not.toContain('${backup_deadline}');
    expect(restoreCleanup).toContain('budget_start_cleanup_deadline');
    expect(restoreCleanup).toContain('budget_remove_private_descendant');
    expect(restoreCleanup).not.toContain('rm -f');
    expect(restoreCleanup).not.toContain('rmdir');
    expect(restoreCleanup).toContain(
      'budget_cleanup_executable_snapshot_dir "${restore_exec_dir:-}"',
    );
    expect(restoreCleanup).toContain('"${cleanup_deadline}" 76');
    expect(restoreCleanup).not.toContain('${restore_deadline}');
    expect(readFileSync(script, 'utf8')).not.toContain(
      '/bin/rm -f -- "${destination}"',
    );
  });

  it('refuses cleanup when a run directory exceeds the flat entry bound', () => {
    const { root } = fixture();
    const cleanupTarget = join(root, 'tmp', 'oversized-cleanup');
    mkdirSync(cleanupTarget, { recursive: true, mode: 0o700 });
    for (let position = 0; position < 33; position += 1) {
      writeFileSync(join(cleanupTarget, `artifact-${position}`), 'fixture\n', {
        mode: 0o600,
      });
    }

    const result = spawnSync(
      'bash',
      [
        '-c',
        'source "$1"; cleanup_deadline="$(budget_start_cleanup_deadline 66)"; budget_remove_private_descendant "$2" "tmp/oversized-cleanup" "$cleanup_deadline" 66',
        'cleanup-bound-test',
        script,
        root,
      ],
      { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env } },
    );

    expect(result.status).toBe(66);
    expect(result.stderr).toContain('bounded private cleanup failed');
    expect(existsSync(cleanupTarget)).toBe(true);
  });

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
      BUDGET_HOSTNAME: 'budget-live-deposit.tailnet.example',
      BUDGET_VOLUME: 'budget-live-composition-db',
    });

    expect(result.status).toBe(0);
  });

  it('does not execute a utility injected through ambient PATH', () => {
    const { base, env } = fixture();
    const maliciousBin = join(base, 'malicious-bin');
    const maliciousLog = join(base, 'ambient-path.log');
    mkdirSync(maliciousBin, { mode: 0o700 });
    writeFileSync(
      join(maliciousBin, 'tr'),
      '#!/bin/bash\nprintf "ambient-tr\\n" >> "$BUDGET_AMBIENT_PATH_LOG"\n/usr/bin/tr "$@"\n',
      { mode: 0o700 },
    );

    const result = run('validate-environment', {
      ...env,
      PATH: `${maliciousBin}:${process.env.PATH ?? ''}`,
      BUDGET_AMBIENT_PATH_LOG: maliciousLog,
    });

    expect(result.status).toBe(0);
    expect(() => readFileSync(maliciousLog, 'utf8')).toThrow();
  });

  it('rejects a cross-environment identifier outside the exact live allowlist', () => {
    const { env } = fixture();
    const result = run('validate-environment', {
      ...env,
      BUDGET_NETWORK: 'budget-uat-net',
    });

    expect(result.status).toBe(65);
    expect(result.stderr).toContain('outside the exact Budget allowlist');
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
    writeFileSync(marker, 'budget-ops-marker-v1\nenvironment=uat\n', {
      mode: 0o600,
    });
    const wrong = run('validate-environment', env);

    expect(missing.status).toBe(67);
    expect(missing.stderr).toContain('marker is missing');
    expect(wrong.status).toBe(67);
    expect(wrong.stderr).toContain('marker identity mismatch');
  });

  it('rejects a root whose configured path resolves through a symlink', () => {
    const { env, root } = fixture();
    const realRoot = `${root}.real`;
    renameSync(root, realRoot);
    symlinkSync(realRoot, root, 'dir');

    const result = run('validate-environment', env);

    expect(result.status).toBe(66);
    expect(result.stderr).toContain('unsafe Budget root');
  });

  it('rejects a marker symlink instead of following it', () => {
    const { env, marker } = fixture();
    const realMarker = `${marker}.real`;
    renameSync(marker, realMarker);
    symlinkSync(realMarker, marker);

    const result = run('validate-environment', env);

    expect(result.status).toBe(67);
    expect(result.stderr).toContain('environment marker is unsafe');
  });

  it('rejects a trusted parent that is writable by another account', () => {
    const { base, env } = fixture();
    chmodSync(base, 0o770);

    const result = run('validate-environment', env);

    expect(result.status).toBe(66);
    expect(result.stderr).toContain('unsafe Budget root');
  });

  it('rejects a malformed expected database system identifier', () => {
    const { env } = fixture();
    const result = run('validate-environment', {
      ...env,
      BUDGET_EXPECTED_SYSTEM_ID: 'not-a-system-id',
    });

    expect(result.status).toBe(68);
    expect(result.stderr).toContain('database system identifier must be an exact numeric value');
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

  it('allows secret references and empty placeholders without treating them as values', () => {
    const { base } = fixture();
    const candidate = join(base, 'configuration.example');
    writeFileSync(
      candidate,
      [
        'SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY:?required}',
        'DB_PASSWORD=',
        'AGE_IDENTITY=<external-secret-reference>',
        '',
      ].join('\n'),
    );
    const result = spawnSync(
      'bash',
      [script, 'scan-secrets', candidate],
      { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env } },
    );

    expect(result.status).toBe(0);
  });

  it('does not follow a swapped or linked secret-scan candidate', () => {
    const { base } = fixture();
    const target = join(base, 'scan-target.log');
    const candidate = join(base, 'scan-candidate.log');
    writeFileSync(target, 'ordinary fixture text\n');
    symlinkSync(target, candidate);

    const result = spawnSync('bash', [script, 'scan-secrets', candidate], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env },
    });
    const source = readFileSync(script, 'utf8');

    expect(result.status).toBe(64);
    expect(result.stderr).toContain(
      'secret scan candidate is not a bounded regular file',
    );
    expect(source).not.toContain('wc -c <');
    expect(source).not.toContain('content="$(<"');
  });

  it.each([
    'DB_PASSWORD=actual-secret${DB_PASSWORD:?required}',
    'AGE_IDENTITY=actual-secret<external-secret-reference>',
    'SMTP_TOKEN=<external-secret-reference>actual-secret',
  ])('rejects a secret mixed with placeholder syntax: %s', (line) => {
    const { base } = fixture();
    const candidate = join(base, 'mixed-placeholder.example');
    writeFileSync(candidate, `${line}\n`);

    const result = spawnSync('bash', [script, 'scan-secrets', candidate], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env },
    });

    expect(result.status).toBe(69);
    expect(result.stderr).toContain(
      'secret material detected in mixed-placeholder.example',
    );
    expect(result.stderr).not.toContain('actual-secret');
  });
});
