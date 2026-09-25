/** Kinds a quick-add link may open the Record sheet on. */
export type QuickAddKind = 'expense' | 'income';

const PARAM = 'add';

/**
 * Reads a quick-add link (`/?add=expense`, `/?add=income`) — the target of
 * the installed app's shortcuts and of a phone's Shortcuts "Open URL"
 * action. It only chooses which form opens: nothing is recorded until the
 * person taps Save, so a link someone else sends can never spend money.
 */
export function readQuickAddIntent(search: string): QuickAddKind | null {
  const value = new URLSearchParams(search).get(PARAM);
  return value === 'expense' || value === 'income' ? value : null;
}

/** The same address without the quick-add parameter, so a reload or a
 * shared link does not reopen the form. */
export function hrefWithoutQuickAdd(href: string): string {
  const url = new URL(href);
  if (!url.searchParams.has(PARAM)) return href;
  url.searchParams.delete(PARAM);
  return url.toString();
}
