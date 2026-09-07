import { useEffect, useMemo, useState } from 'react';
import { AuthScreen } from './features/auth/auth-screen.js';
import { createSupabaseAuthGateway } from './features/auth/supabase-auth-gateway.js';
import type { AuthGateway } from './features/auth/types.js';
import { useAuthSession } from './features/auth/use-auth-session.js';
import { LoansPage } from './features/loans/loans-page.js';
import { createSupabaseLoansGateway } from './features/loans/supabase-loans-gateway.js';
import type { LoansGateway, Locale } from './features/loans/types.js';
import { createBrowserDataClient } from './lib/supabase.js';

interface AppProps {
  authGateway?: AuthGateway;
  loansGateway?: LoansGateway;
}

function ConfiguredApp({ authGateway, loansGateway }: Required<AppProps>) {
  const auth = useAuthSession(authGateway);
  const [locale, setLocale] = useState<Locale>('en');

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);

  if (auth.status === 'loading') {
    return <main className="auth-page"><div className="auth-loading" role="status">Checking your session…</div></main>;
  }

  if (auth.status !== 'authenticated' || !auth.user) {
    return <AuthScreen
      locale={locale}
      state={auth.status === 'confirmation-required' ? 'confirmation-required' : auth.status === 'expired' ? 'expired' : 'signed-out'}
      confirmationEmail={auth.confirmationEmail}
      error={auth.error}
      pending={auth.pending}
      onLocaleChange={() => setLocale((current) => current === 'en' ? 'ar' : 'en')}
      onSignIn={auth.signIn}
      onSignUp={auth.signUp}
    />;
  }

  return <LoansPage key={auth.user.id} gateway={loansGateway} />;
}

export function App({ authGateway, loansGateway }: AppProps = {}) {
  const client = useMemo(() => createBrowserDataClient(), []);
  const activeAuthGateway = useMemo(() => authGateway ?? (client ? createSupabaseAuthGateway(client) : null), [authGateway, client]);
  const activeLoansGateway = useMemo(() => loansGateway ?? (client ? createSupabaseLoansGateway(client) : null), [loansGateway, client]);

  if (!activeAuthGateway || !activeLoansGateway) {
    return <main className="configuration-page"><section><span className="brand">Budget ledger</span><h1>Configuration needed</h1><p>Connect this browser to the dedicated Budget development stack before continuing.</p></section></main>;
  }

  return <ConfiguredApp authGateway={activeAuthGateway} loansGateway={activeLoansGateway} />;
}
