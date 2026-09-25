import type { Locale } from '../loans/types.js';
import type { AutoSettleOutcome } from './auto-settle.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

export interface SettleNoticeBannerProps {
  locale: Locale;
  outcome: AutoSettleOutcome | null;
  onDismiss(): void;
}

function noticeBody(outcome: Exclude<AutoSettleOutcome, { status: 'none' }>, locale: Locale) {
  switch (outcome.status) {
    case 'settled': {
      const name = locale === 'ar' ? (outcome.nameAr ?? outcome.nameEn) : (outcome.nameEn ?? outcome.nameAr);
      return locale === 'ar'
        ? <>تم تعليم «<bdi>{name}</bdi>» كمدفوعة.</>
        : <>Marked "<bdi>{name}</bdi>" as paid.</>;
    }
    case 'ambiguous':
      return t(locale,
        `This payment matches ${outcome.scheduleCount} bills — open Upcoming bills to choose.`,
        `تطابق هذه الدفعة ${outcome.scheduleCount} فواتير — افتح الفواتير القادمة للاختيار.`);
    case 'failed':
      return t(locale,
        `Couldn't mark the bill as paid: ${outcome.message}`,
        `تعذر تعليم الفاتورة كمدفوعة: ${outcome.message}`);
    case 'partial': {
      const name = locale === 'ar' ? (outcome.nameAr ?? outcome.nameEn) : (outcome.nameEn ?? outcome.nameAr);
      return locale === 'ar'
        ? <>تم تعليم «<bdi>{name}</bdi>» كمدفوعة، لكن تعذّر ربط باقي هذه الدفعة: {outcome.message}</>
        : <>Marked "<bdi>{name}</bdi>" as paid, but the rest of this repayment couldn't be linked: {outcome.message}</>;
    }
  }
}

/** The one place the result of auto-settling a recorded expense or income
 * against an upcoming bill is shown. `ControlRoomRoutes` keeps the latest
 * `AutoSettleOutcome` from `autoSettleRecordedEvent` in state and renders
 * this once, above whichever destination is active, so a match, an
 * ambiguous look-alike bill, or a failed link is never silent (D3, D7) --
 * mirrors `AutoMaterializeBanner`'s one-place-only pattern. */
export function SettleNoticeBanner(props: SettleNoticeBannerProps) {
  const { locale, outcome } = props;
  if (!outcome || outcome.status === 'none') return null;
  return (
    <p className="cr-banner" role="status">
      <span>{noticeBody(outcome, locale)}</span>
      <button type="button" className="cr-button cr-button--sm cr-banner-dismiss" onClick={props.onDismiss}>
        {t(locale, 'Dismiss', 'تجاهل')}
      </button>
    </p>
  );
}
