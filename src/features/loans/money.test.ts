import { describe, expect, it } from 'vitest';
import { deriveLoanStatus, formatMinorAmount, parseMinorAmount } from './money.js';

describe('parseMinorAmount', () => {
  it('converts USD decimals to exact cents without floating point math', () => {
    expect(parseMinorAmount('1,234.05', 'USD')).toBe('123405');
  });

  it('keeps LBP as whole pounds', () => {
    expect(parseMinorAmount('1,500,000', 'LBP')).toBe('1500000');
  });

  it.each([
    ['', 'USD'],
    ['0', 'USD'],
    ['-1', 'USD'],
    ['12.345', 'USD'],
    ['12.5.0', 'USD'],
    ['99999999999999.99', 'USD'],
    ['1.5', 'LBP'],
  ] as const)('rejects invalid positive amount %s for %s', (value, currency) => {
    expect(() => parseMinorAmount(value, currency)).toThrow('Enter a valid positive amount');
  });
});

describe('formatMinorAmount', () => {
  it('formats USD and LBP using their minor-unit conventions', () => {
    expect(formatMinorAmount('123405', 'USD', 'en')).toBe('$1,234.05');
    expect(formatMinorAmount('1500000', 'LBP', 'en')).toBe('LBP 1,500,000');
  });
});

describe('deriveLoanStatus', () => {
  it('derives settled, overdue, and outstanding from ledger values', () => {
    expect(deriveLoanStatus('0', '2026-09-01', '2026-09-07')).toBe('settled');
    expect(deriveLoanStatus('100', '2026-09-01', '2026-09-07')).toBe('overdue');
    expect(deriveLoanStatus('100', '2026-09-07', '2026-09-07')).toBe('outstanding');
    expect(deriveLoanStatus('100', null, '2026-09-07')).toBe('outstanding');
  });
});
