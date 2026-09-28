import { useSyncExternalStore } from 'react';

/**
 * W4a-1: the single server clock for the active space.
 *
 * The server owns "today" (`public.space_clock`, derived from `now()` in the
 * space's IANA zone). The browser must not derive its own month or "today":
 * `HomeRoutes`/`PlanRoutes`' month, cash control's as-of date, the occurrence
 * window and the record/confirm date defaults all read this value instead.
 *
 * `useWorkspace` publishes the clock here whenever a space is selected; the
 * Control Room reads it back. It is a module-level store (not a React context)
 * because `ControlRoomRoutes` is rendered by `app.tsx`, which only forwards a
 * fixed set of props; the workspace feature is the owned producer.
 */
export interface SpaceClock {
  /** The space's IANA time zone (e.g. `Asia/Beirut`). */
  readonly timezone: string;
  /** The space-zone calendar date, `YYYY-MM-DD`. */
  readonly today: string;
  /** The first day of the space-zone current month, `YYYY-MM-DD`. */
  readonly currentMonth: string;
}

let activeSpaceClock: SpaceClock | null = null;
const listeners = new Set<() => void>();

function same(a: SpaceClock | null, b: SpaceClock | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.timezone === b.timezone && a.today === b.today && a.currentMonth === b.currentMonth;
}

/** Publishes the active space's clock (null clears it, e.g. on sign-out). */
export function setActiveSpaceClock(clock: SpaceClock | null): void {
  if (same(activeSpaceClock, clock)) return;
  activeSpaceClock = clock;
  for (const listener of [...listeners]) listener();
}

export function getActiveSpaceClock(): SpaceClock | null {
  return activeSpaceClock;
}

export function subscribeSpaceClock(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The active space's server clock, or null before the workspace has loaded one. */
export function useSpaceClock(): SpaceClock | null {
  return useSyncExternalStore(subscribeSpaceClock, getActiveSpaceClock, getActiveSpaceClock);
}
