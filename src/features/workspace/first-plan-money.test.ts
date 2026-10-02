import { describe, expect, it } from 'vitest';
import { amountFromPercent, percentFromAmount, parsePlanAmount, majorInput } from './first-plan-money.js';

describe('first plan money', () => {
  it('calculates either direction using income and integer minor units', () => {
    expect(amountFromPercent('14', '250000')).toBe('35000');
    expect(percentFromAmount('35000', '250000')).toBe('14');
    expect(majorInput('35000', 'USD')).toBe('350');
  });
  it('rounds percentages to currency precision without float money', () => {
    expect(amountFromPercent('33.33', '10000')).toBe('3333');
    expect(amountFromPercent('12.5', '101')).toBe('13');
    expect(majorInput('13', 'LBP')).toBe('13');
    expect(percentFromAmount('1', '3')).toBe('33.33');
  });
  it('accepts zero targets and whole LBP but rejects invalid or unsafe input', () => {
    expect(parsePlanAmount('0', 'USD')).toBe('0');
    expect(parsePlanAmount('2,500.50', 'USD')).toBe('250050');
    expect(parsePlanAmount('2500', 'LBP')).toBe('2500');
    expect(() => parsePlanAmount('1.50', 'LBP')).toThrow();
    expect(() => parsePlanAmount('-1', 'USD')).toThrow();
    expect(() => parsePlanAmount('1e3', 'USD')).toThrow();
    expect(() => amountFromPercent('101', '250000')).toThrow();
    expect(() => amountFromPercent('10', '0')).toThrow();
    expect(() => parsePlanAmount('10000000000000', 'USD')).toThrow();
  });
  it('handles Arabic decimal digits', () => {
    expect(parsePlanAmount('٢٥٠٠٫٥٠', 'USD')).toBe('250050');
    expect(amountFromPercent('١٤', '250000')).toBe('35000');
  });
});
