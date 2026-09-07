import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AuthChange, AuthGateway, AuthUser, SignUpResult } from './types.js';
import { useAuthSession } from './use-auth-session.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

class FakeAuthGateway implements AuthGateway {
  user: AuthUser | null = null;
  error: Error | null = null;
  confirmationRequired = false;
  listener: ((change: AuthChange) => void) | null = null;
  sessionPromise: Promise<AuthUser | null> | null = null;
  calls: string[] = [];

  async getSession() {
    this.calls.push('getSession');
    if (this.sessionPromise) return this.sessionPromise;
    if (this.error) throw this.error;
    return this.user;
  }

  subscribe(listener: (change: AuthChange) => void) {
    this.listener = listener;
    return () => { this.listener = null; };
  }

  async signIn(email: string) {
    this.calls.push(`signIn:${email}`);
    if (this.error) throw this.error;
    return this.user ?? { id: 'signed-in', email };
  }

  async signUp(email: string): Promise<SignUpResult> {
    this.calls.push(`signUp:${email}`);
    if (this.error) throw this.error;
    return { confirmationRequired: this.confirmationRequired, user: { id: 'new-user', email } };
  }

  async signOut() {
    this.calls.push('signOut');
    if (this.error) throw this.error;
  }

  emit(event: string, user: AuthUser | null) {
    this.listener?.({ event, user });
  }
}

describe('useAuthSession', () => {
  it('keeps financial content gated while the initial session is unresolved', async () => {
    const gateway = new FakeAuthGateway();
    const pending = deferred<AuthUser | null>();
    gateway.sessionPromise = pending.promise;
    const { result } = renderHook(() => useAuthSession(gateway));

    expect(result.current.status).toBe('loading');
    pending.resolve(null);
    await waitFor(() => expect(result.current.status).toBe('signed-out'));
  });

  it('ignores a stale initial read after a newer sign-in event', async () => {
    const gateway = new FakeAuthGateway();
    const pending = deferred<AuthUser | null>();
    gateway.sessionPromise = pending.promise;
    const { result } = renderHook(() => useAuthSession(gateway));

    act(() => gateway.emit('SIGNED_IN', { id: 'new-user', email: 'new@example.com' }));
    pending.resolve({ id: 'old-user', email: 'old@example.com' });

    await waitFor(() => expect(result.current.user?.id).toBe('new-user'));
  });

  it('reacts to refresh and distinguishes expiry from explicit sign-out', async () => {
    const gateway = new FakeAuthGateway();
    gateway.user = { id: 'user-1', email: 'owner@example.com' };
    const { result } = renderHook(() => useAuthSession(gateway));
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    act(() => gateway.emit('TOKEN_REFRESHED', { id: 'user-1', email: 'fresh@example.com' }));
    expect(result.current.user?.email).toBe('fresh@example.com');
    act(() => gateway.emit('SIGNED_OUT', null));
    expect(result.current.status).toBe('expired');

    act(() => gateway.emit('SIGNED_IN', { id: 'user-2', email: 'two@example.com' }));
    await act(async () => result.current.signOut());
    expect(result.current.status).toBe('signed-out');
    expect(result.current.user).toBeNull();
  });

  it('shows confirmation-required sign-up without retaining the password', async () => {
    const gateway = new FakeAuthGateway();
    gateway.confirmationRequired = true;
    const { result } = renderHook(() => useAuthSession(gateway));
    await waitFor(() => expect(result.current.status).toBe('signed-out'));

    await act(async () => result.current.signUp('new@example.com', 'private-password'));
    expect(result.current.status).toBe('confirmation-required');
    expect(result.current.confirmationEmail).toBe('new@example.com');
    expect(JSON.stringify(result.current)).not.toContain('private-password');
  });

  it('keeps sign-in failures safe and permits a later successful retry', async () => {
    const gateway = new FakeAuthGateway();
    const { result } = renderHook(() => useAuthSession(gateway));
    await waitFor(() => expect(result.current.status).toBe('signed-out'));
    gateway.error = new Error('Sign-in was not accepted. Check your email and password, then try again.');
    await act(async () => result.current.signIn('owner@example.com', 'wrong'));
    expect(result.current.error).toContain('Sign-in was not accepted');

    gateway.error = null;
    gateway.user = { id: 'user-1', email: 'owner@example.com' };
    await act(async () => result.current.signIn('owner@example.com', 'correct'));
    expect(result.current.status).toBe('authenticated');
  });
});
