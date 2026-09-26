import type { Currency } from '../loans/types.js';
import { classifyRecurringError, type RecurringErrorView } from './errors.js';
import { loadAllPages, mergeOverdueFirst, PAGE_LIMIT } from './load-all-pages.js';
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
  // `remainsDue`: the last linked occurrence still has an unpaid remainder --
  // only a loan repayment smaller than its instalment produces it, and the
  // notice must not call that "paid" (final review M3).
  | {
      readonly status: 'settled';
      readonly occurrenceId: string;
      readonly nameEn: string | null;
      readonly nameAr: string | null;
      readonly remainsDue: boolean;
    }
  | { readonly status: 'none' }
  // Two or more schedules look like this entry; none is guessed (review focus #4).
  | { readonly status: 'ambiguous'; readonly reason: 'look_alike'; readonly scheduleCount: number }
  // A candidate list hit the shared pager's page cap, so it is incomplete and
  // nothing is decided on it (final review M2).
  | { readonly status: 'ambiguous'; readonly reason: 'truncated' }
  // `error` is the CLASSIFIED failure, never a stringified cause: the real
  // gateway rejects with PostgREST's plain `{ code, message }` object, which
  // `String(cause)` turns into "[object Object]" (final review I1). The
  // notice localizes it with `localizeRecurringError`, so no raw English
  // server text lands inside an Arabic sentence.
  | { readonly status: 'failed'; readonly error: RecurringErrorView }
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
      readonly error: RecurringErrorView;
    };

const MATCH_WINDOW_DAYS = 31;

function categoriesMatch(bill: string | null, entry: string | null, parentOf: (id: string) => string | null): boolean {
  if (bill === null || entry === null) return bill === entry;
  return bill === entry || parentOf(entry) === bill || parentOf(bill) === entry;
}

function isOlder(row: ScheduledOccurrenceRow, than: ScheduledOccurrenceRow): boolean {
  return row.dueDate < than.dueDate || (row.dueDate === than.dueDate && row.id < than.id);
}

export interface SettleCandidates {
  readonly rows: readonly ScheduledOccurrenceRow[];
  /** Either list hit the pager's cap: the caller must not decide on it. */
  readonly truncated: boolean;
}

/** Every occurrence a recorded entry could settle: the overdue list (unpaid,
 * due before the server's today, no lower date bound) and the window around
 * the entry's date, each read in full through the shared bounded pager
 * (`loadAllPages`), deduped by id -- the window's look-back overlaps the
 * overdue list. Shared by `autoSettleRecordedEvent` and `settleLoanRepayment`
 * (final review I4, M2). */
export async function loadSettleCandidates(
  gateway: RecurringGateway,
  spaceId: string,
  window: { readonly fromDate: string; readonly toDate: string },
): Promise<SettleCandidates> {
  const [overdue, windowed] = await Promise.all([
    loadAllPages((cursor) => gateway.loadOverdue({
      spaceId, afterDueDate: cursor?.dueDate ?? null, afterId: cursor?.id ?? null, limit: PAGE_LIMIT,
    })),
    loadAllPages((cursor) => gateway.loadOccurrences({
      spaceId, fromDate: window.fromDate, toDate: window.toDate,
      afterDueDate: cursor?.dueDate ?? null, afterId: cursor?.id ?? null, limit: PAGE_LIMIT,
    })),
  ]);
  return { rows: mergeOverdueFirst(overdue.rows, windowed.rows), truncated: overdue.truncated || windowed.truncated };
}

/** Per schedule, the occurrence a payment settles is its OLDEST unpaid one --
 * never a newer (or future) one while an older one is still unpaid (final
 * review I4). A schedule is a look-alike when ANY of its unpaid occurrences
 * has a remaining amount equal to the entry, so a schedule whose matching
 * occurrence sits behind an older unpaid one still counts toward
 * `ambiguous` and can't turn a look-alike pair into a guess. The only date
 * bound is the ceiling for future-dated candidates (entry date + 31 days);
 * overdue occurrences of any age are candidates. */
export function findSettleableOccurrence(
  recorded: RecordedEventForMatching,
  occurrences: readonly ScheduledOccurrenceRow[],
  parentOf: (categoryId: string) => string | null,
): SettleCandidate {
  const latestDueDate = shiftDateIso(recorded.effectiveDate, MATCH_WINDOW_DAYS);
  const bySchedule = new Map<string, { oldest: ScheduledOccurrenceRow; lookAlike: boolean }>();
  for (const row of occurrences) {
    if (row.kind !== recorded.eventKind) continue;
    if (row.state !== 'pending' && row.state !== 'partial') continue;
    if (row.currency !== recorded.currency) continue;
    if (!categoriesMatch(row.categoryId, recorded.categoryId, parentOf)) continue;
    if (row.dueDate > latestDueDate) continue;
    const current = bySchedule.get(row.scheduleId);
    bySchedule.set(row.scheduleId, {
      oldest: current && !isOlder(row, current.oldest) ? current.oldest : row,
      lookAlike: (current?.lookAlike ?? false) || row.remainingMinor === recorded.amountMinor,
    });
  }
  const lookAlikes = [...bySchedule.values()].filter((schedule) => schedule.lookAlike);
  if (lookAlikes.length > 1) return { kind: 'ambiguous', scheduleCount: lookAlikes.length };
  const [only] = lookAlikes;
  if (!only || only.oldest.remainingMinor !== recorded.amountMinor) return { kind: 'none' };
  return { kind: 'match', occurrence: only.oldest };
}

/**
 * After an entry is recorded, link it to the one bill (or income) it clearly
 * pays: same kind, currency and remaining amount, category equal or
 * parent/child, due no later than 31 days after the entry, and exactly one
 * schedule -- whose OLDEST unpaid occurrence, across the overdue list and the
 * window, is settled. An incomplete candidate list refuses to decide. Never
 * blocks recording; the outcome is returned so the caller can tell the
 * person what happened.
 */
export async function autoSettleRecordedEvent(
  gateway: RecurringGateway,
  spaceId: string,
  recorded: RecordedEventForMatching,
  parentOf: (categoryId: string) => string | null,
): Promise<AutoSettleOutcome> {
  try {
    const candidates = await loadSettleCandidates(gateway, spaceId, {
      fromDate: shiftDateIso(recorded.effectiveDate, -MATCH_WINDOW_DAYS),
      toDate: shiftDateIso(recorded.effectiveDate, MATCH_WINDOW_DAYS),
    });
    if (candidates.truncated) return { status: 'ambiguous', reason: 'truncated' };
    const candidate = findSettleableOccurrence(recorded, candidates.rows, parentOf);
    if (candidate.kind === 'none') return { status: 'none' };
    if (candidate.kind === 'ambiguous') return { status: 'ambiguous', reason: 'look_alike', scheduleCount: candidate.scheduleCount };
    const match = candidate.occurrence;
    await gateway.linkExisting({
      spaceId,
      requestId: globalThis.crypto.randomUUID(),
      occurrenceId: match.id,
      eventId: recorded.eventId,
      amountMinor: recorded.amountMinor,
      expectedEventId: match.currentEventId,
    });
    // The entry equals the occurrence's remaining amount, so it is paid in full.
    return { status: 'settled', occurrenceId: match.id, nameEn: match.nameEn, nameAr: match.nameAr, remainsDue: false };
  } catch (cause) {
    return { status: 'failed', error: classifyRecurringError(cause) };
  }
}
