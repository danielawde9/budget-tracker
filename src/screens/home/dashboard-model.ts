import { BudgetError, type BudgetApi } from '../../api/budget-api.ts';
import type { ActivityCursor, Entry, PlanMonth } from '../../api/schemas.ts';
import type { Currency } from '../../lib/money.ts';
import { addDays } from '../describe.ts';

export function dashboardTotals(plan: PlanMonth, currency: Currency) {
  const items = plan.groups.flatMap(group => [...group.items, ...(group.flex ? [group.flex] : [])]);
  const sum = (kinds: string[]) => items.filter(item => kinds.includes(item.kind)).reduce((total, item) => total + item.balances[currency], 0n);
  return {
    available: sum(['spending', 'flex']), reserves: sum(['reserve', 'loan_payment']), savings: sum(['goal']),
    spent: currency === plan.planCurrency ? plan.groups.reduce((total, group) => total + group.spent, 0n) : null,
  };
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
  return plan.groups.flatMap(group => [...group.items, ...(group.flex ? [group.flex] : [])])
    .filter(item => item.kind === 'spending' || item.kind === 'flex')
    .reduce((sum, item) => sum + item.planned, 0n);
}
