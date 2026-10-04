import { useI18n } from '../lib/i18n.tsx';
/** Additional copy for the focused record flow, kept bilingual. */
export function useRecordCopy() {
  const { locale } = useI18n();
  return (en: string, ar: string) => locale === 'ar' ? ar : en;
}
