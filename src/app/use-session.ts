import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'signed-out' }
  | { readonly status: 'signed-in'; readonly session: Session };

export function useSession(client: SupabaseClient): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    client.auth.getSession().then(({ data }) => {
      if (active) setState(data.session ? { status: 'signed-in', session: data.session } : { status: 'signed-out' });
    }, () => {
      if (active) setState({ status: 'signed-out' });
    });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setState(session ? { status: 'signed-in', session } : { status: 'signed-out' });
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);
  return state;
}
