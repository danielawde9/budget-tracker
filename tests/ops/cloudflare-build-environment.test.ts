import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateCloudflareBuildEnvironment } from '../../scripts/cloudflare/build-environment.mjs';

const valid = {
  VITE_SUPABASE_URL: 'https://budget-project.supabase.co',
  VITE_SUPABASE_ANON_KEY: `sb_publishable_${'a'.repeat(32)}`,
};

describe('Cloudflare build environment', () => {
  it.each([
    [{}, 'VITE_SUPABASE_URL'],
    [{ VITE_SUPABASE_URL: valid.VITE_SUPABASE_URL }, 'VITE_SUPABASE_ANON_KEY'],
    [{ VITE_SUPABASE_PUBLISHABLE_KEY: valid.VITE_SUPABASE_ANON_KEY }, 'VITE_SUPABASE_ANON_KEY'],
    [{ ...valid, VITE_SUPABASE_URL: 'http://budget-project.supabase.co' }, 'VITE_SUPABASE_URL'],
    [{ ...valid, VITE_SUPABASE_URL: 'replace-with-url' }, 'VITE_SUPABASE_URL'],
    [{ ...valid, VITE_SUPABASE_ANON_KEY: 'replace-with-key' }, 'VITE_SUPABASE_ANON_KEY'],
  ])('rejects invalid input without returning values', (environment, expectedName) => {
    expect(() => validateCloudflareBuildEnvironment(environment)).toThrow(expectedName);
  });

  it('returns the validated public build contract', () => {
    expect(validateCloudflareBuildEnvironment(valid)).toEqual({
      supabaseUrl: valid.VITE_SUPABASE_URL,
      anonKey: valid.VITE_SUPABASE_ANON_KEY,
    });
  });

  it('does not print supplied values when the CLI rejects input', () => {
    const secretShapedValue = 'sb_publishable_DO_NOT_PRINT_THIS_VALUE_123456';
    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), 'scripts/cloudflare/check-build-environment.mjs')],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          VITE_SUPABASE_URL: 'http://invalid.example',
          VITE_SUPABASE_ANON_KEY: secretShapedValue,
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('VITE_SUPABASE_URL');
    expect(`${result.stdout}${result.stderr}`).not.toContain(secretShapedValue);
  });
});
