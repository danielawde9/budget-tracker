import { useEffect, useState } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import { ConfirmPaymentDialog } from './confirm-payment-dialog.js';
import { classifyRecurringError, localizeRecurringError, type RecurringErrorView } from './errors.js';
import { settlementProgress } from './settlement-progress.js';
import type { ScheduledOccurrenceRow } from './types.js';
import type { CommandOutcome, RecurringState } from './use-recurring.js';

export type OccurrenceBucket = 'overdue' | 'skipped' | 'paid' | 'partial' | 'due' | 'upcoming';

interface OccurrenceDetailProps {
  locale: Locale;
  recurring: RecurringState;
  occurrenceId: string;
  /** Wallets offered by the payment dialog's 'Paying wallet' dropdown. */
  walletOptions: ReadonlyArray<{ readonly id: string; readonly name: string; readonly currency: string }>;
  onBack(): void;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

/** Buckets a row into exactly one of the six states the brief calls for.
 * `overdue` outranks `partial` (a late partial payment is shown as overdue,
 * not partial) and both outrank the plain not-yet-due split between `due`
 * (today) and `upcoming` (later) -- `skipped`/`paid` are terminal and always
 * win. Pure string comparison on ISO `YYYY-MM-DD` dates (`dueDate<=asOf`);
 * no `Date` object ever touches a due date anywhere in this feature, so
 * there is no client-side arithmetic that could reintroduce a
 * month-rollover bug -- the server (task 14) already computed the exact
 * calendar date and this UI only ever displays that string verbatim. */
export function occurrenceBucket(row: ScheduledOccurrenceRow): OccurrenceBucket {
  if (row.state === 'skipped') return 'skipped';
  if (row.state === 'settled') return 'paid';
  if (row.overdue) return 'overdue';
  if (row.state === 'partial') return 'partial';
  return row.dueDate <= row.asOf ? 'due' : 'upcoming';
}

export function occurrenceBucketLabel(locale: Locale, bucket: OccurrenceBucket): string {
  switch (bucket) {
    case 'overdue': return t(locale, 'Overdue', 'متأخر');
    case 'skipped': return t(locale, 'Skipped', 'تم تخطيه');
    case 'paid': return t(locale, 'Paid', 'مدفوع');
    case 'partial': return t(locale, 'Partially paid', 'مدفوع جزئيًا');
    case 'due': return t(locale, 'Due', 'مستحق');
    case 'upcoming': return t(locale, 'Upcoming', 'قادم');
  }
}

/** Expected/settled/remaining as an accessible table with a bar-chart
 * equivalent, matching `allocation-bars.tsx`'s own table+bar shape. Reads
 * only the row's own checked DTO fields; overage is computed from the
 * original `BigInt` values, never the clamped `chartPercent` coordinate
 * (see `settlementProgress`, shared with `upcoming-page.tsx`'s own per-row
 * bar so this math can't silently drift between the two call sites). */
export function OccurrenceAmountsTable({ locale, currency, row }: { locale: Locale; currency: Currency; row: ScheduledOccurrenceRow }) {
  const { hasTarget, settledNegative, percent, over, overageMinor } = settlementProgress(row.expectedMinor, row.settledMinor);

  return <div className="rec-amounts-block">
    <table className="rec-amounts-table">
      <caption className="rec-visually-hidden">{t(locale, 'Expected versus settled versus remaining', 'المتوقع مقابل المُسدَّد مقابل المتبقي')}</caption>
      <thead><tr>
        <th scope="col">{t(locale, 'Expected', 'المتوقع')}</th>
        <th scope="col">{t(locale, 'Settled', 'المُسدَّد')}</th>
        <th scope="col">{t(locale, 'Remaining', 'المتبقي')}</th>
      </tr></thead>
      <tbody><tr>
        <td data-label={t(locale, 'Expected', 'المتوقع')}><bdi>{formatMinorAmount(row.expectedMinor, currency, locale)}</bdi></td>
        <td data-label={t(locale, 'Settled', 'المُسدَّد')}>
          <bdi className={settledNegative ? 'rec-danger-text' : undefined}>{formatMinorAmount(row.settledMinor, currency, locale)}</bdi>
        </td>
        <td data-label={t(locale, 'Remaining', 'المتبقي')}><bdi>{formatMinorAmount(row.remainingMinor, currency, locale)}</bdi></td>
      </tr></tbody>
    </table>
    {hasTarget
      ? <div className="rec-progress" data-over={over ? 'true' : undefined} aria-hidden="true"><span style={{ inlineSize: `${percent}%` }} /></div>
      : <p className="rec-label-muted">{t(locale, 'No expected amount set', 'لا يوجد مبلغ متوقع محدد')}</p>}
    {over && overageMinor && <span className="rec-overage-text">+<bdi>{formatMinorAmount(overageMinor, currency, locale)}</bdi> {t(locale, 'over expected', 'فوق المتوقع')}</span>}
  </div>;
}

type HeldAction = 'pay' | 'skip' | 'reopen';

/** The occurrence this view is acting on, held from the moment a command
 * starts. A paid or skipped OVERDUE bill is in neither list after the
 * command's own refresh (the overdue RPC drops settled/skipped rows and the
 * window never holds a past due date), so without this the view would flip
 * to "no longer in the visible range" under the person's own successful
 * action (final review I3). `done` is false while the command is in flight. */
interface HeldOccurrence {
  readonly row: ScheduledOccurrenceRow;
  readonly action: HeldAction;
  readonly done: boolean;
}

/** The held snapshot after a successful command. Skip/reopen take the new
 * event head from the command's own result, so a Reopen sent from the held
 * view carries the head the server now expects. */
function afterAction(row: ScheduledOccurrenceRow, action: HeldAction, outcome: CommandOutcome): ScheduledOccurrenceRow {
  if (action === 'pay') return row;
  const result = outcome.result;
  const eventId = result && 'eventId' in result && typeof result.eventId === 'string' ? result.eventId : row.currentEventId;
  return { ...row, state: action === 'skip' ? 'skipped' : 'pending', currentEventId: eventId };
}

/** No occurrence-detail/history RPC exists in task 15's gateway (only the
 * list page, `scheduled_occurrence_page`) -- this view reads its row
 * straight out of `props.recurring.page.rows` instead of a second fetch, so
 * the same refresh the hook already runs after every accepted command
 * (`reconcileCommand` -> `refreshAfterCommand`) keeps this screen current
 * with zero extra plumbing. That structurally avoids task 13's own
 * documented defect class (a nested fetch depending on the whole hook
 * object, or a local view the shared refresh never touches) -- there is no
 * second fetch here to go stale in the first place. The one exception is a
 * row that leaves the list because of this view's own action: it is shown
 * from the held snapshot (`HeldOccurrence`), with a confirmation, rather
 * than as missing. */
export function OccurrenceDetail(props: OccurrenceDetailProps) {
  const [dialog, setDialog] = useState<'payment' | null>(null);
  const [actionError, setActionError] = useState<RecurringErrorView | null>(null);
  const [held, setHeld] = useState<HeldOccurrence | null>(null);
  const listed = props.recurring.page.rows.find((candidate) => candidate.id === props.occurrenceId);

  // Once a finished action's row is back in (or still in) the list, the list
  // is the truth again; a later disappearance is not this view's doing.
  useEffect(() => {
    if (listed && held?.done) setHeld(null);
  }, [listed, held]);

  // The success state comes before the missing-row guard: a row that left
  // the list because of this view's own action is shown from the held
  // snapshot, never as "no longer in the visible range".
  const row = listed ?? held?.row;
  if (!row) {
    return <div className="cr-card" role="alert">
      <p>{t(props.locale, 'This occurrence is no longer in the visible range.', 'هذه الدفعة المستحقة لم تعد ضمن النطاق المعروض.')}</p>
      <button type="button" className="cr-button" onClick={props.onBack}>{t(props.locale, 'Back to upcoming bills', 'العودة إلى الفواتير القادمة')}</button>
    </div>;
  }

  const name = props.locale === 'ar' ? (row.nameAr ?? row.nameEn) : (row.nameEn ?? row.nameAr);
  const bucket = occurrenceBucket(row);
  const remaining = BigInt(row.remainingMinor);
  const leftList = !listed && held?.done === true ? held.action : null;

  const track = async (action: HeldAction, run: () => Promise<CommandOutcome>): Promise<CommandOutcome> => {
    const snapshot = row;
    setHeld({ row: snapshot, action, done: false });
    try {
      const outcome = await run();
      // An ambiguous outcome stays held (in flight): the command may yet
      // have gone through, and the retry must stay reachable.
      if (outcome.status !== 'ambiguous') setHeld({ row: afterAction(snapshot, action, outcome), action, done: true });
      return outcome;
    } catch (cause) {
      setHeld(null);
      throw cause;
    }
  };

  const act = async (action: 'skip' | 'reopen') => {
    setActionError(null);
    try {
      await track(action, () => props.recurring.setOccurrenceState({ occurrenceId: row.id, expectedEventId: row.currentEventId, action }));
    } catch (cause) {
      setActionError(localizeRecurringError(classifyRecurringError(cause), props.locale));
    }
  };

  const paymentDialog = dialog === 'payment' && <ConfirmPaymentDialog
    locale={props.locale} currency={row.currency}
    occurrence={{ id: row.id, nameEn: row.nameEn, nameAr: row.nameAr, currentEventId: row.currentEventId, remainingMinor: row.remainingMinor }}
    walletOptions={props.walletOptions}
    allowConfirm={row.kind !== 'debt_payment'}
    pending={props.recurring.pending} ambiguous={props.recurring.ambiguous !== null}
    onClose={() => setDialog(null)} onClearAmbiguous={props.recurring.clearAmbiguous}
    onRetry={() => track('pay', props.recurring.retryAmbiguous)}
    onConfirm={(input) => track('pay', () => props.recurring.confirm(input))}
    onLinkExisting={(input) => track('pay', () => props.recurring.linkExisting(input))}
  />;

  const paid = leftList === 'pay';
  // One child layout for every state, with the payment dialog in a fixed
  // last slot: moving it between branches would remount it and lose its
  // own "Saved" confirmation the moment the paid row leaves the list.
  return <section className="rec-detail" aria-label={t(props.locale, 'Occurrence detail', 'تفاصيل الدفعة المستحقة')}>
    <div className="rec-row">
      <button type="button" className="cr-button" onClick={props.onBack}>{t(props.locale, 'Back to upcoming bills', 'العودة إلى الفواتير القادمة')}</button>
      <h2><bdi>{name}</bdi></h2>
      <span className={`rec-badge rec-badge-${paid ? 'paid' : bucket}`}>{occurrenceBucketLabel(props.locale, paid ? 'paid' : bucket)}</span>
    </div>

    {paid && <p role="status">
      {t(props.locale, 'Payment recorded. This bill is paid and has left the list.', 'تم تسجيل الدفعة. هذه الفاتورة مدفوعة وخرجت من القائمة.')}
    </p>}
    {leftList === 'skip' && <p role="status">
      {t(props.locale, 'Skipped. This bill has left the list; Reopen brings it back.', 'تم تخطي هذه الفاتورة وخرجت من القائمة. استخدم «إعادة فتح» لإرجاعها.')}
    </p>}

    {/* Paid and gone from the list: the snapshot's figures are pre-payment,
        so only the confirmation shows -- never a second "Review payment"
        that would record a duplicate. */}
    {!paid && <>
      <p className="rec-label-muted">{t(props.locale, 'Due', 'الاستحقاق')}: {row.dueDate}</p>

      <OccurrenceAmountsTable locale={props.locale} currency={row.currency} row={row} />

      {actionError && <div className="error-notice" role="alert">{actionError.message} {actionError.recovery}</div>}

      <div className="rec-row">
        {row.state !== 'skipped' && remaining > 0n && (
          <button type="button" className="cr-button" disabled={props.recurring.pending} onClick={() => setDialog('payment')}>
            {t(props.locale, 'Review payment', 'مراجعة الدفعة')}
          </button>
        )}
        {row.state === 'pending' && (
          <button type="button" className="cr-button" disabled={props.recurring.pending} onClick={() => void act('skip')}>
            {t(props.locale, 'Skip', 'تخطٍ')}
          </button>
        )}
        {row.state === 'skipped' && (
          <button type="button" className="cr-button" disabled={props.recurring.pending} onClick={() => void act('reopen')}>
            {t(props.locale, 'Reopen', 'إعادة فتح')}
          </button>
        )}
      </div>
    </>}

    {paymentDialog}
  </section>;
}
