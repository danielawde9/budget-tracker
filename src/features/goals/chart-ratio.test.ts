import { describe, expect, it } from 'vitest';
import { chartPercent } from './chart-ratio.js';

describe('chartPercent', () => {
  it('returns the exact percentage for a partial fill', () => {
    expect(chartPercent('5000', '10000')).toBe(50);
  });
  it('returns 0 for zero or negative actual', () => {
    expect(chartPercent('0', '10000')).toBe(0);
    expect(chartPercent('-500', '10000')).toBe(0);
  });
  it('returns 0 for a zero or negative scale (no target)', () => {
    expect(chartPercent('500', '0')).toBe(0);
    expect(chartPercent('500', '-100')).toBe(0);
  });
  it('clamps an over-100% actual to exactly 100 for the visual coordinate', () => {
    expect(chartPercent('15000', '10000')).toBe(100);
  });
  it('supports a fractional percentage (two decimal digits)', () => {
    expect(chartPercent('3333', '10000')).toBe(33.33);
  });
  it('handles amounts far beyond Number.MAX_SAFE_INTEGER without precision loss in the bounding step', () => {
    expect(chartPercent('999999999999999', '999999999999999')).toBe(100);
    expect(chartPercent('1', '999999999999999')).toBe(0);
  });
});
