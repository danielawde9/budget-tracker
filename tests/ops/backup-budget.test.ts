import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeBackupFixture, makeExecutable } from './ops-fixture.js';

const script = join(process.cwd(), 'scripts/ops/backup-budget.sh');

function run(
  command: string,
  env: NodeJS.ProcessEnv,
  extraArgs: string[] = [],
  timeout?: number,
) {
  return spawnSync('bash', [script, command, ...extraArgs], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
    timeout,
  });
}

function expectShrinkingDeadline(commandLog: string, maximum: number) {
  const budgets = [...commandLog.matchAll(/^timeout:([0-9]+):/gm)].map(
    (match) => Number(match[1]),
  );
  expect(budgets.length).toBeGreaterThan(0);
  expect(budgets[0]).toBeLessThanOrEqual(maximum);
  for (let position = 1; position < budgets.length; position += 1) {
    expect(budgets[position]!).toBeLessThanOrEqual(budgets[position - 1]!);
  }
}

async function runAndTerminate(env: NodeJS.ProcessEnv) {
  const child = spawn('bash', [script, 'backup'], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  const completion = new Promise<{ signal: NodeJS.Signals | null; status: number | null }>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('close', (status, signal) => resolve({ signal, status }));
    },
  );
  const marker = env.BUDGET_FAKE_SIGNAL_MARKER as string;
  let completed = false;
  void completion.then(() => { completed = true; });
  for (
    let attempt = 0;
    attempt < 1_000 && !completed && !existsSync(marker);
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!existsSync(marker)) {
    if (!completed) child.kill('SIGKILL');
    const early = await completion;
    throw new Error(
      `backup signal fixture did not reach pg_dump: status=${early.status} signal=${early.signal}`,
    );
  }
  child.kill('SIGTERM');
  return { ...(await completion), stderr, stdout };
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
    expect(result.stderr).toContain('private input snapshot validation failed');
    expect(existsSync(log)).toBe(false);
  });

  it('rejects a pgpass symlink before any database or backup effect', () => {
    const { base, env, log, passfile } = makeBackupFixture();
    const target = join(base, 'pgpass-target');
    writeFileSync(target, readFileSync(passfile), { mode: 0o600 });
    unlinkSync(passfile);
    symlinkSync(target, passfile);

    const result = run('backup', env);

    expect(result.status).toBe(70);
    expect(result.stderr).toContain('private input snapshot validation failed');
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
    mkdirSync(join(root, 'locks', 'backup-live.lock'), {
      recursive: true,
      mode: 0o700,
    });
    const result = run('backup', env);

    expect(result.status).toBe(72);
    expect(result.stderr).toContain('backup is already running');
    expect(existsSync(log)).toBe(false);
  });

  it('dry-run validates configuration without filesystem, database, or network mutation', () => {
    const { env, root, log } = makeBackupFixture();
    const before = readdirSync(root);
    const result = run('dry-run', env);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('BLOCKED until configured off-site proof');
    expect(readdirSync(root)).toEqual(before);
    expect(existsSync(log)).toBe(false);
  });

  it('bounds dump and packaging tools, encrypts every payload, verifies off-site, and writes ciphertext hashes', () => {
    const { env, log, pgDumpArgsLog, pgDumpallArgsLog, root } = makeBackupFixture();
    const result = run('backup', env);
    const recoveryPoint = join(
      root,
      'backups/live/2026-09-09T021500Z-fixture',
    );
    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
    const commandLog = readFileSync(log, 'utf8');
    const manifest = readFileSync(join(recoveryPoint, 'manifest.txt'), 'utf8');
    expect(commandLog).toMatch(/timeout:[0-9]+:exec-01-pg_dump\n/);
    expect(commandLog.match(/db-verify:/g)).toHaveLength(2);
    expect(commandLog).toMatch(/timeout:[0-9]+:exec-02-pg_dumpall\n/);
    expect(readFileSync(pgDumpArgsLog, 'utf8').trimEnd().split('\n')).toEqual([
      '--no-password',
      '--format=custom',
      '--compress=9',
      expect.stringMatching(/^--file=\/.*\/archive\.dump$/),
      '--host=fixture-budget-db.internal',
      '--port=5432',
      '--username=budget_backup',
      '--dbname=budget',
    ]);
    expect(readFileSync(pgDumpallArgsLog, 'utf8').trimEnd().split('\n')).toEqual([
      '--no-password',
      '--roles-only',
      '--no-role-passwords',
      '--host=fixture-budget-db.internal',
      '--port=5432',
      '--username=budget_backup',
    ]);
    expect(commandLog).toMatch(/timeout:[0-9]+:exec-04-catalog\n/);
    expect(commandLog.match(/timeout:[0-9]+:exec-03-age/g)).toHaveLength(3);
    expect(commandLog.match(/offsite:put/g)).toHaveLength(4);
    expect(commandLog.match(/offsite:verify/g)).toHaveLength(4);
    expect(readdirSync(recoveryPoint).sort()).toEqual([
      'SUCCESS',
      'archive.dump.age',
      'catalog.txt.age',
      'manifest.txt',
      'roles.sql.age',
    ]);
    expect(readFileSync(join(recoveryPoint, 'SUCCESS'), 'utf8')).toContain(
      'provider=fixture-provider',
    );
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
    expect(manifest).toMatch(/source_commit=[a-f0-9]{40}/);
    expect(manifest).toContain('migration_manifest_sha256=');
    expect(manifest).toMatch(/catalog_metadata_sha256=[a-f0-9]{64}/);
    expect(manifest).toMatch(/archive\.dump\.age_size=[1-9][0-9]*/);
    expect(manifest).toMatch(/roles\.sql\.age_size=[1-9][0-9]*/);
    expect(manifest).toMatch(/catalog\.txt\.age_size=[1-9][0-9]*/);
    expect(manifest).not.toContain('fixture-only');
    expectShrinkingDeadline(commandLog, 1800);
  });

  it('rejects /usr/bin/true as PostgreSQL tooling', () => {
    const { env, log } = makeBackupFixture();
    const result = run('backup', {
      ...env,
      BUDGET_PG_DUMP_BIN: '/usr/bin/true',
    });

    expect(result.status).toBe(70);
    expect(result.stderr).toContain('executable snapshot validation failed');
    expect(existsSync(log)).toBe(false);
  });

  it('rejects a PostgreSQL binary changed after its hash was pinned', () => {
    const { env, log, pgDump } = makeBackupFixture();
    appendFileSync(pgDump, '\n# changed after approval\n');

    const result = run('backup', env);

    expect(result.status).toBe(70);
    expect(result.stderr).toContain('executable snapshot validation failed');
    expect(existsSync(log)).toBe(false);
  });

  it('rejects an executable FIFO without opening or hashing it', () => {
    const { base, env, log } = makeBackupFixture();
    const fifo = join(base, 'bin', 'pg-dump-fifo');
    const created = spawnSync('/usr/bin/mkfifo', [fifo], { encoding: 'utf8' });
    expect(created.status).toBe(0);
    chmodSync(fifo, 0o700);
    const startedAt = Date.now();

    const result = run('backup', {
      ...env,
      BUDGET_PG_DUMP_BIN: fifo,
      BUDGET_PG_DUMP_SHA256: 'a'.repeat(64),
    });

    expect(result.status).toBe(70);
    expect(result.stderr).toContain('executable snapshot validation failed');
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(existsSync(log)).toBe(false);
  });

  it('rejects a caller version that differs from the measured binary version', () => {
    const { env, log } = makeBackupFixture();
    const result = run('backup', {
      ...env,
      BUDGET_FAKE_PG_VERSION: '16.9',
    });

    expect(result.status).toBe(70);
    expect(result.stderr).toContain('measured PostgreSQL version mismatch');
    expect(existsSync(log)).toBe(false);
  });

  it('does not accept /usr/bin/true as off-site recovery evidence', () => {
    const { env, root } = makeBackupFixture();
    const result = run('backup', {
      ...env,
      BUDGET_OFFSITE_BIN: '/usr/bin/true',
    });
    const success = join(
      root,
      'backups/live/2026-09-09T021500Z-fixture/SUCCESS',
    );

    expect(result.status).toBe(70);
    expect(result.stderr).toContain('executable snapshot validation failed');
    expect(existsSync(success)).toBe(false);
  });

  it('rejects an unstructured off-site verification receipt', () => {
    const { env, root } = makeBackupFixture();
    const result = run('backup', {
      ...env,
      BUDGET_FAKE_OFFSITE_RECEIPT_INVALID: '1',
    });
    const success = join(
      root,
      'backups/live/2026-09-09T021500Z-fixture/SUCCESS',
    );

    expect(result.status).toBe(70);
    expect(result.stderr).toContain('off-site receipt is invalid');
    expect(existsSync(success)).toBe(false);
  });

  it('rejects a valid off-site receipt followed by an unvalidated record', () => {
    const { env, root } = makeBackupFixture();
    const result = run('backup', {
      ...env,
      BUDGET_FAKE_OFFSITE_RECEIPT_TRAILING: '1',
    });
    const success = join(
      root,
      'backups/live/2026-09-09T021500Z-fixture/SUCCESS',
    );

    expect(result.status).toBe(70);
    expect(result.stderr).toContain('off-site receipt is invalid');
    expect(existsSync(success)).toBe(false);
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

  it('executes the validated pg_dump content after its source path is swapped', () => {
    const { base, env, log, pgDump } = makeBackupFixture();
    const replacement = join(base, 'bin', 'replacement-pg-dump');
    makeExecutable(
      replacement,
      'printf "swapped-pg-dump\\n" >> "$BUDGET_FAKE_LOG"; exit 91',
    );
    const result = run('backup', {
      ...env,
      BUDGET_FAKE_SWAP_EXECUTABLE_PATH: pgDump,
      BUDGET_FAKE_SWAP_EXECUTABLE_REPLACEMENT: replacement,
    });

    expect(result.status, result.stderr).toBe(0);
    const commands = readFileSync(log, 'utf8');
    expect(commands).toContain('pg_dump');
    expect(commands).not.toContain('swapped-pg-dump');
  });

  it('uses the immutable pgpass snapshot after the source path is swapped', () => {
    const { env, log, passfile } = makeBackupFixture();
    const result = run('backup', {
      ...env,
      BUDGET_FAKE_SWAP_PRIVATE_PATH: passfile,
      BUDGET_FAKE_SWAP_PRIVATE_CONTENT: 'malicious:5432:*:*:replacement-only\n',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(log, 'utf8')).toContain('pg_dump');
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

  it('refuses a backups descendant symlink without writing outside the validated root', () => {
    const { base, env, root } = makeBackupFixture();
    const outside = join(base, 'outside-backups');
    mkdirSync(outside, { mode: 0o700 });
    symlinkSync(outside, join(root, 'backups'), 'dir');

    const result = run('backup', env);

    expect(result.status).toBe(66);
    expect(result.stderr).toContain('unsafe Budget descendant');
    expect(
      existsSync(join(outside, 'live/2026-09-09T021500Z-fixture/SUCCESS')),
    ).toBe(false);
  });

  it('rechecks backup descendants immediately before creating recovery files', () => {
    const { base, env, root } = makeBackupFixture();
    const backups = join(root, 'backups');
    const outside = join(base, 'swapped-backups');
    mkdirSync(backups, { mode: 0o700 });
    mkdirSync(outside, { mode: 0o700 });

    const result = run('backup', {
      ...env,
      BUDGET_FAKE_SWAP_DESCENDANT_PATH: backups,
      BUDGET_FAKE_SWAP_DESCENDANT_TARGET: outside,
    });

    expect(result.status).toBe(66);
    expect(result.stderr).toContain('unsafe Budget descendant');
    expect(
      existsSync(join(outside, 'live/2026-09-09T021500Z-fixture/SUCCESS')),
    ).toBe(false);
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
    expect(readFileSync(log, 'utf8')).toMatch(/timeout:[0-9]+:exec-03-age\n/);
    expect(existsSync(join(tempRoot, '2026-09-09T021500Z-fixture.plaintext'))).toBe(
      false,
    );
  });

  it('promotes cleanup failure after an otherwise successful backup', () => {
    const { env } = makeBackupFixture();
    const result = run('backup', {
      ...env,
      BUDGET_FAKE_FORCE_CLEANUP_FAILURE: '1',
    });

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(66);
    expect(result.stderr).toContain('bounded private cleanup failed');
  });

  it('preserves the original backup failure when cleanup also fails', () => {
    const { env } = makeBackupFixture();
    const result = run('backup', {
      ...env,
      BUDGET_FAKE_AGE_FAIL: '1',
      BUDGET_FAKE_FORCE_CLEANUP_FAILURE: '1',
    });

    expect(result.status).toBe(17);
    expect(result.stderr).toContain('bounded private cleanup failed');
  });

  it('returns 143 and cleans private state when TERM arrives during pg_dump', async () => {
    const { env, execDirLog, root } = makeBackupFixture();
    const result = await runAndTerminate({
      ...env,
      BUDGET_FAKE_BLOCK_PG_DUMP: '1',
    });

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(143);
    expect(result.signal).toBeNull();
    expect(existsSync(join(root, 'tmp/2026-09-09T021500Z-fixture.plaintext'))).toBe(false);
    expect(existsSync(join(root, 'locks/backup-live.lock'))).toBe(false);
    expect(existsSync(readFileSync(execDirLog, 'utf8').trim())).toBe(false);
  });

  it('starts the deadline wrapper before opening a replaced payload for size', () => {
    const { env, root } = makeBackupFixture();
    const result = run(
      'backup',
      {
        ...env,
        BUDGET_FAKE_OFFSITE_REPLACE_PAYLOAD_WITH_FIFO: '1',
        BUDGET_FAKE_TIMEOUT_REFUSE_WC: '1',
      },
      [],
      10_000,
    );

    expect(result.status).toBe(70);
    expect(result.signal).toBeNull();
    expect(result.stderr).toContain('bounded size measurement failed');
    expect(readFileSync(script, 'utf8')).not.toContain('wc -c <');
    expect(
      existsSync(join(root, 'backups/live/2026-09-09T021500Z-fixture')),
    ).toBe(false);
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
