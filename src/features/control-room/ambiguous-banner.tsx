import type { Locale } from '../loans/types.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

export interface AmbiguousBannerProps {
  locale: Locale;
  ambiguous: { requestId: string } | null;
  onRetry(): void;
  onDismiss(): void;
}

export function AmbiguousBanner(props: AmbiguousBannerProps) {
  const { locale, ambiguous } = props;
  if (!ambiguous) return null;
  return (
    <div className="cr-card cr-banner" role="alert">
      <span>
        {t(locale, 'We could not confirm your last change. Check again?', 'تعذّر التأكد من آخر تعديل. هل تريد التحقق مرة أخرى؟')}
      </span>
      <div className="cr-row">
        <button type="button" className="cr-button" onClick={props.onRetry}>
          {t(locale, 'Check again', 'تحقق مرة أخرى')}
        </button>
        <button type="button" className="cr-button" onClick={props.onDismiss}>
          {t(locale, 'Dismiss', 'تجاهل')}
        </button>
      </div>
    </div>
  );
}
