import { describe, expect, it } from 'vitest';

import { readBrowserAccessToken } from './supabase.js';

function clientWith(session: unknown, error: unknown = null) {
  return {
    auth: {
      getSession: async () => ({ data: { session }, error }),
    },
    // The household delivery composition passes the full data client; the
    // token reader only touches the auth surface.
  } as never;
}

describe('readBrowserAccessToken', () => {
  it('returns the session bearer token', async () => {
    const client = clientWith({ access_token: 'session-token', user: { id: 'user-1' } });
    await expect(readBrowserAccessToken(client)).resolves.toBe('session-token');
  });

  it('returns null when there is no session or the session read fails', async () => {
    await expect(readBrowserAccessToken(clientWith(null))).resolves.toBeNull();
    await expect(readBrowserAccessToken(clientWith({ user: { id: 'user-1' } }))).resolves.toBeNull();
    await expect(readBrowserAccessToken(clientWith({ access_token: 42 }))).resolves.toBeNull();
    await expect(readBrowserAccessToken(clientWith(null, { message: 'session error' }))).resolves.toBeNull();
  });
});
