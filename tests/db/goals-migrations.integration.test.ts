import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase, disposeDisposableDatabase,
  migrationFiles, replayMigrations, withAuthenticatedTransaction, withRollback,
  type DisposableDatabase,
} from './disposable-database.js';

const goalsSchemaVersion = '20260914140000';
const ownerId = '30000000-0000-4000-8000-000000000001';

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

describe('goals schema migration replay and upgrade', () => {
  it('replays the complete journal into an empty database', async () => {
    const database = await createDisposableDatabase('budget_goalsmig');
    try {
      await bootstrapCompatibilityObjects(database.client);
      await replayMigrations(database.client, migrationFiles());
      const tables = await database.client.query<{ table_name: string }>(
        `select table_name from information_schema.tables
         where table_schema = 'public' and (table_name like 'goal_%' or table_name = 'goals')
         order by table_name`,
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        'goal_earmark_events', 'goal_earmark_lines', 'goal_milestone_events', 'goal_milestones',
        'goal_monthly_target_revisions', 'goal_purchase_links', 'goal_revision_milestones',
        'goal_revisions', 'goals',
      ].sort());
    } finally {
      await disposeDisposableDatabase(database);
    }
  }, 120_000);

  it('upgrades seeded journal history (space, category, income plan) before adding the goals schema', async () => {
    const migrations = migrationFiles();
    const goalsMigration = migrations.find((migration) => migration.version === goalsSchemaVersion);
    const priorMigrations = migrations.filter((migration) => migration.version < goalsSchemaVersion);
    expect(goalsMigration).toBeDefined();

    const database = await createDisposableDatabase('budget_goalsupgrade');
    try {
      await bootstrapCompatibilityObjects(database.client);
      await replayMigrations(database.client, priorMigrations);
      await database.client.query(
        `insert into auth.users (id, email, email_confirmed_at) values ($1, 'goals-upgrade@budget.invalid', now())`,
        [ownerId],
      );

      let spaceId = '';
      let categoryId = '';
      await withAuthenticatedTransaction(database.client, ownerId, async () => {
        const space = await database.client.query<{ id: string }>(
          "select id from public.create_space($1, 'personal') limit 2", ['Goals upgrade fixture'],
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

      await replayMigrations(database.client, [goalsMigration!]);

      const after = await financialDigest(database.client, spaceId);
      expect(after).toEqual(before);

      // The new tables exist and accept a valid owner-seeded row (no public
      // command exists yet -- task 10 -- so this proves the schema itself,
      // not a command).
      await withRollback(database.client, async () => {
        const goalId = randomUUID();
        await database.client.query(
          'insert into public.goals (id, space_id, currency, kind, actor_id) values ($1,$2,$3,$4,$5)',
          [goalId, spaceId, 'USD', 'reserve', ownerId],
        );
        const readBack = await database.client.query('select id from public.goals where id = $1', [goalId]);
        expect(readBack.rows).toEqual([{ id: goalId }]);
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
