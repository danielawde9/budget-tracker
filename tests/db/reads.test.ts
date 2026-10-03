import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupSpace, type BudgetHarness } from './support/budget.ts';
import { freshDatabase, type TestDatabase } from './support/database.ts';
import { applyExamplePlan, monthOf } from './support/plan.ts';

let db: TestDatabase;
let h: BudgetHarness;
let bank: string;
let lbp: string;
let brokerage: string;
let internet: string;
let big: string;

interface CurrencyOverview {
  currency: 'USD' | 'LBP';
  cashHeld: string;
  setAside: string;
  ready: string;
  setAsideByGroup: { groupId: string; nameEn: string; amount: string }[];
  netWorth: { cash: string; investments: string; owedToMe: string; iOwe: string; total: string };
}

interface Overview {
  today: string;
  month: string;
  currencies: CurrencyOverview[];
  plan: { month: string; expectedIncome: string; received: string; funded: string; stillToFund: string };
  alerts: { kind: string; currency?: string; amount?: string }[];
  referenceRate: { currency: string; unitsPerUsd: string; effectiveOn: string } | null;
}

interface ItemRow {
  itemId: string;
  kind: string;
  nameEn: string;
  planned: string;
  funded: string;
  broughtForward: string;
  opening: string;
  movedIn: string;
  movedOut: string;
  coveredIn: string;
  coveredOut: string;
  spent: string;
  otherOut: string;
  exchanged: string;
  available: string;
  balances: Record<string, string>;
  inPlan: boolean;
}

interface PlanMonth {
  month: string;
  revision: number;
  expectedIncome: string;
  received: string;
  funded: string;
  stillToFund: string;
  ready: string;
  notPlanned: string;
  overPlanned: string;
  groups: { nameEn: string; planned: string; funded: string; spent: string; available: string; over: string; items: ItemRow[]; flex: ItemRow }[];
}

interface Occurrence {
  billId: string;
  name: string;
  dueOn: string;
  status: string;
  expected: string;
  paidAmount: string;
  coverage: string | null;
  shortBy: string;
}

function endOfMonth(day: string): string {
  const date = new Date(`${day.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

beforeAll(async () => {
  db = await freshDatabase();
  h = await setupSpace(db.pool);
  await applyExamplePlan(h);
  bank = await h.wallet('Bank', 'cash', 'USD', 550000n);
  lbp = await h.wallet('LBP cash', 'cash', 'LBP', 4475000n);
  brokerage = await h.wallet('Brokerage', 'investment', 'USD', 1200000n);
  await h.wallet('Car loan', 'loan', 'USD', 600000n, { p_loan_direction: 'i_owe' });
  await h.wallet('Rami', 'loan', 'USD', 30000n, { p_loan_direction: 'owed_to_me', p_counterparty: 'Rami' });
  await h.command('assign_money', {
    p_on: h.today,
    p_opening: true,
    p_moves: [
      { from: null, to: await h.item('General savings'), currency: 'USD', amountMinor: '300000' },
      { from: null, to: await h.item('Holiday'), currency: 'USD', amountMinor: '80000' },
      { from: null, to: await h.item('Insurance reserve'), currency: 'USD', amountMinor: '48000' },
      { from: null, to: await h.item('Groceries'), currency: 'LBP', amountMinor: '4475000' },
    ],
  });
  await h.command('record_income', { p_wallet: bank, p_amount: 411000n, p_on: h.today });
  const proposal = await h.call<{ lines: { itemId: string; amountMinor: string }[] }>('funding_preview', { p_space: h.spaceId, p_month: monthOf(h.today), p_amount: 411000n });
  await h.command('assign_money', { p_on: h.today, p_moves: proposal.lines.map((line) => ({ from: null, to: line.itemId, currency: 'USD', amountMinor: line.amountMinor })) });
  await h.command('record_expense', { p_wallet: bank, p_item: await h.item('Groceries'), p_amount: 8540n, p_on: h.today });
  await h.command('record_expense', { p_wallet: lbp, p_item: await h.item('Groceries'), p_amount: 1790000n, p_on: h.today });
  await h.command('record_expense', { p_wallet: bank, p_item: await h.item('Eating out'), p_amount: 13550n, p_on: h.today, p_cover_from: await h.item('Fun') });
  internet = (await h.command<{ billId: string }>('save_bill', { p_name: 'Internet', p_item: await h.item('Bills'), p_amount: 4500n, p_currency: 'USD', p_cadence: 'monthly', p_first_due: h.today })).billId;
  big = (await h.command<{ billId: string }>('save_bill', { p_name: 'Big', p_item: await h.item('Bills'), p_amount: 30000n, p_currency: 'USD', p_cadence: 'once', p_first_due: endOfMonth(h.today) })).billId;
});

afterAll(async () => {
  await db.close();
});

describe('my_spaces', () => {
  it('lists the caller’s spaces with the space clock', async () => {
    const spaces = await h.call<{ id: string; role: string; today: string; planCurrency: string }[]>('my_spaces');
    expect(spaces).toEqual([expect.objectContaining({ id: h.spaceId, role: 'owner', today: h.today, planCurrency: 'USD' })]);
  });
});

describe('space_overview', () => {
  it('shows cash held = set aside + ready to assign, per currency, never mixed', async () => {
    const overview = await h.call<Overview>('space_overview', { p_space: h.spaceId });
    const usd = overview.currencies.find((c) => c.currency === 'USD');
    const lbpView = overview.currencies.find((c) => c.currency === 'LBP');
    expect(usd).toMatchObject({ cashHeld: '938910', setAside: '816910', ready: '122000' });
    expect(lbpView).toMatchObject({ cashHeld: '2685000', setAside: '2685000', ready: '0' });
    const byGroup = usd?.setAsideByGroup.reduce((sum, group) => sum + BigInt(group.amount), 0n);
    expect(byGroup).toBe(816910n);
  });

  it('keeps investments and loans in net worth only', async () => {
    const overview = await h.call<Overview>('space_overview', { p_space: h.spaceId });
    expect(overview.currencies.find((c) => c.currency === 'USD')?.netWorth).toEqual({
      cash: '938910',
      investments: '1200000',
      owedToMe: '30000',
      iOwe: '600000',
      total: '1568910',
    });
  });

  it('reports the plan month: expected, received, funded, still to fund', async () => {
    const overview = await h.call<Overview>('space_overview', { p_space: h.spaceId });
    expect(overview.plan).toMatchObject({ month: monthOf(h.today), expectedIncome: '411000', received: '411000', funded: '411000', stillToFund: '0' });
    expect(overview.referenceRate).toMatchObject({ currency: 'LBP', unitsPerUsd: '89500' });
  });

  it('raises a bill-short alert and no over-assigned alert', async () => {
    const overview = await h.call<Overview>('space_overview', { p_space: h.spaceId });
    expect(overview.alerts.map((alert) => alert.kind)).toContain('bill_short');
    expect(overview.alerts.map((alert) => alert.kind)).not.toContain('over_assigned');
  });
});

describe('plan_month', () => {
  async function planMonth(month = monthOf(h.today)): Promise<PlanMonth> {
    return h.call<PlanMonth>('plan_month', { p_space: h.spaceId, p_month: month });
  }

  function item(plan: PlanMonth, name: string): ItemRow {
    for (const group of plan.groups) {
      const found = [...group.items, group.flex].find((row) => row.nameEn === name);
      if (found) return found;
    }
    throw new Error(`No item ${name}`);
  }

  it('separates opening balances from this month’s funding', async () => {
    const plan = await planMonth();
    expect(item(plan, 'Holiday')).toMatchObject({ opening: '80000', funded: '40000', broughtForward: '0', available: '120000' });
  });

  it('shows covered overspending on both items and LBP beside USD', async () => {
    const plan = await planMonth();
    expect(item(plan, 'Eating out')).toMatchObject({ funded: '12000', coveredIn: '1550', spent: '13550', available: '0' });
    expect(item(plan, 'Fun')).toMatchObject({ funded: '8550', coveredOut: '1550', available: '7000' });
    expect(item(plan, 'Groceries')).toMatchObject({ funded: '60000', spent: '8540', available: '51460', balances: { USD: '51460', LBP: '2685000' } });
  });

  it('balances every item statement: brought + in − out = available', async () => {
    const plan = await planMonth();
    for (const group of plan.groups) {
      for (const row of [...group.items, group.flex]) {
        const computed = BigInt(row.broughtForward) + BigInt(row.opening) + BigInt(row.funded) + BigInt(row.movedIn) - BigInt(row.movedOut)
          + BigInt(row.coveredIn) - BigInt(row.coveredOut) - BigInt(row.spent) - BigInt(row.otherOut) + BigInt(row.exchanged);
        expect(computed, row.nameEn).toBe(BigInt(row.available));
      }
    }
  });

  it('totals the month exactly', async () => {
    const plan = await planMonth();
    expect(plan).toMatchObject({ expectedIncome: '411000', received: '411000', funded: '411000', stillToFund: '0', ready: '122000', notPlanned: '0', overPlanned: '0' });
    const essentials = plan.groups.find((group) => group.nameEn === 'Essentials');
    expect(essentials).toMatchObject({ planned: '246600', funded: '246600', spent: '8540' });
  });

  it('carries every balance into the next month with nothing funded yet', async () => {
    const plan = await planMonth(monthOf(h.today, 1));
    expect(item(plan, 'Holiday')).toMatchObject({ broughtForward: '120000', opening: '0', funded: '0', available: '120000', planned: '40000' });
    expect(plan.stillToFund).toBe('411000');
  });
});

describe('bills_upcoming', () => {
  it('lines unpaid bills up against their item in due order', async () => {
    const occurrences = await h.call<Occurrence[]>('bills_upcoming', { p_space: h.spaceId, p_from: h.today, p_to: addDays(h.today, 40) });
    const thisMonth = occurrences.filter((o) => o.dueOn <= endOfMonth(h.today));
    expect(thisMonth.map((o) => [o.name, o.coverage, o.shortBy])).toEqual([
      ['Internet', 'covered', '0'],
      ['Big', 'short', '9500'],
    ]);
    const nextInternet = occurrences.find((o) => o.billId === internet && o.dueOn > endOfMonth(h.today));
    expect(nextInternet).toMatchObject({ status: 'due', coverage: null });
  });

  it('marks a paid occurrence with what was actually paid', async () => {
    await h.command('record_expense', { p_wallet: bank, p_item: await h.item('Bills'), p_amount: 4730n, p_on: h.today, p_bill: internet, p_bill_due: h.today });
    const occurrences = await h.call<Occurrence[]>('bills_upcoming', { p_space: h.spaceId, p_from: h.today, p_to: endOfMonth(h.today) });
    expect(occurrences.find((o) => o.billId === internet)).toMatchObject({ status: 'paid', paidAmount: '4730', expected: '4500', coverage: null });
    expect(occurrences.find((o) => o.billId === big)).toMatchObject({ coverage: 'short', shortBy: '9730' });
  });
});

describe('accounts_overview', () => {
  it('reports investment contributions apart from gains', async () => {
    await h.command('record_investment', { p_action: 'value', p_investment: brokerage, p_amount: 1214900n, p_on: h.today });
    const accounts = await h.call<{ wallets: { id: string; balance: string; contributed?: string; gain?: string }[] }>('accounts_overview', { p_space: h.spaceId });
    expect(accounts.wallets.find((w) => w.id === brokerage)).toMatchObject({ balance: '1214900', contributed: '1200000', gain: '14900' });
  });
});

describe('activity_page', () => {
  it('pages through every entry once, newest first', async () => {
    const seen: string[] = [];
    let before: unknown = null;
    for (let page = 0; page < 20; page += 1) {
      const result: { entries: { entryId: string }[]; next: unknown } = await h.call('activity_page', { p_space: h.spaceId, p_limit: 3, p_before: before });
      seen.push(...result.entries.map((entry) => entry.entryId));
      if (!result.next) break;
      before = result.next;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(await h.entryCount());
  });

  it('describes both sides of an entry in names', async () => {
    const result = await h.call<{ entries: { kind: string; wallets: { name: string; amount: string }[]; items: { nameEn: string; amount: string; flow: string }[] }[] }>(
      'activity_page',
      { p_space: h.spaceId, p_limit: 50, p_filter: { kind: 'expense', itemId: await h.item('Eating out') } },
    );
    expect(result.entries).toHaveLength(1);
    const entry = result.entries[0];
    expect(entry?.wallets).toEqual([expect.objectContaining({ name: 'Bank', amount: '-13550' })]);
    expect(entry?.items.map((line) => `${line.nameEn}:${line.flow}:${line.amount}`).sort()).toEqual(['Eating out:cover:1550', 'Eating out:spend:-13550', 'Fun:cover:-1550']);
  });
});
