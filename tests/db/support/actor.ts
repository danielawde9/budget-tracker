import { randomUUID } from 'node:crypto';
import type pg from 'pg';

export async function createUser(pool: pg.Pool, email?: string): Promise<string> {
  const id = randomUUID();
  await pool.query('insert into auth.users (id, email) values ($1, $2)', [id, email ?? `${id}@test.local`]);
  return id;
}

/** Runs `fn` in one transaction as the Supabase `authenticated` role for `userId`. */
export async function asUser<T>(pool: pg.Pool, userId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(
      "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
      [userId, JSON.stringify({ sub: userId, role: 'authenticated' })],
    );
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Runs `fn` in one transaction as the anonymous role. */
export async function asAnon<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role anon');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

type RpcArgs = Readonly<Record<string, unknown>>;

function encode(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

/** Calls public.<name> with named arguments and returns its single result. */
export async function rpc<T = unknown>(client: pg.ClientBase, name: string, args: RpcArgs = {}): Promise<T> {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Bad RPC name ${name}`);
  const keys = Object.keys(args);
  for (const key of keys) if (!/^p_[a-z0-9_]+$/.test(key)) throw new Error(`Bad RPC argument ${key}`);
  const params = keys.map((key, index) => `${key} => $${index + 1}`).join(', ');
  const result = await client.query<{ r: T }>(`select public.${name}(${params}) as r`, keys.map((key) => encode(args[key])));
  const row = result.rows[0];
  if (!row) throw new Error(`RPC ${name} returned no row`);
  return row.r;
}

export function callAs<T = unknown>(pool: pg.Pool, userId: string, name: string, args: RpcArgs = {}): Promise<T> {
  return asUser(pool, userId, (client) => rpc<T>(client, name, args));
}
