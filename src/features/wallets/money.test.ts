import { describe, expect, it } from 'vitest';

import {
  formatMinorAmount,
  invertMinorAmount,
  parsePositiveMinorAmount,
  sumMinorAmounts,
} from './money.js';

describe('wallet money', () => {
  it('parses USD and LBP to exact positive minor-unit strings', () => {
    expect(parsePositiveMinorAmount('1,234.50', 'USD')).toBe('123450');
    expect(parsePositiveMinorAmount('250000', 'LBP')).toBe('250000');
  });

  it.each(['0', '-1', '1.001', 'not money'])('rejects invalid positive USD input %s', (value) => {
    expect(() => parsePositiveMinorAmount(value, 'USD')).toThrow('Enter a valid positive amount');
  });

  it('rejects fractional LBP and values beyond the database bound', () => {
    expect(() => parsePositiveMinorAmount('1.5', 'LBP')).toThrow('Enter a valid positive amount');
    expect(() => parsePositiveMinorAmount('1234567890123456', 'LBP')).toThrow('Enter a valid positive amount');
  });

  it('builds and sums signed movements without floating-point arithmetic', () => {
    expect(invertMinorAmount('1250')).toBe('-1250');
    expect(invertMinorAmount('-1250')).toBe('1250');
    expect(sumMinorAmounts(['1250', '-250', '-1000'])).toBe('0');
  });

  it('formats large minor-unit strings without converting them to Number', () => {
    expect(formatMinorAmount('900719925474099', 'USD', 'en')).toBe('$9,007,199,254,740.99');
    expect(formatMinorAmount('-250000', 'LBP', 'en')).toBe('-LBP\u00a0250,000');
  });
});
