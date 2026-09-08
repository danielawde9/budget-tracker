import type { Currency, Locale } from '../loans/types.js';

const MAX_MINOR_DIGITS = 15;
const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'] as const;

function assertMinorAmount(value: string): void {
  if (!/^-?\d+$/.test(value)) throw new Error('Invalid minor-unit amount');
}

export function parsePositiveMinorAmount(rawValue: string, currency: Currency): string {
  const value = rawValue.replaceAll(',', '').trim();
  const match = (currency === 'USD' ? /^(\d+)(?:\.(\d{1,2}))?$/ : /^(\d+)$/).exec(value);
  if (!match) throw new Error('Enter a valid positive amount');

  const whole = (match[1] ?? '').replace(/^0+(?=\d)/, '');
  const fraction = currency === 'USD' ? (match[2] ?? '').padEnd(2, '0') : '';
  const minor = `${whole}${fraction}`.replace(/^0+(?=\d)/, '');
  if (!/^\d+$/.test(minor) || BigInt(minor) <= 0n || minor.length > MAX_MINOR_DIGITS) {
    throw new Error('Enter a valid positive amount');
  }
  return minor;
}

export function invertMinorAmount(amountMinor: string): string {
  assertMinorAmount(amountMinor);
  return (-BigInt(amountMinor)).toString();
}

export function sumMinorAmounts(amounts: readonly string[]): string {
  return amounts.reduce((sum, amount) => {
    assertMinorAmount(amount);
    return sum + BigInt(amount);
  }, 0n).toString();
}

function localizedDigits(value: string): string {
  return value.replace(/\d/g, (digit) => arabicDigits[Number(digit)] ?? digit);
}

export function formatMinorAmount(amountMinor: string, currency: Currency, locale: Locale): string {
  assertMinorAmount(amountMinor);
  const amount = BigInt(amountMinor);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = currency === 'USD' ? absolute / 100n : absolute;
  const fraction = currency === 'USD' ? (absolute % 100n).toString().padStart(2, '0') : '';
  const grouped = new Intl.NumberFormat(locale === 'ar' ? 'ar-LB' : 'en-US', {
    maximumFractionDigits: 0,
  }).format(whole);
  const sign = negative ? '-' : '';

  if (locale === 'ar') {
    return currency === 'USD'
      ? `${sign}${grouped}٫${localizedDigits(fraction)}\u00a0USD`
      : `${sign}${grouped}\u00a0LBP`;
  }
  return currency === 'USD'
    ? `${sign}$${grouped}.${fraction}`
    : `${sign}LBP\u00a0${grouped}`;
}
