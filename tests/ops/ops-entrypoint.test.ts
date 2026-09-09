import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('operations verification entrypoint', () => {
  it('exposes the bounded ops gate without replacing existing checks', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['check:ops']).toBe(
      'bash scripts/ops/check-budget.sh',
    );
    expect(packageJson.scripts.check).toBe(
      'pnpm typecheck && pnpm test:db && pnpm test:ui && pnpm build',
    );
  });

  it('statically checks every ops script and scans bounded tracked text files', () => {
    const check = readFileSync('scripts/ops/check-budget.sh', 'utf8');

    expect(check).toContain('bash -n');
    expect(check).toContain('vitest run tests/ops');
    expect(check).toContain('git ls-files');
    expect(check).toContain('budget_scan_secrets');
    expect(check).toContain('BUDGET_MAX_SCAN_FILES');
  });

  it('scans explicitly supplied bounded artifact and log files', () => {
    const base = mkdtempSync(join(realpathSync(tmpdir()), 'budget-ops-scan-'));
    const artifact = join(base, 'release-artifact.js');
    const log = join(base, 'operation.log');
    const secret = 'fixture-secret-must-not-print';
    writeFileSync(artifact, 'const safe = true;\n');
    writeFileSync(log, `DB_PASSWORD=${secret}\n`);

    const result = spawnSync(
      'bash',
      ['scripts/ops/check-budget.sh', artifact, log],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, BUDGET_OPS_STATIC_ONLY: '1' },
      },
    );

    expect(result.status).toBe(69);
    expect(result.stderr).toContain('secret material detected in operation.log');
    expect(result.stderr).not.toContain(secret);
  });
});
