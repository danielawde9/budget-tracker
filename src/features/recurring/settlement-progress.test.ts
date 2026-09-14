import { describe, expect, it } from 'vitest';
import { settlementProgress } from './settlement-progress.js';

describe('settlementProgress', () => {
  it('U16-01: 50000 expected, 20000 settled -- under target, no overage', () => {
    const result = settlementProgress('50000', '20000');
    expect(result).toEqual({ hasTarget: true, settledNegative: false, percent: 40, over: false, overageMinor: null });
  });

  it('computes the exact overage from the raw BigInt values once settled exceeds expected', () => {
    const result = settlementProgress('10000', '15000');
    expect(result.over).toBe(true);
    expect(result.overageMinor).toBe('5000');
    expect(result.percent).toBe(100); // the visual coordinate stays clamped at 100
  });

  it('treats a non-positive expected amount as no target, defensively', () => {
    expect(settlementProgress('0', '5000')).toMatchObject({ hasTarget: false, percent: 0, over: false, overageMinor: null });
    expect(settlementProgress('-100', '5000')).toMatchObject({ hasTarget: false, over: false });
  });

  it('flags a negative settled amount and excludes it from the bar percentage, defensively', () => {
    const result = settlementProgress('10000', '-500');
    expect(result.settledNegative).toBe(true);
    expect(result.percent).toBe(0);
    expect(result.over).toBe(false);
  });
});
