import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  findHouseholdDirectWrites,
  findSensitiveLogging,
} from '../db/household-source-ratchet.js';

const runtimeFiles = [
  'worker/handler.ts',
  'worker/index.ts',
  'worker/household-invitations/contracts.ts',
  'worker/household-invitations/deliver.ts',
  'worker/household-invitations/resend.ts',
  'worker/household-invitations/supabase-invitations.ts',
  'worker/household-invitations/templates.ts',
  'worker/household-invitations/validation.ts',
] as const;

function source(files: readonly string[]): string {
  return files.map((file) => readFileSync(file, 'utf8')).join('\n');
}

describe('household invitation delivery source ratchet', () => {
  it('keeps Resend and privileged credentials out of browser source', () => {
    const browserSource = source([
      'src/main.tsx',
      'src/app.tsx',
      'src/lib/supabase.ts',
      'package.json',
      'vite.config.ts',
    ]);

    expect(browserSource).not.toMatch(/VITE_.*(?:RESEND|SERVICE_ROLE|SMTP)/i);
    expect(source(runtimeFiles)).not.toMatch(/SUPABASE_SERVICE_ROLE|service[_-]?role/i);
  });

  it('uses only the protected invitation RPC and no household table mutation', () => {
    const workerSource = source(runtimeFiles);

    expect(workerSource).toContain('/rest/v1/rpc/create_household_invitation');
    expect(workerSource.match(/\/rest\/v1\/rpc\/create_household_invitation/g)).toHaveLength(1);
    expect(findHouseholdDirectWrites(workerSource)).toEqual([]);
    expect(workerSource).not.toMatch(/\/rest\/v1\/(?:space_memberships|household_invitations|household_membership_events)/);
  });

  it('does not route sensitive values into logging or analytics sinks', () => {
    expect(findSensitiveLogging(source(runtimeFiles))).toEqual([]);
  });

  it('keeps control flow and response accumulation visibly bounded', () => {
    const workerSource = source(runtimeFiles);

    expect(workerSource).not.toMatch(/\bwhile\s*\(/);
    expect(workerSource).not.toMatch(/for\s*\(\s*;\s*;/);
    expect(workerSource).toContain('MAX_PROVIDER_ATTEMPTS = 3');
    expect(workerSource).toContain('BODY_MAX_BYTES = 4_096');
    expect(workerSource).toContain('RESPONSE_MAX_BYTES = 4_096');
    expect(workerSource).toContain('RESPONSE_MAX_BYTES = 1_024');
  });

  it('declares server secrets, generated types, assets, and exact rate limits', () => {
    const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

    expect(config.main).toBe('./worker/index.ts');
    expect(config.assets).toMatchObject({
      directory: './dist',
      binding: 'ASSETS',
      run_worker_first: ['/api/*'],
    });
    expect(config.ratelimits.map((binding: { simple: unknown }) => binding.simple)).toEqual([
      { limit: 20, period: 60 },
      { limit: 3, period: 60 },
    ]);
    expect(config.secrets.required).toEqual([
      'APP_ORIGIN',
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'RESEND_API_KEY',
      'HOUSEHOLD_INVITATION_FROM',
      'HOUSEHOLD_INVITATION_REPLY_TO',
    ]);
    expect(config).not.toHaveProperty('vars');
    expect(packageJson.scripts['types:worker']).toBe('wrangler types');
    expect(packageJson.scripts['check:worker-types']).toBe('wrangler types --check');
    expect(packageJson.scripts.check).toContain('pnpm test:worker');
  });

  it('documents offline proof and every separate live-send approval', () => {
    const readme = readFileSync('README.md', 'utf8');
    const runbook = readFileSync('docs/operations/household-invitation-delivery.md', 'utf8');
    const decisions = readFileSync('docs/decisions.md', 'utf8');
    const normalizedRunbook = runbook.replace(/\s+/g, ' ');
    const normalizedDecisions = decisions.replace(/\s+/g, ' ');

    expect(readme).toContain('pnpm test:worker');
    expect(readme).toContain('No real email is sent by repository verification');
    for (const phrase of [
      'sending-only Resend API key',
      'SPF, DKIM, and DMARC',
      'monitored reply address',
      'transactional tracking disabled',
      'synthetic Resend address',
      'Household acceptance UI',
      'bounce, complaint, and suppression',
      'does not authorize a live send',
    ]) {
      expect(normalizedRunbook).toContain(phrase);
    }
    expect(normalizedDecisions).toContain('three attempts per owner and household per minute');
    expect(normalizedDecisions).toContain('23-hour provider retry cutoff');
    expect(normalizedDecisions).toContain('No database migration');
  });
});
