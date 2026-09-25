import type { Currency } from '../loans/types.js';
import type { AutoSettleOutcome } from './auto-settle.js';
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

function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** Links a loan repayment to that loan's unpaid instalments, oldest first,
 * up to the repayment amount (at most 12 links). */
export async function settleLoanRepayment(
  gateway: RecurringGateway,
  spaceId: string,
  repayment: RecordedRepayment,
): Promise<AutoSettleOutcome> {
  try {
    const page = await gateway.loadOccurrences({
      spaceId,
      fromDate: shiftDate(repayment.effectiveDate, -LOOK_BACK_DAYS),
      toDate: shiftDate(repayment.effectiveDate, LOOK_AHEAD_DAYS),
      afterDueDate: null,
      afterId: null,
      limit: 100,
    });
    const instalments = page.rows
      .filter((row: ScheduledOccurrenceRow) => row.kind === 'debt_payment' && row.loanId === repayment.loanId
        && row.currency === repayment.currency && (row.state === 'pending' || row.state === 'partial'))
      .sort((left, right) => (left.dueDate === right.dueDate ? left.id.localeCompare(right.id) : left.dueDate.localeCompare(right.dueDate)));
    let left = BigInt(repayment.amountMinor);
    let first: ScheduledOccurrenceRow | null = null;
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
      left -= amount;
    }
    return first ? { status: 'settled', occurrenceId: first.id, nameEn: first.nameEn, nameAr: first.nameAr } : { status: 'none' };
  } catch (cause) {
    return { status: 'failed', message: cause instanceof Error ? cause.message : String(cause) };
  }
}
