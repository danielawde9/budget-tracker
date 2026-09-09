import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts/ops/migrate-budget.sh');
const sourceSha = '41504561b7f6fdf3f1321fa38a025673eb0d9f0d';

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'budget-ops-migrations-'));
  const migrations = join(base, 'migrations');
  const expected = join(base, 'expected.manifest');
  const applied = join(base, 'applied.txt');
  mkdirSync(migrations, { mode: 0o700 });
  writeFileSync(join(migrations, '20260901000000_first.sql'), 'select 1;\n');
  writeFileSync(join(migrations, '20260902000000_second.sql'), 'select 2;\n');
  writeFileSync(applied, '20260901000000\n20260902000000\n');
  return { applied, base, expected, migrations };
}

function hash(contents: string) {
  return createHash('sha256').update(contents).digest('hex');
}

function writeExpected(path: string) {
  writeFileSync(
    path,
    [
      'budget_migration_manifest_version=1',
      `source_sha=${sourceSha}`,
      `20260901000000|20260901000000_first.sql|${hash('select 1;\n')}`,
      `20260902000000|20260902000000_second.sql|${hash('select 2;\n')}`,
      '',
    ].join('\n'),
  );
}

function addThirdMigration(migrations: string, expected: string) {
  writeFileSync(join(migrations, '20260903000000_third.sql'), 'select 3;\n');
  writeFileSync(
    expected,
    [
      'budget_migration_manifest_version=1',
      `source_sha=${sourceSha}`,
      `20260901000000|20260901000000_first.sql|${hash('select 1;\n')}`,
      `20260902000000|20260902000000_second.sql|${hash('select 2;\n')}`,
      `20260903000000|20260903000000_third.sql|${hash('select 3;\n')}`,
      '',
    ].join('\n'),
  );
}

function run(args: string[]) {
  return spawnSync('bash', [script, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env },
  });
}

describe('forward-only migration manifest gate', () => {
  it('creates a deterministic version/name/SHA-256 manifest', () => {
    const { expected, migrations } = fixture();
    const result = run(['create-manifest', migrations, expected, sourceSha]);

    expect(result.status).toBe(0);
    expect(readFileSync(expected, 'utf8')).toBe(
      [
        'budget_migration_manifest_version=1',
        `source_sha=${sourceSha}`,
        `20260901000000|20260901000000_first.sql|${hash('select 1;\n')}`,
        `20260902000000|20260902000000_second.sql|${hash('select 2;\n')}`,
        '',
      ].join('\n'),
    );
  });

  it('rejects duplicate migration versions', () => {
    const { expected, migrations } = fixture();
    writeFileSync(join(migrations, '20260901000000_duplicate.sql'), 'select 3;\n');
    const result = run(['create-manifest', migrations, expected, sourceSha]);

    expect(result.status).toBe(79);
    expect(result.stderr).toContain('duplicate migration version');
  });

  it('rejects a changed applied migration file', () => {
    const { applied, expected, migrations } = fixture();
    writeExpected(expected);
    writeFileSync(join(migrations, '20260901000000_first.sql'), 'select 99;\n');
    const result = run([
      'verify-manifest',
      migrations,
      expected,
      applied,
      sourceSha,
    ]);

    expect(result.status).toBe(79);
    expect(result.stderr).toContain('changed migration file');
  });

  it('rejects a missing migration file', () => {
    const { applied, expected, migrations } = fixture();
    writeExpected(expected);
    rmSync(join(migrations, '20260902000000_second.sql'));
    const result = run([
      'verify-manifest',
      migrations,
      expected,
      applied,
      sourceSha,
    ]);

    expect(result.status).toBe(79);
    expect(result.stderr).toContain('missing migration file');
  });

  it('rejects an unmanifested local migration file', () => {
    const { applied, expected, migrations } = fixture();
    writeExpected(expected);
    writeFileSync(join(migrations, '20260903000000_third.sql'), 'select 3;\n');
    const result = run([
      'verify-manifest',
      migrations,
      expected,
      applied,
      sourceSha,
    ]);

    expect(result.status).toBe(79);
    expect(result.stderr).toContain('unmanifested migration file');
  });

  it('rejects a gap in applied migration history', () => {
    const { applied, expected, migrations } = fixture();
    addThirdMigration(migrations, expected);
    writeFileSync(applied, '20260901000000\n20260903000000\n');
    const result = run([
      'verify-manifest',
      migrations,
      expected,
      applied,
      sourceSha,
    ]);

    expect(result.status).toBe(79);
    expect(result.stderr).toContain('ordered prefix');
  });

  it('rejects out-of-order applied migration history', () => {
    const { applied, expected, migrations } = fixture();
    writeExpected(expected);
    writeFileSync(applied, '20260902000000\n20260901000000\n');
    const result = run([
      'verify-manifest',
      migrations,
      expected,
      applied,
      sourceSha,
    ]);

    expect(result.status).toBe(79);
    expect(result.stderr).toContain('ordered prefix');
  });

  it('rejects an unterminated final row that creates a gap', () => {
    const { applied, expected, migrations } = fixture();
    addThirdMigration(migrations, expected);
    writeFileSync(applied, '20260901000000\n20260903000000');
    const result = run([
      'verify-manifest',
      migrations,
      expected,
      applied,
      sourceSha,
    ]);

    expect(result.status).toBe(79);
    expect(result.stderr).toContain('ordered prefix');
  });

  it('rejects an unknown applied migration row', () => {
    const { applied, expected, migrations } = fixture();
    writeExpected(expected);
    writeFileSync(applied, '20260901000000\n20260909999999\n');
    const result = run([
      'verify-manifest',
      migrations,
      expected,
      applied,
      sourceSha,
    ]);

    expect(result.status).toBe(79);
    expect(result.stderr).toContain('unknown applied migration row');
  });

  it('rejects an unknown unterminated final applied row', () => {
    const { applied, expected, migrations } = fixture();
    writeExpected(expected);
    writeFileSync(applied, '20260901000000\n20260909999999');
    const result = run([
      'verify-manifest',
      migrations,
      expected,
      applied,
      sourceSha,
    ]);

    expect(result.status).toBe(79);
    expect(result.stderr).toContain('unknown applied migration row');
  });

  it('rejects a duplicate applied migration row', () => {
    const { applied, expected, migrations } = fixture();
    writeExpected(expected);
    writeFileSync(applied, '20260901000000\n20260901000000\n');
    const result = run([
      'verify-manifest',
      migrations,
      expected,
      applied,
      sourceSha,
    ]);

    expect(result.status).toBe(79);
    expect(result.stderr).toContain('duplicate applied migration row');
  });

  it('accepts empty applied migration history', () => {
    const { applied, expected, migrations } = fixture();
    writeExpected(expected);
    writeFileSync(applied, '');
    const result = run([
      'verify-manifest',
      migrations,
      expected,
      applied,
      sourceSha,
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('verified 2 migration files and 0 applied rows');
  });

  it('accepts an ordered prefix of applied migration history', () => {
    const { applied, expected, migrations } = fixture();
    writeExpected(expected);
    writeFileSync(applied, '20260901000000\n');
    const result = run([
      'verify-manifest',
      migrations,
      expected,
      applied,
      sourceSha,
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('verified 2 migration files and 1 applied rows');
  });

  it('accepts an unterminated ordered prefix', () => {
    const { applied, expected, migrations } = fixture();
    writeExpected(expected);
    writeFileSync(applied, '20260901000000');
    const result = run([
      'verify-manifest',
      migrations,
      expected,
      applied,
      sourceSha,
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('verified 2 migration files and 1 applied rows');
  });

  it('rejects applied history over the physical-line bound', () => {
    const { applied, expected, migrations } = fixture();
    writeExpected(expected);
    writeFileSync(applied, '\n'.repeat(257));
    const result = run([
      'verify-manifest',
      migrations,
      expected,
      applied,
      sourceSha,
    ]);

    expect(result.status).toBe(79);
    expect(result.stderr).toContain('applied migration rows exceed 256 lines');
  });

  it('rejects applied history over the byte bound', () => {
    const { applied, expected, migrations } = fixture();
    writeExpected(expected);
    writeFileSync(applied, '1'.repeat(4097));
    const result = run([
      'verify-manifest',
      migrations,
      expected,
      applied,
      sourceSha,
    ]);

    expect(result.status).toBe(79);
    expect(result.stderr).toContain('applied migration rows file is invalid or unbounded');
  });

  it('rejects a manifest over the physical-line bound', () => {
    const { applied, expected, migrations } = fixture();
    writeExpected(expected);
    writeFileSync(expected, `${readFileSync(expected, 'utf8')}${'\n'.repeat(300)}`);
    const result = run([
      'verify-manifest',
      migrations,
      expected,
      applied,
      sourceSha,
    ]);

    expect(result.status).toBe(79);
    expect(result.stderr).toContain('migration manifest exceeds 258 lines');
  });

  it('rejects a manifest over the byte bound', () => {
    const { applied, expected, migrations } = fixture();
    writeFileSync(expected, '1'.repeat(131073));
    const result = run([
      'verify-manifest',
      migrations,
      expected,
      applied,
      sourceSha,
    ]);

    expect(result.status).toBe(79);
    expect(result.stderr).toContain('migration manifest is invalid or unbounded');
  });

  it('rejects the wrong source SHA before checking migration files', () => {
    const { applied, expected, migrations } = fixture();
    writeExpected(expected);
    const result = run([
      'verify-manifest',
      migrations,
      expected,
      applied,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ]);

    expect(result.status).toBe(79);
    expect(result.stderr).toContain('source SHA mismatch');
  });

  it('accepts full applied migration history without database access', () => {
    const { applied, expected, migrations } = fixture();
    writeExpected(expected);
    const result = run([
      'verify-manifest',
      migrations,
      expected,
      applied,
      sourceSha,
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('verified 2 migration files and 2 applied rows');
  });
});
