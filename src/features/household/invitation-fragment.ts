const PREFIX = '#household-invitation=';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface HouseholdInvitationBootstrap {
  take(): string | null;
}

export function createHouseholdInvitationBootstrap(initialToken: string | null): HouseholdInvitationBootstrap {
  let token = initialToken;
  return {
    take() {
      const current = token;
      token = null;
      return current;
    },
  };
}

export function takeHouseholdInvitation(
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'replaceState'>,
): string | null {
  if (!location.hash.startsWith(PREFIX)) return null;
  const candidate = location.hash.slice(PREFIX.length);
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  return TOKEN.test(candidate) ? candidate : null;
}
