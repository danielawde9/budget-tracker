import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { validateCloudflareBuildEnvironment } from '../../scripts/cloudflare/build-environment.mjs';

const valid = {
  VITE_SUPABASE_URL: 'https://budget-project.supabase.co',
  VITE_SUPABASE_ANON_KEY: `sb_publishable_${'a'.repeat(32)}`,
};
const cliPath = join(process.cwd(), 'scripts/cloudflare/check-build-environment.mjs');

function cleanSubprocessEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !name.startsWith('VITE_') && name !== 'DEBUG',
      ),
    ),
    ...overrides,
  };
}

function runCli(directory: string, environment: Record<string, string | undefined>) {
  return spawnSync(process.execPath, [cliPath], {
    cwd: directory,
    encoding: 'utf8',
    env: environment,
  });
}

function createIsolatedBuildDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'cloudflare-build-environment-'));
  for (const name of ['index.html', 'package.json', 'pnpm-workspace.yaml', 'tsconfig.json', 'vite.config.ts']) {
    cpSync(join(process.cwd(), name), join(directory, name));
  }
  cpSync(join(process.cwd(), 'scripts'), join(directory, 'scripts'), { recursive: true });
  cpSync(join(process.cwd(), 'src'), join(directory, 'src'), { recursive: true });
  symlinkSync(join(process.cwd(), 'node_modules'), join(directory, 'node_modules'));
  return directory;
}

describe('Cloudflare build environment', () => {
  it.each([
    [{}, 'VITE_SUPABASE_URL'],
    [{ VITE_SUPABASE_URL: valid.VITE_SUPABASE_URL }, 'VITE_SUPABASE_ANON_KEY'],
    [{ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: valid.VITE_SUPABASE_ANON_KEY }, 'VITE_SUPABASE_PUBLISHABLE_KEY'],
    [{ ...valid, VITE_SUPABASE_URL: 'http://budget-project.supabase.co' }, 'VITE_SUPABASE_URL'],
    [{ ...valid, VITE_SUPABASE_URL: 'replace-with-url' }, 'VITE_SUPABASE_URL'],
    [{ ...valid, VITE_SUPABASE_ANON_KEY: 'replace-with-key' }, 'VITE_SUPABASE_ANON_KEY'],
    [{ ...valid, VITE_SUPABASE_URL: ` ${valid.VITE_SUPABASE_URL}` }, 'VITE_SUPABASE_URL'],
    [{ ...valid, VITE_SUPABASE_ANON_KEY: `${valid.VITE_SUPABASE_ANON_KEY}\n` }, 'VITE_SUPABASE_ANON_KEY'],
    [{ ...valid, VITE_SUPABASE_URL: 'https://budget-project.\nsupabase.co' }, 'VITE_SUPABASE_URL'],
    [{ ...valid, VITE_SUPABASE_URL: 'https://budget-project.\rsupabase.co' }, 'VITE_SUPABASE_URL'],
    [{ ...valid, VITE_SUPABASE_URL: 'https://budget-project.\tsupabase.co' }, 'VITE_SUPABASE_URL'],
    [{ ...valid, VITE_SUPABASE_URL: 'https://budget-project.supabase.co\\evil' }, 'VITE_SUPABASE_URL'],
    [{ ...valid, VITE_SUPABASE_URL: 'https://budget-project.supabase.co:443' }, 'VITE_SUPABASE_URL'],
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
    const directory = mkdtempSync(join(tmpdir(), 'cloudflare-build-environment-'));

    try {
      const result = runCli(
        directory,
        cleanSubprocessEnvironment({
          VITE_SUPABASE_URL: 'http://invalid.example',
          VITE_SUPABASE_ANON_KEY: secretShapedValue,
        }),
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('VITE_SUPABASE_URL');
      expect(`${result.stdout}${result.stderr}`).not.toContain(secretShapedValue);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['VITE_SUPABASE_SERVICE_ROLE_KEY', 'service-role-DO_NOT_PRINT_THIS_VALUE'],
    ['VITE_DATABASE_URL', 'postgres://DO_NOT_PRINT_THIS_VALUE'],
    ['VITE_CLOUDFLARE_API_TOKEN', 'cloudflare-DO_NOT_PRINT_THIS_VALUE'],
    ['VITE_SSH_PASSWORD', 'ssh-DO_NOT_PRINT_THIS_VALUE'],
  ])('rejects forbidden %s without returning or printing its value', (name, value) => {
    expect(() => validateCloudflareBuildEnvironment({ ...valid, [name]: value })).toThrow(name);
    const directory = mkdtempSync(join(tmpdir(), 'cloudflare-build-environment-'));

    try {
      const result = runCli(
        directory,
        cleanSubprocessEnvironment({
          ...valid,
          [name]: value,
        }),
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(name);
      expect(`${result.stdout}${result.stderr}`).not.toContain(value);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not leak rejected values when DEBUG enables Vite env logging', () => {
    const secretShapedValue = 'debug-rejection-DO_NOT_PRINT_THIS_VALUE';
    const directory = mkdtempSync(join(tmpdir(), 'cloudflare-build-environment-'));

    try {
      const result = runCli(
        directory,
        cleanSubprocessEnvironment({
          DEBUG: 'vite:env',
          ...valid,
          VITE_SSH_PASSWORD: secretShapedValue,
        }),
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('VITE_SSH_PASSWORD');
      expect(`${result.stdout}${result.stderr}`).not.toContain(secretShapedValue);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not leak accepted values when DEBUG enables Vite env logging', () => {
    const markerUrl = 'https://debug-success-marker.supabase.co';
    const directory = mkdtempSync(join(tmpdir(), 'cloudflare-build-environment-'));

    try {
      const result = runCli(
        directory,
        cleanSubprocessEnvironment({
          DEBUG: 'vite:env',
          VITE_SUPABASE_URL: markerUrl,
          VITE_SUPABASE_ANON_KEY: valid.VITE_SUPABASE_ANON_KEY,
        }),
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Cloudflare public build-variable contract passed');
      expect(`${result.stdout}${result.stderr}`).not.toContain(markerUrl);
      expect(`${result.stdout}${result.stderr}`).not.toContain(valid.VITE_SUPABASE_ANON_KEY);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('suppresses DEBUG values through the complete Cloudflare build command', () => {
    const markerUrl = 'https://debug-build-command-marker.supabase.co';
    const markerKey = 'sb_publishable_debug_build_command_marker_1234567890';
    const directory = createIsolatedBuildDirectory();

    try {
      const result = spawnSync('pnpm', ['build:cloudflare'], {
        cwd: directory,
        encoding: 'utf8',
        env: cleanSubprocessEnvironment({
          DEBUG: 'vite:env',
          VITE_SUPABASE_URL: markerUrl,
          VITE_SUPABASE_ANON_KEY: markerKey,
        }),
      });

      expect(result.status).toBe(0);
      expect(`${result.stdout}${result.stderr}`).not.toContain(markerUrl);
      expect(`${result.stdout}${result.stderr}`).not.toContain(markerKey);
      expect(`${result.stdout}${result.stderr}`).not.toContain('vite:env using resolved env');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('validates Vite production env files before the build', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cloudflare-build-environment-'));
    const secretShapedValue = 'env-file-DO_NOT_PRINT_THIS_VALUE';
    const forbiddenVariableName = 'VITE_SSH_PASSWORD';
    const environment = cleanSubprocessEnvironment();

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
        [cliPath],
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
