import { readFileSync } from 'node:fs';
import pg from 'pg';

export function localDemoEnv() {
  const env = readFileSync('.env.demo.local', 'utf8');
  const value = (key: string) => new RegExp(`^${key}=(.*)$`, 'm').exec(env)?.[1]?.trim() ?? '';
  const url = value('VITE_SUPABASE_URL');
  const databaseUrl = value('DEMO_DATABASE_URL');
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) throw new Error('Local preview API required.');
  const db = new URL(databaseUrl);
  if (db.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(db.hostname) || !db.port || db.search) {
    throw new Error('DEMO_DATABASE_URL must be an explicit loopback PostgreSQL connection without query overrides.');
  }
  return { url, anonKey: value('VITE_SUPABASE_ANON_KEY'), databaseUrl };
}

/** Compare full row contents in every budget base table, including receipts and audit history. */
export async function budgetRowsets(): Promise<Record<string, unknown[]>> {
  const client = new pg.Client({ connectionString: localDemoEnv().databaseUrl });
  await client.connect();
  try {
    await client.query('begin isolation level repeatable read read only');
    const tables = await client.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'budget' and table_type = 'BASE TABLE' order by table_name`);
    if (tables.rows.length < 18) throw new Error('Expected all current budget tables and migrations.');
    const snapshot: Record<string, unknown[]> = {};
    for (const { table_name } of tables.rows) {
      const identifier = `"${table_name.replaceAll('"', '""')}"`;
      const rows = await client.query<{ row: unknown }>(`select to_jsonb(t) as row from budget.${identifier} t order by to_jsonb(t)::text`);
      snapshot[table_name] = rows.rows.map(({ row }) => row);
    }
    await client.query('commit');
    return snapshot;
  } finally { await client.end(); }
}
