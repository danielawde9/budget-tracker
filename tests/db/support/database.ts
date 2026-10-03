import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { TEMPLATE_DATABASE } from './connection.ts';

// Return SQL dates as 'YYYY-MM-DD' strings, exactly as PostgREST sends them
// to the app, instead of JavaScript Date objects shifted by the host timezone.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export interface TestDatabase {
  readonly pool: pg.Pool;
  close(): Promise<void>;
}

/** A private database cloned from the migrated template; one per test file. */
export async function freshDatabase(): Promise<TestDatabase> {
  const base = inject('pgBase');
  const name = `t_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const admin = new pg.Client({ ...base, database: 'postgres' });
  await admin.connect();
  try {
    await admin.query(`create database ${name} template ${TEMPLATE_DATABASE}`);
  } finally {
    await admin.end();
  }
  const pool = new pg.Pool({ ...base, database: name, max: 6 });
  return {
    pool,
    async close() {
      await pool.end();
    },
  };
}
