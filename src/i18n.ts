import type { Locale } from './features/loans/types.js';

const copy = {
  en: {
    loans: 'Loans', subtitle: 'See what is still owed, what is due, and what this month already covers.',
    arabic: 'العربية', english: 'English', space: 'Space', month: 'Month', addLoan: 'Add loan',
    personal: 'Personal space', household: 'Household space', theyOwe: 'They owe me', iOwe: 'I owe them',
    outstanding: 'Outstanding', settled: 'Settled', overdue: 'Overdue', remaining: 'Remaining', due: 'Due amount',
    owedToMe: 'Owed to me', iOweTotal: 'I owe', target: 'Monthly target', paid: 'Paid this month',
    reserved: 'Still reserved', expected: 'Expected collection', noLoans: 'No loans in this group.',
    tryAgain: 'Try again',
  },
  ar: {
    loans: 'القروض', subtitle: 'اعرف ما بقي، وما استحق، وما تم دفعه ضمن خطة هذا الشهر.',
    arabic: 'العربية', english: 'English', space: 'المساحة', month: 'الشهر', addLoan: 'إضافة قرض',
    personal: 'مساحة شخصية', household: 'مساحة منزلية', theyOwe: 'لديهم دين لي', iOwe: 'عليّ دين لهم',
    outstanding: 'قائم', settled: 'مسدّد', overdue: 'متأخر', remaining: 'المتبقي', due: 'المبلغ المستحق',
    owedToMe: 'مستحق لي', iOweTotal: 'مستحق عليّ', target: 'هدف الشهر', paid: 'المدفوع هذا الشهر',
    reserved: 'المحجوز المتبقي', expected: 'تحصيل متوقع', noLoans: 'لا توجد قروض في هذه المجموعة.',
    tryAgain: 'المحاولة مجددًا',
  },
} as const;

export type CopyKey = keyof typeof copy.en;

export function translate(locale: Locale, key: CopyKey): string {
  return copy[locale][key];
}
