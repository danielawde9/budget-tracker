import type { PlanGroup, PlanItem, PlanMonth } from '../api/schemas.ts';

export type MoneyPurpose = PlanGroup['purpose'] | 'reserve';

export function itemPurpose(group: PlanGroup, item: PlanItem): MoneyPurpose {
  if (item.kind === 'reserve' || item.kind === 'loan_payment') return 'reserve';
  if (item.kind === 'goal') return 'saving';
  return group.purpose;
}

export function purposeItems(plan: PlanMonth) {
  return plan.groups.flatMap(group => [...group.items, ...(group.flex ? [group.flex] : [])]
    .map(item => ({ item, purpose: itemPurpose(group, item) })));
}

/** Derive the headline from the same item shortfalls the person sees below. */
export function remainingFunding(plan: PlanMonth): bigint {
  return purposeItems(plan).reduce((sum, { item }) => sum + item.stillToFund, 0n);
}
