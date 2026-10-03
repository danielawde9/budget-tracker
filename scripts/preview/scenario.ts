/**
 * The ten demonstrations from the spec (§6), as real database calls.
 *
 * Shared by the preview seed (supabase-js as a signed-in demo user) and by
 * tests/db/demonstrations.test.ts (SQL as an authenticated test user), so the
 * preview shows exactly the numbers the test asserts. Dates are anchored to
 * the space's own "today": setup happens on the 1st of the previous month and
 * the current month's events on days 1–3 (shifted one month back when today
 * is the 1st or 2nd, so nothing is ever future-dated).
 */

export interface ScenarioCaller {
  call<T>(rpc: string, args: Record<string, unknown>): Promise<T>;
}

export interface StoryRefs {
  readonly spaceId: string;
  readonly today: string;
  readonly setupMonth: string;
  readonly currentMonth: string;
  readonly wallets: Readonly<Record<'bank' | 'cash' | 'lbp' | 'brokerage' | 'carLoan' | 'rami', string>>;
  readonly items: Readonly<Record<string, string>>;
  readonly bills: Readonly<Record<'electricity' | 'internet' | 'phone' | 'insurance' | 'carLoan', string>>;
}

interface PlanMonthItem {
  itemId: string;
  kind: string;
  nameEn: string | null;
  nameAr: string | null;
  inPlan: boolean;
  planned: string;
  targetMinor: string | null;
  targetDate: string | null;
  walletId: string | null;
}

interface PlanMonth {
  revision: number;
  expectedIncome: string;
  groups: { groupId: string; nameEn: string | null; nameAr: string | null; percentBps: number; items: PlanMonthItem[]; flex: PlanMonthItem }[];
}

const request = (): string => globalThis.crypto.randomUUID();

function monthStart(day: string, offset = 0): string {
  const date = new Date(`${day.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 10);
}

function dayOf(month: string, day: number): string {
  return `${month.slice(0, 8)}${String(day).padStart(2, '0')}`;
}

function lastDayOf(month: string): string {
  const date = new Date(`${month}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}

/** Demonstration 1: a space created from zero with the default plan. */
export async function runFreshSetup(c: ScenarioCaller, name = 'Fresh start'): Promise<{ spaceId: string; bank: string }> {
  const { spaceId } = await c.call<{ spaceId: string }>('create_space', { p_request: request(), p_name: name, p_expected_income_minor: '411000' });
  const { walletId } = await c.call<{ walletId: string }>('create_wallet', {
    p_space: spaceId, p_request: request(), p_name: 'Bank', p_kind: 'cash', p_currency: 'USD', p_opening_minor: '0',
  });
  return { spaceId, bank: walletId };
}

/** Demonstrations 2–10: existing money, two months of activity. */
export async function runExistingMoneyStory(c: ScenarioCaller, name = 'Household', timezone = 'Asia/Beirut'): Promise<StoryRefs> {
  const today = await c.call<string>('clock_today', { p_timezone: timezone });
  const anchorOffset = Number(today.slice(8, 10)) >= 3 ? 0 : -1;
  const currentMonth = monthStart(today, anchorOffset);
  const setupMonth = monthStart(today, anchorOffset - 1);
  const { spaceId } = await c.call<{ spaceId: string }>('create_space', {
    p_request: request(), p_name: name, p_expected_income_minor: '411000', p_timezone: timezone, p_plan_month: setupMonth,
  });
  const S = (day: number): string => dayOf(setupMonth, day);
  const A = (day: number): string => dayOf(currentMonth, day);
  const cmd = <T = { entryId: string }>(rpc: string, args: Record<string, unknown>): Promise<T> =>
    c.call<T>(rpc, { p_space: spaceId, p_request: request(), ...args });

  // 2 · Existing money, entered as opening balances on the 1st of the setup month.
  const wallet = async (walletName: string, kind: string, currency: string, opening: string, extra: Record<string, unknown> = {}): Promise<string> =>
    (await cmd<{ walletId: string }>('create_wallet', { p_name: walletName, p_kind: kind, p_currency: currency, p_opening_minor: opening, p_opened_on: S(1), ...extra })).walletId;
  const bank = await wallet('Bank', 'cash', 'USD', '520000');
  const cash = await wallet('Cash', 'cash', 'USD', '30000');
  const lbp = await wallet('LBP cash', 'cash', 'LBP', '4475000');
  const brokerage = await wallet('Brokerage', 'investment', 'USD', '1200000');
  const carLoan = await wallet('Car loan', 'loan', 'USD', '600000', { p_loan_direction: 'i_owe', p_counterparty: 'Bank' });
  const rami = await wallet('Rami', 'loan', 'USD', '30000', { p_loan_direction: 'owed_to_me', p_counterparty: 'Rami' });

  // 4 · The owner's plan: Essentials broken down, insurance reserved, goals funded from their group.
  const plan = await c.call<PlanMonth>('plan_month', { p_space: spaceId, p_month: setupMonth });
  const monthly: Record<string, string> = {
    Rent: '100000', Bills: '25000', Groceries: '60000', Transport: '25000', 'Insurance reserve': '15000',
    'Eating out': '12000', Fun: '8550',
  };
  const groups = plan.groups.map((group) => ({
    groupId: group.groupId,
    nameEn: group.nameEn,
    nameAr: group.nameAr,
    percentBps: group.percentBps,
    items: group.items.map((item) => ({
      itemId: item.itemId,
      kind: item.kind,
      nameEn: item.nameEn,
      nameAr: item.nameAr,
      monthlyMinor: monthly[item.nameEn ?? ''] ?? item.planned,
      targetMinor: item.nameEn === 'Insurance reserve' ? '78000' : item.targetMinor,
      targetDate: item.nameEn === 'Insurance reserve' ? A(2) : item.targetDate,
      walletId: item.walletId,
    })),
  }));
  const groupByName = (groupName: string) => {
    const group = groups.find((candidate) => candidate.nameEn === groupName);
    if (!group) throw new Error(`Default group ${groupName} is missing`);
    return group;
  };
  groupByName('Essentials').items.push({
    itemId: null as unknown as string, kind: 'loan_payment', nameEn: 'Car loan payment', nameAr: 'قسط السيارة',
    monthlyMinor: '20000', targetMinor: null, targetDate: null, walletId: carLoan,
  });
  groupByName('Short-term goals').items.push(
    { itemId: null as unknown as string, kind: 'goal', nameEn: 'Holiday', nameAr: 'العطلة', monthlyMinor: '40000', targetMinor: '250000', targetDate: lastDayOf(monthStart(currentMonth, 8)), walletId: null },
    { itemId: null as unknown as string, kind: 'goal', nameEn: 'Laptop', nameAr: 'حاسوب محمول', monthlyMinor: '21650', targetMinor: '130000', targetDate: lastDayOf(monthStart(currentMonth, 5)), walletId: null },
  );
  await cmd('save_plan', {
    p_month: setupMonth,
    p_expected_revision: plan.revision,
    p_plan: { expectedIncomeMinor: '411000', groups, archiveItemIds: [], archiveGroupIds: [] },
  });

  const after = await c.call<PlanMonth>('plan_month', { p_space: spaceId, p_month: setupMonth });
  const items: Record<string, string> = {};
  for (const group of after.groups) {
    for (const item of [...group.items, group.flex]) items[item.nameEn ?? item.itemId] = item.itemId;
  }
  const item = (itemName: string): string => {
    const id = items[itemName];
    if (!id) throw new Error(`Item ${itemName} is missing`);
    return id;
  };

  // 2 · What the existing money is for (opening balances of items, not contributions).
  await cmd('assign_money', {
    p_on: S(1),
    p_opening: true,
    p_moves: [
      { from: null, to: item('General savings'), currency: 'USD', amountMinor: '300000' },
      { from: null, to: item('Holiday'), currency: 'USD', amountMinor: '80000' },
      { from: null, to: item('Insurance reserve'), currency: 'USD', amountMinor: '48000' },
      { from: null, to: item('Groceries'), currency: 'LBP', amountMinor: '4475000' },
    ],
  });

  // Bills: schedules that read their item's balance.
  const bill = async (billName: string, itemName: string, amount: string, cadence: string, firstDue: string, loan: string | null = null): Promise<string> =>
    (await cmd<{ billId: string }>('save_bill', { p_name: billName, p_item: item(itemName), p_amount: amount, p_currency: 'USD', p_cadence: cadence, p_first_due: firstDue, p_loan: loan })).billId;
  const bills = {
    electricity: await bill('Electricity', 'Bills', '12000', 'monthly', S(10)),
    internet: await bill('Internet', 'Bills', '4500', 'monthly', S(20)),
    phone: await bill('Phone', 'Bills', '3500', 'monthly', S(22)),
    insurance: await bill('Car insurance', 'Insurance reserve', '78000', 'yearly', A(2)),
    carLoan: await bill('Car loan installment', 'Car loan payment', '20000', 'monthly', S(1), carLoan),
  };

  // 3 · Receive income and fund the month from what arrived.
  const fundMonth = async (month: string, on: string): Promise<void> => {
    const proposal = await c.call<{ lines: { itemId: string; amountMinor: string }[] }>('funding_preview', { p_space: spaceId, p_month: month, p_currency: 'USD' });
    await cmd('assign_money', { p_on: on, p_moves: proposal.lines.map((line) => ({ from: null, to: line.itemId, currency: 'USD', amountMinor: line.amountMinor })) });
  };
  await cmd('record_income', { p_wallet: bank, p_amount: '411000', p_on: S(1), p_memo: 'Salary' });
  await fundMonth(setupMonth, S(1));

  const expense = (walletId: string, itemName: string, amount: string, on: string, memo: string, extra: Record<string, unknown> = {}) =>
    cmd('record_expense', { p_wallet: walletId, p_item: item(itemName), p_amount: amount, p_on: on, p_memo: memo, ...extra });
  const repayCar = (principal: string, interest: string, on: string, due: string) =>
    cmd('record_loan', { p_action: 'repay', p_loan: carLoan, p_cash: bank, p_item: item('Car loan payment'), p_principal: principal, p_interest: interest, p_on: on, p_bill: bills.carLoan, p_bill_due: due, p_memo: 'Car loan installment' });

  // 5 · Everyday spending in the setup month (USD and LBP; one overspend covered from Fun).
  await expense(bank, 'Rent', '100000', S(1), 'Rent');
  await repayCar('17000', '3000', S(1), S(1));
  await expense(bank, 'Groceries', '8540', S(5), 'Supermarket');
  await expense(cash, 'Eating out', '3200', S(6), 'Lunch');
  await expense(bank, 'Transport', '6000', S(8), 'Fuel');
  await expense(bank, 'Bills', '12000', S(10), 'Electricity', { p_bill: bills.electricity, p_bill_due: S(10) });
  await expense(lbp, 'Groceries', '1790000', S(12), 'Vegetables market');
  await expense(bank, 'Eating out', '4850', S(13), 'Dinner');
  await expense(bank, 'Transport', '6000', S(15), 'Fuel');
  await expense(bank, 'Groceries', '21000', S(19), 'Supermarket');
  await expense(bank, 'Bills', '4500', S(20), 'Internet', { p_bill: bills.internet, p_bill_due: S(20) });
  await expense(bank, 'Fun', '4000', S(21), 'Cinema');
  await expense(bank, 'Bills', '3500', S(22), 'Phone', { p_bill: bills.phone, p_bill_due: S(22) });
  await expense(bank, 'Transport', '6000', S(24), 'Fuel');
  await expense(bank, 'Groceries', '19030', S(26), 'Supermarket');
  await expense(bank, 'Eating out', '5500', S(27), 'Birthday dinner', { p_cover_from: item('Fun') });

  // 9 · Investments: contribute To invest; a market value update is a gain, not income.
  await cmd('record_investment', { p_action: 'contribute', p_investment: brokerage, p_cash: bank, p_item: item('To invest'), p_amount: '41100', p_on: S(28), p_memo: 'Monthly investment' });
  await cmd('record_investment', { p_action: 'value', p_investment: brokerage, p_amount: '1256000', p_on: lastDayOf(setupMonth), p_memo: 'Statement value' });

  // 6 · New month: unspent money carried forward on its own; fund the plan again.
  await cmd('record_income', { p_wallet: bank, p_amount: '411000', p_on: A(1), p_memo: 'Salary' });
  await fundMonth(currentMonth, A(1));

  // 7 · Reassign general savings to a goal (no wallet movement, not new saving).
  await cmd('assign_money', {
    p_on: A(1),
    p_memo: 'Holiday top-up from savings',
    p_moves: [{ from: item('General savings'), to: item('Holiday'), currency: 'USD', amountMinor: '15000' }],
  });

  await expense(bank, 'Rent', '100000', A(1), 'Rent');
  // 10 · Loan installment through its bill: principal repaid, interest spent.
  await repayCar('17200', '2800', A(1), A(1));
  // 8 · The yearly insurance premium, paid from its accumulated reserve.
  await expense(bank, 'Insurance reserve', '78000', A(2), 'Car insurance premium', { p_bill: bills.insurance, p_bill_due: A(2) });
  await cmd('record_investment', { p_action: 'contribute', p_investment: brokerage, p_cash: bank, p_item: item('To invest'), p_amount: '41100', p_on: A(2), p_memo: 'Monthly investment' });
  // 10 · Money lent comes back into Ready to assign — not income.
  await cmd('record_loan', { p_action: 'collect', p_loan: rami, p_cash: bank, p_principal: '10000', p_on: A(2), p_memo: 'Rami paid back part' });
  await expense(bank, 'Groceries', '6420', A(3), 'Supermarket');

  return {
    spaceId,
    today,
    setupMonth,
    currentMonth,
    wallets: { bank, cash, lbp, brokerage, carLoan, rami },
    items,
    bills,
  };
}
