import type { Currency } from '../loans/types.js';
import { classifyRecurringError, type RecurringErrorView } from './errors.js';
import { linkScheduledPaymentWithRetry } from './link-with-retry.js';
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
  // `remainsDue`: the linked occurrence still has an unpaid remainder -- a
  // partial payment smaller than what the bill still owed (D3), or a loan
  // repayment smaller than its instalment (final review M3). The notice must
  // not call that "paid".
  // An amount larger than the bill still owes is never auto-linked (the bill
  // cannot absorb it and it may belong elsewhere), so no surplus is reported
  // here; only an exact or partial payment reaches this outcome.
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
 * overdue occurrences of any age are candidates.
 *
 * A partial payment (D3) has no exact-remaining look-alike at all, so when zero
 * schedules are look-alikes the matcher falls back to the schedules it filtered
 * (each contributing its oldest unpaid occurrence): exactly one that still owes
 * MORE than the entry is a partial payment of it; two or more stay `ambiguous`
 * rather than being guessed, and an entry larger than the bill's remainder is
 * refused. The caller derives the link amount (`min(entry, remaining)`) and
 * whether a remainder stays due from the matched occurrence's remaining. */
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
    // Nothing to settle if the bill is already fully covered (`remaining` is
    // clamped at 0, but a stale/malformed row can still carry a non-positive
    // remainder); a link amount must be positive.
    if (BigInt(row.remainingMinor) <= 0n) continue;
    const current = bySchedule.get(row.scheduleId);
    bySchedule.set(row.scheduleId, {
      oldest: current && !isOlder(row, current.oldest) ? current.oldest : row,
      lookAlike: (current?.lookAlike ?? false) || row.remainingMinor === recorded.amountMinor,
    });
  }
  const schedules = [...bySchedule.values()];
  const lookAlikes = schedules.filter((schedule) => schedule.lookAlike);
  if (lookAlikes.length > 1) return { kind: 'ambiguous', scheduleCount: lookAlikes.length };
  const [only] = lookAlikes;
  if (only) {
    // An exact-amount match only settles the schedule when its OWN oldest
    // unpaid occurrence is the exact one; a newer matching row does not let
    // the matcher skip an older unpaid occurrence (final review I4).
    if (only.oldest.remainingMinor !== recorded.amountMinor) return { kind: 'none' };
    return { kind: 'match', occurrence: only.oldest };
  }
  // No exact-remaining look-alike anywhere: a SMALLER amount is a partial
  // payment of the one plausible bill. A LARGER amount is refused -- the bill
  // cannot absorb it and it may belong elsewhere, so it stays for the manual
  // linking path ("a non-matching expense leaves the bill pending",
  // e2e/auto-settle.spec.ts).
  if (schedules.length > 1) return { kind: 'ambiguous', scheduleCount: schedules.length };
  const [fallback] = schedules;
  if (!fallback) return { kind: 'none' };
  if (BigInt(recorded.amountMinor) > BigInt(fallback.oldest.remainingMinor)) return { kind: 'none' };
  return { kind: 'match', occurrence: fallback.oldest };
}

/**
 * After an entry is recorded, link it to the one bill (or income) it clearly
 * pays: same kind, currency and category (equal or parent/child), due no later
 * than 31 days after the entry, and exactly one schedule -- whose OLDEST
 * unpaid occurrence, across the overdue list and the window, is settled. An
 * incomplete candidate list refuses to decide. Never blocks recording; the
 * outcome is returned so the caller can tell the person what happened.
 *
 * The amount may be smaller than the bill's remaining amount (a partial
 * payment links what was paid); an amount larger than the bill still owes is
 * never auto-linked, so it stays for the manual path. The link is retried once
 * on an uncertain transport failure (D7).
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
    const amount = BigInt(recorded.amountMinor);
    const remaining = BigInt(match.remainingMinor);
    // Never link more than the bill still owes: a partial payment links the
    // amount paid (an over-payment is refused before reaching here).
    const linkAmountMinor = (remaining < amount ? remaining : amount).toString();
    await linkScheduledPaymentWithRetry(gateway, {
      spaceId,
      requestId: globalThis.crypto.randomUUID(),
      occurrenceId: match.id,
      eventId: recorded.eventId,
      amountMinor: linkAmountMinor,
      expectedEventId: match.currentEventId,
    });
    return {
      status: 'settled',
      occurrenceId: match.id,
      nameEn: match.nameEn,
      nameAr: match.nameAr,
      remainsDue: remaining > amount,
    };
  } catch (cause) {
    return { status: 'failed', error: classifyRecurringError(cause) };
  }
}
