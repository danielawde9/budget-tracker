import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRememberedWallet, storeRememberedWallet } from './remembered-wallet.js';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('remembered wallet', () => {
  it('round-trips per space', () => {
    expect(storeRememberedWallet('space-a', 'wallet-1')).toBe(true);
    expect(storeRememberedWallet('space-b', 'wallet-2')).toBe(true);
    expect(readRememberedWallet('space-a')).toBe('wallet-1');
    expect(readRememberedWallet('space-b')).toBe('wallet-2');
  });

  it('is empty for a space that never recorded', () => {
    expect(readRememberedWallet('space-new')).toBeNull();
  });

  it('degrades to nothing remembered when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(readRememberedWallet('space-a')).toBeNull();
    expect(storeRememberedWallet('space-a', 'wallet-1')).toBe(false);
  });
});
