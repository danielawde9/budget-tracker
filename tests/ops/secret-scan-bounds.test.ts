import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const common = join(process.cwd(), 'scripts/ops/budget-common.sh');
const check = join(process.cwd(), 'scripts/ops/check-budget.sh');
const MEBIBYTE = 1_048_576;
const scanDirectories: string[] = [];

function scanDirectory() {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'budget-ops-scan-bounds-'));
  scanDirectories.push(base);
  return base;
}

function writeCleanFiles(base: string, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const path = join(base, `clean-${index}.ts`);
    writeFileSync(path, `export const value${index} = ${index};\n`);
    return path;
  });
}

function writeSparseFile(path: string, bytes: number) {
  writeFileSync(path, '');
  truncateSync(path, bytes);
  return path;
}

function scan(candidates: readonly string[]) {
  return spawnSync('bash', [common, 'scan-secrets', ...candidates], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env },
  });
}

afterEach(() => {
  for (const base of scanDirectories.splice(0)) {
    rmSync(base, { recursive: true, force: true });
  }
});

describe('bounded secret scan', () => {
  it('keeps check:ops green when normal growth adds hundreds of text files', () => {
    const extraFiles = writeCleanFiles(scanDirectory(), 300);

    const result = spawnSync('bash', [check, ...extraFiles], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, BUDGET_OPS_STATIC_ONLY: '1' },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Budget ops verification passed');
  });

  it('admits 4096 candidates and refuses 4097 before reading any of them', () => {
    const base = scanDirectory();
    const secretFile = join(base, 'first.env.example');
    writeFileSync(secretFile, 'DB_PASSWORD=fixture-count-secret\n');
    const missing = Array.from({ length: 4096 }, (_, index) =>
      join(base, `missing-${index}.ts`),
    );

    const atBound = scan([secretFile, ...missing.slice(1)]);
    const overBound = scan([secretFile, ...missing]);

    expect(atBound.status).toBe(69);
    expect(atBound.stderr).toContain('secret material detected in first.env.example');
    expect(overBound.status).toBe(64);
    expect(overBound.stderr).toContain('secret scan requires 1 to 4096 explicit files');
    expect(overBound.stderr).not.toContain('secret material detected');
  });

  it('admits a 64 MiB scan plan and refuses one byte more before reading any content', () => {
    const base = scanDirectory();
    const secretLine = 'DB_PASSWORD=fixture-total-secret\n';
    const secretFile = join(base, 'first.env.example');
    writeFileSync(secretFile, secretLine);
    const tenMebibyteFiles = Array.from({ length: 6 }, (_, index) =>
      writeSparseFile(join(base, `filler-${index}.log`), 10 * MEBIBYTE),
    );
    const remainder = 4 * MEBIBYTE - Buffer.byteLength(secretLine);
    const lastAtBound = writeSparseFile(join(base, 'last-at-bound.log'), remainder);
    const lastOverBound = writeSparseFile(join(base, 'last-over-bound.log'), remainder + 1);

    const atBound = scan([secretFile, ...tenMebibyteFiles, lastAtBound]);
    const overBound = scan([secretFile, ...tenMebibyteFiles, lastOverBound]);

    expect(atBound.status).toBe(69);
    expect(atBound.stderr).toContain('secret material detected in first.env.example');
    expect(overBound.status).toBe(64);
    expect(overBound.stderr).toContain('secret scan exceeds the 67108864-byte total bound');
    expect(overBound.stderr).not.toContain('secret material detected');
  });

  it('keeps the 10 MiB per-file bound', () => {
    const base = scanDirectory();
    const secretLine = 'DB_PASSWORD=fixture-large-file-secret\n';
    const padded = (bytes: number) =>
      `${secretLine}${'x'.repeat(bytes - Buffer.byteLength(secretLine))}`;
    const atBound = join(base, 'at-bound.log');
    const overBound = join(base, 'over-bound.log');
    writeFileSync(atBound, padded(10 * MEBIBYTE));
    writeFileSync(overBound, padded(10 * MEBIBYTE + 1));

    const admitted = scan([atBound]);
    const refused = scan([overBound]);

    expect(admitted.status).toBe(69);
    expect(admitted.stderr).toContain('secret material detected in at-bound.log');
    expect(refused.status).toBe(64);
    expect(refused.stderr).toContain('secret scan candidate is not a bounded regular file');
    expect(refused.stderr).not.toContain('secret material detected');
  });

  it('stops reading candidates once the whole-scan deadline expires', () => {
    const base = scanDirectory();
    const cleanFiles = writeCleanFiles(base, 2048);
    const secretFile = join(base, 'last.env.example');
    writeFileSync(secretFile, 'DB_PASSWORD=fixture-late-secret\n');

    const result = spawnSync(
      'bash',
      [
        '-c',
        'source "$1"; shift; deadline="$(budget_start_deadline 1)"; budget_scan_secrets_before_deadline "$deadline" "$@"',
        'scan-deadline-test',
        common,
        ...cleanFiles,
        secretFile,
      ],
      { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env } },
    );

    expect(result.status).toBe(64);
    expect(result.stderr).toContain('secret scan deadline exceeded');
    expect(result.stderr).not.toContain('secret material detected');
  });

  it('refuses a malformed scan deadline before reading any candidate', () => {
    const base = scanDirectory();
    const secretFile = join(base, 'first.env.example');
    writeFileSync(secretFile, 'DB_PASSWORD=fixture-deadline-secret\n');

    const result = spawnSync(
      'bash',
      [
        '-c',
        'source "$1"; budget_scan_secrets_before_deadline "12x" "$2"',
        'scan-deadline-test',
        common,
        secretFile,
      ],
      { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env } },
    );

    expect(result.status).toBe(64);
    expect(result.stderr).toContain('secret scan deadline is invalid');
    expect(result.stderr).not.toContain('secret material detected');
  });

  it('reports the scanned file count and byte total so bound headroom stays visible', () => {
    const base = scanDirectory();
    const first = join(base, 'first.md');
    const second = join(base, 'second.ts');
    writeFileSync(first, '# Notes\n');
    writeFileSync(second, 'export {};\n');

    const result = scan([first, second]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('secret scan passed for 2 file(s), 19 byte(s)\n');
  });
});
