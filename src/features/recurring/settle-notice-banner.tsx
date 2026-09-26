import type { Locale } from '../loans/types.js';
import type { AutoSettleOutcome } from './auto-settle.js';
import { billCount } from './bill-count.js';
import { localizeRecurringError } from './errors.js';

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
      if (outcome.remainsDue) {
        // A repayment smaller than its instalment is linked, not "paid" (M3).
        return locale === 'ar'
          ? <>تم ربط هذه الدفعة بـ«<bdi>{name}</bdi>»، ولا يزال جزء من القسط مستحقًا.</>
          : <>Linked this repayment to "<bdi>{name}</bdi>" — part of it is still due.</>;
      }
      return locale === 'ar'
        ? <>تم تعليم «<bdi>{name}</bdi>» كمدفوعة.</>
        : <>Marked "<bdi>{name}</bdi>" as paid.</>;
    }
    case 'ambiguous':
      if (outcome.reason === 'truncated') {
        // The candidate list was cut off at the pager's cap, so no count of
        // look-alikes exists to report (final review M2).
        return t(locale,
          "There are too many bills to check them all, so this payment wasn't linked to any of them.",
          'عدد الفواتير كبير جدًا بحيث يتعذر التحقق منها كلها، لذا لم تُربط هذه الدفعة بأي منها.');
      }
      // States what happened and stops there: no screen can link an existing
      // expense (D4), and "Review payment" would record it a second time --
      // so the notice must not send anyone there (final review, declined #2).
      // Arabic agrees with the count, dual pronoun included (M4).
      return t(locale,
        `This payment matches ${billCount(outcome.scheduleCount, 'en')}, so it wasn't linked to any of them.`,
        `تطابق هذه الدفعة ${billCount(outcome.scheduleCount, 'ar')}، لذا لم تُربط ${outcome.scheduleCount === 2 ? 'بأيٍّ منهما' : 'بأيٍّ منها'}.`);
    case 'failed': {
      // The classified error's own copy in the person's language -- never
      // the raw server text (final review I1, M4).
      const reason = localizeRecurringError(outcome.error, locale).message;
      return t(locale,
        `Couldn't mark the bill as paid: ${reason}`,
        `تعذر تعليم الفاتورة كمدفوعة: ${reason}`);
    }
    case 'partial': {
      const name = locale === 'ar' ? (outcome.nameAr ?? outcome.nameEn) : (outcome.nameEn ?? outcome.nameAr);
      const reason = localizeRecurringError(outcome.error, locale).message;
      return locale === 'ar'
        ? <>تم تعليم «<bdi>{name}</bdi>» كمدفوعة، لكن تعذّر ربط باقي هذه الدفعة: {reason}</>
        : <>Marked "<bdi>{name}</bdi>" as paid, but the rest of this repayment couldn't be linked: {reason}</>;
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
