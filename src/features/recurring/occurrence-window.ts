/** Days ahead that bills are generated and listed. Must equal the horizon
 * `available_cash_summary` checks (`v_horizon_end := v_today + 89`);
 * occurrence-window.test.ts pins the two together. */
export const OCCURRENCE_WINDOW_DAYS = 89;

export function occurrenceWindow(todayIso: string): { fromDate: string; toDate: string } {
  const end = new Date(`${todayIso}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + OCCURRENCE_WINDOW_DAYS);
  return { fromDate: todayIso, toDate: end.toISOString().slice(0, 10) };
}
