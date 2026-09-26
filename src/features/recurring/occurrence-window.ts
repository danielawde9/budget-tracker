/** Days ahead that bills are generated and listed. Must equal the horizon
 * `available_cash_summary` checks (`v_horizon_end := v_today + 89`);
 * occurrence-window.test.ts pins the two together. */
export const OCCURRENCE_WINDOW_DAYS = 89;

/** Adds (or, for a negative `days`, subtracts) whole days to an ISO date
 * string using UTC calendar arithmetic, so a caller's local time zone or DST
 * never shifts the result. The one date-shifting helper for every feature
 * that needs a `fromDate`/`toDate` window around a date -- `auto-settle.ts`
 * and `settle-loan-repayment.ts` both import it rather than keeping their
 * own copy. */
export function shiftDateIso(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function occurrenceWindow(todayIso: string): { fromDate: string; toDate: string } {
  return { fromDate: todayIso, toDate: shiftDateIso(todayIso, OCCURRENCE_WINDOW_DAYS) };
}
