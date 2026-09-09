import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const script = join(
  process.cwd(),
  'scripts/ops/validate-restore-roles.sh',
);

function fixture() {
  const base = mkdtempSync(
    join(realpathSync(tmpdir()), 'budget-role-validator-'),
  );
  const toc = join(base, 'archive.list');
  const roles = join(base, 'roles.sql');
  const manifest = join(base, 'target-roles.txt');
  writeFileSync(
    toc,
    '215; 1259 16384 TABLE public wallets budget_service\n',
  );
  writeFileSync(
    roles,
    [
      'CREATE ROLE budget_authenticated;',
      'GRANT budget_authenticated TO authenticated;',
      'GRANT budget_authenticated TO service_role;',
      '',
    ].join('\n'),
  );
  writeFileSync(
    manifest,
    [
      'postgres',
      'budget_authenticated',
      'budget_service',
      'authenticated',
      'service_role',
      '',
    ].join('\n'),
  );
  return { manifest, roles, toc };
}

function run(toc: string, roles: string, manifest: string) {
  return spawnSync('/bin/bash', [script, toc, roles, manifest], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env },
  });
}

describe('restore role boundary validator', () => {
  it('accepts allowlisted TOC owners and SQL grantees', () => {
    const { manifest, roles, toc } = fixture();
    const result = run(toc, roles, manifest);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('restore role boundary verified');
  });

  it('rejects an unapproved SQL grantee', () => {
    const { manifest, roles, toc } = fixture();
    writeFileSync(roles, 'GRANT budget_authenticated TO unapproved_grantee;\n');
    const result = run(toc, roles, manifest);

    expect(result.status).toBe(79);
    expect(result.stderr).toContain(
      'archive owner or SQL grantee is not allowlisted',
    );
  });

  it.each([
    'GRANT budget_service /* ; */ TO unapproved_grantee;\n',
    'GRANT budget_service -- ; hidden terminator\n TO unapproved_grantee;\n',
    'GRANT budget_service TO "unapproved_grantee";\n',
    "GRANT budget_service TO authenticated; SELECT 'TO unapproved_grantee';\n",
    'DO $$ BEGIN GRANT budget_service TO unapproved_grantee; END $$;\n',
    'GRANT budget_service TO authenticated; GRANT budget_service TO unapproved_grantee;\n',
  ])('rejects adversarial or unsupported SQL: %s', (sql) => {
    const { manifest, roles, toc } = fixture();
    writeFileSync(roles, sql);
    const result = run(toc, roles, manifest);

    expect(result.status).toBe(79);
    expect(result.stderr).toMatch(
      /filtered role SQL is invalid|archive owner or SQL grantee is not allowlisted/,
    );
  });

  it('accepts an allowlisted multiline membership grant', () => {
    const { manifest, roles, toc } = fixture();
    writeFileSync(
      roles,
      'CREATE ROLE budget_authenticated;\nGRANT budget_authenticated\n  TO authenticated, service_role;\n',
    );
    const result = run(toc, roles, manifest);

    expect(result.status).toBe(0);
  });

  it('requires authenticated and service_role target roles', () => {
    const { manifest, roles, toc } = fixture();
    writeFileSync(manifest, 'postgres\nbudget_service\nauthenticated\n');
    const result = run(toc, roles, manifest);

    expect(result.status).toBe(79);
    expect(result.stderr).toContain('required target roles are missing');
  });
});
