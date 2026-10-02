import type { Currency } from '../loans/types.js';
import { parsePositiveMinorAmount } from '../wallets/money.js';

export function normalizePlanNumber(value: string): string {
  return value.replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x6f0))
    .replaceAll('٫', '.').replaceAll('٬', ',').trim();
}

export function parsePlanAmount(value: string, currency: Currency): string {
  const normalized = normalizePlanNumber(value);
  if (/^0+(?:\.0{1,2})?$/.test(normalized) && (currency === 'USD' || !normalized.includes('.'))) return '0';
  return parsePositiveMinorAmount(normalized, currency);
}

export function amountFromPercent(value: string, incomeMinor: string): string {
  const normalized = normalizePlanNumber(value);
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match || BigInt(incomeMinor) <= 0n) throw new Error('Enter a percentage from 0 to 100 and a positive income.');
  const basisPoints = BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (basisPoints > 10000n) throw new Error('Enter a percentage from 0 to 100.');
  return ((BigInt(incomeMinor) * basisPoints + 5000n) / 10000n).toString();
}

export function percentFromAmount(amountMinor: string, incomeMinor: string): string {
  if (BigInt(incomeMinor) <= 0n) return '';
  const points = (BigInt(amountMinor) * 10000n + BigInt(incomeMinor) / 2n) / BigInt(incomeMinor);
  return `${points / 100n}.${(points % 100n).toString().padStart(2, '0')}`.replace(/\.?0+$/, '');
}

export function majorInput(minor: string, currency: Currency): string {
  if (currency === 'LBP') return minor;
  const amount = BigInt(minor);
  return `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`.replace(/\.?0+$/, '');
}
