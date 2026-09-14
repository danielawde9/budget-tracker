import { describe, expect, it } from 'vitest';
import { allocateIncome, basisPointsToPercentText, percentToBasisPoints, residualId, type AllocationWeight } from './money-allocation.js';

describe('percentToBasisPoints', () => {
  it('converts a whole percent', () => {
    expect(percentToBasisPoints('56')).toBe(5600);
  });
  it('converts a two-decimal percent, matching the task example exactly', () => {
    expect(percentToBasisPoints('56.25')).toBe(5625);
  });
  it('converts a one-decimal percent', () => {
    expect(percentToBasisPoints('56.5')).toBe(5650);
  });
  it('accepts the boundaries 0 and 100', () => {
    expect(percentToBasisPoints('0')).toBe(0);
    expect(percentToBasisPoints('100')).toBe(10000);
  });
  it('rejects more than two decimal digits', () => {
    expect(() => percentToBasisPoints('56.256')).toThrow();
  });
  it('rejects a value over 100', () => {
    expect(() => percentToBasisPoints('100.01')).toThrow();
  });
  it('rejects a negative or non-numeric value', () => {
    expect(() => percentToBasisPoints('-5')).toThrow();
    expect(() => percentToBasisPoints('abc')).toThrow();
  });
});

describe('basisPointsToPercentText', () => {
  it('round-trips through percentToBasisPoints', () => {
    expect(basisPointsToPercentText(5625)).toBe('56.25');
    expect(basisPointsToPercentText(percentToBasisPoints('56.25'))).toBe('56.25');
  });
  it('omits the decimal part for a whole percent', () => {
    expect(basisPointsToPercentText(5600)).toBe('56');
  });
});

const weights = [
  { id: '00000000-0000-4000-8000-000000000001', order: 0, basisPoints: 5600 },
  { id: '00000000-0000-4000-8000-000000000002', order: 1, basisPoints: 2400 },
  { id: '00000000-0000-4000-8000-000000000003', order: 2, basisPoints: 2000 },
] as const;

describe('allocateIncome', () => {
  it('preserves every minor unit, including the residual row', () => {
    expect(allocateIncome('101', weights).map((row) => row.amountMinor))
      .toEqual(['57', '24', '20', '0']);
    expect(allocateIncome('200000', weights).map((row) => row.amountMinor))
      .toEqual(['112000', '48000', '40000', '0']);
  });

  it('matches the exact plan-pack fixture cross-checked against the SQL helper (task 05)', () => {
    // Same vectors private.allocate_planning_income proved in
    // tests/db/allocation-commands.integration.test.ts.
    expect(allocateIncome('101', weights).map((row) => row.amountMinor)).toEqual(['57', '24', '20', '0']);
    expect(allocateIncome('1', [
      { id: weights[0].id, order: 0, basisPoints: 5000 },
      { id: weights[1].id, order: 1, basisPoints: 3000 },
      { id: weights[2].id, order: 2, basisPoints: 2000 },
    ]).map((row) => row.amountMinor)).toEqual(['1', '0', '0', '0']);
    expect(allocateIncome('100', [weights[0]]).map((row) => row.amountMinor)).toEqual(['56', '44']);
  });

  it('supports an incomplete split', () => {
    expect(allocateIncome('100', weights.slice(0, 1))).toEqual([
      { id: weights[0].id, amountMinor: '56' },
      { id: residualId, amountMinor: '44' },
    ]);
  });

  it('returns all zero for zero income', () => {
    expect(allocateIncome('0', weights).every((row) => row.amountMinor === '0')).toBe(true);
  });

  it('puts all income into the residual for all-zero weights', () => {
    expect(allocateIncome('500', [{ id: weights[0].id, order: 0, basisPoints: 0 }])).toEqual([
      { id: weights[0].id, amountMinor: '0' },
      { id: residualId, amountMinor: '500' },
    ]);
  });

  it('rejects over-allocation and imprecise money', () => {
    expect(() => allocateIncome('1.50', weights)).toThrow();
    expect(() => allocateIncome('1', [{ ...weights[0], basisPoints: 10001 }])).toThrow();
  });

  it('rejects duplicate group ids and duplicate display orders', () => {
    expect(() => allocateIncome('100', [weights[0], { ...weights[1], id: weights[0].id }])).toThrow();
    expect(() => allocateIncome('100', [weights[0], { ...weights[1], order: weights[0].order }])).toThrow();
  });

  it('rejects the reserved residual id used as a real group id', () => {
    expect(() => allocateIncome('100', [{ id: residualId, order: 0, basisPoints: 100 }])).toThrow();
  });

  it('rejects a malformed (non-canonical) group UUID', () => {
    expect(() => allocateIncome('100', [{ id: 'not-a-uuid', order: 0, basisPoints: 100 }])).toThrow();
  });

  it('rejects an out-of-range order or basis points', () => {
    expect(() => allocateIncome('100', [{ ...weights[0], order: 12 }])).toThrow();
    expect(() => allocateIncome('100', [{ ...weights[0], order: -1 }])).toThrow();
    expect(() => allocateIncome('100', [{ ...weights[0], basisPoints: -1 }])).toThrow();
  });

  it('rejects more than 12 groups', () => {
    const tooMany: AllocationWeight[] = Array.from({ length: 13 }, (_v, index) => ({
      id: `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`, order: index % 12, basisPoints: 1,
    }));
    expect(() => allocateIncome('100', tooMany)).toThrow();
  });

  it('handles the maximum bounded income (999999999999999) without precision loss', () => {
    const result = allocateIncome('999999999999999', weights);
    const total = result.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n);
    expect(total).toBe(999999999999999n);
  });

  it('conserves every minor unit for incomes 0..1000 across several weight vectors, each row within 1 unit of its exact share', () => {
    const vectors: readonly AllocationWeight[][] = [
      weights.map((w) => ({ ...w })),
      [{ id: weights[0].id, order: 0, basisPoints: 5000 }, { id: weights[1].id, order: 1, basisPoints: 3000 }, { id: weights[2].id, order: 2, basisPoints: 2000 }],
      [{ id: weights[0].id, order: 0, basisPoints: 3333 }, { id: weights[1].id, order: 1, basisPoints: 3333 }, { id: weights[2].id, order: 2, basisPoints: 3334 }],
      [{ id: weights[0].id, order: 0, basisPoints: 5600 }],
      [{ id: weights[0].id, order: 0, basisPoints: 0 }, { id: weights[1].id, order: 1, basisPoints: 0 }],
      Array.from({ length: 12 }, (_v, index) => ({
        id: `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`, order: index, basisPoints: Math.floor(10000 / 12),
      })),
    ];
    for (const groupVector of vectors) {
      for (let income = 0; income <= 1000; income += 1) {
        const result = allocateIncome(String(income), groupVector);
        const total = result.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n);
        expect(total).toBe(BigInt(income));
        for (const group of groupVector) {
          const row = result.find((r) => r.id === group.id)!;
          const exactShareMinorUnits = (income * group.basisPoints) / 10000;
          expect(Math.abs(Number(row.amountMinor) - exactShareMinorUnits)).toBeLessThan(1);
        }
      }
    }
  });

  it('gives the tie-breaking unit to the lowest display order, then lowest id, on an exact fractional tie', () => {
    // Two groups with identical basis points and a 1-unit remainder: order
    // breaks the tie deterministically, matching the SQL helper's ORDER BY.
    const tied = [
      { id: '00000000-0000-4000-8000-000000000002', order: 1, basisPoints: 5000 },
      { id: '00000000-0000-4000-8000-000000000001', order: 0, basisPoints: 5000 },
    ];
    expect(allocateIncome('1', tied)).toEqual([
      { id: '00000000-0000-4000-8000-000000000001', amountMinor: '1' },
      { id: '00000000-0000-4000-8000-000000000002', amountMinor: '0' },
      { id: residualId, amountMinor: '0' },
    ]);
  });
});
