import { useEffect, useRef, useState } from 'react';
import { classifyRecurringError, type RecurringErrorView } from './errors.js';
import { occurrenceWindow } from './occurrence-window.js';
import type { RecurringGateway } from './types.js';

/** `error` is the classified failure (`AutoMaterializeBanner` localizes it),
 * never a stringified cause -- the gateway rejects with PostgREST's plain
 * `{ code, message }` object, which `String(cause)` shows as
 * "[object Object]" (final review I1). */
export type AutoMaterializeState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'failed'; error: RecurringErrorView };

/** Generates bill occurrences once per space and day when Available reports
 * a generation gap. Occurrence ids are deterministic, so a repeat never
 * duplicates; a failure is shown, never retried in a loop. */
export function useAutoMaterialize(options: {
  gateway: RecurringGateway | null;
  spaceId: string;
  today: string;
  needed: boolean;
  onGenerated(): Promise<unknown>;
}): AutoMaterializeState {
  const { gateway, spaceId, today, needed, onGenerated } = options;
  const [state, setState] = useState<AutoMaterializeState>({ status: 'idle' });
  const attempted = useRef<string | null>(null);
  useEffect(() => {
    const key = `${spaceId}|${today}`;
    if (!gateway || !needed || attempted.current === key) return;
    attempted.current = key;
    setState({ status: 'running' });
    void gateway.materialize({ spaceId, requestId: globalThis.crypto.randomUUID(), ...occurrenceWindow(today) })
      .then(() => onGenerated())
      .then(() => setState({ status: 'idle' }))
      .catch((cause: unknown) => setState({ status: 'failed', error: classifyRecurringError(cause) }));
  }, [gateway, spaceId, today, needed, onGenerated]);
  return state;
}
