import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeBackupFixture } from './ops-fixture.js';

const script = join(process.cwd(), 'scripts/ops/verify-budget-db.sh');

describe('pinned read-only PostgreSQL identity verifier', () => {
  it('forces a read-only transaction and queries identity from the connected endpoint', () => {
    const source = readFileSync(script, 'utf8');

    expect(source).toContain('BEGIN READ ONLY');
    expect(source).toContain('default_transaction_read_only=on');
    expect(source).toContain('pg_control_system()');
    expect(source).toContain("current_setting('server_version_num')");
    expect(source).toContain('current_database()');
    expect(source).toContain('pg_database');
    expect(source).toContain('pg_class');
  });

  it('returns the measured system, major, database identity/OID, and relation count', () => {
    const { env } = makeBackupFixture();
    const result = spawnSync(
      'bash',
      [script, 'fixture-budget-db.internal', '5432', 'budget', 'budget_backup'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...env,
          BUDGET_VERIFY_DATABASE_NAME: 'budget',
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('7000000000000000001|17|budget|17001|7');
  });
});
