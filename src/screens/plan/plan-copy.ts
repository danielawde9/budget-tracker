import { useI18n } from '../../lib/i18n.tsx';

const copy = {
  en: {
    groups: 'Plan groups', optional: 'Item details and options', groupOptions: 'Group options',
    optionalAmounts: 'Item amounts are optional. Leave zero to keep money in this group’s flexible item.',
    editGroup: 'Edit group', editBill: 'Edit bill', actions: 'Bill actions', breakdown: 'Full money breakdown',
    spent: 'Spent this month', invalid: 'Check the names, amounts and loan choices in each group before saving.',
  },
  ar: {
    groups: 'مجموعات الخطة', optional: 'تفاصيل البند وخياراته', groupOptions: 'خيارات المجموعة',
    optionalAmounts: 'مبالغ البنود اختيارية. اترك صفراً ليبقى المال في البند المرن لهذه المجموعة.',
    editGroup: 'تعديل المجموعة', editBill: 'تعديل الفاتورة', actions: 'خيارات الفاتورة', breakdown: 'تفصيل حركة المال',
    spent: 'المصروف هذا الشهر', invalid: 'راجع الأسماء والمبالغ والقروض في كل مجموعة قبل الحفظ.',
  },
} as const;
export function usePlanCopy() { return copy[useI18n().locale]; }
