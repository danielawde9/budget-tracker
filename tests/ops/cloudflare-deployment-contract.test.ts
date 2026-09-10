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
    expect(packageJson.scripts['deploy:cloudflare']).toBe(
      'pnpm build:cloudflare && pnpm deploy:cloudflare:dry-run && pnpm exec wrangler deploy',
    );
    expect(JSON.stringify(packageJson)).not.toContain('npx wrangler');
  });

  it('serves the Vite SPA and runs only API paths through the Worker first', () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), 'wrangler.jsonc'), 'utf8'));

    expect(config).toEqual({
      $schema: './node_modules/wrangler/config-schema.json',
      name: 'budget-tracker',
      main: './worker/index.ts',
      compatibility_date: '2026-09-10',
      assets: {
        directory: './dist',
        not_found_handling: 'single-page-application',
        binding: 'ASSETS',
        run_worker_first: ['/api/*'],
      },
      ratelimits: [
        {
          name: 'HOUSEHOLD_INVITATION_IP_LIMITER',
          namespace_id: '91001',
          simple: { limit: 20, period: 60 },
        },
        {
          name: 'HOUSEHOLD_INVITATION_ACTOR_LIMITER',
          namespace_id: '91002',
          simple: { limit: 3, period: 60 },
        },
      ],
      secrets: {
        required: [
          'APP_ORIGIN',
          'SUPABASE_URL',
          'SUPABASE_ANON_KEY',
          'RESEND_API_KEY',
          'HOUSEHOLD_INVITATION_FROM',
          'HOUSEHOLD_INVITATION_REPLY_TO',
        ],
      },
      observability: {
        enabled: true,
        logs: { enabled: true, head_sampling_rate: 1 },
        traces: { enabled: true, head_sampling_rate: 0.01 },
      },
    });
    expect(config).not.toHaveProperty('routes');
    expect(config).not.toHaveProperty('vars');
  });

  it('approves only the reviewed native deployment dependency', () => {
    const workspace = readFileSync(join(process.cwd(), 'pnpm-workspace.yaml'), 'utf8');

    expect(workspace).toMatch(
      /^allowBuilds:\n  esbuild: true\n  workerd: true\n(?=minimumReleaseAgeExclude:)/,
    );
    expect(workspace).not.toContain('dangerouslyAllowAllBuilds');
  });

  it('documents the reviewed Cloudflare release boundary', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
    const runbook = readFileSync(
      join(process.cwd(), 'docs/operations/cloudflare-deployment.md'),
      'utf8',
    );

    expect(readme).toContain('pnpm build:cloudflare');
    expect(runbook).toContain('VITE_SUPABASE_URL');
    expect(runbook).toContain('VITE_SUPABASE_ANON_KEY');
    expect(runbook).toMatch(
      /For hosted release builds, set these names only through protected CI or\s+Cloudflare dashboard build settings\./,
    );
    expect(runbook).toMatch(
      /Owner-authorized local fallback uses only\s+the ignored `\.env\.local` file\./,
    );
    expect(runbook).toContain('pnpm deploy:cloudflare:dry-run');
    expect(runbook).toContain('```bash\npnpm deploy:cloudflare\n```');
    expect(runbook).toContain('The Cloudflare production branch is `main`.');
    expect(runbook).toContain('synthetic or replaceable data');
    expect(runbook).toContain('`VITE_SUPABASE_PUBLISHABLE_KEY` must be absent');
    expect(runbook).toContain('Do not source and export the legacy value');
    expect(runbook).toContain(
      'A successful `pnpm build:cloudflare` and `pnpm deploy:cloudflare:dry-run` are hard prerequisites',
    );
    expect(runbook).toContain('`env -u DEBUG`');
    expect(runbook).not.toContain('VITE_SUPABASE_PUBLISHABLE_KEY=');
    expect(runbook).not.toContain('npx wrangler');
  });
});
