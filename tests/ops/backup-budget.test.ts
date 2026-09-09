import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeBackupFixture } from './ops-fixture.js';

const script = join(process.cwd(), 'scripts/ops/backup-budget.sh');

function run(command: string, env: NodeJS.ProcessEnv, extraArgs: string[] = []) {
  return spawnSync('bash', [script, command, ...extraArgs], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
  });
}

describe('encrypted Budget backup boundary', () => {
  it.each([
    ['BUDGET_AGE_RECIPIENT', 'encryption recipient is not configured'],
    ['BUDGET_OFFSITE_DESTINATION', 'off-site destination is not configured'],
  ])('refuses missing %s before executing any tool', (key, message) => {
    const { env, log } = makeBackupFixture();
    const result = run('backup', { ...env, [key]: '' });

    expect(result.status).toBe(70);
    expect(result.stderr).toContain(message);
    expect(existsSync(log)).toBe(false);
  });

  it('refuses insufficient declared space before dumping', () => {
    const { env, log } = makeBackupFixture();
    const result = run('backup', {
      ...env,
      BUDGET_AVAILABLE_BYTES: '1023',
    });

    expect(result.status).toBe(71);
    expect(result.stderr).toContain('insufficient backup space');
    expect(existsSync(log)).toBe(false);
  });

  it.each([
    ['BUDGET_DATABASE_HOST', 'sandooq.internal'],
    ['BUDGET_DATABASE_NAME', 'supabase_db_pos'],
    ['BUDGET_DATABASE_USER', 'pos_operator'],
  ])('refuses protected database setting %s before any tool runs', (key, value) => {
    const { env, log } = makeBackupFixture();
    const result = run('backup', { ...env, [key]: value });

    expect(result.status).toBe(70);
    expect(result.stderr).toContain('protected Sandooq/POS database identifier');
    expect(existsSync(log)).toBe(false);
  });

  it('refuses a database secret file that is not mode 0600', () => {
    const { env, log, passfile } = makeBackupFixture();
    chmodSync(passfile, 0o644);
    const result = run('backup', env);

    expect(result.status).toBe(70);
    expect(result.stderr).toContain('secret file must be mode 0600');
    expect(existsSync(log)).toBe(false);
  });

  it.each(['/', '../budget-live', 'bucket/*']) (
    'refuses unsafe off-site destination %s',
    (destination) => {
      const { env, log } = makeBackupFixture();
      const result = run('backup', {
        ...env,
        BUDGET_OFFSITE_DESTINATION: destination,
      });

      expect(result.status).toBe(70);
      expect(result.stderr).toContain('off-site destination is outside the exact allowlist');
      expect(existsSync(log)).toBe(false);
    },
  );

  it('uses a nonblocking single-run lock', () => {
    const { env, root, log } = makeBackupFixture();
    mkdirSync(join(root, 'locks', 'backup-live.lock'), { recursive: true });
    const result = run('backup', env);

    expect(result.status).toBe(72);
    expect(result.stderr).toContain('backup is already running');
    expect(existsSync(log)).toBe(false);
  });

  it('dry-run validates configuration without filesystem, database, or network mutation', () => {
    const { env, root, log } = makeBackupFixture();
    const before = readdirSync(root);
    const result = run('dry-run', env);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('BLOCKED until configured off-site proof');
    expect(readdirSync(root)).toEqual(before);
    expect(existsSync(log)).toBe(false);
  });

  it('bounds dump and packaging tools, encrypts every payload, verifies off-site, and writes ciphertext hashes', () => {
    const { env, log, root } = makeBackupFixture();
    const result = run('backup', env);
    const recoveryPoint = join(
      root,
      'backups/live/2026-09-09T021500Z-fixture',
    );
    expect(result.status).toBe(0);
    const commandLog = readFileSync(log, 'utf8');
    const manifest = readFileSync(join(recoveryPoint, 'manifest.txt'), 'utf8');
    expect(commandLog).toContain('timeout:1800:pg_dump');
    expect(commandLog.match(/db-verify:/g)).toHaveLength(2);
    expect(commandLog).toContain('timeout:1800:pg_dumpall');
    expect(commandLog).toContain('timeout:300:catalog');
    expect(commandLog.match(/timeout:300:age/g)).toHaveLength(3);
    expect(commandLog.match(/offsite:put/g)).toHaveLength(4);
    expect(commandLog.match(/offsite:verify/g)).toHaveLength(4);
    expect(readdirSync(recoveryPoint).sort()).toEqual([
      'SUCCESS',
      'archive.dump.age',
      'catalog.txt.age',
      'manifest.txt',
      'roles.sql.age',
    ]);
    for (const filename of [
      'archive.dump.age',
      'catalog.txt.age',
      'roles.sql.age',
    ]) {
      const bytes = readFileSync(join(recoveryPoint, filename));
      const hash = createHash('sha256').update(bytes).digest('hex');
      expect(manifest).toContain(`${hash}  ${filename}`);
    }
    expect(manifest).toContain('system_id=7000000000000000001');
    expect(manifest).toContain('postgres_major=17');
    expect(manifest).toContain('pg_dump_version=17.6');
    expect(manifest).toContain('backup_tool_version=budget-backup-v1');
    expect(manifest).toContain('started_at_utc=2026-09-09T02:15:00Z');
    expect(manifest).toContain('finished_at_utc=2026-09-09T02:15:00Z');
    expect(manifest).toMatch(/duration_seconds=[0-9]+/);
    expect(manifest).toContain('release_id=release-fixture');
    expect(manifest).toContain('migration_manifest_sha256=');
    expect(manifest).toMatch(/catalog_metadata_sha256=[a-f0-9]{64}/);
    expect(manifest).toMatch(/archive\.dump\.age_size=[1-9][0-9]*/);
    expect(manifest).toMatch(/roles\.sql\.age_size=[1-9][0-9]*/);
    expect(manifest).toMatch(/catalog\.txt\.age_size=[1-9][0-9]*/);
    expect(manifest).not.toContain('fixture-only');
  });

  it('trusts the measured database identity instead of a caller declaration', () => {
    const { env, log } = makeBackupFixture();
    const result = run('backup', {
      ...env,
      BUDGET_ACTUAL_SYSTEM_ID: '7000000000000000001',
      BUDGET_FAKE_VERIFY_SYSTEM_ID: '7000000000000000999',
    });

    expect(result.status).toBe(68);
    expect(result.stderr).toContain('measured database identity mismatch');
    expect(readFileSync(log, 'utf8')).not.toContain('pg_dump');
  });

  it('rechecks the same immutable endpoint immediately before pg_dump', () => {
    const { env, log } = makeBackupFixture();
    const result = run('backup', {
      ...env,
      BUDGET_FAKE_VERIFY_SECOND_SYSTEM_ID: '7000000000000000999',
    });

    expect(result.status).toBe(68);
    expect(result.stderr).toContain('database identity changed before backup');
    expect(readFileSync(log, 'utf8')).not.toContain('pg_dump');
  });

  it('rejects a marker swapped after validation before backup effects', () => {
    const { env, log, marker } = makeBackupFixture();
    const result = run('backup', {
      ...env,
      BUDGET_FAKE_SWAP_MARKER_PATH: marker,
    });

    expect(result.status).toBe(67);
    expect(result.stderr).toContain('environment marker is unsafe');
    expect(readFileSync(log, 'utf8').trimEnd().split('\n')).not.toContain('pg_dump');
  });

  it('rejects a root swapped after validation before backup effects', () => {
    const { env, log, root } = makeBackupFixture();
    const result = run('backup', {
      ...env,
      BUDGET_FAKE_SWAP_ROOT_PATH: root,
    });

    expect(result.status).toBe(66);
    expect(result.stderr).toContain('unsafe Budget root');
    expect(readFileSync(log, 'utf8').trimEnd().split('\n')).not.toContain('pg_dump');
  });

  it('removes every plaintext payload when encryption fails', () => {
    const { env, log, root } = makeBackupFixture();
    const result = run('backup', { ...env, BUDGET_FAKE_AGE_FAIL: '1' });
    const tempRoot = join(root, 'tmp');

    expect(result.status).toBe(17);
    expect(readFileSync(log, 'utf8')).toContain('timeout:300:age');
    expect(existsSync(join(tempRoot, '2026-09-09T021500Z-fixture.plaintext'))).toBe(
      false,
    );
  });

  it('keeps bounded daily, Sunday-weekly, and first-of-month recovery points plus pinned and newest points', () => {
    const { base, env } = makeBackupFixture();
    const index = join(base, 'retention.index');
    const lines: string[] = [];
    for (let position = 0; position < 18; position += 1) {
      const day = String(28 - position).padStart(2, '0');
      lines.push(
        `budget-live-d${position}|2026-08-${day}T02:15:00Z|daily|${position === 16 ? 'pinned' : 'normal'}|verified`,
      );
    }
    for (let position = 0; position < 10; position += 1) {
      const date = new Date(Date.UTC(2026, 7, 23 - position * 7));
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      lines.push(
        `budget-live-w${position}|${year}-${month}-${day}T02:15:00Z|weekly|normal|verified`,
      );
    }
    for (let position = 0; position < 14; position += 1) {
      const date = new Date(Date.UTC(2026, 6 - position, 1));
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      lines.push(
        `budget-live-m${position}|${year}-${month}-01T02:15:00Z|monthly|normal|verified`,
      );
    }
    writeFileSync(index, `${lines.join('\n')}\n`);

    const result = run('retention-plan', env, [index]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('keep|budget-live-d0|newest');
    expect(result.stdout).toContain('keep|budget-live-d16|incident-pinned');
    expect(result.stdout.match(/^keep\|budget-live-d\d+\|/gm)).toHaveLength(15);
    expect(result.stdout.match(/^keep\|budget-live-w\d+\|/gm)).toHaveLength(8);
    expect(result.stdout.match(/^keep\|budget-live-m\d+\|/gm)).toHaveLength(12);
    expect(result.stdout).toContain('delete|budget-live-d17|daily-expired');
    expect(result.stdout).toContain('delete|budget-live-w8|weekly-expired');
    expect(result.stdout).toContain('delete|budget-live-m12|monthly-expired');
  });

  it('never proposes deletion for unverified or non-live-prefix recovery points', () => {
    const { base, env } = makeBackupFixture();
    const index = join(base, 'unsafe-retention.index');
    writeFileSync(
      index,
      [
        'budget-live-newest|2026-09-09T02:15:00Z|daily|normal|verified',
        'budget-live-unverified|2026-01-01T02:15:00Z|daily|normal|unverified',
        'sandooq-old|2025-01-01T02:15:00Z|daily|normal|verified',
        '',
      ].join('\n'),
    );

    const result = run('retention-plan', env, [index]);

    expect(result.status).toBe(73);
    expect(result.stderr).toContain('retention index contains an unsafe prefix');
    expect(result.stdout).not.toContain('delete|');
  });

  it.each([
    [
      'duplicate',
      [
        'budget-live-same|2026-09-06T02:15:00Z|weekly|normal|verified',
        'budget-live-same|2026-09-06T02:15:00Z|weekly|normal|verified',
      ],
    ],
    [
      'conflicting duplicate',
      [
        'budget-live-same|2026-09-06T02:15:00Z|weekly|normal|verified',
        'budget-live-same|2026-09-01T02:15:00Z|monthly|pinned|unverified',
      ],
    ],
  ])('rejects %s recovery IDs before emitting a plan', (_label, rows) => {
    const { base, env } = makeBackupFixture();
    const index = join(base, 'duplicate-retention.index');
    writeFileSync(index, `${rows.join('\n')}\n`);

    const result = run('retention-plan', env, [index]);

    expect(result.status).toBe(73);
    expect(result.stderr).toContain('duplicate recovery ID');
    expect(result.stdout).toBe('');
  });

  it.each([
    ['2026-02-30T02:15:00Z', 'daily'],
    ['2026-09-07T02:15:00Z', 'weekly'],
    ['2026-09-02T02:15:00Z', 'monthly'],
  ])('rejects invalid UTC/tier eligibility %s %s', (timestamp, tier) => {
    const { base, env } = makeBackupFixture();
    const index = join(base, 'invalid-date-retention.index');
    writeFileSync(
      index,
      `budget-live-invalid|${timestamp}|${tier}|normal|verified\n`,
    );

    const result = run('retention-plan', env, [index]);

    expect(result.status).toBe(73);
    expect(result.stderr).toContain(
      'UTC retention date or tier eligibility is invalid',
    );
    expect(result.stdout).toBe('');
  });
});
