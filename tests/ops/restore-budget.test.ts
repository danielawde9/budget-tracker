import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeRestoreFixture } from './ops-fixture.js';

const script = join(process.cwd(), 'scripts/ops/restore-budget.sh');

function run(command: string, env: NodeJS.ProcessEnv) {
  return spawnSync('bash', [script, command], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
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

describe('scratch-only Budget restore boundary', () => {
  it('defaults to scratch and dry-runs without filesystem, database, or network mutation', () => {
    const { env, log, scratchRoot } = makeRestoreFixture();
    const before = readdirSync(scratchRoot);
    const withoutTarget = { ...env };
    delete withoutTarget.BUDGET_RESTORE_TARGET;
    const result = run('dry-run', withoutTarget);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('restore_target=scratch');
    expect(result.stdout).toContain('BLOCKED until measured scratch restore');
    expect(readdirSync(scratchRoot)).toEqual(before);
    expect(existsSync(log)).toBe(false);
  });

  it('refuses an unsafe live restore before any tool runs', () => {
    const { env, log } = makeRestoreFixture();
    const result = run('restore', {
      ...env,
      BUDGET_RESTORE_TARGET: 'live',
      BUDGET_INCIDENT_ID: '',
      BUDGET_LIVE_RESTORE_CONFIRM: '',
      BUDGET_LIVE_APP_STOPPED: '0',
      BUDGET_PRE_RESTORE_BACKUP_VERIFIED: '0',
      BUDGET_OWNER_APPROVAL_ID: '',
    });

    expect(result.status).toBe(74);
    expect(result.stderr).toContain('live restore safety prerequisites are incomplete');
    expect(existsSync(log)).toBe(false);
  });

  it.each([
    ['BUDGET_AGE_IDENTITY_FILE', 'restore age identity is not configured'],
    ['BUDGET_OFFSITE_DESTINATION', 'off-site destination is not configured'],
    ['BUDGET_EXPECTED_MANIFEST_SHA256', 'trusted manifest hash is not configured'],
  ])('refuses missing %s before fetching', (key, message) => {
    const { env, log } = makeRestoreFixture();
    const result = run('restore', { ...env, [key]: '' });

    expect(result.status).toBe(75);
    expect(result.stderr).toContain(message);
    expect(existsSync(log)).toBe(false);
  });

  it.each([
    '/absolute',
    '-leading-dash',
    'configured-budget-live-offsite/*',
    'configured-budget-live-offsite/../escape',
    'configured-budget-live-offsite/./object',
    'configured-budget-live-offsite//object',
    'configured-budget-live-offsite\nobject',
    'unknown-prefix',
  ])('refuses unsafe or unknown off-site destination %j', (destination) => {
    const { env, log } = makeRestoreFixture();
    const result = run('restore', {
      ...env,
      BUDGET_OFFSITE_DESTINATION: destination,
    });

    expect(result.status).toBe(75);
    expect(result.stderr).toContain('off-site destination is outside the exact allowlist');
    expect(existsSync(log)).toBe(false);
  });

  it('refuses an age identity file that is not mode 0600', () => {
    const { env, identity, log } = makeRestoreFixture();
    chmodSync(identity, 0o644);
    const result = run('restore', env);

    expect(result.status).toBe(75);
    expect(result.stderr).toContain('secret file must be mode 0600');
    expect(existsSync(log)).toBe(false);
  });

  it('refuses a protected database endpoint before fetching or restoring', () => {
    const { env, log } = makeRestoreFixture();
    const result = run('restore', {
      ...env,
      BUDGET_DATABASE_HOST: 'pos.internal',
    });

    expect(result.status).toBe(75);
    expect(result.stderr).toContain('protected Sandooq/POS database identifier');
    expect(existsSync(log)).toBe(false);
  });

  it('rejects /usr/bin/true as restore PostgreSQL tooling', () => {
    const { env, log } = makeRestoreFixture();
    const result = run('restore', {
      ...env,
      BUDGET_PSQL_BIN: '/usr/bin/true',
    });

    expect(result.status).toBe(75);
    expect(result.stderr).toContain('placeholder PostgreSQL executable refused');
    expect(existsSync(log)).toBe(false);
  });

  it('rejects missing/wrong scratch markers and a reused live system identifier', () => {
    const first = makeRestoreFixture();
    unlinkSync(first.scratchMarker);
    const missing = run('restore', first.env);

    const second = makeRestoreFixture();
    writeFileSync(second.scratchMarker, 'budget-restore-marker-v1\ntarget=live\n');
    const wrong = run('restore', second.env);

    const third = makeRestoreFixture();
    writeFileSync(
      third.scratchMarker,
      [
        'budget-restore-marker-v1',
        'target=scratch',
        'project=budget-restore-scratch',
        'system_id=7000000000000000001',
        '',
      ].join('\n'),
    );
    const reused = run('restore', {
      ...third.env,
      BUDGET_SCRATCH_EXPECTED_SYSTEM_ID: '7000000000000000001',
    });

    expect(missing.status).toBe(76);
    expect(missing.stderr).toContain('scratch marker is missing');
    expect(wrong.status).toBe(76);
    expect(wrong.stderr).toContain('scratch marker identity mismatch');
    expect(reused.status).toBe(76);
    expect(reused.stderr).toContain('scratch system identifier must differ from live');
  });

  it('refuses non-empty scratch and insufficient scratch space', () => {
    const first = makeRestoreFixture();
    const nonempty = run('restore', {
      ...first.env,
      BUDGET_FAKE_VERIFY_RELATION_COUNT: '1',
    });
    const second = makeRestoreFixture();
    const lowSpace = run('restore', {
      ...second.env,
      BUDGET_SCRATCH_AVAILABLE_BYTES: '1023',
    });

    expect(nonempty.status).toBe(76);
    expect(nonempty.stderr).toContain('measured scratch database is not empty');
    expect(lowSpace.status).toBe(76);
    expect(lowSpace.stderr).toContain('insufficient scratch restore space');
  });

  it('uses a nonblocking scratch restore lock', () => {
    const { env, log, scratchRoot } = makeRestoreFixture();
    mkdirSync(join(scratchRoot, 'locks', 'restore-scratch.lock'), {
      recursive: true,
    });
    const result = run('restore', env);

    expect(result.status).toBe(77);
    expect(result.stderr).toContain('restore is already running');
    expect(existsSync(log)).toBe(false);
  });

  it('rejects a ciphertext hash mismatch before decrypt or database restore', () => {
    const { env, log, offsiteRoot, recoveryPoint } = makeRestoreFixture();
    writeFileSync(
      join(offsiteRoot, recoveryPoint, 'archive.dump.age'),
      'tampered archive\n',
    );
    const result = run('restore', env);
    const commands = readFileSync(log, 'utf8');

    expect(result.status).toBe(78);
    expect(result.stderr).toContain('ciphertext hash mismatch');
    expect(commands).toContain('offsite:get');
    expect(commands).not.toContain('age');
    expect(commands).not.toContain('pg_restore');
  });

  it('rejects a manifest that differs from the trusted receipt before decrypt or restore', () => {
    const { env, log, offsiteRoot, recoveryPoint } = makeRestoreFixture();
    const manifestPath = join(offsiteRoot, recoveryPoint, 'manifest.txt');
    writeFileSync(manifestPath, `${readFileSync(manifestPath, 'utf8')}tampered=yes\n`);
    const result = run('restore', env);
    const commands = readFileSync(log, 'utf8');

    expect(result.status).toBe(78);
    expect(result.stderr).toContain('trusted manifest hash mismatch');
    expect(commands).not.toContain('age');
    expect(commands).not.toContain('pg_restore');
  });

  it('bounds fetch/decrypt/restore, filters roles, and requires the comparison hook', () => {
    const { env, log } = makeRestoreFixture();
    const result = run('restore', env);
    const commands = readFileSync(log, 'utf8');

    expect(result.status).toBe(0);
    expect(commands.match(/offsite:get/g)).toHaveLength(4);
    expect(commands.match(/db-verify:/g)).toHaveLength(2);
    expect(commands.match(/timeout:[0-9]+:age/g)).toHaveLength(3);
    expect(commands).toMatch(/timeout:[0-9]+:pg_restore\n/);
    expect(commands).toMatch(/timeout:[0-9]+:psql\n/);
    expect(commands).toContain('role-filter');
    expect(commands).toMatch(/timeout:[0-9]+:compare\n/);
    expect(result.stdout).toContain('scratch restore comparison verified');
    expectShrinkingDeadline(commands, 3600);
  });

  it('rechecks scratch identity and emptiness immediately before database effects', () => {
    const { env, log } = makeRestoreFixture();
    const result = run('restore', {
      ...env,
      BUDGET_FAKE_VERIFY_SECOND_SYSTEM_ID: '8000000000000000999',
    });

    expect(result.status).toBe(76);
    expect(result.stderr).toContain('scratch identity changed before restore');
    const commands = readFileSync(log, 'utf8').trimEnd().split('\n');
    expect(commands).not.toContain('psql');
    expect(commands).not.toContain('pg_restore');
  });

  it('rejects an archive owner outside the target-role manifest before psql', () => {
    const { env, log } = makeRestoreFixture();
    const result = run('restore', {
      ...env,
      BUDGET_FAKE_TOC_OWNER: 'unapproved_owner',
    });

    expect(result.status).toBe(79);
    expect(result.stderr).toContain('archive owner or SQL grantee is not allowlisted');
    const commands = readFileSync(log, 'utf8').trimEnd().split('\n');
    expect(commands).not.toContain('psql');
  });

  it('rejects a scratch marker swapped after validation before restore effects', () => {
    const { env, log, scratchMarker } = makeRestoreFixture();
    const result = run('restore', {
      ...env,
      BUDGET_FAKE_SWAP_MARKER_PATH: scratchMarker,
    });

    expect(result.status).toBe(76);
    expect(result.stderr).toContain('scratch marker is unsafe');
    const commands = readFileSync(log, 'utf8').trimEnd().split('\n');
    expect(commands).not.toContain('psql');
    expect(commands).not.toContain('pg_restore');
  });

  it('removes decrypted plaintext after a restore failure', () => {
    const { env, log, scratchRoot } = makeRestoreFixture();
    const result = run('restore', {
      ...env,
      BUDGET_FAKE_RESTORE_FAIL: '1',
    });

    expect(result.status).toBe(19);
    expect(readFileSync(log, 'utf8')).toContain('pg_restore');
    expect(
      existsSync(join(scratchRoot, 'tmp/2026-09-09T021500Z-fixture.restore')),
    ).toBe(false);
  });
});
