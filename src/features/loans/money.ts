import type { Currency, Locale, LoanStatus } from './types.js';

const MAX_MINOR_DIGITS = 15;

export function parseMinorAmount(rawValue: string, currency: Currency): string {
  const value = rawValue.replaceAll(',', '').trim();
  const pattern = currency === 'USD' ? /^(\d+)(?:\.(\d{1,2}))?$/ : /^(\d+)$/;
  const match = pattern.exec(value);

  if (!match) {
    throw new Error('Enter a valid positive amount');
  }

  const whole = (match[1] ?? '').replace(/^0+(?=\d)/, '');
  const fraction = currency === 'USD' ? (match[2] ?? '').padEnd(2, '0') : '';
  const minor = `${whole}${fraction}`.replace(/^0+(?=\d)/, '');

  if (!/^\d+$/.test(minor) || BigInt(minor) <= 0n || minor.length > MAX_MINOR_DIGITS) {
    throw new Error('Enter a valid positive amount');
  }

  return minor;
}

export function formatMinorAmount(amountMinor: string, currency: Currency, locale: Locale): string {
  const divisor = currency === 'USD' ? 100 : 1;
  const amount = Number(BigInt(amountMinor)) / divisor;

  return new Intl.NumberFormat(locale === 'ar' ? 'ar-LB' : 'en-US', {
    style: 'currency',
    currency,
    currencyDisplay: currency === 'LBP' ? 'code' : 'symbol',
    maximumFractionDigits: currency === 'USD' ? 2 : 0,
    minimumFractionDigits: currency === 'USD' ? 2 : 0,
  }).format(amount);
}

export function deriveLoanStatus(
  outstandingMinor: string,
  dueDate: string | null,
  today: string,
): LoanStatus {
  if (BigInt(outstandingMinor) === 0n) {
    return 'settled';
  }

  if (dueDate !== null && dueDate < today) {
    return 'overdue';
  }

  return 'outstanding';
}
