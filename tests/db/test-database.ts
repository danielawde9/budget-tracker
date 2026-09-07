import { Pool, type PoolClient } from 'pg';

export type SpaceKind = 'personal' | 'household';

export interface Space {
  id: string;
}

function databaseUrl(): string {
  const value = process.env.BUDGET_TEST_DATABASE_URL;

  if (!value) {
    throw new Error('BUDGET_TEST_DATABASE_URL must be set for database integration tests');
  }

  return value;
}

const pool = new Pool({
  connectionString: databaseUrl(),
  connectionTimeoutMillis: 10_000,
  max: 2,
});

async function withUserSession<T>(
  userId: string,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query(
      `insert into auth.users (
         id,
         aud,
         role,
         email,
         raw_app_meta_data,
         raw_user_meta_data,
         created_at,
         updated_at
       )
       values ($1, 'authenticated', 'authenticated', $2, '{}', '{}', now(), now())
       on conflict (id) do nothing`,
      [userId, `test-${userId}@budget.invalid`],
    );
    await client.query('begin');
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query('set local role authenticated');
    const result = await action(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export function asUser(userId: string) {
  return {
    async createSpace(name: string, kind: SpaceKind): Promise<Space> {
      return withUserSession(userId, async (client) => {
        const result = await client.query<Space>(
          'select * from public.create_space($1, $2)',
          [name, kind],
        );
        const space = result.rows[0];

        if (!space) {
          throw new Error('create_space returned no space');
        }

        return space;
      });
    },
  };
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
