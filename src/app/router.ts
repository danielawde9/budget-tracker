import { useEffect, useState } from 'react';

export type Route =
  | { readonly name: 'invite'; readonly token: string }
  | { readonly name: 'home' }
  | { readonly name: 'plan'; readonly month: string | null }
  | { readonly name: 'activity'; readonly walletId?: string | null; readonly month?: string | null }
  | { readonly name: 'accounts' }
  | { readonly name: 'settings' };

export type RouteName = Exclude<Route['name'], 'invite'>;

export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const [first, second] = (path ?? '').split('/');
  switch (first) {
    case 'invite':
      return { name: 'invite', token: second ?? '' };
    case 'plan':
      return { name: 'plan', month: second && /^\d{4}-\d{2}$/.test(second) ? `${second}-01` : null };
    case 'activity': {
      const params = new URLSearchParams(query);
      const wallet = params.get('wallet');
      const month = params.get('month');
      return { name: 'activity',
        walletId: wallet && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(wallet) ? wallet : null,
        month: month && /^(?:[2-9]\d{3})-(?:0[1-9]|1[0-2])$/.test(month) ? `${month}-01` : null };
    }
    case 'accounts':
      return { name: 'accounts' };
    case 'settings':
      return { name: 'settings' };
    default:
      return { name: 'home' };
  }
}

export function routeHash(route: Route): string {
  if (route.name === 'invite') return `#/invite/${route.token}`;
  if (route.name === 'plan') return route.month ? `#/plan/${route.month.slice(0, 7)}` : '#/plan';
  if (route.name === 'activity') {
    const params = new URLSearchParams();
    if (route.walletId) params.set('wallet', route.walletId);
    if (route.month) params.set('month', route.month.slice(0, 7));
    return `#/activity${params.size ? `?${params}` : ''}`;
  }
  return `#/${route.name}`;
}

export function navigate(route: Route): void {
  window.location.hash = routeHash(route);
}

/** A tiny hash router: deep links and the browser back button just work. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
