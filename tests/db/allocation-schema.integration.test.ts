import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction, withRollback, expectSavepointRejection, inTransaction,
  type DisposableDatabase,
} from './disposable-database.js';

let database: DisposableDatabase | undefined;
const actor = randomUUID();

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_allocation');
  await bootstrapCompatibilityObjects(db().client);
  await replayMigrations(db().client, migrationFiles());
  await db().client.query(
    `insert into auth.users(id, email, email_confirmed_at) values ($1, 'owner@budget.invalid', now())`,
    [actor],
  );
}, 120_000);

afterAll(async () => {
  if (database) await disposeDisposableDatabase(database);
}, 30_000);

async function freshSpace(name: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const space = await db().client.query<{ id: string }>(
      "select id from public.create_space($1, 'personal') limit 2", [name],
    );
    return space.rows[0]!.id;
  });
}

async function expenseRootCategory(spaceId: string, name: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const category = await db().client.query<{ id: string }>(
      "select id from public.create_category($1,$2,'expense',$3,null) limit 2", [spaceId, randomUUID(), name],
    );
    return category.rows[0]!.id;
  });
}

async function incomeCategory(spaceId: string, name: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const category = await db().client.query<{ id: string }>(
      "select id from public.create_category($1,$2,'income',$3,null) limit 2", [spaceId, randomUUID(), name],
    );
    return category.rows[0]!.id;
  });
}

async function subcategoryOf(spaceId: string, parentId: string, name: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const category = await db().client.query<{ id: string }>(
      "select id from public.create_subcategory($1,$2,$3,$4,null) limit 2", [spaceId, randomUUID(), parentId, name],
    );
    return category.rows[0]!.id;
  });
}

// Direct owner-level inserts below intentionally bypass the not-yet-existing
// task 05 command RPCs, per the task file: "public commands do not yet exist,
// seed valid normalized rows as admin solely in disposable tests."
async function insertGroup(spaceId: string, currency: 'USD' | 'LBP', purpose: 'spending' | 'future'): Promise<string> {
  const id = randomUUID();
  await db().client.query(
    'insert into public.allocation_groups (id, space_id, currency, purpose, actor_id) values ($1,$2,$3,$4,$5)',
    [id, spaceId, currency, purpose, actor],
  );
  return id;
}

async function insertTemplateRevision(input: {
  spaceId: string; currency: 'USD' | 'LBP'; expectedRevisionId?: number | null; groupCount: number; rootCount: number;
}): Promise<number> {
  const result = await db().client.query<{ id: string }>(
    `insert into public.allocation_template_revisions
       (space_id, currency, expected_revision_id, group_count, root_count, request_id, actor_id)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [input.spaceId, input.currency, input.expectedRevisionId ?? null, input.groupCount, input.rootCount, randomUUID(), actor],
  );
  return Number(result.rows[0]!.id);
}

async function insertTemplateLine(input: {
  templateId: number; groupId: string; spaceId: string; currency: 'USD' | 'LBP'; nameEn: string; displayOrder: number; basisPoints: number;
}): Promise<void> {
  await db().client.query(
    `insert into public.allocation_template_lines
       (template_id, group_id, space_id, currency, name_en, display_order, basis_points)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [input.templateId, input.groupId, input.spaceId, input.currency, input.nameEn, input.displayOrder, input.basisPoints],
  );
}

async function insertTemplateRoot(input: {
  templateId: number; categoryId: string; groupId: string; spaceId: string; currency: 'USD' | 'LBP';
}): Promise<void> {
  await db().client.query(
    `insert into public.allocation_template_roots (template_id, category_id, group_id, space_id, currency)
     values ($1,$2,$3,$4,$5)`,
    [input.templateId, input.categoryId, input.groupId, input.spaceId, input.currency],
  );
}

// SET CONSTRAINTS ALL IMMEDIATE checks now, but it also switches every
// deferrable constraint's MODE to immediate for the rest of the transaction
// -- an unrelated later insert (e.g. the month snapshot header, checked
// after templateFixture already forced its own template check) would then
// fire its deferred trigger right away, before its children exist. Re-defer
// immediately after a successful check so later inserts stay deferred.
async function forceDeferred(): Promise<void> {
  await db().client.query('set constraints all immediate');
  await db().client.query('set constraints all deferred');
}

describe('allocation schema: groups and templates', () => {
  it('accepts a valid template: one spending group, one root category, matching counts', async () => {
    const spaceId = await freshSpace('Template valid path');
    const category = await expenseRootCategory(spaceId, 'Essentials');
    await withRollback(db().client, async () => {
      const groupId = await insertGroup(spaceId, 'USD', 'spending');
      const templateId = await insertTemplateRevision({ spaceId, currency: 'USD', groupCount: 1, rootCount: 1 });
      await insertTemplateLine({ templateId, groupId, spaceId, currency: 'USD', nameEn: 'Essentials', displayOrder: 0, basisPoints: 10000 });
      await insertTemplateRoot({ templateId, categoryId: category, groupId, spaceId, currency: 'USD' });
      await forceDeferred();
    });
  });

  it('rejects a template line referencing a group from a different space (FK, not the deferred check)', async () => {
    const spaceId = await freshSpace('Template cross-space FK');
    const otherSpaceId = await freshSpace('Template cross-space FK other');
    await withRollback(db().client, async () => {
      const foreignGroupId = await insertGroup(otherSpaceId, 'USD', 'spending');
      const templateId = await insertTemplateRevision({ spaceId, currency: 'USD', groupCount: 1, rootCount: 0 });
      await expectSavepointRejection(
        db().client,
        () => insertTemplateLine({ templateId, groupId: foreignGroupId, spaceId, currency: 'USD', nameEn: 'X', displayOrder: 0, basisPoints: 100 }),
        { code: '23503' },
      );
    });
  });

  it('rejects an income-kind category as a template root', async () => {
    const spaceId = await freshSpace('Template income root rejected');
    const income = await incomeCategory(spaceId, 'Salary');
    await withRollback(db().client, async () => {
      const groupId = await insertGroup(spaceId, 'USD', 'spending');
      const templateId = await insertTemplateRevision({ spaceId, currency: 'USD', groupCount: 1, rootCount: 1 });
      await insertTemplateLine({ templateId, groupId, spaceId, currency: 'USD', nameEn: 'G', displayOrder: 0, basisPoints: 100 });
      await expectSavepointRejection(
        db().client,
        () => db().client.query(
          'insert into public.allocation_template_roots (template_id, category_id, group_id, space_id, currency) values ($1,$2,$3,$4,$5)',
          [templateId, income, groupId, spaceId, 'USD'],
        ),
        { code: '23503' },
      );
    });
  });

  it('rejects a subcategory (non-root) as a template root', async () => {
    const spaceId = await freshSpace('Template subcategory root rejected');
    const root = await expenseRootCategory(spaceId, 'Essentials');
    const child = await subcategoryOf(spaceId, root, 'Food');
    await withRollback(db().client, async () => {
      const groupId = await insertGroup(spaceId, 'USD', 'spending');
      const templateId = await insertTemplateRevision({ spaceId, currency: 'USD', groupCount: 1, rootCount: 1 });
      await insertTemplateLine({ templateId, groupId, spaceId, currency: 'USD', nameEn: 'G', displayOrder: 0, basisPoints: 100 });
      await insertTemplateRoot({ templateId, categoryId: child, groupId, spaceId, currency: 'USD' });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'allocation_template_root_category_or_purpose_invalid' });
    });
  });

  it('rejects a duplicate display_order within one template', async () => {
    const spaceId = await freshSpace('Template duplicate order');
    await withRollback(db().client, async () => {
      const groupA = await insertGroup(spaceId, 'USD', 'spending');
      const groupB = await insertGroup(spaceId, 'USD', 'spending');
      const templateId = await insertTemplateRevision({ spaceId, currency: 'USD', groupCount: 2, rootCount: 0 });
      await insertTemplateLine({ templateId, groupId: groupA, spaceId, currency: 'USD', nameEn: 'A', displayOrder: 0, basisPoints: 100 });
      await expectSavepointRejection(
        db().client,
        () => insertTemplateLine({ templateId, groupId: groupB, spaceId, currency: 'USD', nameEn: 'B', displayOrder: 0, basisPoints: 100 }),
        { code: '23505' },
      );
    });
  });

  it('rejects a 13th group on one template (group_count cap)', async () => {
    const spaceId = await freshSpace('Template 13 groups');
    await withRollback(db().client, async () => {
      await expectSavepointRejection(
        db().client,
        () => insertTemplateRevision({ spaceId, currency: 'USD', groupCount: 13, rootCount: 0 }),
        { code: '23514' },
      );
    });
  });

  it('rejects a 201st root on one template (root_count cap)', async () => {
    const spaceId = await freshSpace('Template 201 roots');
    await withRollback(db().client, async () => {
      await expectSavepointRejection(
        db().client,
        () => insertTemplateRevision({ spaceId, currency: 'USD', groupCount: 0, rootCount: 201 }),
        { code: '23514' },
      );
    });
  });

  it('rejects a template whose lines sum to 10001 basis points', async () => {
    const spaceId = await freshSpace('Template over 10000 bps');
    await withRollback(db().client, async () => {
      const groupA = await insertGroup(spaceId, 'USD', 'spending');
      const groupB = await insertGroup(spaceId, 'USD', 'spending');
      const templateId = await insertTemplateRevision({ spaceId, currency: 'USD', groupCount: 2, rootCount: 0 });
      await insertTemplateLine({ templateId, groupId: groupA, spaceId, currency: 'USD', nameEn: 'A', displayOrder: 0, basisPoints: 5000 });
      await insertTemplateLine({ templateId, groupId: groupB, spaceId, currency: 'USD', nameEn: 'B', displayOrder: 1, basisPoints: 5001 });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'allocation_template_group_count_or_bps_invalid' });
    });
  });

  it('rejects a second initial (predecessor-null) template revision for the same space and currency', async () => {
    const spaceId = await freshSpace('Template initial fork');
    await withRollback(db().client, async () => {
      await insertTemplateRevision({ spaceId, currency: 'USD', groupCount: 0, rootCount: 0 });
      await expectSavepointRejection(
        db().client,
        () => insertTemplateRevision({ spaceId, currency: 'USD', groupCount: 0, rootCount: 0 }),
        { code: '23505' },
      );
    });
  });

  it('rejects two successor revisions naming the same predecessor', async () => {
    const spaceId = await freshSpace('Template successor fork');
    await withRollback(db().client, async () => {
      const first = await insertTemplateRevision({ spaceId, currency: 'USD', groupCount: 0, rootCount: 0 });
      await forceDeferred();
      await insertTemplateRevision({ spaceId, currency: 'USD', expectedRevisionId: first, groupCount: 0, rootCount: 0 });
      await forceDeferred();
      await expectSavepointRejection(
        db().client,
        () => insertTemplateRevision({ spaceId, currency: 'USD', expectedRevisionId: first, groupCount: 0, rootCount: 0 }),
        { code: '23505' },
      );
    });
  });

  it('rejects a header that declares more groups than were actually inserted', async () => {
    const spaceId = await freshSpace('Template missing child');
    await withRollback(db().client, async () => {
      const groupId = await insertGroup(spaceId, 'USD', 'spending');
      const templateId = await insertTemplateRevision({ spaceId, currency: 'USD', groupCount: 2, rootCount: 0 });
      await insertTemplateLine({ templateId, groupId, spaceId, currency: 'USD', nameEn: 'Only one', displayOrder: 0, basisPoints: 100 });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'allocation_template_group_count_or_bps_invalid' });
    });
  });

  it('the owner-only INSERT guard denies an authenticated insert even with a temporary grant and permissive RLS', async () => {
    const spaceId = await freshSpace('Guard probe space');
    await withRollback(db().client, async () => {
      await db().client.query('grant insert on public.allocation_groups to authenticated');
      await db().client.query(
        `create policy allocation_groups_permissive_probe on public.allocation_groups
         for insert to authenticated with check (true)`,
      );
      await withAuthenticatedTransaction(db().client, actor, () =>
        expect(db().client.query(
          'insert into public.allocation_groups (id, space_id, currency, purpose, actor_id) values ($1,$2,$3,$4,$5)',
          [randomUUID(), spaceId, 'USD', 'spending', actor],
        )).rejects.toMatchObject({ code: '42501', message: 'planning_command_required' }));
    });
  });

  it('rejects a zero-row DELETE on allocation_groups', async () => {
    await withRollback(db().client, () => expectSavepointRejection(
      db().client,
      () => db().client.query("delete from public.allocation_groups where id = 'ffffffff-ffff-ffff-ffff-fffffffffffe'"),
      { code: '42501', message: 'planning_history_immutable' },
    ));
  });
});

async function planIncome(spaceId: string, month: string, currency: 'USD' | 'LBP', amountMinor: string): Promise<number> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ id: string }>(
      'select * from public.set_monthly_income_plan($1,$2,$3::date,$4,$5,null)',
      [spaceId, randomUUID(), month, currency, amountMinor],
    );
    return Number(result.rows[0]!.id);
  });
}

async function planCategoryTarget(spaceId: string, categoryId: string, month: string, currency: 'USD' | 'LBP', amountMinor: string): Promise<number> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ id: string }>(
      'select * from public.set_monthly_category_target($1,$2,$3,$4::date,$5,$6,null)',
      [spaceId, randomUUID(), categoryId, month, currency, amountMinor],
    );
    return Number(result.rows[0]!.id);
  });
}

async function insertMonthSnapshot(input: {
  spaceId: string; currency: 'USD' | 'LBP'; month: string; templateRevisionId: number; incomePlanRevisionId: number;
  expectedSnapshotId?: number | null; baseIncomeMinor: string; unallocatedMinor: string;
  groupCount: number; rootCount: number; loanLineCount: number;
}): Promise<number> {
  const result = await db().client.query<{ id: string }>(
    `insert into public.allocation_month_snapshots
       (space_id, currency, month_start, template_revision_id, income_plan_revision_id, expected_snapshot_id,
        base_income_minor, unallocated_minor, group_count, root_count, loan_line_count, request_id, actor_id)
     values ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
    [input.spaceId, input.currency, input.month, input.templateRevisionId, input.incomePlanRevisionId,
      input.expectedSnapshotId ?? null, input.baseIncomeMinor, input.unallocatedMinor,
      input.groupCount, input.rootCount, input.loanLineCount, randomUUID(), actor],
  );
  return Number(result.rows[0]!.id);
}

async function insertMonthGroup(input: {
  snapshotId: number; groupId: string; spaceId: string; currency: 'USD' | 'LBP'; nameEn: string;
  purpose: 'spending' | 'future'; displayOrder: number; basisPoints: number; targetMinor: string;
}): Promise<void> {
  await db().client.query(
    `insert into public.allocation_month_groups
       (snapshot_id, group_id, space_id, currency, name_en, purpose, display_order, basis_points, target_minor)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [input.snapshotId, input.groupId, input.spaceId, input.currency, input.nameEn, input.purpose,
      input.displayOrder, input.basisPoints, input.targetMinor],
  );
}

async function insertMonthRoot(input: {
  snapshotId: number; categoryId: string; groupId: string | null; spaceId: string; currency: 'USD' | 'LBP';
  targetRevisionId: number; targetMinor: string;
}): Promise<void> {
  await db().client.query(
    `insert into public.allocation_month_roots
       (snapshot_id, category_id, group_id, space_id, currency, target_revision_id, target_minor)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [input.snapshotId, input.categoryId, input.groupId, input.spaceId, input.currency, input.targetRevisionId, input.targetMinor],
  );
}

async function insertMonthCommitment(input: {
  snapshotId: number; spaceId: string; currency: 'USD' | 'LBP'; groupId: string | null;
  observedActualMinor: string; observedRemainingMinor: string;
}): Promise<void> {
  await db().client.query(
    `insert into public.allocation_month_commitments
       (snapshot_id, space_id, currency, group_id, source_kind, observed_actual_minor, observed_remaining_minor)
     values ($1,$2,$3,$4,'loan_pool',$5,$6)`,
    [input.snapshotId, input.spaceId, input.currency, input.groupId, input.observedActualMinor, input.observedRemainingMinor],
  );
}

/** One root category + spending group + template, ready for a month snapshot. */
// Raw owner-level inserts only (no withAuthenticatedTransaction inside): safe
// to call from within an already-open withRollback/inTransaction block, since
// withAuthenticatedTransaction's own BEGIN/COMMIT would otherwise commit
// whatever outer transaction is already open (Postgres has no real nested
// BEGIN). `category` must already exist, created before that outer block.
async function templateFixture(spaceId: string, category: string, currency: 'USD' | 'LBP' = 'USD') {
  const groupId = await insertGroup(spaceId, currency, 'spending');
  const templateId = await insertTemplateRevision({ spaceId, currency, groupCount: 1, rootCount: 1 });
  await insertTemplateLine({ templateId, groupId, spaceId, currency, nameEn: 'Essentials', displayOrder: 0, basisPoints: 8000 });
  await insertTemplateRoot({ templateId, categoryId: category, groupId, spaceId, currency });
  await forceDeferred();
  return { category, groupId, templateId };
}

describe('allocation schema: month snapshots', () => {
  it('accepts a valid month snapshot: income, one grouped root, sums balance exactly', async () => {
    const spaceId = await freshSpace('Month valid path');
    const category = await expenseRootCategory(spaceId, 'Essentials');
    const income = await planIncome(spaceId, '2026-09-01', 'USD', '100000');
    const target = await planCategoryTarget(spaceId, category, '2026-09-01', 'USD', '80000');
    await withRollback(db().client, async () => {
      const { groupId, templateId } = await templateFixture(spaceId, category);
      const snapshotId = await insertMonthSnapshot({
        spaceId, currency: 'USD', month: '2026-09-01', templateRevisionId: templateId, incomePlanRevisionId: income,
        baseIncomeMinor: '100000', unallocatedMinor: '20000', groupCount: 1, rootCount: 1, loanLineCount: 0,
      });
      await insertMonthGroup({
        snapshotId, groupId, spaceId, currency: 'USD', nameEn: 'Essentials', purpose: 'spending',
        displayOrder: 0, basisPoints: 8000, targetMinor: '80000',
      });
      await insertMonthRoot({ snapshotId, categoryId: category, groupId, spaceId, currency: 'USD', targetRevisionId: target, targetMinor: '80000' });
      await forceDeferred();
    });
  });

  it('rejects an income_plan_revision_id that points at an expense_category revision', async () => {
    const spaceId = await freshSpace('Month wrong plan kind');
    const category = await expenseRootCategory(spaceId, 'Essentials');
    const wrongKindRevision = await planCategoryTarget(spaceId, category, '2026-09-01', 'USD', '1');
    await withRollback(db().client, async () => {
      const { templateId } = await templateFixture(spaceId, category);
      await expectSavepointRejection(
        db().client,
        () => insertMonthSnapshot({
          spaceId, currency: 'USD', month: '2026-09-01', templateRevisionId: templateId, incomePlanRevisionId: wrongKindRevision,
          baseIncomeMinor: '1', unallocatedMinor: '1', groupCount: 0, rootCount: 0, loanLineCount: 0,
        }).then(forceDeferred),
        { code: '23514', message: 'allocation_month_income_revision_invalid' },
      );
    });
  });

  it('rejects a group target sum plus unallocated that does not equal base income', async () => {
    const spaceId = await freshSpace('Month apportionment mismatch');
    const category = await expenseRootCategory(spaceId, 'Essentials');
    const income = await planIncome(spaceId, '2026-09-01', 'USD', '100000');
    await withRollback(db().client, async () => {
      const { groupId, templateId } = await templateFixture(spaceId, category);
      const snapshotId = await insertMonthSnapshot({
        spaceId, currency: 'USD', month: '2026-09-01', templateRevisionId: templateId, incomePlanRevisionId: income,
        baseIncomeMinor: '100000', unallocatedMinor: '20000', groupCount: 1, rootCount: 0, loanLineCount: 0,
      });
      await insertMonthGroup({
        snapshotId, groupId, spaceId, currency: 'USD', nameEn: 'Essentials', purpose: 'spending',
        displayOrder: 0, basisPoints: 8000, targetMinor: '75000',
      });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'allocation_month_apportionment_mismatch' });
    });
  });

  it('rejects a root whose target exceeds its group\'s target (overallocated)', async () => {
    const spaceId = await freshSpace('Month root overallocated');
    const category = await expenseRootCategory(spaceId, 'Essentials');
    const income = await planIncome(spaceId, '2026-09-01', 'USD', '100000');
    const target = await planCategoryTarget(spaceId, category, '2026-09-01', 'USD', '90000');
    await withRollback(db().client, async () => {
      const { groupId, templateId } = await templateFixture(spaceId, category);
      const snapshotId = await insertMonthSnapshot({
        spaceId, currency: 'USD', month: '2026-09-01', templateRevisionId: templateId, incomePlanRevisionId: income,
        baseIncomeMinor: '100000', unallocatedMinor: '20000', groupCount: 1, rootCount: 1, loanLineCount: 0,
      });
      await insertMonthGroup({
        snapshotId, groupId, spaceId, currency: 'USD', nameEn: 'Essentials', purpose: 'spending',
        displayOrder: 0, basisPoints: 8000, targetMinor: '80000',
      });
      await insertMonthRoot({ snapshotId, categoryId: category, groupId, spaceId, currency: 'USD', targetRevisionId: target, targetMinor: '90000' });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'allocation_month_group_overallocated' });
    });
  });

  it('rejects a loan-pool commitment against a spending-purpose group', async () => {
    const spaceId = await freshSpace('Month commitment wrong purpose');
    const category = await expenseRootCategory(spaceId, 'Essentials');
    const income = await planIncome(spaceId, '2026-09-01', 'USD', '100000');
    await withRollback(db().client, async () => {
      const { groupId, templateId } = await templateFixture(spaceId, category);
      const snapshotId = await insertMonthSnapshot({
        spaceId, currency: 'USD', month: '2026-09-01', templateRevisionId: templateId, incomePlanRevisionId: income,
        baseIncomeMinor: '100000', unallocatedMinor: '20000', groupCount: 1, rootCount: 0, loanLineCount: 1,
        expectedSnapshotId: null,
      });
      await insertMonthGroup({
        snapshotId, groupId, spaceId, currency: 'USD', nameEn: 'Essentials', purpose: 'spending',
        displayOrder: 0, basisPoints: 8000, targetMinor: '80000',
      });
      await insertMonthCommitment({ snapshotId, spaceId, currency: 'USD', groupId, observedActualMinor: '1000', observedRemainingMinor: '0' });
      await expectSavepointRejection(db().client, forceDeferred, { code: '23514', message: 'allocation_month_commitment_invalid' });
    });
  });

  it('rejects a snapshot claiming a superseded predecessor, even if the unique successor index is not there to catch it', async () => {
    // The partial unique index on expected_snapshot_id already prevents two
    // rows from claiming the same predecessor, which is the only ordinary way
    // to reach a "not the head" predecessor -- so this check's own branch is
    // otherwise unreachable in a test. Drop the index (DDL is transactional;
    // withRollback restores it) to prove check_allocation_month's own
    // head comparison independently catches it, not just the index.
    const spaceId = await freshSpace('Month stale predecessor bypasses index');
    const category = await expenseRootCategory(spaceId, 'Essentials');
    const income = await planIncome(spaceId, '2026-09-01', 'USD', '0');
    await withRollback(db().client, async () => {
      const { templateId } = await templateFixture(spaceId, category);
      const first = await insertMonthSnapshot({
        spaceId, currency: 'USD', month: '2026-09-01', templateRevisionId: templateId, incomePlanRevisionId: income,
        baseIncomeMinor: '0', unallocatedMinor: '0', groupCount: 0, rootCount: 0, loanLineCount: 0,
      });
      await forceDeferred();
      const second = await insertMonthSnapshot({
        spaceId, currency: 'USD', month: '2026-09-01', templateRevisionId: templateId, incomePlanRevisionId: income,
        expectedSnapshotId: first, baseIncomeMinor: '0', unallocatedMinor: '0', groupCount: 0, rootCount: 0, loanLineCount: 0,
      });
      await forceDeferred();
      expect(second).toBeGreaterThan(first);
      await db().client.query('drop index public.allocation_month_successor_idx');
      await expectSavepointRejection(
        db().client,
        () => insertMonthSnapshot({
          spaceId, currency: 'USD', month: '2026-09-01', templateRevisionId: templateId, incomePlanRevisionId: income,
          expectedSnapshotId: first, baseIncomeMinor: '0', unallocatedMinor: '0', groupCount: 0, rootCount: 0, loanLineCount: 0,
        }).then(forceDeferred),
        { code: '23514', message: 'allocation_month_predecessor_not_head' },
      );
    });
  });

  it('rejects a late root inserted into an already-committed snapshot from a separate transaction', async () => {
    const spaceId = await freshSpace('Month late child');
    const category = await expenseRootCategory(spaceId, 'Essentials');
    const income = await planIncome(spaceId, '2026-09-01', 'USD', '100000');
    // Committed for real (inTransaction commits, unlike withRollback): this
    // snapshot persists into a genuinely separate later transaction below.
    const { snapshotId } = await inTransaction(db().client, async () => {
      const fixture = await templateFixture(spaceId, category);
      const snapshot = await insertMonthSnapshot({
        spaceId, currency: 'USD', month: '2026-09-01', templateRevisionId: fixture.templateId, incomePlanRevisionId: income,
        baseIncomeMinor: '100000', unallocatedMinor: '100000', groupCount: 0, rootCount: 0, loanLineCount: 0,
      });
      await forceDeferred();
      return { snapshotId: snapshot };
    });
    const target = await planCategoryTarget(spaceId, category, '2026-09-01', 'USD', '1000');
    // groupId: null (a standalone, ungrouped root) -- the committed snapshot
    // has zero month_groups, so referencing any real group would fail on the
    // (snapshot_id,group_id,...) FK before the count-mismatch check ever runs.
    await withRollback(db().client, () => expectSavepointRejection(
      db().client,
      () => insertMonthRoot({ snapshotId, categoryId: category, groupId: null, spaceId, currency: 'USD', targetRevisionId: target, targetMinor: '1000' }).then(forceDeferred),
      { code: '23514', message: 'allocation_month_root_count_mismatch' },
    ));
  });
});
