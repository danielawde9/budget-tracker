import type { ScheduledOccurrencePage, ScheduledOccurrencePageCursor, ScheduledOccurrenceRow } from './types.js';

/** Every keyset-paged occurrence list is read in full, up to this many
 * `PAGE_LIMIT`-row pages (1,000 rows), rather than one page that silently
 * drops everything past it (audit D10, final review M2). Every loop needs a
 * provable bound (global engineering rule #2); beyond it the list is genuinely
 * incomplete, and each caller says so -- `UpcomingPage` with an alert, the
 * settle functions by refusing to decide. See docs/decisions.md, 2026-09-26. */
export const MAX_PAGES = 10;
export const PAGE_LIMIT = 100;

export interface LoadedPages {
  readonly rows: readonly ScheduledOccurrenceRow[];
  /** True when the list still had a `nextCursor` after `MAX_PAGES` pages. */
  readonly truncated: boolean;
}

/** Pages one keyset-cursor RPC to completion (or to `MAX_PAGES`, whichever
 * comes first). Shared by the Upcoming bills list (`useRecurring`) and the
 * settle functions (`autoSettleRecordedEvent`, `settleLoanRepayment`) -- they
 * differ only in which gateway method `fetchPage` calls.
 *
 * Fails loudly rather than looping: if a page's `nextCursor` is the exact
 * cursor that was just sent to fetch it, the RPC isn't advancing (a server
 * regression, most likely) and re-fetching would silently re-append the same
 * page up to `MAX_PAGES` times -- duplicate ids (duplicate React keys) and a
 * truncation that misreports a stall as "more data exists". The check runs
 * before the page's rows are folded into the accumulator, so a stalled page's
 * rows are never added even once. */
export async function loadAllPages(
  fetchPage: (cursor: ScheduledOccurrencePageCursor | null) => Promise<ScheduledOccurrencePage>,
): Promise<LoadedPages> {
  const rows: ScheduledOccurrenceRow[] = [];
  let cursor: ScheduledOccurrencePageCursor | null = null;
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const page = await fetchPage(cursor);
    if (cursor && page.nextCursor && page.nextCursor.dueDate === cursor.dueDate && page.nextCursor.id === cursor.id) {
      throw new Error('recurring page cursor did not advance');
    }
    rows.push(...page.rows);
    if (!page.nextCursor) return { rows, truncated: false };
    cursor = page.nextCursor;
  }
  return { rows, truncated: true };
}

/** Overdue rows first, then window rows not already served by the overdue
 * list. A device clock a day off from the server's UTC "today", or a window
 * that reaches into the past (the settle functions' look-back), makes the two
 * lists overlap; an occurrence is kept once, never twice. */
export function mergeOverdueFirst(
  overdue: readonly ScheduledOccurrenceRow[],
  window: readonly ScheduledOccurrenceRow[],
): ScheduledOccurrenceRow[] {
  const overdueIds = new Set(overdue.map((row) => row.id));
  return [...overdue, ...window.filter((row) => !overdueIds.has(row.id))];
}
