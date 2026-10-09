import type { SupabaseClient } from '@supabase/supabase-js';
import { lazy, Suspense, useState, type FormEvent } from 'react';
import { useI18n } from '../lib/i18n.tsx';
import { IS_DEMO } from '../preview/demo-mode.ts';
import { Eye, EyeOff } from 'lucide-react';
import { setupCopy } from '../screens/onboarding/setup-copy.ts';
import './auth-redesign.css';
import { PublicLinks } from '../public-site/public-links.tsx';
import { BRAND_MARK_URL } from '../public-site/site.ts';

const DemoSignIn = IS_DEMO ? lazy(() => import('../preview/demo-sign-in.tsx')) : null;

export function AuthScreen({ client, onToggleLocale }: { readonly client: SupabaseClient; readonly onToggleLocale: () => void }) {
  const { t, locale, dir } = useI18n();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signingUp = mode === 'sign-up';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = signingUp
        ? await client.auth.signUp({ email, password })
        : await client.auth.signInWithPassword({ email, password });
      if (result.error) setError(signingUp ? t('auth.signUpFailed') : t('auth.signInFailed'));
    } catch {
      setError(signingUp ? t('auth.signUpFailed') : t('auth.signInFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-page auth-redesign" dir={dir}>
      <header className="auth-topbar">
        <span className="auth-brand"><img className="cr-brand-mark" src={BRAND_MARK_URL} width="40" height="40" alt="" /><bdi className="cr-brand-name" dir="ltr">{t('app.name')}</bdi></span>
        <button type="button" className="text-button auth-language" onClick={onToggleLocale}>{t('shell.language')}</button>
      </header>
      <section className="auth-boundary">
        <aside className="auth-story">
          <h2>{setupCopy(locale, 'headline')}</h2>
          <p>{setupCopy(locale, 'subtitle')}</p>
          <span className="auth-story-leaf" aria-hidden="true" />
          <p className="auth-story-tagline">{setupCopy(locale, 'tagline')}</p>
        </aside>
        <div className="auth-content">
          <div className="auth-intro">
            <h1>{signingUp ? t('auth.createTitle') : t('auth.signInTitle')}</h1>
          </div>
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            <label>{t('auth.email')}<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <div className="auth-password-field">
              <label htmlFor="auth-password">{t('auth.password')}</label>
              <div className="auth-password-input">
                <input id="auth-password" type={passwordVisible ? 'text' : 'password'} autoComplete={signingUp ? 'new-password' : 'current-password'} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby={signingUp ? 'auth-password-hint' : undefined} />
                <button type="button" className="auth-password-toggle" aria-label={setupCopy(locale, passwordVisible ? 'hidePassword' : 'showPassword')} aria-pressed={passwordVisible} onClick={() => setPasswordVisible((visible) => !visible)}>{passwordVisible ? <EyeOff aria-hidden="true" size={20} /> : <Eye aria-hidden="true" size={20} />}</button>
              </div>
              {signingUp ? <p id="auth-password-hint" className="cr-helper">{setupCopy(locale, 'passwordHint')}</p> : null}
            </div>
            {error ? <div className="error-notice" role="alert">{error}</div> : null}
            <button type="submit" className="cr-button cr-button--primary cr-button--block" disabled={pending}>
              {signingUp ? t('auth.create') : t('auth.signIn')}
            </button>
            <div className="auth-alternative">
              <span>{signingUp ? t('auth.haveAccount') : t('auth.noAccount')}</span>
              <button type="button" className="text-button" disabled={pending} onClick={() => { setMode(signingUp ? 'sign-in' : 'sign-up'); setError(null); }}>
                {signingUp ? t('auth.signIn') : t('auth.create')}
              </button>
            </div>
          </form>
          {DemoSignIn ? <Suspense fallback={null}><DemoSignIn client={client} /></Suspense> : null}
        </div>
      </section>
      <PublicLinks />
    </main>
  );
}
