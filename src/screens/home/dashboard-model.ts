import { BudgetError, type BudgetApi } from '../../api/budget-api.ts';
import type { ActivityCursor, Entry, PlanMonth } from '../../api/schemas.ts';
import type { Currency } from '../../lib/money.ts';
import { addDays } from '../describe.ts';

/** Only spendable items in expense groups belong in the monthly allowance. */
export function expenseGroups(plan: PlanMonth) {
  return plan.groups.filter(group => group.purpose === 'expense').map(group => {
    const items = [...group.items, ...(group.flex ? [group.flex] : [])].filter(isExpenseItem);
    return { ...group, expenseItems: items, planned: items.reduce((sum, item) => sum + item.planned, 0n), spent: items.reduce((sum, item) => sum + item.spent, 0n) };
  });
}

function isExpenseItem(item: PlanMonth['groups'][number]['items'][number]) {
  return item.kind !== 'ready' && item.kind !== 'reserve';
}

export function dashboardTotals(plan: PlanMonth, currency: Currency) {
  const groups = expenseGroups(plan);
  return {
    available: groups.flatMap(group => group.expenseItems).reduce((total, item) => total + item.balances[currency], 0n),
    spent: currency === plan.planCurrency ? groups.reduce((total, group) => total + group.spent, 0n) : null,
  };
}

/** Net expense lines only; allocation, investment principal and savings stay separate. */
export function expenseEntries(entries: readonly Entry[], plan: PlanMonth): Entry[] {
  const ids = new Set(expenseGroups(plan).flatMap(group => group.expenseItems.map(item => item.itemId)));
  return entries.map(entry => ({ ...entry, items: entry.items.filter(line => line.kind !== 'ready' && line.kind !== 'reserve' && (line.purpose ? line.purpose === 'expense' : ids.has(line.itemId))) }));
}

export interface ExpenseGroupRow {
  readonly groupId: string;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly planned: bigint;
  readonly spent: bigint;
  /** No comparison is made between plan currency and another currency. */
  readonly remaining: bigint | null;
}

/** Historical membership wins; an expense belongs to exactly one group. */
export function expenseGroupRows(plan: PlanMonth, entries: readonly Entry[], currency: Currency, month: string, today: string): ExpenseGroupRow[] {
  const groups = expenseGroups(plan);
  const currentGroup = new Map(groups.flatMap(group => group.expenseItems.map(item => [item.itemId, group.groupId] as const)));
  const rows = new Map(groups.map(group => [group.groupId, { groupId: group.groupId, nameEn: group.nameEn, nameAr: group.nameAr, planned: group.planned, spent: 0n }]));
  for (const entry of expenseEntries(entries, plan)) {
    if (!inMonth(entry, month, today)) continue;
    for (const line of entry.items) {
      if (!isSpendingLine(line, currency)) continue;
      const groupId = line.groupId ?? currentGroup.get(line.itemId) ?? 'other-expenses';
      let row = rows.get(groupId);
      if (!row) {
        row = { groupId, nameEn: line.groupNameEn ?? (line.groupId ? line.nameEn : 'Other expenses'), nameAr: line.groupNameAr ?? (line.groupId ? line.nameAr : 'مصروفات أخرى'), planned: 0n, spent: 0n };
        rows.set(groupId, row);
      }
      row.spent -= line.amount;
    }
  }
  return [...rows.values()].map(row => ({ ...row, remaining: currency === plan.planCurrency ? row.planned - row.spent : null }));
}

/** Load the complete month: a first page is not a monthly total. */
export async function loadMonthActivity(api: Pick<BudgetApi, 'activity'>, spaceId: string, month: string): Promise<Entry[]> {
  const entries = new Map<string, Entry>();
  const cursors = new Set<string>();
  let before: ActivityCursor | null = null;
  do {
    const page = await api.activity(spaceId, { limit: 100, before, filter: { month } });
    for (const entry of page.entries) entries.set(entry.entryId, entry);
    before = page.next;
    if (before) {
      const key = JSON.stringify(before);
      if (cursors.has(key)) throw new BudgetError('BAD_RESPONSE');
      cursors.add(key);
    }
  } while (before);
  return [...entries.values()];
}

/** Match the plan's net spending definition, including signed reversal lines. */
export function spendingSeries(entries: readonly Entry[], currency: Currency, month: string, today: string) {
  const daily = new Map<string, bigint>();
  for (const entry of entries) {
    if (!inMonth(entry, month, today)) continue;
    for (const line of entry.items) {
      if (!isSpendingLine(line, currency)) continue;
      daily.set(entry.occurredOn, (daily.get(entry.occurredOn) ?? 0n) - line.amount);
    }
  }
  const points = [{ on: month, amount: 0n }];
  let amount = 0n;
  for (let on = month; on <= today && on.slice(0, 7) === month.slice(0, 7); on = addDays(on, 1)) {
    amount += daily.get(on) ?? 0n;
    points.push({ on, amount });
  }
  return points;
}

function inMonth(entry: Entry, month: string, today: string) {
  return entry.occurredOn >= month && entry.occurredOn <= today && entry.occurredOn.slice(0, 7) === month.slice(0, 7);
}

function isSpendingLine(line: Entry['items'][number], currency: Currency) {
  return line.currency === currency && line.kind !== 'ready' && ['spend', 'refund', 'interest', 'fee'].includes(line.flow);
}

/** Saving and moving principal are allocations, not a spending allowance. */
export function plannedSpending(plan: PlanMonth): bigint {
  return expenseGroups(plan).reduce((sum, group) => sum + group.planned, 0n);
}

/** Net consumption, regardless of which purpose paid. Asset purchases are excluded. */
export function spendingByCategory(entries: readonly Entry[], currency: Currency, month: string, today: string) {
  const rows = new Map<string, { itemId: string; nameEn: string | null; nameAr: string | null; amount: bigint }>();
  for (const entry of entries) {
    if (entry.occurredOn < month || entry.occurredOn > today || entry.occurredOn.slice(0, 7) !== month.slice(0, 7)) continue;
    for (const line of entry.items) {
      if (line.currency !== currency || line.kind === 'ready' || !['spend', 'refund', 'interest', 'fee'].includes(line.flow)) continue;
      const row = rows.get(line.itemId) ?? { itemId: line.itemId, nameEn: line.nameEn, nameAr: line.nameAr, amount: 0n };
      row.amount -= line.amount;
      rows.set(line.itemId, row);
    }
  }
  return [...rows.values()].filter(row => row.amount !== 0n).sort((a, b) => a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : a.itemId.localeCompare(b.itemId));
}
