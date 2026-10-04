import { useI18n } from './i18n.tsx';
const copy = {
  nextStep: ['Your next step', 'خطوتك التالية'],
  givePurpose: ['Give your money a purpose', 'امنح مالك غرضًا'],
  readyBody: ['Money you have, waiting to be put into your plan.', 'مال تملكه ينتظر توزيعه على خطتك.'],
  fund: ['Fund my plan', 'موّل خطتي'],
  viewPlan: ['View this month’s plan', 'عرض خطة هذا الشهر'],
  funded: ['Your money has a purpose', 'لمالك غرض الآن'],
  fundedBody: ['Your money is assigned. Open your plan to see what each item holds.', 'وُزّع مالك. افتح خطتك لمعرفة ما يحتويه كل بند.'],
  breakdown: ['Money breakdown', 'تفاصيل المال'],
  wallets: ['Your wallets', 'محافظك'],
  planDetails: ['Plan details', 'تفاصيل الخطة'],
  accountActions: ['Account actions', 'إجراءات الحساب'],
  search: ['Search loaded activity', 'البحث في النشاط المحمّل'],
  noSearch: ['No loaded records match. Load more to search older activity.', 'لا قيود محمّلة تطابق البحث. حمّل المزيد للبحث في النشاط الأقدم.'],
  moreFilters: ['More filters', 'فلاتر إضافية'],
  allTypes: ['All loaded types', 'كل الأنواع المحمّلة'],
  tourIntro: ['New here? See how your money works.', 'جديد هنا؟ تعرّف على طريقة عمل مالك.'],
  startTour: ['Start the tour', 'ابدأ الجولة'],
  restartTour: ['Restart guided tour', 'أعد الجولة الإرشادية'],
  skipTour: ['Skip tour', 'تخطَّ الجولة'],
  tourProgress: ['Guided tour', 'الجولة الإرشادية'],
  tourDone: ['Finish tour', 'إنهاء الجولة'],
  glossary: ['Money glossary', 'قاموس المال'],
  glossaryIntro: ['What these numbers mean', 'ما تعنيه هذه الأرقام'],
  help: ['Help', 'المساعدة'],
  referenceHelp: ['For combined views only. Wallet balances stay in their own currencies.', 'للعرض المجمّع فقط. تبقى أرصدة المحافظ بعملاتها.'],
} as const;
export function useUiCopy() {
  const { locale } = useI18n();
  return (key: keyof typeof copy): string => copy[key][locale === 'ar' ? 1 : 0];
}
