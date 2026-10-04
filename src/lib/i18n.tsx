import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { screenMessages } from './messages-screens.ts';
import { formatMoney, type Currency, type Locale } from './money.ts';

/**
 * Every user-visible string, in English and Arabic, in one typed table.
 * `{name}` placeholders are filled by `t(key, { name })`.
 */
export const messages = {
  // Navigation and shell
  'app.name': { en: 'openbudgetracker.app', ar: 'openbudgetracker.app' },
  'nav.home': { en: 'Home', ar: 'الرئيسية' },
  'nav.plan': { en: 'Plan', ar: 'الخطة' },
  'nav.activity': { en: 'Activity', ar: 'النشاط' },
  'nav.accounts': { en: 'Accounts', ar: 'الحسابات' },
  'nav.settings': { en: 'Settings', ar: 'الإعدادات' },
  'nav.record': { en: 'Record', ar: 'تسجيل' },
  'nav.main': { en: 'Main', ar: 'التنقل الرئيسي' },
  'shell.language': { en: 'العربية', ar: 'English' },
  'shell.languageLabel': { en: 'Switch to Arabic', ar: 'التبديل إلى الإنجليزية' },
  'shell.space': { en: 'Space', ar: 'المساحة' },

  // Common actions and states
  'common.cancel': { en: 'Cancel', ar: 'إلغاء' },
  'common.close': { en: 'Close', ar: 'إغلاق' },
  'common.save': { en: 'Save', ar: 'حفظ' },
  'common.saving': { en: 'Saving…', ar: 'جارٍ الحفظ…' },
  'common.loading': { en: 'Loading…', ar: 'جارٍ التحميل…' },
  'common.retry': { en: 'Try again', ar: 'أعد المحاولة' },
  'common.back': { en: 'Back', ar: 'رجوع' },
  'common.next': { en: 'Next', ar: 'التالي' },
  'common.done': { en: 'Done', ar: 'تم' },
  'common.amount': { en: 'Amount', ar: 'المبلغ' },
  'common.date': { en: 'Date', ar: 'التاريخ' },
  'common.note': { en: 'Note (optional)', ar: 'ملاحظة (اختيارية)' },
  'common.wallet': { en: 'Wallet', ar: 'المحفظة' },
  'common.item': { en: 'Plan item', ar: 'بند الخطة' },
  'common.currency': { en: 'Currency', ar: 'العملة' },
  'common.name': { en: 'Name', ar: 'الاسم' },
  'common.readyToAssign': { en: 'Ready to assign', ar: 'جاهز للتوزيع' },
  'common.approx': { en: '≈ {amount} at {rate} LBP per USD', ar: '≈ {amount} بسعر {rate} ليرة للدولار' },
  'common.loadFailed': { en: 'This could not be loaded.', ar: 'تعذّر التحميل.' },
  'common.none': { en: 'None', ar: 'لا شيء' },
  'common.saved': { en: 'Saved.', ar: 'تم الحفظ.' },
  'common.recorded': { en: 'Recorded.', ar: 'تم التسجيل.' },

  // Plan
  'plan.flexGets': { en: '{name} gets {amount}', ar: '{name} يحصل على {amount}' },

  // Errors (codes come from the database)
  'error.UNKNOWN': { en: 'Something went wrong. Nothing was saved. Try again.', ar: 'حدث خطأ. لم يُحفظ شيء. أعد المحاولة.' },
  'error.NETWORK': { en: 'The server could not be reached, so this may or may not have been saved. Try again from this same form: it will not be recorded twice.', ar: 'تعذّر الوصول إلى الخادم، لذا قد يكون هذا قد حُفظ أو لا. أعد المحاولة من النموذج نفسه: لن يُسجَّل مرتين.' },
  'error.BAD_RESPONSE': { en: 'The server sent an unexpected answer.', ar: 'أرسل الخادم ردًا غير متوقع.' },
  'error.BUDGET_NOT_MEMBER': { en: 'You no longer have access to this space.', ar: 'لم يعد لديك وصول إلى هذه المساحة.' },
  'error.BUDGET_NOT_AUTHENTICATED': { en: 'Please sign in again.', ar: 'يرجى تسجيل الدخول مجددًا.' },
  'error.BUDGET_REQUEST_REQUIRED': { en: 'This form expired. Open it again.', ar: 'انتهت صلاحية النموذج. افتحه من جديد.' },
  'error.BUDGET_REQUEST_CONFLICT': { en: 'This form was already submitted with different details. Open it again.', ar: 'أُرسل هذا النموذج سابقًا بتفاصيل مختلفة. افتحه من جديد.' },
  'error.BUDGET_INVALID_AMOUNT': { en: 'Enter a valid amount.', ar: 'أدخل مبلغًا صحيحًا.' },
  'error.BUDGET_INVALID_DATE': { en: 'Enter a valid date.', ar: 'أدخل تاريخًا صحيحًا.' },
  'error.BUDGET_FUTURE_DATE': { en: 'Money records can’t be dated in the future. Use Bills for what is coming.', ar: 'لا يمكن تأريخ القيود المالية في المستقبل. استخدم الفواتير لما هو قادم.' },
  'error.BUDGET_INVALID_NAME': { en: 'Enter a name.', ar: 'أدخل اسمًا.' },
  'error.BUDGET_TEXT_TOO_LONG': { en: 'That text is too long.', ar: 'هذا النص طويل جدًا.' },
  'error.BUDGET_WALLET_NOT_FOUND': { en: 'That wallet no longer exists.', ar: 'هذه المحفظة لم تعد موجودة.' },
  'error.BUDGET_WALLET_KIND': { en: 'That wallet can’t be used for this.', ar: 'لا يمكن استخدام هذه المحفظة لهذا الغرض.' },
  'error.BUDGET_CURRENCY_MISMATCH': { en: 'Both sides must use the same currency. Use Exchange to convert.', ar: 'يجب أن يستخدم الطرفان العملة نفسها. استخدم التصريف للتحويل.' },
  'error.BUDGET_ITEM_NOT_FOUND': { en: 'That plan item no longer exists.', ar: 'بند الخطة هذا لم يعد موجودًا.' },
  'error.BUDGET_ITEM_REQUIRED': { en: 'Choose what this money was for.', ar: 'اختر الغرض من هذا المال.' },
  'error.BUDGET_INSUFFICIENT_ITEM': { en: '{name} only holds {available}.', ar: '{name} يحتوي على {available} فقط.' },
  'error.BUDGET_INSUFFICIENT_READY': { en: 'Ready to assign only holds {available}.', ar: 'الجاهز للتوزيع يحتوي على {available} فقط.' },
  'error.BUDGET_COVER_INVALID': { en: 'Choose a different item to cover the difference.', ar: 'اختر بندًا آخر لتغطية الفرق.' },
  'error.BUDGET_TRANSFER_INVALID': { en: 'Transfers move money between two of your wallets in the same currency.', ar: 'التحويل ينقل المال بين محفظتين لك بالعملة نفسها.' },
  'error.BUDGET_EXCHANGE_INVALID': { en: 'Exchange converts between two wallets in different currencies.', ar: 'التصريف يحوّل بين محفظتين بعملتين مختلفتين.' },
  'error.BUDGET_OVERPAY': { en: 'That is more principal than is owed ({owed}).', ar: 'هذا أكثر من الأصل المستحق ({owed}).' },
  'error.BUDGET_NO_CHANGE': { en: 'The value is unchanged.', ar: 'القيمة لم تتغير.' },
  'error.BUDGET_ENTRY_NOT_FOUND': { en: 'That record no longer exists.', ar: 'هذا القيد لم يعد موجودًا.' },
  'error.BUDGET_ALREADY_REVERSED': { en: 'This record was already corrected.', ar: 'تم تصحيح هذا القيد سابقًا.' },
  'error.BUDGET_CANNOT_REVERSE': { en: 'A correction can’t be corrected again. Record a new entry instead.', ar: 'لا يمكن تصحيح التصحيح. سجّل قيدًا جديدًا بدلًا من ذلك.' },
  'error.BUDGET_ARCHIVED': { en: 'Something in this record is archived.', ar: 'جزء من هذا القيد مؤرشف.' },
  'error.BUDGET_ARCHIVE_NONZERO': { en: 'Move its money out before archiving it.', ar: 'انقل ماله أولًا قبل الأرشفة.' },
  'error.BUDGET_ITEM_HAS_BILLS': { en: 'Remove its bills before archiving it.', ar: 'احذف فواتيره قبل أرشفته.' },
  'error.BUDGET_BILL_NOT_FOUND': { en: 'That bill no longer exists.', ar: 'هذه الفاتورة لم تعد موجودة.' },
  'error.BUDGET_BILL_NOT_DUE': { en: 'That bill is not due on that date.', ar: 'هذه الفاتورة غير مستحقة في هذا التاريخ.' },
  'error.BUDGET_BILL_SKIPPED': { en: 'That bill was skipped for this date.', ar: 'تم تخطي هذه الفاتورة لهذا التاريخ.' },
  'error.BUDGET_BILL_ALREADY_PAID': { en: 'That bill is already paid for this date.', ar: 'هذه الفاتورة مدفوعة لهذا التاريخ.' },
  'error.BUDGET_BILL_MISMATCH': { en: 'Pay this bill from its own item, wallet currency and loan.', ar: 'ادفع هذه الفاتورة من بندها وبعملة محفظتها وقرضها.' },
  'error.BUDGET_INVALID_BILL': { en: 'Check the bill’s details.', ar: 'تحقق من تفاصيل الفاتورة.' },
  'error.BUDGET_INVALID_ACTION': { en: 'That action is not available.', ar: 'هذا الإجراء غير متاح.' },
  'error.BUDGET_INVALID_MOVES': { en: 'Check the amounts to move.', ar: 'تحقق من المبالغ المراد نقلها.' },
  'error.BUDGET_STALE_PLAN': { en: 'The plan changed since you opened it. Reload and edit again.', ar: 'تغيّرت الخطة منذ فتحها. أعد التحميل ثم عدّل من جديد.' },
  'error.BUDGET_INVALID_PLAN': { en: 'Check the plan: every group and item needs a name and a valid amount.', ar: 'تحقق من الخطة: كل مجموعة وبند يحتاج اسمًا ومبلغًا صحيحًا.' },
  'error.BUDGET_PLAN_OVER_100': { en: 'Group percentages can’t add up to more than 100%.', ar: 'لا يمكن أن يتجاوز مجموع نسب المجموعات ١٠٠٪.' },
  'error.BUDGET_INVALID_PERCENT': { en: 'Enter a percentage between 0 and 100.', ar: 'أدخل نسبة بين ٠ و١٠٠.' },
  'error.BUDGET_INVALID_RATE': { en: 'Enter a positive rate dated today or earlier.', ar: 'أدخل سعرًا موجبًا بتاريخ اليوم أو قبله.' },
  'error.BUDGET_INVALID_TIMEZONE': { en: 'Choose a valid timezone.', ar: 'اختر منطقة زمنية صحيحة.' },
  'error.BUDGET_INVALID_RANGE': { en: 'That date range is too long.', ar: 'نطاق التواريخ هذا طويل جدًا.' },
  'error.BUDGET_INVALID_FILTER': { en: 'Those filters can’t be used together.', ar: 'لا يمكن استخدام هذه المرشحات معًا.' },
  'error.BUDGET_WALLET_BOUNDS': { en: 'That would take a loan past zero on some day. A loan you owe can’t go above zero, and money owed to you can’t go below it.', ar: 'هذا سيجعل رصيد القرض يتجاوز الصفر في أحد الأيام. القرض الذي عليك لا يتجاوز الصفر، والمال المستحق لك لا ينزل تحته.' },
  'error.BUDGET_BILL_NOT_SKIPPED': { en: 'That bill was not skipped for that date.', ar: 'لم يتم تخطي هذه الفاتورة في ذلك التاريخ.' },
  'error.BUDGET_NOT_FOUND': { en: 'This space no longer exists.', ar: 'هذه المساحة لم تعد موجودة.' },
  ...screenMessages,
} as const satisfies Record<string, { readonly en: string; readonly ar: string }>;

export type MessageKey = keyof typeof messages;
export type Vars = Readonly<Record<string, string | number>>;

export function translate(locale: Locale, key: MessageKey, vars: Vars = {}): string {
  const template: string = messages[key][locale];
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(messages, key);
}

const dateFormats = {
  day: { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' },
  weekday: { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' },
  month: { year: 'numeric', month: 'long', timeZone: 'UTC' },
  short: { month: 'short', day: 'numeric', timeZone: 'UTC' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DateStyle = keyof typeof dateFormats;

/** Calendar dates ('YYYY-MM-DD') never shift with the browser timezone. */
export function formatDate(locale: Locale, isoDate: string, style: DateStyle = 'day'): string {
  const intlLocale = locale === 'ar' ? 'ar-LB' : 'en-US';
  return new Intl.DateTimeFormat(intlLocale, dateFormats[style]).format(new Date(`${isoDate.slice(0, 10)}T12:00:00Z`));
}

export interface I18n {
  readonly locale: Locale;
  readonly dir: 'ltr' | 'rtl';
  t(key: MessageKey, vars?: Vars): string;
  money(minor: bigint, currency: Currency, options?: { sign?: boolean }): string;
  date(isoDate: string, style?: DateStyle): string;
  /** A bilingual name stored as two columns; falls back to the other language. */
  name(value: { readonly nameEn: string | null; readonly nameAr: string | null }): string;
  /** Digits in the reader's script (percentages, counts). */
  digits(value: string): string;
}

function createI18n(locale: Locale): I18n {
  return {
    locale,
    dir: locale === 'ar' ? 'rtl' : 'ltr',
    t: (key, vars) => translate(locale, key, vars),
    money: (minor, currency, options) => formatMoney(minor, currency, locale, options),
    date: (isoDate, style) => formatDate(locale, isoDate, style),
    name: (value) => (locale === 'ar' ? (value.nameAr ?? value.nameEn) : (value.nameEn ?? value.nameAr)) ?? '',
    digits: (value) => (locale === 'ar' ? value.replace(/\d/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)] ?? digit).replace('.', '٫') : value),
  };
}

const I18nContext = createContext<I18n>(createI18n('en'));

export function I18nProvider({ locale, children }: { readonly locale: Locale; readonly children: ReactNode }) {
  const value = useMemo(() => createI18n(locale), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}
