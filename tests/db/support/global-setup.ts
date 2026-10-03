import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { GenericContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { SUPABASE_POSTGRES_IMAGE, TEMPLATE_DATABASE, type PgBase } from './connection.ts';

const PASSWORD = 'budget-test-only';
const MIGRATIONS_DIR = path.resolve('supabase/migrations');
const AUTH_SHIM = path.resolve('tests/db/support/auth-shim.sql');

async function withClient<T>(base: PgBase, database: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ ...base, database });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function migrationFiles(): Promise<string[]> {
  const names = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort();
  if (names.length === 0) throw new Error(`No migrations in ${MIGRATIONS_DIR}`);
  return names.map((name) => path.join(MIGRATIONS_DIR, name));
}

async function buildTemplate(base: PgBase): Promise<void> {
  await withClient(base, 'postgres', (client) => client.query(`create database ${TEMPLATE_DATABASE} template template0`));
  await withClient(base, TEMPLATE_DATABASE, async (client) => {
    await client.query(await readFile(AUTH_SHIM, 'utf8'));
    for (const file of await migrationFiles()) {
      try {
        await client.query(await readFile(file, 'utf8'));
      } catch (error) {
        throw new Error(`Migration ${path.basename(file)} failed: ${(error as Error).message}`);
      }
    }
  });
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new GenericContainer(SUPABASE_POSTGRES_IMAGE)
    .withEnvironment({ POSTGRES_PASSWORD: PASSWORD })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forSuccessfulCommand('pg_isready -U postgres -h 127.0.0.1'))
    .withStartupTimeout(120_000)
    .start();
  const base: PgBase = { host: container.getHost(), port: container.getMappedPort(5432), user: 'postgres', password: PASSWORD };
  try {
    await buildTemplate(base);
  } catch (error) {
    await container.stop();
    throw error;
  }
  project.provide('pgBase', base);
  return async () => {
    await container.stop();
  };
}
