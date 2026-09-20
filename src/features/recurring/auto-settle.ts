import type { Currency } from '../loans/types.js';
import type { RecurringGateway, ScheduledOccurrenceRow } from './types.js';

export interface ExpenseForMatching {
  readonly eventId: string;
  readonly categoryId: string | null;
  readonly amountMinor: string;
  readonly currency: Currency;
  readonly effectiveDate: string;
}

const MATCH_WINDOW_DAYS = 31;

function daysBetween(left: string, right: string): number {
  return Math.round((Date.parse(right) - Date.parse(left)) / 86_400_000);
}

function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function findSettleableOccurrence(
  expense: ExpenseForMatching,
  occurrences: readonly ScheduledOccurrenceRow[],
): ScheduledOccurrenceRow | null {
  const candidates = occurrences.filter((row) => {
    if (row.state !== 'pending') return false;
    if (row.currency !== expense.currency) return false;
    if (row.expectedMinor !== expense.amountMinor) return false;
    if (row.categoryId !== expense.categoryId) return false;
    if (Math.abs(daysBetween(row.dueDate, expense.effectiveDate)) > MATCH_WINDOW_DAYS) return false;
    return true;
  });
  return candidates.length === 1 ? candidates[0]! : null;
}

/**
 * After an expense is recorded, link it to the one upcoming bill it clearly
 * pays. Never throws and never blocks the recording flow: matching is
 * deliberately strict (exact amount, currency, category when the bill has
 * one, due date within 31 days, exactly one candidate) and any failure
 * leaves the bill for manual Review payment.
 */
export async function autoSettleExpense(
  gateway: RecurringGateway,
  spaceId: string,
  expense: ExpenseForMatching,
): Promise<string | null> {
  try {
    const page = await gateway.loadOccurrences({
      spaceId,
      fromDate: shiftDate(expense.effectiveDate, -MATCH_WINDOW_DAYS),
      toDate: shiftDate(expense.effectiveDate, MATCH_WINDOW_DAYS),
      afterDueDate: null,
      afterId: null,
      limit: 100,
    });
    const match = findSettleableOccurrence(expense, page.rows);
    if (!match) return null;
    await gateway.linkExisting({
      spaceId,
      requestId: globalThis.crypto.randomUUID(),
      occurrenceId: match.id,
      eventId: expense.eventId,
      amountMinor: expense.amountMinor,
      expectedEventId: match.currentEventId,
    });
    return match.id;
  } catch {
    return null;
  }
}
