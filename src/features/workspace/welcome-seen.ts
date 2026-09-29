/**
 * Per-user marker that the welcome tour has already been shown.
 *
 * Written from two places: any tour dismissal path in `app.tsx`, and
 * `useWorkspace.finishOnboarding` (so a person who completes first-run
 * setup never sees the tour). Purely local; no server involvement.
 */
export function welcomeSeenKey(userId: string): string {
  return `budget:welcome-seen:${userId}`;
}

export function readWelcomeSeen(userId: string): boolean {
  return localStorage.getItem(welcomeSeenKey(userId)) !== null;
}

export function writeWelcomeSeen(userId: string): void {
  localStorage.setItem(welcomeSeenKey(userId), '1');
}
