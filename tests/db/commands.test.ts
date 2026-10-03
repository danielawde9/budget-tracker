import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, callAs, createUser, rpc } from './support/actor.ts';
import { identity, setupSpace, type BudgetHarness } from './support/budget.ts';
import { freshDatabase, type TestDatabase } from './support/database.ts';

let db: TestDatabase;

beforeAll(async () => {
  db = await freshDatabase();
});

afterAll(async () => {
  await db.close();
});

/** A space with Bank $5,000 (all in Ready to assign) and LBP cash LL 0. */
async function funded(): Promise<BudgetHarness & { bank: string; lbp: string }> {
  const h = await setupSpace(db.pool);
  const bank = await h.wallet('Bank', 'cash', 'USD', 500000n);
  const lbp = await h.wallet('LBP cash', 'cash', 'LBP');
  return Object.assign(h, { bank, lbp });
}

async function fund(h: BudgetHarness, itemName: string, amount: bigint, currency = 'USD'): Promise<void> {
  await h.command('assign_money', {
    p_on: h.today,
    p_moves: [{ from: null, to: await h.item(itemName), currency, amountMinor: amount.toString() }],
  });
}

describe('create_space', () => {
  it('creates the space with Ready to assign and the default plan', async () => {
    const h = await setupSpace(db.pool);
    const groups = await db.pool.query<{ name_en: string; name_ar: string; percent_bps: number; flex: string }>(
      `select g.name_en, g.name_ar, pg.percent_bps, f.name_en as flex
         from budget.plan_version_groups pg
         join budget.plan_groups g on g.id = pg.group_id
         join budget.items f on f.group_id = g.id and f.kind = 'flex'
        where pg.space_id = $1 order by pg.position`,
      [h.spaceId],
    );
    expect(groups.rows).toEqual([
      { name_en: 'Essentials', name_ar: 'الأساسيات', percent_bps: 6000, flex: 'Other essentials' },
      { name_en: 'Guilt free', name_ar: 'الإنفاق الحر', percent_bps: 500, flex: 'Other guilt-free' },
      { name_en: 'Short-term goals', name_ar: 'الأهداف قصيرة المدى', percent_bps: 1500, flex: 'Goals money' },
      { name_en: 'Savings', name_ar: 'الادخار', percent_bps: 1000, flex: 'General savings' },
      { name_en: 'Investments', name_ar: 'الاستثمار', percent_bps: 1000, flex: 'To invest' },
    ]);
    const version = await db.pool.query('select expected_income_minor::text as income, effective_month::text as month from budget.plan_versions where space_id = $1', [h.spaceId]);
    expect(version.rows).toEqual([{ income: '411000', month: `${h.today.slice(0, 7)}-01` }]);
    await expect(h.readyBalance()).resolves.toBe(0n);
  });

  it('returns the same space for a repeated request', async () => {
    const userId = await createUser(db.pool);
    const request = randomUUID();
    const first = await callAs<{ spaceId: string }>(db.pool, userId, 'create_space', { p_request: request, p_name: 'Once' });
    const second = await callAs<{ spaceId: string }>(db.pool, userId, 'create_space', { p_request: request, p_name: 'Once' });
    expect(second.spaceId).toBe(first.spaceId);
    const count = await db.pool.query('select count(*)::int as n from budget.spaces where created_by = $1', [userId]);
    expect(count.rows[0]).toEqual({ n: 1 });
  });

  it('is not callable by the anonymous role', async () => {
    await expect(asAnon(db.pool, (c) => rpc(c, 'create_space', { p_request: randomUUID(), p_name: 'Nope' }))).rejects.toMatchObject({ code: '42501' });
  });

  it("refuses another user's space with BUDGET_NOT_MEMBER", async () => {
    const h = await funded();
    const intruder = await createUser(db.pool);
    await expect(
      callAs(db.pool, intruder, 'record_income', { p_space: h.spaceId, p_request: randomUUID(), p_wallet: h.bank, p_amount: 100n, p_on: h.today }),
    ).rejects.toMatchObject({ code: '42501', message: 'BUDGET_NOT_MEMBER' });
  });
});

describe('create_wallet opening balances', () => {
  it('puts an opening cash balance into Ready to assign, not income', async () => {
    const h = await setupSpace(db.pool);
    await h.wallet('Bank', 'cash', 'USD', 520000n);
    const entry = await db.pool.query<{ id: string; kind: string }>('select id, kind from budget.entries where space_id = $1', [h.spaceId]);
    expect(entry.rows.map((row) => row.kind)).toEqual(['opening_balance']);
    expect(await h.lines(entry.rows[0]?.id ?? '')).toEqual(['i:Ready to assign:USD:520000:opening', 'w:Bank:USD:520000:opening']);
  });

  it('records investments and loans at setup without touching spendable money', async () => {
    const h = await setupSpace(db.pool);
    const brokerage = await h.wallet('Brokerage', 'investment', 'USD', 1200000n);
    const car = await h.wallet('Car loan', 'loan', 'USD', 600000n, { p_loan_direction: 'i_owe' });
    const rami = await h.wallet('Rami', 'loan', 'USD', 30000n, { p_loan_direction: 'owed_to_me', p_counterparty: 'Rami' });
    expect(await h.walletBalance(brokerage)).toBe(1200000n);
    expect(await h.walletBalance(car)).toBe(-600000n);
    expect(await h.walletBalance(rami)).toBe(30000n);
    expect(await h.readyBalance()).toBe(0n);
  });

  it('lets a card start in debt, which reduces Ready to assign', async () => {
    const h = await setupSpace(db.pool);
    await h.wallet('Card', 'cash', 'USD', -50000n);
    expect(await h.readyBalance()).toBe(-50000n);
  });

  it('refuses a future opening date', async () => {
    const h = await setupSpace(db.pool);
    await expect(h.wallet('Bank', 'cash', 'USD', 100n, { p_opened_on: '2999-01-01' })).rejects.toMatchObject({ message: 'BUDGET_FUTURE_DATE' });
  });
});

describe('assign_money', () => {
  it('records setup assignments as opening balances of the items', async () => {
    const h = await funded();
    const result = await h.command('assign_money', {
      p_on: h.today,
      p_opening: true,
      p_moves: [{ from: null, to: await h.item('General savings'), currency: 'USD', amountMinor: '300000' }],
    });
    const kind = await db.pool.query('select kind from budget.entries where id = $1', [result.entryId]);
    expect(kind.rows).toEqual([{ kind: 'opening_assign' }]);
    expect(await h.lines(result.entryId)).toEqual(['i:General savings:USD:300000:opening', 'i:Ready to assign:USD:-300000:opening']);
  });

  it('funds, moves and releases in one entry', async () => {
    const h = await funded();
    await fund(h, 'General savings', 41100n);
    const result = await h.command('assign_money', {
      p_on: h.today,
      p_moves: [
        { from: null, to: await h.item('Groceries'), currency: 'USD', amountMinor: '60000' },
        { from: await h.item('General savings'), to: await h.item('Goals money'), currency: 'USD', amountMinor: '15000' },
        { from: await h.item('Groceries'), to: null, currency: 'USD', amountMinor: '1000' },
      ],
    });
    expect(await h.lines(result.entryId)).toEqual([
      'i:General savings:USD:-15000:move',
      'i:Goals money:USD:15000:move',
      'i:Groceries:USD:-1000:release',
      'i:Groceries:USD:60000:fund',
      'i:Ready to assign:USD:-60000:fund',
      'i:Ready to assign:USD:1000:release',
    ]);
    expect(await h.itemBalance('General savings')).toBe(26100n);
  });

  it('refuses funding more than Ready to assign holds', async () => {
    const h = await funded();
    await expect(fund(h, 'Groceries', 500001n)).rejects.toMatchObject({ message: 'BUDGET_INSUFFICIENT_READY' });
  });

  it('refuses moving more than an item holds', async () => {
    const h = await funded();
    await fund(h, 'Fun', 1000n);
    await expect(
      h.command('assign_money', {
        p_on: h.today,
        p_moves: [{ from: await h.item('Fun'), to: await h.item('Groceries'), currency: 'USD', amountMinor: '1001' }],
      }),
    ).rejects.toMatchObject({ message: 'BUDGET_INSUFFICIENT_ITEM' });
  });

  it('allows only Ready-to-assign → item moves at setup', async () => {
    const h = await funded();
    await fund(h, 'Fun', 1000n);
    await expect(
      h.command('assign_money', {
        p_on: h.today,
        p_opening: true,
        p_moves: [{ from: await h.item('Fun'), to: await h.item('Groceries'), currency: 'USD', amountMinor: '10' }],
      }),
    ).rejects.toMatchObject({ message: 'BUDGET_INVALID_MOVES' });
  });
});

describe('record_income', () => {
  it('adds to the wallet and Ready to assign', async () => {
    const h = await funded();
    const result = await h.command('record_income', { p_wallet: h.bank, p_amount: 411000n, p_on: h.today });
    expect(await h.lines(result.entryId)).toEqual(['i:Ready to assign:USD:411000:income', 'w:Bank:USD:411000:income']);
  });

  it('can put income straight into one item', async () => {
    const h = await funded();
    const result = await h.command('record_income', { p_wallet: h.bank, p_amount: 5000n, p_on: h.today, p_item: await h.item('Goals money') });
    expect(await h.lines(result.entryId)).toEqual([
      'i:Goals money:USD:5000:fund',
      'i:Ready to assign:USD:-5000:fund',
      'i:Ready to assign:USD:5000:income',
      'w:Bank:USD:5000:income',
    ]);
  });
});

describe('idempotency', () => {
  it('returns the first entry when the same request is sent twice', async () => {
    const h = await funded();
    const request = randomUUID();
    const args = { p_space: h.spaceId, p_request: request, p_wallet: h.bank, p_amount: 1000n, p_on: h.today };
    const before = await h.entryCount();
    const first = await h.call<{ entryId: string }>('record_income', args);
    const second = await h.call<{ entryId: string }>('record_income', args);
    expect(second.entryId).toBe(first.entryId);
    expect(await h.entryCount()).toBe(before + 1);
  });

  it('refuses a reused request id with different details', async () => {
    const h = await funded();
    const request = randomUUID();
    await h.call('record_income', { p_space: h.spaceId, p_request: request, p_wallet: h.bank, p_amount: 1000n, p_on: h.today });
    await expect(
      h.call('record_income', { p_space: h.spaceId, p_request: request, p_wallet: h.bank, p_amount: 2000n, p_on: h.today }),
    ).rejects.toMatchObject({ message: 'BUDGET_REQUEST_CONFLICT' });
  });
});

describe('record_expense and the overspending rule', () => {
  it('charges the item when it holds enough', async () => {
    const h = await funded();
    await fund(h, 'Groceries', 60000n);
    const result = await h.command('record_expense', { p_wallet: h.bank, p_item: await h.item('Groceries'), p_amount: 8540n, p_on: h.today });
    expect(await h.lines(result.entryId)).toEqual(['i:Groceries:USD:-8540:spend', 'w:Bank:USD:-8540:spend']);
  });

  it('covers a shortfall from the item the person picks', async () => {
    const h = await funded();
    await fund(h, 'Eating out', 12000n);
    await fund(h, 'Fun', 8550n);
    await h.command('record_expense', { p_wallet: h.bank, p_item: await h.item('Eating out'), p_amount: 12000n, p_on: h.today });
    const result = await h.command<{ entryId: string; covered: string }>('record_expense', {
      p_wallet: h.bank,
      p_item: await h.item('Eating out'),
      p_amount: 1550n,
      p_on: h.today,
      p_cover_from: await h.item('Fun'),
    });
    expect(result.covered).toBe('1550');
    expect(await h.lines(result.entryId)).toEqual([
      'i:Eating out:USD:-1550:spend',
      'i:Eating out:USD:1550:cover',
      'i:Fun:USD:-1550:cover',
      'w:Bank:USD:-1550:spend',
    ]);
    expect(await h.itemBalance('Fun')).toBe(7000n);
    expect(await h.itemBalance('Eating out')).toBe(0n);
  });

  it('covers from Ready to assign by default', async () => {
    const h = await funded();
    await fund(h, 'Groceries', 1000n);
    const result = await h.command('record_expense', { p_wallet: h.bank, p_item: await h.item('Groceries'), p_amount: 3000n, p_on: h.today });
    expect(await h.lines(result.entryId)).toEqual([
      'i:Groceries:USD:-3000:spend',
      'i:Groceries:USD:2000:cover',
      'i:Ready to assign:USD:-2000:cover',
      'w:Bank:USD:-3000:spend',
    ]);
  });

  it('refuses a cover source that does not hold enough', async () => {
    const h = await funded();
    await fund(h, 'Fun', 100n);
    await expect(
      h.command('record_expense', { p_wallet: h.bank, p_item: await h.item('Groceries'), p_amount: 500n, p_on: h.today, p_cover_from: await h.item('Fun') }),
    ).rejects.toMatchObject({ message: 'BUDGET_INSUFFICIENT_ITEM' });
  });

  it('covers an LBP shortfall from LBP only, even into over-assigned', async () => {
    const h = await funded();
    const usdReady = await h.readyBalance('USD');
    const result = await h.command('record_expense', { p_wallet: h.lbp, p_item: await h.item('Groceries'), p_amount: 1790000n, p_on: h.today });
    expect(await h.lines(result.entryId)).toEqual([
      'i:Groceries:LBP:-1790000:spend',
      'i:Groceries:LBP:1790000:cover',
      'i:Ready to assign:LBP:-1790000:cover',
      'w:LBP cash:LBP:-1790000:spend',
    ]);
    expect(await h.readyBalance('LBP')).toBe(-1790000n);
    expect(await h.readyBalance('USD')).toBe(usdReady);
  });

  it('refuses a future date', async () => {
    const h = await funded();
    await expect(
      h.command('record_expense', { p_wallet: h.bank, p_item: await h.item('Groceries'), p_amount: 1n, p_on: '2999-01-01' }),
    ).rejects.toMatchObject({ message: 'BUDGET_FUTURE_DATE' });
  });

  it('requires a plan item, not Ready to assign', async () => {
    const h = await funded();
    const ready = await db.pool.query<{ id: string }>('select budget.ready_item($1) as id', [h.spaceId]);
    await expect(
      h.command('record_expense', { p_wallet: h.bank, p_item: ready.rows[0]?.id, p_amount: 1n, p_on: h.today }),
    ).rejects.toMatchObject({ message: 'BUDGET_ITEM_REQUIRED' });
  });

  it('records a refund back into the item', async () => {
    const h = await funded();
    const result = await h.command('record_refund', { p_wallet: h.bank, p_item: await h.item('Groceries'), p_amount: 1200n, p_on: h.today });
    expect(await h.lines(result.entryId)).toEqual(['i:Groceries:USD:1200:refund', 'w:Bank:USD:1200:refund']);
  });
});

describe('transfers and exchanges', () => {
  it('moves money between wallets without touching any purpose', async () => {
    const h = await funded();
    const cash = await h.wallet('Cash', 'cash', 'USD');
    const result = await h.command('record_transfer', { p_from: h.bank, p_to: cash, p_amount: 5000n, p_on: h.today });
    expect(await h.lines(result.entryId)).toEqual(['w:Bank:USD:-5000:transfer', 'w:Cash:USD:5000:transfer']);
  });

  it('refuses a transfer across currencies or into an investment', async () => {
    const h = await funded();
    const brokerage = await h.wallet('Brokerage', 'investment', 'USD');
    await expect(h.command('record_transfer', { p_from: h.bank, p_to: h.lbp, p_amount: 1n, p_on: h.today })).rejects.toMatchObject({ message: 'BUDGET_TRANSFER_INVALID' });
    await expect(h.command('record_transfer', { p_from: h.bank, p_to: brokerage, p_amount: 1n, p_on: h.today })).rejects.toMatchObject({ message: 'BUDGET_TRANSFER_INVALID' });
  });

  it('exchanges an item’s dollars into lira and keeps the purpose', async () => {
    const h = await funded();
    await fund(h, 'Groceries', 5000n);
    const result = await h.command('record_exchange', {
      p_from: h.bank,
      p_from_amount: 2000n,
      p_to: h.lbp,
      p_to_amount: 1790000n,
      p_item: await h.item('Groceries'),
      p_on: h.today,
    });
    expect(await h.lines(result.entryId)).toEqual([
      'i:Groceries:LBP:1790000:exchange',
      'i:Groceries:USD:-2000:exchange',
      'w:Bank:USD:-2000:exchange',
      'w:LBP cash:LBP:1790000:exchange',
    ]);
  });

  it('refuses exchanging more than the item holds', async () => {
    const h = await funded();
    await expect(
      h.command('record_exchange', { p_from: h.bank, p_from_amount: 2000n, p_to: h.lbp, p_to_amount: 1790000n, p_item: await h.item('Groceries'), p_on: h.today }),
    ).rejects.toMatchObject({ message: 'BUDGET_INSUFFICIENT_ITEM' });
  });

  it('refuses an exchange within one currency', async () => {
    const h = await funded();
    const cash = await h.wallet('Cash', 'cash', 'USD');
    await expect(
      h.command('record_exchange', { p_from: h.bank, p_from_amount: 1n, p_to: cash, p_to_amount: 1n, p_on: h.today }),
    ).rejects.toMatchObject({ message: 'BUDGET_EXCHANGE_INVALID' });
  });
});

describe('investments', () => {
  async function setup(): Promise<BudgetHarness & { bank: string; lbp: string; brokerage: string }> {
    const h = await funded();
    const brokerage = await h.wallet('Brokerage', 'investment', 'USD', 1200000n);
    return Object.assign(h, { brokerage });
  }

  it('contributes from To invest: spendable cash down, investments up, reported as invested', async () => {
    const h = await setup();
    await fund(h, 'To invest', 41100n);
    const result = await h.command('record_investment', { p_action: 'contribute', p_investment: h.brokerage, p_cash: h.bank, p_item: await h.item('To invest'), p_amount: 41100n, p_on: h.today });
    expect(await h.lines(result.entryId)).toEqual(['i:To invest:USD:-41100:invest', 'w:Bank:USD:-41100:invest', 'w:Brokerage:USD:41100:invest']);
  });

  it('records a value update as a gain on the investment only', async () => {
    const h = await setup();
    const result = await h.command('record_investment', { p_action: 'value', p_investment: h.brokerage, p_amount: 1214900n, p_on: h.today });
    expect(await h.lines(result.entryId)).toEqual(['w:Brokerage:USD:14900:value']);
    await expect(h.command('record_investment', { p_action: 'value', p_investment: h.brokerage, p_amount: 1214900n, p_on: h.today })).rejects.toMatchObject({ message: 'BUDGET_NO_CHANGE' });
  });

  it('withdraws into Ready to assign (not income) and charges fees to the investment', async () => {
    const h = await setup();
    const withdraw = await h.command('record_investment', { p_action: 'withdraw', p_investment: h.brokerage, p_cash: h.bank, p_amount: 10000n, p_on: h.today });
    expect(await h.lines(withdraw.entryId)).toEqual(['i:Ready to assign:USD:10000:withdraw', 'w:Bank:USD:10000:withdraw', 'w:Brokerage:USD:-10000:withdraw']);
    const fee = await h.command('record_investment', { p_action: 'fee', p_investment: h.brokerage, p_amount: 450n, p_on: h.today });
    expect(await h.lines(fee.entryId)).toEqual(['w:Brokerage:USD:-450:fee']);
  });

  it('keeps dividends separate from salary', async () => {
    const h = await setup();
    const paid = await h.command('record_investment', { p_action: 'income_cash', p_investment: h.brokerage, p_cash: h.bank, p_amount: 1500n, p_on: h.today });
    expect(await h.lines(paid.entryId)).toEqual(['i:Ready to assign:USD:1500:other_income', 'w:Bank:USD:1500:other_income']);
    const reinvested = await h.command('record_investment', { p_action: 'income_reinvested', p_investment: h.brokerage, p_amount: 700n, p_on: h.today });
    expect(await h.lines(reinvested.entryId)).toEqual(['w:Brokerage:USD:700:other_income']);
  });
});

describe('loans', () => {
  it('borrowing adds cash and debt, never income', async () => {
    const h = await funded();
    const loan = await h.wallet('Car loan', 'loan', 'USD', 0n, { p_loan_direction: 'i_owe' });
    const result = await h.command('record_loan', { p_action: 'borrow', p_loan: loan, p_cash: h.bank, p_principal: 100000n, p_on: h.today });
    expect(await h.lines(result.entryId)).toEqual(['i:Ready to assign:USD:100000:borrow', 'w:Bank:USD:100000:borrow', 'w:Car loan:USD:-100000:borrow']);
  });

  it('repaying splits principal (debt repaid) from interest (spending)', async () => {
    const h = await funded();
    const loan = await h.wallet('Car loan', 'loan', 'USD', 600000n, { p_loan_direction: 'i_owe' });
    await fund(h, 'Groceries', 20000n);
    const result = await h.command('record_loan', {
      p_action: 'repay',
      p_loan: loan,
      p_cash: h.bank,
      p_item: await h.item('Groceries'),
      p_principal: 17000n,
      p_interest: 3000n,
      p_on: h.today,
    });
    expect(await h.lines(result.entryId)).toEqual([
      'i:Groceries:USD:-17000:principal',
      'i:Groceries:USD:-3000:interest',
      'w:Bank:USD:-17000:principal',
      'w:Bank:USD:-3000:interest',
      'w:Car loan:USD:17000:principal',
    ]);
    expect(await h.walletBalance(loan)).toBe(-583000n);
  });

  it('refuses repaying more principal than is owed', async () => {
    const h = await funded();
    const loan = await h.wallet('Small loan', 'loan', 'USD', 1000n, { p_loan_direction: 'i_owe' });
    await fund(h, 'Groceries', 5000n);
    await expect(
      h.command('record_loan', { p_action: 'repay', p_loan: loan, p_cash: h.bank, p_item: await h.item('Groceries'), p_principal: 1001n, p_on: h.today }),
    ).rejects.toMatchObject({ message: 'BUDGET_OVERPAY' });
  });

  it('lending and being repaid move money, not income or spending', async () => {
    const h = await funded();
    const rami = await h.wallet('Rami', 'loan', 'USD', 0n, { p_loan_direction: 'owed_to_me', p_counterparty: 'Rami' });
    const lend = await h.command('record_loan', { p_action: 'lend', p_loan: rami, p_cash: h.bank, p_principal: 30000n, p_on: h.today });
    expect(await h.lines(lend.entryId)).toEqual(['i:Ready to assign:USD:-30000:lend', 'w:Bank:USD:-30000:lend', 'w:Rami:USD:30000:lend']);
    const collect = await h.command('record_loan', { p_action: 'collect', p_loan: rami, p_cash: h.bank, p_principal: 10000n, p_interest: 500n, p_on: h.today });
    expect(await h.lines(collect.entryId)).toEqual([
      'i:Ready to assign:USD:10000:collect',
      'i:Ready to assign:USD:500:other_income',
      'w:Bank:USD:10000:collect',
      'w:Bank:USD:500:other_income',
      'w:Rami:USD:-10000:collect',
    ]);
  });
});

describe('reverse_entry (reversal_guards)', () => {
  it('writes the exact mirror and refuses a second reversal', async () => {
    const h = await funded();
    const income = await h.command('record_income', { p_wallet: h.bank, p_amount: 1000n, p_on: h.today });
    const reversal = await h.command('reverse_entry', { p_entry: income.entryId, p_reason: 'Typed twice' });
    expect(await h.lines(reversal.entryId)).toEqual(['i:Ready to assign:USD:-1000:income', 'w:Bank:USD:-1000:income']);
    await expect(h.command('reverse_entry', { p_entry: income.entryId, p_reason: 'again' })).rejects.toMatchObject({ message: 'BUDGET_ALREADY_REVERSED' });
    await expect(h.command('reverse_entry', { p_entry: reversal.entryId, p_reason: 'undo undo' })).rejects.toMatchObject({ message: 'BUDGET_CANNOT_REVERSE' });
  });

  it('refuses reversing funding the item already spent', async () => {
    const h = await funded();
    const funding = await h.command('assign_money', {
      p_on: h.today,
      p_moves: [{ from: null, to: await h.item('Groceries'), currency: 'USD', amountMinor: '5000' }],
    });
    await h.command('record_expense', { p_wallet: h.bank, p_item: await h.item('Groceries'), p_amount: 4000n, p_on: h.today });
    await expect(h.command('reverse_entry', { p_entry: funding.entryId, p_reason: 'oops' })).rejects.toMatchObject({ message: 'BUDGET_INSUFFICIENT_ITEM' });
  });

  it('lets reversing an assigned income leave Ready to assign over-assigned', async () => {
    const h = await setupSpace(db.pool);
    const bank = await h.wallet('Bank', 'cash', 'USD');
    const income = await h.command('record_income', { p_wallet: bank, p_amount: 1000n, p_on: h.today });
    await fund(h, 'Groceries', 1000n);
    await h.command('reverse_entry', { p_entry: income.entryId, p_reason: 'Salary bounced' });
    expect(await h.readyBalance()).toBe(-1000n);
    expect(await h.itemBalance('Groceries')).toBe(1000n);
  });
});

describe('bills', () => {
  async function withBill(): Promise<BudgetHarness & { bank: string; lbp: string; bill: string }> {
    const h = await funded();
    await fund(h, 'Bills', 30000n);
    const saved = await h.command<{ billId: string }>('save_bill', {
      p_name: 'Internet',
      p_item: await h.item('Bills'),
      p_amount: 4500n,
      p_currency: 'USD',
      p_cadence: 'monthly',
      p_first_due: h.today,
    });
    return Object.assign(h, { bill: saved.billId });
  }

  it('links the payment to the occurrence and refuses paying it twice', async () => {
    const h = await withBill();
    const pay = { p_wallet: h.bank, p_item: await h.item('Bills'), p_amount: 4730n, p_on: h.today, p_bill: h.bill, p_bill_due: h.today };
    const paid = await h.command('record_expense', pay);
    await expect(h.command('record_expense', pay)).rejects.toMatchObject({ message: 'BUDGET_BILL_ALREADY_PAID' });
    await h.command('reverse_entry', { p_entry: paid.entryId, p_reason: 'wrong card' });
    await expect(h.command('record_expense', pay)).resolves.toHaveProperty('entryId');
  });

  it('refuses a date that is not one of the bill’s due dates', async () => {
    const h = await withBill();
    await expect(
      h.command('record_expense', { p_wallet: h.bank, p_item: await h.item('Bills'), p_amount: 4500n, p_on: h.today, p_bill: h.bill, p_bill_due: '2000-01-02' }),
    ).rejects.toMatchObject({ message: 'BUDGET_BILL_NOT_DUE' });
  });

  it('refuses paying a skipped occurrence', async () => {
    const h = await withBill();
    await h.command('skip_bill', { p_bill: h.bill, p_due: h.today });
    await expect(
      h.command('record_expense', { p_wallet: h.bank, p_item: await h.item('Bills'), p_amount: 4500n, p_on: h.today, p_bill: h.bill, p_bill_due: h.today }),
    ).rejects.toMatchObject({ message: 'BUDGET_BILL_SKIPPED' });
  });

  it('refuses paying a bill from a different item', async () => {
    const h = await withBill();
    await expect(
      h.command('record_expense', { p_wallet: h.bank, p_item: await h.item('Groceries'), p_amount: 4500n, p_on: h.today, p_bill: h.bill, p_bill_due: h.today }),
    ).rejects.toMatchObject({ message: 'BUDGET_BILL_MISMATCH' });
  });
});

describe('wallet upkeep and reference rates', () => {
  it('refuses archiving a wallet that still holds money', async () => {
    const h = await funded();
    await expect(h.command('update_wallet', { p_wallet: h.bank, p_name: 'Bank', p_archived: true })).rejects.toMatchObject({ message: 'BUDGET_ARCHIVE_NONZERO' });
    await expect(h.command('update_wallet', { p_wallet: h.lbp, p_name: 'Old LBP', p_archived: true })).resolves.toBeTruthy();
  });

  it('stores a dated reference rate', async () => {
    const h = await funded();
    await h.command('set_reference_rate', { p_currency: 'LBP', p_units_per_usd: '89500', p_effective: h.today });
    const rate = await db.pool.query('select units_per_usd::text as r from budget.reference_rates where space_id = $1 and effective_on = $2', [h.spaceId, h.today]);
    expect(rate.rows).toEqual([{ r: '89500.000000' }]);
  });
});

describe('every command keeps the identity', () => {
  it('cash held = Ready to assign + items after a mixed sequence', async () => {
    const h = await funded();
    await fund(h, 'Groceries', 1000n);
    await h.command('record_expense', { p_wallet: h.lbp, p_item: await h.item('Groceries'), p_amount: 50000n, p_on: h.today });
    await h.command('record_expense', { p_wallet: h.bank, p_item: await h.item('Fun'), p_amount: 2500n, p_on: h.today });
    for (const currency of ['USD', 'LBP'] as const) {
      const { cash, ready, items } = await identity(db.pool, h.spaceId, currency);
      expect(cash).toBe(ready + items);
    }
  });
});
