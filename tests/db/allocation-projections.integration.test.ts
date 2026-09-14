import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction, withRollback,
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
  database = await createDisposableDatabase('budget_allocproj');
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

async function freshSpace(name: string, kind: 'personal' | 'household' = 'personal'): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const space = await db().client.query<{ id: string }>(
      'select id from public.create_space($1, $2) limit 2', [name, kind],
    );
    return space.rows[0]!.id;
  });
}

async function usdWallet(spaceId: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const wallet = await db().client.query<{ id: string }>(
      "select id from public.create_wallet($1, 'Cash', 'USD') limit 2", [spaceId],
    );
    return wallet.rows[0]!.id;
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

async function recordIncome(spaceId: string, walletId: string, amountMinor: string, date: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const event = await db().client.query<{ id: string }>(
      `select id from public.record_financial_event($1,$2,'income',$3::date,$4::jsonb) limit 2`,
      [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor }])],
    );
    return event.rows[0]!.id;
  });
}

async function recordExpense(
  spaceId: string, walletId: string, amountMinor: string, date: string, categoryId: string | null = null,
): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const event = categoryId === null
      ? await db().client.query<{ id: string }>(
        `select id from public.record_financial_event($1,$2,'expense',$3::date,$4::jsonb) limit 2`,
        [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor }])],
      )
      : await db().client.query<{ id: string }>(
        `select id from public.record_categorized_financial_event($1,$2,'expense',$3::date,$4::jsonb,$5) limit 2`,
        [spaceId, randomUUID(), date, JSON.stringify([{ walletId, amountMinor }]), categoryId],
      );
    return event.rows[0]!.id;
  });
}

async function reverseEvent(spaceId: string, eventId: string, date: string): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () =>
    db().client.query("select * from public.reverse_financial_event($1,$2,$3,$4::date) limit 2", [spaceId, randomUUID(), eventId, date]));
}

async function borrowLoan(spaceId: string, walletId: string, amountMinor: string, date: string): Promise<string> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ loan_id: string }>(
      `select loan_id from public.record_cash_loan($1,$2,'i_owe_them','Lender','USD',$3,$4,$5::date) limit 2`,
      [spaceId, randomUUID(), walletId, amountMinor, date],
    );
    return result.rows[0]!.loan_id;
  });
}

async function repayLoan(spaceId: string, loanId: string, walletId: string, amountMinor: string, date: string): Promise<void> {
  await withAuthenticatedTransaction(db().client, actor, () =>
    db().client.query(
      `select * from public.record_loan_repayment($1,$2,$3,$4,$5,$6::date) limit 2`,
      [spaceId, randomUUID(), loanId, walletId, amountMinor, date],
    ));
}

function templateGroup(id: string, purpose: 'spending' | 'future', order: number, basisPoints: number, nameEn = 'Group') {
  return { id, purpose, nameEn, nameAr: null, order, basisPoints };
}

async function saveTemplate(input: {
  spaceId: string; requestId?: string; currency?: 'USD' | 'LBP'; expectedRevisionId?: number | null;
  groups: unknown[]; rootMappings: unknown[];
}) {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ save_allocation_template: { templateRevisionId: string } }>(
      'select public.save_allocation_template($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
      [input.spaceId, input.requestId ?? randomUUID(), input.currency ?? 'USD', input.expectedRevisionId ?? null,
        JSON.stringify(input.groups), JSON.stringify(input.rootMappings)],
    );
    return result.rows[0]!.save_allocation_template;
  });
}

function rootTarget(categoryId: string, amountMinor: string, expectedRevisionId: number | null = null) {
  return { categoryId, amountMinor, expectedRevisionId: expectedRevisionId === null ? null : String(expectedRevisionId) };
}

async function publishMonth(input: {
  spaceId: string; requestId?: string; month?: string; currency?: 'USD' | 'LBP';
  expectedSnapshotId?: number | null; templateRevisionId: number; expectedIncomeRevisionId?: number | null;
  incomeMinor: string; rootTargets: unknown[]; loanGroupId?: string | null;
}) {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ publish_allocation_month: { snapshotId: string; incomeRevisionId: string } }>(
      'select public.publish_allocation_month($1,$2,$3::date,$4,$5,$6,$7,$8,$9::jsonb,$10)',
      [input.spaceId, input.requestId ?? randomUUID(), input.month ?? '2026-09-01', input.currency ?? 'USD',
        input.expectedSnapshotId ?? null, input.templateRevisionId, input.expectedIncomeRevisionId ?? null,
        input.incomeMinor, JSON.stringify(input.rootTargets), input.loanGroupId ?? null],
    );
    return result.rows[0]!.publish_allocation_month;
  });
}

async function planCategoryTarget(
  spaceId: string, categoryId: string, month: string, currency: 'USD' | 'LBP', amountMinor: string, expectedRevisionId: number | null = null,
): Promise<number> {
  return withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ id: string }>(
      'select * from public.set_monthly_category_target($1,$2,$3,$4::date,$5,$6,$7)',
      [spaceId, randomUUID(), categoryId, month, currency, amountMinor, expectedRevisionId],
    );
    return Number(result.rows[0]!.id);
  });
}

type MonthState = {
  snapshotId: string | null; templateRevisionId: string | null; incomeRevisionId: string | null;
  hasPlan: boolean; plannedIncomeMinor: string | null; actualIncomeMinor: string; expenseMinor: string;
  incomeAfterSpendingMinor: string; ownDebtPaidMinor: string; remainingDebtMinor: string;
  leftToAllocateMinor: string | null; childPlanChanged: boolean; asOf: string;
  groups: Array<{
    groupId: string | null; rowKind: string; nameEn: string | null; nameAr: string | null; order: number | null;
    targetMinor: string | null; actualMinor: string; varianceMinor: string | null; basisPoints: number | null;
    actualShareOfIncomeBps: string | null; hasPlan: boolean;
  }>;
};

async function monthState(
  spaceId: string, month: string, currency: 'USD' | 'LBP' = 'USD', snapshotId: number | null = null, asActor: string = actor,
): Promise<MonthState> {
  return withAuthenticatedTransaction(db().client, asActor, async () => {
    const result = await db().client.query<{ allocation_month_state: MonthState }>(
      'select public.allocation_month_state($1,$2::date,$3,$4)', [spaceId, month, currency, snapshotId],
    );
    return result.rows[0]!.allocation_month_state;
  });
}

type CategoryPage = {
  rows: Array<{
    rootId: string; nameEn: string | null; nameAr: string | null; targetMinor: string; actualMinor: string;
    varianceMinor: string; hasPlan: boolean; groupId: string | null;
  }>;
  nextRootId: string | null; hasMore: boolean;
};

async function categoryPage(
  spaceId: string, month: string, currency: 'USD' | 'LBP', snapshotId: number,
  groupId: string | null = null, afterRootId: string | null = null, limit = 50, asActor: string = actor,
): Promise<CategoryPage> {
  return withAuthenticatedTransaction(db().client, asActor, async () => {
    const result = await db().client.query<{ allocation_category_page: CategoryPage }>(
      'select public.allocation_category_page($1,$2::date,$3,$4,$5,$6,$7)',
      [spaceId, month, currency, snapshotId, groupId, afterRootId, limit],
    );
    return result.rows[0]!.allocation_category_page;
  });
}

type HistoryPage = {
  rows: Array<{ snapshotId: string; createdAt: string; actorId: string; plannedIncomeMinor: string; templateRevisionId: string }>;
  nextId: string | null; hasMore: boolean;
};

async function historyPage(
  spaceId: string, month: string, currency: 'USD' | 'LBP', beforeId: number | null = null, limit = 20, asActor: string = actor,
): Promise<HistoryPage> {
  return withAuthenticatedTransaction(db().client, asActor, async () => {
    const result = await db().client.query<{ allocation_history_page: HistoryPage }>(
      'select public.allocation_history_page($1,$2::date,$3,$4,$5)', [spaceId, month, currency, beforeId, limit],
    );
    return result.rows[0]!.allocation_history_page;
  });
}

type Trend = { months: Array<{ month: string; incomeMinor: string; expenseMinor: string; ownDebtPaidMinor: string; hasPlan: boolean; plannedIncomeMinor: string | null }> };

async function trend(
  spaceId: string, currency: 'USD' | 'LBP', firstMonth: string, monthCount: number | null, asActor: string = actor,
): Promise<Trend> {
  return withAuthenticatedTransaction(db().client, asActor, async () => {
    const result = await db().client.query<{ allocation_trend: Trend }>(
      'select public.allocation_trend($1,$2,$3::date,$4)', [spaceId, currency, firstMonth, monthCount],
    );
    return result.rows[0]!.allocation_trend;
  });
}

/** Builds the exact plan-pack Task 3 fixture: 200000 planned, 180000 received,
 * Essentials target 112000/actual 118000, Lifestyle target 48000/actual 43000,
 * Future target 40000/debt 15000. Returns the published snapshot and group ids. */
async function buildCoreFixture(spaceName: string, month = '2026-09-01') {
  const spaceId = await freshSpace(spaceName);
  const wallet = await usdWallet(spaceId);
  const essentials = await expenseRootCategory(spaceId, 'Essentials');
  const lifestyle = await expenseRootCategory(spaceId, 'Lifestyle');
  const essentialsGroup = randomUUID();
  const lifestyleGroup = randomUUID();
  const futureGroup = randomUUID();

  const template = await saveTemplate({
    spaceId,
    groups: [
      templateGroup(essentialsGroup, 'spending', 0, 5600, 'Essentials'),
      templateGroup(lifestyleGroup, 'spending', 1, 2400, 'Lifestyle'),
      templateGroup(futureGroup, 'future', 2, 2000, 'Future'),
    ],
    rootMappings: [
      { categoryId: essentials, groupId: essentialsGroup },
      { categoryId: lifestyle, groupId: lifestyleGroup },
    ],
  });

  await recordIncome(spaceId, wallet, '180000', `${month.slice(0, 7)}-05`);
  await recordExpense(spaceId, wallet, '-118000', `${month.slice(0, 7)}-10`, essentials);
  await recordExpense(spaceId, wallet, '-43000', `${month.slice(0, 7)}-12`, lifestyle);
  const loanId = await borrowLoan(spaceId, wallet, '50000', `${month.slice(0, 7)}-01`);
  await repayLoan(spaceId, loanId, wallet, '15000', `${month.slice(0, 7)}-15`);

  const published = await publishMonth({
    spaceId, month, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '200000',
    rootTargets: [rootTarget(essentials, '112000'), rootTarget(lifestyle, '48000')], loanGroupId: futureGroup,
  });

  return {
    spaceId, wallet, essentials, lifestyle, essentialsGroup, lifestyleGroup, futureGroup, template, published, month,
  };
}

describe('public.allocation_month_state', () => {
  it('V01 reconciles the exact plan-pack fixture: expense 161000, incomeAfterSpending 19000, afterDebt 4000', async () => {
    const fixture = await buildCoreFixture('Month state core fixture');
    const state = await monthState(fixture.spaceId, fixture.month);

    expect(state.hasPlan).toBe(true);
    expect(state.plannedIncomeMinor).toBe('200000');
    expect(state.actualIncomeMinor).toBe('180000');
    expect(state.expenseMinor).toBe('161000');
    expect(state.incomeAfterSpendingMinor).toBe('19000');
    expect(state.ownDebtPaidMinor).toBe('15000');
    expect(Number(state.incomeAfterSpendingMinor) - Number(state.ownDebtPaidMinor)).toBe(4000);
    expect(state.childPlanChanged).toBe(false);
    expect(state.leftToAllocateMinor).toBe('0');

    const essentials = state.groups.find((row) => row.groupId === fixture.essentialsGroup)!;
    expect(essentials).toMatchObject({ rowKind: 'spending', targetMinor: '112000', actualMinor: '118000', varianceMinor: '-6000' });
    const lifestyle = state.groups.find((row) => row.groupId === fixture.lifestyleGroup)!;
    expect(lifestyle).toMatchObject({ rowKind: 'spending', targetMinor: '48000', actualMinor: '43000', varianceMinor: '5000' });
    const future = state.groups.find((row) => row.groupId === fixture.futureGroup)!;
    expect(future).toMatchObject({ rowKind: 'future', targetMinor: '40000', actualMinor: '15000', varianceMinor: '25000' });

    const unmapped = state.groups.find((row) => row.rowKind === 'unmapped')!;
    expect(unmapped).toMatchObject({ groupId: null, targetMinor: '0', actualMinor: '0', hasPlan: false });
    const uncategorized = state.groups.find((row) => row.rowKind === 'uncategorized')!;
    expect(uncategorized).toMatchObject({ groupId: null, actualMinor: '0', hasPlan: false });

    // No currency mixing: an LBP wallet's activity must never appear here.
    const lbpWallet = await withAuthenticatedTransaction(db().client, actor, async () => {
      const wallet = await db().client.query<{ id: string }>("select id from public.create_wallet($1,'LBP cash','LBP') limit 2", [fixture.spaceId]);
      return wallet.rows[0]!.id;
    });
    await recordExpense(fixture.spaceId, lbpWallet, '-9999999', `${fixture.month.slice(0, 7)}-11`);
    const stateAfterLbp = await monthState(fixture.spaceId, fixture.month, 'USD');
    expect(stateAfterLbp.expenseMinor).toBe('161000');
  });

  it('V02 rolls a subcategory expense into its mapped root group actual (one-time rollup)', async () => {
    const spaceId = await freshSpace('Month state root/child rollup');
    const wallet = await usdWallet(spaceId);
    const root = await expenseRootCategory(spaceId, 'Essentials');
    const child = await subcategoryOf(spaceId, root, 'Groceries');
    const groupId = randomUUID();
    const template = await saveTemplate({
      spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [{ categoryId: root, groupId }],
    });
    await recordExpense(spaceId, wallet, '-3000', '2026-09-10', child);
    const published = await publishMonth({
      spaceId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '10000', rootTargets: [rootTarget(root, '10000')],
    });
    const state = await monthState(spaceId, '2026-09-01');
    const group = state.groups.find((row) => row.groupId === groupId)!;
    expect(group.actualMinor).toBe('3000');
    const page = await categoryPage(spaceId, '2026-09-01', 'USD', Number(published.snapshotId));
    expect(page.rows).toEqual([expect.objectContaining({ rootId: root, actualMinor: '3000' })]);
  });

  it('V03 reports hasPlan=false with only unmapped/uncategorized rows when no month has ever been published', async () => {
    const spaceId = await freshSpace('Month state no plan');
    const wallet = await usdWallet(spaceId);
    const category = await expenseRootCategory(spaceId, 'Essentials');
    await recordExpense(spaceId, wallet, '-1000', '2026-09-10', category);
    await recordExpense(spaceId, wallet, '-500', '2026-09-11');
    const state = await monthState(spaceId, '2026-09-01');
    expect(state.hasPlan).toBe(false);
    expect(state.plannedIncomeMinor).toBeNull();
    expect(state.leftToAllocateMinor).toBeNull();
    expect(state.groups).toHaveLength(2);
    expect(state.groups.find((row) => row.rowKind === 'unmapped')!.actualMinor).toBe('1000');
    expect(state.groups.find((row) => row.rowKind === 'uncategorized')!.actualMinor).toBe('500');
  });

  it('V03b reports a zero snapshot cleanly: zero income, zero targets, empty groups list beyond synthetics', async () => {
    const spaceId = await freshSpace('Month state zero plan');
    const template = await saveTemplate({ spaceId, groups: [], rootMappings: [] });
    const published = await publishMonth({ spaceId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '0', rootTargets: [] });
    const state = await monthState(spaceId, '2026-09-01', 'USD', Number(published.snapshotId));
    expect(state.hasPlan).toBe(true);
    expect(state.plannedIncomeMinor).toBe('0');
    expect(state.leftToAllocateMinor).toBe('0');
    expect(state.groups.filter((row) => row.rowKind !== 'unmapped' && row.rowKind !== 'uncategorized')).toEqual([]);
  });

  it('V04 keeps a negative-correction month\'s actual signed, not floored at zero', async () => {
    const spaceId = await freshSpace('Month state negative correction');
    const wallet = await usdWallet(spaceId);
    const category = await expenseRootCategory(spaceId, 'Essentials');
    const groupId = randomUUID();
    const template = await saveTemplate({
      spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [{ categoryId: category, groupId }],
    });
    const original = await recordExpense(spaceId, wallet, '-5000', '2026-08-15', category);
    await reverseEvent(spaceId, original, '2026-09-05');
    const published = await publishMonth({
      spaceId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '10000', rootTargets: [rootTarget(category, '10000')],
    });
    const state = await monthState(spaceId, '2026-09-01', 'USD', Number(published.snapshotId));
    expect(state.expenseMinor).toBe('-5000');
    const group = state.groups.find((row) => row.groupId === groupId)!;
    expect(group.actualMinor).toBe('-5000');
    expect(group.varianceMinor).toBe('15000');
  });

  it('V07 reflects late-arriving actual income live without flagging the plan as changed', async () => {
    const spaceId = await freshSpace('Month state late income');
    const wallet = await usdWallet(spaceId);
    const template = await saveTemplate({ spaceId, groups: [], rootMappings: [] });
    await publishMonth({ spaceId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '1000', rootTargets: [] });
    const before = await monthState(spaceId, '2026-09-01');
    expect(before.actualIncomeMinor).toBe('0');
    expect(before.childPlanChanged).toBe(false);
    await recordIncome(spaceId, wallet, '2500', '2026-09-28');
    const after = await monthState(spaceId, '2026-09-01');
    expect(after.actualIncomeMinor).toBe('2500');
    expect(after.childPlanChanged).toBe(false);
  });

  it('V08 keeps each month\'s snapshot isolated from the adjacent month', async () => {
    const spaceId = await freshSpace('Month state adjacent isolation');
    const template = await saveTemplate({ spaceId, groups: [], rootMappings: [] });
    const templateId = Number(template.templateRevisionId);
    const september = await publishMonth({ spaceId, month: '2026-09-01', templateRevisionId: templateId, incomeMinor: '1000', rootTargets: [] });
    const october = await publishMonth({ spaceId, month: '2026-10-01', templateRevisionId: templateId, incomeMinor: '2000', rootTargets: [] });
    const septemberState = await monthState(spaceId, '2026-09-01');
    const octoberState = await monthState(spaceId, '2026-10-01');
    expect(septemberState.snapshotId).toBe(september.snapshotId);
    expect(septemberState.plannedIncomeMinor).toBe('1000');
    expect(octoberState.snapshotId).toBe(october.snapshotId);
    expect(octoberState.plannedIncomeMinor).toBe('2000');
    const septemberHistory = await historyPage(spaceId, '2026-09-01', 'USD');
    expect(septemberHistory.rows.map((row) => row.snapshotId)).toEqual([september.snapshotId]);
  });

  it('V09 flags childPlanChanged once a root target is edited directly after publish', async () => {
    const spaceId = await freshSpace('Month state stale child head');
    const category = await expenseRootCategory(spaceId, 'Essentials');
    const groupId = randomUUID();
    const template = await saveTemplate({
      spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [{ categoryId: category, groupId }],
    });
    const published = await publishMonth({
      spaceId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '10000', rootTargets: [rootTarget(category, '10000')],
    });
    const before = await monthState(spaceId, '2026-09-01', 'USD', Number(published.snapshotId));
    expect(before.childPlanChanged).toBe(false);
    const currentRevision = await db().client.query<{ target_revision_id: string }>(
      'select target_revision_id::text from public.allocation_month_roots where snapshot_id = $1 and category_id = $2',
      [published.snapshotId, category],
    );
    await planCategoryTarget(spaceId, category, '2026-09-01', 'USD', '4000', Number(currentRevision.rows[0]!.target_revision_id));
    const after = await monthState(spaceId, '2026-09-01', 'USD', Number(published.snapshotId));
    expect(after.childPlanChanged).toBe(true);
  });

  it('rejects a snapshot id that belongs to a different space/currency/month', async () => {
    const spaceId = await freshSpace('Month state foreign snapshot A');
    const otherSpaceId = await freshSpace('Month state foreign snapshot B');
    const template = await saveTemplate({ spaceId: otherSpaceId, groups: [], rootMappings: [] });
    const published = await publishMonth({ spaceId: otherSpaceId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '1000', rootTargets: [] });
    await expect(monthState(spaceId, '2026-09-01', 'USD', Number(published.snapshotId)))
      .rejects.toMatchObject({ code: 'P0001' });
  });

  it('denies an outsider and a removed member', async () => {
    const spaceId = await freshSpace('Month state access control', 'household');
    const member = randomUUID();
    await db().client.query(`insert into auth.users(id, email, email_confirmed_at) values ($1,'ms-member@budget.invalid', now())`, [member]);
    await db().client.query(`insert into public.space_memberships (space_id, user_id, role, status) values ($1,$2,'member','active')`, [spaceId, member]);

    await expect(monthState(spaceId, '2026-09-01', 'USD', null, outsider)).rejects.toMatchObject({ code: '42501' });

    await db().client.query(
      `update public.space_memberships set status='revoked', ended_at=now(), ended_by_user_id=$1 where space_id=$2 and user_id=$3`,
      [actor, spaceId, member],
    );
    await expect(monthState(spaceId, '2026-09-01', 'USD', null, member)).rejects.toMatchObject({ code: '42501' });
  });

  it('rejects a null month and a non-normalized month', async () => {
    const spaceId = await freshSpace('Month state invalid month');
    await expect(monthState(spaceId, null as unknown as string)).rejects.toMatchObject({ code: '42501' });
    await expect(monthState(spaceId, '2026-09-15')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('public.allocation_category_page', () => {
  it('V05 pages 101 roots in one group with aggregates unchanged across page sizes', async () => {
    const spaceId = await freshSpace('Category page 101 roots');
    const groupId = randomUUID();
    const rootIds: string[] = [];
    const roots = await withAuthenticatedTransaction(db().client, actor, async () => {
      for (let index = 0; index < 101; index += 1) {
        const category = await db().client.query<{ id: string }>(
          "select id from public.create_category($1,$2,'expense',$3,null) limit 2",
          [spaceId, randomUUID(), `Root ${index.toString().padStart(3, '0')}`],
        );
        rootIds.push(category.rows[0]!.id);
      }
      return rootIds;
    });
    const template = await saveTemplate({
      spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)],
      rootMappings: roots.map((categoryId) => ({ categoryId, groupId })),
    });
    const published = await publishMonth({
      spaceId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '101000',
      rootTargets: roots.map((categoryId) => rootTarget(categoryId, '1000')),
    });
    const snapshotId = Number(published.snapshotId);

    for (const pageSize of [10, 25, 100]) {
      let cursor: string | null = null;
      const seen = new Set<string>();
      let totalTarget = 0n;
      for (let guard = 0; guard < 20; guard += 1) {
        const page = await categoryPage(spaceId, '2026-09-01', 'USD', snapshotId, null, cursor, pageSize);
        for (const row of page.rows) {
          expect(seen.has(row.rootId)).toBe(false);
          seen.add(row.rootId);
          totalTarget += BigInt(row.targetMinor);
        }
        if (!page.hasMore) break;
        cursor = page.nextRootId;
      }
      expect(seen.size).toBe(101);
      expect(totalTarget).toBe(101000n);
    }
  }, 60_000);

  it('V06 still resolves an archived historical root\'s name and amounts', async () => {
    const spaceId = await freshSpace('Category page archived root');
    const category = await expenseRootCategory(spaceId, 'Legacy Rent');
    const groupId = randomUUID();
    const template = await saveTemplate({
      spaceId, groups: [templateGroup(groupId, 'spending', 0, 10000)], rootMappings: [{ categoryId: category, groupId }],
    });
    const published = await publishMonth({
      spaceId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '5000', rootTargets: [rootTarget(category, '5000')],
    });
    await archiveCategory(spaceId, category);
    const page = await categoryPage(spaceId, '2026-09-01', 'USD', Number(published.snapshotId));
    expect(page.rows).toEqual([expect.objectContaining({ rootId: category, nameEn: 'Legacy Rent', targetMinor: '5000' })]);
  });

  it('rejects a snapshot id that does not belong to this space/currency/month even with a matching group filter', async () => {
    const spaceId = await freshSpace('Category page foreign snapshot');
    await expect(categoryPage(spaceId, '2026-09-01', 'USD', 999_999)).rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects a malformed (non-UUID) after-cursor at the type layer', async () => {
    const spaceId = await freshSpace('Category page invalid cursor');
    const template = await saveTemplate({ spaceId, groups: [], rootMappings: [] });
    const published = await publishMonth({ spaceId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '0', rootTargets: [] });
    await withAuthenticatedTransaction(db().client, actor, () => expect(db().client.query(
      'select public.allocation_category_page($1,$2::date,$3,$4,$5,$6,$7)',
      [spaceId, '2026-09-01', 'USD', Number(published.snapshotId), null, 'not-a-uuid', 50],
    )).rejects.toMatchObject({ code: '22P02' }));
  });

  it('rejects a limit outside 1..100', async () => {
    const spaceId = await freshSpace('Category page limit bound');
    const template = await saveTemplate({ spaceId, groups: [], rootMappings: [] });
    const published = await publishMonth({ spaceId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '0', rootTargets: [] });
    await expect(categoryPage(spaceId, '2026-09-01', 'USD', Number(published.snapshotId), null, null, 0))
      .rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
    await expect(categoryPage(spaceId, '2026-09-01', 'USD', Number(published.snapshotId), null, null, 101))
      .rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('denies an outsider', async () => {
    const spaceId = await freshSpace('Category page access control');
    const template = await saveTemplate({ spaceId, groups: [], rootMappings: [] });
    const published = await publishMonth({ spaceId, templateRevisionId: Number(template.templateRevisionId), incomeMinor: '0', rootTargets: [] });
    await expect(categoryPage(spaceId, '2026-09-01', 'USD', Number(published.snapshotId), null, null, 50, outsider))
      .rejects.toMatchObject({ code: '42501' });
  });
});

describe('public.allocation_history_page', () => {
  it('pages snapshot history newest-first with a correct cursor and hasMore', async () => {
    const spaceId = await freshSpace('History page pagination');
    const template = await saveTemplate({ spaceId, groups: [], rootMappings: [] });
    const templateId = Number(template.templateRevisionId);
    const snapshots: string[] = [];
    let incomeRevisionId: string | null = null;
    for (let index = 0; index < 5; index += 1) {
      const published = await publishMonth({
        spaceId, expectedSnapshotId: snapshots.length === 0 ? null : Number(snapshots.at(-1)),
        expectedIncomeRevisionId: incomeRevisionId === null ? null : Number(incomeRevisionId),
        templateRevisionId: templateId, incomeMinor: String((index + 1) * 1000), rootTargets: [],
      });
      snapshots.push(published.snapshotId);
      incomeRevisionId = published.incomeRevisionId;
    }
    const firstPage = await historyPage(spaceId, '2026-09-01', 'USD', null, 2);
    expect(firstPage.rows.map((row) => row.snapshotId)).toEqual([snapshots[4], snapshots[3]]);
    expect(firstPage.hasMore).toBe(true);
    const secondPage = await historyPage(spaceId, '2026-09-01', 'USD', Number(firstPage.nextId));
    expect(secondPage.rows.map((row) => row.snapshotId)).toEqual([snapshots[2], snapshots[1], snapshots[0]]);
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.nextId).toBeNull();
  });

  it('rejects a limit outside 1..100', async () => {
    const spaceId = await freshSpace('History page limit bound');
    await expect(historyPage(spaceId, '2026-09-01', 'USD', null, 0)).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('denies a removed member', async () => {
    const spaceId = await freshSpace('History page access control', 'household');
    const member = randomUUID();
    await db().client.query(`insert into auth.users(id, email, email_confirmed_at) values ($1,'hp-member@budget.invalid', now())`, [member]);
    await db().client.query(`insert into public.space_memberships (space_id, user_id, role, status) values ($1,$2,'member','active')`, [spaceId, member]);
    await db().client.query(
      `update public.space_memberships set status='revoked', ended_at=now(), ended_by_user_id=$1 where space_id=$2 and user_id=$3`,
      [actor, spaceId, member],
    );
    await expect(historyPage(spaceId, '2026-09-01', 'USD', null, 20, member)).rejects.toMatchObject({ code: '42501' });
  });
});

describe('public.allocation_trend', () => {
  it('V13 seeds every month including an empty one, with accurate per-month totals', async () => {
    const spaceId = await freshSpace('Trend core fixture');
    const wallet = await usdWallet(spaceId);
    const template = await saveTemplate({ spaceId, groups: [], rootMappings: [] });
    const templateId = Number(template.templateRevisionId);
    await publishMonth({ spaceId, month: '2026-09-01', templateRevisionId: templateId, incomeMinor: '10000', rootTargets: [] });
    // October: no snapshot at all, but real activity -- must still appear.
    await recordIncome(spaceId, wallet, '2000', '2026-10-05');
    await recordExpense(spaceId, wallet, '-500', '2026-10-06');
    await publishMonth({
      spaceId, month: '2026-11-01', expectedSnapshotId: null, templateRevisionId: templateId, incomeMinor: '30000', rootTargets: [],
    });

    const result = await trend(spaceId, 'USD', '2026-09-01', 3);
    expect(result.months.map((month) => month.month.slice(0, 10))).toEqual(['2026-09-01', '2026-10-01', '2026-11-01']);
    expect(result.months[0]).toMatchObject({ hasPlan: true, plannedIncomeMinor: '10000', incomeMinor: '0', expenseMinor: '0' });
    expect(result.months[1]).toMatchObject({ hasPlan: false, plannedIncomeMinor: null, incomeMinor: '2000', expenseMinor: '500' });
    expect(result.months[2]).toMatchObject({ hasPlan: true, plannedIncomeMinor: '30000' });
  });

  it('reports an empty month with zero totals when there is no activity and no plan at all', async () => {
    const spaceId = await freshSpace('Trend fully empty month');
    const result = await trend(spaceId, 'USD', '2026-09-01', 1);
    expect(result.months).toEqual([{ month: expect.stringContaining('2026-09-01'), incomeMinor: '0', expenseMinor: '0', ownDebtPaidMinor: '0', hasPlan: false, plannedIncomeMinor: null }]);
  });

  it('rejects a month count outside 1..12', async () => {
    const spaceId = await freshSpace('Trend count bound');
    await expect(trend(spaceId, 'USD', '2026-09-01', 0)).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
    await expect(trend(spaceId, 'USD', '2026-09-01', 13)).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
    await expect(trend(spaceId, 'USD', '2026-09-01', null)).rejects.toMatchObject({ code: '22023', message: 'planning_invalid_input' });
  });

  it('denies an outsider', async () => {
    const spaceId = await freshSpace('Trend access control');
    await expect(trend(spaceId, 'USD', '2026-09-01', 1, outsider)).rejects.toMatchObject({ code: '42501' });
  });
});

describe('allocation projections migration upgrade', () => {
  it('upgrades a database seeded with pre-projection allocation data without disturbing it', async () => {
    const migrations = migrationFiles();
    const projectionsVersion = '20260914130000';
    const projectionsMigration = migrations.find((migration) => migration.version === projectionsVersion);
    const priorMigrations = migrations.filter((migration) => migration.version < projectionsVersion);
    expect(projectionsMigration).toBeDefined();

    const upgrade = await createDisposableDatabase('budget_allocprojup');
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
          "select id from public.create_space($1, 'personal') limit 2", ['Seeded projections upgrade fixture'],
        );
        return space.rows[0]!.id;
      });
      const templateId = await withAuthenticatedTransaction(upgrade.client, seedActor, async () => {
        const result = await upgrade.client.query<{ save_allocation_template: { templateRevisionId: string } }>(
          'select public.save_allocation_template($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
          [seededSpaceId, randomUUID(), 'USD', null, '[]', '[]'],
        );
        return result.rows[0]!.save_allocation_template.templateRevisionId;
      });
      const publishedBefore = await withAuthenticatedTransaction(upgrade.client, seedActor, async () => {
        const result = await upgrade.client.query<{ publish_allocation_month: { snapshotId: string } }>(
          'select public.publish_allocation_month($1,$2,$3::date,$4,$5,$6,$7,$8,$9::jsonb,$10)',
          [seededSpaceId, randomUUID(), '2026-09-01', 'USD', null, Number(templateId), null, '5000', '[]', null],
        );
        return result.rows[0]!.publish_allocation_month.snapshotId;
      });

      const digestBefore = await allocationDigestFor(upgrade.client, seededSpaceId);
      await replayMigrations(upgrade.client, [projectionsMigration!]);
      const digestAfter = await allocationDigestFor(upgrade.client, seededSpaceId);
      expect(digestAfter).toEqual(digestBefore);

      const state = await withAuthenticatedTransaction(upgrade.client, seedActor, async () => {
        const result = await upgrade.client.query<{ allocation_month_state: { snapshotId: string; plannedIncomeMinor: string } }>(
          'select public.allocation_month_state($1,$2::date,$3,$4)', [seededSpaceId, '2026-09-01', 'USD', null],
        );
        return result.rows[0]!.allocation_month_state;
      });
      expect(state.snapshotId).toBe(publishedBefore);
      expect(state.plannedIncomeMinor).toBe('5000');
    } finally {
      await disposeDisposableDatabase(upgrade);
    }
  }, 120_000);
});

async function allocationDigestFor(client: DisposableDatabase['client'], spaceId: string): Promise<unknown> {
  const result = await client.query(
    `select 'snapshots' as relation_name, count(*)::text as row_count,
      md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), '')) as digest
     from (select * from public.allocation_month_snapshots where space_id = $1 order by id limit 101) x
     union all
     select 'events', count(*)::text,
       md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), ''))
     from (select * from public.financial_events where space_id = $1 order by id limit 101) x
     order by relation_name`,
    [spaceId],
  );
  expect(result.rows.every((row: { row_count: string }) => Number(row.row_count) <= 100)).toBe(true);
  return result.rows;
}
