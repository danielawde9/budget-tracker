import type { Currency } from '../loans/types.js';
import { loadSettleCandidates, type AutoSettleOutcome } from './auto-settle.js';
import { classifyRecurringError } from './errors.js';
import { shiftDateIso } from './occurrence-window.js';
import type { RecurringGateway, ScheduledOccurrenceRow } from './types.js';

export interface RecordedRepayment {
  readonly eventId: string;
  readonly loanId: string;
  readonly amountMinor: string;
  readonly currency: Currency;
  readonly effectiveDate: string;
}

const LOOK_BACK_DAYS = 59;
const LOOK_AHEAD_DAYS = 30; // 89 days: within scheduled_occurrence_page's 90-day limit
const MAX_LINKS = 12;

/** Links a loan repayment to that loan's unpaid instalments, oldest first,
 * up to the repayment amount (at most 12 links). Candidates are the overdue
 * list plus this function's own window (59 days back, 30 ahead), both read
 * in full through the shared bounded pager and deduped (`loadSettleCandidates`),
 * so the oldest unpaid instalment is paid first however long overdue it is;
 * the window's upper bound stays the ceiling for future instalments, and an
 * incomplete list refuses to decide (final review I4, M2).
 * `first`/`linkedCount` are tracked outside the try block so that if a link
 * fails after an earlier one already succeeded, the catch can report
 * `partial` (with what was already linked) instead of discarding that
 * progress behind a bare `failed`. Only a failure before any link succeeds
 * is reported as `failed`. */
export async function settleLoanRepayment(
  gateway: RecurringGateway,
  spaceId: string,
  repayment: RecordedRepayment,
): Promise<AutoSettleOutcome> {
  let first: ScheduledOccurrenceRow | null = null;
  let linkedCount = 0;
  try {
    const latestDueDate = shiftDateIso(repayment.effectiveDate, LOOK_AHEAD_DAYS);
    const candidates = await loadSettleCandidates(gateway, spaceId, {
      fromDate: shiftDateIso(repayment.effectiveDate, -LOOK_BACK_DAYS),
      toDate: latestDueDate,
    });
    if (candidates.truncated) return { status: 'ambiguous', reason: 'truncated' };
    const instalments = candidates.rows
      .filter((row: ScheduledOccurrenceRow) => row.kind === 'debt_payment' && row.loanId === repayment.loanId
        && row.currency === repayment.currency && (row.state === 'pending' || row.state === 'partial')
        && row.dueDate <= latestDueDate)
      .sort((left, right) => (left.dueDate === right.dueDate ? left.id.localeCompare(right.id) : left.dueDate.localeCompare(right.dueDate)));
    let left = BigInt(repayment.amountMinor);
    for (const row of instalments.slice(0, MAX_LINKS)) {
      if (left <= 0n) break;
      const remaining = BigInt(row.remainingMinor);
      const amount = remaining < left ? remaining : left;
      if (amount <= 0n) continue;
      await gateway.linkExisting({
        spaceId,
        requestId: globalThis.crypto.randomUUID(),
        occurrenceId: row.id,
        eventId: repayment.eventId,
        amountMinor: amount.toString(),
        expectedEventId: row.currentEventId,
      });
      first ??= row;
      linkedCount += 1;
      left -= amount;
    }
    return first ? { status: 'settled', occurrenceId: first.id, nameEn: first.nameEn, nameAr: first.nameAr } : { status: 'none' };
  } catch (cause) {
    // Classified, never stringified: the gateway rejects with PostgREST's
    // plain `{ code, message }` object (final review I1).
    const error = classifyRecurringError(cause);
    if (first && linkedCount > 0) {
      return { status: 'partial', occurrenceId: first.id, nameEn: first.nameEn, nameAr: first.nameAr, linkedCount, error };
    }
    return { status: 'failed', error };
  }
}
