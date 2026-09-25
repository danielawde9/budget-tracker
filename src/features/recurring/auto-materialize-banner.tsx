import type { Locale } from '../loans/types.js';
import type { AutoMaterializeState } from './use-auto-materialize.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

export interface AutoMaterializeBannerProps {
  locale: Locale;
  state: AutoMaterializeState;
}

/** The one place "Upcoming bills couldn't be generated" is rendered. Home
 * and the Plan cash section each mount their own `useAutoMaterialize` call
 * (one currency, or all of a space's currencies) and pass its resulting
 * state here, so the markup and bilingual copy can never drift apart the
 * way two hand-written copies of this JSX did before. */
export function AutoMaterializeBanner(props: AutoMaterializeBannerProps) {
  const { locale, state } = props;
  if (state.status !== 'failed') return null;
  return (
    <p className="cr-banner" role="alert">
      {t(locale,
        `Upcoming bills couldn't be generated: ${state.message}`,
        `تعذر توليد الفواتير القادمة: ${state.message}`)}
    </p>
  );
}
