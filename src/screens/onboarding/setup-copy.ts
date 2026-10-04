import type { Locale } from '../../lib/money.ts';

const copy = {
  headline: { en: 'Know what your money is for.', ar: 'اعرف الغرض من مالك.' },
  subtitle: { en: 'Plan in USD. Keep track of USD and LBP together.', ar: 'خطّط بالدولار وتابع الدولار والليرة معًا.' },
  tagline: { en: 'A calmer way to plan your next month.', ar: 'طريقة أهدأ للتخطيط لشهرك المقبل.' },
  currencyHint: { en: 'Your plan is sized in USD. Add LBP wallets next, then assign LBP to your items separately.', ar: 'يُحدَّد حجم خطتك بالدولار. أضف محافظ الليرة في الخطوة التالية ثم وزّع الليرة على بنودك بشكل منفصل.' },
  saveWallet: { en: 'Save wallet and continue', ar: 'حفظ المحفظة والمتابعة' },
  optional: { en: 'Optional. You can do this later. This gives opening money a purpose; it does not count as income.', ar: 'اختياري. يمكنك القيام به لاحقًا. يعطي المال الافتتاحي غرضًا ولا يُحتسب دخلًا.' },
  groups: { en: 'Assignment groups', ar: 'مجموعات التوزيع' },
  available: { en: 'Available', ar: 'المتاح' },
  assigning: { en: 'Assigning', ar: 'قيد التوزيع' },
  left: { en: 'Left', ar: 'المتبقي' },
  skip: { en: 'Skip for now', ar: 'تخطّ الآن' },
  finish: { en: 'Assign and finish', ar: 'توزيع وإنهاء' },
  sample: { en: 'Try it with sample data', ar: 'جرّبه ببيانات تجريبية' },
  sampleIntro: { en: 'Local preview only. Explore a new plan or see a fuller example.', ar: 'معاينة محلية فقط. استكشف خطة جديدة أو مثالًا أكثر اكتمالًا.' },
  showPassword: { en: 'Show password', ar: 'إظهار كلمة المرور' },
  hidePassword: { en: 'Hide password', ar: 'إخفاء كلمة المرور' },
  passwordHint: { en: 'At least 8 characters', ar: '٨ أحرف على الأقل' },
} as const;

export function setupCopy(locale: Locale, key: keyof typeof copy): string {
  return copy[key][locale];
}
