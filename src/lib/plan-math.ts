/**
 * The plan editor previews amounts while the owner types. These functions
 * mirror the database exactly (budget.split_by_bps and the flexible remainder
 * in budget.plan_lines); tests/db/plan-math-parity.test.ts proves they agree.
 * The database stays the authority: saved plans are always re-derived there.
 */
export function splitByBps(total: bigint, bps: readonly number[]): bigint[] {
  if (total < 0n) throw new Error('BUDGET_INVALID_AMOUNT');
  if (bps.length === 0) return [];
  let sumBps = 0n;
  for (const value of bps) {
    if (!Number.isInteger(value) || value < 0 || value > 10000) throw new Error('BUDGET_INVALID_PERCENT');
    sumBps += BigInt(value);
  }
  if (sumBps > 10000n) throw new Error('BUDGET_PLAN_OVER_100');
  const target = (total * sumBps) / 10000n;
  const parts = bps.map((value) => (total * BigInt(value)) / 10000n);
  const remainders = bps.map((value) => (total * BigInt(value)) % 10000n);
  let left = target - parts.reduce((sum, part) => sum + part, 0n);
  // Each part lost less than one unit, so `left` is below bps.length.
  while (left > 0n) {
    let best = -1;
    remainders.forEach((remainder, index) => {
      const current = best === -1 ? -1n : (remainders[best] ?? -1n);
      if (remainder >= 0n && (best === -1 || remainder > current)) best = index;
    });
    if (best === -1) throw new Error('BUDGET_SPLIT_FAILED');
    parts[best] = (parts[best] ?? 0n) + 1n;
    remainders[best] = -1n;
    left -= 1n;
  }
  return parts;
}

const sum = (values: readonly bigint[]): bigint => values.reduce((total, value) => total + value, 0n);

/** What the group's flexible item receives: the group amount the items leave. */
export function flexPlanned(groupAmount: bigint, itemAmounts: readonly bigint[]): bigint {
  const rest = groupAmount - sum(itemAmounts);
  return rest > 0n ? rest : 0n;
}

/** How far a group's items exceed its percentage share. */
export function groupOver(groupAmount: bigint, itemAmounts: readonly bigint[]): bigint {
  const over = sum(itemAmounts) - groupAmount;
  return over > 0n ? over : 0n;
}

/** Basis points ⇄ text, e.g. 6000 ⇄ "60", 550 ⇄ "5.5". */
export function bpsToPercentText(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = bps % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}`;
}

export function percentTextToBps(text: string): number | null {
  const normalized = text.trim().replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace('٫', '.');
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bps <= 10000 ? bps : null;
}
