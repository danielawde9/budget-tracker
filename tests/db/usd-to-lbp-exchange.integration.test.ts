import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bootstrapCompatibilityObjects,
  createDisposableDatabase,
  disposeDisposableDatabase,
  expectSavepointRejection,
  migrationFiles,
  replayMigrations,
  withAuthenticatedTransaction,
  type DisposableDatabase,
} from './disposable-database.js';

const ownerId = '10000000-0000-4000-8000-000000000001';
const exchangeError = {
  code: 'P0001',
  message: 'the exchange requires active USD source and LBP destination wallets in the requested space',
};

describe('USD-to-LBP exchange command', () => {
  let database: DisposableDatabase | undefined;
  let spaceId = '';
  let usdWalletId = '';
  let lbpWalletId = '';

  beforeAll(async () => {
    database = await createDisposableDatabase('budget_exchange');
    try {
      await bootstrapCompatibilityObjects(database.client);
      await replayMigrations(database.client, migrationFiles());
      await database.client.query(
        `insert into auth.users (id, email, email_confirmed_at)
         values ($1, 'exchange-owner@budget.invalid', now())`,
        [ownerId],
      );
      await withAuthenticatedTransaction(database.client, ownerId, async () => {
        const space = await database!.client.query<{ id: string }>(
          "select * from public.create_space('Exchange space', 'personal') limit 2",
        );
        spaceId = space.rows[0]!.id;
        const usd = await database!.client.query<{ id: string }>(
          "select * from public.create_wallet($1, 'USD cash', 'USD') limit 2",
          [spaceId],
        );
        usdWalletId = usd.rows[0]!.id;
        const lbp = await database!.client.query<{ id: string }>(
          "select * from public.create_wallet($1, 'LBP cash', 'LBP') limit 2",
          [spaceId],
        );
        lbpWalletId = lbp.rows[0]!.id;
      });
    } catch (error) {
      const failed = database;
      database = undefined;
      if (failed) await disposeDisposableDatabase(failed);
      throw error;
    }
  }, 120_000);

  afterAll(async () => {
    if (!database) return;
    const completed = database;
    database = undefined;
    await disposeDisposableDatabase(completed);
  }, 60_000);

  it('posts exact linked USD-out and LBP-in movements under one exchange event', async () => {
    const requestId = randomUUID();
    await withAuthenticatedTransaction(database!.client, ownerId, async () => {
      const result = await database!.client.query<{ id: string }>(
        `select * from public.record_usd_to_lbp_exchange($1, $2, $3, $4, $5, $6, $7::date)`,
        [spaceId, requestId, usdWalletId, lbpWalletId, '2500', '225000000', '2026-09-12'],
      );
      const eventId = result.rows[0]!.id;

      await expect(
        database!.client.query(
          `select kind::text, count(*) filter (where kind in ('income', 'expense'))::int as income_or_expense_count
           from public.financial_events
           where id = $1
           group by kind`,
          [eventId],
        ),
      ).resolves.toMatchObject({ rows: [{ kind: 'exchange', income_or_expense_count: 0 }] });
      await expect(
        database!.client.query(
          `select wallet_id, amount_minor::text
           from public.wallet_movements
           where event_id = $1
           order by amount_minor`,
          [eventId],
        ),
      ).resolves.toMatchObject({
        rows: [
          { wallet_id: usdWalletId, amount_minor: '-2500' },
          { wallet_id: lbpWalletId, amount_minor: '225000000' },
        ],
      });

      const replay = await database!.client.query<{ id: string }>(
        `select * from public.record_usd_to_lbp_exchange($1, $2, $3, $4, $5, $6, $7::date)`,
        [spaceId, requestId, usdWalletId, lbpWalletId, '2500', '225000000', '2026-09-12'],
      );
      expect(replay.rows).toEqual([{ id: eventId }]);

      const writers = await database!.client.query<{ proname: string }>(
        `select p.proname
         from pg_proc as p
         join pg_namespace as namespace on namespace.oid = p.pronamespace
         where namespace.nspname = 'public'
           and p.prokind = 'f'
           and pg_get_functiondef(p.oid) ~* $1
         order by p.proname`,
        ['insert[[:space:]]+into[[:space:]]+public\\.(financial_events|wallet_movements|loan_postings|financial_event_categories)'],
      );
      expect(writers.rows.map((row) => row.proname)).toContain('record_usd_to_lbp_exchange');
      expect(readFileSync(resolve('docs/financial-command-inventory.md'), 'utf8')).toContain(
        'public.record_usd_to_lbp_exchange',
      );

      await expectSavepointRejection(
        database!.client,
        () => database!.client.query(
          `select * from public.record_usd_to_lbp_exchange($1, $2, $3, $4, $5, $6, $7::date)`,
          [spaceId, randomUUID(), lbpWalletId, usdWalletId, '1', '1', '2026-09-12'],
        ),
        exchangeError,
      );
    });
  });

  it('upgrades seeded journal history before adding the exchange command', async () => {
    const upgrade = await createDisposableDatabase('budget_exchange');
    const migrations = migrationFiles();
    const exchangeMigration = migrations.find((migration) => migration.version === '20260912100000');
    const priorMigrations = migrations.filter((migration) => migration.version < '20260912100000');

    try {
      expect(exchangeMigration).toBeDefined();
      await bootstrapCompatibilityObjects(upgrade.client);
      await replayMigrations(upgrade.client, priorMigrations);
      await upgrade.client.query(
        `insert into auth.users (id, email, email_confirmed_at)
         values ($1, 'exchange-upgrade@budget.invalid', now())`,
        [ownerId],
      );

      let seededSpaceId = '';
      let seededUsdWalletId = '';
      await withAuthenticatedTransaction(upgrade.client, ownerId, async () => {
        const space = await upgrade.client.query<{ id: string }>(
          "select * from public.create_space('Exchange upgrade', 'personal') limit 2",
        );
        seededSpaceId = space.rows[0]!.id;
        const usd = await upgrade.client.query<{ id: string }>(
          "select * from public.create_wallet($1, 'Seed USD', 'USD') limit 2",
          [seededSpaceId],
        );
        seededUsdWalletId = usd.rows[0]!.id;
        await upgrade.client.query(
          `select * from public.record_financial_event($1, $2, 'opening_balance', $3::date, $4::jsonb)`,
          [
            seededSpaceId,
            randomUUID(),
            '2026-09-11',
            JSON.stringify([{ walletId: seededUsdWalletId, amountMinor: '10000' }]),
          ],
        );

      });

      await replayMigrations(upgrade.client, [exchangeMigration!]);

      await withAuthenticatedTransaction(upgrade.client, ownerId, async () => {
        const lbp = await upgrade.client.query<{ id: string }>(
          "select * from public.create_wallet($1, 'Seed LBP', 'LBP') limit 2",
          [seededSpaceId],
        );
        await upgrade.client.query(
          `select * from public.record_usd_to_lbp_exchange($1, $2, $3, $4, '2500', '225000000', '2026-09-12'::date)`,
          [seededSpaceId, randomUUID(), seededUsdWalletId, lbp.rows[0]!.id],
        );
        await expect(
          upgrade.client.query(
            `select kind::text, count(*)::int as count
             from public.financial_events
             where space_id = $1
             group by kind
             order by kind`,
            [seededSpaceId],
          ),
        ).resolves.toMatchObject({
          rows: [
            { kind: 'exchange', count: 1 },
            { kind: 'opening_balance', count: 1 },
          ],
        });
      });
    } finally {
      await disposeDisposableDatabase(upgrade);
    }
  }, 120_000);
});
