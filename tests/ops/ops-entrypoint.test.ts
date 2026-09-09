import { readFileSync } from 'node:fs';

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
});
