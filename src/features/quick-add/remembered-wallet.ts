/**
 * The wallet a space last recorded an expense or income from, kept on this
 * device only (a per-viewer convenience for quick entry — never shared,
 * never authoritative). Storage can be unavailable (private browsing,
 * blocked site data); that means "nothing remembered", not an error.
 */
function key(spaceId: string): string {
  return `budget:last-wallet:${spaceId}`;
}

export function readRememberedWallet(spaceId: string): string | null {
  try {
    return window.localStorage.getItem(key(spaceId));
  } catch {
    return null;
  }
}

export function storeRememberedWallet(spaceId: string, walletId: string): boolean {
  try {
    window.localStorage.setItem(key(spaceId), walletId);
    return true;
  } catch {
    return false;
  }
}
