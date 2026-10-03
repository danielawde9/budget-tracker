import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runExistingMoneyStory, runFreshSetup, type ScenarioCaller, type StoryRefs } from '../../scripts/preview/scenario.ts';
import { callAs, createUser } from './support/actor.ts';
import { freshDatabase, type TestDatabase } from './support/database.ts';

// The ten demonstrations of the spec (§6) through the same script the preview
// seed runs. Every figure below is the spec's worked example, in cents.

let db: TestDatabase;
let caller: ScenarioCaller;
let story: StoryRefs;

interface Overview {
  currencies: { currency: string; cashHeld: string; setAside: string; ready: string; netWorth: { total: string } }[];
  plan: { funded: string; stillToFund: string; received: string };
}

interface Row {
  itemId: string;
  nameEn: string;
  funded: string;
  opening: string;
  movedIn: string;
  movedOut: string;
  coveredIn: string;
  coveredOut: string;
  broughtForward: string;
  spent: string;
  otherOut: string;
  available: string;
  balances: Record<string, string>;
}

interface PlanMonth {
  funded: string;
  groups: { nameEn: string; funded: string; spent: string; otherOut: string; items: Row[]; flex: Row }[];
}

beforeAll(async () => {
  db = await freshDatabase();
  const userId = await createUser(db.pool, 'story@demo.test');
  caller = { call: (rpc, args) => callAs(db.pool, userId, rpc, args) };
  story = await runExistingMoneyStory(caller);
});

afterAll(async () => {
  await db.close();
});

const overview = () => caller.call<Overview>('space_overview', { p_space: story.spaceId });
const planMonth = (month: string) => caller.call<PlanMonth>('plan_month', { p_space: story.spaceId, p_month: month });

function row(plan: PlanMonth, name: string): Row {
  for (const group of plan.groups) {
    const found = [...group.items, group.flex].find((candidate) => candidate.nameEn === name);
    if (found) return found;
  }
  throw new Error(`No item ${name}`);
}

describe('1 · a fresh account starts from zero', () => {
  it('has nothing to spend and the whole plan still to fund', async () => {
    const userId = await createUser(db.pool);
    const fresh: ScenarioCaller = { call: (rpc, args) => callAs(db.pool, userId, rpc, args) };
    const { spaceId } = await runFreshSetup(fresh);
    const view = await fresh.call<Overview>('space_overview', { p_space: spaceId });
    expect(view.currencies.find((c) => c.currency === 'USD')).toMatchObject({ cashHeld: '0', setAside: '0', ready: '0' });
    expect(view.plan).toMatchObject({ received: '0', funded: '0', stillToFund: '411000' });
  });
});

describe('2 · existing money enters as opening balances', () => {
  it('records opening balances of items in the setup month, apart from funding', async () => {
    const setup = await planMonth(story.setupMonth);
    expect(row(setup, 'Holiday')).toMatchObject({ opening: '80000', funded: '40000' });
    expect(row(setup, 'General savings')).toMatchObject({ opening: '300000', funded: '41100' });
    expect(row(setup, 'Insurance reserve')).toMatchObject({ opening: '48000', funded: '15000', available: '63000' });
  });
});

describe('3 · income funds the month', () => {
  it('funds exactly $4,110 in each month and nothing more', async () => {
    expect((await planMonth(story.setupMonth)).funded).toBe('411000');
    expect((await planMonth(story.currentMonth)).funded).toBe('411000');
  });
});

describe('5 · groceries and guilt-free spending', () => {
  it('spends USD and LBP from Groceries side by side', async () => {
    const setup = await planMonth(story.setupMonth);
    expect(row(setup, 'Groceries')).toMatchObject({ spent: '48570', available: '11430', balances: { USD: '11430', LBP: '2685000' } });
  });

  it('covers the eating-out overspend from Fun', async () => {
    const setup = await planMonth(story.setupMonth);
    expect(row(setup, 'Eating out')).toMatchObject({ funded: '12000', coveredIn: '1550', spent: '13550', available: '0' });
    expect(row(setup, 'Fun')).toMatchObject({ coveredOut: '1550', spent: '4000', available: '3000' });
    expect(setup.groups.find((group) => group.nameEn === 'Guilt free')?.spent).toBe('17550');
  });
});

describe('6 · unspent money carries forward', () => {
  it('starts the new month with last month’s balances', async () => {
    const current = await planMonth(story.currentMonth);
    expect(row(current, 'Groceries')).toMatchObject({ broughtForward: '11430', funded: '60000', available: '65010' });
    expect(row(current, 'Bills')).toMatchObject({ broughtForward: '5000', funded: '25000', available: '30000' });
    expect(row(current, 'Fun')).toMatchObject({ broughtForward: '3000', funded: '8550', available: '11550' });
  });
});

describe('7 · reassigning savings to a goal', () => {
  it('moves money without new funding or a wallet movement', async () => {
    const current = await planMonth(story.currentMonth);
    expect(row(current, 'General savings')).toMatchObject({ broughtForward: '341100', funded: '41100', movedOut: '15000', available: '367200' });
    expect(row(current, 'Holiday')).toMatchObject({ broughtForward: '120000', funded: '40000', movedIn: '15000', available: '175000' });
    const savings = current.groups.find((group) => group.nameEn === 'Savings');
    expect(savings?.funded).toBe('41100');
  });
});

describe('8 · insurance paid from its reserve', () => {
  it('empties the reserve once and leaves Ready to assign alone', async () => {
    const current = await planMonth(story.currentMonth);
    expect(row(current, 'Insurance reserve')).toMatchObject({ broughtForward: '63000', funded: '15000', spent: '78000', available: '0' });
    const bills = await caller.call<{ billId: string; status: string; paidAmount: string }[]>('bills_upcoming', {
      p_space: story.spaceId, p_from: story.currentMonth, p_to: story.today,
    });
    expect(bills.find((bill) => bill.billId === story.bills.insurance)).toMatchObject({ status: 'paid', paidAmount: '78000' });
  });
});

describe('9 · investments are separate from spendable cash', () => {
  it('reports contributions apart from the market gain', async () => {
    const accounts = await caller.call<{ wallets: { id: string; balance: string; contributed?: string; gain?: string }[] }>('accounts_overview', { p_space: story.spaceId });
    expect(accounts.wallets.find((w) => w.id === story.wallets.brokerage)).toMatchObject({ balance: '1297100', contributed: '1282200', gain: '14900' });
    const current = await planMonth(story.currentMonth);
    expect(row(current, 'To invest')).toMatchObject({ funded: '41100', otherOut: '41100', spent: '0', available: '0' });
  });
});

describe('10 · bills and loans read the same balances', () => {
  it('splits the installment into principal and interest', async () => {
    const accounts = await caller.call<{ wallets: { id: string; balance: string }[] }>('accounts_overview', { p_space: story.spaceId });
    expect(accounts.wallets.find((w) => w.id === story.wallets.carLoan)?.balance).toBe('-565800');
    expect(accounts.wallets.find((w) => w.id === story.wallets.rami)?.balance).toBe('20000');
    const current = await planMonth(story.currentMonth);
    expect(row(current, 'Car loan payment')).toMatchObject({ spent: '2800', otherOut: '17200', available: '0' });
  });

  it('shows this month’s upcoming bills as covered by Bills', async () => {
    const lastDay = new Date(`${story.currentMonth}T12:00:00Z`);
    lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
    const bills = await caller.call<{ billId: string; dueOn: string; status: string; coverage: string | null }[]>('bills_upcoming', {
      p_space: story.spaceId, p_from: story.today, p_to: lastDay.toISOString().slice(0, 10),
    });
    for (const bill of bills.filter((candidate) => ['due', 'overdue'].includes(candidate.status))) {
      expect(bill.coverage, bill.billId).toBe('covered');
    }
  });
});

describe('the state on the third day of the month', () => {
  it('holds $8,712.60 = $7,392.60 set aside + $1,320.00 ready to assign', async () => {
    const view = await overview();
    expect(view.currencies.find((c) => c.currency === 'USD')).toMatchObject({ cashHeld: '871260', setAside: '739260', ready: '132000' });
    expect(view.currencies.find((c) => c.currency === 'LBP')).toMatchObject({ cashHeld: '2685000', setAside: '2685000', ready: '0' });
  });

  it('keeps wallet balances and net worth exact', async () => {
    const accounts = await caller.call<{ wallets: { id: string; balance: string }[] }>('accounts_overview', { p_space: story.spaceId });
    expect(accounts.wallets.find((w) => w.id === story.wallets.bank)?.balance).toBe('844460');
    expect(accounts.wallets.find((w) => w.id === story.wallets.cash)?.balance).toBe('26800');
    const view = await overview();
    expect(view.currencies.find((c) => c.currency === 'USD')?.netWorth.total).toBe('1622560');
  });
});
