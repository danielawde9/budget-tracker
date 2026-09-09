import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Cloudflare deployment contract', () => {
  it('uses a pinned local Wrangler and explicit repository scripts', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));

    expect(packageJson.devDependencies.wrangler).toBe('4.130.0');
    expect(packageJson.scripts['deploy:cloudflare:dry-run']).toBe(
      'pnpm exec wrangler deploy --dry-run',
    );
    expect(packageJson.scripts['deploy:cloudflare']).toBe('pnpm exec wrangler deploy');
    expect(JSON.stringify(packageJson)).not.toContain('npx wrangler');
  });

  it('serves only the Vite build with SPA fallback handling', () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), 'wrangler.jsonc'), 'utf8'));

    expect(config).toEqual({
      $schema: './node_modules/wrangler/config-schema.json',
      name: 'budget-tracker',
      compatibility_date: '2026-09-09',
      assets: {
        directory: './dist',
        not_found_handling: 'single-page-application',
      },
    });
    expect(config).not.toHaveProperty('main');
    expect(config).not.toHaveProperty('routes');
    expect(config).not.toHaveProperty('vars');
  });

  it('approves only the reviewed native deployment dependency', () => {
    const workspace = readFileSync(join(process.cwd(), 'pnpm-workspace.yaml'), 'utf8');

    expect(workspace).toMatch(/allowBuilds:\n  esbuild: true\n  workerd: true/);
    expect(workspace).not.toContain('dangerouslyAllowAllBuilds');
  });
});
