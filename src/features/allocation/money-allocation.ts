export interface AllocationWeight {
  readonly id: string;
  readonly order: number;
  readonly basisPoints: number;
}
export interface AllocatedAmount {
  readonly id: string;
  readonly amountMinor: string;
}
export const residualId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

export function allocateIncome(
  incomeMinor: string,
  groups: readonly AllocationWeight[],
): readonly AllocatedAmount[] {
  if (!/^(0|[1-9][0-9]{0,14})$/.test(incomeMinor)) {
    throw new Error('Invalid nonnegative income.');
  }
  if (groups.length > 12) throw new Error('Too many allocation groups.');
  const ids = new Set(groups.map((group) => group.id));
  const orders = new Set(groups.map((group) => group.order));
  if (ids.size !== groups.length || orders.size !== groups.length || ids.has(residualId)) {
    throw new Error('Duplicate or reserved group identity/order.');
  }
  if (groups.some((g) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(g.id)
    || !Number.isInteger(g.order) || g.order < 0 || g.order > 11
    || !Number.isInteger(g.basisPoints) || g.basisPoints < 0 || g.basisPoints > 10000)) {
    throw new Error('Invalid allocation weight.');
  }
  const total = groups.reduce((sum, group) => sum + group.basisPoints, 0);
  if (total > 10000) throw new Error('Allocation exceeds 100 percent.');
  const income = BigInt(incomeMinor);
  const weights = [...groups, { id: residualId, order: 12, basisPoints: 10000 - total }];
  const parts = weights.map((group) => {
    const numerator = income * BigInt(group.basisPoints);
    return { ...group, base: numerator / 10000n, fraction: numerator % 10000n };
  });
  const remainder = Number(income - parts.reduce((sum, part) => sum + part.base, 0n));
  const ranked = [...parts].sort((a, b) => {
    if (a.fraction !== b.fraction) return a.fraction > b.fraction ? -1 : 1;
    return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  const winners = new Set(ranked.slice(0, remainder).map((part) => part.id));
  return [...parts].sort((a, b) => a.order - b.order).map((part) => ({
    id: part.id, amountMinor: (part.base + (winners.has(part.id) ? 1n : 0n)).toString(),
  }));
}
