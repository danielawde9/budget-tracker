import { useI18n } from '../lib/i18n.tsx';
import { GITHUB_URL, PUBLIC_PAGE_IDS, publicLabels, publicPath } from './site.ts';

export function PublicLinks() {
  const { locale } = useI18n();
  return (
    <footer className="cr-public-entry">
      <nav className="cr-public-nav" aria-label={locale === 'ar' ? 'عن التطبيق والمساهمة' : 'About the app and contributions'}>
        {PUBLIC_PAGE_IDS.map(page => <a key={page} href={publicPath(page, locale)}>{publicLabels[page][locale]}</a>)}
        <a href={GITHUB_URL}>GitHub</a>
      </nav>
      <p className="cr-helper">{locale === 'ar' ? 'مفتوح المصدر. ساعدنا في تحسين التطبيق بالكود أو الترجمة أو الملاحظات.' : 'Open source. Help improve the app with code, translations, or feedback.'}</p>
    </footer>
  );
}
