/**
 * Exact money handling for the client. Amounts are bigint minor units
 * everywhere: USD in cents, LBP in whole lira. Nothing here ever adds two
 * currencies; `approxUsd` exists only for clearly labelled "≈" hints.
 */
export type Currency = 'USD' | 'LBP';
export type Locale = 'en' | 'ar';

export const CURRENCIES: readonly Currency[] = ['USD', 'LBP'];
export const CURRENCY_DECIMALS: Readonly<Record<Currency, 0 | 2>> = { USD: 2, LBP: 0 };
export const MAX_MINOR = 1_000_000_000_000_000n;

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'] as const;

export function toMinor(value: string): bigint {
  if (!/^-?\d{1,19}$/.test(value)) throw new Error(`Invalid minor-unit amount: ${value}`);
  return BigInt(value);
}

function group(digits: string, separator: string): string {
  const parts: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) parts.unshift(digits.slice(Math.max(0, end - 3), end));
  return parts.join(separator);
}

function arabicDigits(value: string): string {
  return value.replace(/\d/g, (digit) => ARABIC_DIGITS[Number(digit)] ?? digit);
}

export function formatMoney(minor: bigint, currency: Currency, locale: Locale, options: { sign?: boolean } = {}): string {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const decimals = CURRENCY_DECIMALS[currency];
  const scale = 10n ** BigInt(decimals);
  const whole = (absolute / scale).toString();
  const fraction = decimals > 0 ? (absolute % scale).toString().padStart(decimals, '0') : '';
  const sign = negative ? '-' : options.sign && minor > 0n ? '+' : '';
  if (locale === 'ar') {
    const number = arabicDigits(group(whole, '٬')) + (fraction ? `٫${arabicDigits(fraction)}` : '');
    return `${sign}${number} ${currency}`;
  }
  const number = group(whole, ',') + (fraction ? `.${fraction}` : '');
  return currency === 'USD' ? `${sign}$${number}` : `${sign}LBP ${number}`;
}

/** Major units for an editable field (no grouping, Latin digits). */
export function toInputText(minor: bigint, currency: Currency): string {
  const decimals = CURRENCY_DECIMALS[currency];
  if (decimals === 0) return minor.toString();
  const scale = 10n ** BigInt(decimals);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const fraction = (absolute % scale).toString().padStart(decimals, '0');
  return `${negative ? '-' : ''}${absolute / scale}${fraction === '00' ? '' : `.${fraction}`}`;
}

/**
 * Reads a non-negative amount typed by a person, in Latin or Arabic-Indic
 * digits, with optional grouping. Returns null for anything ambiguous.
 */
export function parseMoney(text: string, currency: Currency): bigint | null {
  const normalized = text
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[٬,\s ]/g, '')
    .replace('٫', '.');
  const decimals = CURRENCY_DECIMALS[currency];
  const pattern = decimals === 0 ? /^(\d+)$/ : /^(\d+)(?:\.(\d{1,2}))?$/;
  const match = pattern.exec(normalized);
  if (!match) return null;
  const whole = match[1] ?? '0';
  const fraction = (match[2] ?? '').padEnd(decimals, '0');
  if (whole.length > 18) return null;
  const minor = BigInt(whole) * 10n ** BigInt(decimals) + (fraction ? BigInt(fraction) : 0n);
  return minor > MAX_MINOR ? null : minor;
}

/**
 * Lira → approximate US cents at a dated reference rate (lira per dollar),
 * rounded half to even. Display only: never stored, never added to USD.
 */
export function approxUsd(lbpMinor: bigint, unitsPerUsd: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(unitsPerUsd);
  if (!match) throw new Error(`Invalid rate ${unitsPerUsd}`);
  const fraction = match[2] ?? '';
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${match[1] ?? '0'}${fraction}`);
  if (numerator === 0n) throw new Error('Rate must be positive');
  const scaled = lbpMinor * 100n * denominator;
  const quotient = scaled / numerator;
  const remainder = scaled % numerator;
  const twice = (remainder < 0n ? -remainder : remainder) * 2n;
  if (twice > numerator || (twice === numerator && quotient % 2n !== 0n)) return quotient + (scaled < 0n ? -1n : 1n);
  return quotient;
}
