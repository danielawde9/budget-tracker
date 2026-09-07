import type { AuthChange, AuthGateway, AuthUser, SignUpResult } from './types.js';

interface RawUser {
  id: string;
  email?: string | null;
}

interface RawSession {
  user: RawUser;
}

interface RawAuthError {
  message: string;
}

interface RawAuthResult {
  data: {
    session: RawSession | null;
    user?: RawUser | null;
  };
  error: RawAuthError | null;
}

interface AuthSubscription {
  unsubscribe(): void;
}

export interface SupabaseAuthClient {
  auth: {
    getSession(): Promise<{ data: { session: RawSession | null }; error: RawAuthError | null }>;
    onAuthStateChange(callback: (event: string, session: RawSession | null) => void): { data: { subscription: AuthSubscription } };
    signInWithPassword(credentials: { email: string; password: string }): Promise<RawAuthResult>;
    signUp(credentials: { email: string; password: string }): Promise<RawAuthResult>;
    signOut(): Promise<{ error: RawAuthError | null }>;
  };
}

function userFrom(raw: RawUser | null | undefined): AuthUser | null {
  if (!raw) return null;
  return { id: raw.id, email: raw.email ?? null };
}

function safeError(operation: 'session' | 'sign-in' | 'sign-up' | 'sign-out'): Error {
  const messages = {
    session: 'Your session could not be checked. Try again.',
    'sign-in': 'Sign-in was not accepted. Check your email and password, then try again.',
    'sign-up': 'Your account could not be created. Check the details and try again.',
    'sign-out': 'Sign-out could not be completed. Try again.',
  } as const;
  return new Error(messages[operation]);
}

export function createSupabaseAuthGateway(client: SupabaseAuthClient): AuthGateway {
  return {
    async getSession() {
      const result = await client.auth.getSession();
      if (result.error) throw safeError('session');
      return userFrom(result.data.session?.user);
    },

    subscribe(listener) {
      const result = client.auth.onAuthStateChange((event, session) => {
        const change: AuthChange = { event, user: userFrom(session?.user) };
        listener(change);
      });
      return () => result.data.subscription.unsubscribe();
    },

    async signIn(email, password) {
      const result = await client.auth.signInWithPassword({ email, password });
      const user = userFrom(result.data.session?.user ?? result.data.user);
      if (result.error || !user) throw safeError('sign-in');
      return user;
    },

    async signUp(email, password): Promise<SignUpResult> {
      const result = await client.auth.signUp({ email, password });
      if (result.error) throw safeError('sign-up');
      return {
        confirmationRequired: result.data.session === null,
        user: userFrom(result.data.user ?? result.data.session?.user),
      };
    },

    async signOut() {
      const result = await client.auth.signOut();
      if (result.error) throw safeError('sign-out');
    },
  };
}
