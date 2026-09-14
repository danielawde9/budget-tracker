import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction, expectSavepointRejection, withRollback,
  type DisposableDatabase,
} from './disposable-database.js';

let database: DisposableDatabase | undefined;
const actor = randomUUID();
const outsider = randomUUID();
let spaceId: string;

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_planning');
  await bootstrapCompatibilityObjects(db().client);
  await replayMigrations(db().client, migrationFiles());
  await db().client.query(
    `insert into auth.users(id, email, email_confirmed_at)
     values ($1, 'owner@budget.invalid', now()),
            ($2, 'outsider@budget.invalid', now())`, [actor, outsider],
  );
  spaceId = await withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ id: string }>(
      "select id from public.create_space($1, 'personal') limit 2", ['Planning fixture'],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.id;
  });
}, 120_000);

afterAll(async () => {
  if (database) await disposeDisposableDatabase(database);
}, 30_000);

async function freshSpace(name: string, kind: 'personal' | 'household' = 'personal'): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const space = await db().client.query<{ id: string }>(
      'select id from public.create_space($1, $2) limit 2', [name, kind],
    );
    return space.rows[0]!.id;
  });
}

async function usdWallet(space: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const wallet = await db().client.query<{ id: string }>(
      "select id from public.create_wallet($1, 'Cash', 'USD') limit 2", [space],
    );
    return wallet.rows[0]!.id;
  });
}

describe('planning reporting foundation verification', () => {
  it('nets an ordinary expense and its inverse once', async () => {
    await withAuthenticatedTransaction(db().client, actor, async () => {
      const wallet = await db().client.query<{ id: string }>(
        "select id from public.create_wallet($1, 'Cash', 'USD') limit 2", [spaceId],
      );
      const event = await db().client.query<{ id: string }>(
        `select id from public.record_financial_event(
          $1, $2, 'expense', '2026-09-10', $3::jsonb) limit 2`,
        [spaceId, randomUUID(), JSON.stringify([
          { walletId: wallet.rows[0]!.id, amountMinor: '-5000' },
        ])],
      );
      await db().client.query(
        "select * from public.reverse_financial_event($1,$2,$3,'2026-09-10') limit 2",
        [spaceId, randomUUID(), event.rows[0]!.id],
      );
      const report = await db().client.query<{ expense: string; delta: string }>(
        `select expense_net_minor::text expense, wallet_delta_net_minor::text delta
         from public.report_monthly_cash_summary($1,'2026-09-01')
         where period_role='current' and currency='USD' limit 2`, [spaceId],
      );
      expect(report.rows).toEqual([{ expense: '0', delta: '0' }]);
    });
  });

  it('V01 nets an ordinary income and its same-day inverse (USD)', async () => {
    const v01Space = await freshSpace('V01 income reversal');
    const wallet = await usdWallet(v01Space);
    await withAuthenticatedTransaction(db().client, actor, async () => {
      const event = await db().client.query<{ id: string }>(
        `select id from public.record_financial_event($1, $2, 'income', '2026-09-10', $3::jsonb) limit 2`,
        [v01Space, randomUUID(), JSON.stringify([{ walletId: wallet, amountMinor: '10000' }])],
      );
      await db().client.query(
        "select * from public.reverse_financial_event($1,$2,$3,'2026-09-10') limit 2",
        [v01Space, randomUUID(), event.rows[0]!.id],
      );
      const report = await db().client.query<{ income: string; delta: string }>(
        `select income_net_minor::text income, wallet_delta_net_minor::text delta
         from public.report_monthly_cash_summary($1,'2026-09-01') where period_role='current' and currency='USD' limit 2`,
        [v01Space],
      );
      expect(report.rows).toEqual([{ income: '0', delta: '0' }]);
    });
  });

  it('V02 keeps a cross-period reversal in the period it was recorded, not the original (USD)', async () => {
    const v02Space = await freshSpace('V02 cross period');
    const wallet = await usdWallet(v02Space);
    await withAuthenticatedTransaction(db().client, actor, async () => {
      const event = await db().client.query<{ id: string }>(
        `select id from public.record_financial_event($1, $2, 'expense', '2026-08-15', $3::jsonb) limit 2`,
        [v02Space, randomUUID(), JSON.stringify([{ walletId: wallet, amountMinor: '-5000' }])],
      );
      await db().client.query(
        "select * from public.reverse_financial_event($1,$2,$3,'2026-09-05') limit 2",
        [v02Space, randomUUID(), event.rows[0]!.id],
      );
      const report = await db().client.query<{ role: string; expense: string }>(
        `select period_role role, expense_net_minor::text expense
         from public.report_monthly_cash_summary($1,'2026-09-01') where currency='USD' order by period_role`,
        [v02Space],
      );
      expect(report.rows).toEqual([
        { role: 'current', expense: '-5000' },
        { role: 'previous', expense: '5000' },
      ]);
    });
  });

  it('V03 rolls a subcategory expense into its root budget target', async () => {
    const v03Space = await freshSpace('V03 rollup');
    const wallet = await usdWallet(v03Space);
    await withAuthenticatedTransaction(db().client, actor, async () => {
      const root = await db().client.query<{ id: string }>(
        "select id from public.create_category($1,$2,'expense','Essentials',null) limit 2", [v03Space, randomUUID()],
      );
      const rootId = root.rows[0]!.id;
      const child = await db().client.query<{ id: string }>(
        "select id from public.create_subcategory($1,$2,$3,'Food',null) limit 2", [v03Space, randomUUID(), rootId],
      );
      const childId = child.rows[0]!.id;
      await db().client.query(
        "select * from public.set_monthly_category_target($1,$2,$3,'2026-09-01','USD','10000',null) limit 2",
        [v03Space, randomUUID(), rootId],
      );
      await db().client.query(
        `select id from public.record_categorized_financial_event($1,$2,'expense','2026-09-10',$3::jsonb,$4) limit 2`,
        [v03Space, randomUUID(), JSON.stringify([{ walletId: wallet, amountMinor: '-3000' }]), childId],
      );
      const rootReport = await db().client.query<{ actual: string; budget: string; remaining: string }>(
        `select actual_net_minor::text actual, budget_minor::text budget, remaining_minor::text remaining
         from public.report_category_actual_vs_budget($1,'2026-09-01') where currency='USD' and category_key=$2`,
        [v03Space, rootId],
      );
      expect(rootReport.rows).toEqual([{ actual: '3000', budget: '10000', remaining: '7000' }]);
      const childReport = await db().client.query(
        `select 1 from public.report_category_actual_vs_budget($1,'2026-09-01') where currency='USD' and category_key=$2`,
        [v03Space, childId],
      );
      expect(childReport.rows).toEqual([]);
    });
  });

  it('V04 rejects a monthly budget target on a subcategory, at the RPC and at the constraint layer', async () => {
    const v04Space = await freshSpace('V04 root only');
    const childId = await withAuthenticatedTransaction(db().client, actor, async () => {
      const root = await db().client.query<{ id: string }>(
        "select id from public.create_category($1,$2,'expense','Essentials',null) limit 2", [v04Space, randomUUID()],
      );
      const child = await db().client.query<{ id: string }>(
        "select id from public.create_subcategory($1,$2,$3,'Food',null) limit 2", [v04Space, randomUUID(), root.rows[0]!.id],
      );
      await expectSavepointRejection(
        db().client,
        () => db().client.query(
          "select * from public.set_monthly_category_target($1,$2,$3,'2026-09-01','USD','100',null)",
          [v04Space, randomUUID(), child.rows[0]!.id],
        ),
        { code: 'P0001' },
      );
      return child.rows[0]!.id;
    });
    // Constraint layer: simulate the RPC/privilege boundary failing by
    // inserting directly as the owning role (bypassing the RPC and the
    // revoked authenticated grants) to prove the trigger alone still blocks.
    await withRollback(db().client, () => expect(db().client.query(
      `insert into public.monthly_budget_plan_revisions (
         space_id, request_id, request_fingerprint, plan_kind, month_start, currency,
         category_id, category_kind, amount_minor, actor_id
       ) values ($1, $2, decode('00','hex'), 'expense_category', '2026-09-01', 'USD', $3, 'expense', 100, $4)`,
      [v04Space, randomUUID(), childId, actor],
    )).rejects.toMatchObject({ code: 'P0001' }));
  });

  it('V05 report_category_actual_vs_budget succeeds without a raw SELECT grant on plan history', async () => {
    const privilege = await db().client.query<{ has_select: boolean }>(
      `select has_table_privilege('authenticated', 'public.monthly_budget_plan_revisions', 'SELECT') has_select`,
    );
    expect(privilege.rows[0]!.has_select).toBe(false);
    const v05Space = await freshSpace('V05 definer read');
    await withAuthenticatedTransaction(db().client, actor, async () => {
      const category = await db().client.query<{ id: string }>(
        "select id from public.create_category($1,$2,'expense','Rent',null) limit 2", [v05Space, randomUUID()],
      );
      await db().client.query(
        "select * from public.set_monthly_category_target($1,$2,$3,'2026-09-01','USD','5000',null) limit 2",
        [v05Space, randomUUID(), category.rows[0]!.id],
      );
      const report = await db().client.query<{ budget: string }>(
        "select budget_minor::text budget from public.report_category_actual_vs_budget($1,'2026-09-01') where currency='USD' and category_key=$2",
        [v05Space, category.rows[0]!.id],
      );
      expect(report.rows).toEqual([{ budget: '5000' }]);
    });
  });

  it('V06 denies an outsider, a removed member, a null month, and a null page limit', async () => {
    const member = randomUUID();
    await db().client.query(
      `insert into auth.users(id, email, email_confirmed_at) values ($1,'v06-member@budget.invalid', now())`,
      [member],
    );
    const v06Space = await freshSpace('V06 access', 'household');
    await db().client.query(
      `insert into public.space_memberships (space_id, user_id, role, status) values ($1,$2,'member','active')`,
      [v06Space, member],
    );

    await expect(withAuthenticatedTransaction(db().client, outsider, () =>
      db().client.query("select * from public.report_category_actual_vs_budget($1,'2026-09-01')", [v06Space]),
    )).rejects.toMatchObject({ code: '42501' });

    await db().client.query(
      `update public.space_memberships set status='revoked', ended_at=now(), ended_by_user_id=$1
       where space_id=$2 and user_id=$3`,
      [actor, v06Space, member],
    );
    await expect(withAuthenticatedTransaction(db().client, member, () =>
      db().client.query("select * from public.report_category_actual_vs_budget($1,'2026-09-01')", [v06Space]),
    )).rejects.toMatchObject({ code: '42501' });

    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query("select * from public.report_category_actual_vs_budget($1, null::date)", [v06Space]),
    )).rejects.toMatchObject({ code: '42501' });

    await expect(withAuthenticatedTransaction(db().client, actor, () =>
      db().client.query(
        "select * from public.report_wallet_activity($1,'2026-09-01','2026-09-30', null::uuid, null::public.currency_code, null::integer)",
        [v06Space],
      ),
    )).rejects.toMatchObject({ code: '42501' });
  });

  it('V07 pages 101 root category rows with complete, duplicate-free, tie-broken cursors', async () => {
    const v07Space = await freshSpace('V07 pagination');
    const total = 101;
    const categoryIds: string[] = [];
    await withAuthenticatedTransaction(db().client, actor, async () => {
      for (let index = 0; index < total; index += 1) {
        const category = await db().client.query<{ id: string }>(
          "select id from public.create_category($1,$2,'expense',$3,null) limit 2",
          [v07Space, randomUUID(), `Root ${index.toString().padStart(3, '0')}`],
        );
        const categoryId = category.rows[0]!.id;
        categoryIds.push(categoryId);
        await db().client.query(
          "select * from public.set_monthly_category_target($1,$2,$3,'2026-09-01','USD','1000',null) limit 2",
          [v07Space, randomUUID(), categoryId],
        );
      }
    });
    // now() is transaction-stable, and every category above was created in
    // one transaction, so all 101 rows share the exact same created_at: the
    // strongest possible tie, proving the (created_at, category_id, currency)
    // composite cursor -- not the timestamp alone -- separates every row.
    let cursor: { created_at: string; category_id: string; currency: string } | null = null;
    const pages: number[] = [];
    const seen = new Set<string>();
    await withAuthenticatedTransaction(db().client, actor, async () => {
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await db().client.query<{
        category_id: string; category_created_at: string; currency: string; has_more: boolean;
      }>(
        `select category_id, category_created_at, currency, has_more
         from public.monthly_budget_category_page_v2($1,'2026-09-01',$2,$3,$4,50)`,
        [v07Space, cursor?.created_at ?? null, cursor?.category_id ?? null, cursor?.currency ?? null],
      );
      pages.push(page.rows.length);
      for (const row of page.rows) {
        const key = `${row.category_id}:${row.currency}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      const last = page.rows.at(-1);
      if (!last || last.has_more !== true) break;
      cursor = { created_at: last.category_created_at, category_id: last.category_id, currency: last.currency };
    }
    });
    expect(pages).toEqual([50, 50, 1]);
    expect(seen.size).toBe(total);
  });

  it('V08 keeps ordinary income and expense at zero for opening/transfer/exchange/loan-borrow events', async () => {
    const v08Space = await freshSpace('V08 non-ordinary kinds');
    const usd = await usdWallet(v08Space);
    const lbp = await withAuthenticatedTransaction(db().client, actor, async () => {
      const wallet = await db().client.query<{ id: string }>(
        "select id from public.create_wallet($1, 'LBP cash', 'LBP') limit 2", [v08Space],
      );
      return wallet.rows[0]!.id;
    });
    await withAuthenticatedTransaction(db().client, actor, async () => {
      await db().client.query(
        `select id from public.record_financial_event($1, $2, 'opening_balance', '2026-09-01', $3::jsonb)`,
        [v08Space, randomUUID(), JSON.stringify([{ walletId: usd, amountMinor: '100000' }])],
      );
      const other = await db().client.query<{ id: string }>(
        "select id from public.create_wallet($1, 'Other cash', 'USD') limit 2", [v08Space],
      );
      await db().client.query(
        `select id from public.record_financial_event($1, $2, 'transfer', '2026-09-02', $3::jsonb)`,
        [v08Space, randomUUID(), JSON.stringify([
          { walletId: usd, amountMinor: '-1000' },
          { walletId: other.rows[0]!.id, amountMinor: '1000' },
        ])],
      );
      await db().client.query(
        `select * from public.record_usd_to_lbp_exchange($1, $2, $3, $4, '2500', '225000000', '2026-09-03')`,
        [v08Space, randomUUID(), usd, lbp],
      );
      await db().client.query(
        `select loan_id, event_id from public.record_cash_loan($1, $2, 'i_owe_them', 'Karim', 'USD', $3, '5000', '2026-09-04')`,
        [v08Space, randomUUID(), usd],
      );

      const report = await db().client.query<{ income: string; expense: string }>(
        `select income_net_minor::text income, expense_net_minor::text expense
         from public.report_monthly_cash_summary($1,'2026-09-01') where period_role='current' and currency='USD' limit 2`,
        [v08Space],
      );
      expect(report.rows).toEqual([{ income: '0', expense: '0' }]);
    });
  });

  it('bounds every financial_event_kind to a literal ordinary/transfer/exchange/loan/opening/reversal classification', async () => {
    const classification: Record<string, 'ordinary_income' | 'ordinary_expense' | 'transfer' | 'exchange' | 'loan' | 'opening' | 'reversal'> = {
      income: 'ordinary_income',
      expense: 'ordinary_expense',
      transfer: 'transfer',
      exchange: 'exchange',
      opening_balance: 'opening',
      reversal: 'reversal',
      loan_opening: 'loan',
      loan_lend: 'loan',
      loan_borrow: 'loan',
      loan_receive_repayment: 'loan',
      loan_repay_borrowing: 'loan',
    };
    const kinds = await db().client.query<{ kind: string }>(
      `select enumlabel as kind from pg_catalog.pg_enum
       where enumtypid = 'public.financial_event_kind'::regtype
       order by enumsortorder`,
    );
    for (const row of kinds.rows) {
      expect(classification[row.kind], `unclassified financial_event_kind: ${row.kind}`).toBeDefined();
    }
    expect(kinds.rows.map((row) => row.kind).sort()).toEqual(Object.keys(classification).sort());
  });
});
