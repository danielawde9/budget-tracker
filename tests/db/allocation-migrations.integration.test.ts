import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase, disposeDisposableDatabase,
  migrationFiles, replayMigrations, withAuthenticatedTransaction, withRollback,
  type DisposableDatabase,
} from './disposable-database.js';

const allocationSchemaVersion = '20260914110000';
const ownerId = '20000000-0000-4000-8000-000000000001';

async function financialDigest(client: DisposableDatabase['client'], spaceId: string): Promise<unknown> {
  const result = await client.query(
    `select 'events' as relation_name, count(*)::text as row_count,
      md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), '')) as digest
     from (select * from public.financial_events where space_id = $1 order by id limit 101) x
     union all
     select 'movements', count(*)::text,
       md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), ''))
     from (select * from public.wallet_movements where space_id = $1 order by id limit 101) x
     union all
     select 'plan_revisions', count(*)::text,
       md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), ''))
     from (select * from public.monthly_budget_plan_revisions where space_id = $1 order by id limit 101) x
     order by relation_name`,
    [spaceId],
  );
  expect(result.rows.every((row: { row_count: string }) => Number(row.row_count) <= 100)).toBe(true);
  return result.rows;
}

describe('allocation schema migration replay and upgrade', () => {
  it('replays the complete journal into an empty database', async () => {
    const database = await createDisposableDatabase('budget_allocmig');
    try {
      await bootstrapCompatibilityObjects(database.client);
      await replayMigrations(database.client, migrationFiles());
      const tables = await database.client.query<{ table_name: string }>(
        `select table_name from information_schema.tables
         where table_schema = 'public' and table_name like 'allocation_%' order by table_name`,
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        'allocation_groups', 'allocation_month_commitments', 'allocation_month_goal_lines',
        'allocation_month_groups', 'allocation_month_roots', 'allocation_month_snapshots',
        'allocation_template_lines', 'allocation_template_revisions', 'allocation_template_roots',
      ].sort());
    } finally {
      await disposeDisposableDatabase(database);
    }
  }, 120_000);

  it('upgrades seeded journal history (space, category, income plan) before adding the allocation schema', async () => {
    const migrations = migrationFiles();
    const allocationMigration = migrations.find((migration) => migration.version === allocationSchemaVersion);
    const priorMigrations = migrations.filter((migration) => migration.version < allocationSchemaVersion);
    expect(allocationMigration).toBeDefined();

    const database = await createDisposableDatabase('budget_allocupg');
    try {
      await bootstrapCompatibilityObjects(database.client);
      await replayMigrations(database.client, priorMigrations);
      await database.client.query(
        `insert into auth.users (id, email, email_confirmed_at) values ($1, 'alloc-upgrade@budget.invalid', now())`,
        [ownerId],
      );

      let spaceId = '';
      let categoryId = '';
      await withAuthenticatedTransaction(database.client, ownerId, async () => {
        const space = await database.client.query<{ id: string }>(
          "select id from public.create_space($1, 'personal') limit 2", ['Allocation upgrade fixture'],
        );
        spaceId = space.rows[0]!.id;
        const category = await database.client.query<{ id: string }>(
          "select id from public.create_category($1,$2,'expense','Essentials',null) limit 2", [spaceId, randomUUID()],
        );
        categoryId = category.rows[0]!.id;
        await database.client.query(
          "select * from public.set_monthly_income_plan($1,$2,'2026-09-01'::date,'USD','100000',null)",
          [spaceId, randomUUID()],
        );
        await database.client.query(
          "select * from public.set_monthly_category_target($1,$2,$3,'2026-09-01'::date,'USD','80000',null)",
          [spaceId, randomUUID(), categoryId],
        );
      });

      const before = await financialDigest(database.client, spaceId);

      await replayMigrations(database.client, [allocationMigration!]);

      const after = await financialDigest(database.client, spaceId);
      expect(after).toEqual(before);

      // The new tables exist and accept a valid owner-seeded row (no public
      // command exists yet -- task 05 -- so this proves the schema itself,
      // not a command).
      await withRollback(database.client, async () => {
        const groupId = randomUUID();
        await database.client.query(
          'insert into public.allocation_groups (id, space_id, currency, purpose, actor_id) values ($1,$2,$3,$4,$5)',
          [groupId, spaceId, 'USD', 'spending', ownerId],
        );
        const readBack = await database.client.query('select id from public.allocation_groups where id = $1', [groupId]);
        expect(readBack.rows).toEqual([{ id: groupId }]);
      });

      // The pre-existing monthly-budgeting reads still work unchanged.
      await withAuthenticatedTransaction(database.client, ownerId, async () => {
        const summary = await database.client.query<{ currency: string; category_target_total_minor: string }>(
          `select currency::text, category_target_total_minor::text
           from public.monthly_budget_currency_summary($1, '2026-09-01'::date) where currency='USD'`,
          [spaceId],
        );
        expect(summary.rows).toEqual([{ currency: 'USD', category_target_total_minor: '80000' }]);
      });
    } finally {
      await disposeDisposableDatabase(database);
    }
  }, 120_000);
});
