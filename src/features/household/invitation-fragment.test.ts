import { beforeEach, describe, expect, it, vi } from 'vitest';

import { takeHouseholdInvitation } from './invitation-fragment.js';

const TOKEN = 'A'.repeat(43);

describe('household invitation fragment', () => {
  beforeEach(() => window.history.replaceState(null, '', '/budget?source=test'));

  it('returns a canonical token and removes the entire fragment immediately', () => {
    window.history.replaceState(null, '', `/budget?source=test#household-invitation=${TOKEN}`);
    const replace = vi.spyOn(window.history, 'replaceState');
    expect(takeHouseholdInvitation(window.location, window.history)).toBe(TOKEN);
    expect(replace).toHaveBeenCalledWith(null, '', '/budget?source=test');
    expect(window.location.hash).toBe('');
  });

  it.each(['short', `${TOKEN}=`, `${TOKEN}&other=value`, ''])('rejects and clears malformed candidate %s', (candidate) => {
    window.history.replaceState(null, '', `/budget#household-invitation=${candidate}`);
    expect(takeHouseholdInvitation(window.location, window.history)).toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('leaves unrelated fragments untouched', () => {
    window.history.replaceState(null, '', '/budget#categories');
    expect(takeHouseholdInvitation(window.location, window.history)).toBeNull();
    expect(window.location.hash).toBe('#categories');
  });
});
