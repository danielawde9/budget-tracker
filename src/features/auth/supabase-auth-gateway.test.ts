import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createSupabaseAuthGateway } from './supabase-auth-gateway.js';

function session(id: string, email: string | null) {
  return { user: { id, email }, access_token: 'must-not-leave-the-client', refresh_token: 'also-private' };
}

function clientWith(currentSession: ReturnType<typeof session> | null) {
  let listener: ((event: string, value: ReturnType<typeof session> | null) => void) | null = null;
  const unsubscribe = vi.fn();
  const auth = {
    getSession: vi.fn(async () => ({ data: { session: currentSession }, error: null as { message: string } | null })),
    signInWithPassword: vi.fn(async () => ({ data: { session: currentSession }, error: null as { message: string } | null })),
    signUp: vi.fn(async () => ({ data: { session: currentSession, user: currentSession?.user ?? { id: 'pending', email: 'new@example.com' } }, error: null as { message: string } | null })),
    signOut: vi.fn(async () => ({ error: null as { message: string } | null })),
    onAuthStateChange: vi.fn((callback: typeof listener) => {
      listener = callback;
      return { data: { subscription: { unsubscribe } } };
    }),
  };
  return { client: { auth }, auth, unsubscribe, emit: (event: string, value: ReturnType<typeof session> | null) => listener?.(event, value) };
}

describe('Supabase auth gateway', () => {
  it('exposes only minimal user identity from sessions and auth events', async () => {
    const fake = clientWith(session('user-1', 'owner@example.com'));
    const gateway = createSupabaseAuthGateway(fake.client);
    const changes: unknown[] = [];
    const stop = gateway.subscribe((change) => changes.push(change));

    await expect(gateway.getSession()).resolves.toEqual({ id: 'user-1', email: 'owner@example.com' });
    fake.emit('TOKEN_REFRESHED', session('user-1', 'owner@example.com'));
    expect(changes).toEqual([{ event: 'TOKEN_REFRESHED', user: { id: 'user-1', email: 'owner@example.com' } }]);
    expect(JSON.stringify(changes)).not.toContain('access_token');
    expect(JSON.stringify(changes)).not.toContain('refresh_token');

    stop();
    expect(fake.unsubscribe).toHaveBeenCalledOnce();
  });

  it('forwards email/password only and reports confirmation-required sign-up', async () => {
    const signedIn = clientWith(session('user-1', 'owner@example.com'));
    const gateway = createSupabaseAuthGateway(signedIn.client);
    await expect(gateway.signIn('owner@example.com', 'private-password')).resolves.toEqual({ id: 'user-1', email: 'owner@example.com' });
    expect(signedIn.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'owner@example.com', password: 'private-password' });

    const pending = clientWith(null);
    const pendingGateway = createSupabaseAuthGateway(pending.client);
    await expect(pendingGateway.signUp('new@example.com', 'private-password')).resolves.toEqual({ confirmationRequired: true, user: { id: 'pending', email: 'new@example.com' } });
    expect(pending.auth.signUp).toHaveBeenCalledWith({ email: 'new@example.com', password: 'private-password' });
  });

  it('signs out and replaces raw auth errors with operation-safe errors', async () => {
    const fake = clientWith(null);
    fake.auth.signInWithPassword.mockResolvedValueOnce({ data: { session: null }, error: { message: 'token [REDACTED_SECRET] for owner@example.com' } });
    const gateway = createSupabaseAuthGateway(fake.client);

    await expect(gateway.signIn('owner@example.com', 'private-password')).rejects.toThrow('Sign-in was not accepted. Check your email and password, then try again.');
    await gateway.signOut();
    expect(fake.auth.signOut).toHaveBeenCalledOnce();
  });

  it('keeps secret-shaped values out of application logging', async () => {
    const files = await Promise.all([
      readFile(`${process.cwd()}/src/app.tsx`, 'utf8'),
      readFile(`${process.cwd()}/src/features/auth/supabase-auth-gateway.ts`, 'utf8'),
    ]);
    const source = files.join('\n');
    expect(source).not.toMatch(/console\.(log|info|warn|error)/);
    expect(source).not.toMatch(/access_token|refresh_token/);
  });
});
