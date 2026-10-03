import { useCallback, useEffect, useState } from 'react';
import type { BudgetApi } from '../api/budget-api.ts';
import type { SpaceSummary } from '../api/schemas.ts';
import { useLoad, type Loaded } from '../ui/async.tsx';

const CLOCK_REFRESH_MS = 10 * 60_000;

/**
 * The caller's spaces, each with the server's "today" for that space. The
 * clock is re-read whenever the app comes back to the foreground and every
 * ten minutes, so an app left open overnight never dates records yesterday.
 */
export function useSpaces(api: BudgetApi): { readonly spaces: Loaded<SpaceSummary[]>; readonly reload: () => void } {
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const spaces = useLoad(() => api.mySpaces(), [api, version]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const timer = window.setInterval(onVisible, CLOCK_REFRESH_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.clearInterval(timer);
    };
  }, [reload]);
  return { spaces, reload };
}
