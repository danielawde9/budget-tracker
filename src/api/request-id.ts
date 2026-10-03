/**
 * A request id is created when a form opens and reused for every retry of
 * that submission, so the database records it at most once.
 */
export function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}
