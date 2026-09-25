import type { Currency } from '../loans/types.js';
import { shiftDateIso } from './occurrence-window.js';
import type { RecurringGateway, ScheduledOccurrenceRow } from './types.js';

export interface RecordedEventForMatching {
  readonly eventId: string;
  readonly eventKind: 'expense' | 'income';
  readonly categoryId: string | null;
  readonly amountMinor: string;
  readonly currency: Currency;
  readonly effectiveDate: string;
}

export type SettleCandidate =
  | { readonly kind: 'match'; readonly occurrence: ScheduledOccurrenceRow }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous'; readonly scheduleCount: number };

export type AutoSettleOutcome =
  | { readonly status: 'settled'; readonly occurrenceId: string; readonly nameEn: string | null; readonly nameAr: string | null }
  | { readonly status: 'none' }
  | { readonly status: 'ambiguous'; readonly scheduleCount: number }
  | { readonly status: 'failed'; readonly message: string }
  // Only a multi-link settlement (settleLoanRepayment) produces this: at
  // least one instalment was linked before a later link failed, so the
  // caller must not discard the links that already succeeded by reporting a
  // bare `failed`.
  | {
      readonly status: 'partial';
      readonly occurrenceId: string;
      readonly nameEn: string | null;
      readonly nameAr: string | null;
      readonly linkedCount: number;
      readonly message: string;
    };

const MATCH_WINDOW_DAYS = 31;

function daysBetween(left: string, right: string): number {
  return Math.round((Date.parse(right) - Date.parse(left)) / 86_400_000);
}

function categoriesMatch(bill: string | null, entry: string | null, parentOf: (id: string) => string | null): boolean {
  if (bill === null || entry === null) return bill === entry;
  return bill === entry || parentOf(entry) === bill || parentOf(bill) === entry;
}

export function findSettleableOccurrence(
  recorded: RecordedEventForMatching,
  occurrences: readonly ScheduledOccurrenceRow[],
  parentOf: (categoryId: string) => string | null,
): SettleCandidate {
  const oldestPerSchedule = new Map<string, ScheduledOccurrenceRow>();
  for (const row of occurrences) {
    if (row.kind !== recorded.eventKind) continue;
    if (row.state !== 'pending' && row.state !== 'partial') continue;
    if (row.currency !== recorded.currency || row.remainingMinor !== recorded.amountMinor) continue;
    if (!categoriesMatch(row.categoryId, recorded.categoryId, parentOf)) continue;
    if (Math.abs(daysBetween(row.dueDate, recorded.effectiveDate)) > MATCH_WINDOW_DAYS) continue;
    const current = oldestPerSchedule.get(row.scheduleId);
    if (!current || row.dueDate < current.dueDate || (row.dueDate === current.dueDate && row.id < current.id)) {
      oldestPerSchedule.set(row.scheduleId, row);
    }
  }
  if (oldestPerSchedule.size === 0) return { kind: 'none' };
  if (oldestPerSchedule.size > 1) return { kind: 'ambiguous', scheduleCount: oldestPerSchedule.size };
  const [only] = oldestPerSchedule.values();
  return only ? { kind: 'match', occurrence: only } : { kind: 'none' };
}

/**
 * After an entry is recorded, link it to the one bill (or income) it clearly
 * pays: same kind, currency and remaining amount, category equal or
 * parent/child, due within 31 days, and exactly one schedule -- whose oldest
 * unpaid occurrence is settled. Never blocks recording; the outcome is
 * returned so the caller can tell the person what happened.
 */
export async function autoSettleRecordedEvent(
  gateway: RecurringGateway,
  spaceId: string,
  recorded: RecordedEventForMatching,
  parentOf: (categoryId: string) => string | null,
): Promise<AutoSettleOutcome> {
  try {
    const page = await gateway.loadOccurrences({
      spaceId,
      fromDate: shiftDateIso(recorded.effectiveDate, -MATCH_WINDOW_DAYS),
      toDate: shiftDateIso(recorded.effectiveDate, MATCH_WINDOW_DAYS),
      afterDueDate: null,
      afterId: null,
      limit: 100,
    });
    const candidate = findSettleableOccurrence(recorded, page.rows, parentOf);
    if (candidate.kind === 'none') return { status: 'none' };
    if (candidate.kind === 'ambiguous') return { status: 'ambiguous', scheduleCount: candidate.scheduleCount };
    const match = candidate.occurrence;
    await gateway.linkExisting({
      spaceId,
      requestId: globalThis.crypto.randomUUID(),
      occurrenceId: match.id,
      eventId: recorded.eventId,
      amountMinor: recorded.amountMinor,
      expectedEventId: match.currentEventId,
    });
    return { status: 'settled', occurrenceId: match.id, nameEn: match.nameEn, nameAr: match.nameAr };
  } catch (cause) {
    return { status: 'failed', message: cause instanceof Error ? cause.message : String(cause) };
  }
}
