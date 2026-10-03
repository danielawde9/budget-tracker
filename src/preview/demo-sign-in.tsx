import type { SupabaseClient } from '@supabase/supabase-js';
import { useState } from 'react';
import { DEMO_ACCOUNTS } from '../../scripts/preview/demo-accounts.ts';
import { useI18n } from '../lib/i18n.tsx';

/** Preview only: one-click sign-in to the seeded local demo accounts. */
export default function DemoSignIn({ client }: { readonly client: SupabaseClient }) {
  const { t, locale } = useI18n();
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="cr-card cr-demo-panel" aria-labelledby="demo-heading">
      <h2 id="demo-heading">{t('demo.title')}</h2>
      <p className="cr-helper">{t('demo.intro')}</p>
      <div className="cr-demo-accounts">
        {DEMO_ACCOUNTS.map((account) => (
          <button
            key={account.key}
            type="button"
            className="cr-button cr-button--block"
            onClick={() => {
              setError(null);
              client.auth.signInWithPassword({ email: account.email, password: account.password }).then(
                ({ error: failure }) => { if (failure) setError(t('demo.failed')); },
                () => setError(t('demo.failed')),
              );
            }}
          >
            {locale === 'ar' ? account.labelAr : account.labelEn}
          </button>
        ))}
      </div>
      {error ? <p className="error-notice" role="alert">{error}</p> : null}
    </section>
  );
}
