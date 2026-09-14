import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const compareScript = join(process.cwd(), 'scripts/ops/check-live-migration-drift.mjs');
const bridgeScript = join(process.cwd(), 'scripts/ops/check-live-migration-drift.sh');

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'budget-drift-'));
  const migrations = join(base, 'migrations');
  mkdirSync(migrations, { mode: 0o700 });
  writeFileSync(join(migrations, '20260907100000_first.sql'), 'select 1;\n');
  writeFileSync(join(migrations, '20260907110000_second.sql'), 'select 2;\n');
  return { base, migrations };
}

function remoteJson(base: string, versions: readonly string[] | null): string {
  const path = join(base, 'remote.json');
  writeFileSync(path, JSON.stringify(versions === null ? [] : [{ versions }]));
  return path;
}

function run(migrationsDir: string, remotePath: string) {
  return spawnSync('node', [compareScript, migrationsDir, remotePath], { encoding: 'utf8' });
}

describe('check-live-migration-drift.mjs', () => {
  it('exits 0 and reports agreement when local and remote match exactly', () => {
    const { base, migrations } = fixture();
    try {
      const result = run(migrations, remoteJson(base, ['20260907100000', '20260907110000']));
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('agree');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('exits 1 and names a migration committed locally but not applied remotely', () => {
    const { base, migrations } = fixture();
    try {
      const result = run(migrations, remoteJson(base, ['20260907100000']));
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('NOT applied');
      expect(result.stderr).toContain('20260907110000_second.sql');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('exits 1 and names a version applied remotely but missing from supabase/migrations', () => {
    const { base, migrations } = fixture();
    try {
      const result = run(migrations, remoteJson(base, ['20260907100000', '20260907110000', '20260907999999']));
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('missing from');
      expect(result.stderr).toContain('20260907999999');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('treats an empty remote history as every local migration missing, not as agreement', () => {
    const { base, migrations } = fixture();
    try {
      const result = run(migrations, remoteJson(base, []));
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('20260907100000_first.sql');
      expect(result.stderr).toContain('20260907110000_second.sql');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('rejects malformed remote JSON rather than silently treating it as empty', () => {
    const { base, migrations } = fixture();
    const remotePath = join(base, 'remote.json');
    writeFileSync(remotePath, 'not json');
    try {
      const result = run(migrations, remotePath);
      expect(result.status).not.toBe(0);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('check-live-migration-drift.sh safety properties', () => {
  it('is read-only: no push, reset, or write-shaped Supabase command', () => {
    const source = readFileSync(bridgeScript, 'utf8');
    expect(source).not.toMatch(/db push|db reset|migration repair|--include-all|--include-roles|--include-seed/);
  });

  it('never accepts a service role or secret key as authority', () => {
    const source = readFileSync(bridgeScript, 'utf8');
    expect(source).toContain('unset SUPABASE_SERVICE_ROLE_KEY SUPABASE_SECRET_KEY');
  });

  it('pins the same exact project ref as the live migration runner', () => {
    const bridgeSource = readFileSync(bridgeScript, 'utf8');
    const runnerSource = readFileSync(join(process.cwd(), 'scripts/ops/apply-live-migrations.sh'), 'utf8');
    const bridgeRef = /DRIFT_PROJECT_REF='([^']+)'/.exec(bridgeSource)?.[1];
    const runnerRef = /LIVE_PROJECT_REF='([^']+)'/.exec(runnerSource)?.[1];
    expect(bridgeRef).toBeDefined();
    expect(bridgeRef).toBe(runnerRef);
  });

  it('verifies account access to the exact project before querying it', () => {
    const source = readFileSync(bridgeScript, 'utf8');
    expect(source).toContain('authenticated account cannot access the exact project');
  });

  it('prompts for credentials rather than accepting them as command-line arguments', () => {
    const source = readFileSync(bridgeScript, 'utf8');
    expect(source).toContain("read -r -s -p 'Supabase personal access token: '");
    expect(source).toContain("read -r -s -p 'Supabase database password: '");
  });
});
