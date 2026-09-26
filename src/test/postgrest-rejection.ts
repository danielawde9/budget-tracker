/** The error value a gateway call actually rejects with when an RPC fails.
 *
 * In the pinned `@supabase/postgrest-js` 2.116.0, `processResponse` sets
 * `error = JSON.parse(body)` for an HTTP error, so the error is a PLAIN
 * `{ code, message, details, hint }` object -- never an `Error` instance. A
 * `PostgrestError` is thrown only under `.throwOnError()`, which this app
 * never calls (`src/lib/supabase.ts` is a default `createClient`), and
 * `planningRpc` rethrows the plain object as is.
 *
 * Gateway test doubles must reject with this shape, not `new Error(...)`:
 * code that reads `cause instanceof Error ? cause.message : String(cause)`
 * passes every `new Error` test and then shows "[object Object]" to a real
 * person (final review I1, 2026-09-26). */
export interface PostgrestRejection {
  readonly code: string;
  readonly message: string;
  readonly details: null;
  readonly hint: null;
}

export function postgrestRejection(code: string, message: string): PostgrestRejection {
  return { code, message, details: null, hint: null };
}
