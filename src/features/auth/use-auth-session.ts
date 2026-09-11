import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthGateway, AuthUser } from './types.js';

export type AuthStatus = 'loading' | 'signed-out' | 'authenticated' | 'expired' | 'confirmation-required';

export interface AuthSessionState {
  status: AuthStatus;
  user: AuthUser | null;
  error: string | null;
  confirmationEmail: string | null;
  pending: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  dismissConfirmation(): void;
  resendConfirmation(): Promise<void>;
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function useAuthSession(gateway: AuthGateway): AuthSessionState {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const revision = useRef(0);
  const hadUser = useRef(false);
  const explicitSignOut = useRef(false);

  useEffect(() => {
    let active = true;
    const stop = gateway.subscribe((change) => {
      if (!active) return;
      revision.current += 1;
      if (change.user) {
        hadUser.current = true;
        setUser(change.user);
        setStatus('authenticated');
        setError(null);
        setConfirmationEmail(null);
        return;
      }
      if (change.event === 'SIGNED_OUT') {
        setUser(null);
        setStatus(hadUser.current && !explicitSignOut.current ? 'expired' : 'signed-out');
      } else if (change.event === 'INITIAL_SESSION') {
        setUser(null);
        setStatus('signed-out');
      }
    });

    const startRevision = revision.current;
    void gateway.getSession().then((initialUser) => {
      if (!active || revision.current !== startRevision) return;
      hadUser.current = initialUser !== null;
      setUser(initialUser);
      setStatus(initialUser ? 'authenticated' : 'signed-out');
    }).catch((cause: unknown) => {
      if (!active || revision.current !== startRevision) return;
      setError(message(cause, 'Your session could not be checked. Try again.'));
      setStatus('signed-out');
    });

    return () => {
      active = false;
      stop();
    };
  }, [gateway]);

  const signIn = useCallback(async (email: string, password: string) => {
    setPending(true);
    setError(null);
    try {
      const nextUser = await gateway.signIn(email, password);
      hadUser.current = true;
      setUser(nextUser);
      setStatus('authenticated');
      setConfirmationEmail(null);
    } catch (cause) {
      setError(message(cause, 'Sign-in was not accepted. Check your details and try again.'));
    } finally {
      setPending(false);
    }
  }, [gateway]);

  const signUp = useCallback(async (email: string, password: string) => {
    setPending(true);
    setError(null);
    try {
      const result = await gateway.signUp(email, password);
      if (result.confirmationRequired) {
        setUser(null);
        setConfirmationEmail(email);
        setStatus('confirmation-required');
      } else if (result.user) {
        hadUser.current = true;
        setUser(result.user);
        setStatus('authenticated');
      }
    } catch (cause) {
      setError(message(cause, 'Your account could not be created. Check the details and try again.'));
    } finally {
      setPending(false);
    }
  }, [gateway]);

  const signOut = useCallback(async () => {
    explicitSignOut.current = true;
    setUser(null);
    setStatus('signed-out');
    setError(null);
    setPending(true);
    try {
      await gateway.signOut();
      hadUser.current = false;
    } catch (cause) {
      setError(message(cause, 'Sign-out could not be completed. Try again.'));
    } finally {
      explicitSignOut.current = false;
      setPending(false);
    }
  }, [gateway]);

  const dismissConfirmation = useCallback(() => {
    setStatus('signed-out');
    setConfirmationEmail(null);
    setError(null);
  }, []);

  const resendConfirmation = useCallback(async () => {
    if (!confirmationEmail) return;
    setPending(true);
    setError(null);
    try {
      await gateway.resendConfirmation(confirmationEmail);
    } catch (cause) {
      setError(message(cause, 'Your confirmation email could not be resent. Try again.'));
    } finally {
      setPending(false);
    }
  }, [gateway, confirmationEmail]);

  return { status, user, error, confirmationEmail, pending, signIn, signUp, signOut, dismissConfirmation, resendConfirmation };
}
