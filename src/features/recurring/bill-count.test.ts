import { describe, expect, it } from 'vitest';
import { billCount, formatCount } from './bill-count.js';

// Final review M4: Arabic counts agree with the number (dual for 2, plural
// for 3-10, singular for 11 and up) and use Arabic-Indic digits, the way the
// app already writes amounts in Arabic.
describe('billCount', () => {
  it.each([
    [2, '2 bills', 'فاتورتين'],
    [3, '3 bills', '٣ فواتير'],
    [10, '10 bills', '١٠ فواتير'],
    [11, '11 bills', '١١ فاتورة'],
    [99, '99 bills', '٩٩ فاتورة'],
    [100, '100 bills', '١٠٠ فاتورة'],
    [103, '103 bills', '١٠٣ فواتير'],
    [1000, '1,000 bills', '١٬٠٠٠ فاتورة'],
  ])('words %i bills in English and Arabic', (count, english, arabic) => {
    expect(billCount(count, 'en')).toBe(english);
    expect(billCount(count, 'ar')).toBe(arabic);
  });

  it('writes Arabic counts in Arabic-Indic digits, like amounts elsewhere', () => {
    expect(formatCount(1000, 'ar')).toBe('١٬٠٠٠');
    expect(formatCount(1000, 'en')).toBe('1,000');
  });
});
