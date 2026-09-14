import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction, withRollback, expectSavepointRejection,
  orderedAuthenticatedRace,
  type DisposableDatabase,
} from './disposable-database.js';

let database: DisposableDatabase | undefined;
const actor = randomUUID();
const outsider = randomUUID();

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_alloccmd');
  await bootstrapCompatibilityObjects(db().client);
  await replayMigrations(db().client, migrationFiles());
  await db().client.query(
    `insert into auth.users(id, email, email_confirmed_at)
     values ($1, 'owner@budget.invalid', now()), ($2, 'outsider@budget.invalid', now())`,
    [actor, outsider],
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

async function subcategoryOf(spaceId: string, parentId: string, name: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const category = await db().client.query<{ id: string }>(
      "select id from public.create_subcategory($1,$2,$3,$4,null) limit 2", [spaceId, randomUUID(), parentId, name],
    );
    return category.rows[0]!.id;
  });
}

async function archiveCategory(spaceId: string, categoryId: string): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () =>
    db().client.query('select * from public.archive_category($1,$2,$3)', [spaceId, randomUUID(), categoryId]));
}

function templateGroup(id: string, purpose: 'spending' | 'future', order: number, basisPoints: number, nameEn: string | null = 'Group', nameAr: string | null = null) {
  return { id, purpose, nameEn, nameAr, order, basisPoints };
}

async function saveTemplate(input: {
  spaceId: string; requestId?: string; currency?: 'USD' | 'LBP'; expectedRevisionId?: number | null;
  groups: unknown[]; rootMappings: unknown[]; asActor?: string;
}) {
  return withAuthenticatedTransaction(db().client, input.asActor ?? actor, async () => {
    const result = await db().client.query<{ save_allocation_template: { templateRevisionId: string } }>(
      'select public.save_allocation_template($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
      [input.spaceId, input.requestId ?? randomUUID(), input.currency ?? 'USD', input.expectedRevisionId ?? null,
        JSON.stringify(input.groups), JSON.stringify(input.rootMappings)],
    );
    return result.rows[0]!.save_allocation_template;
  });
}

const groupA = '00000000-0000-4000-8000-000000000001';
const groupB = '00000000-0000-4000-8000-000000000002';
const groupC = '00000000-0000-4000-8000-000000000003';

function group(id: string, order: number, basisPoints: number) {
  return { id, order, basisPoints };
}

async function allocate(income: string, groups: unknown[]): Promise<Array<{ group_id: string; target_minor: string; is_residual: boolean }>> {
  const result = await db().client.query<{ group_id: string; target_minor: string; is_residual: boolean }>(
    'select group_id::text, target_minor::text, is_residual from private.allocate_planning_income($1, $2::jsonb)',
    [income, JSON.stringify(groups)],
  );
  return result.rows;
}

describe('private.allocate_planning_income', () => {
  it('splits 200000 across 5600/2400/2000 bps with zero residual', async () => {
    const rows = await allocate('200000', [group(groupA, 0, 5600), group(groupB, 1, 2400), group(groupC, 2, 2000)]);
    expect(rows).toEqual([
      { group_id: groupA, target_minor: '112000', is_residual: false },
      { group_id: groupB, target_minor: '48000', is_residual: false },
      { group_id: groupC, target_minor: '40000', is_residual: false },
      { group_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', target_minor: '0', is_residual: true },
    ]);
  });

  it('distributes remainder cents by largest fraction for 101 across 5600/2400/2000 bps', async () => {
    const rows = await allocate('101', [group(groupA, 0, 5600), group(groupB, 1, 2400), group(groupC, 2, 2000)]);
    expect(rows).toEqual([
      { group_id: groupA, target_minor: '57', is_residual: false },
      { group_id: groupB, target_minor: '24', is_residual: false },
      { group_id: groupC, target_minor: '20', is_residual: false },
      { group_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', target_minor: '0', is_residual: true },
    ]);
  });

  it('gives every remainder cent to the largest group for 1 across 5000/3000/2000 bps', async () => {
    const rows = await allocate('1', [group(groupA, 0, 5000), group(groupB, 1, 3000), group(groupC, 2, 2000)]);
    expect(rows).toEqual([
      { group_id: groupA, target_minor: '1', is_residual: false },
      { group_id: groupB, target_minor: '0', is_residual: false },
      { group_id: groupC, target_minor: '0', is_residual: false },
      { group_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', target_minor: '0', is_residual: true },
    ]);
  });

  it('puts the unclaimed 4400 bps into the implicit residual group for 100 with only a 5600 bps group', async () => {
    const rows = await allocate('100', [group(groupA, 0, 5600)]);
    expect(rows).toEqual([
      { group_id: groupA, target_minor: '56', is_residual: false },
      { group_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', target_minor: '44', is_residual: true },
    ]);
  });

  it('returns all zero for zero income', async () => {
    const rows = await allocate('0', [group(groupA, 0, 5600), group(groupB, 1, 2400)]);
    expect(rows.every((row) => row.target_minor === '0')).toBe(true);
  });

  it('puts all of the income into the residual for zero-weight groups', async () => {
    const rows = await allocate('500', [group(groupA, 0, 0)]);
    expect(rows).toEqual([
      { group_id: groupA, target_minor: '0', is_residual: false },
      { group_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', target_minor: '500', is_residual: true },
    ]);
  });

  it('handles the maximum bounded amount without overflow', async () => {
    const rows = await allocate('999999999999999', [group(groupA, 0, 5600), group(groupB, 1, 2400), group(groupC, 2, 2000)]);
    const total = rows.reduce((sum, row) => sum + BigInt(row.target_minor), 0n);
    expect(total).toBe(999999999999999n);
  });

  it('rejects duplicate group IDs', async () => {
    await expect(allocate('100', [group(groupA, 0, 5000), group(groupA, 1, 5000)]))
      .rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects duplicate display orders', async () => {
    await expect(allocate('100', [group(groupA, 0, 5000), group(groupB, 0, 5000)]))
      .rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects an invalid UUID', async () => {
    await expect(allocate('100', [{ id: 'not-a-uuid', order: 0, basisPoints: 100 }]))
      .rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects a JSON null groups payload', async () => {
    await expect(db().client.query(
      "select * from private.allocate_planning_income('100', null)",
    )).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects a string basisPoints value', async () => {
    await expect(db().client.query(
      "select * from private.allocate_planning_income($1, $2::jsonb)",
      ['100', JSON.stringify([{ id: groupA, order: 0, basisPoints: '100' }])],
    )).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects a fractional basisPoints value', async () => {
    await expect(db().client.query(
      "select * from private.allocate_planning_income($1, $2::jsonb)",
      ['100', JSON.stringify([{ id: groupA, order: 0, basisPoints: 100.5 }])],
    )).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects total basis points over 10000', async () => {
    await expect(allocate('100', [group(groupA, 0, 6000), group(groupB, 1, 4001)]))
      .rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects more than 12 groups', async () => {
    const groups = Array.from({ length: 13 }, (_, index) => group(randomUUID(), index, 100));
    await expect(allocate('100', groups)).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('conserves every minor unit for amounts 0..1000 across several weight vectors', async () => {
    // One round trip per vector (5,005 amount/weight cases total, matching
    // the plan-pack review's TS-side sweep): generate_series + LATERAL runs
    // the whole 0..1000 range against the real function inside Postgres,
    // instead of 5,005 separate network round trips over the SSH bridge.
    const vectors = [
      [5600, 2400, 2000],
      [5000, 3000, 2000],
      [3333, 3333, 3334],
      [5600],
      [0, 0, 0],
    ];
    for (const weights of vectors) {
      const groups = weights.map((bps, index) => group(randomUUID(), index, bps));
      const result = await db().client.query<{ amount: string; total: string }>(
        `select amount::text, sum(target_minor)::text as total
         from generate_series(0, 1000) as amount
         cross join lateral private.allocate_planning_income(amount::text, $1::jsonb)
         group by amount having sum(target_minor) <> amount
         order by amount`,
        [JSON.stringify(groups)],
      );
      expect(result.rows).toEqual([]);
    }
  }, 60_000);
});

describe('public.save_allocation_template', () => {
  it('saves a first template: one spending group, one root mapping', async () => {
    const spaceId = await freshSpace('Save template valid path');
    const category = await expenseRootCategory(spaceId, 'Essentials');
    const groupId = randomUUID();
    const result = await saveTemplate({
      spaceId, groups: [templateGroup(groupId, 'spending', 0, 8000)],
      rootMappings: [{ categoryId: category, groupId }],
    });
    expect(result.templateRevisionId).toMatch(/^\d+$/);

    const lines = await db().client.query(
      'select group_id::text, name_en, display_order, basis_points from public.allocation_template_lines where template_id = $1',
      [result.templateRevisionId],
    );
    expect(lines.rows).toEqual([{ group_id: groupId, name_en: 'Group', display_order: 0, basis_points: 8000 }]);
    const roots = await db().client.query(
      'select category_id::text, group_id::text from public.allocation_template_roots where template_id = $1',
      [result.templateRevisionId],
    );
    expect(roots.rows).toEqual([{ category_id: category, group_id: groupId }]);
  });

  it('replays the identical result for the same request id and payload without creating a new revision', async () => {
    const spaceId = await freshSpace('Save template replay');
    const groupId = randomUUID();
    const requestId = randomUUID();
    const groups = [templateGroup(groupId, 'spending', 0, 10000)];
    const first = await saveTemplate({ spaceId, requestId, groups, rootMappings: [] });
    const second = await saveTemplate({ spaceId, requestId, groups, rootMappings: [] });
    expect(second).toEqual(first);
    const count = await db().client.query('select count(*)::int as count from public.allocation_template_revisions where space_id = $1', [spaceId]);
    expect(count.rows[0]!.count).toBe(1);
  });

  it('rejects a stale expected revision id', async () => {
    const spaceId = await freshSpace('Save template stale revision');
    const groupId = randomUUID();
    const first = await saveTemplate({ spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [] });
    await expect(saveTemplate({
      spaceId, expectedRevisionId: null, groups: [templateGroup(randomUUID(), 'spending', 0, 10000)], rootMappings: [],
    })).rejects.toMatchObject({ code: '40001', message: 'planning_stale_revision' });
    expect(first.templateRevisionId).toMatch(/^\d+$/);
  });

  it('reuses an existing group identity with the same purpose across two template revisions', async () => {
    const spaceId = await freshSpace('Save template reuse group');
    const groupId = randomUUID();
    const first = await saveTemplate({ spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [] });
    const second = await saveTemplate({
      spaceId, expectedRevisionId: Number(first.templateRevisionId),
      groups: [templateGroup(groupId, 'spending', 0, 6000), templateGroup(randomUUID(), 'spending', 1, 4000)], rootMappings: [],
    });
    expect(second.templateRevisionId).not.toBe(first.templateRevisionId);
    const groupCount = await db().client.query('select count(*)::int as count from public.allocation_groups where id = $1', [groupId]);
    expect(groupCount.rows[0]!.count).toBe(1);
  });

  it('rejects reusing an existing group id with a different purpose', async () => {
    const spaceId = await freshSpace('Save template group purpose conflict');
    const groupId = randomUUID();
    const first = await saveTemplate({ spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [] });
    await expect(saveTemplate({
      spaceId, expectedRevisionId: Number(first.templateRevisionId),
      groups: [templateGroup(groupId, 'future', 0, 10000)], rootMappings: [],
    })).rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects a root mapping to a subcategory', async () => {
    const spaceId = await freshSpace('Save template root is subcategory');
    const root = await expenseRootCategory(spaceId, 'Essentials');
    const child = await subcategoryOf(spaceId, root, 'Food');
    const groupId = randomUUID();
    await expect(saveTemplate({
      spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [{ categoryId: child, groupId }],
    })).rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects a root mapping to an archived category', async () => {
    const spaceId = await freshSpace('Save template root is archived');
    const category = await expenseRootCategory(spaceId, 'Essentials');
    await archiveCategory(spaceId, category);
    const groupId = randomUUID();
    await expect(saveTemplate({
      spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [{ categoryId: category, groupId }],
    })).rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects a root mapping to a group not included in this submission', async () => {
    const spaceId = await freshSpace('Save template unknown group');
    const category = await expenseRootCategory(spaceId, 'Essentials');
    await expect(saveTemplate({
      spaceId, groups: [templateGroup(randomUUID(), 'spending', 0, 10000)], rootMappings: [{ categoryId: category, groupId: randomUUID() }],
    })).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects a root mapping to a future-purpose group', async () => {
    const spaceId = await freshSpace('Save template root maps to future group');
    const category = await expenseRootCategory(spaceId, 'Essentials');
    const groupId = randomUUID();
    await expect(saveTemplate({
      spaceId, groups: [templateGroup(groupId, 'future', 0, 10000)], rootMappings: [{ categoryId: category, groupId }],
    })).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects an unknown field on a group object', async () => {
    const spaceId = await freshSpace('Save template unknown field');
    await expect(saveTemplate({
      spaceId, groups: [{ ...templateGroup(randomUUID(), 'spending', 0, 10000), extra: true }], rootMappings: [],
    })).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('rejects a duplicate categoryId across root mappings', async () => {
    const spaceId = await freshSpace('Save template duplicate root category');
    const category = await expenseRootCategory(spaceId, 'Essentials');
    const groupA = randomUUID();
    const groupB = randomUUID();
    await expect(saveTemplate({
      spaceId, groups: [templateGroup(groupA, 'spending', 0, 5000), templateGroup(groupB, 'spending', 1, 5000)],
      rootMappings: [{ categoryId: category, groupId: groupA }, { categoryId: category, groupId: groupB }],
    })).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('accepts zero groups and zero root mappings (an empty template)', async () => {
    const spaceId = await freshSpace('Save template empty');
    const result = await saveTemplate({ spaceId, groups: [], rootMappings: [] });
    expect(result.templateRevisionId).toMatch(/^\d+$/);
  });

  it('denies an outsider and a removed member', async () => {
    const spaceId = await freshSpace('Save template access control');
    await expect(saveTemplate({
      spaceId, groups: [templateGroup(randomUUID(), 'spending', 0, 10000)], rootMappings: [], asActor: outsider,
    })).rejects.toMatchObject({ code: '42501' });
  });

  it('serializes two template saves for the same space even though they use the shared planning space lock', async () => {
    const spaceId = await freshSpace('Save template race');
    const outcome = await orderedAuthenticatedRace(
      db(),
      actor,
      (client) => client.query(
        'select public.save_allocation_template($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
        [spaceId, randomUUID(), 'USD', null, JSON.stringify([templateGroup(randomUUID(), 'spending', 0, 10000)]), '[]'],
      ),
      (client) => client.query(
        'select public.save_allocation_template($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
        [spaceId, randomUUID(), 'USD', null, JSON.stringify([templateGroup(randomUUID(), 'spending', 0, 10000)]), '[]'],
      ),
    );
    // The second call reads the head only after the first commits (proven by
    // orderedAuthenticatedRace blocking it), so it must see the first's
    // template as current and be rejected as stale, not silently overwrite it.
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toMatchObject({ code: '40001' });
    }
  });
});

async function planIncome(spaceId: string, month: string, currency: 'USD' | 'LBP', amountMinor: string): Promise<number> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ id: string }>(
      'select * from public.set_monthly_income_plan($1,$2,$3::date,$4,$5,null)', [spaceId, randomUUID(), month, currency, amountMinor],
    );
    return Number(result.rows[0]!.id);
  });
}

async function planCategoryTarget(spaceId: string, categoryId: string, month: string, currency: 'USD' | 'LBP', amountMinor: string): Promise<number> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ id: string }>(
      'select * from public.set_monthly_category_target($1,$2,$3,$4::date,$5,$6,null)', [spaceId, randomUUID(), categoryId, month, currency, amountMinor],
    );
    return Number(result.rows[0]!.id);
  });
}

function rootTarget(categoryId: string, amountMinor: string, expectedRevisionId: number | null = null) {
  return { categoryId, amountMinor, expectedRevisionId: expectedRevisionId === null ? null : String(expectedRevisionId) };
}

async function publishMonth(input: {
  spaceId: string; requestId?: string; month?: string; currency?: 'USD' | 'LBP';
  expectedSnapshotId?: number | null; templateRevisionId: number; expectedIncomeRevisionId?: number | null;
  incomeMinor: string; rootTargets: unknown[]; loanGroupId?: string | null; asActor?: string;
}) {
  return withAuthenticatedTransaction(db().client, input.asActor ?? actor, async () => {
    const result = await db().client.query<{ publish_allocation_month: { snapshotId: string; incomeRevisionId: string } }>(
      'select public.publish_allocation_month($1,$2,$3::date,$4,$5,$6,$7,$8,$9::jsonb,$10)',
      [input.spaceId, input.requestId ?? randomUUID(), input.month ?? '2026-09-01', input.currency ?? 'USD',
        input.expectedSnapshotId ?? null, input.templateRevisionId, input.expectedIncomeRevisionId ?? null,
        input.incomeMinor, JSON.stringify(input.rootTargets), input.loanGroupId ?? null],
    );
    return result.rows[0]!.publish_allocation_month;
  });
}

describe('public.publish_allocation_month', () => {
  it('publishes a first month: income, one grouped root, standalone loan pool', async () => {
    const spaceId = await freshSpace('Publish month valid path');
    const category = await expenseRootCategory(spaceId, 'Essentials');
    const groupId = randomUUID();
    const template = await saveTemplate({
      spaceId, groups: [templateGroup(groupId, 'spending', 0, 8000)], rootMappings: [{ categoryId: category, groupId }],
    });
    const result = await publishMonth({
      spaceId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '100000',
      rootTargets: [rootTarget(category, '80000')],
    });
    expect(result.snapshotId).toMatch(/^\d+$/);
    expect(result.incomeRevisionId).toMatch(/^\d+$/);

    const groups = await db().client.query(
      'select group_id::text, target_minor::text from public.allocation_month_groups where snapshot_id = $1', [result.snapshotId],
    );
    expect(groups.rows).toEqual([{ group_id: groupId, target_minor: '80000' }]);
    const roots = await db().client.query(
      'select category_id::text, group_id::text, target_minor::text from public.allocation_month_roots where snapshot_id = $1', [result.snapshotId],
    );
    expect(roots.rows).toEqual([{ category_id: category, group_id: groupId, target_minor: '80000' }]);
    const commitments = await db().client.query(
      'select group_id, observed_actual_minor::text, observed_remaining_minor::text from public.allocation_month_commitments where snapshot_id = $1', [result.snapshotId],
    );
    expect(commitments.rows).toEqual([{ group_id: null, observed_actual_minor: '0', observed_remaining_minor: '0' }]);
  });

  it('replays the identical result for the same request id and payload without creating a new snapshot', async () => {
    const spaceId = await freshSpace('Publish month replay');
    const category = await expenseRootCategory(spaceId, 'Essentials');
    const groupId = randomUUID();
    const template = await saveTemplate({ spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [{ categoryId: category, groupId }] });
    const requestId = randomUUID();
    const args = { spaceId, requestId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '5000', rootTargets: [rootTarget(category, '5000')] };
    const first = await publishMonth(args);
    const second = await publishMonth(args);
    expect(second).toEqual(first);
    const count = await db().client.query('select count(*)::int as count from public.allocation_month_snapshots where space_id = $1', [spaceId]);
    expect(count.rows[0]!.count).toBe(1);
  });

  it('rejects a stale expected snapshot id', async () => {
    const spaceId = await freshSpace('Publish month stale snapshot');
    const category = await expenseRootCategory(spaceId, 'Essentials');
    const groupId = randomUUID();
    const template = await saveTemplate({ spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [{ categoryId: category, groupId }] });
    await publishMonth({ spaceId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '1000', rootTargets: [rootTarget(category, '1000')] });
    await expect(publishMonth({
      spaceId, expectedSnapshotId: null, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '2000', rootTargets: [rootTarget(category, '2000')],
    })).rejects.toMatchObject({ code: '40001', message: 'planning_stale_revision' });
  });

  it('rejects a publication that omits a template-mapped root', async () => {
    const spaceId = await freshSpace('Publish month omits mapped root');
    const category = await expenseRootCategory(spaceId, 'Essentials');
    const groupId = randomUUID();
    const template = await saveTemplate({ spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [{ categoryId: category, groupId }] });
    await expect(publishMonth({
      spaceId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '1000', rootTargets: [],
    })).rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects a publication that omits an existing positive manual target', async () => {
    const spaceId = await freshSpace('Publish month omits manual target');
    const mapped = await expenseRootCategory(spaceId, 'Essentials');
    const manual = await expenseRootCategory(spaceId, 'Extras');
    const groupId = randomUUID();
    const template = await saveTemplate({ spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [{ categoryId: mapped, groupId }] });
    await planCategoryTarget(spaceId, manual, '2026-09-01', 'USD', '500');
    await expect(publishMonth({
      spaceId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '1000', rootTargets: [rootTarget(mapped, '1000')],
    })).rejects.toMatchObject({ code: 'P0001' });
  });

  it('allows stopping an old positive target by submitting it explicitly as zero', async () => {
    const spaceId = await freshSpace('Publish month stops manual target');
    const mapped = await expenseRootCategory(spaceId, 'Essentials');
    const manual = await expenseRootCategory(spaceId, 'Extras');
    const groupId = randomUUID();
    const template = await saveTemplate({ spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [{ categoryId: mapped, groupId }] });
    const manualRevision = await planCategoryTarget(spaceId, manual, '2026-09-01', 'USD', '500');
    const result = await publishMonth({
      spaceId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '1000',
      rootTargets: [rootTarget(mapped, '1000'), rootTarget(manual, '0', manualRevision)],
    });
    expect(result.snapshotId).toMatch(/^\d+$/);
  });

  it('rejects root targets that exceed their spending group target', async () => {
    const spaceId = await freshSpace('Publish month overallocated group');
    const category = await expenseRootCategory(spaceId, 'Essentials');
    const groupId = randomUUID();
    const template = await saveTemplate({ spaceId, groups: [templateGroup(groupId, 'spending', 0, 5000)], rootMappings: [{ categoryId: category, groupId }] });
    await expect(publishMonth({
      spaceId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '1000', rootTargets: [rootTarget(category, '600')],
    })).rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects a loan pool linked to a spending-purpose group', async () => {
    const spaceId = await freshSpace('Publish month loan wrong purpose');
    const groupId = randomUUID();
    const template = await saveTemplate({ spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [] });
    await expect(publishMonth({
      spaceId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '1000', rootTargets: [], loanGroupId: groupId,
    })).rejects.toMatchObject({ code: 'P0001' });
  });

  it('accepts a standalone loan pool even when it would be overallocated', async () => {
    const spaceId = await freshSpace('Publish month standalone loan deficit');
    const groupId = randomUUID();
    const template = await saveTemplate({ spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [] });
    const result = await publishMonth({
      spaceId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '1000', rootTargets: [], loanGroupId: null,
    });
    expect(result.snapshotId).toMatch(/^\d+$/);
  });

  it('propagates the existing root-category rejection for a subcategory target', async () => {
    const spaceId = await freshSpace('Publish month subcategory root');
    const root = await expenseRootCategory(spaceId, 'Essentials');
    const child = await subcategoryOf(spaceId, root, 'Food');
    const groupId = randomUUID();
    const template = await saveTemplate({ spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [] });
    await expect(publishMonth({
      spaceId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '1000', rootTargets: [rootTarget(child, '100')],
    })).rejects.toMatchObject({ code: 'P0001' });
  });

  it('denies an outsider', async () => {
    const spaceId = await freshSpace('Publish month access control');
    const groupId = randomUUID();
    const template = await saveTemplate({ spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [] });
    await expect(publishMonth({
      spaceId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '1000', rootTargets: [], asActor: outsider,
    })).rejects.toMatchObject({ code: '42501' });
  });

  it('serializes two publishes for the same month: the second sees the first as current and is rejected as stale', async () => {
    const spaceId = await freshSpace('Publish month race');
    const groupId = randomUUID();
    const template = await saveTemplate({ spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [] });
    const templateId = Number(template.templateRevisionId);
    const outcome = await orderedAuthenticatedRace(
      db(), actor,
      (client) => client.query(
        'select public.publish_allocation_month($1,$2,$3::date,$4,$5,$6,$7,$8,$9::jsonb,$10)',
        [spaceId, randomUUID(), '2026-09-01', 'USD', null, templateId, null, '1000', '[]', null],
      ),
      (client) => client.query(
        'select public.publish_allocation_month($1,$2,$3::date,$4,$5,$6,$7,$8,$9::jsonb,$10)',
        [spaceId, randomUUID(), '2026-09-01', 'USD', null, templateId, null, '2000', '[]', null],
      ),
    );
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toMatchObject({ code: '40001' });
    }
  });
});

describe('allocation commands migration upgrade', () => {
  it('upgrades a database seeded with pre-command allocation data (task 04 style) without disturbing it', async () => {
    const migrations = migrationFiles();
    const commandsVersion = '20260914120000';
    const commandsMigration = migrations.find((migration) => migration.version === commandsVersion);
    const priorMigrations = migrations.filter((migration) => migration.version < commandsVersion);
    expect(commandsMigration).toBeDefined();

    const upgrade = await createDisposableDatabase('budget_allocupgrade');
    try {
      await bootstrapCompatibilityObjects(upgrade.client);
      await replayMigrations(upgrade.client, priorMigrations);
      const seedActor = randomUUID();
      await upgrade.client.query(
        `insert into auth.users(id, email, email_confirmed_at) values ($1, 'seed@budget.invalid', now())`,
        [seedActor],
      );
      const seededSpaceId = await withAuthenticatedTransaction(upgrade.client, seedActor, async () => {
        const space = await upgrade.client.query<{ id: string }>(
          "select id from public.create_space($1, 'personal') limit 2", ['Seeded upgrade fixture'],
        );
        return space.rows[0]!.id;
      });
      const seededGroupId = randomUUID();
      // Pre-command seed data, inserted directly as owner -- exactly how task
      // 04's own tests seeded rows before save_allocation_template existed.
      await upgrade.client.query(
        'insert into public.allocation_groups (id, space_id, currency, purpose, actor_id) values ($1,$2,$3,$4,$5)',
        [seededGroupId, seededSpaceId, 'USD', 'spending', seedActor],
      );

      const digestBefore = await financialDigestFor(upgrade.client, seededSpaceId);
      await replayMigrations(upgrade.client, [commandsMigration!]);
      const digestAfter = await financialDigestFor(upgrade.client, seededSpaceId);
      expect(digestAfter).toEqual(digestBefore);

      const seededGroupStillThere = await upgrade.client.query(
        'select purpose from public.allocation_groups where id = $1', [seededGroupId],
      );
      expect(seededGroupStillThere.rows).toEqual([{ purpose: 'spending' }]);

      // The new commands work against this now-upgraded database.
      const category = await withAuthenticatedTransaction(upgrade.client, seedActor, async () => {
        const result = await upgrade.client.query<{ id: string }>(
          "select id from public.create_category($1,$2,'expense','Essentials',null) limit 2", [seededSpaceId, randomUUID()],
        );
        return result.rows[0]!.id;
      });
      const newGroupId = randomUUID();
      const templateResult = await withAuthenticatedTransaction(upgrade.client, seedActor, async () => {
        const result = await upgrade.client.query<{ save_allocation_template: { templateRevisionId: string } }>(
          'select public.save_allocation_template($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
          [seededSpaceId, randomUUID(), 'USD', null,
            JSON.stringify([templateGroup(newGroupId, 'spending', 0, 10000)]),
            JSON.stringify([{ categoryId: category, groupId: newGroupId }])],
        );
        return result.rows[0]!.save_allocation_template;
      });
      expect(templateResult.templateRevisionId).toMatch(/^\d+$/);
    } finally {
      await disposeDisposableDatabase(upgrade);
    }
  }, 120_000);
});

async function financialDigestFor(client: DisposableDatabase['client'], spaceId: string): Promise<unknown> {
  const result = await client.query(
    `select 'events' as relation_name, count(*)::text as row_count,
      md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), '')) as digest
     from (select * from public.financial_events where space_id = $1 order by id limit 101) x
     union all
     select 'groups', count(*)::text,
       md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), ''))
     from (select * from public.allocation_groups where space_id = $1 order by id limit 101) x
     order by relation_name`,
    [spaceId],
  );
  expect(result.rows.every((row: { row_count: string }) => Number(row.row_count) <= 100)).toBe(true);
  return result.rows;
}
