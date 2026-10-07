import { useEffect, useState } from 'react';

export type Route =
  | { readonly name: 'invite'; readonly token: string }
  | { readonly name: 'home' }
  | { readonly name: 'plan'; readonly month: string | null }
  | { readonly name: 'activity' }
  | { readonly name: 'accounts' }
  | { readonly name: 'settings' };

export type RouteName = Exclude<Route['name'], 'invite'>;

export function parseRoute(hash: string): Route {
  const [first, second] = hash.replace(/^#\/?/, '').split('/');
  switch (first) {
    case 'invite':
      return { name: 'invite', token: second ?? '' };
    case 'plan':
      return { name: 'plan', month: second && /^\d{4}-\d{2}$/.test(second) ? `${second}-01` : null };
    case 'activity':
      return { name: 'activity' };
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
