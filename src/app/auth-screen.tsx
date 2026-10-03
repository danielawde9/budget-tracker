import type { SupabaseClient } from '@supabase/supabase-js';
import { lazy, Suspense, useState, type FormEvent } from 'react';
import { useI18n } from '../lib/i18n.tsx';
import { IS_DEMO } from '../preview/demo-mode.ts';

const DemoSignIn = IS_DEMO ? lazy(() => import('../preview/demo-sign-in.tsx')) : null;

export function AuthScreen({ client, onToggleLocale }: { readonly client: SupabaseClient; readonly onToggleLocale: () => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signingUp = mode === 'sign-up';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const result = signingUp
      ? await client.auth.signUp({ email, password })
      : await client.auth.signInWithPassword({ email, password });
    setPending(false);
    if (result.error) setError(signingUp ? t('auth.signUpFailed') : t('auth.signInFailed'));
  }

  return (
    <main className="auth-page">
      <header className="auth-topbar">
        <span className="auth-brand"><span className="auth-brand-mark" aria-hidden="true" />{t('app.name')}</span>
        <button type="button" className="text-button auth-language" onClick={onToggleLocale}>{t('shell.language')}</button>
      </header>
      <section className="auth-boundary">
        <div className="auth-content">
          <div className="auth-intro">
            <h1>{signingUp ? t('auth.createTitle') : t('auth.signInTitle')}</h1>
            <p>{t('auth.intro')}</p>
          </div>
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            <label>{t('auth.email')}<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>{t('auth.password')}<input type="password" autoComplete={signingUp ? 'new-password' : 'current-password'} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            {error ? <div className="error-notice" role="alert">{error}</div> : null}
            <button type="submit" className="cr-button cr-button--primary cr-button--block" disabled={pending}>
              {signingUp ? t('auth.create') : t('auth.signIn')}
            </button>
            <div className="auth-alternative">
              <span>{signingUp ? t('auth.haveAccount') : t('auth.noAccount')}</span>
              <button type="button" className="text-button" disabled={pending} onClick={() => setMode(signingUp ? 'sign-in' : 'sign-up')}>
                {signingUp ? t('auth.signIn') : t('auth.create')}
              </button>
            </div>
          </form>
          {DemoSignIn ? <Suspense fallback={null}><DemoSignIn client={client} /></Suspense> : null}
        </div>
      </section>
    </main>
  );
}
