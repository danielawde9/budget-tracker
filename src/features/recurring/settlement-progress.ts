import { chartPercent } from './chart-ratio.js';

export interface SettlementProgress {
  /** `expectedMinor` is contractually positive (`save_schedule`/
   * `parsePositiveMinorAmount` reject a non-positive expected amount), so
   * `hasTarget` is a defensive guard against a malformed DTO, not a state
   * any normal flow reaches -- unlike allocation/goals' `hasPlan`/nullable-
   * target fields, a schedule occurrence is never genuinely target-less. */
  readonly hasTarget: boolean;
  /** True when the settled amount is negative -- also defensive; settlement
   * is a sum of settlement links minus reversals and is never expected to
   * go negative through any normal flow. */
  readonly settledNegative: boolean;
  /** The bounded 0-100 visual coordinate for the bar; geometry only. */
  readonly percent: number;
  readonly over: boolean;
  /** Non-null exactly when `over` is true. Computed from the original
   * `BigInt` settled/expected values, never from the clamped `percent`
   * coordinate. */
  readonly overageMinor: string | null;
}

/** Expected-vs-settled progress for one occurrence -- shared by the
 * upcoming list's per-row bar (`upcoming-page.tsx`) and the detail view's
 * own bar (`occurrence-detail.tsx`'s `OccurrenceAmountsTable`) so the
 * negative-settled guard and overage logic can't silently drift between
 * the two call sites. */
export function settlementProgress(expectedMinor: string, settledMinor: string): SettlementProgress {
  const expected = BigInt(expectedMinor);
  const settled = BigInt(settledMinor);
  const settledNegative = settled < 0n;
  const hasTarget = expected > 0n;
  const percent = hasTarget ? chartPercent(settledNegative ? '0' : settledMinor, expectedMinor) : 0;
  const over = hasTarget && settled > expected;
  const overageMinor = over ? (settled - expected).toString() : null;
  return { hasTarget, settledNegative, percent, over, overageMinor };
}
