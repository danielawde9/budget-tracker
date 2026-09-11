import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts/ops/migrate-budget.sh');
const sourceSha = '41504561b7f6fdf3f1321fa38a025673eb0d9f0d';
const liveReleaseHead = 'e5bfd7441043a5d2c1672d5545f7fb34cb7e4741';
const liveManifest = join(process.cwd(), 'ops/budget-migrations.sha256');

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

function writeReversedExpected(path: string) {
  writeFileSync(
    path,
    [
      'budget_migration_manifest_version=1',
      `source_sha=${sourceSha}`,
      `20260902000000|20260902000000_second.sql|${hash('select 2;\n')}`,
      `20260901000000|20260901000000_first.sql|${hash('select 1;\n')}`,
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
  it('pins the merged wallet lifecycle release as 33 immutable migrations', () => {
    const rows = readFileSync(liveManifest, 'utf8').trimEnd().split('\n');
    const migrationRows = rows.slice(2);
    const localMigrationNames = readdirSync(join(process.cwd(), 'supabase/migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort();

    expect(rows[0]).toBe('budget_migration_manifest_version=1');
    expect(rows[1]).toBe(`source_sha=${liveReleaseHead}`);
    expect(migrationRows).toHaveLength(33);
    expect(migrationRows.some((row) =>
      row.startsWith('20260908170000|20260908170000_household_membership_schema.sql|'),
    )).toBe(true);
    expect(migrationRows.at(-1)).toMatch(
      /^20260911100000\|20260911100000_wallet_lifecycle_commands\.sql\|[a-f0-9]{64}$/,
    );
    expect(migrationRows.map((row) => row.split('|')[1])).toEqual(localMigrationNames);

    for (const row of migrationRows) {
      const [version, filename, expectedHash, extra] = row.split('|');
      expect(extra).toBeUndefined();
      expect(filename).toMatch(new RegExp(`^${version}_[A-Za-z0-9_-]+\\.sql$`));
      expect(createHash('sha256')
        .update(readFileSync(join(process.cwd(), 'supabase/migrations', filename!), 'utf8'))
        .digest('hex')).toBe(expectedHash);
    }
  });

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

  it('rejects a reversed manifest with matching reversed applied history', () => {
    const { applied, expected, migrations } = fixture();
    writeReversedExpected(expected);
    writeFileSync(applied, '20260902000000\n20260901000000\n');
    const result = run([
      'verify-manifest',
      migrations,
      expected,
      applied,
      sourceSha,
    ]);

    expect(result.status).toBe(79);
    expect(result.stderr).toContain('manifest versions are not strictly increasing');
  });

  it('rejects a reversed manifest with empty applied history', () => {
    const { applied, expected, migrations } = fixture();
    writeReversedExpected(expected);
    writeFileSync(applied, '');
    const result = run([
      'verify-manifest',
      migrations,
      expected,
      applied,
      sourceSha,
    ]);

    expect(result.status).toBe(79);
    expect(result.stderr).toContain('manifest versions are not strictly increasing');
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
