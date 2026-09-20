import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import { chartPercent } from './chart-ratio.js';
import type { AvailableCashSummary } from './types.js';
import type { CashReadSlice } from './use-cash-control.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

/** The zero-baseline bar for the signed `available` figure. On the
 * nonnegative side it shows spendable-of-cash coverage; on the negative
 * side it shows the deficit as a fraction of total reservations
 * (`cash + deficit`, i.e. what reservations would need cash to equal for
 * `available` to reach zero). Sign always comes from the original BigInt
 * `availableMinor`, never the clamped `chartPercent` coordinate -- this is
 * this feature's one "negative values: zero baseline + inverse segment"
 * case (see `decisions.md` for why the other two Task-3 bars each cover a
 * different one of the three required bar behaviours instead of every
 * component repeating all of them). */
function availableRatio(cashMinor: string, availableMinor: string, deficitMinor: string): { negative: boolean; hasScale: boolean; percent: number } {
  const available = BigInt(availableMinor);
  if (available >= 0n) {
    const hasScale = BigInt(cashMinor) > 0n;
    return { negative: false, hasScale, percent: hasScale ? chartPercent(availableMinor, cashMinor) : 0 };
  }
  const totalReservations = (BigInt(cashMinor) + BigInt(deficitMinor)).toString();
  const hasScale = BigInt(totalReservations) > 0n;
  return { negative: true, hasScale, percent: hasScale ? chartPercent(deficitMinor, totalReservations) : 0 };
}

interface ReservationLine {
  readonly label: { en: string; ar: string };
  readonly amountMinor: string | null;
}

function reservationLines(data: AvailableCashSummary): readonly ReservationLine[] {
  return [
    { label: { en: 'Reserved goal claims', ar: 'حجوزات الأهداف' }, amountMinor: data.goalClaimsMinor },
    { label: { en: 'Unpaid bills (net of goal cover)', ar: 'الفواتير غير المدفوعة (بعد تغطية الهدف)' }, amountMinor: data.expenseCommitmentsMinor },
    { label: { en: 'Debt commitments', ar: 'التزامات الديون' }, amountMinor: data.debtCommitmentsMinor },
    { label: { en: 'Goal monthly top-ups', ar: 'إضافات الأهداف الشهرية' }, amountMinor: data.goalTopupsMinor },
    { label: { en: 'Future-purpose headroom', ar: 'هامش الغرض المستقبلي' }, amountMinor: data.futureHeadroomMinor },
  ];
}

interface CashControlSummaryProps {
  locale: Locale;
  currency: Currency;
  available: CashReadSlice<AvailableCashSummary>;
  variant: 'compact' | 'full';
}

/** "Available after commitments": the signed available amount, the
 * zero-floored spendable figure and the shortfall/deficit as three
 * distinct, separately labelled values -- never merged, and actual cash
 * (`cashMinor`) is never combined with any forecasted/expected figure into
 * one balance (the forecast lives in `CashOutlookChart`, a visibly separate
 * "Expected outlook" section). The daily extra guide is labelled exactly
 * "Extra unassigned cash per day" and only ever rendered when the gateway
 * reports `state === 'ready'` -- an `unplanned`/`incomplete` state never
 * gets a fabricated positive allowance. */
export function CashControlSummary({ locale, currency, available, variant }: CashControlSummaryProps) {
  const compact = variant === 'compact';

  if (available.status === 'loading') {
    return (
      <div className="cc-skeleton-rows" aria-hidden="true">
        <span className="cr-skeleton cr-skeleton--line-short" />
        <span className="cr-skeleton cr-skeleton--hero" />
      </div>
    );
  }

  if (available.status === 'error') {
    return compact ? (
      <p className="cc-compact-note">
        {t(locale, 'Available after commitments could not be loaded.', 'تعذر تحميل السيولة المتاحة بعد الالتزامات.')}{' '}
        <button type="button" className="cc-inline-link" aria-label={t(locale, 'Retry available cash', 'إعادة محاولة السيولة المتاحة')} onClick={available.refresh}>
          {t(locale, 'Retry', 'إعادة المحاولة')}
        </button>
      </p>
    ) : (
      <div className="cr-card" role="alert">
        <p>{available.error?.message}</p>
        <p><small>{available.error?.recovery}</small></p>
        <button type="button" className="cr-button" onClick={available.refresh}>{t(locale, 'Retry', 'إعادة المحاولة')}</button>
      </div>
    );
  }

  const data = available.data;

  if (data.state === 'unplanned') {
    return compact
      ? <p className="cc-compact-note">{t(locale, 'No published plan yet for this currency.', 'لا توجد خطة منشورة بعد لهذه العملة.')}</p>
      : <p className="cc-label-muted">{t(locale, 'No published plan snapshot yet -- publish this month’s plan to see what is available after commitments.', 'لا يوجد لقطة خطة منشورة بعد — انشر خطة هذا الشهر لرؤية المتاح بعد الالتزامات.')}</p>;
  }

  if (data.state === 'incomplete') {
    return compact
      ? <p className="cc-compact-note">{t(locale, 'This figure needs a refresh before it can be shown.', 'يحتاج هذا الرقم إلى تحديث قبل عرضه.')}</p>
      : <div className="cc-label-muted">
        <p>{t(locale, 'Some occurrences need materializing (or the overdue backlog is too large) before this figure can be trusted.', 'تحتاج بعض الدفعات إلى التوليد (أو أن التراكم المتأخر كبير جدًا) قبل الوثوق بهذا الرقم.')}</p>
        {data.unmaterializedCount > 0 && <p>{t(locale, 'Unmaterialized occurrences', 'دفعات غير مولَّدة')}: {data.unmaterializedCount}</p>}
      </div>;
  }

  // state === 'ready': availableMinor/spendableMinor/deficitMinor/
  // dailyExtraGuideMinor are guaranteed non-null by the DTO's own contract.
  const availableMinor = data.availableMinor as string;
  const spendableMinor = data.spendableMinor as string;
  const deficitMinor = data.deficitMinor as string;
  const negative = BigInt(availableMinor) < 0n;
  const ratio = availableRatio(data.cashMinor, availableMinor, deficitMinor);

  if (compact) {
    return (
      <div className="cc-compact">
        {data.needsReview && <p className="cc-badge cc-badge-review">{t(locale, 'Needs review', 'يحتاج مراجعة')}</p>}
        <p className="cc-compact-figure">
          <span className="cc-label">{t(locale, 'Available after commitments', 'المتاح بعد الالتزامات')}</span>
          <bdi className={negative ? 'cc-danger-text' : undefined}>{formatMinorAmount(availableMinor, currency, locale)}</bdi>
        </p>
        {negative && (
          <p className="cc-compact-note cc-danger-text">
            {t(locale, 'Shortfall', 'العجز')}: <bdi>{formatMinorAmount(deficitMinor, currency, locale)}</bdi>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="cc-summary">
      <p className="cr-helper">
        {t(locale, 'Cash left after everything you have already committed to this month — bills, goals, and debt.', 'السيولة المتبقية بعد كل ما التزمت به هذا الشهر — الفواتير والأهداف والديون.')}
      </p>
      {data.needsReview && (
        <p className="cc-badge cc-badge-review" role="status">
          {t(locale, 'A category, bill or goal changed since this plan snapshot was published -- figures may be stale.', 'تغيّرت فئة أو فاتورة أو هدف منذ نشر لقطة هذه الخطة — قد تكون الأرقام قديمة.')}
        </p>
      )}

      <dl className="cc-metrics">
        <div className="cc-metric">
          <dt>{t(locale, 'Actual cash', 'السيولة الفعلية')}</dt>
          <dd><bdi>{formatMinorAmount(data.cashMinor, currency, locale)}</bdi></dd>
        </div>
        <div className="cc-metric cc-metric--hero">
          <dt>{t(locale, 'Available after commitments', 'المتاح بعد الالتزامات')}</dt>
          <dd><bdi className={negative ? 'cc-danger-text' : undefined}>{formatMinorAmount(availableMinor, currency, locale)}</bdi></dd>
        </div>
        <div className="cc-metric">
          <dt>{t(locale, 'Spendable now', 'المتاح للإنفاق الآن')}</dt>
          <dd><bdi>{formatMinorAmount(spendableMinor, currency, locale)}</bdi></dd>
        </div>
        <div className="cc-metric">
          <dt>{t(locale, 'Shortfall', 'العجز')}</dt>
          <dd><bdi className={BigInt(deficitMinor) > 0n ? 'cc-danger-text' : undefined}>{formatMinorAmount(deficitMinor, currency, locale)}</bdi></dd>
        </div>
      </dl>

      {/* The `dl` above already states every exact value visibly (not just
          for assistive tech) next to this bar, so it stands in as this
          bar's own "table equivalent" -- a second, hidden table repeating
          the same four amounts would only invite the two copies to drift or
          to double-match text queries. */}
      {ratio.hasScale && (
        <div className="cc-signed-bar cc-signed-bar--summary" aria-hidden="true">
          <span className="cc-signed-bar-negative"><span style={{ inlineSize: ratio.negative ? `${ratio.percent}%` : '0%' }} /></span>
          <span className="cc-signed-bar-zero" />
          <span className="cc-signed-bar-positive"><span style={{ inlineSize: ratio.negative ? '0%' : `${ratio.percent}%` }} /></span>
        </div>
      )}

      <h4 className="cc-subheading">{t(locale, 'Reservation breakdown', 'تفصيل الحجوزات')}</h4>
      <ul className="cc-reservation-list">
        {reservationLines(data).map((line) => (
          <li key={line.label.en}>
            <span className="cc-label">{t(locale, line.label.en, line.label.ar)}</span>
            <span>{line.amountMinor === null
              ? t(locale, 'Not applicable', 'لا ينطبق')
              : <bdi>{formatMinorAmount(line.amountMinor, currency, locale)}</bdi>}
            </span>
          </li>
        ))}
      </ul>

      {data.dailyExtraGuideMinor !== null && (
        <p className="cc-guide">
          <span className="cc-label">{t(locale, 'Extra unassigned cash per day', 'السيولة الإضافية غير المخصَّصة يوميًا')}</span>
          <bdi>{formatMinorAmount(data.dailyExtraGuideMinor, currency, locale)}</bdi>
          <small className="cc-label-muted">
            {' '}{t(locale, `over ${data.daysRemaining} remaining day(s) this month`, `على مدى ${data.daysRemaining} يوم/أيام متبقية هذا الشهر`)}
          </small>
        </p>
      )}
      <p className="cc-label-muted">
        {t(locale, 'Category budgets are already reserved above -- this is not your whole daily groceries/transport allowance.',
          'ميزانيات الفئات محجوزة أعلاه بالفعل — هذا ليس كامل بدل البقالة/المواصلات اليومي.')}
      </p>

      {BigInt(data.uncategorizedMinor) !== 0n && (
        <p className="cc-label-muted">
          {t(locale, 'Uncategorized spending', 'إنفاق غير مصنّف')}: <bdi>{formatMinorAmount(data.uncategorizedMinor, currency, locale)}</bdi>
        </p>
      )}

      {/* A separate "this month" strip -- deliberately never folded into the
          Available/Spendable/Shortfall figures above. `receivedIncomeMinor`
          is income already posted this month, never a forecast or an
          unconfirmed/unscheduled amount; `availableMinor` is derived only
          from actual cash movements through today (see
          `17-available-cash-db.md`), so an unconfirmed salary that has not
          been recorded can never raise it -- it simply never appears here
          until it is actually received. */}
      <h4 className="cc-subheading">{t(locale, 'This month so far', 'هذا الشهر حتى الآن')}</h4>
      <dl className="cc-metrics cc-metrics--secondary">
        <div className="cc-metric">
          <dt>{t(locale, 'Income received', 'الدخل المستلم')}</dt>
          <dd><bdi>{formatMinorAmount(data.receivedIncomeMinor, currency, locale)}</bdi></dd>
        </div>
        <div className="cc-metric">
          <dt>{t(locale, 'Ordinary spending', 'الإنفاق الاعتيادي')}</dt>
          <dd><bdi>{formatMinorAmount(data.ordinarySpendingMinor, currency, locale)}</bdi></dd>
        </div>
        <div className="cc-metric">
          <dt>{t(locale, 'Income minus spending', 'الدخل ناقص الإنفاق')}</dt>
          <dd><bdi>{formatMinorAmount(data.incomeMinusSpendingMinor, currency, locale)}</bdi></dd>
        </div>
      </dl>
    </div>
  );
}
