import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
    [{ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: valid.VITE_SUPABASE_ANON_KEY }, 'VITE_SUPABASE_PUBLISHABLE_KEY'],
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

  it.each([
    ['VITE_SUPABASE_SERVICE_ROLE_KEY', 'service-role-DO_NOT_PRINT_THIS_VALUE'],
    ['VITE_DATABASE_URL', 'postgres://DO_NOT_PRINT_THIS_VALUE'],
    ['VITE_CLOUDFLARE_API_TOKEN', 'cloudflare-DO_NOT_PRINT_THIS_VALUE'],
    ['VITE_SSH_PASSWORD', 'ssh-DO_NOT_PRINT_THIS_VALUE'],
  ])('rejects forbidden %s without returning or printing its value', (name, value) => {
    expect(() => validateCloudflareBuildEnvironment({ ...valid, [name]: value })).toThrow(name);

    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), 'scripts/cloudflare/check-build-environment.mjs')],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          ...valid,
          [name]: value,
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(name);
    expect(`${result.stdout}${result.stderr}`).not.toContain(value);
  });

  it('validates Vite production env files before the build', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cloudflare-build-environment-'));
    const secretShapedValue = 'env-file-DO_NOT_PRINT_THIS_VALUE';
    const forbiddenVariableName = 'VITE_SSH_PASSWORD';
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('VITE_')),
    );

    try {
      writeFileSync(
        join(directory, '.env.production'),
        [
          `VITE_SUPABASE_URL=${valid.VITE_SUPABASE_URL}`,
          `VITE_SUPABASE_ANON_KEY=${valid.VITE_SUPABASE_ANON_KEY}`,
          `${forbiddenVariableName}=${secretShapedValue}`,
          '',
        ].join('\n'),
      );

      const result = spawnSync(
        process.execPath,
        [join(process.cwd(), 'scripts/cloudflare/check-build-environment.mjs')],
        { cwd: directory, encoding: 'utf8', env: environment },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(forbiddenVariableName);
      expect(`${result.stdout}${result.stderr}`).not.toContain(secretShapedValue);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
