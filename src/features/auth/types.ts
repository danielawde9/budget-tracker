export interface AuthUser {
  id: string;
  email: string | null;
}

export interface AuthChange {
  event: string;
  user: AuthUser | null;
}

export interface SignUpResult {
  confirmationRequired: boolean;
  user: AuthUser | null;
}

export interface AuthGateway {
  getSession(): Promise<AuthUser | null>;
  subscribe(listener: (change: AuthChange) => void): () => void;
  signIn(email: string, password: string): Promise<AuthUser>;
  signUp(email: string, password: string): Promise<SignUpResult>;
  signOut(): Promise<void>;
}
