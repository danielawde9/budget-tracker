import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupSpace, type BudgetHarness } from './support/budget.ts';
import { freshDatabase, type TestDatabase } from './support/database.ts';
import { applyExamplePlan, currentPlan, groupNamed, monthOf, newItem, planLines, setMonthly } from './support/plan.ts';

let db: TestDatabase;

beforeAll(async () => {
  db = await freshDatabase();
});

afterAll(async () => {
  await db.close();
});

interface Preview {
  available: string;
  lines: { itemId: string; amountMinor: string }[];
  unfunded: string;
}

async function preview(h: BudgetHarness, amount?: bigint): Promise<{ raw: Preview; named: string[] }> {
  const raw = await h.call<Preview>('funding_preview', {
    p_space: h.spaceId,
    p_month: monthOf(h.today),
    p_currency: 'USD',
    p_amount: amount ?? null,
  });
  const names = await db.pool.query<{ id: string; name: string }>('select id::text, name_en as name from budget.items where space_id = $1', [h.spaceId]);
  const byId = new Map(names.rows.map((row) => [row.id, row.name]));
  return { raw, named: raw.lines.map((line) => `${byId.get(line.itemId) ?? line.itemId}=${line.amountMinor}`) };
}

async function withBank(h: BudgetHarness, amount: bigint): Promise<string> {
  return h.wallet('Bank', 'cash', 'USD', amount);
}

describe('group amounts and the flexible remainder', () => {
  it('sends a whole group to its flexible item while no items are planned', async () => {
    const h = await setupSpace(db.pool);
    const lines = await planLines(db.pool, h.spaceId, monthOf(h.today));
    expect(lines.filter((line) => line.planned !== '0')).toEqual([
      { group: 'Essentials', item: 'Other essentials', planned: '246600' },
      { group: 'Guilt free', item: 'Other guilt-free', planned: '20550' },
      { group: 'Short-term goals', item: 'Goals money', planned: '61650' },
      { group: 'Savings', item: 'General savings', planned: '41100' },
      { group: 'Investments', item: 'To invest', planned: '41100' },
    ]);
  });

  it('gives each group exactly its percentage: items first, the rest to the flexible item', async () => {
    const h = await setupSpace(db.pool);
    await applyExamplePlan(h);
    const lines = await planLines(db.pool, h.spaceId, monthOf(h.today));
    expect(lines).toEqual([
      { group: 'Essentials', item: 'Rent', planned: '100000' },
      { group: 'Essentials', item: 'Bills', planned: '25000' },
      { group: 'Essentials', item: 'Groceries', planned: '60000' },
      { group: 'Essentials', item: 'Transport', planned: '25000' },
      { group: 'Essentials', item: 'Insurance reserve', planned: '15000' },
      { group: 'Essentials', item: 'Car loan payment', planned: '20000' },
      { group: 'Essentials', item: 'Other essentials', planned: '1600' },
      { group: 'Guilt free', item: 'Eating out', planned: '12000' },
      { group: 'Guilt free', item: 'Fun', planned: '8550' },
      { group: 'Guilt free', item: 'Other guilt-free', planned: '0' },
      { group: 'Short-term goals', item: 'Holiday', planned: '40000' },
      { group: 'Short-term goals', item: 'Laptop', planned: '21650' },
      { group: 'Short-term goals', item: 'Goals money', planned: '0' },
      { group: 'Savings', item: 'General savings', planned: '41100' },
      { group: 'Investments', item: 'To invest', planned: '41100' },
    ]);
    const total = lines.reduce((sum, line) => sum + BigInt(line.planned), 0n);
    expect(total).toBe(411000n);
  });

  it('gives an over-planned group nothing extra and leaves the overage visible', async () => {
    const h = await setupSpace(db.pool);
    const { revision, payload } = await currentPlan(db.pool, h.spaceId, monthOf(h.today));
    setMonthly(payload, 'Rent', 250000n);
    await h.command('save_plan', { p_month: monthOf(h.today), p_expected_revision: revision, p_plan: payload });
    const lines = await planLines(db.pool, h.spaceId, monthOf(h.today));
    expect(lines.find((line) => line.item === 'Other essentials')?.planned).toBe('0');
    expect(lines.find((line) => line.item === 'Rent')?.planned).toBe('250000');
  });

  it('leaves the unplanned share out of every group when percentages total under 100%', async () => {
    const h = await setupSpace(db.pool);
    const { revision, payload } = await currentPlan(db.pool, h.spaceId, monthOf(h.today));
    groupNamed(payload, 'Savings').percentBps = 0;
    await h.command('save_plan', { p_month: monthOf(h.today), p_expected_revision: revision, p_plan: payload });
    const lines = await planLines(db.pool, h.spaceId, monthOf(h.today));
    expect(lines.reduce((sum, line) => sum + BigInt(line.planned), 0n)).toBe(369900n);
  });
});

describe('save_plan', () => {
  it('refuses a stale revision', async () => {
    const h = await setupSpace(db.pool);
    const { revision, payload } = await currentPlan(db.pool, h.spaceId, monthOf(h.today));
    await h.command('save_plan', { p_month: monthOf(h.today), p_expected_revision: revision, p_plan: payload });
    await expect(h.command('save_plan', { p_month: monthOf(h.today), p_expected_revision: revision, p_plan: payload })).rejects.toMatchObject({ message: 'BUDGET_STALE_PLAN' });
  });

  it('applies an edit from its month forward and keeps earlier months', async () => {
    const h = await setupSpace(db.pool);
    const next = monthOf(h.today, 1);
    const { revision, payload } = await currentPlan(db.pool, h.spaceId, next);
    setMonthly(payload, 'Rent', 90000n);
    await h.command('save_plan', { p_month: next, p_expected_revision: revision, p_plan: payload });
    const thisMonth = await planLines(db.pool, h.spaceId, monthOf(h.today));
    const nextMonth = await planLines(db.pool, h.spaceId, next);
    const later = await planLines(db.pool, h.spaceId, monthOf(h.today, 5));
    expect(thisMonth.find((line) => line.item === 'Rent')?.planned).toBe('0');
    expect(nextMonth.find((line) => line.item === 'Rent')?.planned).toBe('90000');
    expect(later.find((line) => line.item === 'Rent')?.planned).toBe('90000');
  });

  it('refuses a plan that leaves out an active group', async () => {
    const h = await setupSpace(db.pool);
    const { revision, payload } = await currentPlan(db.pool, h.spaceId, monthOf(h.today));
    payload.groups.pop();
    await expect(h.command('save_plan', { p_month: monthOf(h.today), p_expected_revision: revision, p_plan: payload })).rejects.toMatchObject({ message: 'BUDGET_INVALID_PLAN' });
  });

  it('refuses changing what kind an item is', async () => {
    const h = await setupSpace(db.pool);
    const { revision, payload } = await currentPlan(db.pool, h.spaceId, monthOf(h.today));
    const rent = groupNamed(payload, 'Essentials').items.find((item) => item.nameEn === 'Rent');
    if (!rent) throw new Error('Rent missing');
    rent.kind = 'goal';
    await expect(h.command('save_plan', { p_month: monthOf(h.today), p_expected_revision: revision, p_plan: payload })).rejects.toMatchObject({ message: 'BUDGET_INVALID_PLAN' });
  });

  it('refuses percentages above 100%', async () => {
    const h = await setupSpace(db.pool);
    const { revision, payload } = await currentPlan(db.pool, h.spaceId, monthOf(h.today));
    groupNamed(payload, 'Savings').percentBps = 1001;
    await expect(h.command('save_plan', { p_month: monthOf(h.today), p_expected_revision: revision, p_plan: payload })).rejects.toMatchObject({ message: 'BUDGET_PLAN_OVER_100' });
  });

  it('adds a new group with its own flexible item', async () => {
    const h = await setupSpace(db.pool);
    const { revision, payload } = await currentPlan(db.pool, h.spaceId, monthOf(h.today));
    groupNamed(payload, 'Essentials').percentBps = 5500;
    payload.groups.push({ groupId: null, nameEn: 'Giving', nameAr: 'العطاء', percentBps: 500, items: [newItem('spending', 'Charity', 10000n)] });
    await h.command('save_plan', { p_month: monthOf(h.today), p_expected_revision: revision, p_plan: payload });
    const lines = await planLines(db.pool, h.spaceId, monthOf(h.today));
    expect(lines.filter((line) => line.group === 'Giving')).toEqual([
      { group: 'Giving', item: 'Charity', planned: '10000' },
      { group: 'Giving', item: 'Other Giving', planned: '10550' },
    ]);
  });

  it('archives an emptied item but refuses one that still holds money', async () => {
    const h = await setupSpace(db.pool);
    await withBank(h, 10000n);
    await h.command('assign_money', { p_on: h.today, p_moves: [{ from: null, to: await h.item('Fun'), currency: 'USD', amountMinor: '100' }] });
    const fun = await h.item('Fun');
    const eating = await h.item('Eating out');
    const first = await currentPlan(db.pool, h.spaceId, monthOf(h.today));
    const guilt = groupNamed(first.payload, 'Guilt free');
    guilt.items = guilt.items.filter((item) => item.itemId !== fun);
    first.payload.archiveItemIds = [fun];
    await expect(h.command('save_plan', { p_month: monthOf(h.today), p_expected_revision: first.revision, p_plan: first.payload })).rejects.toMatchObject({ message: 'BUDGET_ARCHIVE_NONZERO' });
    const second = await currentPlan(db.pool, h.spaceId, monthOf(h.today));
    const guiltAgain = groupNamed(second.payload, 'Guilt free');
    guiltAgain.items = guiltAgain.items.filter((item) => item.itemId !== eating);
    second.payload.archiveItemIds = [eating];
    await h.command('save_plan', { p_month: monthOf(h.today), p_expected_revision: second.revision, p_plan: second.payload });
    const archived = await db.pool.query('select archived_at is not null as archived from budget.items where id = $1', [eating]);
    expect(archived.rows).toEqual([{ archived: true }]);
  });
});

describe('funding_preview fills the month top to bottom', () => {
  it('fills Rent, Bills, Groceries and part of Transport from a first half-paycheck', async () => {
    const h = await setupSpace(db.pool);
    await applyExamplePlan(h);
    await withBank(h, 205500n);
    const { raw, named } = await preview(h);
    expect(raw.available).toBe('205500');
    expect(named).toEqual(['Rent=100000', 'Bills=25000', 'Groceries=60000', 'Transport=20500']);
    expect(raw.unfunded).toBe('205500');
  });

  it('continues where funding stopped and never re-funds what is funded (edit_after_funding)', async () => {
    const h = await setupSpace(db.pool);
    await applyExamplePlan(h);
    await withBank(h, 411000n);
    const first = await preview(h, 205500n);
    await h.command('assign_money', { p_on: h.today, p_moves: first.raw.lines.map((line) => ({ from: null, to: line.itemId, currency: 'USD', amountMinor: line.amountMinor })) });
    const { revision, payload } = await currentPlan(db.pool, h.spaceId, monthOf(h.today));
    setMonthly(payload, 'Groceries', 70000n);
    setMonthly(payload, 'Transport', 24500n);
    await h.command('save_plan', { p_month: monthOf(h.today), p_expected_revision: revision, p_plan: payload });
    const second = await preview(h, 20000n);
    expect(second.named).toEqual(['Groceries=10000', 'Transport=4000', 'Insurance reserve=6000']);
  });

  it('proposes everything when the full plan has arrived, and reports nothing unfunded', async () => {
    const h = await setupSpace(db.pool);
    await applyExamplePlan(h);
    await withBank(h, 500000n);
    const { raw } = await preview(h);
    expect(raw.lines.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n)).toBe(411000n);
    expect(raw.unfunded).toBe('0');
    expect(raw.lines.every((line) => BigInt(line.amountMinor) > 0n)).toBe(true);
  });

  it('proposes nothing for a currency the plan is not written in', async () => {
    const h = await setupSpace(db.pool);
    await h.wallet('LBP cash', 'cash', 'LBP', 1000000n);
    const raw = await h.call<Preview>('funding_preview', { p_space: h.spaceId, p_month: monthOf(h.today), p_currency: 'LBP', p_amount: null });
    expect(raw.lines).toEqual([]);
  });
});
