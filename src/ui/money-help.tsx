import { ViewportDisclosure } from './viewport-disclosure.tsx';
import { Info } from 'lucide-react';
import { useI18n } from '../lib/i18n.tsx';
import { useUiCopy } from '../lib/ui-copy.ts';
import { Dialog } from './dialog.tsx';
import { useState } from 'react';
const definitions = {
  ready: ['Ready to assign', 'جاهز للتوزيع', 'Money you have that has no purpose yet.', 'مال تملكه لم يُخصّص لغرض بعد.'],
  setAside: ['Set aside', 'مخصّص', 'Money already given a purpose in your plan.', 'مال خُصّص بالفعل لغرض في خطتك.'],
  cash: ['Cash you hold', 'النقد الذي تملكه', 'Balances in your cash and bank wallets, including any debt balances.', 'أرصدة محافظ النقد والمصرف، بما فيها الأرصدة السالبة.'],
  funded: ['Funded', 'مموّل', 'Money added to an item this month. Opening money and carry-over are separate.', 'مال أُضيف إلى بند هذا الشهر. الأرصدة الافتتاحية والمُرحّلة منفصلة.'],
  spent: ['Spent', 'مصروف', 'Money paid from an item this month.', 'مال صُرف من بند هذا الشهر.'],
  available: ['Available', 'متاح', 'Money left in an item now, including money carried from earlier months.', 'المال الباقي في بند الآن، بما فيه المال المُرحّل من الأشهر السابقة.'],
  expected: ['Expected', 'متوقّع', 'The monthly income used to size your plan. It is not money you already have.', 'الدخل الشهري المستخدم لحجم خطتك. ليس مالًا تملكه بالفعل.'],
  received: ['Received', 'مستلم', 'Income actually received during the selected month.', 'الدخل المستلم فعليًا خلال الشهر المختار.'],
  stillToFund: ['Still to fund', 'متبقٍ للتمويل', 'The part of this month’s plan that has not yet been funded.', 'الجزء من خطة هذا الشهر الذي لم يُموّل بعد.'],
} as const;
export type MoneyTerm = keyof typeof definitions;
export function MoneyHelp({ term }: { readonly term: MoneyTerm }) {
  const { locale } = useI18n();
  const d = definitions[term];
  return <ViewportDisclosure className="cr-term-help" label={locale === 'ar' ? `شرح ${d[1]}` : `Explain ${d[0]}`} summary={<Info size={16} aria-hidden />}><p>{d[locale === 'ar' ? 3 : 2]}</p></ViewportDisclosure>;
}
export function MoneyGlossary() {
  const [open, setOpen] = useState(false);
  const { locale, t } = useI18n();
  const c = useUiCopy();
  return <><button type="button" className="text-button" onClick={() => setOpen(true)}>{c('glossary')}</button>{open ? <Dialog title={c('glossary')} description={c('glossaryIntro')} onClose={() => setOpen(false)}><dl className="cr-glossary">{Object.entries(definitions).map(([key, d]) => <div key={key}><dt>{d[locale === 'ar' ? 1 : 0]}</dt><dd>{d[locale === 'ar' ? 3 : 2]}</dd></div>)}</dl><div className="dialog-actions"><button type="button" className="cr-button cr-button--primary" onClick={() => setOpen(false)}>{t('common.done')}</button></div></Dialog> : null}</>;
}
