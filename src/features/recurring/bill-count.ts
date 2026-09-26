import type { Locale } from '../loans/types.js';

/** A count written the way the app writes numbers elsewhere: `ar-LB` gives
 * Arabic-Indic digits (١٬٠٠٠), the same `Intl.NumberFormat` locale
 * `formatMinorAmount` uses for amounts (final review M4). */
export function formatCount(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-LB' : 'en-US').format(value);
}

/** "N bills" with the number agreement each language needs. Arabic follows
 * `Intl.PluralRules('ar')`: the dual for 2 (فاتورتين, written without a
 * numeral), the plural for 3-10 (فواتير), and the singular for 11 and up
 * (فاتورة). The dual is the accusative/genitive form, which is how every
 * caller uses it (the object of a verb, or after أول). */
export function billCount(count: number, locale: Locale): string {
  if (locale === 'en') return count === 1 ? '1 bill' : `${formatCount(count, 'en')} bills`;
  switch (new Intl.PluralRules('ar').select(count)) {
    case 'one': return 'فاتورة واحدة';
    case 'two': return 'فاتورتين';
    case 'few': return `${formatCount(count, 'ar')} فواتير`;
    default: return `${formatCount(count, 'ar')} فاتورة`;
  }
}
