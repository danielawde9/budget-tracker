import type { PlanGroup, PlanItem, PlanMonth } from '../api/schemas.ts';

export type MoneyPurpose = 'spending' | 'saving' | 'investment' | 'reserve';

export function itemPurpose(group: PlanGroup, item: PlanItem): MoneyPurpose {
  if (group.purpose === 'savings') return 'saving';
  if (item.kind === 'reserve' || item.kind === 'loan_payment') return 'reserve';
  return 'spending';
}

export function purposeItems(plan: PlanMonth) {
  return plan.groups.flatMap(group => [...group.items, ...(group.flex ? [group.flex] : [])]
    .map(item => ({ item, purpose: itemPurpose(group, item) })));
}

/** The canonical monthly contract includes scoped assignments and Ready spending. */
export function remainingFunding(plan: PlanMonth): bigint {
  return plan.stillToFund;
}
