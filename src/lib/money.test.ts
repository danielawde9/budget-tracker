import { approxUsd, formatMoney, parseMoney, toMinor } from './money.ts';

describe('formatMoney', () => {
  it.each([
    [123456n, 'USD', 'en', '$1,234.56'],
    [20550n, 'USD', 'en', '$205.50'],
    [0n, 'USD', 'en', '$0.00'],
    [-1550n, 'USD', 'en', '-$15.50'],
    [4475000n, 'LBP', 'en', 'LBP 4,475,000'],
    [123456n, 'USD', 'ar', '١٬٢٣٤٫٥٦ USD'],
    [4475000n, 'LBP', 'ar', '٤٬٤٧٥٬٠٠٠ LBP'],
    [-5n, 'USD', 'ar', '-٠٫٠٥ USD'],
  ] as const)('formats %s %s in %s', (minor, currency, locale, expected) => {
    expect(formatMoney(minor, currency, locale)).toBe(expected);
  });

  it('can show an explicit plus sign for money coming in', () => {
    expect(formatMoney(100000n, 'USD', 'en', { sign: true })).toBe('+$1,000.00');
  });

  it('never loses precision on very large amounts', () => {
    expect(formatMoney(999999999999999n, 'LBP', 'en')).toBe('LBP 999,999,999,999,999');
  });
});

describe('parseMoney', () => {
  it.each([
    ['4110', 'USD', 411000n],
    ['4,110.5', 'USD', 411050n],
    ['205.50', 'USD', 20550n],
    ['  12 ', 'USD', 1200n],
    ['٤١١٠٫٥', 'USD', 411050n],
    ['٤٬١١٠', 'USD', 411000n],
    ['4475000', 'LBP', 4475000n],
    ['4,475,000', 'LBP', 4475000n],
    ['0', 'USD', 0n],
  ] as const)('parses %j as %s', (text, currency, expected) => {
    expect(parseMoney(text, currency)).toBe(expected);
  });

  it.each([
    ['', 'USD'],
    ['abc', 'USD'],
    ['1.234', 'USD'],
    ['12.5', 'LBP'],
    ['-5', 'USD'],
    ['1e5', 'USD'],
    ['10000000000000000', 'LBP'],
  ] as const)('rejects %j for %s', (text, currency) => {
    expect(parseMoney(text, currency)).toBeNull();
  });
});

describe('toMinor and approxUsd', () => {
  it('reads minor-unit strings exactly', () => {
    expect(toMinor('-123')).toBe(-123n);
    expect(() => toMinor('1.5')).toThrow();
  });

  it('converts lira to approximate cents with half-even rounding at the reference rate', () => {
    expect(approxUsd(2685000n, '89500')).toBe(3000n);
    expect(approxUsd(44750n, '89500')).toBe(50n);
    expect(approxUsd(447n, '89500')).toBe(0n);
    expect(approxUsd(1342500n, '89500')).toBe(1500n);
  });
});
