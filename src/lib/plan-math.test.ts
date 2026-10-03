import { flexPlanned, groupOver, splitByBps } from './plan-math.ts';

describe('splitByBps (mirrors budget.split_by_bps exactly)', () => {
  it('splits $4,110 into the default groups', () => {
    expect(splitByBps(411000n, [6000, 500, 1500, 1000, 1000])).toEqual([246600n, 20550n, 61650n, 41100n, 41100n]);
  });

  it('gives leftover units to the largest remainders, ties in order', () => {
    expect(splitByBps(100n, [3333, 3333, 3334])).toEqual([33n, 33n, 34n]);
    expect(splitByBps(100n, [3334, 3333, 3333])).toEqual([34n, 33n, 33n]);
    expect(splitByBps(1n, [5000, 5000])).toEqual([1n, 0n]);
  });

  it('splits only the planned share under 100%', () => {
    expect(splitByBps(101n, [5000, 4000])).toEqual([50n, 40n]);
  });

  it('refuses more than 100% and negative totals', () => {
    expect(() => splitByBps(100n, [6000, 5000])).toThrow('BUDGET_PLAN_OVER_100');
    expect(() => splitByBps(-1n, [100])).toThrow();
  });
});

describe('flexible remainder', () => {
  it('gives the flexible item what the items leave', () => {
    expect(flexPlanned(246600n, [100000n, 25000n, 60000n, 25000n, 15000n, 20000n])).toBe(1600n);
  });

  it('gives nothing to the flexible item of an over-planned group and reports the overage', () => {
    expect(flexPlanned(246600n, [250000n])).toBe(0n);
    expect(groupOver(246600n, [250000n])).toBe(3400n);
    expect(groupOver(246600n, [100000n])).toBe(0n);
  });
});
