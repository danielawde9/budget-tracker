import type { Locale } from '../loans/types.js';
import { localizeRecurringError } from './errors.js';
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
  // The classified error's own copy in the person's language -- never the
  // raw server text (final review I1, M4).
  const reason = localizeRecurringError(state.error, locale).message;
  return (
    <p className="cr-banner" role="alert">
      {t(locale,
        `Upcoming bills couldn't be generated: ${reason}`,
        `تعذر توليد الفواتير القادمة: ${reason}`)}
    </p>
  );
}
