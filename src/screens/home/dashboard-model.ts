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
    if (entry.occurredOn < month || entry.occurredOn > today || entry.occurredOn.slice(0, 7) !== month.slice(0, 7)) continue;
    for (const line of entry.items) {
      if (line.currency !== currency || line.kind === 'ready' || !['spend', 'refund', 'interest', 'fee'].includes(line.flow)) continue;
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

/** Saving and moving principal are allocations, not a spending allowance. */
export function plannedSpending(plan: PlanMonth): bigint {
  return expenseGroups(plan).reduce((sum, group) => sum + group.planned, 0n);
}
